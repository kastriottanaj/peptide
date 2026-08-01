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

export const CONTACT = resolveContactChannels({
	email: import.meta.env.PUBLIC_CONTACT_EMAIL,
	phone: import.meta.env.PUBLIC_CONTACT_PHONE,
	hours: import.meta.env.PUBLIC_CONTACT_HOURS,
});

export { mailtoHref, telHref } from "./contact";
