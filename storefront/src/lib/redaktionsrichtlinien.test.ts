/**
 * Guards on `/redaktionsrichtlinien/`, the editorial-standards page.
 *
 * An editorial-standards page is a trust signal, and an indexable one, so an
 * unverifiable sentence here is worth more to a reader than anywhere else on
 * the site — which is exactly why it must not appear. There is no medical
 * reviewer, no named editor, no external peer review, no review schedule and no
 * certification behind this site, and the claim scan below rejects each of
 * them.
 *
 * The one date claim the page does make is checked against the code that would
 * have to back it: the Wissen article layout renders `dateModified`. The
 * Lexikon layout does not, so the page may not claim a date there.
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

const PATH = "/redaktionsrichtlinien/";
const FILE = "redaktionsrichtlinien/index.html";
const SOURCE = "pages/redaktionsrichtlinien.astro";

const H1 = "Redaktionsrichtlinien";
const TITLE = "Redaktionsrichtlinien und wissenschaftliche Quellen";
const DESCRIPTION =
	"Informationen zu Quellenwahl, wissenschaftlicher Einordnung, Aktualisierung und Korrekturen der redaktionellen Inhalte.";

/** Every internal route the page links to. */
const INTERNAL_LINKS = [
	"/wissen/",
	"/wissen/lexikon/",
	"/produkte/",
	"/qualitaet-analyse/",
	"/forschungszwecke/",
	"/contact/",
];

const source = (): string => readFileSync(join(SRC, SOURCE), "utf8");
const html = (): string => readFileSync(join(DIST, FILE), "utf8");

