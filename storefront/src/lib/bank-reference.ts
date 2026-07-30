/**
 * The payment reference a bank-transfer customer types into their banking app.
 *
 * This must produce byte-identical output to the backend's
 * `src/lib/bank-reference.ts`. Both are pinned to the same fixed vectors in
 * their tests, because the two used to disagree: the backend derived a scrambled
 * `PE-XXXXXX` code asynchronously while the confirmation page fell back to
 * `PE-<zero-padded display_id>`, so a customer who arrived before the subscriber
 * ran transferred money quoting a reference that matched no order.
 *
 * Deriving here rather than waiting for the backend also removes the race
 * entirely: the reference is a function of the order number, which the
 * confirmation already has.
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 6;
const PREFIX = "PE";

/** 31^6 — the number of distinct 6-character codes. */
const MODULUS = ALPHABET.length ** LENGTH;

/** Coprime to 31, so the mix below is a bijection on `[0, MODULUS)`. */
const MULTIPLIER = 1103515245;
const OFFSET = 12345;

/**
 * Derives the reference from an order's `display_id`, or null when there is no
 * usable order number.
 *
 * Returning null rather than a plausible-looking string is deliberate: showing a
 * fabricated reference is worse than showing none, because the customer acts on
 * it and the payment cannot then be matched to their order.
 */
export function referenceForDisplayId(
	displayId: number | string | null | undefined,
): string | null {
	const numeric = typeof displayId === "string" ? Number(displayId) : displayId;
	if (
		typeof numeric !== "number" ||
		!Number.isSafeInteger(numeric) ||
		numeric < 0
	) {
		return null;
	}

	// BigInt rather than Number: `displayId * MULTIPLIER` crosses 2^53 at around
	// order 8.2 million, and float rounding beyond that would break the
	// bijection two payments are told apart by.
	const scrambled = Number(
		(BigInt(numeric) * BigInt(MULTIPLIER) + BigInt(OFFSET)) % BigInt(MODULUS),
	);

	let n = scrambled;
	let suffix = "";
	for (let i = 0; i < LENGTH; i++) {
		suffix = ALPHABET[n % ALPHABET.length] + suffix;
		n = Math.floor(n / ALPHABET.length);
	}

	return `${PREFIX}-${suffix}`;
}
