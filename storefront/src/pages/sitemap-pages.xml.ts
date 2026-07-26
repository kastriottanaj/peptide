import type { APIRoute } from "astro";
import { absoluteUrl } from "../lib/site";
import { renderUrlset, staticRoutes, xmlResponse } from "../lib/sitemap";

/** Static routes. */
export const GET: APIRoute = () => {
	const lastModified = new Date();
	return xmlResponse(
		renderUrlset(
			staticRoutes.map((route) => ({
				loc: absoluteUrl(route.path),
				lastModified,
				changeFrequency: route.changeFrequency,
				priority: route.priority,
			})),
		),
	);
};
