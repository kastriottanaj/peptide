# Checkout & Payment

How an order gets from the product page to money in the bank, what is
implemented, and what still blocks going live.

Design rationale and the mapping from the `peptide` project lives in
[`specs/2026-07-26-checkout-workflow.md`](specs/2026-07-26-checkout-workflow.md).
This file is the operational picture.

---

## ⚠️ BLOCKER — real bank details are still missing

Payment is **Banküberweisung (direct bank transfer)**: the customer places the
order, sees our account details plus a payment reference, and transfers the
money themselves. There is no card processor and no crypto.

That means **the shop cannot take a single real payment until the business
account exists and its details are configured.** Right now every confirmation
page shows `PLATZHALTER` and an orange warning telling the customer *not* to
transfer yet.

When the account is open, set these four in `storefront/.env`:

```dotenv
PUBLIC_BANK_ACCOUNT_HOLDER=   # exactly as registered with the bank
PUBLIC_BANK_IBAN=
PUBLIC_BANK_BIC=
PUBLIC_BANK_NAME=
```

No code change is needed. `src/lib/bank.ts` detects that all four are real,
`bankDetailsArePlaceholder()` returns false, and the warning disappears by
itself. Rebuild the storefront afterwards — the values are baked in at build
time.

`storefront/.env` is git-ignored. The IBAN must never be committed.

**Verify after setting them:** place a test order and confirm the confirmation
page shows the real holder, IBAN, BIC and bank, with no orange warning, and that
the amount matches the order total exactly.

---

## Customer journey

| Step | URL | What happens |
|---|---|---|
| 1. Pick pack size | `/produkte/<handle>` | Radio per variant, quantity stepper, add to cart |
| 2. Review | `/warenkorb` | Change quantity, remove lines, see the earned quantity discount |
| 3. Checkout | `/kasse` | Contact, address, optional discount code, shipping, mandatory legal confirmation |
| 4. Confirmation | `/bestellung?id=…` | Order number, bank details, amount, **payment reference** |
| 5. Transfer | customer's bank | Customer transfers, quoting the reference |
| 6. Reconcile | Medusa admin `/app` | Staff match the incoming transfer and mark the order paid |

Step 6 is manual and deliberate — same as the source project. Nothing ships
before the money arrives.

## How it is built

The storefront is static, so the cart lives entirely in the browser: the cart id
sits in `localStorage` and every mutation goes straight to Medusa, which stays
authoritative for prices and totals. No framework runtime — the interactive
pieces are plain `<script>` islands.

**Storefront**

| File | Role |
|---|---|
| `src/lib/cart.ts` | Cart + checkout calls; dispatches `cart:updated` |
| `src/lib/pricing.ts` | Discount tiers and shipping thresholds, **display only** |
| `src/lib/bank.ts` | Bank details from env; payment-reference fallback |
| `src/components/AddToCart.astro` | Pack size, quantity, add button |
| `src/pages/warenkorb.astro` | Cart page |
| `src/pages/kasse.astro` | Single-page checkout |
| `src/pages/bestellung.astro` | Order confirmation |

**Backend**

| File | Role |
|---|---|
| `src/subscribers/order-bank-reference.ts` | Assigns the `PE-` reference on `order.placed` |
| `src/scripts/seed-commerce-rules.ts` | Creates the quantity-discount promotions |
| `src/scripts/seed-shipping.ts` | Shipping zones, rates and the free-shipping promotion |

Order completion runs: save address → attach shipping method → open a payment
session on `pp_system_default` (the manual provider that represents bank
transfer) → complete the cart. The cart id is only cleared once Medusa confirms
the order, so a mid-way failure leaves the customer's cart intact.

## Business rules

Carried over from peptidebestellung.de.

**Quantity discount** — applied per line, by that line's quantity:

| Units | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10+ |
|---|---|---|---|---|---|---|---|---|
| Discount | 3% | 5% | 7% | 8% | 10% | 12% | 13% | 15% |

Implemented as automatic Medusa promotions `MENGE3` … `MENGE10`, each bounded on
both sides so a 5-unit cart gets 7% only, never 3%+5%+7% stacked. Recreate them
with:

```bash
cd backend/apps/backend
npx medusa exec ./src/scripts/seed-commerce-rules.ts
```

**Payment reference** — `PE-XXXXXX`, six characters from
`ABCDEFGHJKMNPQRSTUVWXYZ23456789`. `I`, `L`, `O`, `0` and `1` are deliberately
absent: the customer types this into their banking app by hand and those are the
characters people get wrong.

It is derived bijectively from the order's `display_id`, so two orders can never
collide, and consecutive orders produce unrelated-looking codes rather than
advertising order volume.

**Shipping** — €10 within Germany, €20 elsewhere in Europe, free from €100
merchandise value **after** discount.

Two service zones carry the rates; the free-shipping threshold is a separate
automatic promotion (`VERSANDFREI100`) targeting shipping methods, because
free-over-threshold cannot be expressed as a shipping-option price. Configure
with:

```bash
cd backend/apps/backend
npx medusa exec ./src/scripts/seed-shipping.ts
```

The threshold rule uses `item_total` (merchandise after discount). Not
`subtotal` — on a cart that includes shipping, so a €99.80 order would clear a
€100 threshold on the strength of its own €10 shipping fee and then zero it out.

## Known gaps before go-live

1. **Bank details** — the blocker above.
2. **No confirmation email — deferred 2026-07-27, required before launch.**
   Nothing is sent after an order. For a bank-transfer shop this matters more
   than usual: the payment reference exists only on the confirmation page, so a
   customer who closes the tab cannot pay correctly and the transfer cannot be
   matched. Needs a notification provider plus an `order.placed` subscriber.
   Full requirements in [go-live-checklist.md](go-live-checklist.md#6-order-confirmation-email--must-be-done-before-deploying-live).
3. **Legal pages need real company data.** `/impressum`, `/datenschutz`, `/agb`
   and `/widerruf` exist and are linked from the mandatory consent checkbox, but
   render company details as visible placeholders and stay `noindex` until
   finalised. See [go-live-checklist.md](go-live-checklist.md).
4. **Prices and product data are placeholder.** Every purity value, COA status
   and price is fabricated and must be replaced with real analytical data.
5. **`pricing.ts` can drift from Medusa.** The tiers and thresholds exist in both
   the storefront (for display) and the backend (for what is charged). Change one,
   change the other.

## Verifying the flow

Backend must be running on :9000.

```bash
cd storefront && npm run typecheck && npm run build
cd ../backend && npm run lint && npm run build
```

Manually, against a running dev server:

- Add 2 units → no discount. Add a 3rd → cart shows „Mengenrabatt: 3 %" **and**
  the total drops by 3%. The hint and the total must agree.
- Subtotal on cart, checkout and confirmation must be merchandise only; shipping
  is a separate line. (Medusa's `subtotal` on an order *includes* shipping —
  use `item_subtotal`.)
- A German cart is quoted €10 and a French one €20. A cart whose merchandise
  after discount is €99.80 is still charged shipping; at €100 it goes free. Test
  that boundary specifically — it is the one that hides a mistake.
- Submitting `/kasse` without the legal checkbox must be refused.
- The reference on the confirmation page must equal
  `metadata->>'bank_reference'` on the order in Postgres. It is written by a
  subscriber *after* completion, so the page refetches with `fields=+metadata`.
