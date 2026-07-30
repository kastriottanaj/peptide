import {
  ALPHABET,
  LENGTH,
  MODULUS,
  PREFIX,
  REFERENCE_PATTERN,
  displayIdForReference,
  referenceForDisplayId,
} from "../bank-reference"

/**
 * Fixed vectors. The storefront derives the same reference for the same order,
 * so these exact values are duplicated in its test — a customer who is shown a
 * reference the shop cannot match has paid into a void, and drifting
 * implementations are the way that happens.
 */
const VECTORS: Array<[number, string]> = [
  [0, "PE-AAAP5H"],
  [1, "PE-HT7K2G"],
  [2, "PE-SC4GXF"],
  [3, "PE-ZWZDUE"],
  [10, "PE-QRAP57"],
  [1000, "PE-PFASA9"],
]

describe("bank reference", () => {
  it("keeps the transcription-safe alphabet and shape", () => {
    expect(ALPHABET).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
    expect(ALPHABET.length).toBe(31)
    // These are the characters people mistype; their absence is the point.
    for (const confusable of ["I", "L", "O", "0", "1"]) {
      expect(ALPHABET).not.toContain(confusable)
    }
    expect(new Set(ALPHABET).size).toBe(ALPHABET.length)
    expect(MODULUS).toBe(31 ** LENGTH)
    expect(PREFIX).toBe("PE")
  })

  it("matches the fixed vectors shared with the storefront", () => {
    for (const [displayId, expected] of VECTORS) {
      expect(referenceForDisplayId(displayId)).toBe(expected)
    }
  })

  it("always produces a well-formed reference", () => {
    for (const displayId of [0, 1, 7, 99, 12_345, 8_400_000, MODULUS - 1]) {
      expect(referenceForDisplayId(displayId)).toMatch(REFERENCE_PATTERN)
    }
  })

  it("refuses an input that cannot yield a stable reference", () => {
    for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => referenceForDisplayId(invalid)).toThrow()
    }
  })

  it("never collides across a long run of consecutive orders", () => {
    const seen = new Set<string>()
    for (let displayId = 0; displayId < 20_000; displayId++) {
      seen.add(referenceForDisplayId(displayId))
    }
    expect(seen.size).toBe(20_000)
  })

  it("does not leak order volume through adjacent codes", () => {
    // Consecutive orders must not differ only in their last character, which
    // would let a customer read off how many orders the shop takes.
    for (let displayId = 0; displayId < 500; displayId++) {
      const current = referenceForDisplayId(displayId)
      const next = referenceForDisplayId(displayId + 1)
      expect(current.slice(0, -1)).not.toBe(next.slice(0, -1))
    }
  })

  it("round-trips a reference back to its order number", () => {
    for (const displayId of [0, 1, 42, 12_345, 8_400_000]) {
      const reference = referenceForDisplayId(displayId)
      expect(displayIdForReference(reference)).toBe(displayId)
    }
  })

  it("accepts a reference the customer retyped loosely", () => {
    const reference = referenceForDisplayId(42)
    expect(displayIdForReference(`  ${reference.toLowerCase()} `)).toBe(42)
  })

  it("rejects anything that is not a reference", () => {
    for (const invalid of [
      "",
      "42",
      "#42",
      "PE-000042",
      "PE-AAAAA",
      "PE-AAAAAAA",
      "XX-AAAP5H",
      "PE-AAAIAA", // contains an excluded character
      "PE-AAA0AA",
    ]) {
      expect(displayIdForReference(invalid)).toBeNull()
    }
  })
})
