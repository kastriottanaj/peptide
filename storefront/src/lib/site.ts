/**
 * Single source of truth for the site origin and brand identity.
 *
 * Every absolute URL in the storefront (canonicals, OpenGraph, JSON-LD,
 * sitemaps) is built here so there is exactly one place that knows the origin.
 * Never hand-build absolute URLs at call sites. Two builders, and the
 * difference matters:
 *
 * - `canonicalUrl()` for **pages** — canonical tags, `og:url`, JSON-LD `url`,
 *   breadcrumb items, sitemap `<loc>`. Normalised per `canonical.ts`, which
 *   includes the trailing slash the server actually serves.
 * - `absoluteUrl()` for **files and assets** — product images, `/sitemap.xml`,
 *   `/llms.txt`. Those are served at their exact path and must not be
 *   slash-normalised.
 *
 * The fallback is the production domain on purpose: if `PUBLIC_SITE_URL` is ever
 * missing in a real build, emitting production URLs is harmless, whereas
 * emitting localhost canonicals into a live site is an SEO disaster. Local
 * development sets `PUBLIC_SITE_URL=http://localhost:4321` in `.env`.
 */

import { PRODUCTION_ORIGIN, buildCanonicalUrl, normalizeOrigin } from "./canonical";
import { CONTACT } from "./company";

export const SITE_URL = normalizeOrigin(
	import.meta.env.PUBLIC_SITE_URL ?? PRODUCTION_ORIGIN,
);

export const SITE_NAME = "Peptide Einkaufen";
export const SITE_LOCALE = "de_DE";

/** Stable @id for the Organization node, referenced as seller/publisher. */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;

/**
 * Absolute URL for a file or asset served at its exact path — product images,
 * `/sitemap.xml`, `/llms.txt`. Pages go through `canonicalUrl()` instead.
 * Values that are already absolute (Medusa image URLs) are passed through.
 */
export function absoluteUrl(path: string): string {
	if (path.startsWith("http://") || path.startsWith("https://")) return path;
	return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Canonical URL for a page, from a path or an `Astro.url`.
 *
 * Query string and fragment are dropped, so filtered/sorted listing URLs
 * (`/produkte?q=…`) canonicalise to their clean path rather than becoming
 * separate documents. The trailing slash is the one the server serves — see
 * `canonical.ts` for why that is load-bearing.
 */
export function canonicalUrl(input: string | URL): string {
	return buildCanonicalUrl(input, SITE_URL);
}

/**
 * The Organization node, emitted once per page and referenced by @id.
 *
 * Contact details belong here and only here — this is the single Organization
 * entity the whole site references, so `/contact/` describes it rather than
 * introducing a second one. Both properties are omitted entirely when no
 * channel is configured: an empty `email` is a worse signal than no email, and
 * there is no address in this repository to fall back to (see `contact.ts`).
 */
export function organizationNode() {
	return {
		"@type": "Organization",
		"@id": ORGANIZATION_ID,
		name: SITE_NAME,
		url: SITE_URL,
		...(CONTACT.email ? { email: CONTACT.email } : {}),
		...(CONTACT.phone ? { telephone: CONTACT.phone } : {}),
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
			item: canonicalUrl(path),
		})),
	};
}
