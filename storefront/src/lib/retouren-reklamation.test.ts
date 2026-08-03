/**
 * Guards on `/retouren-reklamation/`, the returns and complaints page.
 *
 * A returns policy is read as instructions and acted on, so the risk here is
 * not a broken build — it is a procedural detail that reads as settled while
 * nothing behind it exists: a return address, a reporting deadline, a refund
 * timeline, who pays return postage, which articles are excluded. None of that
 * is established anywhere in this repository (docs/go-live-checklist.md §1, §2,
 * §4), and each is pinned as absent below.
 *
 * The second rule is that this page states no legal right. `/widerruf/` is the
 * page that carries the Widerrufsbelehrung; this one links to it and must not
 * claim who is entitled to what.
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

const SRC = fileURLToPath(new URL("../", import.meta.url));
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const built = existsSync(DIST);
const skip = built ? false : "no dist/ — run `npm run build` first";

const PATH = "/retouren-reklamation/";
const FILE = "retouren-reklamation/index.html";
const SOURCE = "pages/retouren-reklamation.astro";

const H1 = "Retouren, Reklamationen und Erstattungen";
const TITLE = "Retouren, Reklamationen und Erstattungen";
const DESCRIPTION =
	"Informationen zu Rücksendungen, beschädigten oder fehlerhaften Lieferungen sowie zum aktuellen Bearbeitungsstand.";

const source = (): string => readFileSync(join(SRC, SOURCE), "utf8");
const html = (): string => readFileSync(join(DIST, FILE), "utf8");

/** Body of the page source, comments removed — they discuss the rules. */
function body(): string {
	return source()
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

// ---------------------------------------------------------------------------
// 1. Procedure that does not exist yet — source scan, always runs
// ---------------------------------------------------------------------------

/**
 * Each pattern targets the *assertion*, not the topic: the page is expected to
 * say that an address, a cost split or a refund route is still open, and must
 * only fail when it states one. So "wie die Kosten einer Rücksendung aufgeteilt
 * werden" is fine and "die Kosten der Rücksendung tragen Sie" is not.
 */
const UNSUPPORTED_PROCEDURE: Array<[label: string, pattern: RegExp]> = [
	[
		"a return address",
		/(rücksende|retouren|liefer)adresse\s*(lautet|:)|senden Sie (die Ware|das Paket|den Artikel|die Sendung) an\b|\b[A-ZÄÖÜ][a-zäöüß]+(?:straße|strasse|weg|allee|platz)\s+\d|\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]{2,}/,
	],
	[
		"a deadline or cancellation period",
		/binnen\s+\d|innerhalb\s+von\s+\d|\b\d+\s*(kalender|werk)?tagen?\b|frist\s+von\s+\d|spätestens\s+\d/i,
	],
	[
		"a refund timeline or guarantee",
		/(erstattung|rückzahlung)[^.]{0,40}(innerhalb|binnen|dauert|erfolgt\s+in)|garantierte?\s+(erstattung|rückzahlung)|(erstatten|zurückzahlen)\s+wir\s+(Ihnen\s+)?(den|die|das|alle)/i,
	],
	[
		"an allocation of return shipping cost",
		/(kosten|porto|versandkosten)[^.]{0,40}\b(tragen Sie|trägt der Kunde|übernehmen wir|trägt der Anbieter|gehen zu Ihren Lasten)/i,
	],
	[
		"a sealed-goods or hygiene exclusion",
		/versiegel|hygiene|§\s*312g|geöffnete\s+(vials?|packungen?)\s+(sind|können)\s+nicht/i,
	],
	[
		"an evidence requirement",
		/(foto|bild|nachweis|beleg|beweis)[^.]{0,40}\b(erforderlich|beifügen|mitschicken|senden Sie|benötigen wir)/i,
	],
	["a named carrier", /\bDHL\b|\bDPD\b|\bHermes\b|\bGLS\b|\bUPS\b|\bFedEx\b|Deutsche Post/i],
	[
		"a return-eligibility promise",
		/(jeder|jede|alle)\s+(artikel|produkte?|bestellung(en)?)[^.]{0,30}(zurückgesendet|zurückgegeben|retourniert)|können\s+(Sie\s+)?(jederzeit|immer)\s+zurücksenden|volles?\s+rückgaberecht/i,
	],
	[
		"a claim about who may buy or return",
		/\bB2B\b|nur an (unternehmen|gewerbliche|institutionen)|verbraucher (haben|können|steht)[^.]{0,30}(widerruf|rückgabe)|kein widerrufsrecht (für|bei)/i,
	],
	[
		"an active ordering or shipping statement",
		/jetzt bestellen|bestellungen? (sind|ist) (derzeit |aktuell )?möglich|versand erfolgt/i,
	],
	[
		"medical or application advice",
		/dosierung|anwendung am (menschen|körper)|therapeutisch|nebenwirkung/i,
	],
];

