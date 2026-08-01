/**
 * Whether the shop currently accepts orders.
 *
 * The site is public but cannot be paid: the business bank account does not
 * exist yet, so an order confirmation would show `PLATZHALTER` instead of an
 * IBAN and no email follows it (docs/go-live-checklist.md §1 and §6). Until that
 * changes, the catalog is visible and ordering is closed.
 *
 * `PUBLIC_ORDERS_ENABLED` is written by `deploy.sh` from `ORDERS_ENABLED` in
 * `/srv/peptides/.env`, which the Medusa service reads directly — one value on
 * the server, so the storefront and the API cannot disagree about whether the
 * shop is open.
 *
 * **Unset means closed, and only the exact string `true` opens it.** A forgotten
 * variable must not open a shop that cannot take money, and a literal "false"
 * must not read as truthy.
 */

export const ORDERS_ENABLED =
	(import.meta.env.PUBLIC_ORDERS_ENABLED ?? "").trim().toLowerCase() === "true";

/**
 * The copy, here rather than in each component: it appears on the product page,
 * in the cart and on the checkout page, and three near-identical wordings would
 * drift.
 *
 * It states only what `ORDERS_ENABLED` establishes — that ordering is
 * unavailable — and nothing about why. The earlier wording ("Der Shop wird
 * gerade eingerichtet") read a business status out of a boolean that carries
 * none: the flag says whether orders are accepted, not what stage the operating
 * company is at. The trust pages were corrected the same way; these three
 * strings are the shop-side surfaces of that correction.
 */
export const ORDERS_CLOSED_HEADING = "Bestellungen derzeit nicht möglich";

export const ORDERS_CLOSED_TEXT =
	"Der Bestellvorgang ist derzeit nicht verfügbar. Sortiment, Packgrößen und " +
	"Preise können weiterhin eingesehen werden.";

/**
 * Rendered immediately before a link whose text is "Kontakt", so it reads as one
 * sentence. It promises no response and names no channel: there is no contact
 * form (this line used to claim one) and no address is published until
 * `PUBLIC_CONTACT_EMAIL` is configured — see `lib/contact.ts`.
 */
export const ORDERS_CLOSED_CONTACT =
	"Die derzeit verfügbaren Kontaktwege stehen auf der Seite";
