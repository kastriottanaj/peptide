/**
 * Guards on font delivery.
 *
 * The storefront ships **no web font**. `--font-sans` in `BaseLayout.astro` is a
 * system stack (`ui-sans-serif, system-ui, -apple-system, …`), and the two
 * monospace runs on `/agb/`, `/contact/` and the order pages are system stacks
 * too. That is the cheapest possible answer to every question this audit asks:
 * zero font bytes, zero font requests, zero third-party font origins, no
 * subsetting to do, no unused weight to strip, and no swap period in which text
 * is invisible or reflows.
 *
 * So there is nothing here to optimise — only something to keep. These tests
 * exist because the next person to want "a nicer heading font" would otherwise
 * add a Google Fonts `<link>` in one line: that is a third-party request on
 * every page, a DSGVO problem the privacy policy does not cover (the site
 * currently states no third-party fonts are used — see `about.astro`), and a
 * render-blocking dependency in front of the first paint.
 *
 * If a self-hosted font is ever added deliberately, these tests are the place to
 * state the new rules: WOFF2 only, a subset that keeps ä ö ü Ä Ö Ü ß €, exactly
 * the weights in use, `font-display: swap`, and a preload for the one weight
 * above the fold.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC = fileURLToPath(new URL("../../public/", import.meta.url));
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const built = existsSync(DIST);
const skip = built ? false : "no dist/ — run `npm run build` first";

const FONT_EXTENSIONS = new Set([".woff", ".woff2", ".ttf", ".otf", ".eot"]);

/** Hosts that serve fonts, and would each be a new third party on the page. */
const FONT_HOSTS =
	/fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|cdn\.jsdelivr\.net\/npm\/@fontsource|fontawesome|typography\.com/i;

function walk(dir: string, prefix = ""): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) return walk(join(dir, entry.name), rel);
		return [rel];
	});
}

const sourceFiles = () =>
	walk(SRC).filter((f) => /\.(astro|ts|css|md)$/.test(f) && !f.endsWith(".test.ts"));

// ---------------------------------------------------------------------------
// Nothing is fetched
// ---------------------------------------------------------------------------

test("no @font-face is declared anywhere in src/", () => {
	const declaring = sourceFiles().filter((f) =>
		/@font-face/i.test(readFileSync(join(SRC, f), "utf8")),
	);
	assert.deepEqual(declaring, []);
});

test("no font file is committed under public/ or src/", () => {
	const files = [
		...walk(PUBLIC).map((f) => `public/${f}`),
		...walk(SRC).map((f) => `src/${f}`),
	].filter((f) => FONT_EXTENSIONS.has(extname(f).toLowerCase()));
	assert.deepEqual(files, [], "a font file appeared — see this file's header");
});

test("REGRESSION: no third-party font origin is referenced in src/", () => {
	const offenders = sourceFiles().filter((f) =>
		FONT_HOSTS.test(readFileSync(join(SRC, f), "utf8")),
	);
	assert.deepEqual(offenders, []);
});

test("REGRESSION: no third-party font origin ships in the built output", { skip }, () => {
	const offenders = walk(DIST)
		.filter((f) => /\.(html|css|js)$/.test(f))
		.filter((f) => FONT_HOSTS.test(readFileSync(join(DIST, f), "utf8")));
	assert.deepEqual(offenders, []);
});

test("the built output contains no font asset", { skip }, () => {
	const fonts = walk(DIST).filter((f) => FONT_EXTENSIONS.has(extname(f).toLowerCase()));
	assert.deepEqual(fonts, []);
});

test("the built output preloads nothing as a font", { skip }, () => {
	// A preload for a font that is not there is a wasted request; a preload for
	// one that is, without the rest of this file being rewritten, is a font
	// nobody reviewed.
	const preloading = walk(DIST)
		.filter((f) => f.endsWith(".html"))
		.filter((f) => /rel="preload"[^>]*as="font"|as="font"[^>]*rel="preload"/.test(
			readFileSync(join(DIST, f), "utf8"),
		));
	assert.deepEqual(preloading, []);
});

test("total font bytes shipped is zero", { skip }, () => {
	const bytes = walk(DIST)
		.filter((f) => FONT_EXTENSIONS.has(extname(f).toLowerCase()))
		.reduce((sum, f) => sum + statSync(join(DIST, f)).size, 0);
	assert.equal(bytes, 0);
});

// ---------------------------------------------------------------------------
// The stack that is used instead
// ---------------------------------------------------------------------------

test("--font-sans is a system stack ending in a generic family", () => {
	const layout = readFileSync(join(SRC, "layouts/BaseLayout.astro"), "utf8");
	const value = layout.match(/--font-sans:\s*([^;]+);/s)?.[1];
	assert.ok(value, "--font-sans is no longer defined");

	const families = value
		.split(",")
		.map((f) => f.trim().replace(/^["']|["']$/g, ""))
		.filter(Boolean);

	assert.ok(families.length > 1, "a single-family stack has no fallback");
	assert.ok(
		["sans-serif", "serif", "monospace", "system-ui", "ui-sans-serif"].includes(
			families[families.length - 1],
		),
		`stack ends in "${families[families.length - 1]}", not a generic family`,
	);
	// Every entry must be a family the OS can already have. A name that is not
	// in this list is either a web font (which needs an @font-face this file
	// forbids) or a family that silently falls through on most machines.
	const SYSTEM = new Set([
		"ui-sans-serif",
		"system-ui",
		"-apple-system",
		"BlinkMacSystemFont",
		"Segoe UI",
		"Roboto",
		"Helvetica Neue",
		"Helvetica",
		"Arial",
		"Noto Sans",
		"sans-serif",
	]);
	assert.deepEqual(
		families.filter((f) => !SYSTEM.has(f)),
		[],
	);
});

test("German text and price glyphs need no font we do not have", () => {
	// A system stack covers Latin-1 plus the euro sign on every platform the
	// site targets, so there is no subset to define. Asserted as the contract a
	// future subset would have to meet: these characters appear in the copy, in
	// prices and in the legal pages, and a subset that drops one of them ships
	// tofu on a page nobody re-reads.
	const REQUIRED = "äöüÄÖÜß€§–—„“·×%";
	const sources = sourceFiles()
		.map((f) => readFileSync(join(SRC, f), "utf8"))
		.join("");
	const unused = [...REQUIRED].filter((c) => !sources.includes(c));
	// Every one of these is in use, which is what makes the list a real
	// requirement rather than a wish list.
	assert.deepEqual(unused, []);
});

test("prices are formatted by Intl, not by a font-specific glyph hack", () => {
	const pricing = readFileSync(join(SRC, "lib/pricing.ts"), "utf8");
	assert.match(pricing, /Intl\.NumberFormat\(\s*["']de-DE["']/);
});
