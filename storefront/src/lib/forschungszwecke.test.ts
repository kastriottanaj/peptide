/**
 * Guards on `/forschungszwecke/`, the research-use policy page.
 *
 * The page exists to restate restrictions that are already stated elsewhere, so
 * the risk it carries is not a broken build — it is a sentence that quietly
 * promises something the shop cannot back: a customer category, a verification
 * procedure, a guaranteed certificate, or an available order flow. The source
 * scans below pin that, and they always run.
 *
 * The second risk is the page becoming indexable. It has had no legal review,
 * so `noindex` and its absence from every sitemap are load-bearing, exactly as
 * `draft` is on the four legal pages. Those checks read the built output and are
 * skipped without `dist/` — `npm test` must not require a build (which needs the
 * Medusa backend on :9000). Run `npm run build` first to exercise them.
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

const PATH = "/forschungszwecke/";
const FILE = "forschungszwecke/index.html";
const SOURCE = "pages/forschungszwecke.astro";

const H1 = "Forschungszwecke und Produktbeschränkungen";
const TITLE = "Forschungszwecke und Produktbeschränkungen";
const DESCRIPTION =
	"Informationen zu Forschungszwecken, ausgeschlossenen Verwendungen und dem verantwortungsvollen Umgang mit Forschungsreagenzien.";

const source = (): string => readFileSync(join(SRC, SOURCE), "utf8");
const html = (): string => readFileSync(join(DIST, FILE), "utf8");

/** Body of the page source, block comments removed — they discuss the rules. */
function body(): string {
	return source()
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

// ---------------------------------------------------------------------------
// 1. Claims the page may not make — source scan, always runs
// ---------------------------------------------------------------------------

/**
 * Each pattern is a statement nothing in this repository establishes. They are
 * written to catch the paraphrase as well as one wording: the point is that the
 * *claim* cannot appear, not that one sentence cannot.
 *
 * `operational-claims.test.ts` already scans every source file for the
 * site-wide set (tax treatment, delivery times, a business being set up). These
 * are the ones specific to a research-use policy: who may buy, what is verified,
 * and what is guaranteed.
 */
const FORBIDDEN_CLAIMS: Array<[label: string, pattern: RegExp]> = [
	[
		"a B2B-only or institution-only restriction",
		/nur an (unternehmen|gewerbliche|institutionen|einrichtungen)|ausschließlich an (unternehmen|gewerbliche|institutionen|einrichtungen)|\bB2B\b|kein verkauf an (verbraucher|privat)/i,
	],
	[
		"a consumer-eligibility statement",
		/verbraucher (können|dürfen|sind berechtigt)|auch an privatpersonen/i,
	],
	["a minimum-age rule", /mindestalter|ab 18 jahren|volljährig/i],
	[
		"a customer-verification procedure",
		/(identität|institution|einrichtung|nachweis)[^.]{0,40}\b(wird|werden)\s+(von uns\s+)?(geprüft|verifiziert|überprüft)|verifizierung(spflicht)?|nachweispflicht/i,
	],
	[
		"a legal-approval or compliance claim",
		/rechtlich (geprüft|zulässig|unbedenklich)|juristisch geprüft|(in|für) allen? ländern? (zulässig|erlaubt|legal)|entspricht (allen|sämtlichen) (rechtlichen|gesetzlichen)/i,
	],
	[
		"a documentation or purity guarantee",
		/(jede|jeder|alle)\s+(charge|produkte?)[^.]{0,30}(getestet|zertifiziert|geprüft)|garantierte?\s+(reinheit|dokumentation|qualität)|liegt (immer|stets|zu jedem produkt) ein? (coa|analysezertifikat)/i,
	],
	[
		"an active ordering, payment or shipping statement",
		/jetzt bestellen|bestellungen? (sind|ist) (derzeit |aktuell )?möglich|versand erfolgt|zahlung ist möglich/i,
	],
	[
		"a medical, physiological or therapeutic effect",
		/\bwirkung(en)? (auf|bei|gegen)\b|therapeutisch wirksam|heilt|lindert|behandelt (erfolgreich|wirksam)/i,
	],
];

test("the policy page makes no claim the shop cannot support", () => {
	const text = body();
	const found = FORBIDDEN_CLAIMS.filter(([, pattern]) => pattern.test(text)).map(
		([label]) => `${SOURCE}: asserts ${label}`,
	);

	assert.deepEqual(found, []);
});

test("the policy page hard-codes no contact channel of its own", () => {
	// Contact details are configuration (`lib/company.ts`) and belong on
	// `/contact/`. A second copy here is a fabricated trust signal the moment it
	// goes stale — this page links to the contact page instead.
	const text = body();

	assert.doesNotMatch(text, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, "email literal");
	assert.doesNotMatch(text, /(?:\+49|\b0\d{2,5})[\s/-]?\d{3,}/, "telephone number");
	assert.doesNotMatch(text, /\bmailto:|\btel:/, "hard-coded contact link");
	assert.match(text, /href="\/contact\/"/, "no link to the contact page");
});

test("the order-status section is derived from ORDERS_ENABLED, not asserted", () => {
	// The mechanism behind the "ordering stays closed" rule: if the page stops
	// reading the switch, its order-status section becomes a standalone claim
	// that no longer follows the shop.
	const text = source();

	assert.match(text, /import \{ ORDERS_ENABLED \} from "\.\.\/lib\/shop"/);
	assert.match(text, /!ORDERS_ENABLED && <OrdersClosedNotice/);
});

test("the page is withheld from the sitemap and llms.txt inventory", () => {
	// `content-index.ts` is the single place that decides which URLs are
	// published. A noindex page listed there would be a contradictory signal.
	const index = readFileSync(join(SRC, "lib/content-index.ts"), "utf8");

	assert.doesNotMatch(index, /forschungszwecke/);
});

test("the footer links to the page, with the trailing slash", () => {
	const layout = readFileSync(join(SRC, "layouts/BaseLayout.astro"), "utf8");

	assert.match(layout, /href="\/forschungszwecke\/"/);
	assert.doesNotMatch(layout, /href="\/forschungszwecke"[^/]/, "slashless footer href");
});

// ---------------------------------------------------------------------------
// 2. Built output
// ---------------------------------------------------------------------------

test("the page builds", { skip }, () => {
	assert.ok(existsSync(join(DIST, FILE)), `${PATH} missing from dist/`);
});

test("the page renders one H1, matching the policy title", { skip }, () => {
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
	// The only thing keeping text that has not had legal review out of the index,
	// the same role `draft` plays on the legal pages. Removing it to satisfy an
	// SEO audit is the mistake this pins.
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
		readFileSync(join(DIST, name), "utf8").includes("forschungszwecke"),
	);

	assert.deepEqual(leaking, [], `noindex page listed in: ${leaking.join(", ")}`);
});

