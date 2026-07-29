#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

const IDENTITY_DOMAIN = "peptides-storefront-build-identity-v2\0";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_ITEMS = 10_000;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 250_000;

const REGION_FIELDS = "id,name,currency_code,*countries";
const CATEGORY_FIELDS = "id,name,handle,description";
const PRODUCT_FIELDS =
	"id,title,handle,description,thumbnail,metadata,updated_at,*variants,+variants.inventory_quantity,*variants.options,*variants.calculated_price,*categories";
const SNAPSHOT_SCHEMA_VERSION = 1;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export const PUBLIC_BUILD_ENV_KEYS = Object.freeze([
	"PUBLIC_BANK_ACCOUNT_HOLDER",
	"PUBLIC_BANK_BIC",
	"PUBLIC_BANK_IBAN",
	"PUBLIC_BANK_NAME",
	"PUBLIC_GA_MEASUREMENT_ID",
	"PUBLIC_GOOGLE_SITE_VERIFICATION",
	"PUBLIC_MEDUSA_BACKEND_URL",
	"PUBLIC_MEDUSA_PUBLISHABLE_KEY",
	"PUBLIC_SITE_URL",
]);

const REQUIRED_PUBLIC_BUILD_ENV_KEYS = new Set([
	"PUBLIC_MEDUSA_BACKEND_URL",
	"PUBLIC_MEDUSA_PUBLISHABLE_KEY",
	"PUBLIC_SITE_URL",
]);

const BUILD_TOOLCHAIN_ENV_KEYS = Object.freeze([
	"PEPTIDES_BUILD_LIBC_VERSION",
	"PEPTIDES_BUILD_NODE_VERSION",
	"PEPTIDES_BUILD_NPM_VERSION",
	"PEPTIDES_BUILD_PLATFORM",
]);

const SAFE_ERROR_MESSAGES = Object.freeze({
	CLI_USAGE: "invalid command usage",
	ENV_INVALID: "public build environment is invalid",
	FETCH_UNAVAILABLE: "the HTTP client is unavailable",
	FETCH_FAILED: "a store request failed",
	HTTP_STATUS: "a store request returned an unexpected status",
	HTTP_TYPE: "a store response was not JSON",
	RESPONSE_TOO_LARGE: "a store response exceeded its size limit",
	RESPONSE_ENCODING: "a store response was not valid UTF-8",
	RESPONSE_JSON: "a store response was not valid JSON",
	SCHEMA_INVALID: "store response schema validation failed",
	PAGINATION_INVALID: "store response pagination validation failed",
	LIMIT_EXCEEDED: "a store response exceeded a configured limit",
	IDENTITY_INPUT_INVALID: "build identity input validation failed",
	SNAPSHOT_INVALID: "build catalog snapshot validation failed",
});

/**
 * Errors deliberately carry only a fixed code and fixed message. In
 * particular, network exceptions, response bodies, URLs and environment
 * values are never attached because the publishable key is one of the inputs.
 */
export class BuildIdentityError extends Error {
	constructor(code) {
		super(SAFE_ERROR_MESSAGES[code] ?? "build identity failed");
		this.name = "BuildIdentityError";
		this.code = code;
	}
}

function fail(code) {
	throw new BuildIdentityError(code);
}

function isRecord(value) {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		(Object.getPrototypeOf(value) === Object.prototype ||
			Object.getPrototypeOf(value) === null)
	);
}

function requireRecord(value, code = "SCHEMA_INVALID") {
	if (!isRecord(value)) fail(code);
	return value;
}

function requireNonEmptyString(value, code = "SCHEMA_INVALID") {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 16_384 ||
		/[\0\r\n]/u.test(value)
	) {
		fail(code);
	}
	return value;
}

function requireSafeInteger(value, code) {
	if (!Number.isSafeInteger(value) || value < 0) fail(code);
	return value;
}

