# Spec: COA-Nachschlagewerkzeug (`/coa-pruefen/`)

- **Date:** 2026-08-06
- **Status:** **Approved 2026-08-06** with the decisions recorded in §15. No
  implementation has been written; the plan is
  `docs/plans/2026-08-06-coa-checker.md`.
- **Branch:** `feat/coa-checker` (worktree off `origin/main` @ `9c98d51`)
- **Author context:** audit of the live catalog and the production server was
  performed against release `9c98d51727cfb3165ba93c1c644febf38f072c3e`.

---

## 1. Audit — what actually exists today

This section is the reason the rest of the spec is shaped the way it is. Every
statement below was verified against this repository and the production system,
not assumed.

### 1.1 Certificate-related routes that exist

| Route | What it is | Indexed |
| ----- | ---------- | ------- |
| `/wissen/reinheit-und-coa/` | Editorial article: what a COA contains, how to read HPLC/MS values. The header's "Zertifikate" link points here. This is the de-facto certificate hub. | yes |
| `/qualitaet-analyse/` | Explanatory page with anchors `#chargendokumentation`, `#coa`, `#hplc`, `#massenspektrometrie`. Describes what analytical documentation means; links nothing. | yes |
| `/wissen/lexikon/coa/`, `/hplc/`, `/massenspektrometrie/`, `/reinheit/` | Glossary definitions. | yes |
| `/coa-pruefen/` | **Does not exist.** Production returns 404; no reference anywhere in the repo. | — |

There is no route today that answers "does documentation exist for *this*
product in *this* pack size".

### 1.2 The `/tools/` COA card

`storefront/src/pages/tools.astro:11-15`:

```
title: "COA-Zertifikat"
text:  "Verfügbare Analysezertifikate je Produkt und Packgröße prüfen."
href:  "/qualitaet-analyse/"
```

The destination is a **functional page, not a placeholder and not a missing
route** — but it does not do what the card promises. `/qualitaet-analyse/`
explains how to read a certificate; it does not show which certificates exist
per product and pack size. The card's promise is precisely the gap this spec
fills.

**Separate defect found during this audit:** the same file points the
`Stack-Builder` card at `/produkte/` (`tools.astro:25`), not at
`/stack-builder/`. The tools page was authored before the Stack Builder merged,
so the link was never updated. The `Vergleichstool` card also points at
`/produkte/`. See §7.1.

### 1.3 Product and variant metadata — production, verified

Queried live via the store API on the server (6 products, 11 variants):

```
product.metadata = {
  demo:          "true",
  purity:        ">99%",         // identical on all six products
  coa_status:    "verfügbar",    // identical on all six products
  data_status:   "placeholder",
  research_code: "PEK-BPC157"    // per product
}
variant.metadata = null          // on every one of the 11 variants
variant.sku      = "PEK-BPC157-5mg"   // present and stable on every variant
product.thumbnail = null, product.images = []
```

### 1.4 Documents — there are none

| Checked | Result |
| ------- | ------ |
| `/var/lib/peptides/static` (the configured upload dir) | exists, **0 files** |
| `https://api.peptideeinkaufen.de/static/` | **404** |
| Medusa `file` table | **does not exist**; no file/upload/document/batch/certificate tables in `medusa_peptides` |
| PDFs or COA assets in the repo | none |
| PDFs in the built storefront | none |
| Batch / lot / charge identifier in any field | **none anywhere** — not in product metadata, not in variant metadata, not as a model |
| Analysis date, lab name, HPLC value, LC-MS value as structured data | **none** — the only purity datum is the placeholder string `">99%"` |

The file module *is* configured (`backend/apps/backend/medusa-config.ts:137-177`,
`@medusajs/medusa/file-local`, upload dir `/var/lib/peptides/static`, public base
`https://api.peptideeinkaufen.de/static`), so a document could be stored. Nothing
has been.

### 1.5 The central finding

**`coa_status: "verfügbar"` is a placeholder string with no document behind it.**

