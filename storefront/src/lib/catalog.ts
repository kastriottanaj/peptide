import type { HttpTypes } from "@medusajs/types";
import { medusa, getDefaultRegionId } from "./medusa";

/**
 * Catalog reads shared by the listing and the category pages, so the two cannot
 * drift in which fields they request or how they sort.
 */

const PRODUCT_FIELDS =
	"id,title,handle,description,thumbnail,metadata,*variants,*variants.calculated_price,*categories";

export type CatalogProduct = HttpTypes.StoreProduct;
export type CatalogCategory = HttpTypes.StoreProductCategory;

/** Products carrying a research_code are the real peptides; show them first. */
function isPeptide(product: CatalogProduct): boolean {
	return (
		typeof (product.metadata as Record<string, unknown> | null)
			?.research_code === "string"
	);
}

export function sortPeptidesFirst(products: CatalogProduct[]): CatalogProduct[] {
	return [...products].sort(
		(a, b) => Number(isPeptide(b)) - Number(isPeptide(a)),
	);
}

export async function listProducts(
	params: { categoryId?: string; limit?: number } = {},
): Promise<CatalogProduct[]> {
	const regionId = await getDefaultRegionId();
	const { products } = await medusa.store.product.list({
		region_id: regionId,
		fields: PRODUCT_FIELDS,
		limit: params.limit ?? 100,
		...(params.categoryId ? { category_id: [params.categoryId] } : {}),
	});
	return sortPeptidesFirst(products);
}

export async function listCategories(): Promise<CatalogCategory[]> {
	const { product_categories } = await medusa.store.category.list({
		fields: "id,name,handle,description",
		limit: 50,
	});
	return product_categories.sort((a, b) =>
		(a.name ?? "").localeCompare(b.name ?? "", "de"),
	);
}

/**
 * Free-text match over the fields a customer would plausibly search: product
 * name, research code and description. Done client-side over the already
 * fetched catalog because the store is small and static — no search service
 * needed at this size, and it keeps the page a single build-time fetch.
 */
export function filterProducts(
	products: CatalogProduct[],
	query: string,
): CatalogProduct[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return products;

	return products.filter((product) => {
		const meta = (product.metadata ?? {}) as Record<string, unknown>;
		const haystack = [
			product.title,
			product.description,
			typeof meta.research_code === "string" ? meta.research_code : "",
			...(product.categories ?? []).map((c) => c.name),
		]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();

		// Every whitespace-separated term must appear somewhere.
		return needle.split(/\s+/).every((term) => haystack.includes(term));
	});
}
