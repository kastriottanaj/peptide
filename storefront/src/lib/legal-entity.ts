/**
 * The operating company, as the legal pages are required to name it.
 *
 * Configuration, never source — the same rule `contact.ts` and `bank.ts`
 * follow, and here the reason is sharper than either. The Impressum names a
 * real company and a real natural person at a real address. Committing that
 * puts it in git history permanently, where it cannot be corrected or removed
 * if the company, the address or the representative changes. So it arrives
 * from the environment or it does not appear at all.
 *
 * Kept free of Astro and Vite imports (no `import.meta.env`) so it is directly
 * unit testable with `node --test`; `company.ts` is the adapter that supplies
 * the configured values, mirroring the `contact.ts` / `company.ts` split.
 *
 * ## Why every field resolves independently
 *
 * The German Impressumspflicht (§ 5 DDG) is not all-or-nothing: a page naming
 * the provider and its address is better than one naming neither, even while
 * the register entry is still being looked up. Each field therefore resolves
 * on its own and a missing one renders as a visible `[Platzhalter]`, which is
 * the honest state — the opposite of an invented value, and the marker
 * `LegalLayout`'s `draft` banner refers to.
 */

// Explicit extension: this module is loaded directly by `node --test`, which
// does not resolve extensionless specifiers. Same reason `links.ts` imports
// `./canonical.ts`.
import { configuredValue } from "./contact.ts";

export interface LegalEntityInput {
	/** Firmierung including legal form, e.g. `Muster GmbH`. */
	name?: string | undefined;
	street?: string | undefined;
	/** Whatever the destination country puts on the line below the street. */
	locality?: string | undefined;
	country?: string | undefined;
	/** The natural person authorised to represent the company. */
	representative?: string | undefined;
	/** Register-keeping body. Not necessarily a German Amtsgericht. */
	registerAuthority?: string | undefined;
	registerNumber?: string | undefined;
	vatId?: string | undefined;
}

export interface LegalEntity {
	name: string | null;
	street: string | null;
	locality: string | null;
	country: string | null;
	representative: string | null;
	registerAuthority: string | null;
	registerNumber: string | null;
	vatId: string | null;
	/** True once the provider can be identified and served at an address. */
	identifiable: boolean;
	/**
	 * True only when nothing is outstanding. `LegalLayout`'s `draft` prop is a
	 * separate, manual decision — a complete Impressum still has to be read by
	 * a lawyer (docs/go-live-checklist.md §4) before it loses the banner.
	 */
	complete: boolean;
}

/**
 * Resolve the configured company.
 *
 * `identifiable` deliberately requires the address as well as the name: § 5 DDG
 * asks for an address at which the provider can actually be served, so a name
 * on its own does not make the provider identifiable in the sense the statute
 * means.
 */
export function resolveLegalEntity(input: LegalEntityInput): LegalEntity {
	const entity = {
		name: configuredValue(input.name),
		street: configuredValue(input.street),
		locality: configuredValue(input.locality),
		country: configuredValue(input.country),
		representative: configuredValue(input.representative),
		registerAuthority: configuredValue(input.registerAuthority),
		registerNumber: configuredValue(input.registerNumber),
		vatId: configuredValue(input.vatId),
	};

	const identifiable =
		entity.name !== null && entity.street !== null && entity.locality !== null;

	return {
		...entity,
		identifiable,
		complete:
			identifiable &&
			entity.country !== null &&
			entity.representative !== null &&
			entity.registerAuthority !== null &&
			entity.registerNumber !== null &&
			entity.vatId !== null,
	};
}

/**
 * The address as one string, for the places that want it inline rather than as
 * separate lines — the Datenschutz controller block and the `Organization`
 * JSON-LD. Returns null unless the whole address is there: half an address is
 * not somewhere a letter arrives.
 */
export function postalAddress(entity: LegalEntity): string | null {
	if (!entity.identifiable) return null;
	return [entity.street, entity.locality, entity.country]
		.filter((line): line is string => line !== null)
		.join(", ");
}
