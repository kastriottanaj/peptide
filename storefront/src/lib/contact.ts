/**
 * What counts as a real, publishable contact channel.
 *
 * Kept free of Astro and Vite imports (no `import.meta.env`) so it is directly
 * unit testable with `node --test`, exactly like `canonical.ts`; `company.ts` is
 * the adapter that supplies the configured values.
 *
 * ## Why this module refuses values instead of printing them
 *
 * The operating company is still being established (docs/go-live-checklist.md
 * §2), so no address, telephone number or postal address exists to hard-code.
 * `/contact/` is indexable and public, which makes a half-filled `.env` the
 * dangerous case: `mailto:PLATZHALTER` is a contact route that looks real,
 * gets crawled, and only fails once a customer has written the message.
 *
 * So anything that is empty, bracketed, or carries a placeholder marker
 * resolves to `null`, and a `null` channel is not rendered at all. The pages
 * then say the channel is not open yet — a fact a visitor can act on, rather
 * than a dead end they discover afterwards. Nothing here invents a value.
 */

export interface ContactInput {
	email?: string | undefined;
	phone?: string | undefined;
	/** Free text, e.g. `Mo–Fr 9–16 Uhr`. */
	hours?: string | undefined;
}

export interface ContactChannels {
	email: string | null;
	phone: string | null;
	hours: string | null;
	/** True when at least one channel can be shown to a visitor. */
	any: boolean;
}

/**
 * Markers that mean "not filled in yet". Compared case-insensitively against
 * the whole value; `example` and `beispiel` are here because the reserved
 * example domains are the other thing that reaches production by accident.
 */
const PLACEHOLDER_MARKERS = [
	"platzhalter",
	"todo",
	"tbd",
	"xxx",
	"beispiel",
	"example",
	"changeme",
	"change-me",
];

/** Trim, and reduce anything empty or obviously unfilled to null. */
export function configuredValue(value: string | undefined | null): string | null {
	const trimmed = (value ?? "").trim();
	if (trimmed === "") return null;

	// `[Firmierung]` and `<your-email>` are how unfilled data is marked on the
	// legal pages and in `.env` templates respectively.
	if (trimmed.startsWith("[") || trimmed.startsWith("<")) return null;

	const lowered = trimmed.toLowerCase();
	if (PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker))) return null;

	return trimmed;
}

/**
 * A deliberately conservative address check: one `@`, a dot-bearing domain, no
 * whitespace. Not RFC 5322 — the job is to reject a value that would render as
 * a broken `mailto:`, not to accept every address the RFC permits.
 */
export function normalizeEmail(value: string | undefined | null): string | null {
	const configured = configuredValue(value);
	if (configured === null) return null;
	return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(configured) ? configured : null;
}

/**
 * A telephone number has to contain a digit to be dialable. Everything else
 * about the formatting is left alone — it is printed verbatim, so the business
 * decides how its own number reads.
 */
export function normalizePhone(value: string | undefined | null): string | null {
	const configured = configuredValue(value);
	if (configured === null) return null;
	return /\d/.test(configured) ? configured : null;
}

/**
 * Resolve the configured channels.
 *
 * Opening hours are dropped without a telephone number: hours for a line that
 * is not published promise availability on a channel nobody can reach.
 */
export function resolveContactChannels(input: ContactInput): ContactChannels {
	const email = normalizeEmail(input.email);
	const phone = normalizePhone(input.phone);

	return {
		email,
		phone,
		hours: phone === null ? null : configuredValue(input.hours),
		any: email !== null || phone !== null,
	};
}

/**
 * `tel:` href for a printed number: digits and a single leading `+`.
 * Separators a human reads (`/`, spaces, parentheses) are not dialable.
 */
export function telHref(phone: string): string {
	const digits = phone.replace(/[^\d+]/g, "");
	const plus = digits.startsWith("+") ? "+" : "";
	return `tel:${plus}${digits.replace(/\+/g, "")}`;
}

export function mailtoHref(email: string): string {
	return `mailto:${email}`;
}
