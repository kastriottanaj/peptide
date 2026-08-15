/**
 * Guards on `/versand-zahlung/`, the shipping and payment page.
 *
 * Two failure modes matter here, and neither is a broken build.
 *
 * 1. **A money value that drifts from the checkout.** The fees and the free
 *    shipping threshold come from `lib/pricing.ts`, which the cart reads and
 *    which mirrors the Medusa seed rules. A hand-typed copy on this page would
 *    quote a fee the order does not charge, so the rendered values are compared
 *    against the constants themselves rather than against a literal.
 * 2. **A detail that is still open being filled with something plausible.** No
 *    carrier, dispatch time, tracking promise, country exclusion or bank detail
 *    exists in this repository to cite (docs/go-live-checklist.md §1, §4). Each
 *    is pinned as absent.
 *
 * Source scans always run; the built-output checks are skipped without `dist/`
 * — `npm test` must not require a build (which needs the Medusa backend on
 * :9000). Run `npm run build` first to exercise them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Explicit `.ts` extension: this module is loaded directly by `node --test`,
// which does not do Vite's extensionless resolution.
import {
	FREE_SHIPPING_THRESHOLD_EUR,
	SHIPPING_FEE_EUR,
	SHIPPING_FEE_OUTSIDE_GERMANY_EUR,
	formatEur,
} from "./pricing.ts";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const built = existsSync(DIST);
const skip = built ? false : "no dist/ — run `npm run build` first";

const PATH = "/versand-zahlung/";
const FILE = "versand-zahlung/index.html";
const SOURCE = "pages/versand-zahlung.astro";

const H1 = "Versand und Zahlung";
const TITLE = "Versand und Zahlung";
const DESCRIPTION =
	"Informationen zu Versandkosten, Liefergebieten, Zahlungsweise und dem aktuellen Bestellstatus.";

const source = (): string => readFileSync(join(SRC, SOURCE), "utf8");
const html = (): string => readFileSync(join(DIST, FILE), "utf8");

/** Body of the page source, comments removed — they discuss the rules. */
function body(): string {
	return source()
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

/** `Intl` separates the amount from the symbol with U+00A0; normalise it. */
const nbsp = (value: string): string => value.replace(/ /g, " ");

// ---------------------------------------------------------------------------
// 1. Source — always runs
// ---------------------------------------------------------------------------

test("the money values are read from lib/pricing, never typed into the page", () => {
	// The mechanism the value check below depends on: if the page stops importing
	// the constants, the next edit to a fee silently stops reaching it.
	const text = source();

	assert.match(text, /from "\.\.\/lib\/pricing"/);
	for (const name of [
		"SHIPPING_FEE_EUR",
		"SHIPPING_FEE_OUTSIDE_GERMANY_EUR",
		"FREE_SHIPPING_THRESHOLD_EUR",
		"formatEur",
	]) {
		assert.ok(text.includes(name), `page does not use ${name}`);
	}

	// A bare "10,00 €" or "100 EUR" in the markup would be the duplicate.
	assert.doesNotMatch(
		body(),
		/\d{1,3}(?:[.,]\d{2})?\s*(?:€|EUR)/,
		"a currency amount is written into the page instead of formatted from the constants",
	);
});

/**
 * Details that have no authoritative source yet. Each pattern is written to
 * catch the paraphrase as well as one wording — the point is that the *claim*
 * cannot appear, not that one sentence cannot.
 */
const UNCONFIRMED_DETAILS: Array<[label: string, pattern: RegExp]> = [
	[
		"a named carrier",
		/\bDHL\b|\bDPD\b|\bHermes\b|\bGLS\b|\bUPS\b|\bFedEx\b|Deutsche Post/i,
	],
	[
		"a tracking promise",
		/(sendungsverfolgung|tracking|sendungsnummer)[^.]{0,40}\b(erhalten|bekommen|wird bereitgestellt|steht zur verfügung|versenden wir)/i,
	],
	[
		"a dispatch or delivery time",
		/\d\s*[–—-]?\s*\d?\s*werktage?n?|(versand|lieferung|zustellung)\s+(in|innerhalb|binnen)\s+\d|noch am selben tag/i,
	],
	[
		"a customs or country-exclusion rule",
		/zoll|einfuhrabgabe|zollgebühr|nicht geliefert wird nach|ausgeschlossene länder|liefern wir nicht nach/i,
	],
	[
		"a dispatch location",
		/versand (erfolgt|ab) (aus|von)\s+[A-ZÄÖÜ]|versandlager|lager in/i,
	],
	[
		"a payment method other than bank transfer",
		/\bWise\b|\bStripe\b|\bPayPal\b|\bKlarna\b|kreditkarte|\bSofort(überweisung)?\b|nachnahme|lastschrift|\bApple Pay\b|\bGoogle Pay\b/i,
	],
	[
		"a bank detail",
		/\bIBAN\b|\bBIC\b|\b[A-Z]{2}\d{2}[\sA-Z0-9]{12,32}\b|kontonummer|bankleitzahl/i,
	],
	[
		"a refund or resolution promise",
		/(erstatten|ersetzen|entschädigen) wir|volle erstattung|garantierte? (erstattung|rückerstattung)|innerhalb von \d+ (tagen|stunden) (bearbeitet|erstattet)/i,
	],
	[
		"an evidence requirement or deadline for a damaged parcel",
		/(foto|nachweis|beleg)[^.]{0,30}\b(erforderlich|beifügen|senden Sie)|binnen \d+ (tagen|stunden) (melden|anzeigen)/i,
	],
];

test("the page states no detail that has no authoritative source", () => {
	const text = body();
	const found = UNCONFIRMED_DETAILS.filter(([, pattern]) => pattern.test(text)).map(
		([label]) => `${SOURCE}: states ${label}`,
	);

	assert.deepEqual(found, []);
});

test("contact details are read from configuration, never written into the page", () => {
	const text = body();

	assert.match(source(), /from "\.\.\/lib\/company"/);
	assert.doesNotMatch(text, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, "email literal");
	assert.doesNotMatch(text, /(?:\+49|\b0\d{2,5})[\s/-]?\d{3,}/, "telephone number");
	assert.doesNotMatch(text, /\bmailto:|\btel:/, "hard-coded contact link");
	assert.match(text, /href="\/contact\/"/, "no link to the contact page");
});

test("the order-status section is derived from ORDERS_ENABLED, not asserted", () => {
	const text = source();

	assert.match(text, /import \{ ORDERS_ENABLED \} from "\.\.\/lib\/shop"/);
	assert.match(text, /!ORDERS_ENABLED && <OrdersClosedNotice/);
});

test("the page is registered in the content index", () => {
	// The source-level counterpart of the built-output check below. It was an
	// absence assertion until 2026-08-15, when the page became indexable.
	const index = readFileSync(join(SRC, "lib/content-index.ts"), "utf8");

	assert.match(index, /versand-zahlung/);
});

test("the footer points at the page itself, not at the contact-page anchor", () => {
	const layout = readFileSync(join(SRC, "layouts/BaseLayout.astro"), "utf8");

	assert.match(layout, /<a href="\/versand-zahlung\/">Versand/);
	assert.doesNotMatch(
		layout,
		/<a href="\/contact\/#versand-zahlung"/,
		"footer still links the old anchor",
	);
});

// ---------------------------------------------------------------------------
// 2. Built output
// ---------------------------------------------------------------------------

test("the page builds", { skip }, () => {
	assert.ok(existsSync(join(DIST, FILE)), `${PATH} missing from dist/`);
});

test("the page renders one H1, matching the page title", { skip }, () => {
	const headings = [...html().matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) =>
		match[1].replace(/<[^>]*>/g, "").trim(),
	);

	assert.deepEqual(headings, [H1]);
});

