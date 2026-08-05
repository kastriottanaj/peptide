# Implementation Plan — Stack-Builder

- **Date:** 2026-08-05
- **Status:** implementation complete — awaiting review
- **Approved spec:** `docs/specs/2026-08-05-stack-builder.md`
- **Owner:** storefront

## Fixed public contract

- **Route:** `/stack-builder/`
- **Production canonical:** `https://peptideeinkaufen.de/stack-builder/`, emitted by
  the existing `canonicalUrl(Astro.url)` path rather than hard-coded at the page.
- **Title:** `Peptid Stack-Builder für Labor und Forschung`
- **Description:** `Forschungsprodukte aus dem aktuellen Sortiment auswählen, Packgrößen und Preise vergleichen und als transparente Positionen zusammenstellen.`
- **H1:** `Peptid Stack-Builder für Laborbestellungen`
- **Robots:** indexable immediately (`index, follow` by omission of a robots meta
  restriction). The page is a unique, useful catalog tool with one clean URL; it is
  not a faceted result page and does not depend on ordering being open.
- **Discovery:** add `/stack-builder` to `STATIC_ROUTES` with `weekly` change frequency
  and priority `0.75`. Existing generators then include the canonical page in
  `sitemap-pages.xml`, `/llms.txt`, `/llms-full.txt`, and the site-search document.

Structured data is deliberately limited to:

- `WebApplication`: the page is a free browser-based selection/comparison utility;
  use `applicationCategory: UtilitiesApplication`, operating system `Any`, publisher
  by the shared Organization `@id`, and a zero-EUR offer for access to the tool—not
  for any catalog product.
- `ItemList`: describes the real Medusa products visibly listed by the tool and links
  each item to its existing product detail page. It makes no offer or availability
  claim of its own.
- `BreadcrumbList`: represents `Start → Stack-Builder`, matching visible navigation.

Do not emit `Product`, `Offer`, `AggregateOffer`, `Review`, or `AggregateRating` for
the builder. Those entities belong on the individual product pages; applying them to
the utility would imply the preset or page itself is merchandise.

## Ordering behavior matrix

| Concern | `ORDERS_ENABLED=false` | `ORDERS_ENABLED=true` |
| --- | --- | --- |
| Selection | Local comparison state works | Local comparison state works |
| Summary | Positions, pack sizes, prices, comparison sum, reset, and product links | Same |
| Cart UI | No cart/checkout control in the DOM; no disabled pseudo-order control and no transactional wording | Same: comparison and individual product-page links only |
| Cart code/network | No import of `lib/cart.ts`, cart creation, or mutation | Same: existing product pages retain their own ordering behavior, but the builder remains non-transactional |
| Validation | Build-time availability/pricing controls comparison eligibility | Same |
| Failures | Not applicable | Not applicable |
| Repeat clicks | Selection actions remain idempotent and prevent duplicates | Same |

Production remains in the false state. Neither branch changes the flag, backend
middleware, cart, checkout, or deployment configuration. This first release has no
Stack Builder cart path under either state, so no backend endpoint is justified.

## Preset contract

Definitions live once in `storefront/src/lib/stack-builder.ts` as immutable records
of neutral label, neutral description, and stable Medusa product handles:

1. **Regenerations-Panel** — `bpc-157`, `tb-500`
2. **Struktur-Panel** — `ghk-cu`, `bpc-157`
3. **Stoffwechsel-Panel** — `retatrutide`, `mots-c`

The resolver joins these definitions to the products already returned by
`listProducts()`; it does not maintain product names, prices, variants, inventory,
images, attributes, or category assignments in the preset table. Each component must
resolve to the exact handle and have an available variant with a numeric calculated
price. An unresolved product, no variants, sold-out variants, or no priced available
variant leaves that named component visible as missing/unavailable and disables the
whole preset. There is no silent substitution.

Presets are temporary selections, not Medusa products or purchasable bundles. They do
not populate or modify `/kategorie/peptid-stacks/`. That empty category already renders
`noindex, follow` through `noindexFollow={products.length === 0}` and must stay that
way until real products are assigned in Medusa.

## Tasks

### 1. Build and test the catalog view model

- [x] Create `storefront/src/lib/stack-builder.ts`.
- [x] Consume `CatalogProduct` and existing `isVariantAvailable()`; do not fetch data
  or duplicate any catalog record in this module.
- [x] Extract the inventory predicate to `storefront/src/lib/variant-availability.ts`
  and re-export it from `catalog.ts`, so the pure Node tests and existing catalog
  consumers share one rule without pulling the Medusa client into the test graph.
- [x] Define serializable product, variant, category, and preset view-model interfaces
  consumed by the Astro component and its native script.
- [x] Map only real Medusa fields: ids/handles, titles, descriptions, thumbnails,
  categories, `research_code`, `purity`, `coa_status`, variant title, calculated
  amount/currency, and inventory-derived availability.
