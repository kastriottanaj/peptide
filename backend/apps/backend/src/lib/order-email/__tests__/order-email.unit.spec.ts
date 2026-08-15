/**
 * The order confirmation email.
 *
 * Two things are worth pinning here, and they pull against each other:
 *
 *  1. **The message carries everything needed to pay.** It is the only written
 *     record of a bank-transfer order, so a missing IBAN or reference is not a
 *     cosmetic defect — the customer cannot pay, or pays unmatched.
 *  2. **It carries nothing else.** No delivery estimate, no dispatch time, no
 *     response-time promise. `operational-claims.test.ts` enforces this across
 *     the storefront; an email is worse than a page, because the customer keeps
 *     it and quotes it back.
 */

import {
  orderEmailEnabled,
  resolveBankDetails,
  siteUrl,
} from "../config"
import { formatMoney, renderOrderEmail, type OrderEmailInput } from "../render"

const KEYS = [
  "ORDER_EMAIL_ENABLED",
  "PUBLIC_BANK_ACCOUNT_HOLDER",
  "PUBLIC_BANK_IBAN",
  "PUBLIC_BANK_BIC",
  "PUBLIC_BANK_NAME",
  "PUBLIC_SITE_URL",
]

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

/* ------------------------------------------------------------ the switch -- */

describe("orderEmailEnabled", () => {
  it("is off when unset", () => {
    expect(orderEmailEnabled()).toBe(false)
  })

  it("is on only for the exact string true", () => {
    for (const value of ["false", "1", "yes", "TRUE ", "", " "]) {
      process.env.ORDER_EMAIL_ENABLED = value
      expect(orderEmailEnabled()).toBe(value.trim().toLowerCase() === "true")
    }
    process.env.ORDER_EMAIL_ENABLED = "true"
    expect(orderEmailEnabled()).toBe(true)
  })

  it("does NOT follow INBOX_SMTP_ENABLED", () => {
    // The whole point of a separate variable: a mailbox configured to answer
    // support threads must not start mailing every customer who checks out.
    process.env.INBOX_SMTP_ENABLED = "true"
    expect(orderEmailEnabled()).toBe(false)
    delete process.env.INBOX_SMTP_ENABLED
  })
})

/* ------------------------------------------------------ the bank details -- */

function configureBank(overrides: Record<string, string> = {}) {
  process.env.PUBLIC_BANK_ACCOUNT_HOLDER = "Muster Handels GmbH"
  process.env.PUBLIC_BANK_IBAN = "DE02120300000000202051"
  process.env.PUBLIC_BANK_BIC = "BYLADEM1001"
  process.env.PUBLIC_BANK_NAME = "Musterbank"
  Object.assign(process.env, overrides)
}

describe("resolveBankDetails", () => {
  it("resolves when all four are configured", () => {
    configureBank()
    const result = resolveBankDetails()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.details.iban).toBe("DE02120300000000202051")
  })

  it("reports every missing field rather than only the first", () => {
    const result = resolveBankDetails()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.missing).toHaveLength(4)
  })

  it("treats PLATZHALTER as missing", () => {
    // The failure this exists for: the storefront shows a warning for a
    // placeholder IBAN, but an email has no warning — it just reads as an
    // instruction to send money somewhere that does not exist.
    configureBank({ PUBLIC_BANK_IBAN: "PLATZHALTER" })
    const result = resolveBankDetails()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.missing).toEqual(["PUBLIC_BANK_IBAN"])
  })

  it("rejects a single unfilled field even when the rest are real", () => {
    configureBank({ PUBLIC_BANK_BIC: "   " })
    expect(resolveBankDetails().ok).toBe(false)
  })
})

describe("siteUrl", () => {
  it("falls back to production rather than localhost", () => {
    expect(siteUrl()).toBe("https://peptideeinkaufen.de")
  })

  it("strips a trailing slash so links do not double up", () => {
    process.env.PUBLIC_SITE_URL = "https://example.test/"
    expect(siteUrl()).toBe("https://example.test")
  })
})

/* ------------------------------------------------------------ the message -- */

const INPUT: OrderEmailInput = {
  displayId: 42,
  reference: "PE-Y4KZFA",
  currencyCode: "eur",
  lines: [
    { title: "BPC-157", variantTitle: "10 mg", quantity: 2, total: 99.8 },
    { title: "Semax", variantTitle: null, quantity: 1, total: 44.9 },
  ],
  itemSubtotal: 144.7,
  discountTotal: 0,
  shippingTotal: 10,
  total: 154.7,
  bank: {
    accountHolder: "Muster Handels GmbH",
    iban: "DE02120300000000202051",
    bic: "BYLADEM1001",
    bankName: "Musterbank",
  },
  siteUrl: "https://peptideeinkaufen.de",
}

describe("renderOrderEmail", () => {
  it("puts the reference in the subject, where it survives a truncated preview", () => {
    const { subject } = renderOrderEmail(INPUT)
    expect(subject).toContain("PE-Y4KZFA")
    expect(subject).toContain("42")
  })

  it("carries everything the customer needs to pay", () => {
    const { text } = renderOrderEmail(INPUT)
    for (const required of [
      "Muster Handels GmbH",
      "DE02120300000000202051",
      "BYLADEM1001",
      "Musterbank",
      "PE-Y4KZFA",
      "154,70",
    ]) {
      expect(text).toContain(required)
    }
  })

  it("lists each line with quantity, pack size and line total", () => {
    const { text } = renderOrderEmail(INPUT)
    expect(text).toContain("2x BPC-157 (10 mg)")
    // A line without a pack size still renders, without empty parentheses.
    expect(text).toContain("1x Semax —")
    expect(text).not.toContain("Semax ()")
  })

  it("omits the discount row when there is no discount", () => {
    const { text } = renderOrderEmail(INPUT)
    expect(text).not.toContain("Rabatt")
  })

  it("shows the discount when there is one", () => {
    const { text } = renderOrderEmail({ ...INPUT, discountTotal: 12.5 })
    expect(text).toContain("Rabatt")
    expect(text).toContain("12,50")
  })

  it("points at the lookup page so a lost email is recoverable", () => {
    const { text } = renderOrderEmail(INPUT)
    expect(text).toContain("https://peptideeinkaufen.de/bestellung/suchen/")
  })

  it("makes no claim the shop cannot keep", () => {
    const { text } = renderOrderEmail(INPUT)
    // The same families operational-claims.test.ts bans on the storefront.
    expect(text).not.toMatch(/werktage?n?\s+(nach|ab)/i)
    expect(text).not.toMatch(/(zustellung|lieferung|versand)\s+(in|innerhalb|binnen)\s+\d/i)
    expect(text).not.toMatch(/wir\s+melden\s+uns/i)
    expect(text).not.toMatch(/innerhalb von \d+\s*(stunden|tagen)/i)
    expect(text).not.toMatch(/garantie/i)
  })

  it("formats money the way the storefront does", () => {
    // Same locale and style as Intl.NumberFormat("de-DE", …) on the pages, so
    // the figure in the inbox matches the figure on the confirmation page.
    expect(formatMoney(154.7, "eur")).toMatch(/154,70/);
    expect(formatMoney(154.7, "eur")).toMatch(/€/);
  })
})
