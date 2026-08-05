import { test } from "node:test";
import assert from "node:assert/strict";
import type { CatalogCategory, CatalogProduct } from "./catalog.ts";
import { buildStackBuilderModel, comparableTotal, STACK_PRESETS } from "./stack-builder.ts";

const category = (id: string, handle: string, name: string) =>
	({ id, handle, name } as CatalogCategory);

const variant = (
	id: string,
	title: string,
	amount: number | null = 10,
	currency = "eur",
	available = true,
) => ({
	id,
	title,
	manage_inventory: !available,
	allow_backorder: false,
	inventory_quantity: available ? 1 : 0,
	calculated_price: amount === null ? undefined : { calculated_amount: amount, currency_code: currency },
});

const product = (
	handle: string,
	options: {
		variants?: ReturnType<typeof variant>[];
		metadata?: Record<string, unknown>;
		thumbnail?: string | null;
		categories?: CatalogCategory[];
	} = {},
) => ({
	id: `prod_${handle}`,
	handle,
	title: handle.toUpperCase(),
	description: `${handle} catalog description`,
	thumbnail: options.thumbnail ?? null,
	metadata: options.metadata ?? {},
	variants: options.variants ?? [variant(`var_${handle}`, "10 mg")],
	categories: options.categories ?? [],
} as unknown as CatalogProduct);

const categories = [
	category("cat_reg", "regenerationsforschung", "Regenerationsforschung"),
	category("cat_stack", "peptid-stacks", "Peptid-Stacks"),
];

test("the exact three neutral presets are pinned by stable handles", () => {
	assert.deepEqual(
		STACK_PRESETS.map(({ name, handles }) => [name, [...handles]]),
		[
			["Regenerations-Panel", ["bpc-157", "tb-500"]],
			["Struktur-Panel", ["ghk-cu", "bpc-157"]],
			["Stoffwechsel-Panel", ["retatrutide", "mots-c"]],
		],
	);
});

test("products resolve from Medusa fields with optional metadata and image fallbacks", () => {
	const model = buildStackBuilderModel([
		product("bpc-157", {
			metadata: { research_code: "PEK-BPC", purity: ">99%", coa_status: "verfügbar" },
			thumbnail: "https://example.test/bpc.webp",
			categories: [categories[0]],
		}),
		product("without-metadata", { variants: [] }),
	], categories);
	const bpc = model.products[0];
	assert.equal(bpc.researchCode, "PEK-BPC");
	assert.equal(bpc.purity, ">99%");
	assert.equal(bpc.coaStatus, "verfügbar");
	assert.equal(bpc.thumbnail, "https://example.test/bpc.webp");
	assert.deepEqual(bpc.categoryHandles, ["regenerationsforschung"]);
	assert.equal(model.products[1].researchCode, null);
	assert.equal(model.products[1].thumbnail, null);
	assert.equal(model.products[1].defaultVariantId, null);
	assert.equal(model.categories.find((entry) => entry.handle === "peptid-stacks")?.productCount, 0);
});

test("only available variants with current calculated prices are selectable", () => {
	const model = buildStackBuilderModel([
		product("bpc-157", {
			variants: [
				variant("sold", "5 mg", 8, "eur", false),
				variant("unpriced", "10 mg", null),
				variant("ready", "15 mg", 12.5),
			],
		}),
	], categories);
	assert.deepEqual(model.products[0].variants.map(({ id, selectable }) => [id, selectable]), [
		["sold", false],
		["unpriced", false],
		["ready", true],
	]);
	assert.equal(model.products[0].defaultVariantId, "ready");
	assert.equal(model.products[0].variants[2].formattedPrice, "12,50 €");
});

test("incomplete presets stay visible and identify missing or unavailable components", () => {
	const model = buildStackBuilderModel([
		product("bpc-157"),
		product("tb-500", { variants: [variant("tb-sold", "5 mg", 20, "eur", false)] }),
	], categories);
	assert.equal(model.presets.length, 3);
	assert.equal(model.presets[0].selectable, false);
	assert.equal(model.presets[0].components[1].status, "unavailable");
	assert.equal(model.presets[1].components[0].status, "missing");
	assert.equal(model.presets[2].components[0].status, "missing");
});

test("complete presets resolve exact catalog ids without substitution", () => {
	const model = buildStackBuilderModel(
		["bpc-157", "tb-500", "ghk-cu", "retatrutide", "mots-c"].map((handle) => product(handle)),
		categories,
	);
	for (const preset of model.presets) assert.equal(preset.selectable, true);
	assert.deepEqual(
		model.presets[1].components.map(({ handle, productId }) => [handle, productId]),
		[["ghk-cu", "prod_ghk-cu"], ["bpc-157", "prod_bpc-157"]],
	);
});

test("comparison totals refuse missing prices and mixed currencies", () => {
	assert.deepEqual(comparableTotal([
		{ amount: 10, currency: "eur" },
		{ amount: 12.5, currency: "eur" },
	]), { amount: 22.5, currency: "eur" });
	assert.equal(comparableTotal([{ amount: 10, currency: "eur" }, { amount: 12, currency: "usd" }]), null);
	assert.equal(comparableTotal([{ amount: null, currency: null }]), null);
});
