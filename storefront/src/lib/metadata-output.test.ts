/**
 * End-to-end guard on the search-result metadata in the built output.
 *
 * Every indexable route ships an approved `<title>` and `<meta
 * name="description">`, and `Seo.astro` mirrors both into OpenGraph and
 * Twitter. This file pins the exact strings, so a page that composes its own
 * title, drops a curated record, or lets the brand suffix creep back fails here
 * rather than in a search result weeks later.
 *
 * The values below are the authoritative copy. They were supplied as a
 * spreadsheet export, but nothing here reads it: the table is the record now,
 * and the export can be deleted without affecting this test or the build.
 *
 * Exact-string equality throughout, deliberately. A keyword assertion would
 * pass on a title that lost its umlauts to a bad encoding, or on a description
 * silently truncated by a helper — both of which are the failures worth
 * catching.
 *
 * Skipped when `dist/` is absent — `npm test` must not require a build (which
 * needs the Medusa backend on :9000). Run `npm run build` first to exercise it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const built = existsSync(DIST);
const skip = built ? false : "no dist/ — run `npm run build` first";

interface PageMeta {
	title: string;
	description: string;
}

/**
 * The approved metadata, keyed by the path the page is served at.
 *
 * Each entry is rendered by the record that owns that route: a page's own
 * `BaseLayout` props for the static routes, `metaTitle`/`metaDescription`
 * frontmatter for `wissen` and `lexikon`, and `catalog-seo.ts` for the
 * Medusa-backed product and category routes.
 */
