/**
 * Guards on `/barrierefreiheit/`, the accessibility statement.
 *
 * An accessibility page fails in two directions, and both matter more here than
 * on an ordinary page:
 *
 * 1. **Claiming conformance it does not have.** WCAG, BITV or BFSG conformance,
 *    an audit, a certification, screen-reader test results, a remediation
 *    deadline — none of that exists in this repository. A visitor who relies on
 *    such a claim is exactly the person harmed when it turns out to be
 *    decoration.
 * 2. **Listing a measure that is not actually implemented.** So each measure
 *    the page names is checked here against the code that implements it. If
 *    someone removes the focus outlines, the visually-hidden search label or
 *    the system font stack, this test fails and the page stops claiming it.
 *
 * The metadata is pinned here rather than in `metadata-output.test.ts`: that
 * registry rejects a `<title>` equal to the H1, and on this page both are
 * "Barrierefreiheit" by design.
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

const PATH = "/barrierefreiheit/";
const FILE = "barrierefreiheit/index.html";
const SOURCE = "pages/barrierefreiheit.astro";

const H1 = "Barrierefreiheit";
const TITLE = "Barrierefreiheit";
const DESCRIPTION =
	"Informationen zur barrierearmen Nutzung der Website, bekannten Einschränkungen und zur Meldung digitaler Barrieren.";

const INTERNAL_LINKS = ["/contact/", "/support/anfrage/"];

const source = (): string => readFileSync(join(SRC, SOURCE), "utf8");
const html = (): string => readFileSync(join(DIST, FILE), "utf8");

function body(): string {
	return source()
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

// ---------------------------------------------------------------------------
// 1. Conformance claims — source scan, always runs
// ---------------------------------------------------------------------------

const UNSUPPORTED_A11Y_CLAIMS: Array<[label: string, pattern: RegExp]> = [
	[
		"a WCAG conformance claim",
		/\bWCAG\b|\bWAI\b|konformitätsstufe|stufe\s+A{1,3}\b|level\s+A{1,3}\b/i,
	],
	["a BITV or BFSG conformance claim", /\bBITV\b|\bBFSG\b|\bEN\s?301\s?549\b|barrierefreiheitsstärkungsgesetz/i],
	[
		"an audit or certification claim",
		/(barrierefreiheits|accessibility)[\s-]?(audit|zertifi)|zertifiziert|geprüft\s+(nach|durch)\s+\w+|prüfbericht\s+liegt|von\s+externen\s+prüfer/i,
	],
	[
		"a screen-reader testing claim",
		/(mit|von)\s+(screenreader|screen\s?reader|NVDA|JAWS|VoiceOver|TalkBack)\s+(getestet|geprüft)|getestet\s+mit\s+\w*(screenreader|NVDA|JAWS|VoiceOver)/i,
	],
	[
		"a full-accessibility or full-compliance claim",
		/vollständig\s+barrierefrei|uneingeschränkt\s+barrierefrei|barrierefrei\s+im\s+sinne\s+(des|der)|erfüllt\s+(alle|sämtliche)\s+anforderungen/i,
	],
	[
		"a remediation or response deadline",
		/(behoben|behebung|korrektur|antwort)\w*\s+(innerhalb|binnen)\s+\d|innerhalb von \d+\s*(tagen|wochen|monaten)|wir\s+beheben\s+(umgehend|innerhalb)/i,
	],
];

test("the page claims no conformance, audit or certification", () => {
	const text = body();
	const found = UNSUPPORTED_A11Y_CLAIMS.filter(([, pattern]) => pattern.test(text)).map(
		([label]) => `${SOURCE}: asserts ${label}`,
	);

	assert.deepEqual(found, []);
});

test("the page states plainly that it is not a certification", () => {
	const text = body();

	assert.match(text, /keine Konformitätserklärung|keine\s+Zertifizierung/);
	assert.match(text, /externe Prüfung dieser Website hat nicht stattgefunden/);
});

// ---------------------------------------------------------------------------
// 2. Every listed measure is actually implemented
// ---------------------------------------------------------------------------

const layout = (): string => readFileSync(join(SRC, "layouts/BaseLayout.astro"), "utf8");

test("the claimed focus states exist in the code", () => {
	const withFocusStyles = readdirSync(join(SRC, "pages"), { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".astro"))
		.filter((entry) =>
			readFileSync(join(SRC, "pages", entry.name), "utf8").includes(":focus-visible"),
		);

	assert.ok(withFocusStyles.length >= 5, "focus styles have disappeared from the pages");
	assert.match(source(), /:focus-visible/, "the page itself defines no focus-visible style");
});

test("REGRESSION: the header search field has a visible keyboard focus style", () => {
	// This is the defect the page used to disclose (fixed 2026-08-03). The input
	// still suppresses the UA ring so it does not sit inside the pill, so the
	// replacement indicator has to be there — on the pill for browsers with
	// `:has()`, on the input for those without.
	const markup = layout();

	assert.match(
		markup,
		/\.search:has\(input:focus-visible\)\s*\{[^}]*outline:\s*2px solid var\(--c-green\)/,
		"the search pill has no keyboard focus ring",
	);
	assert.match(
		markup,
		/\.search input:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--c-green\)/,
		"no fallback focus ring for browsers without :has()",
	);
	// An outline, not a colour swap — the page claims exactly that.
	assert.match(markup, /\.search:has\(input:focus-visible\)\s*\{[^}]*outline-offset/);
});

test("REGRESSION: the fixed search-focus limitation is gone from the page", () => {
	// A limitation is listed only while it is real; a stale disclosure sends a
	// keyboard user looking for a workaround they no longer need.
	const text = body();

	assert.doesNotMatch(text, /Suchfeld in der Kopfzeile[^.]*keinen sichtbaren Fokusrahmen/);
	assert.doesNotMatch(text, /Eine bekannte Ausnahme ist unten genannt/);
	// And the measure now states the field is covered.
	assert.match(text, /auch das Suchfeld in der Kopfzeile/);
});

test("the focus indicator is not colour-only, as the page claims", () => {
	// `outline` is a geometry change; a rule that only swapped a colour would
	// not satisfy the claim the page makes.
	assert.match(body(), /nicht nur eine Farbänderung/);
	assert.match(layout(), /outline:\s*2px solid/);
});

test("the claimed link and image labelling exists in the code", () => {
	const markup = layout();

	// The icon-only cart link and the search field are the two places the claim
	// rests on in shared markup.
	assert.match(markup, /aria-label="Warenkorb"/);
	assert.match(markup, /class="visually-hidden" for="site-search"/);
	// Product alt text is generated rather than written per image.
	assert.ok(existsSync(join(SRC, "lib/product-image-alt.ts")), "alt-text builder is missing");
});

test("the claimed responsive layout exists in the code", () => {
	const markup = layout();

	assert.match(markup, /name="viewport" content="width=device-width/);
	assert.match(markup, /@media \(max-width/);
});

test("every form input on the site has a label, as the page claims", () => {
	// The claim names three forms explicitly, so all three are counted.
	const forms: Array<[file: string, path: string]> = [
		["site search", "layouts/BaseLayout.astro"],
		["order lookup", "pages/bestellung/suchen.astro"],
		["checkout", "pages/kasse.astro"],
	];

	for (const [name, path] of forms) {
		const markup = readFileSync(join(SRC, path), "utf8");
		const inputs = [...markup.matchAll(/<input\b/g)].length;
		const labels = [...markup.matchAll(/<label\b/g)].length;

		assert.ok(inputs > 0, `${name}: no inputs found — the claim may be stale`);
		assert.ok(
			labels >= inputs,
			`${name}: ${inputs} inputs but only ${labels} labels`,
		);
	}
});

test("the claimed absence of web fonts still holds", () => {
	// `fonts.test.ts` owns this rule site-wide; this asserts the page may keep
	// claiming it.
	assert.ok(existsSync(join(SRC, "lib/fonts.test.ts")), "the font guard is gone");
	assert.doesNotMatch(layout(), /fonts\.googleapis|fonts\.gstatic|@font-face/i);
});

test("the known-limitations section states coverage, and only verified defects", () => {
	// It may name a defect that is checkable in the code (the search field, see
	// the regression test above) and must not turn into a speculative list.
	const text = body();

	assert.match(text, /nicht vollständig gegen einen Kriterienkatalog geprüft/);
	assert.doesNotMatch(text, /<li>[^<]*(funktioniert nicht|ist nicht bedienbar|fehlerhaft)/i);
});

test("the page invents no review date", () => {
	const text = body();

	// A date would have to come from a real review; none is recorded.
	assert.doesNotMatch(text, /Stand:\s*\d|\d{1,2}\.\s*\w+\s*20\d{2}|20\d{2}-\d{2}-\d{2}/);
	assert.match(text, /Prüf- oder\s*\n?\s*Freigabedatum wird nicht geführt/);
});

test("the report section asks for no sensitive data", () => {
	const text = body();

	assert.doesNotMatch(
		text,
		/(passwort|zugangsdaten|kreditkarte|iban|gesundheitsdaten)[^.]{0,40}\b(angeben|nennen|senden Sie|mitteilen)/i,
	);
	// It warns against them instead.
	assert.match(text, /Art\.\s*9\s*DSGVO/);
	assert.match(text, /keine Passwörter oder Zugangsdaten/);
});

test("contact details are read from configuration, never written into the page", () => {
	const text = body();

	assert.match(source(), /from "\.\.\/lib\/company"/);
	assert.doesNotMatch(text, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
	assert.doesNotMatch(text, /\bmailto:|\btel:/);
});

test("the page is listed in the content index exactly once", () => {
	const index = readFileSync(join(SRC, "lib/content-index.ts"), "utf8");

	assert.equal([...index.matchAll(/path:\s*"\/barrierefreiheit"/g)].length, 1);
});

test("the page is in no noindex registry", () => {
	const metadata = readFileSync(join(SRC, "lib/metadata-output.test.ts"), "utf8");
	const registry = /const MUST_STAY_NOINDEX = \[([\s\S]*?)\];/.exec(metadata)?.[1] ?? "";

	assert.doesNotMatch(registry, /barrierefreiheit/);
});

test("the footer links to the page, with the trailing slash", () => {
	assert.match(layout(), /<a href="\/barrierefreiheit\/">Barrierefreiheit<\/a>/);
	assert.doesNotMatch(layout(), /href="\/barrierefreiheit"[^/]/, "slashless footer href");
});

// ---------------------------------------------------------------------------
// 3. Built output
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

	assert.deepEqual(hits, ["sitemap-pages.xml"]);
});

test("the page is listed in llms.txt exactly once", { skip }, () => {
	const llms = readFileSync(join(DIST, "llms.txt"), "utf8");

	assert.equal([...llms.matchAll(/\/barrierefreiheit\/?[\s)]/g)].length, 1);
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
	assert.match(markup, /<a href="\/barrierefreiheit\/"[^>]*>Barrierefreiheit<\/a>/);
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

test("the rendered page covers every section", { skip }, () => {
	const text = mainText();

	for (const heading of [
		"Unser Ziel",
		"Bereits umgesetzte Maßnahmen",
		"Bekannte Einschränkungen",
		"Technische Kompatibilität",
		"Barriere melden",
		"Bearbeitung von Hinweisen",
		"Stand dieser Erklärung",
	]) {
		assert.ok(text.includes(heading), `${PATH}: section "${heading}" is missing`);
	}

	assert.match(text, /Informationsseite, keine Zertifizierung/);
});

test("REGRESSION: the rendered page makes no unsupported claim", { skip }, () => {
	const text = mainText();
	const found = UNSUPPORTED_A11Y_CLAIMS.filter(([, pattern]) => pattern.test(text)).map(
		([label]) => `${PATH}: asserts ${label}`,
	);

	assert.deepEqual(found, []);
});

test("the page practises what it documents: headings descend, links are labelled", { skip }, () => {
	const markup = html();

	const levels = [...markup.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
	const jumps: string[] = [];
	for (let i = 1; i < levels.length; i++) {
		if (levels[i] > levels[i - 1] + 1) jumps.push(`h${levels[i - 1]} → h${levels[i]}`);
	}
	assert.deepEqual(jumps, [], `${PATH}: heading level skipped`);

	const empty = [...markup.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].filter((match) => {
		const text = match[1].replace(/<[^>]*>/g, "").replace(/\s|&nbsp;/g, "");
		if (text.length > 0) return false;
		return !/aria-label=|<img[^>]+alt="[^"]+"/i.test(match[0] + match[1]);
	});
	assert.deepEqual(empty, [], `${PATH}: an unlabelled link shipped`);
});

// ---------------------------------------------------------------------------
// 4. Structured data
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
