import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const built = existsSync(DIST);
const skip = built ? false : "no dist/ — run `npm run build` first";
const source = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const builtFile = (relative: string) => readFileSync(join(DIST, relative), "utf8");

const PAGE = "pages/coa-pruefen.astro";
const COMPONENT = "components/CoaLookup.astro";
const PRODUCT_PAGE = "pages/produkte/[handle].astro";
const NO_DOCUMENT = "Für diese Packgröße ist derzeit kein Analysedokument verknüpft.";

/** Source with comments stripped: assertions about wording read shipped copy. */
const codeOf = (relative: string) =>
	source(relative)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");

// --- route contract --------------------------------------------------------

test("the route carries the approved title, description and H1", () => {
	const page = source(PAGE);
	assert.match(page, /const title = "COA nachschlagen: Analysedokumentation je Packgröße";/);
	assert.ok(
		page.includes(
			"Nachschlagen, ob zu einem Produkt und einer Packgröße im Katalog Analysedokumentation hinterlegt ist. Keine Echtheits- oder Qualitätsprüfung.",
		),
	);
	assert.ok(page.includes("<h1>Analysedokumentation zu Produkt und Packgröße nachschlagen</h1>"));
	assert.equal(page.match(/<h1>/g)?.length, 1);
});

test("the page reads the real catalog through the shared resolver", () => {
	const page = source(PAGE);
	assert.match(page, /await listProducts\(/);
	assert.match(page, /buildCoaLookupModel\(products, allowedDocumentOrigins\(\)\)/);
	assert.match(page, /hasLinkedDocuments\(model\)/);
	// No second product list, no hard-coded catalog.
	assert.doesNotMatch(page, /bpc-157|retatrutide|ghk-cu/);
});

test("indexability is bound to the predicate, not to a hand-set flag", () => {
	assert.match(source(PAGE), /noindexFollow=\{!indexable\}/);
	assert.match(source(PAGE), /const indexable = hasLinkedDocuments\(model\)/);
});

test("structured data is Breadcrumb always and ItemList only when documents exist", () => {
	const page = source(PAGE);
	assert.match(page, /breadcrumbNode\(\[/);
	assert.match(page, /if \(documents\.length > 0\) \{[\s\S]*"@type": "ItemList"/);
	for (const forbidden of [
		'"@type": "Product"',
		'"@type": "Offer"',
		'"@type": "AggregateOffer"',
		'"@type": "Review"',
		'"@type": "AggregateRating"',
		'"@type": "WebApplication"',
	]) {
		assert.ok(!page.includes(forbidden), `must not emit ${forbidden}`);
	}
});

// --- claims ----------------------------------------------------------------

test("no verification, authentication or quality claim in the shipped copy", () => {
	const text = [codeOf(PAGE), codeOf(COMPONENT)].join("\n");
	for (const pattern of [
		/\bverifiziert\b/i,
		/\bbestätigt\b/i,
		/\bgarantiert\b/i,
		/\bauthentisch\b/i,
		/\bfreigegeben\b/i,
		/\bvalidiert\b/i,
		/\bzertifiziert\b/i,
	]) {
		assert.doesNotMatch(text, pattern);
	}
	// "geprüft"/"prüft" may appear only in the clarification that denies it.
	for (const match of text.match(/[^.<>]*\bprüft\b[^.<>]*/gi) ?? []) {
		assert.match(match, /weder|nicht/, `unqualified claim: ${match.trim()}`);
	}
});

test("the clarification about scope is present on the tool", () => {
	assert.ok(
		source(COMPONENT).includes(
			"Es prüft weder deren Echtheit noch, ob sie für eine andere Charge oder",
		),
	);
});

test("no upload, OCR, parsing or automated approval path exists", () => {
	const text = [source(PAGE), source(COMPONENT), source("lib/coa-documents.ts")].join("\n");
	for (const pattern of [
		/type="file"/i,
		/FormData/,
		/\bOCR\b/i,
		/\bupload/i,
		/tesseract|pdfjs|pdf-parse/i,
	]) {
		assert.doesNotMatch(text, pattern);
	}
});

test("no medical, dosage or administration wording", () => {
	const text = [codeOf(PAGE), codeOf(COMPONENT)].join("\n");
	for (const pattern of [/dos(?:is|ierung)/i, /injektion/i, /einnahme/i, /therapie/i, /behandl/i]) {
		assert.doesNotMatch(text, pattern);
	}
});

// --- progressive enhancement, accessibility, mobile ------------------------

test("the server HTML carries the full table and the controls start hidden", () => {
	const component = source(COMPONENT);
	assert.match(component, /model\.products\.map/);
	assert.match(component, /data-coa-static/);
	assert.match(component, /class="coa__controls js-control"\s+hidden/);
	assert.match(component, /staticTable\?\.setAttribute\("hidden", ""\)/);
	assert.match(component, /\.js-control"\)\.forEach/);
});

test("controls are native elements with an accessible status region", () => {
	const component = source(COMPONENT);
	assert.match(component, /<input\s+type="search"/);
	assert.match(component, /<select id="coa-product"/);
	assert.match(component, /<select id="coa-variant"/);
	assert.match(component, /<label for="coa-search">/);
	assert.match(component, /<label for="coa-product">/);
	assert.match(component, /<label for="coa-variant">/);
	assert.match(component, /role="status" aria-live="polite"/);
	assert.match(component, /focus-visible/);
	// Status is announced as words, for every state.
	for (const message of [
		"Dieses Produkt ist im aktuellen Katalog nicht vorhanden.",
		"Diese Packgröße ist für dieses Produkt nicht im Katalog.",
		"Kein Produkt im Katalog entspricht dieser Suche.",
	]) {
		assert.ok(component.includes(message), `missing announcement: ${message}`);
	}
});

test("mobile layout cannot overflow the page and nothing is fixed-positioned", () => {
	const component = source(COMPONENT);
	assert.match(component, /\.coa__table-wrap \{[\s\S]*overflow-x: auto;/);
	assert.doesNotMatch(component, /position:\s*fixed/);
	assert.doesNotMatch(component, /position:\s*sticky/);
	assert.match(component, /max-width: 100%/);
	// REGRESSION: "Analysedokumentation" is wider than a 320 px viewport at
	// heading size, and an unbreakable word pushed the whole document into a
	// horizontal scroll. Both surfaces must allow the browser to hyphenate.
	for (const file of [PAGE, COMPONENT]) {
		assert.match(source(file), /hyphens: auto/, `${file} must allow hyphenation`);
		assert.match(source(file), /overflow-wrap: break-word/, `${file} must wrap long words`);
	}
});

test("document links are safe and never show a raw storage filename", () => {
	const component = source(COMPONENT);
	assert.match(component, /rel="noopener noreferrer"/);
	assert.match(component, /link\.rel = "noopener noreferrer"/);
	// Link text is built from type + product + pack size, never from the URL.
	assert.match(component, /öffnen/);
	assert.doesNotMatch(component, /textContent = .*document\.url/);
});

// --- product page ----------------------------------------------------------

test("the product page no longer reads coa_status", () => {
	// Comments stripped: the page documents *why* the old row was removed, and
	// that explanation must not itself trip the check.
	const page = codeOf(PRODUCT_PAGE);
	assert.ok(!page.includes("coa_status"), "coa_status must not be read");
	assert.ok(!page.includes("coaStatus"), "the coaStatus binding must be gone");
	assert.ok(!page.includes("COA-Zertifikat"), "the placeholder claim row must be gone");
});

test("the product page resolves documents per pack size with no fallback", () => {
	const page = source(PRODUCT_PAGE);
	assert.match(page, /resolveVariantStatus\(variant, allowedDocumentOrigins\(\)\)/);
	assert.match(page, /documentStatuses\.map/);
	assert.ok(page.includes(NO_DOCUMENT));
	assert.match(page, /href="\/coa-pruefen\/"/);
	// purity still renders, but is never presented as document evidence.
	assert.match(page, /<dt>Reinheit<\/dt>/);
	assert.ok(!/purity[\s\S]{0,120}Analysedokument/.test(page));
});

// --- tools page ------------------------------------------------------------

test("the Tools cards point at the pages they name", () => {
	const tools = source("pages/tools.astro");
	assert.match(tools, /title: "COA-Zertifikat",[\s\S]{0,200}href: "\/coa-pruefen\/"/);
	assert.match(tools, /title: "Stack-Builder",[\s\S]{0,200}href: "\/stack-builder\/"/);
	assert.match(tools, /title: "Vergleichstool",[\s\S]{0,200}href: "\/produkte\/"/);
});

// --- discovery wiring ------------------------------------------------------

test("one predicate feeds robots, sitemap and llms.txt", () => {
	const index = source("lib/content-index.ts");
	assert.match(index, /export async function coaCheckerEntries/);
	assert.match(index, /if \(!hasLinkedDocuments\(model\)\) return \[\];/);
	assert.ok(!codeOf("lib/content-index.ts").includes("coa_status"));
	assert.match(source("pages/sitemap-pages.xml.ts"), /coaCheckerEntries\(lastModified\)/);
	assert.match(source("pages/llms.txt.ts"), /coaCheckerEntries\(\)/);
	assert.match(source("pages/llms.txt.ts"), /section\("Seiten", \[\.\.\.allStaticEntries\(\), \.\.\.coaChecker\]\)/);
	// Site search keeps the route regardless of indexability.
	assert.match(source("pages/api/search.json.ts"), /coaCheckerSearchEntries\(\)/);
});

test("no ordering, cart or checkout path is touched by this feature", () => {
	const text = [
		source(PAGE),
		source(COMPONENT),
		source("lib/coa-documents.ts"),
		source("lib/coa-origins.ts"),
	].join("\n");
	for (const pattern of [
		/addLine|createLineItem/,
		/lib\/cart/,
		/\/kasse\//,
		/data-add-to-cart/,
		/ORDERS_ENABLED/,
	]) {
		assert.doesNotMatch(text, pattern);
	}
});

// --- built output, against the real catalog --------------------------------

test("the built route has the exact canonical, one H1 and no forbidden schema", { skip }, () => {
	const html = builtFile("coa-pruefen/index.html");
	assert.match(html, /<link rel="canonical" href="[^"]*\/coa-pruefen\/"/);
	assert.equal(html.match(/<h1[\s>]/g)?.length, 1);
	assert.match(html, /Analysedokumentation zu Produkt und Packgröße nachschlagen/);
	assert.match(html, /<title>COA nachschlagen: Analysedokumentation je Packgröße/);
	assert.match(html, /"@type":"BreadcrumbList"/);
	for (const forbidden of ['"@type":"Product"', '"@type":"Offer"', '"@type":"Review"', '"@type":"AggregateRating"']) {
		assert.ok(!html.includes(forbidden), `built page must not emit ${forbidden}`);
	}
});

test("with real documents the page is indexable and lists them", { skip }, () => {
	// Inverted on 2026-08-15, when the fabricated analytical metadata was
	// replaced with the real certificates. Both halves of the predicate flipped
	// together and neither was touched by hand: linking a document is what makes
	// the checker indexable and what puts it in the sitemap.
	const html = builtFile("coa-pruefen/index.html");
	assert.doesNotMatch(html, /<meta name="robots" content="noindex/);
	assert.ok(html.includes('"@type":"ItemList"'), "documents exist, so an ItemList must describe them");
	// Five of eleven variants carry a certificate; the other six are pack sizes
	// the laboratory did not analyse and must still say so.
	assert.equal(html.split(NO_DOCUMENT).length - 1, 6, "six variants have no matching certificate");
	// The raw metadata key never reaches the page — only resolved URLs do.
	assert.ok(!html.includes("coa_document_url"));
});

test("the built page is usable without JavaScript", { skip }, () => {
	const html = builtFile("coa-pruefen/index.html");
	for (const handle of ["bpc-157", "retatrutide", "ghk-cu", "mots-c", "semax", "tb-500"]) {
		assert.ok(html.includes(`/produkte/${handle}/`), `missing product link ${handle}`);
	}
	assert.match(html, /<table class="coa__table"/);
	// The SKU column is populated from the catalog; the prefix differs between
	// the dev database and production, so match the stable part only.
	assert.match(html, /BPC157-5mg/);
	assert.match(html, /class="coa__controls js-control" hidden/);
	assert.match(html, /href="\/qualitaet-analyse\/"/);
	assert.match(html, /href="\/wissen\/reinheit-und-coa\/"/);
	assert.match(html, /href="\/support\/anfrage\/"/);
});

test("no Medusa identifier or storage path reaches the built page", { skip }, () => {
	const html = builtFile("coa-pruefen/index.html");
	assert.doesNotMatch(html, /prod_01[A-Z0-9]+/);
	assert.doesNotMatch(html, /variant_01[A-Z0-9]+/);
	assert.doesNotMatch(html, /\/var\/lib\/peptides/);
	assert.doesNotMatch(html, /\/srv\/peptides/);
});

test("an indexable checker is listed in the sitemap and llms.txt", { skip }, () => {
	// Same predicate as the indexability above, which is the point: discovery
	// and the robots directive cannot disagree about whether documents exist.
	assert.ok(builtFile("sitemap-pages.xml").includes("/coa-pruefen/"));
	assert.ok(builtFile("llms.txt").includes("/coa-pruefen/"));
	// llms-full.txt reproduces editorial bodies, so the Wissen article's own
	// inline link to the tool appears there as prose. What must not appear is a
	// map entry advertising the route.
	// llms-full.txt reproduces editorial bodies rather than a route map, so the
	// tool appears there only as the Wissen article's inline prose link — that
	// was true while the page was noindex and is still true now. The map entry
	// asserted above lives in llms.txt, which is the file that lists routes.
	assert.match(builtFile("llms-full.txt"), /\]\(\/coa-pruefen\/\)/);
	// Site search keeps it: it is a valid public page, and search is not a crawler.
	assert.ok(builtFile("api/search.json").includes("/coa-pruefen/"));
});

test("the built product page states the honest per-pack-size status", { skip }, () => {
	const html = builtFile("produkte/bpc-157/index.html");
	assert.ok(!html.includes("COA-Zertifikat"));
	assert.ok(!/COA[^<]{0,40}verfügbar/i.test(html));
	// BPC-157 sells 5 mg and 10 mg; only the 10 mg was analysed, so exactly one
	// pack size still reports no document. Asserting the *mix* rather than
	// "everything has one" is what keeps an over-broad mapping visible.
	assert.equal(html.split(NO_DOCUMENT).length - 1, 1, "only BPC-157 5 mg lacks a certificate");
	assert.match(html, /coa\/bpc-157-10mg-coa\.pdf/);
	assert.match(html, /Analysedokumentation<\/h2>/);
	assert.match(html, /href="\/coa-pruefen\/"/);
});

test("existing certificate routes are unchanged", { skip }, () => {
	const quality = builtFile("qualitaet-analyse/index.html");
	assert.match(quality, /<link rel="canonical" href="[^"]*\/qualitaet-analyse\/"/);
	assert.ok(!quality.includes('name="robots" content="noindex'));
	assert.match(quality, /href="\/coa-pruefen\/"/);

	const hub = builtFile("wissen/reinheit-und-coa/index.html");
	assert.match(hub, /<link rel="canonical" href="[^"]*\/wissen\/reinheit-und-coa\/"/);
	assert.match(hub, /href="\/coa-pruefen\/"/);

	const tools = builtFile("tools/index.html");
	assert.match(tools, /href="\/coa-pruefen\/"/);
	assert.match(tools, /href="\/stack-builder\/"/);
});

test("the checker offers no ordering action", { skip }, () => {
	const html = builtFile("coa-pruefen/index.html");
	const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
	for (const pattern of [/In den Warenkorb/i, /Jetzt bestellen/i, /Zur Kasse/i, /data-add-to-cart/]) {
		assert.doesNotMatch(main, pattern);
	}
});