function canonicalizeJsonAt(value, state, depth) {
	state.nodes += 1;
	if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
		fail("IDENTITY_INPUT_INVALID");
	}

	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "string"
	) {
		return value;
	}

	if (typeof value === "number") {
		if (!Number.isFinite(value)) fail("IDENTITY_INPUT_INVALID");
		return Object.is(value, -0) ? 0 : value;
	}

	if (Array.isArray(value)) {
		return value.map((entry) => canonicalizeJsonAt(entry, state, depth + 1));
	}

	if (!isRecord(value)) fail("IDENTITY_INPUT_INVALID");

	const result = {};
	for (const key of Object.keys(value).sort()) {
		if (key === "__proto__") fail("IDENTITY_INPUT_INVALID");
		const entry = value[key];
		if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") {
			fail("IDENTITY_INPUT_INVALID");
		}
		result[key] = canonicalizeJsonAt(entry, state, depth + 1);
	}
	return result;
}

/**
 * Deep-copy a JSON value with object keys in lexical order. Arrays retain
 * their order because Medusa response order can affect the generated site.
 */
export function canonicalizeJson(value) {
	return canonicalizeJsonAt(value, { nodes: 0 }, 0);
}

function serializeCanonical(value) {
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number" || typeof value === "string") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(serializeCanonical).join(",")}]`;
	}
	const entries = Object.keys(value)
		.sort()
		.map(
			(key) =>
				`${JSON.stringify(key)}:${serializeCanonical(value[key])}`,
		);
	return `{${entries.join(",")}}`;
}

/** Serialize a JSON value without depending on insertion order. */
export function stableStringify(value) {
	return serializeCanonical(canonicalizeJson(value));
}

function canonicalizeEntityCollection(items, validateEntity) {
	if (!Array.isArray(items)) fail("SCHEMA_INVALID");

	const seen = new Set();
	const entities = items.map((item) => {
		const record = requireRecord(item);
		const id = requireNonEmptyString(record.id);
		if (seen.has(id)) fail("SCHEMA_INVALID");
		seen.add(id);
		validateEntity(record);
		return canonicalizeJson(record);
	});

	return entities;
}

/** Validate and canonicalize region records while retaining response order. */
export function canonicalizeRegions(regions) {
	return canonicalizeEntityCollection(regions, (region) => {
		requireNonEmptyString(region.name);
		requireNonEmptyString(region.currency_code);
		if (
			Object.hasOwn(region, "countries") &&
			region.countries !== null &&
			!Array.isArray(region.countries)
		) {
			fail("SCHEMA_INVALID");
		}
	});
}

/** Validate and canonicalize category records while retaining response order. */
export function canonicalizeCategories(categories) {
	return canonicalizeEntityCollection(categories, (category) => {
		requireNonEmptyString(category.name);
		requireNonEmptyString(category.handle);
		if (
			Object.hasOwn(category, "description") &&
			category.description !== null &&
			typeof category.description !== "string"
		) {
			fail("SCHEMA_INVALID");
		}
	});
}

function validateCalculatedPrice(price) {
	if (price === null) return;
	const record = requireRecord(price);
	if (
		!Object.hasOwn(record, "calculated_amount") ||
		typeof record.calculated_amount !== "number" ||
		!Number.isFinite(record.calculated_amount) ||
		record.calculated_amount < 0
	) {
		fail("SCHEMA_INVALID");
	}
	requireNonEmptyString(record.currency_code);
}

/** Validate product/variant price expansion and canonicalize product records. */
export function canonicalizeProducts(products) {
	return canonicalizeEntityCollection(products, (product) => {
		requireNonEmptyString(product.title);
		requireNonEmptyString(product.handle);
		if (
			Object.hasOwn(product, "updated_at") &&
			product.updated_at !== null &&
			typeof product.updated_at !== "string"
		) {
			fail("SCHEMA_INVALID");
		}
		if (!Array.isArray(product.variants)) fail("SCHEMA_INVALID");
		if (!Array.isArray(product.categories)) fail("SCHEMA_INVALID");

		const variantIds = new Set();
		for (const variant of product.variants) {
			const record = requireRecord(variant);
			const id = requireNonEmptyString(record.id);
			if (variantIds.has(id)) fail("SCHEMA_INVALID");
			variantIds.add(id);
			if (!Object.hasOwn(record, "calculated_price")) {
				fail("SCHEMA_INVALID");
			}
			if (
				Object.hasOwn(record, "options") &&
				record.options !== null &&
				!Array.isArray(record.options)
			) {
				fail("SCHEMA_INVALID");
			}
			validateCalculatedPrice(record.calculated_price);
		}
	});
}

