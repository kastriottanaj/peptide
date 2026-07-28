import type { APIRoute } from "astro";
import { renderUrlset, xmlResponse } from "../lib/sitemap";
import { productEntries, toSitemapUrl } from "../lib/content-index";

/**
 * Product detail pages, with the image sitemap extension. Titles and captions
 * are built from the product's own attributes so Google Images gets
 * descriptive, consistent German text rather than bare filenames.
 */
export const GET: APIRoute = async () => {
	const products = await productEntries();
	return xmlResponse(renderUrlset(products.map(toSitemapUrl)));
};
