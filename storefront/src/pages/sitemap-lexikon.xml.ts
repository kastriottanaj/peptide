import type { APIRoute } from "astro";
import { renderUrlset, xmlResponse } from "../lib/sitemap";
import { lexikonIndexEntries, termEntries, toSitemapUrl } from "../lib/content-index";

/**
 * The Lexikon terms and their A–Z index page, split out of the wissen sitemap
 * so the glossary — many short, rarely edited entries — reports its indexing
 * coverage separately from the articles.
 *
 * `lastmod` comes from each term's own `dateModified`, so it reflects real
 * edits rather than build time.
 */
export const GET: APIRoute = async () => {
	const terms = await termEntries();

	return xmlResponse(
		renderUrlset([...lexikonIndexEntries(terms), ...terms].map(toSitemapUrl)),
	);
};