function body(): string {
	return source()
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

// ---------------------------------------------------------------------------
// 1. Editorial claims — source scan, always runs
// ---------------------------------------------------------------------------

/**
 * Each pattern targets an assertion about *this site's* editorial process that
 * nothing establishes. Naming peer-reviewed publications as a preferred source
 * type is expected and must not trip these — claiming this site's content is
 * peer reviewed is the defect.
 */
const UNSUPPORTED_EDITORIAL_CLAIMS: Array<[label: string, pattern: RegExp]> = [
	[
		"a medical or pharmacist review of this content",
		/(medizinisch|fachärztlich|ärztlich|pharmazeutisch)\s+(geprüft|reviewed|freigegeben|kontrolliert)|von\s+(ärzt|apotheker|mediziner)\w*\s+(geprüft|verfasst|freigegeben)|medical\s+review/i,
	],
	[
		"a named editor or editorial team",
		/unsere\s+redaktion|redaktionsteam|chefredak|verfasst\s+von\s+[A-ZÄÖÜ][a-zäöüß]+\s+[A-ZÄÖÜ]|autor(in)?:\s*[A-ZÄÖÜ]/i,
	],
	[
		"independent editorial ownership",
		/redaktionell\s+unabhängig|unabhängige\s+redaktion|journalistische\s+unabhängigkeit/i,
	],
	[
		"external peer review of this site's content",
		/(diese|unsere)\s+(inhalte|beiträge|artikel)[^.]{0,40}peer[\s-]?review|extern\w*\s+(begutachtet|peer[\s-]?review)|von\s+externen\s+(gutachtern|expert\w+)\s+geprüft/i,
	],
	[
		"a fixed review schedule",
		/(jährlich|quartalsweise|monatlich|halbjährlich|regelmäßig)\s+(überprüft|geprüft|reviewed)|alle\s+\d+\s*(monate|jahre)\s+(überprüft|geprüft)|prüfrhythmus\s+von/i,
	],
	[
		"complete citations on every article",
		/(jede|jeder|alle)\s+(aussage|angabe|beiträge?|artikel)[^.]{0,40}\b(belegt|mit quellen|zitiert|referenziert)\b|vollständig\s+(belegt|referenziert)|lückenlos\s+belegt/i,
	],
	[
		"a statement about AI-assisted drafting",
		/\bKI\b|künstliche(r|n)?\s+intelligenz|\bAI\b|sprachmodell|automatisch\s+(erstellt|generiert)/i,
	],
	[
		"a certification or editorial membership",
		/zertifiziert(e|es)?\s+(redaktion|inhalte)|\bHONcode\b|presserat|mitglied\s+(im|der)\s+\w+verband|\bISO[\s-]?\d/i,
	],
	[
		"a proven-effect or medical claim",
		/nachgewiesene?\s+wirkung|klinisch\s+belegt|therapeutisch\s+wirksam|dosierung\s+(von|beträgt)|heilt|lindert/i,
	],
	[
		"a response or correction-time promise",
		/(korrektur|antwort|bearbeitung)\w*\s+(innerhalb|binnen)|wir\s+(korrigieren|melden uns)\s+(umgehend|innerhalb|schnellstmöglich)/i,
	],
];

test("the page claims no editorial process the site does not have", () => {
	const text = body();
	const found = UNSUPPORTED_EDITORIAL_CLAIMS.filter(([, pattern]) => pattern.test(text)).map(
		([label]) => `${SOURCE}: asserts ${label}`,
	);

	assert.deepEqual(found, []);
});

test("the page states the source criteria without claiming current coverage", () => {
	const text = body();

	// The four source types are the point of the section …
	for (const type of ["peer-reviewte", "amtliche", "analytische", "Primärquellen"]) {
		assert.match(text, new RegExp(type, "i"), `source type ${type} is missing`);
	}
	// … and the disclaimer that coverage is not asserted must accompany them.
	assert.match(text, /behauptet nicht, dass bereits heute jede einzelne Aussage/);
});

test("the update-date claim is backed by the layout that renders it", () => {
	// The page says Wissen articles carry a visible update date. That is only
	// true while the article layout renders `dateModified`.
	const article = readFileSync(join(SRC, "pages/wissen/[slug].astro"), "utf8");
	assert.match(article, /Aktualisiert am \{formatDate\(data\.dateModified\)\}/);

	// The Lexikon layout renders no date, so the page must not claim one there.
	const term = readFileSync(join(SRC, "pages/wissen/lexikon/[slug].astro"), "utf8");
	assert.doesNotMatch(term, /Aktualisiert am/);
	assert.doesNotMatch(
		body(),
		/lexikon[^.]{0,60}(aktualisierungsdatum|datum)\s+(aus|wird|weist)/i,
		"the page claims a date the Lexikon does not render",
	);
});

test("the commercial context is disclosed rather than implied", () => {
	const text = body();

	assert.match(text, /betreibt zugleich einen Shop|Umfeld eines\s+Anbieters/);
	assert.match(text, /keine\s+Kaufempfehlung|bewirbt kein Produkt/);
});

test("the page is listed in the content index exactly once", () => {
	const index = readFileSync(join(SRC, "lib/content-index.ts"), "utf8");
	const matches = [...index.matchAll(/path:\s*"\/redaktionsrichtlinien"/g)];

	assert.equal(matches.length, 1, "expected exactly one entry in STATIC_ROUTES");
});

test("the page is in no noindex registry", () => {
	const metadata = readFileSync(join(SRC, "lib/metadata-output.test.ts"), "utf8");
	const registry = /const MUST_STAY_NOINDEX = \[([\s\S]*?)\];/.exec(metadata)?.[1] ?? "";

	assert.doesNotMatch(registry, /redaktionsrichtlinien/);
});

test("the footer links to the page, with the trailing slash", () => {
	const layout = readFileSync(join(SRC, "layouts/BaseLayout.astro"), "utf8");

	assert.match(layout, /<a href="\/redaktionsrichtlinien\/">Redaktionsrichtlinien<\/a>/);
	assert.doesNotMatch(layout, /href="\/redaktionsrichtlinien"[^/]/, "slashless footer href");
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

test("the page is listed in llms.txt exactly once", { skip }, () => {
	const llms = readFileSync(join(DIST, "llms.txt"), "utf8");

	assert.equal([...llms.matchAll(/\/redaktionsrichtlinien\/?[\s)]/g)].length, 1);
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

test("the expected internal links and the footer link are present", { skip }, () => {
	const markup = html();
	const served = servedPaths();

	for (const href of INTERNAL_LINKS) {
		assert.ok(markup.includes(`href="${href}"`), `${PATH}: ${href} is not linked`);
		assert.ok(served.has(href), `${href} does not answer 200`);
	}

	assert.ok(served.has(PATH), `${PATH} does not answer 200`);
	assert.match(markup, /<a href="\/redaktionsrichtlinien\/"[^>]*>Redaktionsrichtlinien<\/a>/);
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

test("the rendered page covers all ten sections", { skip }, () => {
	const text = mainText();

	for (const heading of [
		"Zweck der Richtlinien",
		"Trennung von Information und Produktdarstellung",
		"Auswahl von Quellen",
		"Wissenschaftliche Einordnung",
		"Sprache und Terminologie",
		"Produkt- und Analysedaten",
		"Aktualisierungen",
		"Korrekturen",
		"Interessenkonflikte und kommerzieller Kontext",
		"Keine medizinische Beratung",
	]) {
		assert.ok(text.includes(heading), `${PATH}: section "${heading}" is missing`);
	}
});

test("REGRESSION: the rendered page makes no unsupported editorial claim", { skip }, () => {
	const text = mainText();
	const found = UNSUPPORTED_EDITORIAL_CLAIMS.filter(([, pattern]) => pattern.test(text)).map(
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

test("WebPage and BreadcrumbList are present and resolve", { skip }, () => {
	const canonical = html().match(/<link rel="canonical" href="([^"]*)"/)![1];
	const nodes = graph();

	const page = nodes.find((node) => node["@type"] === "WebPage");
	assert.ok(page, `${PATH}: no WebPage node`);
	assert.equal(page.url, canonical);
	assert.equal(page.name, H1);

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
		(nodes.find((node) => node["@type"] === "WebPage") as Record<string, unknown>).publisher,
		{ "@id": organizations[0]["@id"] },
	);
});
