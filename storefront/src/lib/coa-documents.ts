/**
 * The one place that decides whether an analysis document exists for a variant.
 *
 * Shared by `/coa-pruefen/`, the product page and the discovery predicate in
 * `content-index.ts`, so the checker, the product detail page, the robots
 * directive, the sitemap and llms.txt can never disagree about what is linked.
 *
 * Three rules govern everything below, and each exists because getting it wrong
 * would put a false claim about analytical documentation on a public page:
 *
 * 1. **Variant-level only.** A document is read from `variant.metadata` and
 *    nowhere else. Analytical documentation is batch-bound — the site says so
 *    itself at `/qualitaet-analyse/#chargendokumentation` — so a product-level
 *    document rendered under a pack size would assert coverage nobody
 *    established. Product metadata is never consulted here, which is the
 *    simplest way to guarantee that.
 * 2. **`coa_status` and `purity` are not evidence.** Both are seeded
 *    placeholders (`data_status: "placeholder"`), identical across the whole
 *    catalog, with no document behind them. Reading either would industrialise
 *    a false availability claim into the tool built to report the truth.
 * 3. **Invalid degrades to absent, never to a broken link.** A URL that fails
 *    validation produces the ordinary "no document" state. Rendering it as a
 *    dead or partially trusted link would be worse than saying nothing.
 */

import type { HttpTypes } from "@medusajs/types";
import type { CatalogProduct } from "./catalog.ts";

/** A document that passed every check in `readVariantDocument`. */
export type CoaDocument = {
	/** Validated, allowlisted, absolute https URL. */
	url: string;
	/** Optional stored fields. `null` renders as "nicht hinterlegt", never as a guess. */
	type: string | null;
	analysisDate: string | null;
	batch: string | null;
};

/**
 * How a variant is addressed in public output: pack size and SKU.
 *
 * Deliberately no `variant.id` or `product.id`. Nothing this feature renders
 * needs a Medusa identifier, so none is carried into the DOM. (The Stack
 * Builder does emit variant ids because its preset payloads must resolve an
 * exact variant on click; a lookup table has no such need.)
 */
export type CoaVariantRef = {
	packSize: string;
	sku: string | null;
};

export type CoaVariantStatus =
	| { state: "document"; variant: CoaVariantRef; document: CoaDocument }
	| { state: "none"; variant: CoaVariantRef };

export type CoaProductEntry = {
	handle: string;
	title: string;
	researchCode: string | null;
	variants: CoaVariantStatus[];
};

export type CoaLookupModel = {
	products: CoaProductEntry[];
	/** Valid documents only — the number the discovery predicate counts. */
	documentCount: number;
	/** False when the build produced no catalog at all: state (f). */
	catalogAvailable: boolean;
};

/** Longest sensible free-text field; anything longer is treated as absent. */
const MAX_FIELD_LENGTH = 60;

function optionalString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > MAX_FIELD_LENGTH) return null;
	return trimmed;
}

/**
 * `YYYY-MM-DD`, and a date that actually exists.
 *
 * The round-trip through `toISOString` rejects `2026-02-30`, which the regexp
 * alone would accept and which would then be printed as if a lab had signed a
 * document on it.
 */
