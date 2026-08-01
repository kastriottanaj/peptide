# Analytics dashboard (Medusa Admin)

The Analytics page inside the Medusa Admin, at **`/app/analytics`**. Runbook for
what it shows, where each number comes from, and — the part that matters most
here — **what it deliberately refuses to show**.

Two other documents cover the halves this one sits on top of:

- [analytics-ga4-api.md](analytics-ga4-api.md) — the GA4 Data API endpoints.
- [analytics.md](analytics.md) — the consent-gated `gtag` collection on the
  storefront, which decides what GA4 can possibly know.

## Where the numbers come from

The dashboard reads two systems and never mixes them into one figure.

| Question | Source |
| --- | --- |
| Sales volume, orders, AOV, refunds, open shipments | **Medusa** |
| Payment status, fulfillment status, discounts, sales channel | **Medusa** |
| Customers, repurchase rate, bestsellers | **Medusa** |
| Visitors, sessions, page views, events, key events | **GA4** |
| Channels, source/medium, countries, devices, current pages | **GA4** |
| GA4 transactions and GA4 revenue | **GA4**, labelled as such |

Every panel fed by GA4 ecommerce data carries this notice, verbatim:

> Google Analytics revenue is processed, consent-dependent analytics data.
> Medusa orders remain the source of truth for sales and revenue.

**GA4 revenue is never substituted for Medusa revenue anywhere on the page.**

### Why the two never get joined

The obvious feature — conversion rate per channel — is not implemented, and the
reason is worth stating plainly because it will be proposed again.

Joining a GA4 channel to a Medusa order requires knowing which channel each
order came from. **This storefront records nothing of the sort.** There is no
UTM capture, no landing-page field and no referrer stored on the cart or the
order: `storefront/src/lib/cart.ts` writes only `vat_id`, and the `order.placed`
subscriber writes only `bank_reference`. The only join available would be "GA4
says 40% of sessions were organic, so 40% of orders were", which is an
assumption with a percent sign after it, not a measurement.

So the Overview tab shows GA4 traffic per channel and the Medusa order total
beside it, separately, with the gap named. Conversion & Sources does the same
and additionally reports it as a tracking-quality figure.

### There is no shop-wide conversion rate

Medusa orders ÷ GA4 sessions looks like one and is not. The numerator counts
**every** order the shop took. The denominator counts **only** sessions from
visitors who accepted statistics consent — this storefront has a hard consent
gate, so everyone who declined is invisible to GA4 and fully visible to Medusa.
A complete numerator over an incomplete denominator produces a number **larger**
than the truth, by a factor nobody measures.

An earlier version of this dashboard shipped that ratio as "Conversion rate" and
called it a lower bound. Both halves were wrong: it is not a conversion rate,
and it overstates rather than understates. If you are tempted to reinstate it,
the arithmetic is in `src/admin/lib/metrics.ts` with the reasoning attached.

What the dashboard shows instead:

| Slot | Contents |
| --- | --- |
| Shop conversion rate | **Unavailable**, with the reason: "A privacy-compliant first-party session denominator is not currently available." |
| GA4 transaction rate | `GA4 transactions ÷ GA4 sessions`. Both sides are Google's, so the populations match and the ratio means what it says. Rendered only when both values exist and sessions is non-zero. |
| Orders per tracked GA4 session | The blended ratio, kept as a **diagnostic** — it is a good tripwire for a tracking regression. Never a KPI card, never in a table, and never rendered without its warning: "This compares all Medusa orders with consent-dependent GA4 sessions. It is not a true shop-wide conversion rate and may be overstated." |

The conversion funnel obeys the same rule: a step-to-step percentage is computed
**only between steps from the same system**. `Order created ÷ Visitors` would be
Medusa over GA4 again, wearing a funnel's clothes, so that cell reads `—`.

A true shop-wide rate needs a first-party session count covering consenting and
non-consenting visitors alike. Building one is a privacy decision — see
[analytics.md](analytics.md) and `datenschutz.astro` — not a reporting task.

## What is deliberately unavailable

Each of these renders as a labelled empty state naming the missing data source,
never as a zero and never as an estimate.

| Metric | Why |
| --- | --- |
| Added to cart, checkout started (funnel steps) | The storefront sends no `add_to_cart` or `begin_checkout` event, and `/warenkorb`, `/kasse` and `/bestellung` are excluded from measurement entirely so order ids never reach Google. Cart *rows* exist in Medusa but are created by page load, not intent, so counting them would overstate the step. |
| Cart rate, checkout rate per channel | Same missing events, plus no attribution key. |
| Checkout abandonment rate | Needs the checkout-started count above. |
| Order attribution table (first/last touch, landing page) | No source is persisted on the order. |
| Source summary by orders/revenue | Same. |
| Product sell-through rate | Needs opening stock for a past window. Medusa stores only the *current* inventory level with no history table, so any figure would assume nothing was restocked, adjusted or written off — which is what a merchant would be using the number to find out. |
| Live product activity, live funnel | Needs GA4 item-scoped ecommerce events, which are not sent. |