It is seeded by `backend/apps/backend/src/scripts/seed-peptides.ts:118-121`,
whose own header comment states that every purity value, COA status and price is
a placeholder to be replaced before launch. The product page renders it verbatim
as the specs row **"COA-Zertifikat: verfügbar"**
(`storefront/src/pages/produkte/[handle].astro:175-176`).

That row is a public, unqualified claim that a certificate is available, on a
site where zero certificates exist. It predates this work and is out of scope to
change here, but it directly constrains this feature:

> **The checker must never read, echo, or derive anything from `coa_status`.**
> Doing so would industrialise a false availability claim into a tool whose whole
> purpose is factual lookup.

See §9 for the recommendation to fix the product-page row separately.

### 1.6 Catalog-loading utilities available for reuse

- `lib/catalog.ts` — `listProducts()`, `listProductsInSourceOrder()`,
  `listCategories()`, `filterProducts()`, `isProductAvailable()`.
- `lib/variant-availability.ts` — `isVariantAvailable(variant)`.
- `lib/build-catalog.ts` — build-time snapshot; the storefront is **static** and
  reads the catalog in `getStaticPaths`/frontmatter at build time only.
- `lib/content-index.ts` — single source for both sitemaps and `llms.txt`.
  `staticEntries()` feeds `sitemap-pages.xml`; `allStaticEntries()` feeds
  `llms.txt`; `categoryEntries()` already demonstrates **data-driven index
  inclusion** by filtering out categories with no products.
- `lib/search.ts` — `foldSearchText()`, `searchTerms()` for accent-insensitive
  client-side matching. No new dependency needed for product search.
- `components/Seo.astro` — owns `noindex` / `noindexFollow` / `jsonLd`.

### 1.7 Public vs. authenticated document access

The file provider publishes to `https://api.peptideeinkaufen.de/static/<key>`:
public, unauthenticated, no directory listing observed (404 on the bare path).
Caddy sets `X-Robots-Tag: noindex, nofollow` on the whole `api.` host, so a
stored document would not be indexed. `robots.txt` disallows `/api/` and
`/account/` on the storefront host only.

No document exists, so **no document currently exposes personal, confidential,
storage or infrastructure information**. The exposure question is therefore
forward-looking and is answered as a constraint in §6.

---

## 2. Goal

Give a visitor a factual, server-rendered way to look up **whether analysis
documentation is linked to a real catalog product and pack size**, to open that
document when one is linked, and to reach the right explanatory or support page
when one is not.

The tool reports what is stored. It performs **no** authenticity, validity,
currency or applicability check, and says so on the page.

## 3. Route, and a note on its name

- **Route:** `/coa-pruefen/`
- **Canonical:** `https://peptideeinkaufen.de/coa-pruefen/`

"Prüfen" in German covers "to look up / to examine" as well as "to verify". On a
page about certificates, the second reading is a legal and factual risk. The
route is kept as requested, and the risk is neutralised in copy, which is
binding on the implementation:

- The H1 says *nachschlagen*, not *prüfen*.
- The lead paragraph states in one sentence that the tool shows stored
  documentation and performs no authenticity check.
- No control, heading, status string or meta text may use *geprüft*, *verifiziert*,
  *bestätigt*, *gültig*, *echt*, *zertifiziert durch uns*, or *freigegeben*.

## 4. Scope — first release

Supported because real data supports it:

1. **Select a real product** — all products from `listProducts()`, addressed by
   `handle`. Client-side filter over title, `research_code` and `handle` via the
   existing `foldSearchText`/`searchTerms` helpers.
2. **Select a real variant** — the product's real "Packgröße" variants, labelled
   by variant title (e.g. `10 mg`), with `sku` shown as the stable public
   identifier.
3. **Report document status for that exact variant** — one of the six states in
   §5, derived only from the document contract in §6.
4. **Open the actual linked document** — a plain anchor to the stored URL, only
   when one is stored and passes the origin allowlist in §6.3.
5. **Show stored document metadata, only when present** — document type, analysis
   date, batch/lot identifier. Absent fields are named as absent; nothing is
   inferred, back-filled or formatted into existence.
