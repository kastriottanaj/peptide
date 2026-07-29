import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
	BuildIdentityError,
	canonicalizeCategories,
	canonicalizeJson,
	canonicalizeProducts,
	canonicalizePublicBuildEnvironment,
	canonicalizeRegions,
	canonicalizeStoreSnapshot,
	captureBuildIdentity,
	computeBuildIdentity,
	computeBuildIdentityFromSnapshot,
	fetchPaginatedCollection,
	fetchStoreSnapshot,
	hashBuildIdentity,
	stableStringify,
} from "../build-identity.mjs";

const SECRET_MARKER = "pk_secret-marker-must-never-appear";

function environment(overrides = {}) {
	return {
		PUBLIC_BANK_ACCOUNT_HOLDER: "Example Research GmbH",
		PUBLIC_BANK_BIC: "TESTDEFFXXX",
		PUBLIC_BANK_IBAN: "DE001234",
		PUBLIC_BANK_NAME: "Example Bank",
		PUBLIC_GA_MEASUREMENT_ID: "",
		PUBLIC_GOOGLE_SITE_VERIFICATION: "",
		PUBLIC_MEDUSA_BACKEND_URL: "https://store.example.test",
		PUBLIC_MEDUSA_PUBLISHABLE_KEY: SECRET_MARKER,
		PUBLIC_SITE_URL: "https://shop.example.test",
		PEPTIDES_BUILD_LIBC_VERSION: "glibc 2.39",
		PEPTIDES_BUILD_NODE_VERSION: "v22.20.0",
		PEPTIDES_BUILD_NPM_VERSION: "11.6.2",
		PEPTIDES_BUILD_PLATFORM: "linux-x86_64",
		...overrides,
	};
}

function storeData() {
	return {
		categories: [
			{
				description: "Reference compounds",
				handle: "reference",
				id: "pcat_b",
				name: "Reference",
			},
			{
				description: null,
				handle: "peptides",
				id: "pcat_a",
				name: "Peptides",
			},
			{
				description: "Laboratory supplies",
				handle: "supplies",
				id: "pcat_c",
				name: "Supplies",
			},
		],
		products: [
			{
				categories: [{ id: "pcat_b", name: "Reference" }],
				description: "Second product",
				handle: "product-b",
				id: "prod_b",
				metadata: { purity: "99%", research_code: "B-2" },
				thumbnail: null,
				title: "Product B",
				updated_at: "2026-07-20T12:00:00.000Z",
				variants: [
					{
						calculated_price: {
							calculated_amount: 2450,
							currency_code: "eur",
						},
						id: "variant_b1",
						options: [{ id: "opt_b1", value: "10 mg" }],
						title: "10 mg",
					},
				],
			},
			{
				categories: [{ id: "pcat_a", name: "Peptides" }],
				description: "First product",
				handle: "product-a",
				id: "prod_a",
				metadata: { purity: "98%", research_code: "A-1" },
				thumbnail: "/static/a.webp",
				title: "Product A",
				updated_at: "2026-07-19T12:00:00.000Z",
				variants: [
					{
						calculated_price: {
							calculated_amount: 1250,
							currency_code: "eur",
						},
						id: "variant_a1",
						options: [{ id: "opt_a1", value: "5 mg" }],
						title: "5 mg",
					},
					{
						calculated_price: null,
						id: "variant_a2",
						options: [{ id: "opt_a2", value: "10 mg" }],
						title: "10 mg",
					},
				],
			},
			{
				categories: [],
				description: null,
				handle: "product-c",
				id: "prod_c",
				metadata: {},
				thumbnail: null,
				title: "Product C",
				updated_at: "2026-07-18T12:00:00.000Z",
				variants: [],
			},
		],
		regions: [
			{
				countries: [{ display_name: "Germany", iso_2: "de" }],
				currency_code: "eur",
				id: "reg_eu",
				name: "Europe",
			},
			{
				countries: [{ display_name: "United States", iso_2: "us" }],
				currency_code: "usd",
				id: "reg_us",
				name: "United States",
			},
			{
				countries: [],
				currency_code: "gbp",
				id: "reg_uk",
				name: "United Kingdom",
			},
		],
	};
}

