/**
 * Whether the order confirmation may be sent, and what bank details it carries.
 *
 * Kept free of Medusa imports so it is directly unit testable, matching the
 * `lib/inbox/config.ts` convention it sits beside.
 */

/** Same placeholder token the storefront's `lib/bank.ts` uses. */
const PLACEHOLDER = "PLATZHALTER"

function env(name: string): string {
  return (process.env[name] ?? "").trim()
}

/**
 * The switch, deliberately **not** `INBOX_SMTP_ENABLED`.
 *
 * That variable's own documentation says reading mail and sending mail are
 * different risks and different decisions, and that an inbox which has been
 * importing for a month must not start being able to email customers because
 * someone reused one variable. The same argument runs in this direction: a
 * mailbox configured to answer support threads should not silently begin
 * mailing every customer who checks out.
 *
 * The SMTP credentials are shared — it is one mailbox. The permission is not.
 *
 * Unset means off, and only the exact string `true` turns it on, the convention
 * `ORDERS_ENABLED` and `INBOX_SMTP_ENABLED` already follow.
 */
export function orderEmailEnabled(): boolean {
  return env("ORDER_EMAIL_ENABLED").toLowerCase() === "true"
}

export type BankDetails = {
  accountHolder: string
  iban: string
  bic: string
  bankName: string
}

export type BankDetailsResult =
  | { ok: true; details: BankDetails }
  | { ok: false; missing: string[] }

/**
 * The same four values the storefront bakes into the confirmation page, read
 * from the same variables on the same env file.
 *
 * A field that is empty or still says `PLATZHALTER` makes the whole set
 * unusable rather than just that field: an email telling a customer to transfer
 * money to a placeholder is worse than sending nothing, because it looks like
 * an instruction. The caller refuses to send and logs which fields are at
 * fault.
 */
export function resolveBankDetails(): BankDetailsResult {
  const fields: Array<[keyof BankDetails, string]> = [
    ["accountHolder", "PUBLIC_BANK_ACCOUNT_HOLDER"],
    ["iban", "PUBLIC_BANK_IBAN"],
    ["bic", "PUBLIC_BANK_BIC"],
    ["bankName", "PUBLIC_BANK_NAME"],
  ]

  const details = {} as BankDetails
  const missing: string[] = []

  for (const [key, variable] of fields) {
    const value = env(variable)
    if (!value || value.toUpperCase() === PLACEHOLDER) {
      missing.push(variable)
      continue
    }
    details[key] = value
  }

  return missing.length ? { ok: false, missing } : { ok: true, details }
}

/**
 * Origin for the order-lookup link in the email.
 *
 * Falls back to the production domain for the same reason `lib/site.ts` does on
 * the storefront: a missing variable in a real send must not put `localhost` in
 * a customer's inbox, where it is useless and looks broken.
 */
export function siteUrl(): string {
  const configured = env("PUBLIC_SITE_URL")
  return (configured || "https://peptideeinkaufen.de").replace(/\/+$/, "")
}
