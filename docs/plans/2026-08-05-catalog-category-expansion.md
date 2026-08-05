# Catalog Category Expansion Implementation Plan

- Date: 2026-08-05
- Status: Approved — 2026-08-05
- Approved spec: `docs/specs/2026-08-05-catalog-category-expansion.md`

## Outcome and guardrails

Create three real Medusa product-category records, add the existing Retatrutide
record to GLP-1-Forschung without replacing any relationship, and let the static
Astro storefront consume those records. Peptid-Stacks and Laborbedarf remain real
but empty categories: they render an honest empty state, no product cards, and no
inventory claims. Ordering remains disabled.

No implementation, database mutation, commit, push, merge, or deployment is part of
this plan-writing step.

## Current system and data ownership

### Medusa records and relationships

- `backend/apps/backend/src/scripts/seed-peptides.ts` is the repository-owned,
  convergent catalog definition for the six demo peptide products and the four current
  categories. It creates missing categories, creates owned demo products, and updates
  existing owned demo products through `updateProductsWorkflow`.
- A product's category membership is Medusa data: product records and
  `product_category` records are connected by Medusa's product/category relationship.
  It is not an Astro constant, schema migration, or inventory field.
- The existing seed currently models `category` as one string and passes one ID in
  `category_ids`. Re-running it after an independent GLP-1 assignment would remove that
  new relationship. The seed definition must therefore become plural/additive for
  Retatrutide as part of this change.
- Production application is an explicit `npx medusa exec` operation against live
  Medusa data after code reaches `main`; `deploy/deploy.sh` does not run catalog scripts
  automatically. No database migration is needed because the schema does not change.

### Storefront sources and routes

- `storefront/src/lib/catalog.ts` owns `listCategories()` and category-filtered
  `listProducts({ categoryId })`. Categories are fetched from Medusa (or the build
  snapshot), sorted by German display name, and product counts are the length of the
  returned category-filtered product array.
- `storefront/src/pages/produkte/index.astro` renders every active returned category in
  its category navigation. It does not hard-code the four current categories.
- `storefront/src/pages/kategorie/[handle].astro` creates one static route per returned
  category, fetches products by category ID, renders product cards, breadcrumbs,
  canonical metadata, category JSON-LD, and an existing empty message plus links to
  other categories and `/produkte/`.
- `storefront/src/lib/catalog-seo.ts` owns curated category search metadata.
- `storefront/src/lib/content-index.ts::categoryEntries()` feeds
  `sitemap-pages.xml.ts`, `llms.txt.ts`, and the category portion of
  `api/search.json.ts`. It currently includes empty and non-empty categories equally.
- The homepage's category section is a curated four-handle CRO component. The approved
  homepage spec and this feature both treat it as unchanged; the full seven-category
  navigation remains on `/produkte/` and category pages.
- The shared footer hard-codes three popular existing categories. It is not the full
  category navigation and will remain unchanged.

## Category identity and copy

| State          | German title              | Exact handle             | Medusa description                                                |
| -------------- | ------------------------- | ------------------------ | ----------------------------------------------------------------- |
| New, populated | GLP-1-Forschung           | `glp-1-forschung`        | `Forschungsprodukte für GLP-1-bezogene Labor- und Analysezwecke.` |
| Existing       | Regenerationsforschung    | `regenerationsforschung` | unchanged                                                         |
| Existing       | Stoffwechsel-Forschung    | `stoffwechsel-forschung` | unchanged                                                         |
| Existing       | Signal- & Fragmentpeptide | `signal-fragmentpeptide` | unchanged                                                         |
| Existing       | Neuropeptid-Forschung     | `neuropeptid-forschung`  | unchanged                                                         |
| New, empty     | Peptid-Stacks             | `peptid-stacks`          | `Kategorie für Peptid-Stacks im Forschungs- und Laborkontext.`    |
| New, empty     | Laborbedarf               | `laborbedarf`            | `Kategorie für Laborbedarf im Forschungs- und Laborkontext.`      |

Proposed curated metadata:

| Handle            | Title                                           | Description                                                                                                                    |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `glp-1-forschung` | `GLP-1-Forschung: Produkte für Labor & Analyse` | `Produkte für GLP-1-bezogene Forschungs- und Analysezwecke mit transparenten Produktangaben. Kategorie ansehen.`               |
| `peptid-stacks`   | `Peptid-Stacks für Forschung und Labor`         | `Kategorieübersicht zu Peptid-Stacks für Forschungs- und Laborzwecke. Verfügbare Kategorien und das Gesamtsortiment ansehen.`  |
| `laborbedarf`     | `Laborbedarf für Forschung und Analyse`         | `Kategorieübersicht für Laborbedarf im Forschungs- und Analysekontext. Verfügbare Kategorien und das Gesamtsortiment ansehen.` |