function snapshot(overrides = {}) {
	const data = storeData();
	return {
		categories: data.categories,
		defaultRegionId: "reg_eu",
		products: data.products,
		regions: data.regions,
		...overrides,
	};
}

function jsonResponse(payload, init = {}) {
	return new Response(
		typeof payload === "string" ? payload : JSON.stringify(payload),
		{
			headers: {
				"content-type": "application/json; charset=utf-8",
				...(init.headers ?? {}),
			},
			status: init.status ?? 200,
		},
	);
}

function collectionForPath(pathname, data) {
	switch (pathname) {
		case "/store/regions":
			return { items: data.regions, key: "regions" };
		case "/store/product-categories":
			return {
				items: data.categories,
				key: "product_categories",
			};
		case "/store/products":
			return { items: data.products, key: "products" };
		default:
			throw new Error("unexpected fixture route");
	}
}

function storeFetch(data, hook) {
	const calls = [];
	const fetchImpl = async (input, init) => {
		const url = new URL(input);
		const { items, key } = collectionForPath(url.pathname, data);
		const offset = Number(url.searchParams.get("offset"));
		const limit = Number(url.searchParams.get("limit"));
		const call = { init, key, limit, offset, url };
		calls.push(call);

		const defaultPayload = {
			[key]: items.slice(offset, offset + limit),
			count: items.length,
			limit,
			offset,
		};
		const replacement = await hook?.(call, defaultPayload);
		if (replacement instanceof Response) return replacement;
		return jsonResponse(replacement ?? defaultPayload);
	};
	return { calls, fetchImpl };
}

function expectCode(code, forbidden = []) {
	return (error) => {
		assert.ok(error instanceof BuildIdentityError);
		assert.equal(error.code, code);
		for (const value of forbidden) {
			assert.doesNotMatch(String(error), new RegExp(value, "u"));
		}
		return true;
	};
}

test("canonical JSON is key-order stable and entity collections preserve response order", () => {
	const left = {
		z: [{ b: 2, a: 1 }],
		a: { y: true, x: null },
	};
	const right = {
		a: { x: null, y: true },
		z: [{ a: 1, b: 2 }],
	};
	assert.equal(stableStringify(left), stableStringify(right));
	assert.deepEqual(canonicalizeJson(left), canonicalizeJson(right));

	const data = storeData();
	assert.notDeepEqual(
		canonicalizeRegions([...data.regions].reverse()),
		canonicalizeRegions(data.regions),
	);
	assert.notDeepEqual(
		canonicalizeCategories([...data.categories].reverse()),
		canonicalizeCategories(data.categories),
	);
	assert.notDeepEqual(
		canonicalizeProducts([...data.products].reverse()),
		canonicalizeProducts(data.products),
	);
});

test("identity changes with response order and every material input", () => {
	const original = snapshot();
	const reordered = {
		categories: [...original.categories].reverse().map((category) => ({
			name: category.name,
			id: category.id,
			description: category.description,
			handle: category.handle,
		})),
		defaultRegionId: original.defaultRegionId,
		products: [...original.products].reverse(),
		regions: [...original.regions].reverse(),
	};

	const first = hashBuildIdentity(environment(), original);
	const second = hashBuildIdentity(environment(), reordered);
	assert.match(first, /^[a-f0-9]{64}$/u);
	assert.notEqual(second, first);

	const changedPrice = structuredClone(original);
	changedPrice.products[0].variants[0].calculated_price.calculated_amount += 1;
	assert.notEqual(hashBuildIdentity(environment(), changedPrice), first);
	const changedUpdatedAt = structuredClone(original);
	changedUpdatedAt.products[0].updated_at =
		"2026-07-21T12:00:00.000Z";
	assert.notEqual(hashBuildIdentity(environment(), changedUpdatedAt), first);
	const changedOption = structuredClone(original);
	changedOption.products[0].variants[0].options[0].value = "20 mg";
	assert.notEqual(hashBuildIdentity(environment(), changedOption), first);
	assert.notEqual(
		hashBuildIdentity(
			environment({ PUBLIC_GA_MEASUREMENT_ID: "G-CHANGED" }),
			original,
		),
		first,
	);
	assert.notEqual(
		hashBuildIdentity(
			environment({ PEPTIDES_BUILD_NODE_VERSION: "v22.21.0" }),
			original,
		),
		first,
	);
	assert.notEqual(
		hashBuildIdentity(environment(), {
			...original,
			defaultRegionId: "reg_us",
		}),
		first,
	);
});