6. **Navigate onward** — `/wissen/reinheit-und-coa/` (hub), `/qualitaet-analyse/`,
   the selected product page, `/support/anfrage/`.

**With today's data every product/variant resolves to state (b), "no document
linked".** That is the honest answer and the page must present it as such,
without apology, hedging or a promise that documents are coming.

## 5. Required states

| # | State | Trigger | Rendered as |
| - | ----- | ------- | ----------- |
| a | Document available | variant has a valid document URL per §6 | Document type, date, batch if stored; a labelled link to the document; explicit note that the document is stored documentation, not a verification result |
| b | No document linked | variant exists, no document URL | "Zu dieser Packgröße ist derzeit keine Analysedokumentation hinterlegt." + link to `/support/anfrage/` and `/qualitaet-analyse/` |
| c | Product unavailable | requested product not in the catalog | "Dieses Produkt ist im aktuellen Katalog nicht vorhanden." + link to `/produkte/`. **No nearest-match substitution.** |
| d | Variant unavailable | product exists, requested pack size not among its variants | "Diese Packgröße ist für dieses Produkt nicht im Katalog." + list of the pack sizes that do exist |
| e | Metadata incomplete | document URL present, but type/date/batch missing | Document is still offered; each missing field is named as *nicht hinterlegt*. Never invented, never inherited from the product or another variant |
| f | Catalog temporarily unavailable | build-time catalog load yields zero products | Explanatory block instead of a selector; page forced `noindex, follow`; links to `/produkte/` and `/support/anfrage/` |

Hard rule across all states: **no silent substitution.** A document attached to
product A, variant X is shown for product A, variant X and nothing else. No
product-level fallback, no sibling-variant fallback, no batch guessing.

## 6. Data contract and security

### 6.1 Source

The existing Medusa catalog, read at build time through `lib/catalog.ts`. No
second catalog, no hand-maintained document list, no JSON file of products
checked into the repo.

### 6.2 Document fields — variant-level only

The storefront reads a documented, additive **variant** metadata contract:

| Key | Type | Meaning | Required for state (a) |
| --- | ---- | ------- | ---------------------- |
| `coa_document_url` | string, absolute URL | The stored document | **yes** |
| `coa_document_type` | string | e.g. `COA`, `HPLC`, `LC-MS` | no → state (e) |
| `coa_analysis_date` | string, `YYYY-MM-DD` | Date on the document | no → state (e) |
| `coa_batch` | string | Batch / lot identifier as printed on the document | no → state (e) |

Rationale for variant-level only: analytical documentation is batch-bound
(`/qualitaet-analyse/#chargendokumentation` says so on this very site), and a
product-level document rendered under a selected pack size is exactly the silent
substitution this spec forbids. A document that genuinely covers several pack
sizes is attached to each variant it covers.

**Populating these fields is an admin data task and is explicitly out of scope
here.** This spec ships the reader, not the data. No seed script is modified; no
document record is created; `metadata.demo`, `data_status` and `coa_status` are
left untouched.

`coa_status` is ignored entirely, per §1.5.

### 6.3 URL safety

- A document URL is rendered only if it parses as an absolute `https:` URL whose
  origin is on an allowlist: the configured file backend origin
  (`https://api.peptideeinkaufen.de`) or the site origin. Anything else —
  `http:`, `file:`, a relative path, a foreign host — is treated as state (b)
  and reported as no document, not as a broken link.
- Links carry `rel="noopener noreferrer"`, and the visible link text names the
  document type and the product/pack size rather than echoing the raw URL or
  filename.
- The URL is not exposed anywhere except the `href`.

### 6.4 What must not be exposed

Server paths, upload directories, storage keys beyond what the public URL
already contains, credentials, internal IPs, database IDs. In particular the
page addresses products by `handle` and variants by pack-size title plus `sku` —
`prod_…` / `variant_…` identifiers are **not** rendered into the DOM, since
nothing here needs them. (The Stack Builder does emit variant IDs because its
preset payloads require exact resolution; this tool has no such need.)

