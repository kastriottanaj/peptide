/**
 * The contact channels the business actually offers.
 *
 * Configuration, never source — the same rule `bank.ts` follows, for the same
 * reason: the operating company is still being established, so there is no
 * address or telephone number in this repository to hard-code, and inventing
 * one is the failure this module is built to make impossible.
 *
 * `contact.ts` decides what counts as a real value and is where the reasoning
 * lives; this file is only the adapter that reads the environment, mirroring
 * the `canonical.ts` / `site.ts` split so the rules stay unit testable.
 *
 * Each variable is read as an explicit member expression rather than by
 * spreading `import.meta.env`, so Vite's build-time substitution still applies
 * wherever these end up.
 *
 * Consumed by `/contact/`, by the Datenschutz controller block (Art. 13 Abs. 1
 * lit. a DSGVO wants a real address) and by the Organization JSON-LD node, so
 * one variable fills every place the address belongs.
 */

import { resolveContactChannels } from "./contact";
import { resolveLegalEntity } from "./legal-entity";

export const CONTACT = resolveContactChannels({
	email: import.meta.env.PUBLIC_CONTACT_EMAIL,
	phone: import.meta.env.PUBLIC_CONTACT_PHONE,
	hours: import.meta.env.PUBLIC_CONTACT_HOURS,
});

/**
 * The operating company for the Impressum and the Datenschutz controller block.
 * `legal-entity.ts` decides what counts as a real value; this only reads the
 * environment. Unset fields render as `[Platzhalter]` rather than disappearing:
 * on a legal page a missing mandatory field has to be visible.
 */
export const COMPANY = resolveLegalEntity({
	name: import.meta.env.PUBLIC_COMPANY_NAME,
	street: import.meta.env.PUBLIC_COMPANY_STREET,
	locality: import.meta.env.PUBLIC_COMPANY_LOCALITY,
	country: import.meta.env.PUBLIC_COMPANY_COUNTRY,
	representative: import.meta.env.PUBLIC_COMPANY_REPRESENTATIVE,
	registerAuthority: import.meta.env.PUBLIC_COMPANY_REGISTER_AUTHORITY,
	registerNumber: import.meta.env.PUBLIC_COMPANY_REGISTER_NUMBER,
	vatId: import.meta.env.PUBLIC_COMPANY_VAT_ID,
});

export { mailtoHref, telHref } from "./contact";
export { postalAddress } from "./legal-entity";
