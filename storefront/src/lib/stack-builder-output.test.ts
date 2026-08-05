import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const built = existsSync(DIST);
const skip = built ? false : "no dist/ — run `npm run build` first";
const source = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const builtFile = (relative: string) => readFileSync(join(DIST, relative), "utf8");

test("route uses real Medusa catalog loaders and remains comparison-only", () => {
	const page = source("pages/stack-builder.astro");
	const component = source("components/StackBuilder.astro");
	assert.match(page, /await listProducts\(\)/);
	assert.match(page, /await listCategories\(\)/);
	assert.match(page, /buildStackBuilderModel\(products, categories\)/);
	for (const text of [page, component]) {
		assert.doesNotMatch(text, /(?:addLine|createLineItem|lib\/cart|\/kasse\/|data-add-to-cart)/);
	}
	assert.doesNotMatch(component, /Jetzt bestellen|In den Warenkorb|Zur Kasse/);
});

test("server HTML contains the useful catalog and progressive controls", () => {
	const component = source("components/StackBuilder.astro");
	for (const marker of ["model.products.map", "model.categories.map", "model.presets.map", "Produktdetails", "data-static-variants"]) {
		assert.ok(component.includes(marker), `missing ${marker}`);
	}
	assert.match(component, /data-toggle-product[\s\S]*hidden/);
	assert.match(component, /const selected = new Map/);
	assert.match(component, /selected\.has\(id\)/);
	assert.match(component, /selected\.delete/);
	assert.match(component, /aria-live="polite"/);
	assert.match(component, /position: sticky/);
	assert.match(component, /max-height: 620px[\s\S]*position: static/);
	assert.doesNotMatch(component, /position:\s*fixed/);
});

test("copy and schema avoid transactional and prohibited claims", () => {
	const text = [source("pages/stack-builder.astro"), source("components/StackBuilder.astro")].join("\n");
	for (const pattern of [
		/jetzt bestellen/i,
		/in den warenkorb/i,
		/dos(?:is|ierung)/i,
		/injektion/i,
		/einnahme/i,
		/gewichtsverlust/i,
		/synerg/i,
		/wirksam(?:keit)?/i,
		/sicher(?:heit)?/i,
	]) assert.doesNotMatch(text, pattern);
	assert.doesNotMatch(text, /"@type": "(?:Product|Offer|Review|AggregateRating)"/);
});

test("navigation, discovery, and empty category relationship are scoped", () => {
	const layout = source("layouts/BaseLayout.astro");
	const index = source("lib/content-index.ts");
	const category = source("pages/kategorie/[handle].astro");
	assert.ok((layout.match(/href="\/stack-builder\/"/g) ?? []).length >= 2);
	assert.match(index, /path: "\/stack-builder"[\s\S]*changeFrequency: "weekly"[\s\S]*priority: 0\.75/);
	assert.match(category, /category\.handle === "peptid-stacks"/);
	assert.match(category, /noindexFollow=\{products\.length === 0\}/);
	assert.match(category, /Vergleichswerkzeug/);
});

test("built route has exact metadata, indexability, schema, and discovery", { skip }, () => {
	const html = builtFile("stack-builder/index.html");
	assert.match(html, /<title>Peptid Stack-Builder für Labor und Forschung<\/title>/);
	assert.match(html, /<meta name="description" content="Forschungsprodukte aus dem aktuellen Sortiment auswählen, Packgrößen und Preise vergleichen und als transparente Positionen zusammenstellen\."/);
	assert.match(html, /<h1[^>]*>Peptid Stack-Builder für Laborbestellungen<\/h1>/);
	assert.match(html, /<link rel="canonical" href="https:\/\/peptideeinkaufen\.de\/stack-builder\/"/);
	assert.doesNotMatch(html, /<meta name="robots"/);
	for (const type of ["WebApplication", "ItemList", "BreadcrumbList"]) assert.match(html, new RegExp(`"@type":"${type}"`));
	for (const type of ["Product", "Offer", "Review", "AggregateRating"]) assert.doesNotMatch(html, new RegExp(`"@type":"${type}"`));
	const sitemap = builtFile("sitemap-pages.xml");
	const llms = builtFile("llms.txt");
	assert.equal((sitemap.match(/\/stack-builder\//g) ?? []).length, 1);
	assert.equal((llms.match(/\/stack-builder\//g) ?? []).length, 1);
	const stacks = builtFile("kategorie/peptid-stacks/index.html");
	assert.match(stacks, /<meta name="robots" content="noindex, follow"/);
	assert.match(stacks, /Stack-Builder/);
});