### 6.5 Before any real document is attached

A COA PDF can carry a customer name, an order reference, a supplier's internal
identifiers or a lab's client field. The spec therefore records a precondition
for the *data* work that follows: each document is reviewed for personal and
confidential content before it is uploaded, and it is published only if it
contains none. Public unauthenticated hosting is acceptable **only** under that
condition; if any document must stay restricted, that is a separate spec for a
proxied, access-controlled route — not a quiet change to this one.

### 6.6 No query-parameter state

Selection lives in JavaScript state only. The site is statically built, so a
`?produkt=…` URL would serve byte-identical HTML — the robots directive could not
vary per parameter, which is precisely the faceted-duplicate trap `AGENTS.md`
warns about. No `history.pushState`, no deep links, no canonical conflict.

## 7. Navigation changes — the minimum

### 7.1 `/tools/`

- Repoint the **COA-Zertifikat** card from `/qualitaet-analyse/` to
  `/coa-pruefen/`, and only while `/coa-pruefen/` exists. Card text stays factual:
  "Nachschlagen, ob zu Produkt und Packgröße Analysedokumentation hinterlegt ist."
- **Fix the stale Stack-Builder card** (`/produkte/` → `/stack-builder/`). Found
  during this audit, unrelated to the checker, one line, and it currently sends
  a visitor looking for the Stack Builder to the catalog listing. Bundling it
  here avoids a second near-identical change to the same file. If the reviewer
  prefers it separate, it is trivially separable.
- The `Vergleichstool` card also points at `/produkte/`; that one is arguably
  correct (the listing does compare) and is **left alone**.

### 7.2 Product pages

Add one link in the specs block: "Analysedokumentation nachschlagen" →
`/coa-pruefen/`. No change to the `COA-Zertifikat` row's value in this spec — see
§9.

### 7.3 Certificate and quality pages

- `/qualitaet-analyse/` §COA: one sentence linking to the tool.
- `/wissen/reinheit-und-coa/`: one link in the closing section.

### 7.4 Header

**No new main-header link.** The header already carries "Zertifikate" and
"Tools"; a third certificate-adjacent entry is not justified for a tool that
currently has no documents to show.

### 7.5 Sitemap and `llms.txt`

Both derive from `lib/content-index.ts`. The entry is added to `STATIC_ROUTES`
but gated by the same predicate as the robots directive (§8), mirroring how
`categoryEntries()` already withholds empty categories from both surfaces.

## 8. SEO

| Item | Value | Justification |
| ---- | ----- | ----------- |
| Title | `COA nachschlagen: Analysedokumentation je Packgröße` | 51 chars, unique, states the function without claiming verification. `Seo.astro` appends the brand suffix. |
| Meta description | `Nachschlagen, ob zu einem Produkt und einer Packgröße im Katalog Analysedokumentation hinterlegt ist. Keine Echtheits- oder Qualitätsprüfung.` | 140 chars; the second sentence is the disclaimer, so the limitation survives into the SERP snippet. |
| H1 | `Analysedokumentation zu Produkt und Packgröße nachschlagen` | Matches intent, avoids *prüfen*, exactly one H1. |
| Canonical | `https://peptideeinkaufen.de/coa-pruefen/` | Self-referencing, via `canonicalUrl()`. No cross-URL canonical. |
| Robots | **`noindex, follow` while zero variants have a linked document; indexable once at least one does** — computed at build time from the same predicate | Recommended below. |
| Sitemap | `sitemap-pages.xml`, `changefreq: weekly`, `priority: 0.75` (tool tier, alongside `/peptid-rechner/` and `/stack-builder/`) — **included only when indexable** | A URL that is `noindex` does not belong in a sitemap; the existing empty-category handling sets this precedent. |
| `llms.txt` | Included under `## Seiten`, **only when indexable**, exactly once | Same predicate, same reason. Draft filtering already lives in `content-index.ts` and nowhere else. |
| Structured data | `BreadcrumbList` always. `ItemList` **only** when documents are visibly listed, enumerating exactly those documents. | Both are supported by visible content under those conditions. |
| Forbidden schema | No `Product`, `Offer`, `AggregateOffer`, `Review`, `AggregateRating`, and no verification-flavoured type (`ClaimReview` and similar). Also no `WebApplication`: the Stack Builder uses it, but the brief limits this page to Breadcrumb/ItemList and the page is a lookup surface, not an application. | |

