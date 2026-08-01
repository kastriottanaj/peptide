/**
 * End-to-end guard on the built output: no internal link in `dist/` may point at
 * a URL the server answers with a redirect.
 *
 * This is the test that would have caught the internal-redirect defect. The unit
 * tests in `links.test.ts` pin the normaliser; this one pins what actually ships,
 * so a page that hand-writes `<a href="/produkte">` fails here rather than in a
 * crawl. It is the link-side counterpart to `canonical-output.test.ts`.
 *
 * The target of every link is resolved the way the production server resolves
 * it: `astro build` writes `<path>/index.html` and Caddy's `file_server` serves
 * that as a directory index, so `/produkte` is a 308 to `/produkte/` and only
 * the slashed form answers 200. Those 308s stay in place for external links and
 * old bookmarks — this test asserts that nothing *we* link to needs one.
 *
 * Skipped when `dist/` is absent — `npm test` must not require a build (which
 * needs the Medusa backend on :9000). Run `npm run build` first to exercise it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const built = existsSync(DIST);
const skip = built ? false : "no dist/ — run `npm run build` first";

function allFiles(dir = DIST, prefix = ""): string[] {
	if (!built) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		return entry.isDirectory() ? allFiles(join(dir, entry.name), rel) : [rel];
	});
}

const FILES = allFiles();
const HTML = FILES.filter((file) => file.endsWith(".html"));

/** The URL a built file is served at. */
function servedPathOf(relativeFile: string): string {
	if (relativeFile === "index.html") return "/";
	if (relativeFile.endsWith("/index.html")) {
		return `/${relativeFile.slice(0, -"index.html".length)}`;
	}
	return `/${relativeFile}`;
}

const SERVED = new Set(FILES.map(servedPathOf));

/** Every directory that exists in the output, i.e. every path that 308s. */
const DIRECTORIES = new Set(
	FILES.flatMap((file) => {
		const parts = file.split("/");
		return parts.slice(0, -1).map((_, i) => `/${parts.slice(0, i + 1).join("/")}`);
	}),
);

type Resolved = { status: 200 | 308 | 404; location?: string };

/** What the production server would answer for this pathname. */
function resolvePath(pathname: string): Resolved {
	if (SERVED.has(pathname)) return { status: 200 };
	if (DIRECTORIES.has(pathname) && SERVED.has(`${pathname}/`)) {
		return { status: 308, location: `${pathname}/` };
	}
	if (pathname.endsWith("/") && SERVED.has(pathname.slice(0, -1))) {
		return { status: 308, location: pathname.slice(0, -1) };
	}
	return { status: 404 };
}

/** Hosts that are this site — anything else is an external link we do not own. */
const SITE_HOSTS = new Set(["peptideeinkaufen.de", "localhost", "127.0.0.1"]);
const OTHER_SCHEME = /^(mailto:|tel:|data:|javascript:|blob:|sms:|ftp:)/i;

type Link = { page: string; href: string; url: URL | null };

/**
 * Clickable navigation only: `<a href>` and `<form action>`. Head metadata
 * (canonical, og:url) and JSON-LD are governed by `canonical-output.test.ts` —
 * they are URL strings, not links a visitor or crawler follows from the page.
 */
function navigationLinks(): Link[] {
	const links: Link[] = [];

	for (const file of HTML) {
		const page = servedPathOf(file);
		const html = readFileSync(join(DIST, file), "utf8");

		for (const tag of html.matchAll(/<(?:a|form)\b[^>]*>/gi)) {
			const href = /\b(?:href|action)\s*=\s*"([^"]*)"/i.exec(tag[0])?.[1]?.trim();
			if (!href) continue;
			// Fragment-only links address the current document.
			if (href.startsWith("#")) continue;
			if (OTHER_SCHEME.test(href)) continue;

			try {
				links.push({ page, href, url: new URL(href, `https://peptideeinkaufen.de${page}`) });
			} catch {
				links.push({ page, href, url: null });
			}
		}
	}

	return links;
}

const LINKS = navigationLinks();

const internal = LINKS.filter(
	(link) =>
		link.url !== null &&
		(link.url.protocol === "https:" || link.url.protocol === "http:") &&
		SITE_HOSTS.has(link.url.hostname),
);

test("dist/ contains built pages with links to check", { skip }, () => {
	assert.ok(HTML.length > 0, "no built pages found");
	assert.ok(internal.length > 0, "no internal links found — is the extractor still right?");
});

test("REGRESSION: no internal link points at a redirect", { skip }, () => {
	// The original defect: `<a href="/produkte">` in the header of every page,
	// which production answers with 308 -> `/produkte/`. One wasted round trip
	// per navigation, and an "internal redirect" finding per link in a crawl.
	const redirecting = internal
		.filter((link) => resolvePath(link.url!.pathname).status === 308)
		.map((link) => `${link.page}: ${link.href} -> 308 -> ${resolvePath(link.url!.pathname).location}`);

	assert.deepEqual(redirecting, []);
});

test("no internal link points at a missing page", { skip }, () => {
	const broken = internal
		.filter((link) => resolvePath(link.url!.pathname).status === 404)
		.map((link) => `${link.page}: ${link.href} -> 404`);

	assert.deepEqual(broken, []);
});

test("no link is malformed", { skip }, () => {
	const malformed = LINKS.filter((link) => link.url === null).map(
		(link) => `${link.page}: ${link.href}`,
	);

	assert.deepEqual(malformed, []);
});

test("no internal link contains a duplicate slash", { skip }, () => {
	const doubled = internal
		.filter((link) => link.url!.pathname.includes("//"))
		.map((link) => `${link.page}: ${link.href}`);

	assert.deepEqual(doubled, []);
});

test("REGRESSION: no file route gained a trailing slash", { skip }, () => {
	// `/robots.txt/`, `/sitemap.xml/` and `/api/search.json/` do not exist. A
	// normaliser that slashed every path would produce exactly these.
	const slashedFile = internal
		.filter((link) => /\.[a-z0-9]+\/$/i.test(link.url!.pathname))
		.map((link) => `${link.page}: ${link.href}`);

	assert.deepEqual(slashedFile, []);
});

test("external links are left alone", { skip }, () => {
	// Guards the other direction: a normaliser must not rewrite a foreign host's
	// URL, and must not turn one into a site-relative path.
	const external = LINKS.filter(
		(link) => link.url !== null && !SITE_HOSTS.has(link.url.hostname),
	);

	for (const link of external) {
		assert.ok(
			/^https?:\/\//i.test(link.href),
			`${link.page}: external link ${link.href} lost its origin`,
		);
	}
});

test("the header and footer navigation on every page is redirect-free", { skip }, () => {
	// The navigation is rendered by BaseLayout into all 37 pages, so a single
	// slashless href there was ~37 of the reported internal redirects. Pin the
	// routes it links to by name.
	const NAV_ROUTES = [
		"/",
		"/produkte/",
		"/wissen/",
		"/wissen/lexikon/",
		"/wissen/reinheit-und-coa/",
		"/peptid-rechner/",
		"/contact/",
		"/about/",
		"/warenkorb/",
		"/bestellung/suchen/",
		"/impressum/",
		"/datenschutz/",
		"/agb/",
		"/widerruf/",
	];

	for (const route of NAV_ROUTES) {
		assert.equal(
			resolvePath(route).status,
			200,
			`navigation route ${route} does not answer 200`,
		);
	}
});
