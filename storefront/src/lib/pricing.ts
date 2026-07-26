/**
 * Pricing rules carried over from the peptidebestellung.de checkout.
 *
 * IMPORTANT: these values exist here for DISPLAY only — showing the customer the
 * discount they have earned and how far they are from free shipping while they
 * are still in the cart. Medusa remains authoritative for what is actually
 * charged, via a quantity promotion and shipping options that must mirror these
 * numbers. If you change a tier here, change it in Medusa too or the cart will
 * promise something the order does not honour.
 *
 * See docs/specs/2026-07-26-checkout-workflow.md.
 */

/** [minimum total quantity, discount rate] — highest threshold first. */
export const QUANTITY_DISCOUNT_TIERS: ReadonlyArray<readonly [number, number]> = [
	[10, 0.15],
	[9, 0.13],
	[8, 0.12],
	[7, 0.1],
	[6, 0.08],
	[5, 0.07],
	[4, 0.05],
	[3, 0.03],
];

export const SHIPPING_FEE_EUR = 10;
export const SHIPPING_FEE_OUTSIDE_GERMANY_EUR = 20;
export const FREE_SHIPPING_THRESHOLD_EUR = 100;

/** Discount rate for a given total item quantity across the cart. */
export function quantityDiscountRate(quantity: number): number {
	for (const [minimum, rate] of QUANTITY_DISCOUNT_TIERS) {
		if (quantity >= minimum) return rate;
	}
	return 0;
}

/** The next tier the customer could reach, or null once at the top. */
export function nextQuantityTier(
	quantity: number,
): { quantity: number; rate: number; missing: number } | null {
	const ascending = [...QUANTITY_DISCOUNT_TIERS].sort((a, b) => a[0] - b[0]);
	for (const [minimum, rate] of ascending) {
		if (quantity < minimum) {
			return { quantity: minimum, rate, missing: minimum - quantity };
		}
	}
	return null;
}

/** Shipping cost for a merchandise total that already has discounts applied. */
export function shippingTotal(
	merchandiseTotal: number,
	deliveryCountry = "de",
): number {
	if (merchandiseTotal <= 0) return 0;
	if (merchandiseTotal >= FREE_SHIPPING_THRESHOLD_EUR) return 0;

	const normalized = deliveryCountry.trim().toLowerCase();
	const isGermany = ["", "de", "deu", "deutschland", "germany"].includes(normalized);
	return isGermany ? SHIPPING_FEE_EUR : SHIPPING_FEE_OUTSIDE_GERMANY_EUR;
}

export function formatEur(amount: number, currency = "EUR"): string {
	return new Intl.NumberFormat("de-DE", {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(amount);
}
