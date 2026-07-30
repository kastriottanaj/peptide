import type { APIRoute } from "astro";
import { renderUrlset, xmlResponse } from "../lib/sitemap";
import { articleEntries, toSitemapUrl, wissenIndexEntries } from "../lib/content-index";

/**
 * The Wissen articles and their index page. The Lexikon has a sitemap of its
 * own: the two grow at different rates and answer different queries, so keeping
 * them apart makes indexing coverage readable per section in Search Console.
 *
 * `lastmod` comes from each entry's own `dateModified`, so it reflects real
 * edits rather than build time.
 */
export const GET: APIRoute = async () => {
	const articles = await articleEntries();

	return xmlResponse(
		renderUrlset([...wissenIndexEntries(articles), ...articles].map(toSitemapUrl)),
	);
};
