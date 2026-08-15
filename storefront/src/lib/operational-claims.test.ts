/**
 * Site-wide guard on operational claims nothing in this repository supports.
 *
 * Three statements shipped on public pages until 2026-08-01, each asserting a
 * fact that no code, contract or configuration establishes:
 *
 * - **Tax treatment.** `llms.txt` told language models "Alle Preise in EUR inkl.
 *   deutscher Umsatzsteuer" while AGB § 4 carried a placeholder, because the
 *   Kleinunternehmer question is open (docs/go-live-checklist.md §3). The fix is
 *   to state the currency and stop there — replacing it with "netto" would be
 *   the same defect pointed the other way.
 * - **Delivery time.** The homepage promised "Zustellung in 1–3 Werktagen". No
 *   carrier is contracted and no dispatch SLA exists.
 * - **Why ordering is off.** `ORDERS_CLOSED_TEXT` said "Der Shop wird gerade
 *   eingerichtet". `ORDERS_ENABLED` is a boolean about whether orders are
 *   accepted; it establishes nothing about the operating company.
 *
 * `trust-pages.test.ts` pins the same rule for the four trust pages. This file
 * is deliberately broader: it scans **every** built page plus the text routes,
 * because the claims that shipped were on the homepage and in shared copy, not
 * on a trust page.
 *
 * The source scans always run; the built-output scans are skipped without
 * `dist/`, since `npm test` must not require a build.
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

/**
 * Claims that may not appear in public output while the underlying question is
 * unanswered. Each pattern is written to catch the paraphrase as well as the
 * exact string that shipped — the point is that the *claim* cannot return, not
 * that one wording cannot.
 */
const BANNED_CLAIMS: Array<[label: string, pattern: RegExp]> = [
	[
		"a VAT / tax treatment claim",
		/(inkl\.?|inklusive|zzgl\.?|zuzüglich|einschließlich)\s+(der\s+)?(gesetzlichen?\s+)?(deutschen?\s+)?(umsatzsteuer|mehrwertsteuer|mwst)|preise\s+(sind\s+)?(netto|brutto)|(netto|brutto)preise|kleinunternehmer|umsatzsteuerbefreit/i,
	],
	[
		"a numeric delivery-time promise",
		/\d\s*[–—-]?\s*\d?\s*werktage?n?\s+(nach|ab)|(zustellung|lieferung|versand)\s+(in|innerhalb|binnen)\s+\d|innerhalb\s+von\s+\d+\s*(werk)?tagen?\s+(geliefert|versendet|zugestellt)|noch\s+am\s+selben\s+tag|same.day/i,
	],
	[
		"a delivery or dispatch guarantee",
		/(liefer|versand|zustell)\w*garantie|garantierte?\s+(lieferung|zustellung|lieferzeit)/i,
	],
	[
		// Covers the bank-details warning too: `bankDetailsArePlaceholder()`
		// proves the details are placeholders, not that an account is being
		// opened — the same inference `ORDERS_ENABLED` could not support.
		"a being-set-up business status",
		/(shop|unternehmen|kontaktwege|gesch[äa]ftskonto|konto|postfach)\b[^.]{0,40}\b(wird|werden)\s+(gerade\s+|derzeit\s+)?(eingerichtet|er[öo]ffnet|angelegt)/i,
	],
	[
		// No mail transport exists (docs/go-live-checklist.md §6), so nothing may
		// promise that we will write.
		"a promise to make contact that no system can keep",
		/wir\s+melden\s+uns|sie\s+erhalten\s+(dann\s+)?(eine\s+)?(nachricht|e-?mail)\s+von\s+uns|senden\s+wir\s+Ihnen\s+(eine\s+)?e-?mail/i,
	],
	["a company-formation status", /in\s+Gründung|neu\s+gegründet|Firmengründung/i],
	[
		// Only an affirmative offer counts. The Datenschutz page says "Ein
		// Kontaktformular setzen wir nicht ein", which is the correct statement
		// of its absence and must not trip this.
		"a contact form that does not exist",
		/(über|via|per|durch)\s+(das|unser|ein)\s+kontaktformular|kontaktformular\s+(nutzen|verwenden|ausfüllen|absenden)/i,
	],
];

// ---------------------------------------------------------------------------
// Source — always runs
// ---------------------------------------------------------------------------

/** Every `.astro` and `.ts` under `src/`, excluding tests (which quote the claims). */
function sourceFiles(dir = SRC, prefix = ""): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) return sourceFiles(join(dir, entry.name), rel);
		if (rel.endsWith(".test.ts")) return [];
		return /\.(astro|ts)$/.test(entry.name) ? [rel] : [];
	});
}

/**
 * Strip the things that legitimately discuss a claim without making it:
 * block comments, line comments, and bracketed placeholder markers. A `.todo`
 * marker naming "gesetzlicher Umsatzsteuer" is the *absence* of the claim.
 */
function claimText(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
		.replace(/\[[^\]]*\]/g, "");
}

test("no source file makes an unsupported operational claim", () => {
	const found: string[] = [];

	for (const file of sourceFiles()) {
		const text = claimText(readFileSync(join(SRC, file), "utf8"));
		for (const [label, pattern] of BANNED_CLAIMS) {
			const match = pattern.exec(text);
			if (match) found.push(`src/${file}: ${label} — ${JSON.stringify(match[0])}`);
		}
	}

	assert.deepEqual(found, []);
});

