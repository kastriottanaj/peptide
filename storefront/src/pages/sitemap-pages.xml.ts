import type { APIRoute } from "astro";
import { renderUrlset, xmlResponse } from "../lib/sitemap";
import {
	categoryEntries,
	coaCheckerEntries,
	staticEntries,
	toSitemapUrl,
} from "../lib/content-index";
import { buildDate } from "../lib/build-time";

/**
 * Static routes, the category landing pages, and `/coa-pruefen/` when it is
 * indexable. The COA checker is absent while no analysis document is linked —
 * the same predicate that makes the page `noindex, follow` withholds it here, so
 * the sitemap never advertises a page that asks not to be indexed.
 */
export const GET: APIRoute = async () => {
	const lastModified = buildDate();
	const [categories, coaChecker] = await Promise.all([
		categoryEntries(lastModified),
		coaCheckerEntries(lastModified),
	]);

	return xmlResponse(
		renderUrlset(
			[...staticEntries(lastModified), ...coaChecker, ...categories].map(toSitemapUrl),
		),
	);
};
