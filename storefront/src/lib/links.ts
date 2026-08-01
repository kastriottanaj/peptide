/**
 * Internal link normalisation — the href side of the trailing-slash rule.
 *
 * `canonical.ts` decides what a page's canonical URL looks like. This module
 * applies the same decision to the links the site *points at*, so navigation
 * lands on the URL the canonical names instead of on a redirect to it.
 *
 * ## Why a slashless href is a defect and not a cosmetic detail
 *
 * `astro build` writes every page as `<path>/index.html` and Caddy's
 * `file_server` serves it as a directory index, so `/produkte` answers 308 and
 * only `/produkte/` answers 200. An `<a href="/produkte">` therefore costs every
 * visitor and every crawler an extra round trip, and a crawl reports the link as
 * an internal redirect. The server-side 308 stays — it is what makes external
 * links and old bookmarks work — but nothing this site links to should need it.
 *
 * The trailing-slash decision itself is *not* duplicated here: `canonicalPath`
 * is imported and reused, so the rule for hrefs and the rule for canonicals
 * cannot drift apart. That includes the file-route exemption — `/robots.txt`,
 * `/sitemap.xml` and `/api/search.json` are real files served at their exact
 * path and must never gain a slash.
 *
 * ## What is deliberately left alone
 *
 * Only root-relative paths (`/…`) are normalised. Everything else is returned
 * untouched:
 *
 * - absolute URLs, because the internal ones already come from `canonicalUrl()`
 *   and the external ones are not ours to rewrite;
 * - other schemes (`mailto:`, `tel:`, `data:`, `javascript:`) and
 *   protocol-relative `//host/path`;
 * - hash-only and query-only values, which address the current document;
 * - document-relative paths (`bpc-157`), which cannot be resolved without
 *   knowing the page they sit on. The storefront writes none, and guessing a
 *   base is how a link silently moves to the wrong route.
 *
 * Query string and fragment are carried through verbatim — parameters are never
 * reordered, re-encoded or dropped, because only the pathname is at issue.
 */

// Explicit `.ts` extension: this module is loaded directly by `node --test`,
// which does not do Vite's extensionless resolution. `allowImportingTsExtensions`
// is on in the Astro base tsconfig, and Vite resolves the extension too.
import { canonicalPath } from "./canonical.ts";

/** `mailto:`, `tel:`, `data:`, `javascript:`, `https:` … — anything with a scheme. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The href a link should carry for a site-relative path: same target, but the
 * trailing slash the server actually serves.
 *
 * Idempotent, so it is safe on values that are already correct and safe to apply
 * twice.
 */
export function internalHref(href: string): string {
	// Not a root-relative path — see the module comment for the full list of
	// forms that pass through. `//host/path` is protocol-relative, not a path.
	if (!href.startsWith("/") || href.startsWith("//")) return href;
	if (HAS_SCHEME.test(href)) return href;

	// Split before normalising: `canonicalPath` drops query and fragment, and
	// this module's contract is to preserve them byte for byte.
	const hashAt = href.indexOf("#");
	const hash = hashAt === -1 ? "" : href.slice(hashAt);
	const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);

	const queryAt = beforeHash.indexOf("?");
	const query = queryAt === -1 ? "" : beforeHash.slice(queryAt);
	const pathname = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);

	return `${canonicalPath(pathname)}${query}${hash}`;
}

/**
 * Route builders for the four data-driven route shapes.
 *
 * These exist so a product link is written the same way in all six places that
 * build one, rather than as six copies of a template literal that each have to
 * remember the slash. The slug is interpolated as-is, exactly as
 * `getStaticPaths` receives it, so the href and the generated route agree.
 */
export const productPath = (handle: string): string =>
	internalHref(`/produkte/${handle}`);

export const categoryPath = (handle: string): string =>
	internalHref(`/kategorie/${handle}`);

export const articlePath = (id: string): string => internalHref(`/wissen/${id}`);

export const lexikonPath = (id: string): string =>
	internalHref(`/wissen/lexikon/${id}`);
