import type { APIRoute } from "astro";
import { renderUrlset, xmlResponse } from "../lib/sitemap";
import {
	articleEntries,
	termEntries,
	toSitemapUrl,
	wissenIndexEntries,
} from "../lib/content-index";

/**
 * Editorial content: articles and lexicon entries. `lastmod` comes from each
 * entry's own `dateModified`, so it reflects real edits rather than build time.
 */
export const GET: APIRoute = async () => {
	const [articles, terms] = await Promise.all([articleEntries(), termEntries()]);

	return xmlResponse(
		renderUrlset([...wissenIndexEntries(), ...articles, ...terms].map(toSitemapUrl)),
	);
};