- [x] Graceful fallbacks: existing vial illustration for no image; omit absent
  metadata and description; show “Preis nicht verfügbar” for no numeric price; show
  “Keine Packgröße verfügbar” for no variants; show unavailable status when inventory
  makes every variant unavailable. Such variants/products remain browsable and linked
  but are never selectable.
- [x] Preserve actual currencies per variant. A stack subtotal is shown only when all
  selected variants share one currency; mixed currencies render per-line prices plus
  “Keine gemeinsame Summe für unterschiedliche Währungen” instead of converting or
  adding them. Missing-price variants cannot enter the selection.
- [x] Add the three immutable preset definitions and resolver described above.
- [x] Create `storefront/src/lib/stack-builder.test.ts` with fixtures for real-field
  mapping, optional metadata, missing image/price/variants, inventory states, exact
  preset definitions, missing and unavailable components, no substitution, first
  available priced variant, and mixed-currency totals.

**Produces:** a server-safe `buildStackBuilderModel(products)` result containing the
only JSON needed by the component. **Consumes:** the real result of `listProducts()`;
tests use typed minimal fixtures only and never become production catalog data.

### 2. Build the progressively enhanced component

- [x] Create `storefront/src/components/StackBuilder.astro` accepting the resolved
  product/category/preset view model and `ordersEnabled` as props.
- [x] Render all headings, preset descriptions/statuses, product facts, variant
  options, availability, prices, product-detail links, filters, empty summary, and
  closed-order explanation in server HTML.
- [x] Derive category filter buttons from the real seven-category list passed from
  Medusa, including empty categories. Selecting an empty category honestly shows
  zero products and a link to its existing category route; it must not borrow products
  from another category or imply the category contains inventory.
- [x] Use native buttons/selects and one bundled Astro `<script>` module. Add/remove
  one position per product id, prevent duplicates with a `Map`, and treat quantity as
  fixed at one catalog unit. Changing the selected available priced variant updates
  the existing position rather than creating another.
- [x] Keep product browsing functional without JavaScript: product details and all
  catalog facts remain visible; interactive controls are hidden or explicitly
  non-operative until enhancement, with no false cart promise.
- [x] Announce concise state changes through one `role=status`/`aria-live=polite`
  region (“BPC-157 hinzugefügt”, “Packgröße geändert”, “Auswahl geleert”), while the
  full summary is not itself live to avoid re-reading every row.
- [x] Implement the summary as a grid sidebar with `position: sticky` only above the
  responsive breakpoint, a top offset below the sticky site header, and bounded
  internal overflow when height permits. On narrow or short viewports, switch to a
  normal-flow block after the products; do not use fixed positioning, so navigation,
  consent UI, footer, and controls cannot be obscured. Keep every summary action in
  normal tab order.
- [x] Use `formatEur()` from `pricing.ts` for server output and equivalent `Intl`
  formatting in the native script. Do not project shipping, promotions, or order
  totals from the comparison selection.
- [x] Keep the component comparison-only under both `ORDERS_ENABLED` states: do not
  import `lib/cart.ts`, render cart/checkout actions, or use transactional wording.
  Product-detail links are the only path onward; existing product pages independently
  retain their established order-gated behavior.
- [x] Use scoped styles and existing CSS tokens only; retain the accepted decorative
  inline-SVG colour exception if the existing vial illustration is reused.
- [x] Extend `storefront/src/lib/images.test.ts` so the builder's optional catalog
  image and decorative fallback are part of the repository-wide image audit.

**Produces:** an accessible HTML catalog/comparison surface plus a small native-JS
enhancement. **Consumes:** the pure view model and pricing constants. It does not
consume the cart API or branch into a transactional mode when ordering is enabled.

### 3. Add the route, exact SEO, and structured data

- [x] Create `storefront/src/pages/stack-builder.astro` and fetch `listProducts()` and
  `listCategories()` once at build time; pass those real records through the view-model
  builder without any second catalog dataset.
- [x] Use the fixed route metadata and H1 above through `BaseLayout`; do not set a
  robots restriction, so it is indexable immediately and self-canonical.
- [x] Render visible breadcrumb, research-only introductory copy, the three-step
  choose/review/cart-or-compare explanation conditioned on ordering state, and a COA
  traceability section that describes metadata honestly and links to the existing COA
  knowledge page.
- [x] Build only the justified `WebApplication`, `ItemList`, and `BreadcrumbList`
  nodes through `canonicalUrl()`, `productPath()`, `breadcrumbNode()`, and
  `ORGANIZATION_ID`; add assertions excluding product/review schema on this route.
- [x] Keep wording neutral: no dosage, administration, consumption, treatment,
  performance, weight-loss, synergy, safety, efficacy, personalized advice, or
  human/animal-use language.

**Produces:** the public `/stack-builder/` document. **Consumes:** catalog helpers,
site/SEO helpers, the builder model/component, and the unchanged order flag.

### 4. Add discovery and navigation without changing category meaning

