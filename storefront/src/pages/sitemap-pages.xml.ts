import type { APIRoute } from "astro";
import { renderUrlset, xmlResponse } from "../lib/sitemap";
import { categoryEntries, staticEntries, toSitemapUrl } from "../lib/content-index";
import { buildDate } from "../lib/build-time";

/** Static routes plus the category landing pages. */
export const GET: APIRoute = async () => {
	const lastModified = buildDate();

	return xmlResponse(
		renderUrlset(
			[...staticEntries(lastModified), ...(await categoryEntries(lastModified))].map(
				toSitemapUrl,
			),
		),
	);
};