const EXPECTED: Record<string, PageMeta> = {
	"/": {
		title: "Peptide kaufen in Deutschland für Forschung & Analyse",
		description:
			"Forschungspeptide für Labor und Analyse mit klaren Produktdaten, Packgrößen und COA-Status. Jetzt Produkte vergleichen!",
	},
	"/produkte/": {
		title: "Forschungspeptide kaufen für Analyse und Labor",
		description:
			"Forschungspeptide für Laboranalysen mit Angaben zu Packgrößen, Reinheit und Zertifikatsstatus. Produktdetails ansehen.",
	},
	"/peptid-rechner/": {
		title: "Peptid-Rechner für Rekonstitution und Aliquotierung",
		description:
			"Peptid-Rechner für Laboransätze: Konzentration, Volumen und Aliquots nachvollziehbar berechnen. Jetzt Werte eingeben und Ergebnis prüfen!",
	},
	"/about/": {
		title: "Über Peptide Einkaufen: Shop für Forschungspeptide",
		description:
			"Erfahren Sie mehr über Forschungspeptide, transparente Produktangaben, COA-Status und diskreten Versand. Jetzt Sortiment ansehen!",
	},
	"/contact/": {
		title: "Kontakt & Support für Produkte und Bestellungen",
		description:
			"Kontakt für Fragen zu bestehenden Bestellungen, Produktdaten, Versand, Zahlung und Datenschutz. Jetzt Support per E-Mail anfragen.",
	},

	"/kategorie/neuropeptid-forschung/": {
		title: "Neuropeptid-Forschung kaufen: Semax 30 mg",
		description:
			"Informationen zu Forschungspeptiden, Reinheit und Zertifikaten – ausschließlich für Laboranalysen. Jetzt Produktdetails ansehen!",
	},
	"/kategorie/regenerationsforschung/": {
		title: "Regenerationsforschung: Peptide für Labor & Analyse",
		description:
			"Forschungspeptide für Regenerationsforschung mit Angaben zu Reinheit und Produktdetails – ausschließlich für Laborzwecke. Jetzt ansehen!",
	},
	"/kategorie/signal-fragmentpeptide/": {
		title: "Signal- & Fragmentpeptide kaufen für die Forschung",
		description:
			"Signal- und Fragmentpeptide für Analyse- und Laborzwecke mit klaren Angaben zu Reinheit und Produktdetails. Kategorie ansehen!",
	},
	"/kategorie/stoffwechsel-forschung/": {
		title: "Stoffwechsel-Forschung: Peptide für Labor & Analyse",
		description:
			"Forschungspeptide für Stoffwechsel-Forschung mit Angaben zu Reinheit und Produktdokumentation. Kategorie für Laborzwecke ansehen!",
	},

	"/produkte/bpc-157/": {
		title: "BPC-157 5 mg & 10 mg für Forschung und Analyse",
		description:
			"BPC-157 als lyophilisiertes Forschungspeptid in 5 mg und 10 mg mit Angaben zu Reinheit und COA. Produktdetails ansehen!",
	},
	"/produkte/retatrutide/": {
		title: "Retatrutide 5 mg, 10 mg & 15 mg für Laborforschung",
		description:
			"Retatrutide als lyophilisiertes Forschungspeptid für metabolische Modellforschung mit Angaben zu Reinheit und COA. Produktdetails ansehen!",
	},
	"/produkte/ghk-cu/": {
		title: "GHK-Cu 50 mg & 100 mg für Forschung und Analyse",
		description:
			"GHK-Cu als Kupfer-Peptid-Komplex für Forschungs- und Analysezwecke mit Angaben zu Reinheit, COA und Packgrößen. Produktdetails ansehen!",
	},
	"/produkte/mots-c/": {
		title: "MOTS-c 10 mg für metabolische Studienmodelle",
		description:
			"MOTS-c Forschungspeptid für metabolische Studienmodelle mit Angaben zu Reinheit, COA und Packgröße. Jetzt Produktdetails ansehen!",
	},
	"/produkte/semax/": {
		title: "Semax 30 mg für Neuropeptid-Forschung und Analyse",
		description:
			"Semax als Forschungspeptid für Studien zu neuronalen Signalwegen mit Angaben zu Reinheit, COA und Packgröße. Produktdetails ansehen!",
	},
	"/produkte/tb-500/": {
		title: "TB-500 5 mg & 10 mg für Forschung und Analyse",
		description:
			"TB-500: Überblick zu Reinheit, COA, Packgrößen und ausschließlich laborbezogener Nutzung. Produktinformationen ansehen.",
	},

	"/wissen/": {
		title: "Forschungspeptide: Grundlagen, Analytik & Laborpraxis",
		description:
			"Entdecken Sie fundiertes Wissen zu Forschungspeptiden, Analytik, Lagerung und Laborpraxis. Jetzt Artikel lesen und Fachwissen vertiefen!",
	},
	"/wissen/lagerung-lyophilisierter-peptide/": {
		title: "Lyophilisierte Peptide richtig lagern: Laborpraxis",
		description:
			"Erfahren Sie, wie lyophilisierte Peptide im Labor vor Wärme, Feuchtigkeit und Licht geschützt werden. Jetzt Lagerungstipps lesen!",
	},
	"/wissen/reinheit-und-coa/": {
		title: "Reinheit und COA bei Forschungspeptiden richtig lesen",
		description:
			"Erfahren Sie, wie Reinheit, HPLC, Massenspektrometrie und COA bei Forschungspeptiden bewertet werden. Jetzt Prüfkriterien entdecken!",
	},
	"/wissen/was-sind-peptide/": {
		title: "Was sind Peptide? Aufbau, Definition und Abgrenzung",
		description:
			"Was sind Peptide? Entdecken Sie Aufbau, Peptidbindungen, Kettenlängen und ihre Bedeutung für die Forschung. Jetzt Grundlagen lesen!",
	},

	"/wissen/lexikon/": {
		title: "Peptid-Lexikon: Fachbegriffe von A bis Z erklärt",
		description:
			"Peptid-Lexikon mit Kurzdefinitionen zu HPLC, COA, Reinheit und weiteren Laborbegriffen. Jetzt Begriffe von A bis Z entdecken!",
	},
	"/wissen/lexikon/aminosaeure/": {
		title: "Aminosäuren: Aufbau, Eigenschaften und Peptidbausteine",
		description:
			"Aminosäuren sind Grundbausteine von Peptiden und Proteinen. Erfahren Sie mehr über Aufbau, Eigenschaften und Peptidsynthese!",
	},
	"/wissen/lexikon/coa/": {
		title: "COA erklärt: Analysezertifikat und Messwerte verstehen",
		description:
			"Ein COA dokumentiert chargenbezogene Messwerte wie HPLC-Reinheit und Massenspektrum. Jetzt Bedeutung und Prüfkriterien entdecken!",
	},
	"/wissen/lexikon/hplc/": {
		title: "HPLC erklärt: Reinheit und Chromatogramme verstehen",
		description:
			"Erfahren Sie, wie HPLC Proben trennt, chromatographische Reinheit bestimmt und Chromatogramme interpretiert werden. Jetzt Begriff verstehen!",
	},
	"/wissen/lexikon/lyophilisat/": {
		title: "Lyophilisat erklärt: Gefriertrocknung bei Peptiden",
		description:
			"Ein Lyophilisat entsteht durch Gefriertrocknung und erhöht Stabilität sowie Haltbarkeit von Peptiden. Jetzt den Begriff verständlich erklärt!",
	},
	"/wissen/lexikon/massenspektrometrie/": {
		title: "Massenspektrometrie erklärt: Peptididentität prüfen",
		description:
			"Massenspektrometrie bestätigt die Identität von Peptiden über ihre Molekülmasse. Erfahren Sie, wie MS und LC-MS funktionieren!",
	},
	"/wissen/lexikon/peptidbindung/": {
		title: "Peptidbindung erklärt: Entstehung und Eigenschaften",
		description:
			"Peptidbindungen verknüpfen Aminosäuren und prägen die Struktur von Peptiden. Erfahren Sie mehr über Aufbau und Eigenschaften!",
	},
	"/wissen/lexikon/reinheit/": {
		title: "Reinheit bei Peptiden: HPLC-Wert und Gehalt erklärt",
		description:
			"Was bedeutet Reinheit bei Peptiden? Lernen Sie den Unterschied zwischen HPLC-Reinheit und Peptidgehalt kennen. Jetzt verständlich erklärt!",
	},
	"/wissen/lexikon/vial/": {
		title: "Vial erklärt: Aufbau, Verschluss und Verwendung",
		description:
			"Was ist ein Vial? Erfahren Sie, wie Glasfläschchen Lyophilisate trocken und lichtgeschützt aufbewahren. Jetzt verständlich erklärt!",
	},
};