function optionalIsoDate(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
	const parsed = new Date(`${trimmed}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : null;
}

/**
 * Is this a document URL we are willing to link to?
 *
 * Exact origin equality against the allowlist — not a suffix or `includes`
 * test, so `https://api.peptideeinkaufen.de.evil.test/x.pdf` fails. `new URL`
 * handles the scheme cases (`file:`, `data:`, `javascript:`, `blob:`) by
 * producing a protocol that is not `https:`; protocol-relative `//host/x.pdf`
 * is rejected before parsing, because `new URL` cannot resolve it without a
 * base and a caller-supplied base would silently invent an origin.
 */
export function isAllowedDocumentUrl(
	raw: unknown,
	allowedOrigins: readonly string[],
): boolean {
	if (typeof raw !== "string") return false;
	const candidate = raw.trim();
	if (!candidate || candidate.startsWith("//")) return false;

	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return false;
	}

	if (url.protocol !== "https:") return false;
	// Credentials in a document URL are either a leak or a phishing vector.
	if (url.username || url.password) return false;

	return allowedOrigins.includes(url.origin);
}

/**
 * The document linked to this exact variant, or `null`.
 *
 * A missing or rejected `coa_document_url` discards the document entirely; a
 * missing or malformed *optional* field only clears that field, so a real
 * document is never withheld because its batch number was not recorded.
 */
export function readVariantDocument(
	variant: HttpTypes.StoreProductVariant,
	allowedOrigins: readonly string[],
): CoaDocument | null {
	const metadata = (variant.metadata ?? {}) as Record<string, unknown>;
	const url = metadata.coa_document_url;
	if (!isAllowedDocumentUrl(url, allowedOrigins)) return null;

	return {
		url: (url as string).trim(),
		type: optionalString(metadata.coa_document_type),
		analysisDate: optionalIsoDate(metadata.coa_analysis_date),
		batch: optionalString(metadata.coa_batch),
	};
}

function variantRef(variant: HttpTypes.StoreProductVariant): CoaVariantRef {
	return {
		packSize: optionalString(variant.title) ?? "Packgröße ohne Bezeichnung",
		sku: optionalString(variant.sku),
	};
}

/** Reads only the variant it is handed. There is no sibling or parent lookup. */
export function resolveVariantStatus(
	variant: HttpTypes.StoreProductVariant,
	allowedOrigins: readonly string[],
): CoaVariantStatus {
	const variantReference = variantRef(variant);
	const document = readVariantDocument(variant, allowedOrigins);
	return document
		? { state: "document", variant: variantReference, document }
		: { state: "none", variant: variantReference };
}

export function buildCoaLookupModel(
	products: CatalogProduct[],
	allowedOrigins: readonly string[],
): CoaLookupModel {
	const entries: CoaProductEntry[] = products
		.filter((product) => typeof product.handle === "string" && product.handle)
		.map((product) => {
			const metadata = (product.metadata ?? {}) as Record<string, unknown>;
			return {
				handle: product.handle as string,
				title: optionalString(product.title) ?? (product.handle as string),
				// The only product-level field read anywhere in this module, and it is
				// a search aid, never document evidence.
				researchCode:
					typeof metadata.research_code === "string"
						? metadata.research_code.trim() || null
						: null,
				variants: (product.variants ?? []).map((variant) =>
					resolveVariantStatus(variant, allowedOrigins),
				),
			};
		});

	return {
		products: entries,
		documentCount: entries.reduce(
			(total, entry) =>
				total + entry.variants.filter((status) => status.state === "document").length,
			0,
		),
		catalogAvailable: entries.length > 0,
	};
}

/** Exact handle match. No fuzzy match and no nearest-product substitution. */
export function findProduct(
	model: CoaLookupModel,
	handle: string,
): CoaProductEntry | null {
	const wanted = handle.trim();
	return model.products.find((entry) => entry.handle === wanted) ?? null;
}

/**
 * Exact pack-size match after trimming.
 *
 * No numeric proximity: a request for `10 mg` is never satisfied by `5 mg`,
 * even when it is the only pack size that has a document.
 */
export function findVariant(
	entry: CoaProductEntry,
	packSize: string,
): CoaVariantStatus | null {
	const wanted = packSize.trim();
	return entry.variants.find((status) => status.variant.packSize === wanted) ?? null;
}

/**
 * The single predicate behind the robots directive, the sitemap entry and the
 * llms.txt entry. It counts validated documents and nothing else — never
 * `coa_status`, never a purity string, never a product-level field.
 */
export function hasLinkedDocuments(model: CoaLookupModel): boolean {
	return model.documentCount > 0;
}

/** Every variant carrying a document, for the ItemList and the summary line. */
export function listedDocuments(
	model: CoaLookupModel,
): Array<{ product: CoaProductEntry; status: CoaVariantStatus & { state: "document" } }> {
	return model.products.flatMap((product) =>
		product.variants
			.filter(
				(status): status is CoaVariantStatus & { state: "document" } =>
					status.state === "document",
			)
			.map((status) => ({ product, status })),
	);
}
