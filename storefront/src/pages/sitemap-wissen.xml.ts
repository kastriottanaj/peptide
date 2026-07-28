import type { APIRoute } from "astro";
import { renderUrlset, xmlResponse } from "../lib/sitemap";
import {
	articleEntries,
	termEntries,
	toSitemapUrl,
	wissenIndexEntries,
	type IndexedEntry,
} from "../lib/content-index";

/**
 * Editorial content: articles and lexicon entries. `lastmod` comes from each
 * entry's own `dateModified`, so it reflects real edits rather than build time.
 */
export const GET: APIRoute = async () => {
	const [articles, terms] = await Promise.all([articleEntries(), termEntries()]);

	// The two index pages change exactly when their newest entry does, so they
	// carry that date rather than no `lastmod` at all — an entry without one is
	// the weakest possible crawl signal. They come from the hand-maintained
	// static routes, which have no date of their own to contribute.
	const newest = (entries: IndexedEntry[]) => {
		const times = entries
			.map((entry) => entry.lastModified?.getTime())
			.filter((time): time is number => time !== undefined);
		return times.length ? new Date(Math.max(...times)) : undefined;
	};

	const contributorsFor: Record<string, IndexedEntry[]> = {
		"/wissen": articles,
		"/wissen/lexikon": terms,
	};

	const indexes = wissenIndexEntries().map((entry) => ({
		...entry,
		lastModified: entry.lastModified ?? newest(contributorsFor[entry.path] ?? []),
	}));

	return xmlResponse(
		renderUrlset([...indexes, ...articles, ...terms].map(toSitemapUrl)),
	);
};