test("REGRESSION: the exact strings that shipped are gone from source", () => {
	// Named individually so a failure says which one came back.
	const GONE = [
		"inkl. deutscher Umsatzsteuer",
		"Zustellung in 1–3 Werktagen",
		"Der Shop wird gerade eingerichtet",
	];

	const offenders: string[] = [];
	for (const file of sourceFiles()) {
		const text = readFileSync(join(SRC, file), "utf8");
		for (const phrase of GONE) {
			if (text.includes(phrase)) offenders.push(`src/${file}: "${phrase}"`);
		}
	}

	assert.deepEqual(offenders, []);
});

test("the orders-closed copy states the state without explaining it", () => {
	const shop = readFileSync(join(SRC, "lib/shop.ts"), "utf8");
	// The constant is written as concatenated string literals to stay inside the
	// line length, so the joins have to go before the sentence can be matched.
	const text = (/ORDERS_CLOSED_TEXT\s*=\s*([\s\S]*?);/.exec(shop)?.[1] ?? "")
		.replace(/"\s*\+\s*"/g, "")
		.replace(/\s+/g, " ");

	assert.match(text, /Bestellvorgang ist derzeit nicht verfügbar/);
	assert.match(text, /Sortiment, Packgrößen und Preise können weiterhin eingesehen werden/);
	// It may not offer a reason, a date, or a business status.
	assert.doesNotMatch(text, /eingerichtet|Gründung|bald|demnächst|ab \w+ wieder/i);
});

test("the AGB keeps its unresolved VAT and delivery-time markers", () => {
	// The other direction: stripping a claim must not become stripping the
	// placeholder that records the open question.
	//
	// The VAT marker was reworded on 2026-08-15, not removed. Answering §3
	// (business customers only) takes away the PAngV duty to show gross prices,
	// which is what "je nach Kleinunternehmerregelung" was about — but it does
	// not say what tax a US seller owes on goods shipped to German business
	// customers. So the question survives its old wording, and this asserts the
	// question rather than the sentence that used to phrase it.
	const agb = readFileSync(join(SRC, "pages/agb.astro"), "utf8");

	assert.match(agb, /\[Umsatzsteuerausweis festlegen/);
	assert.doesNotMatch(
		agb,
		/Kleinunternehmerregelung und Zielgruppe festlegen/,
		"the old VAT marker is back; it assumed a German seller and a consumer audience",
	);
	assert.match(agb, /\[Anzahl\]<\/span> Werktage ab Zahlungseingang/);
	assert.match(agb, /\bdraft\b/, "AGB lost its draft flag");
});

// ---------------------------------------------------------------------------
// Built output
// ---------------------------------------------------------------------------

function builtFiles(dir = DIST, prefix = ""): string[] {
	if (!built) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) return builtFiles(join(dir, entry.name), rel);
		return /\.(html|txt|xml)$/.test(entry.name) ? [rel] : [];
	});
}

/** Visible text of a built HTML page, or the raw body of a text route. */
function publicText(file: string): string {
	const raw = readFileSync(join(DIST, file), "utf8");
	if (!file.endsWith(".html")) return raw;

	const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(raw)?.[1] ?? raw;
	return main
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ");
}

test("dist/ has pages and text routes to check", { skip }, () => {
	const files = builtFiles();
	assert.ok(files.some((f) => f.endsWith(".html")), "no built pages");
	assert.ok(files.includes("llms.txt"), "llms.txt not built");
});

test("REGRESSION: no built page or text route makes an unsupported claim", { skip }, () => {
	const found: string[] = [];

	for (const file of builtFiles()) {
		// Legal drafts carry `[Platzhalter]` markers naming the open questions;
		// those are the absence of a claim, so they are stripped before matching.
		const text = publicText(file).replace(/\[[^\]]*\]/g, "");
		for (const [label, pattern] of BANNED_CLAIMS) {
			const match = pattern.exec(text);
			if (match) found.push(`${file}: ${label} — ${JSON.stringify(match[0])}`);
		}
	}

	assert.deepEqual(found, []);
});

test("llms.txt states the currency and nothing about tax", { skip }, () => {
	const llms = readFileSync(join(DIST, "llms.txt"), "utf8");

	assert.match(llms, /Alle Preise in EUR\./);
	assert.doesNotMatch(llms, /umsatzsteuer|mehrwertsteuer|mwst|netto|brutto/i);
});

test("the homepage promises no delivery time", { skip }, () => {
	const home = publicText("index.html");

	assert.doesNotMatch(home, /Werktag/i);
	assert.match(home, /Informationen zu Versand und Lieferzeit werden vor Aktivierung/);
});

test("every surface that renders the orders-closed copy renders the neutral text", { skip }, (t) => {
	// The copy is shared, so this checks it reached the pages rather than only
	// the constant: product, cart and checkout all render `OrdersClosedNotice`.
	const surfaces = builtFiles().filter(
		(file) => file.endsWith(".html") && publicText(file).includes("Bestellungen derzeit nicht möglich"),
	);

	// Whether the notice renders at all depends on `PUBLIC_ORDERS_ENABLED`, which
	// is open in local development and unset in production. Asserting it is
	// present would make this test a check on the developer's `.env` rather than
	// on the copy, so a build with ordering open skips instead of failing.
	if (surfaces.length === 0) {
		t.skip("ordering is enabled in this build — the notice is not rendered");
		return;
	}

	for (const file of surfaces) {
		const text = publicText(file);
		assert.match(
			text,
			/Der Bestellvorgang ist derzeit nicht verfügbar/,
			`${file}: orders-closed notice without the neutral wording`,
		);
		assert.doesNotMatch(text, /eingerichtet/i, `${file}: still explains why ordering is off`);
	}
});