test("the page ships the approved title and description", { skip }, () => {
	const head = html().slice(0, html().indexOf("</head>") + 7);

	const titles = [...head.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((m) => m[1]);
	const descriptions = [...head.matchAll(/<meta name="description" content="([^"]*)"/g)].map(
		(m) => m[1],
	);

	assert.deepEqual(titles, [TITLE]);
	assert.deepEqual(descriptions, [DESCRIPTION]);
});

test("REGRESSION: the page is indexable and emits no robots directive", { skip }, () => {
	// Indexable since 2026-08-15 by owner decision: the shop is trading, so this
	// page has to be findable. It never carried a `[Platzhalter]` — the earlier
	// noindex guarded operational details that are not final, and those are still
	// named as open in the text rather than filled with a plausible value.
	const robots = [...html().matchAll(/<meta name="robots" content="([^"]*)"/g)].map((m) => m[1]);

	assert.deepEqual(robots, []);
});

test("the canonical is self-referencing and slashed", { skip }, () => {
	const canonicals = [...html().matchAll(/<link rel="canonical" href="([^"]*)"/g)].map(
		(m) => m[1],
	);

	assert.equal(canonicals.length, 1);

	const url = new URL(canonicals[0]);
	assert.equal(url.pathname, PATH);
	assert.equal(url.search, "");
});