The copy asserts no product count, stock, availability, price, purity, certification,
review, medical effect, or future inventory commitment. Empty-state copy will be:
`In dieser Kategorie sind derzeit keine Produkte gelistet.` followed by the existing
`Weitere Kategorien` links and the explicit `Alle Produkte` link.

## SEO decision for empty categories

Repository precedent is that indexable pages are self-canonical, have no robots meta,
emit their required structured data, and appear in a sitemap. Pages carrying `noindex`
are excluded from sitemaps to avoid contradictory signals. The current category route
does not distinguish empty categories, so it would immediately index a zero-item thin
page and include it in the sitemap and `llms.txt`.

Peptid-Stacks and Laborbedarf should initially render `noindex, follow`: visitors can
use their useful links, crawlers may follow those links to populated categories, but
the empty pages are not requested for indexing. This differs deliberately from the
repository's `noindex, nofollow` treatment of unknown, legal-draft, and private pages;
these are valid public navigation pages, not error/private content. The robots state is
derived from `products.length === 0`, not from a permanent handle denylist. After a real
product is assigned and the static site is rebuilt, the route automatically becomes
indexable and eligible for discovery.

Every category keeps one self-referencing canonical, including when empty; there is no
cross-URL canonical. Populated pages emit `CollectionPage` with an `ItemList` plus
`BreadcrumbList`. Empty pages omit the zero-item `CollectionPage` but may retain the
truthful `BreadcrumbList`. Empty categories are excluded from sitemap and `llms.txt`.
The storefront search may continue to expose them as navigational results only if its
category source is intentionally separated from the indexable discovery source;
otherwise it will exclude them consistently with `categoryEntries()`.

## Expected files and production records

### Repository files expected to change

- `backend/apps/backend/src/scripts/expand-product-categories.ts` — category
  definitions, collision checks, idempotent creation, exact Retatrutide lookup, and
  union-preserving category assignment.
- `backend/apps/backend/src/scripts/seed-peptides.ts` — model category names as arrays
  and define Retatrutide with both GLP-1-Forschung and Stoffwechsel-Forschung so later
  convergent seed runs cannot undo the relationship; no other Retatrutide field changes.
- `backend/apps/backend/src/lib/catalog-categories.ts` — pure definitions/helpers for
  exact handle validation and set-union calculation, allowing unit tests without a DB.
- `backend/apps/backend/src/lib/__tests__/catalog-categories.unit.spec.ts` — focused
  unit coverage for definitions, conflicts, duplicate prevention, and additive union.
- `storefront/src/pages/kategorie/[handle].astro` — data-driven empty-state robots,
  revised empty copy, useful catalog/category links, and conditional JSON-LD.
- `storefront/src/components/Seo.astro` and `storefront/src/layouts/BaseLayout.astro` —
  add the narrow ability to render `noindex, follow` while preserving the existing
  `noindex` boolean's `noindex, nofollow` behavior everywhere else.
- `storefront/src/lib/catalog-seo.ts` — three curated metadata entries.
- `storefront/src/lib/content-index.ts` — calculate category product counts once and
  return only populated categories from the indexable category-entry path.
- `storefront/src/pages/api/search.json.ts` only if required to keep valid empty
  categories available as on-site navigation while excluding them from sitemap/LLM
  discovery; do not duplicate category copy or filtering policy.
- `storefront/src/lib/metadata-output.test.ts` and focused category/content-index tests
  — metadata, robots, canonical, structured-data, sitemap/LLM, empty-state, and dual
  membership assertions.
- `docs/deploy.md` — explicit apply, pre/post verification, backup, rebuild, and
  rollback procedure for this catalog operation.

No homepage, footer, product card, price, variant, inventory, image, checkout, Inbox,
IMAP, SMTP, consent, analytics, or legal file should change.

### Production data expected to change

- Insert exactly three `product_category` records with the new names, handles,
  descriptions, and `is_active: true`, unless an exact compatible handle already
  exists.
- Insert exactly one missing relationship between the existing Retatrutide product ID
  and the GLP-1-Forschung category ID. Its existing Stoffwechsel-Forschung relationship
  and every other product-category relationship remain present.
- Do not insert or update a product row, variant, price, inventory item/level, image,
  option, sales channel, metadata value, or product description.

## Safe idempotent application design

1. Query all categories with `id,name,handle,description,is_active` and products for
   exact handle `retatrutide` with existing category IDs.
2. Require exactly one Retatrutide result. Require it to be the repository-owned demo
   product (`metadata.demo === "true"`) before changing its relationship. Abort before
   writes on zero, multiple, or non-owned matches; never create a product.
