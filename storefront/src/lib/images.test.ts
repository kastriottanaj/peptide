/**
 * Guards on how the storefront loads and describes images.
 *
 * Three layers, and the split is the point:
 *
 * 1. **Unit tests** over `product-image-alt.ts` and `product-grid.ts`. These
 *    pin the alt-text wording and the above-the-fold classification, which are
 *    the two decisions everything else derives from.
 *
 * 2. **Source scans** over the three `.astro` files that render an `<img>`.
 *    These always run, and they are the tests that actually bite today: no
 *    product in the catalog carries a thumbnail, so `dist/` contains zero
 *    `<img>` elements and a built-output-only check would pass vacuously while
 *    someone deleted `loading="lazy"`. The scans assert the attributes are in
 *    the source, whatever the catalog happens to hold.
 *
 * 3. **Built-output audits**, skipped when `dist/` is absent. These re-check the
 *    same invariants against whatever images a build did emit, so they start
 *    covering real markup the moment product photography lands.
 *
 * ## Why an explicit classification instead of DOM order
 *
 * Whether a product card is inside the first viewport cannot be read off the
 * document: the same `ProductCard` sits below a full-height hero on `/` and
 * directly under the `<h1>` on `/produkte/`, and the grid is responsive. So the
 * page declares it (`aboveTheFold`), `product-grid.ts` owns the number, and
 * these tests assert against that classification rather than counting elements.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { productImageAlt } from "./product-image-alt.ts";
import { EAGER_CARD_COUNT, isAboveTheFoldCard } from "./product-grid.ts";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const built = existsSync(DIST);
const skip = built ? false : "no dist/ — run `npm run build` first";

const source = (relative: string): string =>
	readFileSync(join(SRC, relative), "utf8");

/**
 * The complete set of files that render an `<img>`. A new one has to be added
 * here deliberately, which is what stops an image shipping without a decision
 * about how it loads — see the "no unaudited <img>" test at the bottom.
 */
const IMAGE_SOURCES = {
	card: "components/ProductCard.astro",
	spotlight: "pages/index.astro",
	detail: "pages/produkte/[handle].astro",
} as const;

/** The `<img …>` tags written in a source file, as raw strings. */
function imgTags(relative: string): string[] {
	return source(relative).match(/<img\b[^>]*>/gs) ?? [];
}

const attr = (tag: string, name: string): string | null => {
	const value = tag
		.match(new RegExp(`\\b${name}=(?:"([^"]*)"|\\{([^}]*)\\})`, "s"))
		?.slice(1)
		.find((candidate) => candidate !== undefined);
	if (value !== undefined) return value;
	// Astro serialises an explicitly empty string as a boolean HTML attribute
	// (`alt` rather than `alt=""`). It still represents the intended empty alt.
	return new RegExp(`\\s${name}(?:\\s|>|$)`).test(tag) ? "" : null;
};

// ---------------------------------------------------------------------------
// Alt text
// ---------------------------------------------------------------------------

test("alt text names the product and says what the image is", () => {
	assert.equal(productImageAlt({ title: "BPC-157" }), "BPC-157 – Produktabbildung");
	assert.equal(
		productImageAlt({ title: "GHK-Cu" }, "detail"),
		"GHK-Cu – Produktabbildung",
	);
});

test("alt text survives a product with no usable title", () => {
	for (const title of [undefined, null, "", "   "]) {
		const alt = productImageAlt({ title });
		assert.ok(alt.length > 0, `empty alt for title ${JSON.stringify(title)}`);
		assert.ok(!alt.startsWith("–"), `dangling separator for ${JSON.stringify(title)}`);
	}
});

