import type { HttpTypes } from "@medusajs/types";
import type { CatalogCategory, CatalogProduct } from "./catalog.ts";
import { formatEur } from "./pricing.ts";
import { productImageAlt } from "./product-image-alt.ts";
import { isVariantAvailable } from "./variant-availability.ts";

export type StackVariant = {
	id: string;
	title: string;
	amount: number | null;
	currency: string | null;
	formattedPrice: string | null;
	available: boolean;
	selectable: boolean;
};

export type StackProduct = {
	id: string;
	handle: string;
	title: string;
	description: string | null;
	thumbnail: string | null;
	imageAlt: string;
	researchCode: string | null;
	purity: string | null;
	coaStatus: string | null;
	categoryHandles: string[];
	categoryNames: string[];
	variants: StackVariant[];
	defaultVariantId: string | null;
};

export type StackCategory = {
	id: string;
	handle: string;
	name: string;
	productCount: number;
};

export const STACK_PRESETS = [
	{
		id: "regeneration",
		name: "Regenerations-Panel",
		description: "Katalogauswahl für dokumentierte Forschungsprojekte.",
		handles: ["bpc-157", "tb-500"],
	},
	{
		id: "struktur",
		name: "Struktur-Panel",
		description: "Katalogauswahl für strukturbezogene Analyseprojekte.",
		handles: ["ghk-cu", "bpc-157"],
	},
	{
		id: "stoffwechsel",
		name: "Stoffwechsel-Panel",
		description: "Katalogauswahl für stoffwechselbezogene Modellforschung.",
		handles: ["retatrutide", "mots-c"],
	},
] as const;

export type StackPreset = {
	id: string;
	name: string;
	description: string;
	components: Array<{
		handle: string;
		productId: string | null;
		productTitle: string | null;
		variantId: string | null;
		status: "available" | "missing" | "unavailable";
	}>;
	selectable: boolean;
};

export type StackBuilderModel = {
	products: StackProduct[];
	categories: StackCategory[];
	presets: StackPreset[];
};

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapVariant(variant: HttpTypes.StoreProductVariant): StackVariant {
	const amount = variant.calculated_price?.calculated_amount;
	const currency = optionalString(variant.calculated_price?.currency_code)?.toLowerCase() ?? null;
	const priced = typeof amount === "number" && currency !== null;
	const available = isVariantAvailable(variant);

	return {
		id: variant.id,
		title: optionalString(variant.title) ?? "Packgröße ohne Bezeichnung",
		amount: typeof amount === "number" ? amount : null,
		currency,
		formattedPrice: priced ? formatEur(amount, currency) : null,
		available,
		selectable: available && priced,
	};
}

function mapProduct(product: CatalogProduct): StackProduct {
	const metadata = (product.metadata ?? {}) as Record<string, unknown>;
	const variants = (product.variants ?? []).map(mapVariant);
	const defaultVariant = variants.find((variant) => variant.selectable);

	return {
		id: product.id,
		handle: product.handle ?? product.id,
		title: product.title,
		description: optionalString(product.description),
		thumbnail: optionalString(product.thumbnail),
		imageAlt: productImageAlt(product, "card"),
		researchCode: optionalString(metadata.research_code),
		purity: optionalString(metadata.purity),
		coaStatus: optionalString(metadata.coa_status),
		categoryHandles: (product.categories ?? [])
			.map((category) => optionalString(category.handle))
			.filter((handle): handle is string => handle !== null),
		categoryNames: (product.categories ?? [])
			.map((category) => optionalString(category.name))
			.filter((name): name is string => name !== null),
		variants,
		defaultVariantId: defaultVariant?.id ?? null,
	};
}

function resolvePresets(products: StackProduct[]): StackPreset[] {
	const byHandle = new Map(products.map((product) => [product.handle, product]));

	return STACK_PRESETS.map((preset) => {
		const components = preset.handles.map((handle) => {
			const product = byHandle.get(handle);
			if (!product) {
				return {
					handle,
					productId: null,
					productTitle: null,
					variantId: null,
					status: "missing" as const,
				};
			}

			return {
				handle,
				productId: product.id,
				productTitle: product.title,
				variantId: product.defaultVariantId,
				status: product.defaultVariantId ? ("available" as const) : ("unavailable" as const),
			};
		});

		return {
			...preset,
			components,
			selectable: components.every((component) => component.status === "available"),
		};
	});
}

export function buildStackBuilderModel(
	products: CatalogProduct[],
	categories: CatalogCategory[],
): StackBuilderModel {
	const mappedProducts = products.map(mapProduct);
	const counts = new Map<string, number>();
	for (const product of mappedProducts) {
		for (const handle of product.categoryHandles) {
			counts.set(handle, (counts.get(handle) ?? 0) + 1);
		}
	}

	return {
		products: mappedProducts,
		categories: categories.map((category) => ({
			id: category.id,
			handle: category.handle,
			name: category.name,
			productCount: counts.get(category.handle) ?? 0,
		})),
		presets: resolvePresets(mappedProducts),
	};
}

export function comparableTotal(
	variants: Array<Pick<StackVariant, "amount" | "currency">>,
): { amount: number; currency: string } | null {
	if (variants.length === 0) return { amount: 0, currency: "eur" };
	if (variants.some((variant) => variant.amount === null || variant.currency === null)) {
		return null;
	}
	const currencies = new Set(variants.map((variant) => variant.currency));
	if (currencies.size !== 1) return null;
	return {
		amount: variants.reduce((sum, variant) => sum + (variant.amount ?? 0), 0),
		currency: variants[0].currency ?? "eur",
	};
}
