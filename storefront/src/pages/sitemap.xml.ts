import type { APIRoute } from "astro";
import { absoluteUrl } from "../lib/site";
import { renderSitemapIndex, xmlResponse } from "../lib/sitemap";
import { buildDate } from "../lib/build-time";

/** Sitemap index — points at the per-type sitemaps. */
export const GET: APIRoute = () => {
	const lastModified = buildDate();
	return xmlResponse(
		renderSitemapIndex([
			{ loc: absoluteUrl("/sitemap-pages.xml"), lastModified },
			{ loc: absoluteUrl("/sitemap-products.xml"), lastModified },
			{ loc: absoluteUrl("/sitemap-wissen.xml"), lastModified },
			{ loc: absoluteUrl("/sitemap-lexikon.xml"), lastModified },
		]),
	);
};
