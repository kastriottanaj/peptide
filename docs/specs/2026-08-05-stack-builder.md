# Spec — Stack-Builder

- **Date:** 2026-08-05
- **Status:** approved — 2026-08-05
- **Owner:** storefront

## Goal

Ship an indexable `/stack-builder` tool that lets laboratory customers compare
Medusa catalog products, choose one pack-size variant per product, and review the
result as a transparent multi-position selection. This first release remains a
comparison tool and never transfers the selection into the cart.

The prior-art page at `peptidebestellung.de/stack-builder` supplies the useful
interaction model: curated presets, category filters, variant-aware product cards,
and a persistent summary. Its Next.js/Tailwind implementation and its larger,
partly different catalog do not transfer. This version uses Astro, scoped plain
CSS, existing design tokens, and the Medusa catalog.

Ordering is currently closed. The public first release keeps product selection,
pack-size comparison, subtotal calculation, and reset fully usable, but renders no
cart action and performs no cart mutation under either `ORDERS_ENABLED` state.
Reopening ordering remains a separate launch decision for existing product pages and
does not make the Stack Builder transactional.

## Scope

### Catalog-backed product choices

- Fetch products once at build time through `listProducts()`, including their
  categories, metadata, variants, inventory state, calculated EUR prices, and
  thumbnails.
- Render the catalog as complete HTML before JavaScript. Every product card shows
  the available product data without assuming optional metadata exists: title,
  research code, purity, category, description, image, variant choices, price,
  availability, and COA status.
- Use `isVariantAvailable()` for selectable state. Sold-out variants remain visible
  and disabled; a product with no selectable priced variant cannot be added to the
  stack.
- Format every price from `variant.calculated_price` with the shared `formatEur()`
  path. No copied or hard-coded prices.
- Category filter buttons are derived from the categories present on the rendered
  products. Filtering changes only visibility, not the selected stack.

### Preset selections

Define three conservative research panels by stable product handle, using only the
six products in the current seeded catalog:

| Panel | Product handles |
| --- | --- |
| Regenerations-Panel | `bpc-157`, `tb-500` |
| Struktur-Panel | `ghk-cu`, `bpc-157` |
| Stoffwechsel-Panel | `retatrutide`, `mots-c` |

The copy describes these as convenient catalog groupings, not treatment protocols,
recommendations, combinations for human use, or claims of synergy. Every panel stays
visible, but a missing product or a product without an available priced variant is
identified honestly and disables that preset; no substitute is chosen. Choosing a
complete panel replaces the current selection and uses the first available priced
variant for each product; the customer can then change pack sizes.

### Interactive selection and summary

- A small plain `<script>` island owns browser-only state; no framework runtime.
- A product can appear at most once. “Wählen” adds it, “Entfernen” removes it, and
  choosing another pack size updates its existing summary row and subtotal.
- The summary reports position count, each product and selected pack size, item
  price, subtotal, and reset. It is sticky on desktop and returns to normal document
  flow on narrow screens.
- The comparison sum uses only current comparable catalog prices. It does not include
  shipping, promotions, or transactional projections.
- Selection state is intentionally session-local DOM state. It is not persisted,
  sent to analytics, or encoded into the URL.
- Status changes use `aria-live`; filter and selection buttons expose their active
  state; all operations work from the keyboard.

### Comparison-only ordering boundary

- With either `ORDERS_ENABLED` value, render comparison state and individual product
  links only. Do not render a cart or checkout control, import `lib/cart.ts`, mutate a
  cart, or use transactional wording.
- Existing product pages retain their current order-gated behavior independently.
- This feature does not change either storefront or backend order-enablement logic.

### Page, SEO, and discovery

- Add `/stack-builder` with unique German title, description, self-canonical URL,
  introductory copy, a three-step explanation, presets, builder, and a short COA
  traceability section.
- Emit a `WebApplication` JSON-LD node, an `ItemList` for the products rendered in
  the builder, and a `BreadcrumbList`. Reference the shared organization `@id`.
- Add the page to the static content index at priority `0.75` and `changefreq`
  `weekly`, which feeds the pages sitemap, search/discovery documents, and `llms.txt`.
- Add “Stack-Builder” beside the existing Peptid-Rechner in the appropriate header
  and footer tool navigation.
