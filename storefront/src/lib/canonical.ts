/**
 * Canonical URL normalisation.
 *
 * The one place that decides what a page's canonical URL looks like. Kept free
 * of Astro and Vite imports (no `import.meta.env`) so it is directly unit
 * testable with `node --test`; `site.ts` is the adapter that supplies the
 * configured origin.
 *
 * ## Why the trailing slash is not cosmetic
 *
 * `astro build` uses the `directory` format: every page is written as
 * `<path>/index.html`, and Caddy's `file_server` serves it as a directory
 * index. Requesting the same path *without* the trailing slash gets a 308 to
 * the slashed form — that is the file server's own normalisation, not a rule in
 * this repo. So `https://peptideeinkaufen.de/produkte/` is the only URL of that
 * page that answers 200; `/produkte` is a redirect to it.
 *
 * Emitting `/produkte` as the canonical of `/produkte/` therefore produced two
 * findings at once in a crawl: the page is "canonicalised" (it names a URL
 * other than itself) and the named URL is a redirect, i.e. a "non-indexable
 * canonical". Both are fixed by canonicalising to the URL that actually
 * returns 200.
 *
 * File routes (`/sitemap.xml`, `/llms.txt`) are real files and are served at
 * their exact path, so they must NOT gain a trailing slash — see
 * `hasFileExtension`.
 */

/**
 * The production origin, and the fallback used when `PUBLIC_SITE_URL` is
 * missing or unparseable. Lives here rather than in `site.ts` so tests can
 * assert the real production hostname without pulling in Vite's env.
 */
export const PRODUCTION_ORIGIN = "https://peptideeinkaufen.de";

/** Hosts that legitimately speak plain HTTP: local dev and preview servers. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Reduce a configured site URL to a bare origin, fixing the variants that would
 * otherwise show up in canonicals as a redirect or a cross-host reference:
 *
 * - a path, query or fragment on the configured value is dropped;
 * - `http://` is upgraded to `https://` for anything but a loopback host,
 *   because production is HTTPS-only (HSTS) and an `http://` canonical names a
 *   URL that redirects;
 * - a leading `www.` is dropped, because Caddy redirects `www` to the apex.
 *
 * An unparseable value falls back to production. That direction is deliberate,
 * for the reason given in `site.ts`: production URLs in a local build are
 * harmless, localhost URLs in a live build are not.
 */
export function normalizeOrigin(value: string): string {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return PRODUCTION_ORIGIN;
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") return PRODUCTION_ORIGIN;
	if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) url.protocol = "https:";
	if (url.hostname.startsWith("www.")) url.hostname = url.hostname.slice(4);

	return url.origin;
}

/** Does the last path segment look like a file (`/sitemap.xml`, `/llms.txt`)? */
function hasFileExtension(pathname: string): boolean {
	const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
	return /\.[a-z0-9]+$/i.test(lastSegment);
}

/**
 * Split the pathname out of whatever a call site passed in, letting the URL
 * parser do it rather than a hand-rolled regex.
 *
 * A full URL's host is discarded on purpose: the canonical host is a decision
 * this module owns, so a stray absolute URL cannot put a different host in a
 * canonical.
 *
 * Anything that is not an `Astro.url` or an explicit `http(s)://` URL is
 * treated as a site-relative path, with leading slashes collapsed *before*
 * parsing. Otherwise `new URL("//produkte/bpc-157", …)` reads as
 * protocol-relative and silently turns the first path segment into a hostname —
 * a path-join accident (`${base}//${slug}`) would lose a segment.
 */
function pathnameOf(input: string | URL): string {
	if (input instanceof URL) return input.pathname;
	if (/^https?:\/\//i.test(input)) return new URL(input).pathname;
	return new URL(`/${input.replace(/^\/+/, "")}`, PRODUCTION_ORIGIN).pathname;
}

/**
 * The canonical pathname for a page: absolute, slash-normalised, no query, no
 * fragment, and with the trailing slash the server actually serves.
 */
export function canonicalPath(input: string | URL): string {
	// `//a///b` is the same document as `/a/b` to the file server but a distinct
	// URL to a crawler, so it must not survive into a canonical.
	const collapsed = `/${pathnameOf(input)}`.replace(/\/{2,}/g, "/");
	const withoutTrailing = collapsed.replace(/\/+$/, "");

	if (withoutTrailing === "") return "/";
	if (hasFileExtension(withoutTrailing)) return withoutTrailing;
	return `${withoutTrailing}/`;
}

/**
 * The absolute canonical URL of a page, on the given origin.
 *
 * Joined with the URL API rather than string concatenation so an origin that
 * carries a stray path or trailing slash cannot produce `//` in the result.
 */
export function buildCanonicalUrl(input: string | URL, origin: string): string {
	return new URL(canonicalPath(input), normalizeOrigin(origin)).href;
}