/**
 * Produce the canonical store portion of the identity. Collection order is
 * material: the first region is the storefront default, stable product sorting
 * retains API order within groups, and variant order is rendered directly.
 */
export function canonicalizeStoreSnapshot(snapshot) {
	const record = requireRecord(snapshot, "IDENTITY_INPUT_INVALID");
	if (
		Object.hasOwn(record, "defaultRegionId") &&
		Object.hasOwn(record, "default_region_id") &&
		record.defaultRegionId !== record.default_region_id
	) {
		fail("IDENTITY_INPUT_INVALID");
	}
	const defaultRegionId = requireNonEmptyString(
		record.defaultRegionId ?? record.default_region_id,
		"IDENTITY_INPUT_INVALID",
	);
	const regions = canonicalizeRegions(record.regions);
	if (!regions.some((region) => region.id === defaultRegionId)) {
		fail("SCHEMA_INVALID");
	}

	return {
		categories: canonicalizeCategories(record.categories),
		default_region_id: defaultRegionId,
		products: canonicalizeProducts(record.products),
		regions,
	};
}

/**
 * Select every public value that can affect the static storefront. Unknown
 * PUBLIC_* names are rejected so a newly introduced build input cannot be
 * silently omitted from the release identity.
 */
export function canonicalizePublicBuildEnvironment(environment) {
	const source = requireRecord(environment, "ENV_INVALID");
	const known = new Set(PUBLIC_BUILD_ENV_KEYS);

	for (const key of Object.keys(source)) {
		if (key.startsWith("PUBLIC_") && !known.has(key)) fail("ENV_INVALID");
	}

	const result = {};
	for (const key of PUBLIC_BUILD_ENV_KEYS) {
		const value = source[key] ?? "";
		if (
			typeof value !== "string" ||
			value.length > 16_384 ||
			/[\0\r\n]/u.test(value) ||
			(REQUIRED_PUBLIC_BUILD_ENV_KEYS.has(key) && value.length === 0)
		) {
			fail("ENV_INVALID");
		}
		result[key] = value;
	}
	return result;
}

export function canonicalizeBuildToolchain(environment) {
	const source = requireRecord(environment, "ENV_INVALID");
	const result = {};
	for (const key of BUILD_TOOLCHAIN_ENV_KEYS) {
		const value = source[key] ?? "";
		if (
			typeof value !== "string" ||
			value.length > 256 ||
			/[\0\r\n]/u.test(value)
		) {
			fail("ENV_INVALID");
		}
		result[key.toLowerCase()] = value;
	}
	return result;
}

/** Build the canonical, versioned value that is fed into SHA-256. */
export function canonicalizeBuildIdentityInput(environment, snapshot) {
	return {
		build_toolchain: canonicalizeBuildToolchain(environment),
		public_build_environment:
			canonicalizePublicBuildEnvironment(environment),
		schema_version: 2,
		store: canonicalizeStoreSnapshot(snapshot),
	};
}

/** Compute the lowercase hexadecimal SHA-256 identity from already fetched data. */
export function hashBuildIdentity(environment, snapshot) {
	const payload = stableStringify(
		canonicalizeBuildIdentityInput(environment, snapshot),
	);
	return createHash("sha256")
		.update(IDENTITY_DOMAIN, "utf8")
		.update(payload, "utf8")
		.digest("hex");
}

function normalizeBaseUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		fail("ENV_INVALID");
	}

	const loopback =
		url.hostname === "localhost" ||
		url.hostname === "127.0.0.1" ||
		url.hostname === "[::1]";
	if (
		(url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		(url.pathname !== "/" && url.pathname !== "")
	) {
		fail("ENV_INVALID");
	}
	return url.origin;
}

function validatePositiveLimit(value) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		fail("LIMIT_EXCEEDED");
	}
	return value;
}

