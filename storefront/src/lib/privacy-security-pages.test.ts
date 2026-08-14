import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const built = existsSync(DIST);
const skip = built ? false : "no dist; run the build first";
const routes = [
	{ path: "/datenschutz-anfrage/", source: "pages/datenschutz-anfrage.astro", output: "datenschutz-anfrage/index.html", noindex: true },
	{ path: "/cookie-einstellungen/", source: "pages/cookie-einstellungen.astro", output: "cookie-einstellungen/index.html", noindex: true },
	{ path: "/sicherheit/", source: "pages/sicherheit.astro", output: "sicherheit/index.html", noindex: false },
] as const;
const source = (file: string) => readFileSync(join(SRC, file), "utf8");
const output = (file: string) => readFileSync(join(DIST, file), "utf8");
const body = (file: string) => source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("only the three approved routes are present", () => {
	for (const route of routes) assert.ok(existsSync(join(SRC, route.source)));
	for (const file of ["pages/status.astro", "pages/status/index.astro", "pages/cookies.astro", "pages/cookies/index.astro"]) {
		assert.equal(existsSync(join(SRC, file)), false);
	}
});

test("privacy and security reporting reuse configured email without forms or uploads", () => {
	for (const file of ["pages/datenschutz-anfrage.astro", "pages/sicherheit.astro"]) {
		const text = body(file);
		assert.match(text, /import \{ CONTACT, mailtoHref \} from "\.\.\/lib\/company"/);
		assert.match(text, /mailtoHref\(CONTACT\.email\)/);
		assert.match(text, /encodeURIComponent\(/);
		assert.doesNotMatch(text, /<form\b|<input\b|<textarea\b|type="file"|type="submit"/i);
		assert.doesNotMatch(text, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
	}
});

test("privacy request covers rights and data minimisation", () => {
	const text = body("pages/datenschutz-anfrage.astro");
	for (const phrase of ["Auskunft", "Berichtigung", "Löschung", "Einschränkung der Verarbeitung", "Datenübertragbarkeit", "Widerspruch", "Widerruf einer Einwilligung", "Sonstige Datenschutzanfrage", "Identitätsprüfung", "Passwörter", "Zahlungs-", "medizinischen Daten", "Identitätsdokuments"]) {
		assert.ok(text.includes(phrase), "privacy page is missing: " + phrase);
	}
	for (const path of ["/datenschutz/", "/support/anfrage/", "/contact/"]) assert.ok(text.includes('href="' + path + '"'));
	assert.match(text, /<BaseLayout[\s\S]*\bnoindex\b/);
});

test("cookie page uses the real consent implementation", () => {
	const text = source("pages/cookie-einstellungen.astro");
	for (const api of ["ANALYTICS_ENABLED", "readConsent", "onConsentChange", "requestConsentDialog"]) assert.ok(text.includes(api));
	assert.match(text, /<button type="button"[^>]*data-consent-page-open>/);
	assert.match(text, /role="status"/);
	assert.match(text, /aria-live="polite"/);
	assert.match(text, /data-consent-page-open[\s\S]*requestConsentDialog\(\)/);
	for (const value of ["peptide_cart_id", "pe_consent_v1", "<code>_ga</code>", "<code>_ga_&lt;ID&gt;</code>"]) assert.ok(text.includes(value));
	assert.match(text, /:focus-visible/);
	assert.doesNotMatch(text, /marketing|präferenzen|funktional/i);
	assert.doesNotMatch(text, /\b\d+\s*(tage|monate|jahre)\b/i);
});

test("security page has reporting guidance and safe-testing limits", () => {
	const text = body("pages/sicherheit.astro");
	for (const phrase of ["Sicherheitslücke", "personenbezogene Informationen", "Authentifizierung", "verdächtige E-Mails", "Infrastrukturvorfall", "öffentliche URL", "ungefähre Uhrzeit", "Browser und Gerät", "Screenshots", "Passwörter", "privaten Schlüssel", "Bug-Bounty-Programm", "keine Vergütung", "Daten anderer Personen", "Verfügbarkeit", "destruktive Tests", "Spam", "Social Engineering"]) {
		assert.ok(text.includes(phrase), "security page is missing: " + phrase);
	}
	assert.doesNotMatch(text, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
	assert.doesNotMatch(text, /\/(?:srv|var|etc|home|Users)\//);
	assert.doesNotMatch(text, /\bv?\d+\.\d+\.\d+\b/);
	for (const path of ["/datenschutz-anfrage/", "/datenschutz/", "/support/anfrage/"]) assert.ok(text.includes('href="' + path + '"'));
});

test("discovery and contextual links follow the approved split", () => {
	const index = source("lib/content-index.ts");
	assert.equal([...index.matchAll(/path:\s*"\/sicherheit"/g)].length, 1);
	assert.doesNotMatch(index, /path:\s*"\/(?:datenschutz-anfrage|cookie-einstellungen)"/);
	const privacyPolicy = source("pages/datenschutz.astro");
	assert.match(privacyPolicy, /<LegalLayout[\s\S]*\bdraft\b/);
	assert.match(privacyPolicy, /href="\/datenschutz-anfrage\/"/);
	assert.match(privacyPolicy, /href="\/cookie-einstellungen\/"/);
	const support = source("pages/support/anfrage.astro");
	assert.match(support, /href:\s*"\/datenschutz-anfrage\/"/);
	assert.match(support, /href="\/sicherheit\/"/);
	const footer = source("layouts/BaseLayout.astro");
	for (const path of ["/datenschutz-anfrage/", "/cookie-einstellungen/", "/sicherheit/"]) assert.ok(footer.includes('href="' + path + '"'));
});

test("routes build with exact canonicals, H1s and robots behavior", { skip }, () => {
	for (const route of routes) {
		assert.ok(existsSync(join(DIST, route.output)), route.path + " missing from dist");
		const html = output(route.output);
		assert.equal([...html.matchAll(/<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>/g)].length, 1);
		const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
		assert.ok(canonical);
		assert.equal(new URL(canonical).pathname, route.path);
		const robots = [...html.matchAll(/<meta name="robots" content="([^"]+)"/g)].map((m) => m[1]);
		assert.deepEqual(robots, route.noindex ? ["noindex, nofollow"] : []);
	}
	// /datenschutz/ became indexable on 2026-08-15 by explicit decision, while
	// still carrying placeholders — see metadata-output.test.ts. What it must not
	// lose is the banner telling the reader the text is not final.
	const policy = output("datenschutz/index.html");
	assert.deepEqual([...policy.matchAll(/<meta name="robots" content="([^"]+)"/g)].map((m) => m[1]), []);
	assert.match(policy, /Noch nicht rechtsverbindlich/);
});

test("public discovery includes only security exactly once", { skip }, () => {
	const files = readdirSync(DIST).filter((name) => /^sitemap.*\.xml$/.test(name) || /^llms(?:-full)?\.txt$/.test(name));
	const hits: Record<string, string[]> = { "/datenschutz-anfrage/": [], "/cookie-einstellungen/": [], "/sicherheit/": [] };
	for (const name of files) {
		const text = readFileSync(join(DIST, name), "utf8");
		for (const path of Object.keys(hits)) for (let i = 0; i < text.split(path).length - 1; i++) hits[path].push(name);
	}
	assert.deepEqual(hits["/datenschutz-anfrage/"], []);
	assert.deepEqual(hits["/cookie-einstellungen/"], []);
	assert.deepEqual(hits["/sicherheit/"].sort(), ["llms.txt", "sitemap-pages.xml"]);
});

test("built pages carry required internal links", { skip }, () => {
	const required: Record<string, string[]> = {
		"datenschutz-anfrage/index.html": ["/datenschutz/", "/support/anfrage/", "/contact/"],
		"cookie-einstellungen/index.html": ["/datenschutz/"],
		"sicherheit/index.html": ["/datenschutz-anfrage/", "/datenschutz/", "/support/anfrage/"],
	};
	for (const [file, links] of Object.entries(required)) {
		const html = output(file);
		for (const link of links) assert.ok(html.includes('href="' + link + '"'));
	}
});
