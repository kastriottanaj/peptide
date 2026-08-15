/**
 * The confirmation email, as text.
 *
 * Pure: an order shape in, a subject and a plain-text body out. No Medusa
 * imports, no environment reads, no clock — so the unit tests pin the exact
 * wording a customer receives rather than approximating it.
 *
 * ## What this message may and may not say
 *
 * It is the only written record of a bank-transfer order, so it must carry
 * everything needed to pay: what was bought, what it costs, where the money
 * goes and which reference matches it to the order.
 *
 * It may not carry anything else. No delivery estimate, no dispatch time, no
 * response time, no "we will be in touch" — the same rule
 * `operational-claims.test.ts` enforces across the storefront, for the same
 * reason: nothing in this system establishes any of them, and an email is the
 * one artefact a customer keeps and quotes back.
 */

export type OrderLine = {
  title: string
  /** Pack size, e.g. `10 mg`. Optional — a line without one still renders. */
  variantTitle?: string | null
  quantity: number
  /** Line total in minor units, as Medusa stores it. */
  total: number
}

export type OrderEmailInput = {
  displayId: number
  /** Derived from `display_id`, never read from stored metadata. */
  reference: string
  currencyCode: string
  lines: OrderLine[]
  itemSubtotal: number
  discountTotal: number
  shippingTotal: number
  total: number
  bank: {
    accountHolder: string
    iban: string
    bic: string
    bankName: string
  }
  /** Origin without a trailing slash, for the lookup link. */
  siteUrl: string
}

export type RenderedEmail = {
  subject: string
  text: string
}

/**
 * German money formatting, matching the storefront's
 * `Intl.NumberFormat("de-DE", { style: "currency" })` output so the figure in
 * the email and the figure on the page are never formatted differently.
 */
export function formatMoney(amount: number, currencyCode: string): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currencyCode.toUpperCase(),
  }).format(amount)
}

function line(label: string, value: string): string {
  return `${label}: ${value}`
}

export function renderOrderEmail(input: OrderEmailInput): RenderedEmail {
  const money = (amount: number) => formatMoney(amount, input.currencyCode)

  const items = input.lines.map((item) => {
    const name = item.variantTitle
      ? `${item.title} (${item.variantTitle})`
      : item.title
    return `  ${item.quantity}x ${name} — ${money(item.total)}`
  })

  const totals = [
    line("Zwischensumme", money(input.itemSubtotal)),
    // Only shown when there is one: a "Rabatt: 0,00 €" row invites the reader to
    // wonder what they missed.
    ...(input.discountTotal > 0
      ? [line("Rabatt", `− ${money(input.discountTotal)}`)]
      : []),
    line("Versand", money(input.shippingTotal)),
    line("Gesamt", money(input.total)),
  ]

  const text = [
    `Vielen Dank für Ihre Bestellung Nr. ${input.displayId}.`,
    "",
    "Diese E-Mail ist Ihre Bestellbestätigung und enthält alle Angaben, die Sie",
    "für die Überweisung benötigen. Bitte bewahren Sie sie auf.",
    "",
    "IHRE ARTIKEL",
    ...items,
    "",
    ...totals,
    "",
    "ÜBERWEISUNG",
    line("Empfänger", input.bank.accountHolder),
    line("IBAN", input.bank.iban),
    line("BIC", input.bank.bic),
    line("Bank", input.bank.bankName),
    line("Betrag", money(input.total)),
    line("Verwendungszweck", input.reference),
    "",
    "Bitte geben Sie den Verwendungszweck exakt so an. Daran ordnen wir Ihre",
    "Zahlung Ihrer Bestellung zu. Der Versand erfolgt nach Zahlungseingang.",
    "",
    `Ihre Bestelldaten können Sie jederzeit unter ${input.siteUrl}/bestellung/suchen/`,
    "mit Bestellnummer und E-Mail-Adresse erneut aufrufen.",
    "",
    "Diese Bestellung erfolgt ausschließlich zu Forschungs-, Analyse- und",
    "Laborzwecken.",
    "",
    "Peptide Einkaufen",
    `${input.siteUrl}/`,
  ].join("\n")

  return {
    subject: `Ihre Bestellung Nr. ${input.displayId} — Verwendungszweck ${input.reference}`,
    text,
  }
}