test("alt text is never a bare generic value", () => {
	// The failure mode an audit tool cannot see: every image carrying the same
	// placeholder string, which tells a screen-reader user nothing about which
	// product they are on.
	const GENERIC = [
		"bild",
		"foto",
		"image",
		"produktbild",
		"produktabbildung",
		"product image",
		"grafik",
	];
	for (const title of ["BPC-157", "Semax", "MOTS-c"]) {
		const alt = productImageAlt({ title }).trim().toLowerCase();
		assert.ok(!GENERIC.includes(alt), `alt is the generic value "${alt}"`);
		assert.ok(alt.includes(title.toLowerCase()), `alt does not name ${title}`);
	}
});

test("alt text uses no 'Bild von' / 'Foto von' filler", () => {
	const alt = productImageAlt({ title: "TB-500" });
	assert.doesNotMatch(alt, /\b(bild|foto|abbildung) von\b/i);
});

test("alt text asserts no analytical or medical claim", () => {
	// Purity, COA status and lab activity are attributes of the record, not of
	// the photograph — and the current purity values are placeholders. Alt text
	// is not a place to restate them, because nobody reviews it as copy.
	const alt = productImageAlt({ title: "Retatrutide" });
	assert.doesNotMatch(
		alt,
		/\b(rein(heit)?|purity|COA|zertifi|gepr[üu]ft|labor|analys|HPLC|steril|dosier|wirk)/i,
	);
});

test("each product gets a distinct alt value", () => {
	const titles = ["BPC-157", "TB-500", "GHK-Cu", "MOTS-c", "Semax", "Retatrutide"];
	const alts = new Set(titles.map((title) => productImageAlt({ title })));
	assert.equal(alts.size, titles.length);
});

// ---------------------------------------------------------------------------
// Above-the-fold classification
// ---------------------------------------------------------------------------

test("the listing grid classifies exactly one row as above the fold", () => {
	assert.equal(EAGER_CARD_COUNT, 4);
	for (let i = 0; i < EAGER_CARD_COUNT; i++) {
		assert.equal(isAboveTheFoldCard(i), true, `card ${i} should be eager`);
	}
	assert.equal(isAboveTheFoldCard(EAGER_CARD_COUNT), false);
	assert.equal(isAboveTheFoldCard(99), false);
});

test("ProductCard defaults to lazy when a page does not classify it", () => {
	// The default has to be the safe one: a page that forgets to pass the prop
	// must not silently eager-load a grid that is nowhere near the viewport.
	assert.match(source(IMAGE_SOURCES.card), /aboveTheFold\s*=\s*false\b/);
});

// ---------------------------------------------------------------------------
// Source scans — the attributes each <img> must carry
// ---------------------------------------------------------------------------

test("every <img> in the source has an alt attribute", () => {
	const missing: string[] = [];
	for (const relative of Object.values(IMAGE_SOURCES)) {
		for (const tag of imgTags(relative)) {
			if (attr(tag, "alt") === null) missing.push(`${relative}: ${tag.slice(0, 60)}…`);
		}
	}
	assert.deepEqual(missing, []);
});

test("every <img> in the source declares width, height and decoding", () => {
	const wrong: string[] = [];
	for (const relative of Object.values(IMAGE_SOURCES)) {
		for (const tag of imgTags(relative)) {
			for (const name of ["width", "height", "decoding"]) {
				if (attr(tag, name) === null) wrong.push(`${relative}: no ${name}`);
			}
			if (attr(tag, "decoding") !== "async") {
				wrong.push(`${relative}: decoding is not async`);
			}
		}
	}
	assert.deepEqual(wrong, []);
});

test("every <img> in the source states how it loads", () => {
	// An omitted `loading` is eager by default, which is a decision made by
	// accident. Each of the three has to say which it is.
	const wrong: string[] = [];
	for (const relative of Object.values(IMAGE_SOURCES)) {
		for (const tag of imgTags(relative)) {
			const loading = attr(tag, "loading");
			if (loading === null) wrong.push(`${relative}: no loading attribute`);
		}
	}
	assert.deepEqual(wrong, []);
});