/**
 * Routes that must stay out of the index: checkout and order flow, the four
 * legal pages while they still carry `draft`, the research-use policy page
 * until it has had legal review, the shipping/payment and returns pages until
 * their open details are settled, and the 404 document. None of them received
 * curated metadata, and none may become indexable as a side effect of a
 * metadata change.
 */
const MUST_STAY_NOINDEX = [
	"/404.html",
	"/agb/",
	"/bestellung/",
	"/bestellung/suchen/",
	"/datenschutz/",
	"/forschungszwecke/",
	"/impressum/",
	"/kasse/",
	"/retouren-reklamation/",
	"/versand-zahlung/",
	"/warenkorb/",
	"/widerruf/",
];

// ---------------------------------------------------------------------------

function allFiles(dir = DIST, prefix = ""): string[] {
	if (!built) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		return entry.isDirectory() ? allFiles(join(dir, entry.name), rel) : [rel];
	});
}

const FILES = allFiles();

/** The URL a built file is served at. `astro build` writes `<path>/index.html`. */
function servedPathOf(relativeFile: string): string {
	if (relativeFile === "index.html") return "/";
	if (relativeFile.endsWith("/index.html")) {
		return `/${relativeFile.slice(0, -"index.html".length)}`;
	}
	return `/${relativeFile}`;
}

const HTML_BY_PATH = new Map<string, string>(
	FILES.filter((f) => f.endsWith(".html")).map((f) => [
		servedPathOf(f),
		readFileSync(join(DIST, f), "utf8"),
	]),
);

/**
 * Decode the entities Astro emits in attribute and text content. Only the five
 * named entities plus numeric quote forms occur here — the output is UTF-8, so
 * umlauts are literal bytes rather than entities, which is itself asserted
 * below.
 */
function decodeEntities(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#34;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function matchAll(html: string, pattern: RegExp): string[] {
	return [...html.matchAll(pattern)].map((m) => decodeEntities(m[1]));
}

const headOf = (html: string) => html.slice(0, html.indexOf("</head>") + 7);

const titles = (html: string) => matchAll(headOf(html), /<title>([\s\S]*?)<\/title>/g);
const descriptions = (html: string) =>
	matchAll(headOf(html), /<meta name="description" content="([^"]*)"/g);
