/**
 * Canonical URL normalisation.
 *
 * Run with `npm test` (Node's built-in runner, no test framework — this module
 * is deliberately free of Astro/Vite imports so it needs none).
 *
 * The regression these tests exist for: canonicals used to be emitted without
 * the trailing slash, while the production server answers the slashless form
 * with a 308 to the slashed one. Every affected page therefore declared a
 * canonical that pointed at a redirect. `TRAILING_SLASH_ROUTES` below is the
 * guard — one entry per route type that exists on the live site.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	PRODUCTION_ORIGIN,
	buildCanonicalUrl,
	canonicalPath,
	normalizeOrigin,
} from "./canonical.ts";

/** Local dev origin, as set by `PUBLIC_SITE_URL` in `storefront/.env`. */
const DEV_ORIGIN = "http://localhost:4321";

/** Canonical URL on the production origin — what ships. */
const canonical = (input: string | URL) => buildCanonicalUrl(input, PRODUCTION_ORIGIN);

// ---------------------------------------------------------------------------
// Route coverage — one real route of every type the site publishes.
//
// These are the paths the crawler reported as "Canonicalised" plus
// "Non-Indexable Canonical". Each must canonicalise to itself, with the
// trailing slash the file server serves.
// ---------------------------------------------------------------------------

const TRAILING_SLASH_ROUTES: Array<[label: string, path: string]> = [
	["product page", "/produkte/bpc-157"],
	["product listing", "/produkte"],
	["category page", "/kategorie/neuropeptid-forschung"],
	["Wissen landing page", "/wissen"],
	["Wissen article", "/wissen/reinheit-und-coa"],
	["Lexikon landing page", "/wissen/lexikon"],
	["Lexikon term", "/wissen/lexikon/hplc"],
	["calculator", "/peptid-rechner"],
	["legal page", "/impressum"],
	["content page", "/about"],
	["transactional page", "/warenkorb"],
	["order lookup", "/bestellung/suchen"],
];

test("homepage canonicalises to the bare origin with a single slash", () => {
	assert.equal(canonical("/"), "https://peptideeinkaufen.de/");
	assert.equal(canonical(new URL("https://peptideeinkaufen.de/")), "https://peptideeinkaufen.de/");
});

for (const [label, path] of TRAILING_SLASH_ROUTES) {
	test(`${label} (${path}) canonicalises to itself with a trailing slash`, () => {
		const expected = `${PRODUCTION_ORIGIN}${path}/`;

		// Reached with the slash (how the server serves it) and without it (how
		// the page is linked): both must produce the same canonical.
		assert.equal(canonical(path), expected);
		assert.equal(canonical(`${path}/`), expected);
		assert.equal(canonical(new URL(`${PRODUCTION_ORIGIN}${path}/`)), expected);
	});
}

test("REGRESSION: no canonical omits the trailing slash the server redirects", () => {
	// The exact defect: production answers `/produkte` with 308 -> `/produkte/`,
	// so a canonical without the slash names a redirect and is non-indexable.
	for (const [, path] of TRAILING_SLASH_ROUTES) {
		const href = canonical(path);
		assert.notEqual(href, `${PRODUCTION_ORIGIN}${path}`, `${path} canonical must not be slashless`);
		assert.ok(href.endsWith("/"), `${path} canonical must end in a trailing slash`);
	}
});

test("canonical is self-referencing: normalising it again is a no-op", () => {
	for (const [, path] of [...TRAILING_SLASH_ROUTES, ["home", "/"] as const]) {
		const once = canonical(path);
		assert.equal(canonical(once), once, `${path} canonical is not stable`);
	}
});

// ---------------------------------------------------------------------------
// Path normalisation
// ---------------------------------------------------------------------------

test("query strings are dropped", () => {
	// Faceted listing URLs are near-duplicates and canonicalise to the clean path.
	assert.equal(canonical("/produkte?q=bpc"), "https://peptideeinkaufen.de/produkte/");
	assert.equal(canonical("/produkte/?sort=preis&q=tb"), "https://peptideeinkaufen.de/produkte/");
	assert.equal(
		canonical(new URL("https://peptideeinkaufen.de/produkte/?q=semax")),
		"https://peptideeinkaufen.de/produkte/",
	);
});

test("fragments are dropped", () => {
	assert.equal(canonical("/wissen/reinheit-und-coa#hplc"), `${PRODUCTION_ORIGIN}/wissen/reinheit-und-coa/`);
	assert.equal(canonical("/produkte?q=x#top"), `${PRODUCTION_ORIGIN}/produkte/`);
});

test("duplicate slashes collapse", () => {
	assert.equal(canonical("//produkte//bpc-157//"), `${PRODUCTION_ORIGIN}/produkte/bpc-157/`);
	assert.equal(canonicalPath("/wissen///lexikon"), "/wissen/lexikon/");
	assert.equal(canonicalPath("////"), "/");
});

test("a missing leading slash is added", () => {
	assert.equal(canonical("produkte/bpc-157"), `${PRODUCTION_ORIGIN}/produkte/bpc-157/`);
});

