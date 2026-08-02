/**
 * Alt text for product images, derived from the product record rather than
 * written per call site.
 *
 * One function so the listing card, the product page and the OpenGraph preview
 * cannot describe the same image three different ways, and so the wording is
 * reviewed once. `lib/product-image-alt.ts` in the `peptide` project has the
 * same job; this is the version the fields available here can actually support.
 *
 * ## What it deliberately does not say
 *
 * The alt describes what the image *is*, not what the product *claims*. Purity,
 * COA status and research code are attributes of the record, not things visible
 * in a photograph — and the current purity values are fabricated placeholders
 * (see AGENTS.md), so putting them in alt text would assert an analytical result
 * in a place no one reviews. Nothing here claims a vial, a powder, a laboratory
 * or a certificate either: no product carries an image yet, so the contents of
 * the future photographs are unknown and cannot be described honestly.
 *
 * When real product photography lands, extend this with the profile fields that
 * come with it (form, view, visible detail) — that is the point of routing every
 * caller through one function.
 */

/** The minimum a caller has to supply; `StoreProduct` satisfies it. */
export interface ProductImageSubject {
	title?: string | null;
}

/**
 * Where the image appears. The wording is identical today; the parameter exists
 * so a context that needs different phrasing (a gallery view, a second angle)
 * gets it here instead of inline at the call site.
 */
export type ProductImageContext = "card" | "detail" | "social";

/** Fallback when a product somehow has no title — better than an empty alt. */
const UNNAMED = "Forschungspeptid";

/**
 * German alt text for a product image.
 *
 * The product name leads, because that is the information the image carries in
 * a listing: which product this is. "Produktabbildung" follows to state what the
 * picture is, which keeps the value from reading as a bare repeat of the
 * adjacent heading on the product page, and keeps it useful in image search
 * without stuffing keywords into it.
 */
export function productImageAlt(
	product: ProductImageSubject,
	_context: ProductImageContext = "card",
): string {
	const name = product.title?.trim() || UNNAMED;
	return `${name} – Produktabbildung`;
}