test("REGRESSION: the product-page LCP image is never lazy", () => {
	const [tag, ...rest] = imgTags(IMAGE_SOURCES.detail);
	assert.equal(rest.length, 0, "product page grew a second <img> — reclassify it");
	assert.equal(attr(tag, "loading"), "eager");
	assert.equal(attr(tag, "fetchpriority"), "high");
	assert.equal(attr(tag, "width"), "440");
	assert.equal(attr(tag, "height"), "440");
});

test("the homepage product image yields priority to the decorative LCP hero", () => {
	// The Astro <Picture> is the one promoted hero asset. The optional remote
	// product thumbnail is secondary and must not compete with it.
	const tag = imgTags(IMAGE_SOURCES.spotlight)[0];
	assert.ok(tag, "homepage no longer renders a spotlight image");
	assert.equal(attr(tag, "loading"), "lazy");
	assert.equal(attr(tag, "fetchpriority"), null);
	assert.match(source(IMAGE_SOURCES.spotlight), /<Picture[\s\S]*?loading="eager"[\s\S]*?fetchpriority="high"/);
});

test("fetchpriority=\"high\" is used on the LCP image and nowhere else", () => {
	const promoted: string[] = [];
	for (const [name, relative] of Object.entries(IMAGE_SOURCES)) {
		for (const tag of imgTags(relative)) {
			if (attr(tag, "fetchpriority") === "high") promoted.push(name);
		}
	}
	assert.deepEqual(promoted, ["detail"]);
});

test("the card image loads lazily unless the page classified it otherwise", () => {
	const tag = imgTags(IMAGE_SOURCES.card)[0];
	assert.ok(tag, "ProductCard no longer renders an <img>");
	assert.match(attr(tag, "loading") ?? "", /aboveTheFold\s*\?\s*"eager"\s*:\s*"lazy"/);
	assert.equal(attr(tag, "fetchpriority"), null, "cards must not be promoted");
});

test("REGRESSION: no unaudited <img> anywhere in src/", () => {
	// Adding an image to a page not listed in IMAGE_SOURCES skips every rule
	// above, so the file set itself is asserted.
	const found: string[] = [];
	const walk = (dir: string, prefix = "") => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(join(dir, entry.name), rel);
			else if (/\.(astro|md)$/.test(entry.name)) {
				const text = readFileSync(join(dir, entry.name), "utf8");
				if (/<img\b/.test(text) || /!\[[^\]]*\]\(/.test(text)) found.push(rel);
			}
		}
	};
	walk(SRC);
	assert.deepEqual(found.sort(), Object.values(IMAGE_SOURCES).slice().sort());
});

// ---------------------------------------------------------------------------
// Decorative SVG
// ---------------------------------------------------------------------------

test("decorative inline SVG is hidden from assistive technology", () => {
	// The vial illustration, the header search glyph and the cart glyph carry no
	// information the surrounding text does not already give. Each must be
	// hidden rather than described, or a screen reader announces an unlabelled
	// graphic on every page.
	const DECORATIVE = [
		IMAGE_SOURCES.card,
		IMAGE_SOURCES.spotlight,
		IMAGE_SOURCES.detail,
		"layouts/BaseLayout.astro",
	];
	const bare: string[] = [];
	for (const relative of DECORATIVE) {
		for (const tag of source(relative).match(/<svg\b[^>]*>/gs) ?? []) {
			const labelled = /\brole="img"/.test(tag) && /\baria-label[=＝]/.test(tag);
			if (!/aria-hidden="true"/.test(tag) && !labelled) {
				bare.push(`${relative}: ${tag.replace(/\s+/g, " ").slice(0, 70)}…`);
			}
		}
	}
	assert.deepEqual(bare, []);
});

test("the cart link keeps an accessible name of its own", () => {
	// Its only visible content is an aria-hidden glyph and a numeric badge, so
	// without the label the link announces as "link" or reads out a bare digit.
	assert.match(
		source("layouts/BaseLayout.astro"),
		/<a[^>]*class="nav__cart"[^>]*aria-label="Warenkorb"/s,
	);
});

