/**
 * Guards on `/qualitaet-analyse/`, the analytical-documentation page.
 *
 * A page about quality data is the easiest place on the site to acquire a
 * capability the shop does not have. Every purity value in the catalog is
 * still placeholder (AGENTS.md), no laboratory relationship is recorded here,
 * and no accreditation or testing programme exists — so the page may explain
 * what a COA, an HPLC value or a mass spectrum *is*, and may not assert that
 * anything was tested, certified, guaranteed or independently verified. That
 * distinction is what the claim scan below pins.
 *
 * The second rule is that it explains rather than duplicates: the Wissen and
 * Lexikon entries own the subject matter, and this page must link to them, so a
 * later correction there is not silently contradicted here.
 *
 * Source scans always run; built-output checks are skipped without `dist/` —
 * `npm test` must not require a build (which needs the Medusa backend on
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

const PATH = "/qualitaet-analyse/";
const FILE = "qualitaet-analyse/index.html";
const SOURCE = "pages/qualitaet-analyse.astro";

const H1 = "Qualität, Analysedaten und Dokumentation";
const TITLE = "Qualität, Analysedaten und Dokumentation";
const DESCRIPTION =
	"Informationen zur Einordnung von Analysedaten, Chargendokumentation, COA, HPLC und Massenspektrometrie.";

/** Every internal link this page is expected to make. */
const INTERNAL_LINKS = [
	"/produkte/",
	"/contact/",
	"/wissen/reinheit-und-coa/",
	"/wissen/lexikon/coa/",
	"/wissen/lexikon/hplc/",
	"/wissen/lexikon/massenspektrometrie/",
	"/wissen/lexikon/reinheit/",
];

const source = (): string => readFileSync(join(SRC, SOURCE), "utf8");
const html = (): string => readFileSync(join(DIST, FILE), "utf8");