const metaProperty = (html: string, property: string) =>
	matchAll(
		headOf(html),
		new RegExp(`<meta property="${property}" content="([^"]*)"`, "g"),
	);
const metaName = (html: string, name: string) =>
	matchAll(headOf(html), new RegExp(`<meta name="${name}" content="([^"]*)"`, "g"));

const MAPPED = Object.entries(EXPECTED);

// --- the routes exist -------------------------------------------------------

test("every approved route is present in the build", { skip }, () => {
	const missing = MAPPED.map(([path]) => path).filter((p) => !HTML_BY_PATH.has(p));
	assert.deepEqual(missing, [], `approved routes missing from dist/: ${missing.join(", ")}`);
});

// --- exactly one of each ----------------------------------------------------

test("every approved route has exactly one <title>", { skip }, () => {
	for (const [path] of MAPPED) {
		const html = HTML_BY_PATH.get(path);
		if (!html) continue;
		assert.equal(titles(html).length, 1, `${path} must have exactly one <title>`);
	}
});

test("every approved route has exactly one meta description", { skip }, () => {
	for (const [path] of MAPPED) {
		const html = HTML_BY_PATH.get(path);
		if (!html) continue;
		assert.equal(
			descriptions(html).length,
			1,
			`${path} must have exactly one <meta name="description">`,
		);
	}
});

test("no page in the build has a duplicate title or description tag", { skip }, () => {
	for (const [path, html] of HTML_BY_PATH) {
		assert.ok(titles(html).length <= 1, `${path} has ${titles(html).length} <title> tags`);
		assert.ok(
			descriptions(html).length <= 1,
			`${path} has ${descriptions(html).length} meta descriptions`,
		);
	}
});

// --- the exact strings ------------------------------------------------------

test("every approved title is rendered exactly", { skip }, () => {
	for (const [path, expected] of MAPPED) {
		const html = HTML_BY_PATH.get(path);
		if (!html) continue;
		assert.equal(titles(html)[0], expected.title, `<title> mismatch on ${path}`);
	}
});

test("every approved description is rendered exactly", { skip }, () => {
	for (const [path, expected] of MAPPED) {
		const html = HTML_BY_PATH.get(path);
		if (!html) continue;
		assert.equal(
			descriptions(html)[0],
			expected.description,
			`meta description mismatch on ${path}`,
		);
	}
});

test("no approved title carries an appended brand suffix", { skip }, () => {
	for (const [path] of MAPPED) {
		const html = HTML_BY_PATH.get(path);
		if (!html) continue;
		assert.ok(
			!titles(html)[0].endsWith(" | Peptide Einkaufen"),
			`${path} appended the brand suffix to an already-complete title`,
		);
	}
});

// --- OpenGraph and Twitter mirror the page metadata -------------------------

test("OpenGraph title and description mirror the approved page metadata", { skip }, () => {
	for (const [path, expected] of MAPPED) {
		const html = HTML_BY_PATH.get(path);
		if (!html) continue;
		assert.deepEqual(metaProperty(html, "og:title"), [expected.title], `og:title on ${path}`);
		assert.deepEqual(
			metaProperty(html, "og:description"),
			[expected.description],
			`og:description on ${path}`,
		);
	}
});

test("Twitter title and description mirror the approved page metadata", { skip }, () => {
	for (const [path, expected] of MAPPED) {
		const html = HTML_BY_PATH.get(path);
		if (!html) continue;
		assert.deepEqual(
			metaName(html, "twitter:title"),
			[expected.title],
			`twitter:title on ${path}`,
		);
		assert.deepEqual(
			metaName(html, "twitter:description"),
			[expected.description],
			`twitter:description on ${path}`,
		);
	}
});

// --- encoding ---------------------------------------------------------------

test("German characters survive as UTF-8, not entities or mojibake", { skip }, () => {
	for (const [path, expected] of MAPPED) {
		const html = HTML_BY_PATH.get(path);
		if (!html) continue;
		const head = headOf(html);
		assert.ok(!head.includes("�"), `${path} head contains a replacement character`);
		assert.ok(
			!/&(auml|ouml|uuml|Auml|Ouml|Uuml|szlig|ndash|mdash);/.test(head),
			`${path} escaped a German character as a named entity`,
		);
		// The literal bytes have to be in the file, not just in the decoded value.
		for (const char of new Set([...`${expected.title}${expected.description}`].filter((c) => c > "\x7F"))) {
			assert.ok(head.includes(char), `${path} lost the character ${char} from its head`);
		}
	}
});