3. For each desired category, resolve by exact handle. If absent, create it through
   Medusa's `createProductCategoriesWorkflow` with explicit name, handle, description,
   and active status. If present, require its name to match; log and reuse a compatible
   record. Abort on handle/name collision rather than rename or overwrite live data.
4. Re-query after category creation so IDs come from persisted records and verify there
   is exactly one record per desired handle.
5. Compute Retatrutide's assignment as a set union of every existing category ID plus
   the GLP-1 category ID. If GLP-1 is already present, perform no product update. If
   missing, call `updateProductsWorkflow` with the full union. Immediately re-query and
   assert that every before-ID plus GLP-1 is present. This makes the operation additive
   despite the workflow's replacement-shaped `category_ids` input.
6. Never call the product-creation workflow. Never pass product fields other than the
   relationship selector/update required by Medusa.
7. Run the same operation twice against local data and prove the second pass reports no
   creations or relationship updates.

## Product counts and storefront behavior

Counts come from `listProducts({ categoryId })`, which asks Medusa for products linked
to that category; they do not sum inventory and do not touch pricing. Retatrutide is one
existing product linked to two categories, so it contributes one card/count to each of
GLP-1-Forschung and Stoffwechsel-Forschung. The global `/produkte/` query still returns
the product once because no duplicate product record exists. Peptid-Stacks and
Laborbedarf each return `[]` and render zero cards.

Category discovery should shape `{ category, products }` once per category at build
time and reuse `products.length` for robots, JSON-LD, sitemap/LLM eligibility, and
tests. Avoid inventory-derived or variant-derived category counts.

## Tasks

### 1. Pin definitions and additive relationship logic

Files: `backend/apps/backend/src/lib/catalog-categories.ts`,
`backend/apps/backend/src/lib/__tests__/catalog-categories.unit.spec.ts`

- [ ] Define the three exact category records and expose pure validation/union helpers.
- [ ] Test stable handles, unique names/handles, conservative copy, collision failure,
      preservation of all prior IDs, deduplication, and no-op behavior when GLP-1 exists.
- [ ] Add no package or dependency.

### 2. Add the idempotent Medusa operation and preserve seed convergence

Files: `backend/apps/backend/src/scripts/expand-product-categories.ts`,
`backend/apps/backend/src/scripts/seed-peptides.ts`

- [ ] Implement the preflight-first workflow above with explicit logs and post-write
      verification.
- [ ] Change the seed's category field to a category-name array and Retatrutide to the
      two approved names. Leave all product, variant, price, inventory, image, copy, and
      metadata definitions byte-for-byte unchanged otherwise.
- [ ] Ensure other products keep exactly their current single category definitions.
- [ ] Confirm no migration and no automatic deploy hook is added.

### 3. Add data-driven empty-category SEO and rendering

Files: `storefront/src/components/Seo.astro`,
`storefront/src/layouts/BaseLayout.astro`,
`storefront/src/pages/kategorie/[handle].astro`

- [ ] Add a narrowly typed `noindexFollow` path; reject/avoid conflicting robot props
      and keep every existing `noindex` call rendering `noindex, nofollow` unchanged.
- [ ] Set `noindex, follow` only when the category product array is empty.
- [ ] Replace the current empty sentence with the approved factual wording and preserve
      links to all other categories plus `/produkte/`.
- [ ] Always retain breadcrumbs and a self-canonical; emit CollectionPage/ItemList only
      for populated categories and retain truthful breadcrumb structured data.
- [ ] Add the three curated German metadata records.

### 4. Keep discovery signals consistent with inventory-backed membership

Files: `storefront/src/lib/content-index.ts`, and
`storefront/src/pages/api/search.json.ts` only if separation is necessary

- [ ] Make indexable category entries dependent on category membership count, not a
      hard-coded handle list.
- [ ] Exclude empty categories from `sitemap-pages.xml` and `llms.txt` through the shared
      content-index interface; add no robots.txt disallow.
- [ ] Decide explicitly in code whether on-site search retains empty categories as
      navigational results. Prefer retention for user navigation while keeping sitemap and
      LLM discovery filtered, provided this does not duplicate filtering logic.
- [ ] Confirm the homepage remains at four curated category cards, `/produkte/` renders
      all seven categories, and the footer remains unchanged.

### 5. Add focused storefront regression coverage

Files: `storefront/src/lib/metadata-output.test.ts` plus a focused category test file
and any existing discovery-output test that owns the invariant

