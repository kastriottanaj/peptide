# Plan — Orders closed (catalog-only mode)

Spec: [../specs/2026-07-30-orders-closed.md](../specs/2026-07-30-orders-closed.md)

## 1. The switch

- [x] `storefront/src/lib/shop.ts` — `ORDERS_ENABLED` from
      `PUBLIC_ORDERS_ENABLED` (unset = closed, only `true` opens) plus the notice
      copy. Consumed by every surface below.
- [x] `storefront/src/components/OrdersClosedNotice.astro` — the notice, tokens
      only, optional contact line.

## 2. Storefront surfaces

- [x] `AddToCart.astro` — closed: pack sizes and prices as a plain list plus the
      notice; the radiogroup, stepper and button are not rendered at all.
- [x] `warenkorb.astro` — closed: notice instead of "Zur Kasse"; cart still
      viewable.
- [x] `kasse.astro` — closed: notice and a link to the catalog, no form, no
      build-time country lookup. Its script is already `if (form)`-guarded.
- [x] `webmcp-tools.ts` — `ACTIVE_WEBMCP_TOOLS` withholds `add_to_cart` when
      closed and adjusts the `get_product_details` description; `llms.txt`
      follows automatically.
- [x] `WebMCPTools.astro` — registers `add_to_cart` only when open.

## 3. Backend

- [x] `backend/apps/backend/src/api/middlewares.ts` — `POST
      /store/carts/:id/complete` → 503 while `ORDERS_ENABLED` is not `true`.
      Consumes: `ORDERS_ENABLED`. Nothing else is blocked.

## 4. Wiring and docs

- [x] `deploy/deploy.sh` — `PUBLIC_ORDERS_ENABLED=${ORDERS_ENABLED:-}` into the
      build `.env`, so one server value drives both apps.
- [x] `deploy/.env.template`, `README.md` — document both names.
- [x] `docs/checkout.md` — the flow is closed and how to reopen it.
- [x] `docs/go-live-checklist.md` §1 — ordering is closed until bank details land.
- [x] `AGENTS.md` — reopening the shop is a launch decision, not a side effect.

## 5. Verify + commit

- [x] `cd storefront && npm run typecheck && npm run build`, closed: no
      "In den Warenkorb", no "Zur Kasse", no `data-checkout-form`, no
      `add_to_cart` in `llms.txt`, pack sizes and prices still present
- [x] Same build with `PUBLIC_ORDERS_ENABLED=true`: all four come back
- [x] `cd backend && npm run lint && npm run build` clean (`npm run test` defines
      no task in this workspace — there are no test files yet)
- [x] Live: `POST /store/carts/cart_fake/complete` → 503 with the German message;
      `GET /store/products` → 200
- [x] No raw hex added, `git status --short` reviewed, commit
