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
 * Whether the payee is someone other than the company named in the Impressum.
 *
 * A customer asked to transfer to a name that appears nowhere else on the site
 * reads it as a scam, and their second instinct — retyping the recipient as the
 * company name — gets the transfer rejected by their bank. Both are avoidable
 * by saying who the payee is, so the pages say it.
 *
 * Derived rather than configured, and therefore **self-retiring**: the day
 * `PUBLIC_BANK_ACCOUNT_HOLDER` becomes the company account, this returns false
 * and the explanation disappears from every page at once. Nothing has to
 * remember to remove it.
 */
export function payeeDiffersFromCompany(companyName: string | null): boolean {
	if (!companyName) return false;
	if (bankDetailsArePlaceholder()) return false;

	const normalise = (value: string) => value.trim().toLowerCase();
	return normalise(BANK_DETAILS.accountHolder) !== normalise(companyName);
}

/**
 * The explanation itself, here rather than in each page so the confirmation and
 * the order lookup cannot drift apart.
 *
 * It states only what is true today. The move to a business account is the
 * owner's stated intention (2026-08-15, docs/go-live-checklist.md §1) and is
 * written as an intention — no date, because none exists. It deliberately does
 * not say the account "wird eröffnet": that wording was removed from this page
 * on 2026-08-01 as a business status nothing supported, and it is still not
 * this module's to assert.
 */
export function payeeExplanation(companyName: string): string {
	return (
		`Der Empfänger lautet nicht auf ${companyName}, sondern auf den ` +
		"vertretungsberechtigten Gesellschafter persönlich. Bitte überweisen Sie " +
		"exakt an den oben genannten Namen — tragen Sie nicht die Firmierung ein, " +
		"da Ihre Bank die Überweisung sonst zurückweisen kann. Die Umstellung auf " +
		"ein Geschäftskonto ist vorgesehen; bis dahin gilt diese Bankverbindung."
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
