import type { APIRoute } from "astro";
import { absoluteUrl, SITE_URL } from "../lib/site";

/**
 * Faceted listing URLs (`/produkte?q=…`) are deliberately NOT disallowed here:
 * they canonicalise to the clean path, and a disallowed URL is never crawled,
 * so a noindex on it would never be seen. One mechanism per URL pattern.
 */
export const GET: APIRoute = () => {
	const body = [
		"User-agent: *",
		"Allow: /",
		"Disallow: /api/",
		"Disallow: /account/",
		"",
		`Sitemap: ${absoluteUrl("/sitemap.xml")}`,
		`Host: ${SITE_URL}`,
		"",
	].join("\n");

	return new Response(body, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
};