test("identity algorithm is pinned to a versioned SHA-256 fixture", () => {
	const identity = hashBuildIdentity(
		{
			PUBLIC_MEDUSA_BACKEND_URL: "https://api.example",
			PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk",
			PUBLIC_SITE_URL: "https://site.example",
		},
		{
			categories: [],
			defaultRegionId: "r",
			products: [
					{
						categories: [],
						handle: "p",
					id: "p",
					title: "P",
					variants: [
						{
							calculated_price: {
								calculated_amount: 100,
								currency_code: "eur",
							},
							id: "v",
						},
					],
				},
			],
			regions: [
				{
					currency_code: "eur",
					id: "r",
					name: "R",
				},
			],
		},
	);
	assert.equal(
		identity,
		"c1f60eaf2688ed3ab56ffe5c052e1f51a42ef9a4b60f240dbb6e59130f9f9dc2",
	);
});

test("public environment is complete, fixed-keyed, and rejects hidden new inputs", () => {
	const canonical = canonicalizePublicBuildEnvironment({
		PUBLIC_MEDUSA_BACKEND_URL: "https://store.example.test",
		PUBLIC_MEDUSA_PUBLISHABLE_KEY: SECRET_MARKER,
		PUBLIC_SITE_URL: "https://shop.example.test",
	});
	assert.deepEqual(Object.keys(canonical), [
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
	assert.equal(canonical.PUBLIC_BANK_IBAN, "");

	assert.throws(
		() =>
			canonicalizePublicBuildEnvironment({
				...environment(),
				PUBLIC_UNTRACKED_BUILD_INPUT: "would-change-output",
			}),
		expectCode("ENV_INVALID", ["would-change-output", SECRET_MARKER]),
	);
	assert.throws(
		() =>
			canonicalizePublicBuildEnvironment(
				environment({ PUBLIC_MEDUSA_PUBLISHABLE_KEY: "" }),
			),
		expectCode("ENV_INVALID", [SECRET_MARKER]),
	);
});

test("fetches every page and scopes calculated product prices to the default region", async () => {
	const data = storeData();
	const fixture = storeFetch(data);
	const fetched = await fetchStoreSnapshot({
		baseUrl: environment().PUBLIC_MEDUSA_BACKEND_URL,
		fetchImpl: fixture.fetchImpl,
		pageSize: 2,
		publishableKey: SECRET_MARKER,
	});

	assert.deepEqual(fetched, canonicalizeStoreSnapshot(snapshot()));
	assert.equal(fixture.calls.length, 6);
	for (const call of fixture.calls) {
		assert.equal(call.init.method, "GET");
		assert.equal(call.init.redirect, "manual");
		assert.equal(
			new Headers(call.init.headers).get("x-publishable-api-key"),
			SECRET_MARKER,
		);
		assert.doesNotMatch(call.url.href, new RegExp(SECRET_MARKER, "u"));
		assert.equal(call.limit, 2);
	}

	const productCalls = fixture.calls.filter((call) => call.key === "products");
	assert.ok(productCalls.length > 0);
	for (const call of productCalls) {
		assert.equal(call.url.searchParams.get("region_id"), "reg_eu");
		const fields = call.url.searchParams.get("fields") ?? "";
		assert.match(fields, /updated_at/u);
		assert.match(fields, /\+variants\.inventory_quantity/u);
		assert.match(fields, /variants\.options/u);
		assert.match(fields, /variants\.calculated_price/u);
	}
});

test("end-to-end computation matches the pure identity function", async () => {
	const fixture = storeFetch(storeData());
	const identity = await computeBuildIdentity({
		environment: environment(),
		fetchImpl: fixture.fetchImpl,
		pageSize: 2,
	});
	assert.equal(identity, hashBuildIdentity(environment(), snapshot()));
});

test("captured catalog snapshot is the single immutable identity input", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "peptides-catalog-snapshot-"));
	const snapshotPath = join(temporary, "catalog.json");
	try {
		const fixture = storeFetch(storeData());
		const captured = await captureBuildIdentity({
			environment: environment(),
			fetchImpl: fixture.fetchImpl,
			snapshotPath,
		});
		const replayed = await computeBuildIdentityFromSnapshot({
			environment: environment(),
			snapshotPath,
		});
		assert.equal(replayed, captured);
		const body = await readFile(snapshotPath, "utf8");
		assert.doesNotMatch(body, new RegExp(SECRET_MARKER, "u"));

		const document = JSON.parse(body);
		document.untracked = true;
		await writeFile(snapshotPath, JSON.stringify(document), "utf8");
		await assert.rejects(
			computeBuildIdentityFromSnapshot({
				environment: environment(),
				snapshotPath,
			}),
			expectCode("SNAPSHOT_INVALID", [SECRET_MARKER]),
		);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("fails closed on HTTP, media type, JSON, and response-size errors without leaking inputs", async (t) => {
	const cases = [
		{
			code: "HTTP_STATUS",
			response: jsonResponse(`server echoed ${SECRET_MARKER}`, { status: 503 }),
		},
		{
			code: "HTTP_TYPE",
			response: new Response(`server echoed ${SECRET_MARKER}`, {
				headers: { "content-type": "text/plain" },
				status: 200,
			}),
		},
		{
			code: "RESPONSE_JSON",
			response: jsonResponse(`{ invalid ${SECRET_MARKER}`),
		},
		{
			code: "RESPONSE_TOO_LARGE",
			maxResponseBytes: 8,
			response: jsonResponse(`{"echo":"${SECRET_MARKER}"}`),
		},
	];

	for (const fixtureCase of cases) {
		await t.test(fixtureCase.code, async () => {
			await assert.rejects(
				fetchPaginatedCollection({
					baseUrl: "https://store.example.test",
					collectionKey: "products",
					fetchImpl: async () => fixtureCase.response,
					maxResponseBytes:
						fixtureCase.maxResponseBytes ?? 1024,
					path: "/store/products",
					publishableKey: SECRET_MARKER,
				}),
				expectCode(fixtureCase.code, [SECRET_MARKER, "server echoed"]),
			);
		});
	}

	await t.test("network exception", async () => {
		await assert.rejects(
			fetchPaginatedCollection({
				baseUrl: "https://store.example.test",
				collectionKey: "products",
				fetchImpl: async () => {
					throw new Error(`transport included ${SECRET_MARKER}`);
				},
				path: "/store/products",
				publishableKey: SECRET_MARKER,
			}),
			expectCode("FETCH_FAILED", [SECRET_MARKER, "transport included"]),
		);
	});
});

test("request timeout remains armed while the response body is streaming", async () => {
	await assert.rejects(
		fetchPaginatedCollection({
			baseUrl: "https://store.example.test",
			collectionKey: "products",
			fetchImpl: async (_input, init) =>
				new Response(
					new ReadableStream({
						start(controller) {
							init.signal.addEventListener(
								"abort",
								() => controller.error(new Error("aborted")),
								{ once: true },
							);
						},
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					},
				),
			path: "/store/products",
			publishableKey: SECRET_MARKER,
			timeoutMs: 5,
		}),
		expectCode("FETCH_FAILED", [SECRET_MARKER]),
	);
});

test("fails closed on pagination truncation, drift, duplicates, and configured limits", async (t) => {
	const data = storeData();
	const cases = [
		{
			code: "PAGINATION_INVALID",
			name: "truncated page",
			hook(call, payload) {
				if (call.offset === 0) payload[call.key] = payload[call.key].slice(0, 1);
				return payload;
			},
		},
		{
			code: "PAGINATION_INVALID",
			name: "count drift",
			hook(call, payload) {
				if (call.offset > 0) payload.count += 1;
				return payload;
			},
		},
		{
			code: "PAGINATION_INVALID",
			name: "server limit mismatch",
			hook(_call, payload) {
				payload.limit -= 1;
				return payload;
			},
		},
		{
			code: "PAGINATION_INVALID",
			name: "duplicate entity across pages",
			hook(call, payload) {
				if (call.offset > 0) {
					payload[call.key][0] = data.products[0];
				}
				return payload;
			},
		},
	];

	for (const fixtureCase of cases) {
		await t.test(fixtureCase.name, async () => {
			const fixture = storeFetch(
				{ ...data, categories: [], regions: [], products: data.products },
				fixtureCase.hook,
			);
			await assert.rejects(
				fetchPaginatedCollection({
					baseUrl: "https://store.example.test",
					collectionKey: "products",
					fetchImpl: fixture.fetchImpl,
					pageSize: 2,
					path: "/store/products",
					publishableKey: SECRET_MARKER,
				}),
				expectCode(fixtureCase.code, [SECRET_MARKER]),
			);
		});
	}

	await t.test("maximum item count", async () => {
		const fixture = storeFetch(data);
		await assert.rejects(
			fetchPaginatedCollection({
				baseUrl: "https://store.example.test",
				collectionKey: "products",
				fetchImpl: fixture.fetchImpl,
				maxItems: 2,
				pageSize: 2,
				path: "/store/products",
				publishableKey: SECRET_MARKER,
			}),
			expectCode("LIMIT_EXCEEDED", [SECRET_MARKER]),
		);
	});

	await t.test("maximum page count", async () => {
		const fixture = storeFetch(data);
		await assert.rejects(
			fetchPaginatedCollection({
				baseUrl: "https://store.example.test",
				collectionKey: "products",
				fetchImpl: fixture.fetchImpl,
				maxPages: 1,
				pageSize: 2,
				path: "/store/products",
				publishableKey: SECRET_MARKER,
			}),
			expectCode("LIMIT_EXCEEDED", [SECRET_MARKER]),
		);
	});
});

test("fails schema validation when calculated-price expansion is absent or malformed", () => {
	const missing = structuredClone(storeData().products);
	delete missing[0].variants[0].calculated_price;
	assert.throws(
		() => canonicalizeProducts(missing),
		expectCode("SCHEMA_INVALID", [SECRET_MARKER]),
	);

	const malformed = structuredClone(storeData().products);
	malformed[0].variants[0].calculated_price.calculated_amount = "2450";
	assert.throws(
		() => canonicalizeProducts(malformed),
		expectCode("SCHEMA_INVALID", [SECRET_MARKER]),
	);

	const duplicate = structuredClone(storeData().products);
	duplicate.push(structuredClone(duplicate[0]));
	assert.throws(
		() => canonicalizeProducts(duplicate),
		expectCode("SCHEMA_INVALID", [SECRET_MARKER]),
	);
});

test("CLI failure output contains only a safe code, never arguments or environment values", () => {
	const script = fileURLToPath(new URL("../build-identity.mjs", import.meta.url));
	const result = spawnSync(process.execPath, [script, SECRET_MARKER], {
		encoding: "utf8",
		env: {
			...process.env,
			...environment({
				PUBLIC_MEDUSA_BACKEND_URL: `invalid-${SECRET_MARKER}`,
			}),
		},
		timeout: 5_000,
	});

	assert.equal(result.status, 1);
	assert.equal(result.stdout, "");
	assert.equal(result.stderr, "Build identity failed (CLI_USAGE).\n");
	assert.doesNotMatch(result.stderr, new RegExp(SECRET_MARKER, "u"));
	assert.doesNotMatch(result.stderr, /invalid-/u);
});