/** Body of the page source, comments removed — they discuss the rules. */
function body(): string {
	return source()
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

// ---------------------------------------------------------------------------
// 1. Claims about testing and documentation — source scan, always runs
// ---------------------------------------------------------------------------

/**
 * Each pattern targets an assertion about *this shop's* testing or documents,
 * not the vocabulary itself. Explaining that a COA usually carries a batch
 * number is expected; stating that every batch has one is the defect.
 */
const UNSUPPORTED_QUALITY_CLAIMS: Array<[label: string, pattern: RegExp]> = [
	[
		"a blanket testing or certificate claim",
		/(jede|jeder|jedes|alle)\s+(charge|chargen|produkte?|artikel)[^.]{0,50}\b(getestet|geprüft|zertifiziert|analysiert|dokumentiert)\b|zu\s+jed(er|em)\s+(charge|produkt)[^.]{0,40}\bvor\b|für\s+alle\s+produkte[^.]{0,30}(coa|zertifikat)/i,
	],
	[
		"an independent-testing claim",
		/unabhängig(e|es|en)?\s+(labor|prüfung|analyse|getestet|geprüft)|von\s+unabhängigen\s+laboren/i,
	],
	[
		"an accreditation or certification claim",
		/akkreditier|\bISO[\s-]?\d|\bGMP\b|zertifiziertes?\s+(labor|verfahren|qualitätsmanagement)|nach\s+DIN\s+EN/i,
	],
	[
		"a purity or quality guarantee",
		/garantiert(e|er|es)?\s+(reinheit|qualität|gehalt)|reinheit\s+(ist|wird)\s+garantiert|\b(mindestens|über)\s*\d{2}\s*%\s*rein/i,
	],
	[
		"a completeness claim about documentation",
		/vollständige\s+(dokumentation|unterlagen|chargendokumentation)\s+(liegt|liegen|für)|lückenlos/i,
	],
	[
		"a numeric purity or result value",
		/[>≥]\s*\d{2}(?:[.,]\d)?\s*%|\b\d{2}(?:[.,]\d)?\s*%\s*(hplc|reinheit)/i,
	],
	[
		"a laboratory relationship the repository does not record",
		/unser(em|e|)\s+(labor|prüflabor|partnerlabor)|hauseigene[sn]?\s+labor|wir\s+(testen|analysieren|prüfen)\s+(jede|alle|die)\b/i,
	],
	[
		"a medical or application statement",
		/dosierung|anwendung am (menschen|körper)|therapeutisch|wirkung (auf|bei|gegen)/i,
	],
];

test("the page makes no testing or documentation claim the shop cannot support", () => {
	const text = body();
	const found = UNSUPPORTED_QUALITY_CLAIMS.filter(([, pattern]) => pattern.test(text)).map(
		([label]) => `${SOURCE}: asserts ${label}`,
	);

	assert.deepEqual(found, []);
});

test("the page links the Wissen and Lexikon entries that own the subject matter", () => {
	const text = body();
	const missing = INTERNAL_LINKS.filter((href) => !text.includes(`href="${href}"`));

	assert.deepEqual(missing, [], `links missing from the page: ${missing.join(", ")}`);
});

test("the glossary entries this page depends on exist and are not drafts", () => {
	// A link here is the promise that the explanation continues there. If an
	// entry is removed or marked draft, its route stops being built and this
	// page ships a dead link.
	for (const id of ["coa", "hplc", "massenspektrometrie", "reinheit"]) {
		const file = join(SRC, `content/lexikon/${id}.md`);
		assert.ok(existsSync(file), `lexikon entry ${id} is missing`);
		assert.doesNotMatch(readFileSync(file, "utf8"), /^draft:\s*true/m, `${id} is a draft`);
	}

	const article = join(SRC, "content/wissen/reinheit-und-coa.md");
	assert.ok(existsSync(article), "wissen article reinheit-und-coa is missing");
	assert.doesNotMatch(readFileSync(article, "utf8"), /^draft:\s*true/m);
});

test("contact details are read from configuration, never written into the page", () => {
	const text = body();

	assert.match(source(), /from "\.\.\/lib\/company"/);
	assert.doesNotMatch(text, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, "email literal");
	assert.doesNotMatch(text, /(?:\+49|\b0\d{2,5})[\s/-]?\d{3,}/, "telephone number");
	assert.doesNotMatch(text, /\bmailto:|\btel:/, "hard-coded contact link");
});

test("the page is withheld from the sitemap and llms.txt inventory", () => {
	const index = readFileSync(join(SRC, "lib/content-index.ts"), "utf8");

	assert.doesNotMatch(index, /qualitaet-analyse/);
});

test("the footer links to the page, with the trailing slash", () => {
	const layout = readFileSync(join(SRC, "layouts/BaseLayout.astro"), "utf8");

	assert.match(layout, /<a href="\/qualitaet-analyse\/">Qualität/);
	assert.doesNotMatch(layout, /href="\/qualitaet-analyse"[^/]/, "slashless footer href");
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
		readFileSync(join(DIST, name), "utf8").includes("qualitaet-analyse"),
	);

	assert.deepEqual(leaking, [], `noindex page listed in: ${leaking.join(", ")}`);
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

test("the glossary links and the footer link are the ones expected", { skip }, () => {
	const markup = html();
	const served = servedPaths();

	for (const href of INTERNAL_LINKS) {
		assert.ok(markup.includes(`href="${href}"`), `${PATH}: ${href} is not linked`);
		assert.ok(served.has(href), `${href} does not answer 200`);
	}

	assert.ok(served.has(PATH), `${PATH} does not answer 200`);
	// Astro appends a scoped-style attribute to the tag, so match around it.
	assert.match(markup, /<a href="\/qualitaet-analyse\/"[^>]*>Qualität/);
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
		"Zweck dieser Seite",
		"Chargenbezogene Dokumentation",
		"Analysezertifikat / COA",
		"HPLC",
		"Massenspektrometrie",
		"Reinheit, Identität und Gehalt",
		"Externe Analysen",
		"Fehlende oder ausstehende Dokumentation",
		"Dokumentationsfrage melden",
	]) {
		assert.ok(text.includes(phrase), `${PATH}: section "${phrase}" is missing`);
	}

	// The three concepts must be distinguished, not merged.
	for (const term of ["Reinheit", "Identität", "Gehalt"]) {
		assert.ok(text.includes(term), `${PATH}: ${term} is not explained`);
	}

	// The draft notice has to remain visible.
	assert.match(text, /Immer produkt- und chargenbezogen prüfen/);
	assert.match(text, /keine Gesundheitsdaten/);
});

test("REGRESSION: the rendered page makes no unsupported quality claim", { skip }, () => {
	const text = mainText();
	const found = UNSUPPORTED_QUALITY_CLAIMS.filter(([, pattern]) => pattern.test(text)).map(
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
