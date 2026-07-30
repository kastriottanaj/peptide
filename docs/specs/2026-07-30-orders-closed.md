# Spec — Orders closed (catalog-only mode)

- **Date:** 2026-07-30
- **Status:** approved
- **Owner:** storefront + backend

## Goal

Stop the shop from accepting orders it cannot fulfil or be paid for, without
taking the site back offline.

The gate came off on 2026-07-29 with the hard blockers in
[go-live-checklist.md](go-live-checklist.md) still open. The concrete failure
available to any visitor today: add to cart → checkout → place an order, and the
confirmation shows `PLATZHALTER` instead of an IBAN, with no email to follow. The
customer cannot pay, and we have their address and an order we cannot process.

So: **catalog stays public and crawlable, ordering closes.** Prices, pack sizes,
purity, the Wissen articles and the calculator all remain visible — that is the
point of having un-gated — but every path that creates or completes an order is
shut, in the storefront *and* in the API.

## Scope

### One switch, two consumers

`ORDERS_ENABLED` in `/srv/peptides/.env`, **default closed**. A missing value must
mean closed: forgetting a variable should not open a shop that cannot take money.
Only the exact string `true` opens it.

Two processes need it and they read it differently, so `deploy.sh` derives one
from the other rather than letting two variables drift:

- **Backend** (runtime): reads `ORDERS_ENABLED` from the same env file
  `medusa.service` already loads.
- **Storefront** (build time): `deploy.sh` writes
  `PUBLIC_ORDERS_ENABLED=${ORDERS_ENABLED}` into the build `.env`, the way it
  already does for the bank and analytics values.

### Storefront

- `src/lib/shop.ts` — `ORDERS_ENABLED` plus the German notice copy, in one place
  so the wording cannot diverge across the four surfaces below.
- `src/components/OrdersClosedNotice.astro` — the notice, design tokens only.
- `AddToCart.astro` — closed: the pack sizes and prices still render, as a plain
  list rather than radio buttons (a choice that leads nowhere is worse than no
  choice), followed by the notice. No quantity stepper, no button, and the
  island's `addLine` path is dead code the bundler drops.
- `warenkorb.astro` — closed: no "Zur Kasse". A cart already in `localStorage`
  stays viewable, because silently emptying someone's cart is its own surprise.
- `kasse.astro` — closed: the form is not rendered at all. Its script is already
  wrapped in `if (form)`, so it becomes inert without a change.
- `webmcp-tools.ts` / `WebMCPTools.astro` — closed: `add_to_cart` is neither
  registered nor advertised in `llms.txt`, and `get_product_details` drops its
  "use the variant_id to add to the cart" sentence. An agentic browser must not
  be handed a tool the page itself no longer offers.

### Backend

- `src/api/middlewares.ts` (new) — `POST /store/carts/:id/complete` answers **503**
  with a German message while orders are closed.

  The storefront changes alone are cosmetic: the store API is public, needs only
  a publishable key, and a cart id already in someone's `localStorage` plus one
  `fetch` would still create an order. This is the part that actually closes the
  shop; the storefront changes are what a person sees.

  Completion is the only blocked route. Blocking `POST /store/carts` or line-item
  routes as well would break the cart page for anyone holding one, and no order
  can exist without completion.

### Docs

`README.md`, `deploy/.env.template`, `docs/checkout.md`, and
`go-live-checklist.md` §1 — where the switch is, what it closes, and that opening
it is the same decision as filling in the bank details.

## Non-goals

- **Re-gating the site.** Explicitly rejected: it would throw away the indexing
  that removing the gate just opened up. Closing orders solves the actual problem.
- **Removing the cart page or the header cart.** Both stay; the cart is where the
  notice belongs.
- **Touching prices, the legal pages or the `demo` purity data.** Separate
  checklist items.
- **A site-wide banner.** The notice sits where the action was attempted. A
  permanent bar on every page is a marketing decision, not this one.
- **Blocking the admin.** Orders placed from the Medusa admin are unaffected;
  whoever is in the admin knows the state of the bank account.

## Verification

```bash
cd storefront && npm run typecheck && npm run build
grep -rc "In den Warenkorb" dist/produkte/bpc-157/index.html   # 0
grep -rc "Zur Kasse" dist/warenkorb/index.html                 # 0
grep -c "add_to_cart" dist/llms.txt                            # 0
cd ../backend && npm run lint && npm run build && npm run test
```

Manually, with the backend on :9000 and orders closed: a product page shows pack
sizes with prices and the notice instead of the button; `/kasse` shows the notice
and no form; and completion is refused at the API, which is the check that
matters —

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "x-publishable-api-key: $PUBLIC_MEDUSA_PUBLISHABLE_KEY" \
  http://localhost:9000/store/carts/cart_whatever/complete    # 503
```

With `PUBLIC_ORDERS_ENABLED=true` / `ORDERS_ENABLED=true`, the button, the
checkout form, the WebMCP tool and completion all come back — verified by
building once in each mode.
