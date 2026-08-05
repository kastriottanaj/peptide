import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const built = existsSync(DIST);
const skip = built ? false : "no dist/ — run `npm run build` first";

const routes = [
	["glp-1-forschung", "GLP-1-Forschung", false],
	["regenerationsforschung", "Regenerationsforschung", false],
	["stoffwechsel-forschung", "Stoffwechsel-Forschung", false],
	["signal-fragmentpeptide", "Signal- & Fragmentpeptide", false],
	["neuropeptid-forschung", "Neuropeptid-Forschung", false],
	["peptid-stacks", "Peptid-Stacks", true],
	["laborbedarf", "Laborbedarf", true],
] as const;

const source = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const page = (handle: string) =>
	readFileSync(join(DIST, "kategorie", handle, "index.html"), "utf8");
const sitemap = () => readFileSync(join(DIST, "sitemap-pages.xml"), "utf8");
const llms = () => readFileSync(join(DIST, "llms.txt"), "utf8");
const decode = (html: string) => html.replace(/&amp;/g, "&");

test("source pins the exact seven-category contract and additive Retatrutide seed", () => {
	const backendDefinitions = source("../../backend/apps/backend/src/lib/catalog-categories.ts");
	const seed = source("../../backend/apps/backend/src/scripts/seed-peptides.ts");
	for (const [handle, title] of routes) {
		assert.ok(
			backendDefinitions.includes(handle) || seed.includes(title),
			`missing ${title} (${handle})`,
		);
	}
	assert.match(seed, /categories:\s*\["Stoffwechsel-Forschung", "GLP-1-Forschung"\]/);
	assert.equal((seed.match(/handle: "retatrutide"/g) ?? []).length, 1);
});

test("all seven exact category routes build with breadcrumbs and canonicals", { skip }, () => {
	for (const [handle, title] of routes) {
		const html = page(handle);
		assert.match(decode(html), new RegExp(`<h1[^>]*>${title}</h1>`));
		assert.match(html, /<nav class="crumbs" aria-label="Brotkrumen"[^>]*>/);
		assert.match(html, new RegExp(`<link rel="canonical" href="[^"]*/kategorie/${handle}/"`));
	}
});

test(
	"empty categories are factual, linked, noindex-follow, and omit CollectionPage",
	{
		skip,
	},
	() => {
		for (const [handle, , empty] of routes) {
			if (!empty) continue;
			const html = page(handle);
			assert.match(html, /<meta name="robots" content="noindex, follow"/);
			assert.match(html, /In dieser Kategorie sind derzeit keine Produkte gelistet\./);
			assert.match(html, /href="\/produkte\/"[^>]*>\s*Alle Produkte/);
			assert.match(html, /Weitere Kategorien/);
			assert.doesNotMatch(html, /coming soon|demnächst|bald verfügbar/i);
			assert.doesNotMatch(html, /"@type":"CollectionPage"/);
			assert.match(html, /"@type":"BreadcrumbList"/);
		}
	},
);

test("populated categories are indexable and use relationship-backed counts", { skip }, () => {
	const glp = page("glp-1-forschung");
	const metabolic = page("stoffwechsel-forschung");
	for (const html of [glp, metabolic]) {
		assert.doesNotMatch(html, /<meta name="robots"/);
		assert.match(html, /"@type":"CollectionPage"/);
		assert.match(html, /"numberOfItems":/);
		assert.match(html, /Retatrutide/);
	}
	assert.match(glp, /"numberOfItems":1/);
});

test("sitemap and llms include populated GLP-1 and exclude empty categories", { skip }, () => {
	for (const output of [sitemap(), llms()]) {
		assert.match(output, /\/kategorie\/glp-1-forschung\//);
		assert.doesNotMatch(output, /\/kategorie\/peptid-stacks\//);
		assert.doesNotMatch(output, /\/kategorie\/laborbedarf\//);
	}
});

test("the global catalog has no duplicate Retatrutide card", { skip }, () => {
	const html = readFileSync(join(DIST, "produkte", "index.html"), "utf8");
	assert.equal((html.match(/href="\/produkte\/retatrutide\/"/g) ?? []).length, 1);
	for (const [, title] of routes) assert.ok(decode(html).includes(title));
});