- [x] Edit `storefront/src/lib/content-index.ts` to add the fixed static route record,
  letting existing sitemap, search, `llms.txt`, and `llms-full.txt` generators consume
  it automatically.
- [x] Edit `storefront/src/layouts/BaseLayout.astro`: add a concise `Stack-Builder`
  header link beside `Rechner`, and add it to the footer’s `Wissen`/tools group.
- [x] Edit `storefront/src/pages/kategorie/[handle].astro` only to show a contextual
  text link on the empty `peptid-stacks` category: “Produkte vergleichen im
  Stack-Builder”. Keep the empty-inventory message and `noindex, follow`; phrase the
  link as a comparison tool, never as stocked stacks or a purchasable preset.
- [x] Do not change category records, `catalog-seo.ts`, category JSON-LD, or any other
  category/product-page behavior.

**Produces:** discoverability and one honest relationship from the empty category.
**Consumes:** existing content-index and dynamic-category contracts.

### 5. Add output, safety, and interaction regression tests

- [x] Create `storefront/src/lib/stack-builder-output.test.ts` covering the exact route,
  title, description, H1, canonical helper use, default indexability, and exact allowed
  structured-data types; explicitly reject `Product`, offer/review/rating schema.
- [x] Assert `listProducts()`/`listCategories()` feed the model and no production
  catalog literals or mutation APIs appear in the feature.
- [x] Cover all three preset names/handles and visible disabled status for missing or
  unavailable components.
- [x] Cover server-HTML fallbacks for missing image, price, variants, metadata, and
  JavaScript-disabled browsing.
- [x] Cover real-category filters including an empty category, duplicate-selection
  prevention, one fixed unit per selected product, variant replacement, mixed-currency
  handling, and concise accessible announcements.
- [x] Assert the desktop sticky rule and mobile/short-viewport normal-flow fallback,
  with no fixed summary positioning.
- [x] Assert that both false and true order states contain no cart/checkout action,
  cart import/mutation, or transactional wording. Test the invariant without changing
  the production environment flag.
- [x] Add prohibited-copy assertions for medical, dosage, administration, consumption,
  treatment/outcome, synergy, safety/efficacy, and personalized-recommendation terms.
- [x] Assert the route appears in navigation, `staticEntries`, sitemap/discovery
  sources, and that the empty Peptid-Stacks category retains `noindex, follow` plus an
  accurately worded tool link.
- [x] Run the existing product/category metadata and category-expansion tests to prove
  category routes and product pages otherwise remain unchanged.

**Produces:** focused regression coverage around data provenance, safe wording,
accessibility contracts, responsive behavior, ordering isolation, and SEO.

### 6. Verify, review, then commit only after separate authorization

- [x] Start the backend on `:9000` if it is not already available; do not mutate or
  reseed catalog data for this feature.
- [x] Run the focused and full storefront validation commands below.
- [x] Start the storefront using `astro dev --background` and perform the manual matrix
  below at desktop and 375 px, including a JavaScript-disabled pass.
- [x] Inspect `git status --short` before any future commit and ensure every change is
  understood and belongs to this plan.
- [x] Stop here for review. Do not commit, push, merge, deploy, or modify production
  data without a later explicit instruction.

## Validation commands

From `storefront/`:

```bash
node --test src/lib/stack-builder.test.ts src/lib/stack-builder-output.test.ts
npm test
npm run typecheck
npm run build
grep -rnE '#[0-9a-fA-F]{3,8}\b' --include='*.astro' src \
  | grep -vE '\-\-c-[a-z0-9-]+:\s*#|fill=|stroke='
```

No backend file is planned to change, so no backend gate is required. If implementation
finds that a backend change is unavoidable, stop and revise/approve the spec and plan
before writing it; then add `npm run lint`, `npm run build`, and `npm run test` from
`backend/`.

From the worktree root:

```bash
git diff --check
git status --short
```

Manual verification:

- Confirm the exact metadata/canonical/robots/JSON-LD contract in built HTML.
- Confirm all real products and all seven real categories render from Medusa; empty
  categories remain empty, and absent optional fields degrade as planned.
- Exercise every filter, preset, add/remove, variant change, reset, subtotal, and
  mixed-currency state with keyboard and pointer input.
- Confirm concise screen-reader announcements and no focus loss after DOM updates.
- Confirm the desktop summary sticks below the header and the mobile/short-viewport
  summary is in flow without covering content or consent controls.
- Disable JavaScript and confirm headings, explanatory copy, product facts, variants,
  prices, availability, preset statuses, and product links remain useful.
- In the default closed build, confirm no cart action exists and no cart request occurs.
- Inspect or render both order-flag states and confirm the builder stays comparison-only
  in each. Never alter production configuration.
- Confirm `/stack-builder/` appears in the pages sitemap, site-search document,
  `/llms.txt`, `/llms-full.txt`, header, and footer.
- Confirm existing product pages and all category routes retain their prior content and
  metadata, except the scoped empty Peptid-Stacks comparison-tool link.
