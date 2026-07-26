/**
 * Bank details shown on the order confirmation for the Banküberweisung flow.
 *
 * These are configuration, never source: they come from PUBLIC_BANK_* in
 * `storefront/.env`. The business bank account is still being opened
 * (see docs/specs/2026-07-26-checkout-workflow.md), so the defaults below are
 * obvious placeholders and `bankDetailsArePlaceholder()` lets the confirmation
 * page warn instead of showing a customer an IBAN that does not exist.
 */

const PLACEHOLDER = "PLATZHALTER";

export const BANK_DETAILS = {
	accountHolder: import.meta.env.PUBLIC_BANK_ACCOUNT_HOLDER ?? PLACEHOLDER,
	iban: import.meta.env.PUBLIC_BANK_IBAN ?? PLACEHOLDER,
	bic: import.meta.env.PUBLIC_BANK_BIC ?? PLACEHOLDER,
	bankName: import.meta.env.PUBLIC_BANK_NAME ?? PLACEHOLDER,
};

export function bankDetailsArePlaceholder(): boolean {
	return Object.values(BANK_DETAILS).some(
		(value) => !value || value === PLACEHOLDER,
	);
}

/**
 * Payment reference the customer types into their banking app. The backend
 * writes `metadata.bank_reference` on order.placed; this is the fallback so the
 * confirmation page always shows something usable.
 */
export function paymentReference(order: {
	display_id?: number | string | null;
	metadata?: Record<string, unknown> | null;
}): string {
	const stored = order.metadata?.bank_reference;
	if (typeof stored === "string" && stored) return stored;
	return `PE-${String(order.display_id ?? "").padStart(6, "0")}`;
}