- [ ] Pin all three handles, titles, descriptions, and exact canonicals.
- [ ] With a deterministic catalog snapshot, assert GLP-1 is indexable, has one
      Retatrutide item, emits CollectionPage + BreadcrumbList, and appears in sitemap and
      `llms.txt`.
- [ ] Assert both empty categories render `noindex, follow`, no product cards, no fake
      claims/counts/coming-soon copy, no CollectionPage, useful links, and no sitemap or
      `llms.txt` entries.
- [ ] Assert Retatrutide appears once globally and once in each approved category,
      without any changed variant, price, inventory, image, or product content fields.
- [ ] Assert existing `noindex` pages retain `noindex, nofollow` and existing populated
      category SEO/structured data remains unchanged.

### 6. Document controlled application and rollback

File: `docs/deploy.md`

- [ ] Record that this is live Medusa data applied by an explicit exec command, not a
      migration, seed-on-deploy, or manual SQL operation.
- [ ] Before application, capture a timestamped `pg_dump`; record the three desired
      handle query results, exact Retatrutide product ID, all pre-existing category IDs,
      product count, variant IDs, price values, inventory values, images, and current
      category relationships through read-only Medusa/admin API checks.
- [ ] Apply only from the verified `main` release using the documented script command,
      then run it a second time to prove idempotence.
- [ ] Re-query and compare all protected fields, verify exactly three category records
      and one additive relationship, then run the normal scripted storefront deploy/rebuild
      so static pages reflect Medusa.
- [ ] For rollback, first remove only the GLP-1 relationship from Retatrutide while
      preserving its complete pre-change category-ID set; then delete only the three
      category records created by this operation and only after verifying they have no
      unexpected products. Never delete a populated/conflicting category. Rebuild the
      storefront afterward.
- [ ] If verification shows broader or ambiguous data changes, stop and restore the
      pre-operation database dump rather than improvising SQL edits. A code rollback alone
      does not roll back catalog data.

### 7. Verify the finished implementation before any release decision

Files: no new files; verification only

- [ ] Run focused backend tests, then the full backend gate:

  ```bash
  cd backend
  npm run test --workspace=@dtc/backend -- --runTestsByPath src/lib/__tests__/catalog-categories.unit.spec.ts
  npm run lint
  npm run build
  npm run test
  ```

- [ ] Start local Medusa, take a before snapshot, run the new category script twice,
      and compare relationships and every protected Retatrutide field.
- [ ] Build and test the storefront against the resulting local catalog:

  ```bash
  cd storefront
  npm test
  npm run typecheck
  npm run build
  npm test
  grep -rnE '#[0-9a-fA-F]{3,8}\b' --include='*.astro' src | grep -vE '\-\-c-[a-z0-9-]+:\s*#|fill=|stroke='
  ```

- [ ] Run repository checks:

  ```bash
  git diff --check
  git status --short
  ```

- [ ] Manually inspect `/produkte/`, all seven category routes, mobile/desktop empty
      states, breadcrumbs, useful links, page source metadata/robots/JSON-LD, sitemap,
      `llms.txt`, and search. Confirm ordering remains unavailable.
- [ ] Before any later commit, confirm `git status --short` contains no foreign or
      unexplained changes and run the relevant full quality gates again.

## Conflicts and decisions requiring awareness

1. **Approved spec versus seed convergence:** the spec originally named only the new
   operational script, but the existing seed would later erase Retatrutide's additive
   category. This plan adds a minimal `seed-peptides.ts` relationship-definition change
   to make the approved result durable. It changes no product content or commerce data.
2. **Approved spec verification versus empty-page SEO:** the spec's first draft said all
   three new routes would be indexable and in discovery outputs. The user's approval
   explicitly requires an SEO decision rather than that assumption. This plan selects
   data-driven `noindex, follow` and discovery exclusion for the two empty categories;
   GLP-1 is indexable because it has a real relationship.
3. **Current empty-state copy:** it says `aktuell keine Produkte verfügbar`, where
   `verfügbar` can imply stock. The approved restriction calls for no availability
   invention, so the plan changes it to `derzeit keine Produkte gelistet`.
4. **Production state is not available from repository inspection:** the repo proves
   intended seed state, not the exact live category IDs, descriptions, duplicate state,
   or Retatrutide relationships. The apply script must preflight and abort on conflicts;
   production read-only verification is mandatory before mutation.
5. **README drift:** `README.md` still describes a removed site-wide pre-launch gate.
   It is unrelated and must not be edited opportunistically in this feature.

## Completion boundary

Implementation is complete only when local data proves idempotence and additive
membership, both application quality gates pass, empty-page crawl signals are
consistent, protected Retatrutide fields are unchanged, and the working tree contains
only understood feature changes. Commit, push, merge, production data application, and
deployment remain separate later decisions.
