/**
 * Bank details shown on the order confirmation for the Banküberweisung flow.
 *
 * These are configuration, never source: they come from PUBLIC_BANK_* in
 * `storefront/.env`. The business bank account is still being opened
 * (see docs/specs/2026-07-26-checkout-workflow.md), so the defaults below are
 * obvious placeholders and `bankDetailsArePlaceholder()` lets the confirmation
 * page warn instead of showing a customer an IBAN that does not exist.
 */

import { referenceForDisplayId } from "./bank-reference";

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
 * Payment reference the customer types into their banking app.
 *
 * The backend writes `metadata.bank_reference` from an `order.placed`
 * subscriber, which is asynchronous — the confirmation page frequently renders
 * first. This used to fall back to `PE-<zero-padded display_id>`, a format the
 * backend never produces, so a customer who arrived before the subscriber ran
 * was shown a reference that matched no order and transferred money against it.
 *
 * The reference is instead derived from the order number with the same
 * definition the backend uses, so the stored value and this one always agree and
 * there is nothing to wait for. Returns null when no reference can be derived —
 * the page must then say so rather than invent one.
 */
export function paymentReference(order: {
	display_id?: number | string | null;
	metadata?: Record<string, unknown> | null;
}): string | null {
	const stored = order.metadata?.bank_reference;
	if (typeof stored === "string" && stored) return stored;
	return referenceForDisplayId(order.display_id);
}