async function readLimitedBody(response, maximumBytes) {
	const declaredLength = response.headers.get("content-length");
	if (
		declaredLength !== null &&
		(!/^[0-9]+$/u.test(declaredLength) ||
			Number(declaredLength) > maximumBytes)
	) {
		fail("RESPONSE_TOO_LARGE");
	}

	const chunks = [];
	let byteLength = 0;

	if (response.body && typeof response.body.getReader === "function") {
		const reader = response.body.getReader();
		for (;;) {
			let result;
			try {
				result = await reader.read();
			} catch {
				fail("FETCH_FAILED");
			}
			if (result.done) break;
			if (!(result.value instanceof Uint8Array)) fail("RESPONSE_ENCODING");
			byteLength += result.value.byteLength;
			if (byteLength > maximumBytes) {
				try {
					await reader.cancel();
				} catch {
					// The response is already rejected; cancellation is best effort.
				}
				fail("RESPONSE_TOO_LARGE");
			}
			chunks.push(Buffer.from(result.value));
		}
	} else if (typeof response.arrayBuffer === "function") {
		let bytes;
		try {
			bytes = Buffer.from(await response.arrayBuffer());
		} catch {
			fail("FETCH_FAILED");
		}
		byteLength = bytes.byteLength;
		if (byteLength > maximumBytes) fail("RESPONSE_TOO_LARGE");
		chunks.push(bytes);
	} else {
		fail("FETCH_FAILED");
	}

	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(
			Buffer.concat(chunks, byteLength),
		);
	} catch {
		fail("RESPONSE_ENCODING");
	}
}

async function fetchJson(url, publishableKey, fetchImpl, limits) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
	timer.unref?.();

	try {
		let response;
		try {
			response = await fetchImpl(url, {
				headers: {
					accept: "application/json",
					"x-publishable-api-key": publishableKey,
				},
				method: "GET",
				redirect: "manual",
				signal: controller.signal,
			});
		} catch {
			fail("FETCH_FAILED");
		}

		if (
			!response ||
			!Number.isInteger(response.status) ||
			typeof response.headers?.get !== "function"
		) {
			fail("FETCH_FAILED");
		}
		if (response.status !== 200) fail("HTTP_STATUS");

		const contentType = response.headers.get("content-type") ?? "";
		if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/iu.test(contentType)) {
			fail("HTTP_TYPE");
		}

		const body = await readLimitedBody(response, limits.maxResponseBytes);
		try {
			return JSON.parse(body);
		} catch {
			fail("RESPONSE_JSON");
		}
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Fetch one complete Medusa list endpoint and verify that its pagination
 * metadata exactly accounts for every returned entity.
 */
