/**
 * Guards on `/support/anfrage/`, the support routing page.
 *
 * Three things make a support page dangerous on this site, and each is pinned
 * below:
 *
 * 1. **A form.** There is no form endpoint in a static build and no mail
 *    transport in the backend (docs/go-live-checklist.md §6), so a form would
 *    accept a message and drop it. `/contact/` refuses one for the same reason;
 *    the only form allowed on any page is the site search that `BaseLayout`
 *    renders into every document.
 * 2. **A response-time promise.** Nothing here can keep one — no ticketing, no
 *    mail, no staffing recorded anywhere in this repository.
 * 3. **A request for data that must not be sent.** A support page is exactly
 *    where "please send your card details" or a health history gets asked for.
 *    The page may warn against them; it may not ask for them.
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

const PATH = "/support/anfrage/";
const FILE = "support/anfrage/index.html";
const SOURCE = "pages/support/anfrage.astro";

const H1 = "Support-Anfrage";
const TITLE = "Support-Anfrage";
const DESCRIPTION =
	"Kontaktmöglichkeiten für Fragen zu Bestellungen, Versand, Dokumentation, Retouren, Datenschutz und technischen Problemen.";

/** The nine categories the page must offer, in the order it lists them. */
const CATEGORIES = [
	"Bestehende Bestellung",
	"Rechnung oder Zahlungsreferenz",
	"Versandstatus",
	"Analysedaten oder Dokumentation",
	"Beschädigte, falsche oder unvollständige Lieferung",
	"Stornierung, Retoure oder Erstattung",
	"Datenschutzanfrage",
	"Technisches Problem mit der Website",
	"Allgemeine Frage",
];

/** Every internal route this page routes to. */
const INTERNAL_LINKS = [
	"/contact/",
	"/datenschutz/",
	"/bestellung/suchen/",
	"/versand-zahlung/",
	"/retouren-reklamation/",
	"/qualitaet-analyse/",
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
// 1. Source — always runs
// ---------------------------------------------------------------------------

const FORBIDDEN_SUPPORT_CLAIMS: Array<[label: string, pattern: RegExp]> = [
	[
		"a response-time or processing promise",
		/(antwort|rückmeldung|bearbeitung|reaktion)\w*\s+(innerhalb|binnen|in der regel innerhalb)|innerhalb von \d+\s*(stunden|werktagen|tagen)|wir\s+(antworten|melden uns|bearbeiten)\s+(innerhalb|umgehend|schnellstmöglich)|\b24\/7\b|rund um die uhr/i,
	],
	[
		"a promise to make contact that no system can keep",
		/wir\s+melden\s+uns|sie\s+erhalten\s+(dann\s+)?(eine\s+)?(nachricht|e-?mail)\s+von\s+uns|senden\s+wir\s+Ihnen\s+(eine\s+)?e-?mail/i,
	],
	[
		"a contact form that does not exist",
		/(über|via|per|durch)\s+(das|unser|ein)\s+kontaktformular|kontaktformular\s+(nutzen|verwenden|ausfüllen|absenden)|formular\s+(unten\s+)?(ausfüllen|absenden)/i,
	],
	[
		"a request for credentials or payment data",
		/(passwort|kennwort|zugangsdaten|kreditkarten\w*|kartennummer|\bPIN\b|\bTAN\b|kontodaten|\bIBAN\b)[^.]{0,40}\b(angeben|nennen|mitteilen|senden Sie|schicken Sie|beifügen|bereithalten)/i,
	],
	[
		"a request for health or dosage information",
		/(gesundheit\w*|symptom\w*|diagnose|dosierung|einnahme)[^.]{0,40}\b(angeben|nennen|mitteilen|beschreiben Sie|schildern Sie|senden Sie)/i,
	],
	[
		"a staffing or availability claim",
		/support[\s-]?team|unsere mitarbeiter|servicezeiten|erreichbar von|mo\W?\s?fr\s+\d/i,
	],
	[
		"an active ordering or payment statement",
		/jetzt bestellen|zahlung (ist|kann) (jetzt |derzeit )?(möglich|erfolgen)|bestellungen? (sind|ist) (derzeit |aktuell )?möglich/i,
	],
];

test("the page makes no support promise the site cannot keep", () => {
	const text = body();
	const found = FORBIDDEN_SUPPORT_CLAIMS.filter(([, pattern]) => pattern.test(text)).map(
		([label]) => `${SOURCE}: contains ${label}`,
	);

	assert.deepEqual(found, []);
});

test("the page ships no form, because nothing would receive it", () => {
	// The rule `/contact/` follows, for the same reason. The site search form is
	// rendered by BaseLayout into every page and is not this page's markup.
	const text = body();

	assert.doesNotMatch(text, /<form\b/i, "the page defines a form");
	assert.doesNotMatch(text, /<input\b|<textarea\b|<button[^>]*type="submit"/i);
});

test("the page warns against sensitive data instead of asking for it", () => {
	const text = body();

	// The warning must be present — its absence is how the page becomes the
	// place someone pastes a health history.
	assert.match(text, /Art\.\s*9\s*DSGVO/);
	assert.match(text, /Passwörter|Zugangsdaten/);
});

test("contact details are read from configuration, never written into the page", () => {
	const text = body();

	assert.match(source(), /from "\.\.\/\.\.\/lib\/company"/);
	// The mailto is rendered from the configured value, guarded on it existing.
	assert.match(text, /CONTACT\.email\s*&&/);
	assert.match(text, /mailtoHref\(CONTACT\.email\)/);
	// And no literal address, number or mailto is written into the page.
	assert.doesNotMatch(text, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, "email literal");
	assert.doesNotMatch(text, /(?:\+49|\b0\d{2,5})[\s/-]?\d{3,}/, "telephone number");
	assert.doesNotMatch(text, /href="mailto:[^"]/, "hard-coded mailto");
});

