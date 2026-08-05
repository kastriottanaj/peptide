# Implementation Plan — COA-Nachschlagewerkzeug (`/coa-pruefen/`)

- **Date:** 2026-08-06
- **Status:** plan drafted — implementation not started
- **Approved spec:** `docs/specs/2026-08-06-coa-checker.md` (approved with the
  decisions in its §15)
- **Branch:** `feat/coa-checker`, worktree off `origin/main` @ `9c98d51`
- **Owner:** storefront

---

## Fixed public contract

| Item | Value |
| ---- | ----- |
| Route | `/coa-pruefen/` |
| Canonical | `https://peptideeinkaufen.de/coa-pruefen/`, via `canonicalUrl(Astro.url)` — never hard-coded |
| Title | `COA nachschlagen: Analysedokumentation je Packgröße` |
| Description | `Nachschlagen, ob zu einem Produkt und einer Packgröße im Katalog Analysedokumentation hinterlegt ist. Keine Echtheits- oder Qualitätsprüfung.` |
| H1 | `Analysedokumentation zu Produkt und Packgröße nachschlagen` |
| Robots | `noindex, follow` while zero valid documents; `index, follow` once ≥ 1 — from the shared predicate |
| Sitemap | `sitemap-pages.xml`, `weekly`, priority `0.75` — only when indexable, exactly once |
| `llms.txt` | `## Seiten` — only when indexable, exactly once |
| On-site search | Always present (see Task 4, note) |
| Structured data | `BreadcrumbList` always; `ItemList` only when real linked documents are visibly listed |
| Forbidden schema | `Product`, `Offer`, `AggregateOffer`, `Review`, `AggregateRating`, `WebApplication`, and any verification/certification type |

**Permitted visible verbs:** *Analysedokumentation nachschlagen*,
*Dokumentstatus anzeigen*, *verknüpftes Dokument öffnen*.
**Banned everywhere in visible copy, headings, status strings, ARIA text and
meta:** *geprüft, verifiziert, bestätigt, garantiert, gültig, echt, authentisch,
zertifiziert (durch uns), freigegeben, validiert*.

Every page carrying document status renders this clarification verbatim once:

> Dieses Werkzeug zeigt ausschließlich Dokumente an, die im Katalog verknüpft
> sind. Es prüft weder deren Echtheit noch, ob sie für eine andere Charge oder
> Packgröße gelten.

---

## Current data reality this plan is built on

Carried forward from the spec's audit and **binding on implementation**:

- Production has **zero** COA or analysis files (`/var/lib/peptides/static` is
  empty; `https://api.peptideeinkaufen.de/static/` → 404; no `file` table).
- **All eleven variants have `metadata = null`.**
- **No batch or lot model exists** anywhere in the backend.
- `product.metadata.coa_status = "verfügbar"` is placeholder data — ignored.
- `product.metadata.purity = ">99%"` is placeholder (`data_status:
  "placeholder"`) — never read as an analysis result.
- **The first production state after this ships shows "kein Analysedokument
  verknüpft" for every product and every variant, and `/coa-pruefen/` will be
  `noindex, follow` and absent from both sitemap and llms.txt.** That is the
  correct outcome, not a bug to work around.
- **No seed data, fake PDF or placeholder document may be added** to make the
  tool look populated. Fixtures live in test files only and never in a seed
  script, a page, or the catalog.

---

## Why no backend, upload, OCR, migration or dependency is required

| Capability | Why it is not needed |
| ---------- | -------------------- |
| Backend code | The reader consumes `product.variants[].metadata`, which Medusa already returns on the store product endpoint. Nothing is written. |
| Schema migration | The contract is four optional keys in the existing free-form `metadata` JSON. Medusa needs no model change to store or return them. A dedicated batch/document model becomes worth discussing only once real documents exist in volume — a future spec, explicitly not this one. |
| Upload function | Documents are attached by an administrator through the existing Medusa admin; this feature is read-only. **No public upload is created.** |
| OCR / parsing | Values are read from stored metadata fields, never extracted from document content. |
| New dependency | Search reuses `lib/search.ts` (`foldSearchText`, `searchTerms`); formatting reuses `lib/pricing.ts` conventions; DOM work is a small native `<script>` in the `StackBuilder.astro` style. No framework runtime, no client directive. |
| Backend test run | No file under `backend/` changes, so only the storefront gate applies. |

