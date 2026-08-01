/**
 * End-to-end guard on the built output: every page in `dist/` must declare the
 * canonical URL that its own file location is served at, and every sitemap
 * `<loc>` must be one of those canonicals.
 *
 * This is the test that would have caught the original defect. The unit tests
 * in `canonical.test.ts` pin the normaliser; this one pins what actually ships,
 * so a page that hand-rolls its own `<link rel="canonical">`, or a sitemap that
 * drifts to a different URL variant, fails here rather than in a crawl.
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

/**
 * `astro build` writes every page as `<path>/index.html` (build format
 * `directory`), and that is the file the server hands back for `<path>/`. So
 * the file's own location states which URL it is, and the canonical inside it
 * has to agree.
 */
function servedPathOf(relativeFile: string): string {
	const withoutIndex = relativeFile.replace(/(^|\/)index\.html$/, "/");
	return `/${withoutIndex}`.replace(/\/{2,}/g, "/");
}

function htmlFiles(dir = DIST, prefix = ""): string[] {
	if (!built) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) return htmlFiles(join(dir, entry.name), rel);
		return entry.name.endsWith(".html") ? [rel] : [];
	});
}

const canonicalOf = (relativeFile: string): string | null =>
	readFileSync(join(DIST, relativeFile), "utf8").match(
		/<link rel="canonical" href="([^"]*)"/,
	)?.[1] ?? null;

/**
 * `404.html` is served by Caddy's `handle_errors` rewrite for any unknown URL,
 * so it has no URL of its own to canonicalise to. It carries `noindex, nofollow`
 * and is not linked, so it is out of the page set this test governs.
 */
const PAGES = htmlFiles().filter((file) => file !== "404.html");

test("dist/ contains built pages to check", { skip }, () => {
	assert.ok(PAGES.length > 0, "no built pages found");
});

test("REGRESSION: every built page canonicalises to its own served URL", { skip }, () => {
	const wrong: string[] = [];

	for (const file of PAGES) {
		const href = canonicalOf(file);
		if (href === null) {
			wrong.push(`${file}: no <link rel="canonical">`);
			continue;
		}
		const expected = servedPathOf(file);
		const actual = new URL(href).pathname;
		if (actual !== expected) wrong.push(`${file}: canonical ${actual}, served at ${expected}`);
	}

	assert.deepEqual(wrong, []);
});

test("REGRESSION: no canonical omits the trailing slash the server redirects", { skip }, () => {
	// The original defect: `/produkte/index.html` declared `…/produkte`, which
	// production answers with 308 -> `…/produkte/`. A canonical pointing at a
	// redirect is a non-indexable canonical.
	const slashless = PAGES.map((file) => [file, canonicalOf(file)] as const).filter(
		([, href]) => href !== null && !new URL(href).pathname.endsWith("/"),
	);

	assert.deepEqual(slashless, []);
});

test("canonicals are absolute, single-origin, and free of query and fragment", { skip }, () => {
	const origins = new Set<string>();
	const dirty: string[] = [];

	for (const file of PAGES) {
		const href = canonicalOf(file);
		if (href === null) continue;
		const url = new URL(href);
		origins.add(url.origin);
		if (url.search || url.hash) dirty.push(`${file}: ${href}`);
		if (url.pathname.includes("//")) dirty.push(`${file}: duplicate slash in ${href}`);
	}

	assert.deepEqual(dirty, []);
	assert.equal(origins.size, 1, `expected one canonical origin, got ${[...origins].join(", ")}`);
});

test("og:url matches the canonical on every page", { skip }, () => {
	const mismatched: string[] = [];

	for (const file of PAGES) {
		const html = readFileSync(join(DIST, file), "utf8");
		const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
		const ogUrl = html.match(/<meta property="og:url" content="([^"]*)"/)?.[1];
		if (canonical !== ogUrl) mismatched.push(`${file}: og:url ${ogUrl} vs canonical ${canonical}`);
	}

	assert.deepEqual(mismatched, []);
});

test("every sitemap URL is a built page that self-canonicalises", { skip }, () => {
	const sitemaps = readdirSync(DIST).filter(
		(name) => name.startsWith("sitemap-") && name.endsWith(".xml"),
	);
	assert.ok(sitemaps.length > 0, "no per-type sitemaps in dist/");

	const canonicals = new Map(
		PAGES.map((file) => [servedPathOf(file), canonicalOf(file)] as const),
	);
	const broken: string[] = [];

	for (const name of sitemaps) {
		const xml = readFileSync(join(DIST, name), "utf8");
		for (const match of xml.matchAll(/<loc>([^<]*)<\/loc>/g)) {
			const loc = match[1];
			const path = new URL(loc).pathname;
			if (!canonicals.has(path)) {
				broken.push(`${name}: ${loc} has no built page (would redirect or 404)`);
			} else if (canonicals.get(path) !== loc) {
				broken.push(`${name}: ${loc} != page canonical ${canonicals.get(path)}`);
			}
		}
	}

	assert.deepEqual(broken, []);
});

test("no sitemap lists a noindex page", { skip }, () => {
	const noindexPaths = new Set(
		PAGES.filter((file) =>
			/<meta name="robots" content="noindex/.test(readFileSync(join(DIST, file), "utf8")),
		).map(servedPathOf),
	);

	const listed = readdirSync(DIST)
		.filter((name) => name.startsWith("sitemap-") && name.endsWith(".xml"))
		.flatMap((name) =>
			[...readFileSync(join(DIST, name), "utf8").matchAll(/<loc>([^<]*)<\/loc>/g)].map(
				(match) => new URL(match[1]).pathname,
			),
		)
		.filter((path) => noindexPaths.has(path));

	assert.deepEqual(listed, []);
});