- Query strings are not part of the feature, so the page remains one clean indexable
  URL.

### Tests

- Extract the serializable builder view model and preset resolution into a pure
  module with fixtures covering missing metadata, missing prices, sold-out variants,
  conditional presets, first-available selection, and German price output.
- Add output-level coverage for unique metadata, canonical/JSON-LD, discovery entry,
  and the absence of cart/checkout controls under both ordering states.

## Non-goals

- No new Medusa products, variants, categories, inventory, prices, images, purity
  values, COA values, or other catalog mutation. Current catalog values remain
  placeholders and are merely read consistently with existing public product pages.
- No medical guidance, dosage, schedule, administration instructions, outcome claim,
  “recommended stack”, or personalization questionnaire.
- No discount or bundle pricing. The displayed subtotal is the sum of selected
  variant prices before cart promotions; Medusa calculates the real cart total.
- No quantity control or cart transfer inside the builder. A selection represents one
  comparable catalog unit per product, not a purchase quantity.
- No saved stacks, accounts, sharing URLs, local storage, server persistence, emails,
  PDFs, or printable protocols.
- No search field, sorting, pagination, or separate detail modal. Product names link
  to the existing detail pages.
- No changes to checkout, backend middleware, consent, analytics, legal pages, or the
  `ORDERS_ENABLED` value.
- No production deploy or catalog operation as part of implementation approval.

## Concrete File Changes

| File | Change |
| --- | --- |
| `storefront/src/lib/stack-builder.ts` | new — pure catalog-to-builder model, presets, and formatting inputs |
| `storefront/src/lib/variant-availability.ts` | new — extracted shared inventory predicate used by catalog and builder |
| `storefront/src/components/StackBuilder.astro` | new — progressively enhanced cards, filters, comparison-only sticky summary, scoped CSS |
| `storefront/src/pages/stack-builder.astro` | new — page copy, SEO props, JSON-LD, and builder composition |
| `storefront/src/lib/content-index.ts` | edit — add the tool to static discovery |
| `storefront/src/layouts/BaseLayout.astro` | edit — add header/footer tool links |
| `storefront/src/lib/stack-builder.test.ts` | new — view-model and preset regression coverage |
| `storefront/src/lib/stack-builder-output.test.ts` | new — page/SEO/gating contract coverage |
| `storefront/src/lib/images.test.ts` | edit — audit the builder's optional catalog images and vial fallback |
| `storefront/src/pages/kategorie/[handle].astro` | edit — scoped comparison-tool link for the empty Peptid-Stacks category |

No backend files change, so only the storefront quality gate runs.

## Verification

From `storefront/`, with the backend running on `:9000` for the build-time catalog
fetch:

```bash
npm test
npm run typecheck
npm run build
grep -rnE '#[0-9a-fA-F]{3,8}\b' --include='*.astro' src \
  | grep -vE '\-\-c-[a-z0-9-]+:\s*#|fill=|stroke='
```

From the worktree root:

```bash
git diff --check
git status --short
```

Manual checks in the background Astro dev server:

1. With JavaScript disabled, the complete catalog, variants, prices, availability,
   COA text, presets, and an empty summary remain readable; interactive controls do
   not make false promises.
2. With JavaScript enabled, category filters work without clearing selections;
   selecting a product adds one row, selecting it again does not duplicate it, and
   changing its pack size updates the row and subtotal.
3. Each complete preset replaces the current stack with its expected products and
   first available priced variants; an incomplete preset stays visible, identifies
   the missing or unavailable component, and cannot be selected.
4. Sold-out variants are visible but disabled, and an unavailable product cannot be
   selected.
5. Reset clears all rows, restores the empty state, and returns subtotal to `0,00 €`.
6. Under both ordering states, no cart or checkout action exists in the DOM and
   interacting with the builder makes no Medusa cart request.
8. Keyboard-only use exposes focus, active filter/selection state, and announced
   status changes. At 375 px there is no horizontal overflow; at desktop width the
   summary sticks without covering the footer.
9. The page has one H1, unique metadata, self-canonical URL, valid JSON-LD, and appears
   in `sitemap-pages.xml`, site search/discovery output, and `llms.txt`.
