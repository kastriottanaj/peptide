import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const PAGE = "pages/tools.astro";
const OUTPUT = "tools/index.html";
const built = existsSync(join(DIST, OUTPUT));
const skip = built ? false : "no dist; run the build first";
const source = (file: string) => readFileSync(join(SRC, file), "utf8");
const output = (file: string) => readFileSync(join(DIST, file), "utf8");

const cards = [
	["COA-Zertifikat", "/qualitaet-analyse/"],
	["Peptid-Rechner", "/peptid-rechner/"],
	["Stack-Builder", "/produkte/"],
	["Vergleichstool", "/produkte/"],
	["Produktanfrage", "/support/anfrage/"],
	["Lagerungs-Guide", "/wissen/lagerung-lyophilisierter-peptide/"],
	["Support anfragen", "/support/anfrage/"],
] as const;

test("tools page defines the approved static resource directory", () => {
	assert.ok(existsSync(join(SRC, PAGE)));
	const page = source(PAGE);
	for (const [title, href] of cards) {
		assert.ok(page.includes(`title: "${title}"`), `missing card: ${title}`);
		assert.ok(page.includes(`href: "${href}"`), `missing destination: ${href}`);
	}
	assert.match(page, /<h1>Rechner, COA-Zertifikate und Produktvergleich<\/h1>/);
	assert.match(page, /href="\/peptid-rechner\/"[^>]*class="calculator__button"/);
	assert.match(page, /<svg[^>]*aria-hidden="true"/);
	assert.match(page, /\.tool-card:focus-visible/);
	assert.doesNotMatch(page, /client:(?:load|idle|visible|media|only)/);
	assert.doesNotMatch(page, /<script(?:\s|>)/);
});

test("tools page styling uses shared color tokens", () => {
	const page = source(PAGE);
	const styles = page.match(/<style>[\s\S]*?<\/style>/g)?.join("\n") ?? "";
	assert.doesNotMatch(styles, /#[0-9a-fA-F]{3,8}\b/);
	for (const token of ["--c-blue-tint", "--c-white", "--c-mint", "--c-green", "--c-navy"]) {
		assert.ok(styles.includes(`var(${token})`), `missing shared token: ${token}`);
	}
});

test("shared navigation and discovery expose tools exactly once", () => {
	const layout = source("layouts/BaseLayout.astro");
	assert.match(layout, /<a href="\/tools\/">Tools<\/a>/);
	assert.ok([...layout.matchAll(/href="\/tools\/"/g)].length >= 2);
	const index = source("lib/content-index.ts");
	assert.equal([...index.matchAll(/path:\s*"\/tools"/g)].length, 1);
});

test("built tools page has SEO, structured data and live links", { skip }, () => {
	const html = output(OUTPUT);
	assert.equal([...html.matchAll(/<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>/g)].length, 1);
	assert.match(html, /<title>Tools für Forschungspeptide: Rechner, COA &amp; Vergleich \| Peptide Einkaufen<\/title>/);
	assert.match(html, /<meta name="description" content="Peptid-Rechner, COA-Zertifikate, Produktvergleich und Lagerungs-Guide für Forschungszwecke zentral nutzen\. Tools jetzt entdecken!">/);
	const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
	assert.ok(canonical);
	assert.equal(new URL(canonical).pathname, "/tools/");
	assert.doesNotMatch(html, /<meta name="robots"/);
	assert.match(html, /"@type":"CollectionPage"/);
	assert.match(html, /"@type":"BreadcrumbList"/);
	for (const [, href] of cards) assert.ok(html.includes(`href="${href}"`), href);

	const sitemap = output("sitemap-pages.xml");
	assert.equal(sitemap.split("/tools/").length - 1, 1);
	const llms = output("llms.txt");
	assert.equal(llms.split("/tools/").length - 1, 1);
});