test("the page is listed in a sitemap", { skip }, () => {
	// Follows from indexability: an indexable page withheld from the sitemap is
	// the mirror of the mistake this test used to guard. The legal pages are
	// the deliberate exception there — they are indexable but not final.
	const files = readdirSync(DIST, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.filter((name) => /^sitemap.*\.xml$/.test(name));

	const listing = files.filter((name) =>
		readFileSync(join(DIST, name), "utf8").includes("versand-zahlung"),
	);

	assert.ok(listing.length > 0, "indexable page missing from every sitemap");
});

/** Visible text of `<main>`, tags and entities removed. */
function mainText(): string {
	const main = html().match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
	assert.ok(main, `${PATH}: no <main>`);
	return main[1]
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ");
}

test("REGRESSION: the rendered fees are the ones the checkout uses", { skip }, () => {
	// Compared against `lib/pricing.ts` rather than against a literal, so raising
	// a fee in one place and not the other fails here instead of in a customer's
	// order.
	const text = nbsp(mainText());

	for (const [label, amount] of [
		["Germany", SHIPPING_FEE_EUR],
		["rest of Europe", SHIPPING_FEE_OUTSIDE_GERMANY_EUR],
		["free-shipping threshold", FREE_SHIPPING_THRESHOLD_EUR],
	] as const) {
		assert.ok(
			text.includes(nbsp(formatEur(amount))),
			`${PATH}: ${label} value ${formatEur(amount)} is not rendered`,
		);
	}
});

test("the rendered page covers the sections it exists for", { skip }, () => {
	const text = mainText();

	for (const phrase of [
		"Versandgebiete",
		"Versandkosten",
		"Lieferzeit",
		"Versanddienstleister und Sendungsverfolgung",
		"Zahlungsweise",
		"Aktueller Bestellstatus",
		"Beschädigte oder fehlende Sendungen",
		"Kontakt",
	]) {
		assert.ok(text.includes(phrase), `${PATH}: section "${phrase}" is missing`);
	}

	// The two delivery areas, and the payment method.
	assert.match(text, /Deutschland/);
	assert.match(text, /Übriges Europa/);
	assert.match(text, /Vorkasse per Banküberweisung/);
	// The draft notice has to remain visible while the details are open.
	assert.match(text, /Angaben noch nicht abschließend/);
});

test("REGRESSION: the rendered page states no unconfirmed detail", { skip }, () => {
	const text = mainText();
	const found = UNCONFIRMED_DETAILS.filter(([, pattern]) => pattern.test(text)).map(
		([label]) => `${PATH}: states ${label}`,
	);

	assert.deepEqual(found, []);
});

test("the footer link resolves directly, with no redirect", { skip }, () => {
	const served = new Set<string>();
	const walk = (dir: string, prefix = "") => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(join(dir, entry.name), rel);
			else if (rel.endsWith("/index.html")) served.add(`/${rel.slice(0, -"index.html".length)}`);
			else served.add(rel === "index.html" ? "/" : `/${rel}`);
		}
	};
	walk(DIST);

	assert.ok(served.has(PATH), `${PATH} does not answer 200`);
	// Astro appends a scoped-style attribute to the tag, so match around it.
	assert.match(html(), /<a href="\/versand-zahlung\/"[^>]*>Versand/);
});

// ---------------------------------------------------------------------------
// 3. Structured data
// ---------------------------------------------------------------------------

function graph(): Record<string, unknown>[] {
	const raw = html().match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
	assert.ok(raw, `${PATH}: no JSON-LD block`);

	const parsed = JSON.parse(raw[1]) as { "@graph"?: Record<string, unknown>[] };
	assert.ok(Array.isArray(parsed["@graph"]), `${PATH}: JSON-LD has no @graph`);
	return parsed["@graph"];
}

test("structured data parses and carries a breadcrumb", { skip }, () => {
	const crumbs = graph().find((node) => node["@type"] === "BreadcrumbList");
	assert.ok(crumbs, `${PATH}: no BreadcrumbList`);

	const items = crumbs.itemListElement as Array<Record<string, unknown>>;
	assert.equal(items.length, 2);
	assert.equal(new URL(String(items[0].item)).pathname, "/");
	assert.equal(new URL(String(items[1].item)).pathname, PATH);
});

test("the WebPage node matches the page canonical", { skip }, () => {
	const canonical = html().match(/<link rel="canonical" href="([^"]*)"/)![1];
	const page = graph().find((node) => node["@type"] === "WebPage");

	assert.ok(page, `${PATH}: no WebPage node`);
	assert.equal(page.url, canonical);
	assert.equal(page.name, H1);
});

test("REGRESSION: the page introduces no second Organization entity", { skip }, () => {
	const nodes = graph();
	const organizations = nodes.filter((node) => node["@type"] === "Organization");

	assert.equal(organizations.length, 1);
	assert.deepEqual(
		(nodes.find((node) => node["@type"] === "WebPage") as Record<string, unknown>).publisher,
		{ "@id": organizations[0]["@id"] },
	);
});