### Why conditional indexability is the right call

The page's entire promise is "find the documentation for this product". Today it
answers "none" for all 6 products and all 11 variants. Indexing that means
competing for certificate queries with a page that cannot satisfy one — thin,
mismatched, and the kind of thing that costs site-level trust in a niche where
organic search is the main channel. The mechanism already exists in this
codebase for exactly this situation: an empty category renders
`noindexFollow={products.length === 0}` and is filtered out of
`categoryEntries()`. This reuses that pattern, is self-correcting the moment the
first real document is attached, and needs no follow-up ticket to remember.

The alternative — index immediately on the strength of the explanatory copy —
was considered and rejected: the explanatory content already exists at
`/qualitaet-analyse/` and `/wissen/reinheit-und-coa/`, both indexed, so an
indexable third page covering the same ground is a near-duplicate with a broken
promise attached.

## 9. The product page's COA row — corrected in this task

**Approved (decision 3, §15).** `produkte/[handle].astro` renders
**"COA-Zertifikat: verfügbar"** from placeholder metadata while no certificate
exists (§1.5). That row is removed and replaced by output from the same resolver
and validation contract the checker uses (§6):

- A valid document for an exact pack size → factual linked-document state.
- No valid document for that pack size → *"Für diese Packgröße ist derzeit kein
  Analysedokument verknüpft."*
- Missing or ambiguous metadata → no fallback to another variant, product or
  batch.
- `metadata.coa_status` is never read again, on either surface.

Because ordering is closed, `AddToCart.astro` renders pack sizes as a plain list
with no variant selection (`AddToCart.astro:38-58`), so there is no "selected
variant" on a product page. The row is therefore replaced by a **per-pack-size
document list** — one honest line per real variant — which reads correctly with
and without JavaScript and does not change behaviour when `ORDERS_ENABLED` is
eventually flipped.

**Boundary:** this is a targeted correction, not a product-data cleanup.
`metadata.purity` (`">99%"`, flagged by `data_status: "placeholder"`) keeps
rendering exactly as it does today. It is recorded in §15 as a separate
follow-up audit and is **never** used by the checker or the product-page
document row as evidence of an analysis result.

## 10. Non-goals

Explicitly out of scope, and not to be added during implementation:

- Certificate verification, authentication, validation, approval or rejection —
  automated or otherwise.
- Invented certificates, document records, purity, HPLC or LC-MS values.
- Any authenticity, validity, quality, currency or applicability guarantee.
- Upload, OCR, document parsing, or content extraction of any kind.
- Customer accounts, saved checks, history, or any persistence beyond in-page state.
- Medical, therapeutic, dosage, administration or consumption guidance.
- Catalog mutations, seed changes, certificate creation, backend schema changes.
- Ordering, cart or checkout changes of any kind. `ORDERS_ENABLED` is not touched.
- A framework runtime or any new dependency. The audit found none needed: plain
  `.astro` plus a small native `<script>`, as in `StackBuilder.astro`.
- A new main-header navigation link.
- Query-parameter or deep-linkable selection state.

## 11. Files this will touch