test("the page states no procedure the shop has not established", () => {
	const text = body();
	const found = UNSUPPORTED_PROCEDURE.filter(([, pattern]) => pattern.test(text)).map(
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

test("the page links the Widerrufsbelehrung instead of restating it", () => {
	assert.match(body(), /href="\/widerruf\/"/, "no link to /widerruf/");
});

test("REGRESSION: /widerruf/ itself is untouched and still draft", () => {
	// This page links there; it may not become a reason to edit the legal page.
	// `draft` is what keeps unreviewed legal text out of the index.
	const widerruf = readFileSync(join(SRC, "pages/widerruf.astro"), "utf8");

	assert.match(widerruf, /<LegalLayout[\s\S]*?\bdraft\b/, "widerruf.astro lost its draft flag");
	assert.match(widerruf, /Muster-Widerrufsformular/);
});

test("the order-status section is derived from ORDERS_ENABLED, not asserted", () => {
	const text = source();

	assert.match(text, /import \{ ORDERS_ENABLED \} from "\.\.\/lib\/shop"/);
	assert.match(text, /!ORDERS_ENABLED && <OrdersClosedNotice/);
});

test("the page is withheld from the sitemap and llms.txt inventory", () => {
	const index = readFileSync(join(SRC, "lib/content-index.ts"), "utf8");

	assert.doesNotMatch(index, /retouren-reklamation/);
});

test("the footer links to the page, with the trailing slash", () => {
	const layout = readFileSync(join(SRC, "layouts/BaseLayout.astro"), "utf8");

	assert.match(layout, /<a href="\/retouren-reklamation\/">Retouren/);
	assert.doesNotMatch(
		layout,
		/href="\/retouren-reklamation"[^/]/,
		"slashless footer href",
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

test("REGRESSION: the page stays noindex, nofollow", { skip }, () => {
	const robots = [...html().matchAll(/<meta name="robots" content="([^"]*)"/g)].map((m) => m[1]);

	assert.deepEqual(robots, ["noindex, nofollow"]);
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

test("the page appears in no sitemap and in no llms inventory", { skip }, () => {
	const files = readdirSync(DIST, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.filter((name) => /^sitemap.*\.xml$/.test(name) || /^llms(-full)?\.txt$/.test(name));

	const leaking = files.filter((name) =>
		readFileSync(join(DIST, name), "utf8").includes("retouren-reklamation"),
	);

	assert.deepEqual(leaking, [], `noindex page listed in: ${leaking.join(", ")}`);
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

test("the rendered page covers the sections it exists for", { skip }, () => {
	const text = mainText();

	for (const phrase of [
		"Aktueller Stand",
		"Kontakt vor einer Rücksendung",
		"Beschädigte, falsche oder unvollständige Lieferung",
		"Rücksendungen",
		"Erstattungen",
		"Widerrufsrecht",
		"Keine unaufgeforderten Rücksendungen",
		"Kontakt",
	]) {
		assert.ok(text.includes(phrase), `${PATH}: section "${phrase}" is missing`);
	}

	// The draft notice has to remain visible while the process is open.
	assert.match(text, /Vorgehen noch nicht abschließend festgelegt/);
	// The health-data warning on the contact section.
	assert.match(text, /keine Gesundheitsdaten/);
});

test("REGRESSION: the rendered page states no unsupported procedure", { skip }, () => {
	const text = mainText();
	const found = UNSUPPORTED_PROCEDURE.filter(([, pattern]) => pattern.test(text)).map(
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
	assert.match(html(), /<a href="\/retouren-reklamation\/"[^>]*>Retouren/);
	// And the link this page makes to the Widerrufsbelehrung must not redirect.
	assert.ok(served.has("/widerruf/"), "/widerruf/ does not answer 200");
	assert.match(html(), /href="\/widerruf\/"/);
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
