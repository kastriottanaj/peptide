import type { APIRoute } from "astro";
import { absoluteUrl } from "../lib/site";
import { renderUrlset, xmlResponse, type SitemapImage } from "../lib/sitemap";
import { medusa, getDefaultRegionId } from "../lib/medusa";

/**
 * Product detail pages, with the image sitemap extension. Titles and captions
 * are built from the product's own attributes so Google Images gets
 * descriptive, consistent German text rather than bare filenames.
 */
export const GET: APIRoute = async () => {
	const regionId = await getDefaultRegionId();
	const { products } = await medusa.store.product.list({
		region_id: regionId,
		fields: "id,title,handle,description,thumbnail,metadata,updated_at",
		limit: 1000,
	});

	const entries = products.map((product) => {
		const meta = (product.metadata ?? {}) as Record<string, unknown>;
		const purity = typeof meta.purity === "string" ? meta.purity : null;

		const caption =
			product.description?.trim() ||
			[product.title, purity ? `${purity} Reinheit` : null]
				.filter(Boolean)
				.join(" – ");

		const images: SitemapImage[] = product.thumbnail
			? [{ loc: absoluteUrl(product.thumbnail), title: product.title, caption }]
			: [];

		return {
			loc: absoluteUrl(`/produkte/${product.handle}`),
			lastModified: product.updated_at ?? new Date(),
			changeFrequency: "weekly" as const,
			priority: 0.9,
			images,
		};
	});

	return xmlResponse(renderUrlset(entries));
};