**Closing any of these is a storefront collection change, not a dashboard
change.** `orderAttributionSource` in `src/lib/ops/aggregate.ts` already reads
the well-known metadata keys (`utm_source`, `utm_medium`, `utm_campaign`,
`landing_page`, `referrer`, `attribution_source`), so the day the checkout starts
writing one, the tracking panel begins reporting it with no change here. Note
that adding UTM capture has a privacy dimension — see `docs/analytics.md` and
`datenschutz.astro` — and is a decision, not a chore.

## Tabs

`?tab=` and `?period=` are in the URL, so a refresh, a bookmark and a link to a
colleague all land on the same view. Unrecognised values fall back to
`overview` / `7d` rather than erroring.

### Overview (`?tab=overview`)

Four Medusa KPI cards with previous-period comparison, the daily sales trend
with a previous-period line, GA4 summary cards, most-visited pages, the channels
table, recent orders, bestsellers, top customers, customer metrics, and the
breakdown panels (totals, AOV over time, fulfillment status, payment method,
discount code, sales channel, sales by product).

### Live (`?tab=live`)

Visitors now (GA4 realtime), visitors today (GA4 summary for `today`), orders
today and revenue today (both Medusa). Location distribution, active pages,
events, devices.

**Polls every 60 seconds while the browser tab is visible, and stops entirely
when it is hidden.** A hidden tab spends the property's shared Data API quota
with nobody reading the result. The page says so when it is paused.

Every GA4 realtime panel is labelled *approximately the last 30 minutes*. **No
GA4 realtime figure is ever labelled as sales or revenue.**

### Conversion & Sources (`?tab=conversion`)

Payment completion rate (Medusa paid orders ÷ Medusa orders — one system, so it
is a real rate), median time to payment (median, not mean — this shop is paid by
bank transfer and the distribution has a long tail), the five-step funnel with
its two unavailable steps, tracking quality, and the GA4 source/medium table.

