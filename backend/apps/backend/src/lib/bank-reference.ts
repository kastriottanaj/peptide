/**
 * The payment reference a bank-transfer customer types into their banking app.
 *
 * This is the single definition of the format. The storefront carries an
 * identical implementation in `src/lib/bank-reference.ts` and both are pinned to
 * the same fixed vectors in their unit tests, because a customer who quotes a
 * reference we cannot match has paid into a void: the money arrives with a code
 * that matches no order.
 *
 * The alphabet deliberately omits I, L, O, 0 and 1 — the code is transcribed by
 * hand, and those characters are the ones people get wrong.
 */
import { MedusaError } from "@medusajs/framework/utils"

export const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
export const LENGTH = 6
export const PREFIX = "PE"

/** 31^6 — the number of distinct 6-character codes. */
export const MODULUS = ALPHABET.length ** LENGTH

/**
 * Coprime to 31, so `displayId -> (displayId * MULTIPLIER + OFFSET) % MODULUS`
 * is a bijection on `[0, MODULUS)`: distinct orders can never collide.
 */
const MULTIPLIER = 1103515245
const OFFSET = 12345

/** Matches a complete reference, e.g. `PE-QK3M7P`. */
export const REFERENCE_PATTERN = new RegExp(
  `^${PREFIX}-[${ALPHABET}]{${LENGTH}}$`
)

/**
 * Derives the reference from the order's `display_id`.
 *
 * Deriving rather than randomising makes uniqueness structural. The template
 * this replaced generated a random suffix and re-rolled on collision, which is
 * only safe behind a unique database constraint — Medusa's order metadata has
 * none, so a random check would be racy. The bijective mix additionally keeps
 * consecutive orders from producing adjacent-looking codes that would advertise
 * order volume.
 *
 * Throws on an input that cannot produce a stable reference, so a caller can
 * never silently show a fabricated one.
 */
export function referenceForDisplayId(displayId: number): string {
  if (!Number.isSafeInteger(displayId) || displayId < 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Cannot derive a bank reference from display_id ${displayId}.`
    )
  }

  // BigInt rather than Number: `displayId * MULTIPLIER` crosses 2^53 at around
  // order 8.2 million, and beyond that float rounding destroys the bijection the
  // uniqueness claim above rests on — two orders could share a reference, which
  // for a bank-transfer store means two payments we cannot tell apart.
  const scrambled = Number(
    (BigInt(displayId) * BigInt(MULTIPLIER) + BigInt(OFFSET)) % BigInt(MODULUS)
  )

  let n = scrambled
  let suffix = ""
  for (let i = 0; i < LENGTH; i++) {
    suffix = ALPHABET[n % ALPHABET.length] + suffix
    n = Math.floor(n / ALPHABET.length)
  }

  return `${PREFIX}-${suffix}`
}

/** `MULTIPLIER^-1 mod MODULUS`, via the extended Euclidean algorithm. */
function modularInverse(value: bigint, modulus: bigint): bigint {
  let [old_r, r] = [value % modulus, modulus]
  let [old_s, s] = [1n, 0n]

  while (r !== 0n) {
    const quotient = old_r / r
    ;[old_r, r] = [r, old_r - quotient * r]
    ;[old_s, s] = [s, old_s - quotient * s]
  }

  if (old_r !== 1n) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The reference multiplier is not invertible."
    )
  }
  return ((old_s % modulus) + modulus) % modulus
}

const INVERSE_MULTIPLIER = modularInverse(BigInt(MULTIPLIER), BigInt(MODULUS))

/**
 * Recovers the `display_id` a reference was derived from, or null when the input
 * is not a well-formed reference.
 *
 * Order recovery asks the customer for "Bestellnummer", and the only code they
 * have in front of them is the reference from their bank transfer. Parsing that
 * as a decimal order number — which the lookup route used to do — reduces
 * `PE-QK3M7P` to the digits it happens to contain and searches for a completely
 * unrelated order.
 */
export function displayIdForReference(reference: string): number | null {
  const normalized = reference.trim().toUpperCase()
  if (!REFERENCE_PATTERN.test(normalized)) return null

  const suffix = normalized.slice(PREFIX.length + 1)
  let scrambled = 0n
  for (const character of suffix) {
    scrambled = scrambled * BigInt(ALPHABET.length) + BigInt(ALPHABET.indexOf(character))
  }

  const modulus = BigInt(MODULUS)
  const displayId = Number(
    (((scrambled - BigInt(OFFSET)) % modulus + modulus) * INVERSE_MULTIPLIER) % modulus
  )
  return Number.isSafeInteger(displayId) ? displayId : null
}