// --- things a metadata change must not touch --------------------------------

test("every approved route keeps exactly one self-consistent canonical", { skip }, () => {
	for (const [path] of MAPPED) {
		const html = HTML_BY_PATH.get(path);
		if (!html) continue;
		const canonicals = matchAll(headOf(html), /<link rel="canonical" href="([^"]*)"/g);
		assert.equal(canonicals.length, 1, `${path} must have exactly one canonical`);
		assert.equal(
			new URL(canonicals[0]).pathname,
			path,
			`canonical on ${path} points at another URL`,
		);
	}
});

test("no approved route carries a robots meta tag", { skip }, () => {
	for (const [path] of MAPPED) {
		const html = HTML_BY_PATH.get(path);
		if (!html) continue;
		assert.deepEqual(
			metaName(html, "robots"),
			[],
			`${path} is an indexable route and must not emit a robots directive`,
		);
	}
});

test("REGRESSION: no noindex route became indexable", { skip }, () => {
	for (const path of MUST_STAY_NOINDEX) {
		const html = HTML_BY_PATH.get(path);
		assert.ok(html, `${path} missing from dist/`);
		assert.deepEqual(
			metaName(html, "robots"),
			["noindex, nofollow"],
			`${path} lost its noindex directive`,
		);
	}
});

test("no noindex route is listed in a sitemap", { skip }, () => {
	const locs = new Set(
		FILES.filter((f) => f.startsWith("sitemap") && f.endsWith(".xml")).flatMap((f) =>
			[...readFileSync(join(DIST, f), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map(
				(m) => m[1],
			),
		),
	);
	const paths = new Set(
		[...locs].filter((l) => l.includes("/sitemap") === false).map((l) => new URL(l).pathname),
	);
	for (const path of MUST_STAY_NOINDEX) {
		assert.ok(!paths.has(path), `${path} is noindex but appears in a sitemap`);
	}
});

test("every approved indexable route is listed in a sitemap", { skip }, () => {
	const locs = [
		...new Set(
			FILES.filter((f) => f.startsWith("sitemap") && f.endsWith(".xml")).flatMap((f) =>
				[...readFileSync(join(DIST, f), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map(
					(m) => m[1],
				),
			),
		),
	];
	const paths = new Set(locs.map((l) => new URL(l).pathname));
	const missing = MAPPED.map(([p]) => p).filter((p) => !paths.has(p));
	assert.deepEqual(missing, [], `indexable routes absent from every sitemap: ${missing}`);
});

test("a curated SEO title never becomes the visible heading", { skip }, () => {
	for (const [path, expected] of MAPPED) {
		const html = HTML_BY_PATH.get(path);
		if (!html) continue;
		const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) =>
			decodeEntities(m[1].replace(/<[^>]+>/g, "")).trim(),
		);
		assert.equal(h1s.length, 1, `${path} must have exactly one <h1>`);
		assert.ok(h1s[0].length > 0, `${path} has an empty <h1>`);
		// The homepage is the one page whose heading and title were always the
		// same sentence; everywhere else the SEO title is written for the SERP
		// and must not have leaked into the page.
		if (path !== "/") {
			assert.notEqual(
				h1s[0],
				expected.title,
				`${path} rendered its SEO title as the visible heading`,
			);
		}
	}
});

// --- the source spreadsheet never ships -------------------------------------

test("no CSV is present in, or referenced by, the built output", { skip }, () => {
	const csvFiles = FILES.filter((f) => /\.csv$/i.test(f));
	assert.deepEqual(csvFiles, [], `CSV files leaked into dist/: ${csvFiles.join(", ")}`);

	const referencing = FILES.filter((f) => f.endsWith(".js")).filter((f) =>
		/meta-updates|\.csv\b/i.test(readFileSync(join(DIST, f), "utf8")),
	);
	assert.deepEqual(referencing, [], `client JS references a CSV: ${referencing.join(", ")}`);
});