| File | Change |
| ---- | ------ |
| `storefront/src/pages/coa-pruefen.astro` | new — route, SEO props, server-rendered intro, breadcrumb, JSON-LD |
| `storefront/src/components/CoaLookup.astro` | new — server-rendered table + progressive selector, scoped styles, native script |
| `storefront/src/lib/coa-documents.ts` | new — metadata contract reader, URL allowlist, state resolution, `hasAnyLinkedDocument()` predicate |
| `storefront/src/lib/coa-documents.test.ts` | new — unit tests for the model and every state |
| `storefront/src/lib/coa-lookup-output.test.ts` | new — source and built-HTML assertions |
| `storefront/src/lib/content-index.ts` | conditional `STATIC_ROUTES` entry driven by the predicate |
| `storefront/src/pages/tools.astro` | COA card → `/coa-pruefen/`; stale Stack-Builder card → `/stack-builder/` |
| `storefront/src/pages/produkte/[handle].astro` | replace the `coa_status` specs row with per-pack-size resolver output; add one link to the tool |
| `storefront/src/pages/qualitaet-analyse.astro` | one link in the COA section |
| `storefront/src/content/wissen/reinheit-und-coa.md` | one link |
| `docs/plans/2026-08-06-coa-checker.md` | new — written after this spec is approved |

Not touched: anything under `backend/`, `package.json`, any lockfile,
`deploy/`, `astro.config.mjs`, consent, legal, inbox, cart, checkout.

## 12. UX and accessibility

- **Server-rendered first.** The full product → pack-size → status table is in
  the HTML. Without JavaScript the page is complete and useful: every product,
  every pack size, every document status, every link. JS only adds search
  filtering and the focused single-result view, following the
  `data-static-variants` / `.js-control` pattern already used by
  `StackBuilder.astro`.
- **Keyboard-operable:** native `<input type="search">`, `<button>`, `<select>`
  and `<a>` only. No custom widgets, no `div` with a click handler, no focus
  traps. Visible focus states from the existing token set.
