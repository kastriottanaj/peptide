import type { APIRoute } from "astro";
import { renderUrlset, xmlResponse } from "../lib/sitemap";
import { categoryEntries, staticEntries, toSitemapUrl } from "../lib/content-index";

/** Static routes plus the category landing pages. */
export const GET: APIRoute = async () => {
	const lastModified = new Date();

	return xmlResponse(
		renderUrlset(
			[...staticEntries(lastModified), ...(await categoryEntries(lastModified))].map(
				toSitemapUrl,
			),
		),
	);
};