test("the order-status section is derived from ORDERS_ENABLED, not asserted", () => {
	const text = source();

	assert.match(text, /import \{ ORDERS_ENABLED \} from "\.\.\/\.\.\/lib\/shop"/);
	assert.match(text, /!ORDERS_ENABLED && <OrdersClosedNotice/);
});

test("the page is withheld from the sitemap and llms.txt inventory", () => {
	const index = readFileSync(join(SRC, "lib/content-index.ts"), "utf8");

	assert.doesNotMatch(index, /support\/anfrage/);
});

test("the footer links to the page, with the trailing slash", () => {
	const layout = readFileSync(join(SRC, "layouts/BaseLayout.astro"), "utf8");

	assert.match(layout, /<a href="\/support\/anfrage\/">Support-Anfrage<\/a>/);
	assert.doesNotMatch(layout, /href="\/support\/anfrage"[^/]/, "slashless footer href");
});

// ---------------------------------------------------------------------------
// 2. Built output
// ---------------------------------------------------------------------------

test("the page builds at the nested route", { skip }, () => {
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
		readFileSync(join(DIST, name), "utf8").includes("support/anfrage"),
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

test("the routing targets and the footer link are the ones expected", { skip }, () => {
	const markup = html();
	const served = servedPaths();

	for (const href of INTERNAL_LINKS) {
		assert.ok(markup.includes(`href="${href}"`), `${PATH}: ${href} is not linked`);
		assert.ok(served.has(href), `${href} does not answer 200`);
	}

	assert.ok(served.has(PATH), `${PATH} does not answer 200`);
	assert.match(markup, /<a href="\/support\/anfrage\/"[^>]*>Support-Anfrage<\/a>/);
});

test("the built page contains no form of its own", { skip }, () => {
	// The site search form is rendered into every page by BaseLayout, so it is
	// the one form allowed to appear.
	const forms = [...html().matchAll(/<form\b[^>]*>/gi)].map((m) => m[0]);
	const unexpected = forms.filter((form) => !/action="\/produkte\/"/.test(form));

	assert.deepEqual(unexpected, [], "the support page grew a form with no backend");
});

test("no empty or malformed contact link ships", { skip }, () => {
	// `mailto:` with nothing after the scheme is what an unguarded template
	// produces when the configured value is missing.
	const markup = html();

	assert.deepEqual([...markup.matchAll(/href="(mailto:|tel:)\s*"/gi)].map((m) => m[0]), []);
	for (const match of markup.matchAll(/href="mailto:([^"]*)"/gi)) {
		assert.match(match[1], /^[^\s@]+@[^\s@.]+\.[^\s@]+$/, `malformed mailto: ${match[1]}`);
	}
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

test("the rendered page offers all nine categories and its sections", { skip }, () => {
	const text = mainText();

	for (const category of CATEGORIES) {
		assert.ok(text.includes(category), `${PATH}: category "${category}" is missing`);
	}

	for (const heading of [
		"Passendes Anliegen auswählen",
		"Welche Angaben helfen?",
		"Bestellungen und Zahlungen",
		"Versand und Lieferung",
		"Retouren und Reklamationen",
		"Dokumentation und Analyse",
		"Datenschutz",
		"Kontakt aufnehmen",
	]) {
		assert.ok(text.includes(heading), `${PATH}: section "${heading}" is missing`);
	}

	// The no-guarantee notice has to remain visible.
	assert.match(text, /Wegweiser, keine Bearbeitungszusage/);
	assert.match(text, /Art\. 9 DSGVO/);
});

test("REGRESSION: the rendered page makes no forbidden support claim", { skip }, () => {
	const text = mainText();
	const found = FORBIDDEN_SUPPORT_CLAIMS.filter(([, pattern]) => pattern.test(text)).map(
		([label]) => `${PATH}: contains ${label}`,
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

test("the breadcrumb resolves, with no phantom /support/ step", { skip }, () => {
	const crumbs = graph().find((node) => node["@type"] === "BreadcrumbList");
	assert.ok(crumbs, `${PATH}: no BreadcrumbList`);

	const items = crumbs.itemListElement as Array<Record<string, unknown>>;
	const paths = items.map((item) => new URL(String(item.item)).pathname);

	assert.deepEqual(paths, ["/", PATH]);

	// A breadcrumb item pointing at a URL the site does not serve is a dead end
	// for anything that follows the graph.
	const served = servedPaths();
	for (const path of paths) assert.ok(served.has(path), `breadcrumb item ${path} is not served`);
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
