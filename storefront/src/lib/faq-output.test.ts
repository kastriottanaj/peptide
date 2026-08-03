/**
 * Guards on `/faq/`, the one indexable page added in this series.
 *
 * Indexability changes what can go wrong. The other new pages are `noindex`, so
 * a weak sentence stays between the site and one visitor; an FAQ answer is
 * eligible for a rich result and can be read, quoted and acted on without the
 * page ever being opened. Three rules follow, and each is pinned here:
 *
 * 1. **The schema is the visible answer.** Google requires FAQ structured data
 *    to match the visible content. The page builds both from one array, and the
 *    test below compares the rendered `<dd>` text against
 *    `acceptedAnswer.text` — not that both exist, but that they are the same
 *    string. Schema-only questions are rejected the same way.
 * 2. **No claim the site cannot support.** Delivery times, carriers,
 *    certificate guarantees, refund timelines and any medical statement are out,
 *    exactly as on the pages the answers link to.
 * 3. **It is indexable and discoverable.** No robots directive, a
 *    self-referencing canonical, and exactly one entry in exactly one sitemap —
 *    an indexable page missing from the sitemap is the mirror image of the
 *    noindex-in-sitemap contradiction the other tests pin.
 *
 * Source scans always run; built-output checks are skipped without `dist/`.
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

const PATH = "/faq/";
const FILE = "faq/index.html";
const SOURCE = "pages/faq.astro";

const H1 = "Häufige Fragen";
const TITLE = "Häufige Fragen zu Forschungspeptiden";
const DESCRIPTION =
	"Antworten zu Forschungszwecken, Produktinformationen, Analysedaten, Bestellstatus, Versand, Zahlung und Support.";

/** The twelve questions, in the order the brief lists them. */
const QUESTIONS = [
	"Wofür sind die angebotenen Produkte bestimmt?",
	"Sind die Produkte für Menschen oder Tiere bestimmt?",
	"Sind die Produkte Arzneimittel, Nahrungsergänzungsmittel oder Kosmetika?",
	"Ist eine Bestellung derzeit möglich?",
	"Wo finde ich Informationen zu Versand und Zahlung?",
	"Welche Analysedaten oder Dokumente sind verfügbar?",
	"Was bedeuten COA, HPLC und Massenspektrometrie?",
	"Wie stelle ich eine Support-Anfrage?",
	"Wie werden Retouren oder Reklamationen behandelt?",
	"Welche Angaben sollte ich bei einer Dokumentationsfrage nennen?",
	"Wo finde ich allgemeine Informationen über Peptide?",
	"Gibt die Website medizinische Beratung?",
];

/** Every internal route the answers point at. */
const INTERNAL_LINKS = [
	"/forschungszwecke/",
	"/versand-zahlung/",
	"/qualitaet-analyse/",
	"/retouren-reklamation/",
	"/support/anfrage/",
	"/contact/",
	"/wissen/",
	"/wissen/lexikon/",
	"/wissen/lexikon/coa/",
	"/wissen/lexikon/hplc/",
	"/wissen/lexikon/massenspektrometrie/",
	"/wissen/reinheit-und-coa/",
];

const source = (): string => readFileSync(join(SRC, SOURCE), "utf8");
const html = (): string => readFileSync(join(DIST, FILE), "utf8");