---

## Task 1 — `lib/coa-documents.ts`: the shared model and resolver

**Creates:** `storefront/src/lib/coa-documents.ts`
**Consumed by:** the checker page, the product page, `lib/content-index.ts`

### 1.1 Metadata contract (variant-level only)

Read from `variant.metadata`. Product-level document metadata is **not read at
all** — the spec forbids product-level fallback, and not reading it is the
simplest way to guarantee that.

| Key | Required | Type | Invalid → |
| --- | -------- | ---- | --------- |
| `coa_document_url` | **required** | non-empty string, absolute `https:` URL on the allowlist | whole document discarded → no-document state |
| `coa_document_type` | optional | non-empty string, trimmed, max 60 chars | field treated as absent |
| `coa_analysis_date` | optional | string matching `^\d{4}-\d{2}-\d{2}$` **and** a real calendar date | field treated as absent |
| `coa_batch` | optional | non-empty string, trimmed, max 60 chars | field treated as absent |

An invalid **optional** field never discards the document — it degrades to
"nicht hinterlegt" (state e). An invalid **required** URL discards the document
entirely (state b). Values are read only when `typeof value === "string"`;
numbers, objects, arrays and `null` are treated as absent.

### 1.2 URL validation and origin allowlist

```
ALLOWED_DOCUMENT_ORIGINS = [
  <origin of PUBLIC_MEDUSA_BACKEND_URL>,   // production: https://api.peptideeinkaufen.de
  <origin of SITE_URL>,                    // production: https://peptideeinkaufen.de
]
```

Derived at build time from the existing env-backed values in `lib/site.ts` and
`lib/medusa.ts` — not a second hard-coded list that could drift.

`isAllowedDocumentUrl(raw)` returns true only when **all** hold:

1. `new URL(raw)` parses without throwing (malformed → false).
2. `url.protocol === "https:"` — rejects `http:`, `file:`, `data:`,
   `javascript:`, `blob:`, and any other scheme.
3. The raw string does **not** start with `//` (protocol-relative).
4. `url.origin` is in the allowlist (exact origin match — host, scheme and port;
   no suffix matching, so `api.peptideeinkaufen.de.evil.test` fails).
5. No credentials in the URL (`url.username`/`url.password` empty).

Anything false → the variant resolves to **state (b), no document**. It is never
rendered as a broken link, an error, or a partially trusted entry.

### 1.3 Types and functions

```ts
export type CoaDocument = {
  url: string;            // validated, allowlisted
  type: string | null;    // null = nicht hinterlegt
  analysisDate: string | null;
  batch: string | null;
};

export type CoaVariantStatus =
  | { state: "document"; variant: CoaVariantRef; document: CoaDocument }
  | { state: "none"; variant: CoaVariantRef };

export type CoaProductEntry = {
  handle: string;
  title: string;
  researchCode: string | null;
  variants: CoaVariantStatus[];
};

export type CoaLookupModel = {
  products: CoaProductEntry[];
  documentCount: number;      // valid documents only
  catalogAvailable: boolean;  // false → state (f)
};

export function readVariantDocument(variant): CoaDocument | null;
export function resolveVariantStatus(variant): CoaVariantStatus;
export function buildCoaLookupModel(products): CoaLookupModel;
export function findProduct(model, handle): CoaProductEntry | null;         // state (c)
export function findVariant(entry, packSize): CoaVariantStatus | null;      // state (d)
export function hasLinkedDocuments(model): boolean;                          // the predicate
```

`CoaVariantRef` carries **`packSize` (variant title) and `sku` only — no
`variant.id`, no `product.id`.**

### 1.4 Exact matching, no fallback