// ---------------------------------------------------------------------------
// Built output
// ---------------------------------------------------------------------------

function htmlFiles(dir = DIST, prefix = ""): string[] {
	if (!built) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) return htmlFiles(join(dir, entry.name), rel);
		return entry.name.endsWith(".html") ? [rel] : [];
	});
}

/** Every `<img>` that shipped, tagged with the page it shipped on. */
function builtImages(): Array<{ page: string; tag: string }> {
	return htmlFiles().flatMap((page) =>
		(readFileSync(join(DIST, page), "utf8").match(/<img\b[^>]*>/g) ?? []).map(
			(tag) => ({ page, tag }),
		),
	);
}

test("built pages exist to audit", { skip }, () => {
	assert.ok(htmlFiles().length > 0, "no built pages found");
});

test("no built <img> is missing alt, dimensions or a loading decision", { skip }, () => {
	const wrong: string[] = [];
	for (const { page, tag } of builtImages()) {
		for (const name of ["alt", "width", "height", "loading", "decoding"]) {
			if (attr(tag, name) === null) wrong.push(`${page}: <img> without ${name}`);
		}
		if (
			(attr(tag, "alt") ?? "").trim() === "" &&
			attr(tag, "aria-hidden") !== "true"
		) {
			// Only explicitly aria-hidden artwork may carry an empty alt. A product
			// image is never decorative: it identifies which product a card shows.
			wrong.push(`${page}: <img> with empty alt`);
		}
	}
	assert.deepEqual(wrong, []);
});

test("no built page promotes more than one image", { skip }, () => {
	const over = htmlFiles().filter(
		(page) =>
			(readFileSync(join(DIST, page), "utf8").match(/fetchpriority="high"/g) ?? [])
				.length > 1,
	);
	assert.deepEqual(over, []);
});

test("a promoted image is never also lazy", { skip }, () => {
	const conflicting = builtImages().filter(
		({ tag }) => /fetchpriority="high"/.test(tag) && /loading="lazy"/.test(tag),
	);
	assert.deepEqual(conflicting, []);
});

test("built listing pages eager-load at most one grid row", { skip }, () => {
	const LISTINGS = htmlFiles().filter(
		(page) => page === "produkte/index.html" || page.startsWith("kategorie/"),
	);
	const over = LISTINGS.filter(
		(page) =>
			(readFileSync(join(DIST, page), "utf8").match(/loading="eager"/g) ?? [])
				.length > EAGER_CARD_COUNT,
	);
	assert.deepEqual(over, []);
});

test("the homepage lazy-loads its product row", { skip }, () => {
	// Measured at 937 px (desktop) and 1846 px (mobile) from the top: the row is
	// below the fold on both, so only the hero spotlight may be eager.
	const home = readFileSync(join(DIST, "index.html"), "utf8");
	const eager = (home.match(/loading="eager"/g) ?? []).length;
	assert.ok(eager <= 1, `homepage eager-loads ${eager} images, expected at most the spotlight`);
});

test("no built page links a broken internal asset", { skip }, () => {
	// Catches a renamed or dropped file in `_astro/` or `public/` — the failure
	// that ships a page with no stylesheet and looks fine in dev.
	const missing: string[] = [];
	for (const page of htmlFiles()) {
		const html = readFileSync(join(DIST, page), "utf8");
		const refs = [
			...(html.match(/(?:src|href)="(\/[^"]+)"/g) ?? []).map(
				(m) => m.match(/"(\/[^"]+)"/)![1],
			),
		];
		for (const ref of refs) {
			const path = ref.split(/[?#]/)[0];
			if (!/\.(js|css|svg|ico|png|jpe?g|webp|avif|woff2?|txt|json|xml)$/.test(path)) continue;
			const onDisk = join(DIST, path);
			if (!existsSync(onDisk)) missing.push(`${page} -> ${path}`);
		}
	}
	assert.deepEqual(missing, []);
});