The shop-conversion slot is an unavailable card; the two ratios that *can* be
computed live beside it, labelled and caveated. See
[There is no shop-wide conversion rate](#there-is-no-shop-wide-conversion-rate).

## Endpoints

Three admin-only aggregation endpoints, alongside the three GA4 ones.

```
GET /admin/analytics/ops/overview?period=7d|30d|90d
GET /admin/analytics/ops/live
GET /admin/analytics/ops/conversion?period=7d|30d|90d
```

Aggregation happens on the server. The alternative — the browser downloading
every order, customer and line item for ninety days to add them up — is slow and
puts far more customer data in a browser than the page renders.

**Authentication is structural.** Medusa v2 applies
`authenticate("user", ["bearer","session","api-key"])` to everything under
`/admin`, so these are protected by living in `src/api/admin/**`. There are
deliberately **no store routes** for analytics.

`period` is a closed set. An arbitrary range would defeat the cache and let an
authenticated caller run unbounded database work.

### What the responses carry

Counts, sums and a display name. **No customer email, no address, no line
items.** A registered customer shows their name; a guest order shows "Guest",
not their email — the dashboard has no reason to put one on screen, and a shared
browser tab should not be a disclosure. The recent-orders table links to the
admin's own order page, which has its own permission check.

### Errors

| Code | HTTP | Meaning |
| --- | --- | --- |
| `OPS_INVALID_PERIOD` | 400 | Period outside `7d`/`30d`/`90d`. |
| `OPS_UNAVAILABLE` | 503 | Aggregation failed. Fixed message; the original is logged server-side only. |

The GA4 codes are in [analytics-ga4-api.md](analytics-ga4-api.md).

Both error funnels repeat `code` and `message` at the **top level** of the body
as well as inside `error`. That is not redundancy: `@medusajs/js-sdk` keeps only
the top-level `message` when it turns a non-2xx into a `FetchError`, so without
it the admin would render "Service Unavailable" instead of the actionable
sentence. The nested `error` object stays because it is the documented shape.

### Partial failure

**A GA4 failure never hides Medusa metrics, and a Medusa failure never hides GA4
panels.** The two are separate queries, and each panel renders its own loading,
error and empty state through the `Section` component. A failed refresh over
data that loaded once keeps the old numbers on screen with a staleness warning
rather than blanking the card.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANALYTICS_TIMEZONE` | `Europe/Berlin` | Day boundaries for every Medusa figure and every chart label. An invalid zone falls back rather than failing the request. |
| `ANALYTICS_CACHE_TTL_SECONDS` | `30` | Server-side report cache. `0` disables it; clamped to 600. |

Currency is **not** configurable and not hardcoded: it is read from the orders
that were summed, falling back to the store's default currency for a window with
no orders.

### Why the timezone matters

`order.created_at` is a UTC instant. "The last 7 days" is only meaningful once
someone says which midnight. A server running in UTC would push a 01:00 CEST
order into the previous day, so a chart and its total would disagree. All
boundaries are computed in one place, `src/lib/ops/period.ts`.

## Export

The Export button downloads the visible period's **summary** as CSV: KPIs, the
daily trend, breakdowns, channels, pages, funnel and tracking quality. Column
headings are stable machine-readable keys (`sales_volume`), values are localized
for reading (`1.234,50 €`, `31.07.2026`), and the file carries a UTF-8 BOM so
Excel reads "Packgröße" correctly.

**Not exported:** customer names, emails, order identifiers, credentials or any
configuration value. Cells beginning `=`, `+`, `-` or `@` are prefixed with a tab
so a merchant-supplied product title cannot execute as a spreadsheet formula.

The conversion export carries `shop_conversion_rate` as the literal string
`not available` with a reason row, rather than as a blank cell — a spreadsheet
reader treats an empty numeric cell as zero. The two computable ratios sit in
their own "Ratios (read the notes)" section, each with its caveat in a `note`
column, because a CSV outlives the screen it came from and anything not written
into the file is lost the moment it is mailed on.

## Code map

| Path | Role |
| --- | --- |
| `src/lib/ops/period.ts` | Period validation, timezone-aware windows, previous-period math |
| `src/lib/ops/money.ts` | `BigNumberValue` → number, rounding, ratios, percent change |
| `src/lib/ops/aggregate.ts` | All arithmetic, as pure functions |
| `src/lib/ops/orders.ts` | Fetching via `getOrdersListWorkflow`, pagination, the `MAX_ORDERS` cap |
| `src/lib/ops/service.ts` | Assembly, caching, the funnel's unavailable steps |
| `src/lib/ops/errors.ts`, `http.ts` | The safe error funnel |
| `src/api/admin/analytics/ops/*/route.ts` | The three routes |
| `src/admin/routes/analytics/page.tsx` | The route, nav item, tabs, URL state |
| `src/admin/components/analytics/*.tsx` | Tabs, primitives, SVG charts |
| `src/admin/components/analytics/analytics.css` | Scoped design tokens and styling |
| `src/admin/lib/metrics.ts` | The blended-ratio trap, named once: labels, warnings, safe division |
| `src/admin/lib/*.ts` | SDK client, queries, formatting, CSV, error taxonomy |

### Why the arithmetic is pure

`aggregate.ts` takes orders and returns JSON — no container, no database, no
clock. That is what makes the commerce half testable against fabricated orders,
which matters more than usual here: **this shop has taken no orders yet**, so
the only way to know a sum is right is to compute it over data we wrote.

### Why orders are read through a workflow

`getOrdersListWorkflow` is what the built-in `GET /admin/orders` route uses, and
it is where `payment_status` and `fulfillment_status` are *derived* — they are
not columns. Querying the order module directly would return orders without
them, and the obvious repair is to reimplement that aggregation, at which point
the dashboard and the orders list start disagreeing about what "fulfilled"
means.

### The order cap

`MAX_ORDERS = 5000` per report. The aggregations run in process, so an unbounded
window would be an out-of-memory bug that only appears once the shop succeeds.
Past the cap the response is marked `truncated` and the UI says the total is
partial. **If this ever trips in production the fix is a database-side
aggregation, not a bigger number.**

## Styling

The page uses the existing Medusa shell — sidebar, topbar, layout are untouched,
and there is no second navigation. Its own styling is entirely scoped under
`.pa`, with design tokens declared on `.pa` rather than `:root`, so it cannot
restyle the orders page and removing the route removes the styling with it.
Dark mode is supported via the `.dark` class the admin puts on the html element.
`styles.admin.spec.tsx` enforces the scoping.

### No chart library

The repository has none — not in the backend app, not in `@medusajs/dashboard`,
not transitively. The charts are inline SVG: one line chart with a comparison
series and a tooltip, one sparkline, and horizontal bars. Every chart carries
`role="img"` with a generated description and is followed by a visually hidden
table of the same numbers.

### No map

The Live tab shows a location distribution and a ranked list rather than a world
map. Adding a mapping library plus its topology data to colour twenty country
names was not judged worth the payload, and the ranked list is the accessible
presentation such a map would need anyway.

## Running it locally

```bash
cd backend/apps/backend
npm run dev
```

Then open **http://localhost:9000/app/analytics** and sign in as an admin. If
you have no admin user:

```bash
npx medusa user -e you@example.com -p your-password
```

Without `GA4_PROPERTY_ID` and a credential, the GA4 panels show
`GA4_NOT_CONFIGURED` and the Medusa panels work normally — which is itself worth
seeing once, because it is the partial-failure behaviour the page is built
around.

## Tests

```bash
cd backend/apps/backend
npm run test          # both suites
npm run test:unit     # server: period math, aggregation, routes
npm run test:admin    # admin: rendering, URL state, polling, CSV, styling
```

The admin suite runs under jsdom with its own config (`jest.admin.config.js`).
It deliberately does **not** call `loadEnv`: the server config does, which puts
the real `.env` — including the GA4 credential — into `process.env`, and nothing
browser-side has any business reaching that.

**Every fixture is fabricated.** No test uses the real property id, measurement
id, customer data, order data or credential values.
