/** Focused regression coverage for the CRO homepage redesign. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const HOME = join(SRC, "pages/index.astro");
const LAYOUT = join(SRC, "layouts/BaseLayout.astro");
const source = readFileSync(HOME, "utf8");
const layout = readFileSync(LAYOUT, "utf8");
const built = existsSync(join(DIST, "index.html"));
const skip = built ? false : "no dist/index.html — run `npm run build` first";

const TITLE = "Peptide kaufen in Deutschland für Forschung & Analyse";
const DESCRIPTION =
	"Forschungspeptide für Labor und Analyse mit klaren Produktdaten, Packgrößen und COA-Status. Jetzt Produkte vergleichen!";

function visibleText(markup: string): string {
	return markup
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();
}

test("homepage pins the approved metadata and exactly one H1", () => {
	assert.match(source, new RegExp(`title="${TITLE.replace("&", "&")}"`));
	assert.ok(source.includes(`description="${DESCRIPTION}"`));
	const headings = source.match(/<h1\b/g) ?? [];
	assert.equal(headings.length, 1);
	assert.match(
		source,
		/<h1[^>]*>\s*Forschungspeptide in Deutschland kaufen\s*<\/h1>/,
	);
});

test("homepage renders the approved factual section hierarchy", () => {
	for (const heading of [
		"Informationen vor der Produktauswahl prüfen",
		"Qualität und Transparenz im Überblick",
		"Beliebte Forschungsbereiche",
		"Häufige Fragen",
		"Forschungsprodukte und Informationen entdecken",
	]) {
		assert.ok(source.includes(heading), `missing section heading: ${heading}`);
	}
	assert.doesNotMatch(source, /<h[4-6]\b/);
});

test("homepage links to verified quality, support and category routes", () => {
	for (const href of [
		"/produkte/",
		"/qualitaet-analyse/",
		"/wissen/reinheit-und-coa/",
		"/versand-zahlung/",
		"/forschungszwecke/",
		"/redaktionsrichtlinien/",
		"/faq/",
		"/support/anfrage/",
	]) {
		assert.ok(source.includes(`"${href}"`), `missing link: ${href}`);
	}
	for (const handle of [
		"neuropeptid-forschung",
		"regenerationsforschung",
		"signal-fragmentpeptide",
		"stoffwechsel-forschung",
	]) {
		assert.ok(source.includes(handle), `missing category: ${handle}`);
	}
	assert.match(source, /categoryPath\(category\.handle\)/);
});

test("featured product stays server-rendered and data-backed", () => {
	assert.match(source, /listProductsInSourceOrder\(\{ limit: 20 \}\)/);
	assert.match(source, /metadata[\s\S]*research_code/);
	assert.match(source, /productPath\(spotlight\.handle\)/);
	assert.match(source, /productImageAlt\(spotlight, "card"\)/);
	assert.match(source, /variant\.calculated_price\?\.calculated_amount/);
	assert.match(source, /spotlight\.thumbnail \?/);
	assert.doesNotMatch(source, /from "@medusajs\/js-sdk"|new Medusa|client:/);
	assert.doesNotMatch(source, /const spotlight\s*=\s*\{[^}]*BPC-157/s);
});

test("homepage contains no fabricated social proof or transactional control", () => {
	assert.doesNotMatch(
		source,
		/AggregateRating|"@type": "Review"|Google Bewertungen|Google-Bewertungen|4[,.]9\s*\/\s*5|320\+|testimonial/i,
	);
	assert.doesNotMatch(
		source,
		/Jetzt bestellen|AddToCart|add_to_cart|href="\/kasse\/"|cart\.add|ORDERS_ENABLED/,
	);
	assert.match(source, /Produkt ansehen/);
	assert.doesNotMatch(source, /class="mobile-action"/);
});

test("hero and product images have explicit loading and sizing decisions", () => {
	assert.match(source, /import \{ Picture \} from "astro:assets"/);
	assert.match(source, /src=\{heroImage\}/);
	assert.match(source, /formats=\{\["avif", "webp"\]\}/);
	assert.match(source, /loading="eager"[\s\S]*fetchpriority="high"/);
	assert.match(
		source,
		/<img[\s\S]*?src=\{spotlight\.thumbnail\}[\s\S]*?loading="lazy"[\s\S]*?width="240"[\s\S]*?height="240"/,
	);
});

test("shared production header, search and navigation remain accessible", () => {
	assert.match(layout, /class="brand"/);
	assert.match(layout, /Peptide<span class="brand__accent">Einkaufen/);
	assert.match(layout, /role="search"/);
	assert.match(layout, /label class="visually-hidden" for="site-search"/);
	assert.match(layout, /<nav class="nav">/);
	assert.match(layout, /\.search input:focus-visible/);
});

test("built homepage preserves metadata, canonical and indexability", { skip }, () => {
	const html = readFileSync(join(DIST, "index.html"), "utf8");
	const head = html.slice(0, html.indexOf("</head>") + 7);
	assert.match(head, new RegExp(`<title>${TITLE.replace("&", "&amp;")}</title>`));
	assert.ok(head.includes(`<meta name="description" content="${DESCRIPTION}">`));
	assert.match(head, /<link rel="canonical" href="https?:\/\/[^"/]+\/?">/);
	assert.doesNotMatch(head, /<meta name="robots"[^>]*noindex/i);
	assert.match(head, /"@type":"WebSite"/);
	assert.match(head, /"@type":"FAQPage"/);
	assert.doesNotMatch(head, /AggregateRating|"@type":"Review"/);
});

test("built homepage has one H1, real product output and no ordering CTA", { skip }, () => {
	const html = readFileSync(join(DIST, "index.html"), "utf8");
	const main = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";
	const h1s = main.match(/<h1\b/g) ?? [];
	assert.equal(h1s.length, 1);
	assert.match(visibleText(main), /Forschungspeptide in Deutschland kaufen/);
	assert.match(main, /href="\/produkte\/[^"/]+\/"/);
	assert.doesNotMatch(main, /Jetzt bestellen|add-to-cart|href="\/kasse\/"/i);
	for (const path of [
		"/kategorie/neuropeptid-forschung/",
		"/kategorie/regenerationsforschung/",
		"/kategorie/signal-fragmentpeptide/",
		"/kategorie/stoffwechsel-forschung/",
	]) {
		assert.ok(main.includes(`href="${path}"`), `missing built route: ${path}`);
	}
});
