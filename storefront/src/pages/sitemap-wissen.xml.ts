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

	return xmlResponse(
		renderUrlset([
			{
				loc: absoluteUrl("/wissen"),
				changeFrequency: "weekly",
				priority: 0.7,
			},
			{
				loc: absoluteUrl("/wissen/lexikon"),
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
