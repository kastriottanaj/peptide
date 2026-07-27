import type { APIRoute } from "astro";
import { absoluteUrl } from "../lib/site";
import { renderUrlset, staticRoutes, xmlResponse } from "../lib/sitemap";
import { listCategories } from "../lib/catalog";

/** Static routes plus the category landing pages. */
export const GET: APIRoute = async () => {
	const lastModified = new Date();
	const categories = await listCategories();

	return xmlResponse(
		renderUrlset([
			...staticRoutes.map((route) => ({
				loc: absoluteUrl(route.path),
				lastModified,
				changeFrequency: route.changeFrequency,
				priority: route.priority,
			})),
			...categories.map((category) => ({
				loc: absoluteUrl(`/kategorie/${category.handle}`),
				lastModified,
				changeFrequency: "weekly" as const,
				priority: 0.7,
			})),
		]),
	);
};
