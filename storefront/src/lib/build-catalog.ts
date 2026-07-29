import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { TextDecoder } from "node:util";
import type { HttpTypes } from "@medusajs/types";

const SNAPSHOT_SCHEMA_VERSION = 1;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

type BuildCatalogSnapshot = {
	schema_version: typeof SNAPSHOT_SCHEMA_VERSION;
	default_region_id: string;
	regions: HttpTypes.StoreRegion[];
	categories: HttpTypes.StoreProductCategory[];
	products: HttpTypes.StoreProduct[];
};

let cachedPath: string | undefined;
let cachedSnapshot: Promise<BuildCatalogSnapshot | null> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 16_384 &&
		!value.includes("\0") &&
		!value.includes("\r") &&
		!value.includes("\n")
	);
}

function requireEntityArray(
	value: unknown,
	name: string,
): Array<Record<string, unknown>> {
	if (!Array.isArray(value)) {
		throw new Error(`Invalid build catalog snapshot: ${name}.`);
	}

	const ids = new Set<string>();
	for (const entity of value) {
		if (!isRecord(entity) || !isNonEmptyString(entity.id) || ids.has(entity.id)) {
			throw new Error(`Invalid build catalog snapshot: ${name}.`);
		}
		ids.add(entity.id);
	}
	return value;
}

function validateSnapshot(value: unknown): BuildCatalogSnapshot {
	if (!isRecord(value)) {
		throw new Error("Invalid build catalog snapshot.");
	}

	const allowedKeys = new Set([
		"schema_version",
		"default_region_id",
		"regions",
		"categories",
		"products",
	]);
	if (
		value.schema_version !== SNAPSHOT_SCHEMA_VERSION ||
		!Object.keys(value).every((key) => allowedKeys.has(key)) ||
		!isNonEmptyString(value.default_region_id)
	) {
		throw new Error("Invalid build catalog snapshot.");
	}

	const regions = requireEntityArray(value.regions, "regions");
	requireEntityArray(value.categories, "categories");
	const products = requireEntityArray(value.products, "products");
	if (!regions.some((region) => region.id === value.default_region_id)) {
		throw new Error("Invalid build catalog snapshot: default region.");
	}
	for (const product of products) {
		if (!Array.isArray(product.variants) || !Array.isArray(product.categories)) {
			throw new Error("Invalid build catalog snapshot: products.");
		}
	}

	return value as unknown as BuildCatalogSnapshot;
}

async function readSnapshot(path: string): Promise<BuildCatalogSnapshot> {
	if (
		path.length === 0 ||
		path.length > 4096 ||
		path.includes("\0") ||
		path.includes("\r") ||
		path.includes("\n")
	) {
		throw new Error("Invalid build catalog snapshot path.");
	}

	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		const before = await handle.stat();
		if (
			!before.isFile() ||
			before.size <= 0 ||
			before.size > MAX_SNAPSHOT_BYTES
		) {
			throw new Error("Invalid build catalog snapshot file.");
		}

		const bytes = await handle.readFile();
		const after = await handle.stat();
		if (
			bytes.byteLength !== before.size ||
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs
		) {
			throw new Error("Build catalog snapshot changed while it was read.");
		}
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return validateSnapshot(JSON.parse(text) as unknown);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Invalid build catalog")) {
			throw error;
		}
		if (
			error instanceof Error &&
			error.message === "Build catalog snapshot changed while it was read."
		) {
			throw error;
		}
		throw new Error("Unable to read the build catalog snapshot.", {
			cause: error,
		});
	} finally {
		await handle?.close();
	}
}

async function loadSnapshot(): Promise<BuildCatalogSnapshot | null> {
	const path = process.env.MEDUSA_BUILD_SNAPSHOT_FILE;
	const required = process.env.MEDUSA_BUILD_SNAPSHOT_REQUIRED === "1";
	if (!path) {
		if (required) {
			throw new Error("A build catalog snapshot is required.");
		}
		return null;
	}

	if (cachedPath !== path || !cachedSnapshot) {
		cachedPath = path;
		cachedSnapshot = readSnapshot(path);
	}
	return cachedSnapshot;
}

export async function snapshotRegions(): Promise<
	HttpTypes.StoreRegion[] | null
> {
	const snapshot = await loadSnapshot();
	return snapshot ? [...snapshot.regions] : null;
}

export async function snapshotCategories(): Promise<
	HttpTypes.StoreProductCategory[] | null
> {
	const snapshot = await loadSnapshot();
	return snapshot ? [...snapshot.categories] : null;
}

export async function snapshotProducts(
	params: { categoryId?: string; limit?: number } = {},
): Promise<HttpTypes.StoreProduct[] | null> {
	const snapshot = await loadSnapshot();
	if (!snapshot) return null;

	const limit = params.limit ?? snapshot.products.length;
	if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10_000) {
		throw new Error("Invalid build catalog product limit.");
	}

	const products = params.categoryId
		? snapshot.products.filter((product) =>
				(product.categories ?? []).some(
					(category) => category.id === params.categoryId,
				),
			)
		: snapshot.products;
	return products.slice(0, limit);
}