function body(): string {
	return source()
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

/** Collapse whitespace so markup indentation does not count as a difference. */
const norm = (value: string): string =>
	value.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// 1. Source — always runs
// ---------------------------------------------------------------------------

const FORBIDDEN_FAQ_CLAIMS: Array<[label: string, pattern: RegExp]> = [
	[
		"a delivery-time or carrier claim",
		/\d\s*[–—-]?\s*\d?\s*werktage?n?|(lieferung|zustellung|versand)\s+(in|innerhalb|binnen)\s+\d|\bDHL\b|\bDPD\b|\bHermes\b|\bGLS\b|\bUPS\b/i,
	],
	[
		"a payment-method or bank detail",
		/\bIBAN\b|\bBIC\b|\bPayPal\b|\bKlarna\b|kreditkarte|nachnahme|\bStripe\b|\bWise\b/i,
	],
	[
		"a refund or deadline promise",
		/(erstatten|zurückzahlen)\s+wir|garantierte?\s+(erstattung|rückzahlung)|binnen\s+\d|widerrufsfrist\s+von\s+\d/i,
	],
	[
		"a certificate, testing or purity guarantee",
		/(jede|jeder|alle)\s+(charge|produkte?)[^.]{0,40}(getestet|zertifiziert|geprüft)|garantiert(e|er|es)?\s+(reinheit|qualität)|unabhängig\w*\s+(geprüft|getestet|labor)|akkreditier|\bISO[\s-]?\d/i,
	],
	[
		"a medical, dosage or application statement",
		/dosierung\s+(von|für|beträgt)|so\s+(wird|wenden Sie)[^.]{0,20}an\b|therapeutisch\s+wirksam|wirkung\s+(auf|bei|gegen)|nebenwirkung/i,
	],
	[
		"a response-time promise",
		/(antwort|rückmeldung|bearbeitung)\w*\s+(innerhalb|binnen)|wir\s+melden\s+uns|innerhalb von \d+\s*(stunden|tagen)/i,
	],
];

test("no FAQ answer makes a claim the site cannot support", () => {
	const text = body();
	const found = FORBIDDEN_FAQ_CLAIMS.filter(([, pattern]) => pattern.test(text)).map(
		([label]) => `${SOURCE}: contains ${label}`,
	);

	assert.deepEqual(found, []);
});

test("the order-status answer is derived from the shared switch and copy", () => {
	// Hard-coding "Bestellungen sind möglich" here is exactly the contradiction
	// this page could introduce: the FAQ is the page people quote.
	const text = source();

	assert.match(text, /import \{ ORDERS_ENABLED, ORDERS_CLOSED_TEXT \} from "\.\.\/lib\/shop"/);
	assert.match(text, /orderStatusAnswer/);
	assert.match(text, /ORDERS_ENABLED\s*\n?\s*\?/);
});

test("the schema and the visible answers are built from one array", () => {
	// The mechanism the output comparison depends on.
	const text = source();

	assert.match(text, /mainEntity: faqs\.map\(/);
	assert.match(text, /acceptedAnswer: \{ "@type": "Answer", text: answerText\(item\) \}/);
	assert.match(text, /faqs\.map\(\(item\)/);
});

test("the page carries no JavaScript of its own", () => {
	// Both existing FAQ patterns on this site are zero-JS; an accordion script
	// would be the first client bundle on an otherwise static page.
	assert.doesNotMatch(body(), /<script\b/i);
});

test("the page is listed in the content index exactly once", () => {
	const index = readFileSync(join(SRC, "lib/content-index.ts"), "utf8");
	const matches = [...index.matchAll(/path:\s*"\/faq"/g)];

	assert.equal(matches.length, 1, "expected exactly one /faq entry in STATIC_ROUTES");
});

test("the page is in no noindex registry", () => {
	const metadata = readFileSync(join(SRC, "lib/metadata-output.test.ts"), "utf8");
	const registry = /const MUST_STAY_NOINDEX = \[([\s\S]*?)\];/.exec(metadata)?.[1] ?? "";

	assert.doesNotMatch(registry, /faq/, "/faq/ must not be registered as noindex");
});

test("the footer links to the page, with the trailing slash", () => {
	const layout = readFileSync(join(SRC, "layouts/BaseLayout.astro"), "utf8");

	assert.match(layout, /<a href="\/faq\/">FAQ<\/a>/);
	assert.doesNotMatch(layout, /href="\/faq"[^/]/, "slashless footer href");
});

test("REGRESSION: the homepage FAQ is untouched", () => {
	// This page is additional to the homepage teaser, not a replacement, and the
	// homepage keeps its own FAQPage node.
	const home = readFileSync(join(SRC, "pages/index.astro"), "utf8");

	assert.match(home, /const faqs = \[/);
	assert.match(home, /"@type": "FAQPage"/);
});

// ---------------------------------------------------------------------------
// 2. Built output
// ---------------------------------------------------------------------------

test("the page builds", { skip }, () => {
	assert.ok(existsSync(join(DIST, FILE)), `${PATH} missing from dist/`);
});

test("the page renders one H1 and the approved metadata", { skip }, () => {
	const markup = html();
	const head = markup.slice(0, markup.indexOf("</head>") + 7);

	const headings = [...markup.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) =>
		m[1].replace(/<[^>]*>/g, "").trim(),
	);
	assert.deepEqual(headings, [H1]);

	assert.deepEqual(
		[...head.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((m) => m[1]),
		[TITLE],
	);
	assert.deepEqual(
		[...head.matchAll(/<meta name="description" content="([^"]*)"/g)].map((m) => m[1]),
		[DESCRIPTION],
	);
});

test("the page is indexable: no robots directive at all", { skip }, () => {
	assert.deepEqual(
		[...html().matchAll(/<meta name="robots" content="([^"]*)"/g)].map((m) => m[1]),
		[],
		`${PATH} must not emit a robots directive`,
	);
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

test("the page appears exactly once, in the pages sitemap only", { skip }, () => {
	const sitemaps = readdirSync(DIST, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /^sitemap.*\.xml$/.test(entry.name))
		.map((entry) => entry.name);

	const hits: string[] = [];
	for (const name of sitemaps) {
		const locs = [
			...readFileSync(join(DIST, name), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g),
		].map((m) => m[1]);
		for (const loc of locs) {
			if (new URL(loc).pathname === PATH) hits.push(name);
		}
	}

	assert.deepEqual(hits, ["sitemap-pages.xml"], `unexpected sitemap placement: ${hits}`);
});

test("the page is listed in llms.txt", { skip }, () => {
	const llms = readFileSync(join(DIST, "llms.txt"), "utf8");

	assert.equal(
		[...llms.matchAll(/\/faq\/?\b/g)].length >= 1,
		true,
		"/faq is missing from llms.txt",
	);
});

/** Every path the built output answers with 200. */
function servedPaths(): Set<string> {
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
	return served;
}

test("every link on the page resolves directly, with no redirect", { skip }, () => {
	const served = servedPaths();
	const broken: string[] = [];

	for (const match of html().matchAll(/<a\b[^>]*href="(\/[^"]*)"/gi)) {
		const path = match[1].split("#")[0].split("?")[0];
		if (path === "") continue;
		if (!served.has(path)) broken.push(`${PATH}: ${match[1]}`);
	}

	assert.deepEqual(broken, []);
});

test("every answer's link target is present and served", { skip }, () => {
	const markup = html();
	const served = servedPaths();

	for (const href of INTERNAL_LINKS) {
		assert.ok(markup.includes(`href="${href}"`), `${PATH}: ${href} is not linked`);
		assert.ok(served.has(href), `${href} does not answer 200`);
	}

	assert.ok(served.has(PATH), `${PATH} does not answer 200`);
	assert.match(markup, /<a href="\/faq\/"[^>]*>FAQ<\/a>/);
});

// ---------------------------------------------------------------------------
// 3. Structured data — the schema must be the visible content
// ---------------------------------------------------------------------------

function graph(): Record<string, unknown>[] {
	const raw = html().match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
	assert.ok(raw, `${PATH}: no JSON-LD block`);

	const parsed = JSON.parse(raw[1]) as { "@graph"?: Record<string, unknown>[] };
	assert.ok(Array.isArray(parsed["@graph"]), `${PATH}: JSON-LD has no @graph`);
	return parsed["@graph"];
}

/** The visible question/answer pairs, read out of the rendered `<dl>`. */
function visiblePairs(): Array<{ question: string; answer: string }> {
	const markup = html();
	const list = markup.match(/<dl class="faq"[^>]*>([\s\S]*?)<\/dl>/);
	assert.ok(list, `${PATH}: no FAQ list`);

	const questions = [...list[1].matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>/g)].map((m) =>
		norm(m[1].replace(/<[^>]*>/g, "")),
	);
	const answers = [...list[1].matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)].map((m) =>
		norm(m[1].replace(/<[^>]*>/g, "")),
	);

	assert.equal(questions.length, answers.length, "a question without an answer");
	return questions.map((question, i) => ({ question, answer: answers[i] }));
}

test("the page shows all twelve questions, in order", { skip }, () => {
	assert.deepEqual(
		visiblePairs().map((pair) => pair.question),
		QUESTIONS,
	);
});

test("REGRESSION: the FAQPage schema is exactly the visible content", { skip }, () => {
	// Not "both exist" — the same strings. A schema-only question, a reworded
	// answer or a dropped one all fail here.
	const faqPage = graph().find((node) => node["@type"] === "FAQPage");
	assert.ok(faqPage, `${PATH}: no FAQPage node`);

	const entities = faqPage.mainEntity as Array<Record<string, any>>;
	const fromSchema = entities.map((entity) => ({
		question: norm(String(entity.name)),
		answer: norm(String(entity.acceptedAnswer.text)),
	}));

	assert.deepEqual(fromSchema, visiblePairs());

	for (const entity of entities) {
		assert.equal(entity["@type"], "Question");
		assert.equal(entity.acceptedAnswer["@type"], "Answer");
		assert.ok(String(entity.acceptedAnswer.text).length > 0, "empty answer");
	}
});

test("the FAQPage url matches the canonical, and the breadcrumb resolves", { skip }, () => {
	const canonical = html().match(/<link rel="canonical" href="([^"]*)"/)![1];
	const nodes = graph();

	const faqPage = nodes.find((node) => node["@type"] === "FAQPage")!;
	assert.equal(faqPage.url, canonical);

	const crumbs = nodes.find((node) => node["@type"] === "BreadcrumbList");
	assert.ok(crumbs, `${PATH}: no BreadcrumbList`);

	const paths = (crumbs.itemListElement as Array<Record<string, unknown>>).map(
		(item) => new URL(String(item.item)).pathname,
	);
	assert.deepEqual(paths, ["/", PATH]);

	const served = servedPaths();
	for (const path of paths) assert.ok(served.has(path), `breadcrumb item ${path} is not served`);
});

test("REGRESSION: the page introduces no second Organization entity", { skip }, () => {
	const nodes = graph();
	const organizations = nodes.filter((node) => node["@type"] === "Organization");

	assert.equal(organizations.length, 1);
	assert.deepEqual(
		(nodes.find((node) => node["@type"] === "FAQPage") as Record<string, unknown>).publisher,
		{ "@id": organizations[0]["@id"] },
	);
});

test("REGRESSION: the rendered answers make no forbidden claim", { skip }, () => {
	const text = visiblePairs()
		.map((pair) => `${pair.question} ${pair.answer}`)
		.join(" ");

	const found = FORBIDDEN_FAQ_CLAIMS.filter(([, pattern]) => pattern.test(text)).map(
		([label]) => `${PATH}: contains ${label}`,
	);

	assert.deepEqual(found, []);
});
