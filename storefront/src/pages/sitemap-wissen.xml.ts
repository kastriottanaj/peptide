import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { absoluteUrl } from "../lib/site";
import { renderUrlset, xmlResponse } from "../lib/sitemap";

/**
 * Editorial content: articles and lexicon entries. `lastmod` comes from each
 * entry's own `dateModified`, so it reflects real edits rather than build time.
 */
export const GET: APIRoute = async () => {
	const articles = await getCollection("wissen", ({ data }) => !data.draft);
	const terms = await getCollection("lexikon", ({ data }) => !data.draft);

	// The two index pages change exactly when their newest entry does, so they
	// carry that date rather than no `lastmod` at all — an entry without one is
	// the weakest possible crawl signal.
	const newest = (dates: Date[]) =>
		dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : undefined;

	return xmlResponse(
		renderUrlset([
			{
				loc: absoluteUrl("/wissen"),
				lastModified: newest(articles.map((a) => a.data.dateModified)),
				changeFrequency: "weekly",
				priority: 0.7,
			},
			{
				loc: absoluteUrl("/wissen/lexikon"),
				lastModified: newest(terms.map((t) => t.data.dateModified)),
				changeFrequency: "weekly",
				priority: 0.7,
			},
			...articles.map((article) => ({
				loc: absoluteUrl(`/wissen/${article.id}`),
				lastModified: article.data.dateModified,
				changeFrequency: "monthly" as const,
				priority: 0.6,
			})),
			...terms.map((term) => ({
				loc: absoluteUrl(`/wissen/lexikon/${term.id}`),
				lastModified: term.data.dateModified,
				changeFrequency: "monthly" as const,
				priority: 0.5,
			})),
		]),
	);
};
