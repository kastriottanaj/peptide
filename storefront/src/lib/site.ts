/**
 * Single source of truth for the site origin and brand identity.
 *
 * Every absolute URL in the storefront (canonicals, OpenGraph, JSON-LD,
 * sitemaps) is built through `absoluteUrl()` so there is exactly one place that
 * knows the origin. Never hand-build absolute URLs at call sites.
 *
 * `PUBLIC_SITE_URL` must be set to the real domain in `.env` before launch; the
 * localhost fallback keeps canonicals coherent during local development.
 */

export const SITE_URL = (
	import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321"
).replace(/\/+$/, "");

export const SITE_NAME = "Peptide Kaufen Deutschland";
export const SITE_LOCALE = "de_DE";

/** Stable @id for the Organization node, referenced as seller/publisher. */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;

export function absoluteUrl(path: string): string {
	if (path.startsWith("http://") || path.startsWith("https://")) return path;
	return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Canonical URL for a page: the pathname without query string or trailing
 * slash. Filtered/sorted listing URLs (`/produkte?q=…`) therefore canonicalise
 * to their clean path rather than becoming separate documents.
 */
export function canonicalFrom(url: URL): string {
	const path = url.pathname.replace(/\/+$/, "") || "/";
	return absoluteUrl(path);
}

/** The Organization node, emitted once per page and referenced by @id. */
export function organizationNode() {
	return {
		"@type": "Organization",
		"@id": ORGANIZATION_ID,
		name: SITE_NAME,
		url: SITE_URL,
	};
}

/** Build a BreadcrumbList from [label, path] pairs. */
export function breadcrumbNode(trail: Array<[string, string]>) {
	return {
		"@type": "BreadcrumbList",
		itemListElement: trail.map(([name, path], index) => ({
			"@type": "ListItem",
			position: index + 1,
			name,
			item: absoluteUrl(path),
		})),
	};
}