- `findProduct` matches `handle` exactly (case-sensitive, already normalised by
  Medusa). No fuzzy match, no nearest neighbour, no redirect to a similar
  product.
- `findVariant` matches the pack-size title exactly after trimming. No
  numeric-proximity match ("5 mg" never satisfies a request for "10 mg").
- `resolveVariantStatus` reads **only** the variant handed to it. There is no
  code path in this module that reads a sibling variant, the parent product's
  metadata, or any batch registry — enforced by a test that greps the module
  source for `product.metadata` and `coa_status`.

### 1.5 Explicitly not read

`coa_status`, `purity`, `data_status`, `demo`. A unit test asserts the module
source contains none of these identifiers.

**Verify:** `node --test src/lib/coa-documents.test.ts`

---

## Task 2 — `components/CoaLookup.astro`: server HTML first, JS second

**Creates:** `storefront/src/components/CoaLookup.astro`
**Consumes:** `CoaLookupModel` from Task 1

### 2.1 Server-rendered layer (works with JavaScript off)

- A `<table>` (or definition-list grid) inside a wrapper with
  `overflow-x: auto`, listing **every** product and **every** pack size with its
  document status, the pack size, the SKU, and — where a document exists — a
  labelled link, its type, date and batch, each absent field printed as *nicht
  hinterlegt*.
- Each product row links to its product page (`/produkte/<handle>/`).
- The clarification sentence from the fixed contract, once.
- Onward links: `/wissen/reinheit-und-coa/`, `/qualitaet-analyse/`,
  `/support/anfrage/`.
- When `catalogAvailable === false` → the state (f) block replaces the table.

### 2.2 Progressive enhancement (small native script, no dependency)

Following `StackBuilder.astro`: JS-only controls carry `hidden` in the server
HTML and are revealed by the script (`.js-control`); the full static table is
hidden by the script once the interactive view is live (`data-static-table`), so
a JS user sees the focused tool and a no-JS user sees everything.

- `<input type="search">` filtering products by title, handle and
  `research_code` via `foldSearchText`/`searchTerms`.
- `<select>` (or a radio group) for the pack size of the chosen product.
- A result region rendering exactly one of states (a)–(e) for the chosen
  product + pack size.
- No `history.pushState`, no query-parameter state (the site is static; a
  `?produkt=` URL would serve identical HTML and could not carry a different
  robots directive).

### 2.3 Accessibility and keyboard

- Native `<input>`, `<select>`, `<button>`, `<a>` only. No custom widget, no
  click-handled `div`, no focus trap, no autofocus.
- One `role="status" aria-live="polite"` region announcing the resolved state in
  full words, e.g. *"Für BPC-157, 5 mg ist derzeit kein Analysedokument
  verknüpft."* Status is never conveyed by colour or icon alone; every state has
  a text label.
- Document links: descriptive text (type + product + pack size), never the raw
  filename or URL; `rel="noopener noreferrer"`.
- Visible focus styling from the existing token set; tab order follows reading
  order.

### 2.4 Mobile and styling

- No horizontal page scroll at 320 px: the wide table scrolls inside its own
  container.
- No `position: fixed`. Any sticky element reverts to `static` on short and
  narrow viewports, as the Stack Builder summary does.
- `var(--c-*)` tokens only — no raw hex (repo rule; the grep gate below enforces
  it).

---

## Task 3 — `pages/coa-pruefen.astro`: the route

**Creates:** `storefront/src/pages/coa-pruefen.astro`

- Frontmatter: `listProducts()` → `buildCoaLookupModel(products)`. A catalog
  load returning zero products sets `catalogAvailable: false`.
