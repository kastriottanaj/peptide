/**
 * Internal link normalisation.
 *
 * Run with `npm test` (Node's built-in runner — `links.ts` imports only
 * `canonical.ts`, which is deliberately free of Astro/Vite imports).
 *
 * The regression these tests exist for: internal links used to be written
 * without the trailing slash while the file server answers the slashless form
 * with a 308, so every navigation and every crawled link cost one redirect.
 * `TRAILING_SLASH_ROUTES` is the guard — one entry per route type that exists on
 * the live site.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	articlePath,
	categoryPath,
	internalHref,
	lexikonPath,
	productPath,
} from "./links.ts";

// ---------------------------------------------------------------------------
// Route coverage — one real route of every type the site links to.
// ---------------------------------------------------------------------------

const TRAILING_SLASH_ROUTES: Array<[label: string, path: string]> = [
	["home", "/"],
	["product listing", "/produkte"],
	["product page", "/produkte/retatrutide"],
	["category page", "/kategorie/stoffwechsel-forschung"],
	["wissen index", "/wissen"],
	["wissen article", "/wissen/reinheit-und-coa"],
	["lexikon index", "/wissen/lexikon"],
	["lexikon term", "/wissen/lexikon/hplc"],
	["calculator", "/peptid-rechner"],
	["legal page", "/impressum"],
	["cart", "/warenkorb"],
	["checkout", "/kasse"],
	["order confirmation", "/bestellung"],
	["order lookup", "/bestellung/suchen"],
	["about", "/about"],
	["contact", "/contact"],
];

for (const [label, path] of TRAILING_SLASH_ROUTES) {
	test(`${label} href ends in a slash: ${path}`, () => {
		const href = internalHref(path);
		assert.ok(href.endsWith("/"), `${path} -> ${href} should end with "/"`);
		// The root is already "/" and must not become "//".
		assert.equal(href, path === "/" ? "/" : `${path}/`);
	});

	test(`${label} href is idempotent: ${path}`, () => {
		const once = internalHref(path);
		assert.equal(internalHref(once), once);
		assert.equal(internalHref(internalHref(once)), once);
	});
}

test("the root path stays a single slash", () => {
	assert.equal(internalHref("/"), "/");
});

test("an already-correct trailing slash is left as it is", () => {
	assert.equal(internalHref("/produkte/"), "/produkte/");
	assert.equal(internalHref("/wissen/lexikon/hplc/"), "/wissen/lexikon/hplc/");
});

test("duplicate slashes collapse", () => {
	assert.equal(internalHref("//"), "//"); // protocol-relative, not ours
	assert.equal(internalHref("/produkte//bpc-157"), "/produkte/bpc-157/");
	assert.equal(internalHref("/wissen///lexikon//hplc"), "/wissen/lexikon/hplc/");
	assert.equal(internalHref("/produkte///"), "/produkte/");
});

// ---------------------------------------------------------------------------
// Query strings and fragments — the pathname is normalised, nothing else.
// ---------------------------------------------------------------------------

test("a query string is preserved and only the pathname gains the slash", () => {
	assert.equal(internalHref("/wissen?topic=coa"), "/wissen/?topic=coa");
	assert.equal(internalHref("/produkte?q=bpc"), "/produkte/?q=bpc");
});

test("a fragment is preserved and only the pathname gains the slash", () => {
	assert.equal(
		internalHref("/produkte/retatrutide#details"),
		"/produkte/retatrutide/#details",
	);
});

test("query plus fragment are both preserved, in order", () => {
	assert.equal(
		internalHref("/produkte?q=bpc&sort=preis#liste"),
		"/produkte/?q=bpc&sort=preis#liste",
	);
});

test("query parameters are neither reordered, re-encoded nor dropped", () => {
	const messy = "/produkte?z=1&a=2&leer=&raw=a%20b&plus=a+b&dup=1&dup=2";
	assert.equal(internalHref(messy), `/produkte/${messy.slice("/produkte".length)}`);
	assert.ok(internalHref(messy).includes("z=1&a=2"));
	assert.ok(internalHref(messy).includes("raw=a%20b"));
	assert.ok(internalHref(messy).includes("plus=a+b"));
});

test("query and fragment handling is idempotent", () => {
	for (const href of [
		"/wissen?topic=coa",
		"/produkte/retatrutide#details",
		"/produkte?q=bpc&sort=preis#liste",
	]) {
		const once = internalHref(href);
		assert.equal(internalHref(once), once);
	}
});

// ---------------------------------------------------------------------------
// File and API routes — served at their exact path, so never slashed.
// ---------------------------------------------------------------------------

const UNCHANGED_FILE_ROUTES = [
	"/robots.txt",
	"/llms.txt",
	"/llms-full.txt",
	"/sitemap.xml",
	"/sitemap-pages.xml",
	"/sitemap-products.xml",
	"/sitemap-wissen.xml",
	"/sitemap-lexikon.xml",
	"/api/search.json",
	"/favicon.svg",
	"/favicon.ico",
	"/images/bpc-157.webp",
	"/fonts/inter.woff2",
	"/_astro/index.CkQ2mVpX.css",
	"/_astro/client.DzR1kL9s.js",
];

for (const path of UNCHANGED_FILE_ROUTES) {
	test(`file route is left unchanged: ${path}`, () => {
		assert.equal(internalHref(path), path);
	});
}

test("a file route keeps its query string and gains no slash", () => {
	assert.equal(internalHref("/api/search.json?v=2"), "/api/search.json?v=2");
});

// ---------------------------------------------------------------------------
// Values that are not ours to rewrite.
// ---------------------------------------------------------------------------

const UNCHANGED_VALUES = [
	"https://developer.chrome.com/docs/ai/webmcp",
	"https://peptideeinkaufen.de/produkte",
	"http://localhost:9000/health",
	"//cdn.example.com/lib.js",
	// Example addresses on purpose: the storefront emits no mailto: link today,
	// and a plausible-looking address on the real domain could be mistaken for a
	// support channel that does not exist.
	"mailto:kontakt@example.com",
	"mailto:kontakt@example.com?subject=Frage",
	"tel:+4930123456",
	"data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
	"javascript:void(0)",
	"#details",
	"#A",
	"?q=bpc",
	"bpc-157",
	"./bpc-157",
	"../produkte",
	"",
];

for (const value of UNCHANGED_VALUES) {
	test(`left unchanged: ${JSON.stringify(value)}`, () => {
		assert.equal(internalHref(value), value);
	});
}

test("an external URL is never turned into an internal one", () => {
	const external = "https://www.gesetze-im-internet.de/bgb/__355.html";
	assert.equal(internalHref(external), external);
});

// ---------------------------------------------------------------------------
// Route builders — the four data-driven shapes.
// ---------------------------------------------------------------------------

test("productPath builds a slashed product route", () => {
	assert.equal(productPath("retatrutide"), "/produkte/retatrutide/");
	assert.equal(productPath("bpc-157"), "/produkte/bpc-157/");
});

test("categoryPath builds a slashed category route", () => {
	assert.equal(
		categoryPath("stoffwechsel-forschung"),
		"/kategorie/stoffwechsel-forschung/",
	);
});

test("articlePath builds a slashed wissen route", () => {
	assert.equal(articlePath("reinheit-und-coa"), "/wissen/reinheit-und-coa/");
});

test("lexikonPath builds a slashed lexikon route", () => {
	assert.equal(lexikonPath("hplc"), "/wissen/lexikon/hplc/");
});

test("route builders agree with internalHref on the same path", () => {
	assert.equal(productPath("mots-c"), internalHref("/produkte/mots-c"));
	assert.equal(categoryPath("regenerationsforschung"), internalHref("/kategorie/regenerationsforschung"));
	assert.equal(articlePath("was-sind-peptide"), internalHref("/wissen/was-sind-peptide"));
	assert.equal(lexikonPath("vial"), internalHref("/wissen/lexikon/vial"));
});

test("route builders are idempotent through internalHref", () => {
	const href = productPath("ghk-cu");
	assert.equal(internalHref(href), href);
});

// ---------------------------------------------------------------------------
// The slash rule must stay the canonical rule. If `canonical.ts` ever changes
// what a page URL looks like, these links have to move with it.
// ---------------------------------------------------------------------------

test("an href matches the pathname of the page's own canonical", async () => {
	const { canonicalPath } = await import("./canonical.ts");
	for (const [, path] of TRAILING_SLASH_ROUTES) {
		assert.equal(internalHref(path), canonicalPath(path));
	}
	for (const path of UNCHANGED_FILE_ROUTES.filter((p) => !p.startsWith("/_astro"))) {
		assert.equal(internalHref(path), canonicalPath(path));
	}
});