export async function fetchPaginatedCollection({
	baseUrl,
	collectionKey,
	fetchImpl,
	maxItems = DEFAULT_MAX_ITEMS,
	maxPages = DEFAULT_MAX_PAGES,
	maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
	pageSize = DEFAULT_PAGE_SIZE,
	path,
	publishableKey,
	query = {},
	timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
	if (typeof fetchImpl !== "function") fail("FETCH_UNAVAILABLE");
	requireNonEmptyString(collectionKey, "IDENTITY_INPUT_INVALID");
	requireNonEmptyString(path, "IDENTITY_INPUT_INVALID");
	requireNonEmptyString(publishableKey, "ENV_INVALID");
	const origin = normalizeBaseUrl(baseUrl);

	const limits = {
		maxItems: validatePositiveLimit(maxItems),
		maxPages: validatePositiveLimit(maxPages),
		maxResponseBytes: validatePositiveLimit(maxResponseBytes),
		pageSize: validatePositiveLimit(pageSize),
		timeoutMs: validatePositiveLimit(timeoutMs),
	};
	if (!isRecord(query)) fail("IDENTITY_INPUT_INVALID");
	if (Object.hasOwn(query, "limit") || Object.hasOwn(query, "offset")) {
		fail("IDENTITY_INPUT_INVALID");
	}

	const items = [];
	const seenIds = new Set();
	let expectedCount = null;
	let offset = 0;
	let page = 0;

	for (;;) {
		if (page >= limits.maxPages) fail("LIMIT_EXCEEDED");
		const url = new URL(path, `${origin}/`);
		for (const [key, value] of Object.entries(query)) {
			if (
				typeof value !== "string" ||
				key.length === 0 ||
				/[\0\r\n]/u.test(key) ||
				/[\0\r\n]/u.test(value)
			) {
				fail("IDENTITY_INPUT_INVALID");
			}
			url.searchParams.set(key, value);
		}
		url.searchParams.set("limit", String(limits.pageSize));
		url.searchParams.set("offset", String(offset));

		const payload = requireRecord(
			await fetchJson(url, publishableKey, fetchImpl, limits),
		);
		if (!Array.isArray(payload[collectionKey])) fail("SCHEMA_INVALID");

		const count = requireSafeInteger(payload.count, "PAGINATION_INVALID");
		const responseOffset = requireSafeInteger(
			payload.offset,
			"PAGINATION_INVALID",
		);
		const responseLimit = requireSafeInteger(
			payload.limit,
			"PAGINATION_INVALID",
		);
		if (
			responseOffset !== offset ||
			responseLimit !== limits.pageSize ||
			count > limits.maxItems
		) {
			fail(count > limits.maxItems ? "LIMIT_EXCEEDED" : "PAGINATION_INVALID");
		}
		if (expectedCount === null) expectedCount = count;
		if (count !== expectedCount || offset > count) {
			fail("PAGINATION_INVALID");
		}

		const pageItems = payload[collectionKey];
		const expectedPageLength = Math.min(limits.pageSize, count - offset);
		if (pageItems.length !== expectedPageLength) {
			fail("PAGINATION_INVALID");
		}

		for (const item of pageItems) {
			const record = requireRecord(item);
			const id = requireNonEmptyString(record.id);
			if (seenIds.has(id)) fail("PAGINATION_INVALID");
			seenIds.add(id);
			items.push(record);
		}

		page += 1;
		offset += pageItems.length;
		if (offset === count) break;
		if (pageItems.length === 0) fail("PAGINATION_INVALID");
	}

	if (items.length !== expectedCount) fail("PAGINATION_INVALID");
	return items;
}

/**
 * Read exactly the store data consumed by the static catalog. Products are
 * requested with the first (storefront-default) region so the response
 * contains that region's calculated prices.
 */
export async function fetchStoreSnapshot({
	baseUrl,
	fetchImpl = globalThis.fetch,
	maxItems = DEFAULT_MAX_ITEMS,
	maxPages = DEFAULT_MAX_PAGES,
	maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
	pageSize = DEFAULT_PAGE_SIZE,
	publishableKey,
	timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
	const pagination = {
		baseUrl,
		fetchImpl,
		maxItems,
		maxPages,
		maxResponseBytes,
		pageSize,
		publishableKey,
		timeoutMs,
	};

	const regions = await fetchPaginatedCollection({
		...pagination,
		collectionKey: "regions",
		path: "/store/regions",
		query: { fields: REGION_FIELDS },
	});
	if (regions.length === 0) fail("SCHEMA_INVALID");
	const defaultRegionId = requireNonEmptyString(regions[0].id);

	const categories = await fetchPaginatedCollection({
		...pagination,
		collectionKey: "product_categories",
		path: "/store/product-categories",
		query: { fields: CATEGORY_FIELDS },
	});
	const products = await fetchPaginatedCollection({
		...pagination,
		collectionKey: "products",
		path: "/store/products",
		query: {
			fields: PRODUCT_FIELDS,
			region_id: defaultRegionId,
		},
	});

	return canonicalizeStoreSnapshot({
		categories,
		defaultRegionId,
		products,
		regions,
	});
}

/** Fetch the Medusa snapshot and return its deterministic SHA-256 identity. */
export async function computeBuildIdentity({
	environment = process.env,
	fetchImpl = globalThis.fetch,
	maxItems = DEFAULT_MAX_ITEMS,
	maxPages = DEFAULT_MAX_PAGES,
	maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
	pageSize = DEFAULT_PAGE_SIZE,
	timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
	const publicEnvironment =
		canonicalizePublicBuildEnvironment(environment);
	const snapshot = await fetchStoreSnapshot({
		baseUrl: publicEnvironment.PUBLIC_MEDUSA_BACKEND_URL,
		fetchImpl,
		maxItems,
		maxPages,
		maxResponseBytes,
		pageSize,
		publishableKey: publicEnvironment.PUBLIC_MEDUSA_PUBLISHABLE_KEY,
		timeoutMs,
	});
	return hashBuildIdentity(environment, snapshot);
}

function snapshotDocument(snapshot) {
	const store = canonicalizeStoreSnapshot(snapshot);
	return {
		schema_version: SNAPSHOT_SCHEMA_VERSION,
		...store,
	};
}

async function writeSnapshotFile(snapshotPath, snapshot) {
	if (
		typeof snapshotPath !== "string" ||
		snapshotPath.length === 0 ||
		snapshotPath.length > 4096 ||
		/[\0\r\n]/u.test(snapshotPath)
	) {
		fail("SNAPSHOT_INVALID");
	}
	const temporary = `${snapshotPath}.tmp-${process.pid}`;
	let handle;
	try {
		handle = await open(temporary, "wx", 0o600);
		await handle.writeFile(
			`${stableStringify(snapshotDocument(snapshot))}\n`,
			"utf8",
		);
		await handle.sync();
		await handle.close();
		handle = undefined;
		await rename(temporary, snapshotPath);
	} catch {
		if (handle) await handle.close().catch(() => {});
		await rm(temporary, { force: true }).catch(() => {});
		fail("SNAPSHOT_INVALID");
	}
}

export async function readBuildSnapshot(snapshotPath) {
	if (
		typeof snapshotPath !== "string" ||
		snapshotPath.length === 0 ||
		snapshotPath.length > 4096 ||
		/[\0\r\n]/u.test(snapshotPath)
	) {
		fail("SNAPSHOT_INVALID");
	}

	let stats;
	let bytes;
	try {
		stats = await lstat(snapshotPath);
		if (
			!stats.isFile() ||
			stats.isSymbolicLink() ||
			stats.size <= 0 ||
			stats.size > MAX_SNAPSHOT_BYTES
		) {
			fail("SNAPSHOT_INVALID");
		}
		bytes = await readFile(snapshotPath);
	} catch (error) {
		if (error instanceof BuildIdentityError) throw error;
		fail("SNAPSHOT_INVALID");
	}

	let document;
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		document = JSON.parse(text);
	} catch {
		fail("SNAPSHOT_INVALID");
	}
	const record = requireRecord(document, "SNAPSHOT_INVALID");
	if (record.schema_version !== SNAPSHOT_SCHEMA_VERSION) {
		fail("SNAPSHOT_INVALID");
	}
	const allowedKeys = new Set([
		"schema_version",
		"default_region_id",
		"regions",
		"categories",
		"products",
	]);
	for (const key of Object.keys(record)) {
		if (!allowedKeys.has(key)) fail("SNAPSHOT_INVALID");
	}
	return canonicalizeStoreSnapshot(record);
}

export async function captureBuildIdentity({
	environment = process.env,
	fetchImpl = globalThis.fetch,
	snapshotPath,
} = {}) {
	const publicEnvironment =
		canonicalizePublicBuildEnvironment(environment);
	const snapshot = await fetchStoreSnapshot({
		baseUrl: publicEnvironment.PUBLIC_MEDUSA_BACKEND_URL,
		fetchImpl,
		publishableKey: publicEnvironment.PUBLIC_MEDUSA_PUBLISHABLE_KEY,
	});
	await writeSnapshotFile(snapshotPath, snapshot);
	return hashBuildIdentity(environment, snapshot);
}

export async function computeBuildIdentityFromSnapshot({
	environment = process.env,
	snapshotPath,
} = {}) {
	const snapshot = await readBuildSnapshot(snapshotPath);
	return hashBuildIdentity(environment, snapshot);
}

function isMainModule() {
	if (!process.argv[1]) return false;
	try {
		return fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));
	} catch {
		return false;
	}
}

if (isMainModule()) {
	const mode = process.argv[2] ?? "";
	const snapshotPath = process.argv[3];
	const validSnapshotMode =
		(mode === "--capture-snapshot" || mode === "--from-snapshot") &&
		process.argv.length === 4;
	if (process.argv.length !== 2 && !validSnapshotMode) {
		process.stderr.write("Build identity failed (CLI_USAGE).\n");
		process.exitCode = 1;
	} else {
		try {
			let identity;
			if (mode === "--capture-snapshot") {
				identity = await captureBuildIdentity({ snapshotPath });
			} else if (mode === "--from-snapshot") {
				identity = await computeBuildIdentityFromSnapshot({
					snapshotPath,
				});
			} else {
				identity = await computeBuildIdentity();
			}
			process.stdout.write(`${identity}\n`);
		} catch (error) {
			const code =
				error instanceof BuildIdentityError &&
				Object.hasOwn(SAFE_ERROR_MESSAGES, error.code)
					? error.code
					: "UNEXPECTED";
			process.stderr.write(`Build identity failed (${code}).\n`);
			process.exitCode = 1;
		}
	}
}