test("the footer link resolves directly, with no redirect", { skip }, () => {
	// The footer renders into every page, so a slashless href here would be one
	// internal redirect per page on the site.
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
	assert.match(html(), /<a href="\/forschungszwecke\/"[^>]*>Forschungszwecke<\/a>/);
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

test("the rendered page states the restrictions it exists for", { skip }, () => {
	const text = mainText();

	for (const phrase of [
		"Ausschließlich für Forschung und Analyse",
		"Ausgeschlossene Verwendungen",
		"Keine medizinische oder anwendungsbezogene Beratung",
		"Verantwortung der anfragenden Person",
		"Dokumentation und Analysedaten",
		"Ungeeignete oder unklare Anfragen",
		"Kontakt bei Fragen",
		"Hinweis zum Bestellstatus",
	]) {
		assert.ok(text.includes(phrase), `${PATH}: section "${phrase}" is missing`);
	}

	// The draft notice has to remain visible while the noindex is in force.
	assert.match(text, /keine Rechtsberatung/);
});

test("REGRESSION: the rendered page makes no forbidden claim", { skip }, () => {
	const text = mainText();
	const found = FORBIDDEN_CLAIMS.filter(([, pattern]) => pattern.test(text)).map(
		([label]) => `${PATH}: asserts ${label}`,
	);

	assert.deepEqual(found, []);
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
	const nodes = graph();
	const crumbs = nodes.find((node) => node["@type"] === "BreadcrumbList");

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
	// `Seo.astro` emits the Organization node on every page; everything else
	// references it by @id.
	const nodes = graph();
	const organizations = nodes.filter((node) => node["@type"] === "Organization");

	assert.equal(organizations.length, 1);
	assert.deepEqual(
		(nodes.find((node) => node["@type"] === "WebPage") as Record<string, unknown>).publisher,
		{ "@id": organizations[0]["@id"] },
	);
});