- **Announcements:** a single `role="status" aria-live="polite"` region reports
  the resolved state in words ("Für BPC-157, 5 mg ist keine Analysedokumentation
  hinterlegt."). Announcements are text, never colour or icon alone.
- **Mobile:** no horizontal overflow at 320 px; the status table scrolls inside
  its own `overflow-x: auto` container rather than the page body. No
  `position: fixed`; any sticky element reverts to static on short and narrow
  viewports, as the Stack Builder summary does.
- **Design tokens only** — `var(--c-*)`, no raw hex, per the repo rule.

## 13. Verification

### Commands

```bash
cd storefront
npm run typecheck          # astro check — zero errors
npm run build              # backend must be running on :9000 first
npm test                   # full suite, including the new files
node --test src/lib/coa-documents.test.ts src/lib/coa-lookup-output.test.ts
grep -rnE '#[0-9a-fA-F]{3,8}\b' --include='*.astro' src \
  | grep -vE '\-\-c-[a-z0-9-]+:\s*#|fill=|stroke='   # must print nothing
git diff --check
```

### Required tests

Route, metadata and discovery:

1. The route is exactly `/coa-pruefen/` and the built page's canonical is
   `https://peptideeinkaufen.de/coa-pruefen/`.
2. Robots: `noindex, follow` while no variant has a linked document; indexable
   when one does. Both directions asserted against a fixture catalog.
3. `/coa-pruefen/` appears in `sitemap-pages.xml` and in `llms.txt` **exactly
   once**, and only in the indexable case; in the non-indexable case it appears
   in neither.
4. Exactly one `<h1>`; title, description and H1 match the strings in §8.

Data correctness:

5. Products, variants, pack sizes and SKUs come from the real Medusa loaders —
   no hard-coded product list, no fixture data in the shipped page.
6. Document-available state renders the stored URL, type, date and batch, and
   nothing that was not stored.
7. No-document state renders the factual message and the support link.
8. Missing product → state (c); missing variant → state (d) with the real pack
   sizes listed.
9. Empty catalog → state (f), and the page is `noindex, follow`.
10. Incomplete metadata → the document is still offered and each missing field is
    named as absent; no field is inherited from the product or another variant.
11. **Safe matching:** a document on variant X is never rendered for variant Y,
    for another product, or for another batch. Asserted with a fixture where
    exactly one variant of a multi-variant product carries a document.
12. `coa_status` is not read anywhere in the feature's source.

Claims and schema:

13. No invented certificate, purity, HPLC or LC-MS value appears in the source
    or the built HTML.
14. No authenticity, validity or quality guarantee wording: the source matches
    none of `/geprüft|verifiziert|bestätigt|garantiert|gültig|echt|authentisch|freigegeben/i`
    outside an explicit disclaimer sentence.
15. No upload control, no file input, no OCR, no parsing, no automated
    approval/rejection path exists in the source.
16. Structured data contains `BreadcrumbList`, contains `ItemList` only when
    documents are listed, and contains none of `Product`, `Offer`,
    `AggregateOffer`, `Review`, `AggregateRating`.
17. No medical, therapeutic, dosage or administration wording.

Accessibility, no-JS and mobile:

18. Controls are native elements; the live region is `role="status"
    aria-live="polite"` and receives the resolved-state text.
19. The server HTML lists every product, pack size and document status without
    JavaScript, and the JS-only controls are `hidden` until the script runs.
20. No `position: fixed`; sticky elements revert to static at short/narrow
    viewports; the wide table sits in an `overflow-x: auto` container.

Security and non-regression:

21. Document links are rendered only for allowlisted `https:` origins; `http:`,
    `file:`, relative and foreign-host URLs resolve to the no-document state.
22. No server path, upload directory, credential, internal IP or Medusa
    `prod_…`/`variant_…` identifier appears in the built HTML.
23. `/wissen/reinheit-und-coa/`, `/qualitaet-analyse/`, `/wissen/lexikon/coa/`
    and all product routes keep their existing canonical, robots directive and
    schema — asserted against the built output.
24. No catalog, cart, checkout or ordering mutation: the feature's source
    matches none of `/addLine|createLineItem|lib\/cart|\/kasse\/|data-add-to-cart|ORDERS_ENABLED/`,
    and no file under `backend/` is modified.

### Manual checks

- `/coa-pruefen/` at 320 px, 390 px and 1440 px: no horizontal page scroll.
- Keyboard-only pass: search, select a product, select a pack size, open a
  document link, reach every onward link. Focus visible at every stop.
- With JavaScript disabled: the page still answers the question for all six
  products.
- Screen-reader pass on the live region announcing a state change.

## 14. Open questions — all resolved

The four questions raised in the draft were answered on 2026-08-06; see §15.

## 15. Approved decisions (2026-08-06)

1. **Conditional indexability — approved.** Route stays `/coa-pruefen/`,
   canonical `https://peptideeinkaufen.de/coa-pruefen/`. Zero valid linked
   documents → `noindex, follow`, absent from `sitemap-pages.xml`, absent from
   `llms.txt`. At least one valid linked document → `index, follow`, present
   exactly once in each. **One shared build-time predicate drives all three**,
   counting only documents that pass the document validation and origin
   allowlist — never `metadata.coa_status` or any other placeholder field.
2. **Tools page — approved in this task.** COA card → `/coa-pruefen/`;
   Stack-Builder card corrected `/produkte/` → `/stack-builder/`; the checker
   keeps a contextual link to `/qualitaet-analyse/`. Focused regression tests for
   both destinations. No new main-header item.
3. **Product-page COA row — corrected in this task** using the shared resolver;
   see §9. `metadata.coa_status` is no longer evidence of anything.
4. **Route terminology — `/coa-pruefen/` kept.** Visible language is limited to
   *Analysedokumentation nachschlagen*, *Dokumentstatus anzeigen*, *verknüpftes
   Dokument öffnen*. The page must never describe itself as authenticating,
   validating, approving, certifying or independently verifying a COA, and it
   carries a concise visible clarification that it only displays documents
   linked in the catalog and does not verify their authenticity or their
   applicability to another batch or pack size.

### Follow-up recorded, not done here

`metadata.purity` (`">99%"` on all six products, `data_status: "placeholder"`)
needs a separate data-quality audit. It is out of scope for this task, keeps
rendering as it does today, and is never read by the checker or the product-page
document row as evidence of an analysis result.
