# Catalog Category Expansion

- Date: 2026-08-05
- Status: Approved — 2026-08-05

## Goal

Expand the Medusa-backed German storefront catalog from its four current research
categories to the seven-category information architecture supplied by the user. Reuse
the four existing categories, add only the three missing categories, and make the new
records appear automatically in the existing product-listing category navigation,
category routes, search index, sitemap, and discovery feeds.

The final German category set is:

1. GLP-1-Forschung (new; handle `glp-1-forschung`)
2. Regenerationsforschung (existing)
3. Stoffwechsel-Forschung (existing)
4. Signal- & Fragmentpeptide (existing)
5. Neuropeptid-Forschung (existing)
6. Peptid-Stacks (new; handle `peptid-stacks`)
7. Laborbedarf (new; handle `laborbedarf`)

## Scope

- Add an idempotent Medusa catalog script that creates the three missing active
  product categories with explicit stable handles and conservative German descriptions.
- Match existing records by stable handle and fail safely on conflicting records rather
  than creating duplicates or silently renaming user-managed categories.
- Assign the existing demo Retatrutide product to `GLP-1-Forschung` in addition to its
  current `Stoffwechsel-Forschung` assignment. Preserve all existing category
  assignments and product data.
- Leave `Peptid-Stacks` and `Laborbedarf` empty until genuine products are supplied.
  Their existing category pages will render the established empty-category state.
- Add curated category SEO metadata for the three stable handles without making
  medical, stock, quality, or product-count claims.
- Add focused backend/script and storefront regression coverage for category identity,
  handles, safe assignment behavior, and SEO metadata.
- Document the operational command and required storefront rebuild. Production catalog
  mutation and deployment happen only after the code is verified, committed, pushed,
  merged to `main`, and explicitly approved for release.

## Non-goals

- No new product, peptide stack, supply item, price, purity value, COA status, image,
  inventory, or medical/use claim.
- No removal or renaming of the four existing German categories.
- No removal of Retatrutide from `Stoffwechsel-Forschung` and no reassignment of other
  products based on assumptions.
- No category hierarchy or nested parent/child categories.
- No redesign of the product listing, category page, header, footer, homepage, or
  homepage's curated four-card category section.
- No checkout, cart, order-enablement, consent, analytics, or legal-page changes.
- No direct SQL or manual database edits.
- No production mutation or deployment as part of implementation approval alone.

## Concrete File Changes

- `backend/apps/backend/src/scripts/expand-product-categories.ts`
  - Add the convergent category creation and additive Retatrutide assignment workflow,
    explicit conflict checks, logging, and a documented Medusa execution command.
- `backend/apps/backend/src/scripts/expand-product-categories.test.ts`
  - Cover the desired definitions and the script's duplicate/conflict/additive safety
    invariants without requiring a production database.
- `storefront/src/lib/catalog-seo.ts`
  - Add claim-safe title and description entries for the three new category handles.
- `storefront/src/lib/metadata-output.test.ts`
  - Cover the new category SEO entries and their stable handles.
- `README.md` and/or the applicable catalog runbook
  - Document how to apply the category script and that the static storefront must be
    rebuilt after Medusa catalog changes.

Existing dynamic consumers (`/produkte/`, `/kategorie/[handle]/`, search, sitemap,
`llms.txt`) should require no production-code changes; verification will prove that the
new Medusa records flow through them.

## Verification

From `backend/`:

```bash
npm run lint
npm run build
npm run test
```

From `storefront/` with the backend running on `:9000` after applying the script to the
local development database:

```bash
npm test
npm run typecheck
npm run build
grep -rnE '#[0-9a-fA-F]{3,8}\b' --include='*.astro' src | grep -vE '\-\-c-[a-z0-9-]+:\s*#|fill=|stroke='
```

From the worktree root:

```bash
git diff --check
git status --short
```

Manual checks:

- Run the category script twice locally and confirm the second run creates no duplicate
  category and does not remove any product-category relationship.
- Confirm `/produkte/` lists all seven German categories in the catalog navigation.
- Confirm all three new `/kategorie/<handle>/` routes build and render indexable,
  self-canonical pages with unique metadata.
- Confirm Retatrutide appears under both GLP-1-Forschung and Stoffwechsel-Forschung.
- Confirm Peptid-Stacks and Laborbedarf show the honest empty-category message.
- Confirm the category sitemap/search/discovery outputs include the three new routes.
- Confirm ordering remains disabled and no unrelated product/catalog data changes.