- Passes to `BaseLayout`: the fixed title/description, `noindexFollow={!hasLinkedDocuments(model)}`
  (mirroring `kategorie/[handle].astro`'s `noindexFollow={products.length === 0}`),
  and `jsonLd`.
- `jsonLd`: `BreadcrumbList` (`Start → COA nachschlagen`) always;
  `ItemList` **only** when `hasLinkedDocuments(model)`, enumerating exactly the
  documents visibly listed and nothing else.
- Exactly one `<h1>`, matching the fixed contract.
- Server-rendered intro explaining what analytical documentation is, that it is
  batch-bound, and what this page does and does not do — linking the existing
  `/qualitaet-analyse/#coa` and `/wissen/reinheit-und-coa/` rather than restating
  them.

---

## Task 4 — Discovery: one predicate, three surfaces

**Modifies:** `storefront/src/lib/content-index.ts`,
`storefront/src/pages/sitemap-pages.xml.ts`, `storefront/src/pages/llms.txt.ts`

`STATIC_ROUTES` is a synchronous array and the predicate needs catalog data, so
the entry is **not** added to `STATIC_ROUTES`. Instead:

```ts
/**
 * The COA checker, included only when at least one valid document is linked.
 * Same predicate as the page's robots directive, so a noindex page can never
 * appear in a sitemap or in llms.txt. Mirrors `categoryEntries()`, which already
 * withholds empty categories from both surfaces.
 */
export async function coaCheckerEntries(lastModified = buildDate()): Promise<IndexedEntry[]> {
  const model = buildCoaLookupModel(await listProducts());
  if (!hasLinkedDocuments(model)) return [];
  return [{ path: "/coa-pruefen", title: …, description: …, keywords: […],
            lastModified, changeFrequency: "weekly", priority: 0.75 }];
}

/** Always present: a valid public page, usable by on-site search even while noindex. */
export function coaCheckerSearchEntry(lastModified = buildDate()): IndexedEntry[] { … }
```

- `sitemap-pages.xml.ts`: spread `...(await coaCheckerEntries(lastModified))`
  alongside `staticEntries()` and `categoryEntries()`.
- `llms.txt.ts`: append the awaited entries to the `## Seiten` section.
- `pages/api/search.json.ts`: include `coaCheckerSearchEntry()` unconditionally.
  This is deliberate and matches `allCategoryEntries()` — "all category routes,
  including valid empty pages used by on-site search". On-site search is not
  indexing; `robots.txt` already disallows `/api/`.

**One predicate, three decisions:** `hasLinkedDocuments()` drives the page's
robots directive (Task 3), sitemap inclusion and llms.txt inclusion. It counts
only documents that survive §1.1 validation and the §1.2 allowlist, and it never
consults `coa_status`.

---

## Task 5 — Product page correction

**Modifies:** `storefront/src/pages/produkte/[handle].astro`

- Delete the `coaStatus` binding (`meta.coa_status`) and the
  `<dt>COA-Zertifikat</dt><dd>{coaStatus ?? "—"}</dd>` specs row.
- Add an **Analysedokumentation** section listing one line per real variant,
  built from `resolveVariantStatus`:
  - document → type/date/batch where stored, plus the validated link
    (`rel="noopener noreferrer"`, descriptive text, no filename);
  - no document → *"Für diese Packgröße ist derzeit kein Analysedokument
    verknüpft."*
- One link: *Analysedokumentation nachschlagen* → `/coa-pruefen/`.
- The clarification sentence, once.

**Why per-pack-size and not "the selected variant":** with `ORDERS_ENABLED`
unset, `AddToCart.astro:38-58` renders pack sizes as a plain list with no
selection control, so no selected variant exists on this page. A per-variant
list is honest in both ordering states and needs no change when ordering opens.

**Untouched on this page:** the `Reinheit` row (placeholder `purity` — separate
follow-up audit), `Packgrößen`, JSON-LD `Product`/`AggregateOffer` (they describe
merchandise and are correct there), `AddToCart`, and every ordering path.

---

## Task 6 — Tools page corrections

**Modifies:** `storefront/src/pages/tools.astro`

| Card | From | To |
| ---- | ---- | -- |
| `COA-Zertifikat` | `/qualitaet-analyse/` | `/coa-pruefen/` |
| `Stack-Builder` | `/produkte/` | `/stack-builder/` |

COA card text becomes factual: *"Nachschlagen, ob zu Produkt und Packgröße
Analysedokumentation verknüpft ist."* The `Vergleichstool` card keeps
`/produkte/` (the listing genuinely compares). **No new main-header item.**

---

## Task 7 — Contextual links on the certificate and quality pages

**Modifies:** `storefront/src/pages/qualitaet-analyse.astro` (one sentence in the
`#coa` section), `storefront/src/content/wissen/reinheit-und-coa.md` (one link in
the closing section). Both point at `/coa-pruefen/` with trailing slash, through
the existing `internalHref` conventions. No restructuring of either page.

---

## Task 8 — Tests

**Creates:** `storefront/src/lib/coa-documents.test.ts`,
`storefront/src/lib/coa-lookup-output.test.ts`
**Modifies:** `storefront/src/lib/tools-page.test.ts` (destination regressions)

### Fixtures — both states, in test files only

`storefront/src/lib/fixtures/coa-catalog-empty.json`
: the real shape of today's production data — 6 products, 11 variants,
  `variant.metadata: null`, product metadata carrying the placeholder
  `coa_status`/`purity`. Drives every zero-document assertion.

`storefront/src/lib/fixtures/coa-catalog-documents.json`
: a synthetic catalog where **exactly one variant of a multi-variant product**
  carries a valid allowlisted document, plus variants carrying each rejection
  case: `http:`, `file:`, `data:`, `javascript:`, `blob:`, protocol-relative
  `//host/x.pdf`, a malformed string, a disallowed origin, a credentialed URL, a
  valid URL with all optional fields, and a valid URL with none.

Neither fixture is reachable from a page, a seed script or the catalog — they are
imported by tests only. **No fixture is ever deployed as data.**

### Required assertions

Route, metadata, discovery
1. Route is exactly `/coa-pruefen/`; built canonical is
   `https://peptideeinkaufen.de/coa-pruefen/`; title and H1 match the contract;
   exactly one `<h1>`.
2. Zero-document fixture → `noindex, follow`.
3. Document fixture → indexable (no robots restriction).
4. Same predicate drives sitemap and llms.txt: absent from both in the zero
   state; present **exactly once** in each in the document state.

Data correctness
5. Products, variants, pack sizes and SKUs come from the real Medusa loaders; no
   hard-coded product list in the shipped source.
6. Document state renders stored url/type/date/batch and nothing unstored.
7. No-document state renders the exact approved sentence plus the support link.
8. Unknown product → state (c); unknown pack size → state (d) listing the real
   pack sizes.
9. Empty catalog → state (f) and `noindex, follow`.
10. Optional fields omitted → document still offered, each missing field printed
    as *nicht hinterlegt*.
11. **Exact matching:** the single documented variant resolves to state (a) and
    **every** sibling variant, every other product and every other batch resolves
    to state (b). No product-level fallback.

Security
12. Valid allowlisted HTTPS document renders a link.
13. `http:`, `file:`, `data:`, `javascript:`, `blob:`, protocol-relative,
    malformed, credentialed and disallowed-origin URLs each degrade to state (b)
    — asserted case by case.
14. Built HTML exposes no filesystem path, upload directory, storage credential,
    internal IP, or `prod_…`/`variant_…` identifier; link text is never a raw
    storage filename.

Claims and schema
15. `coa_status` appears nowhere in the feature source or in
    `produkte/[handle].astro`; the built product page no longer contains
    `COA-Zertifikat: verfügbar` or an availability claim from placeholder data.
16. Product page renders the honest no-document state for the zero fixture.
17. `purity` is never read as an analysis result by the checker or the document
    row.
18. No invented certificate, purity, HPLC or LC-MS value in source or built HTML.
19. No authenticity/validity/quality guarantee wording: source matches none of
    `/geprüft|verifiziert|bestätigt|garantiert|gültig|echt|authentisch|freigegeben|validiert/i`
    outside the approved clarification sentence.
20. No upload control, file input, OCR, parsing or automated approval path.
21. Structured data: `BreadcrumbList` always; `ItemList` only in the document
    state; none of `Product`, `Offer`, `AggregateOffer`, `Review`,
    `AggregateRating`, `WebApplication`.

Navigation
22. Tools page: COA card `href="/coa-pruefen/"`; Stack-Builder card
    `href="/stack-builder/"`.
23. The checker links to `/qualitaet-analyse/`, `/wissen/reinheit-und-coa/`,
    `/support/anfrage/` and the product pages; all resolve without redirect.

Accessibility, no-JS, mobile
24. Native controls; `role="status" aria-live="polite"` receives the resolved
    state text; no colour-only status.
25. Server HTML lists every product, pack size and status without JavaScript;
    JS-only controls carry `hidden` in the served markup.
26. No `position: fixed`; sticky reverts to static at short/narrow viewports; the
    table sits in an `overflow-x: auto` container.

Non-regression
27. `/wissen/reinheit-und-coa/`, `/qualitaet-analyse/`, `/wissen/lexikon/coa/`
    and all product routes keep their canonical, robots directive and schema.
28. No catalog, cart, checkout or ordering mutation: feature source matches none
    of `/addLine|createLineItem|lib\/cart|\/kasse\/|data-add-to-cart|ORDERS_ENABLED/`;
    `git diff --stat` touches no file under `backend/`, no `package.json`, no
    lockfile, no `deploy/`.

---

## Task 9 — Verify and commit

```bash
cd storefront

# focused
node --test src/lib/coa-documents.test.ts src/lib/coa-lookup-output.test.ts
# product-page regression
node --test src/lib/metadata-output.test.ts src/lib/images.test.ts src/lib/canonical-output.test.ts
# tools-page regression
node --test src/lib/tools-page.test.ts src/lib/links-output.test.ts
# full suite (backend must be on :9000 first — the build fetches the catalog)
npm test
npm run typecheck        # astro check — zero errors
npm run build            # expect 54 pages against the production catalog (53 + /coa-pruefen/)
# CSS tokens — must print nothing
grep -rnE '#[0-9a-fA-F]{3,8}\b' --include='*.astro' src \
  | grep -vE '\-\-c-[a-z0-9-]+:\s*#|fill=|stroke='
cd .. && git diff --check
```

Output-based tests read `dist/`, so `npm run build` runs before the final
`npm test`. Then: `git status --short`, review the full diff, commit on
`feat/coa-checker`. **Push, merge and deploy stay out of this plan** — they are a
separate, explicitly approved step.

### Manual checks before calling it done

- `/coa-pruefen/` at 320 px, 390 px and 1440 px — no horizontal page scroll.
- Keyboard-only: search → product → pack size → onward links, focus visible at
  every stop.
- JavaScript disabled: the page answers the question for all six products.
- Screen reader: the live region announces each state change.
- Product page: the COA row is gone and the per-pack-size section reads honestly.
- `/tools/`: both corrected cards land on the right pages.

---

## Conflicts and risks

1. **`AddToCart` has no variant selection while ordering is closed** — resolved
   in Task 5 by a per-pack-size list rather than a selected-variant readout.
2. **`STATIC_ROUTES` is synchronous**, so conditional inclusion cannot live
   there; Task 4 adds async entry functions instead, matching `categoryEntries()`.
3. **Astro's build fails hard if Medusa is unreachable** (`fetch failed`), so
   state (f) covers an *empty* catalog, not an unreachable one. That is an
   environment failure, and per `AGENTS.md` it is not this feature's job to mask
   it.
4. **The page ships noindex and invisible to sitemap/llms.txt** on first deploy.
   Intended. Anyone reviewing production afterwards should expect
   `/coa-pruefen/` to return 200 while being absent from `sitemap-pages.xml` —
   that is the predicate working, not a build fault.
5. **Parallel agents** may touch `tools.astro`, `content-index.ts` or
   `produkte/[handle].astro`. Re-check `origin/main` before the final verify and
   rebase rather than overwrite.
6. **`purity` stays visibly placeholder** on product pages after this ships. The
   follow-up audit is recorded in the spec's §15 and is deliberately not started
   here.