test("an empty path canonicalises to the root", () => {
	assert.equal(canonicalPath(""), "/");
	assert.equal(canonical(""), "https://peptideeinkaufen.de/");
});

test("file routes keep their exact path and gain no trailing slash", () => {
	// /sitemap.xml/ and /llms.txt/ do not exist — those are files, not directories.
	assert.equal(canonicalPath("/sitemap.xml"), "/sitemap.xml");
	assert.equal(canonicalPath("/llms-full.txt"), "/llms-full.txt");
	assert.equal(canonicalPath("/robots.txt"), "/robots.txt");
	assert.equal(canonicalPath("/favicon.ico"), "/favicon.ico");
});

// ---------------------------------------------------------------------------
// Origin normalisation
// ---------------------------------------------------------------------------

test("output is absolute, HTTPS, on the production hostname", () => {
	const href = canonical("/produkte/bpc-157");
	const url = new URL(href);

	assert.equal(url.protocol, "https:");
	assert.equal(url.host, "peptideeinkaufen.de");
	assert.equal(href, "https://peptideeinkaufen.de/produkte/bpc-157/");
});

test("a wrong host or protocol on the input cannot leak into the canonical", () => {
	assert.equal(canonical("https://www.example.com/produkte"), `${PRODUCTION_ORIGIN}/produkte/`);
	assert.equal(canonical("http://peptideeinkaufen.de/produkte"), `${PRODUCTION_ORIGIN}/produkte/`);
	assert.equal(canonical("https://EXAMPLE.com:8443/wissen"), `${PRODUCTION_ORIGIN}/wissen/`);

	// A leading `//` is read as a path, not as a protocol-relative URL, so the
	// first segment cannot become a hostname either way.
	assert.equal(new URL(canonical("//example.invalid/produkte")).host, "peptideeinkaufen.de");
	assert.equal(canonical("//example.invalid/produkte"), `${PRODUCTION_ORIGIN}/example.invalid/produkte/`);
});

test("configured origin is reduced to a bare origin", () => {
	assert.equal(normalizeOrigin("https://peptideeinkaufen.de/"), PRODUCTION_ORIGIN);
	assert.equal(normalizeOrigin("https://peptideeinkaufen.de///"), PRODUCTION_ORIGIN);
	assert.equal(normalizeOrigin("  https://peptideeinkaufen.de  "), PRODUCTION_ORIGIN);
	assert.equal(normalizeOrigin("https://peptideeinkaufen.de/shop?a=1#b"), PRODUCTION_ORIGIN);
	assert.equal(normalizeOrigin("HTTPS://PeptideEinkaufen.DE"), PRODUCTION_ORIGIN);
});

test("www is dropped and http upgraded, because both redirect in production", () => {
	assert.equal(normalizeOrigin("https://www.peptideeinkaufen.de"), PRODUCTION_ORIGIN);
	assert.equal(normalizeOrigin("http://peptideeinkaufen.de"), PRODUCTION_ORIGIN);
	assert.equal(normalizeOrigin("http://www.peptideeinkaufen.de"), PRODUCTION_ORIGIN);
});

test("an unusable configured origin falls back to production, never to a broken URL", () => {
	assert.equal(normalizeOrigin(""), PRODUCTION_ORIGIN);
	assert.equal(normalizeOrigin("not a url"), PRODUCTION_ORIGIN);
	assert.equal(normalizeOrigin("peptideeinkaufen.de"), PRODUCTION_ORIGIN);
	assert.equal(normalizeOrigin("file:///srv/peptides/storefront"), PRODUCTION_ORIGIN);
});

test("local development keeps its http origin and port", () => {
	assert.equal(normalizeOrigin(`${DEV_ORIGIN}/`), DEV_ORIGIN);
	assert.equal(buildCanonicalUrl("/produkte", DEV_ORIGIN), `${DEV_ORIGIN}/produkte/`);
	assert.equal(buildCanonicalUrl("/", DEV_ORIGIN), `${DEV_ORIGIN}/`);
	assert.equal(buildCanonicalUrl("/", "http://127.0.0.1:4321"), "http://127.0.0.1:4321/");
});

test("a stray path on the origin does not produce a double slash", () => {
	assert.equal(buildCanonicalUrl("/produkte", "https://peptideeinkaufen.de/"), `${PRODUCTION_ORIGIN}/produkte/`);
});

// ---------------------------------------------------------------------------
// Fabricated routes — the rule holds for slugs that do not exist yet.
// ---------------------------------------------------------------------------

test("normalisation is route-shape driven, not a hard-coded route list", () => {
	assert.equal(canonical("/produkte/fake-peptid-999"), `${PRODUCTION_ORIGIN}/produkte/fake-peptid-999/`);
	assert.equal(canonical("/kategorie/erfundene-kategorie"), `${PRODUCTION_ORIGIN}/kategorie/erfundene-kategorie/`);
	assert.equal(canonical("/wissen/lexikon/erfundener-begriff?x=1"), `${PRODUCTION_ORIGIN}/wissen/lexikon/erfundener-begriff/`);
	assert.equal(canonical("/a/b/c/d/e"), `${PRODUCTION_ORIGIN}/a/b/c/d/e/`);
});
