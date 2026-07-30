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
 * drift. Says what is true — the shop is being set up — and does not promise a
 * date we do not have.
 */
export const ORDERS_CLOSED_HEADING = "Bestellungen derzeit nicht möglich";

export const ORDERS_CLOSED_TEXT =
	"Der Shop wird gerade eingerichtet. Sortiment, Packgrößen und Preise können " +
	"Sie einsehen, Bestellungen sind vorübergehend nicht möglich.";

export const ORDERS_CLOSED_CONTACT =
	"Bei Fragen zu Produkten oder Verfügbarkeit erreichen Sie uns über das Kontaktformular.";
