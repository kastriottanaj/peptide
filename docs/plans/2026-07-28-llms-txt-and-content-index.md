# Plan — llms.txt and a shared content index

Spec: [docs/specs/2026-07-28-llms-txt-and-content-index.md](../specs/2026-07-28-llms-txt-and-content-index.md)
Approved 2026-07-28: both files + refactor; products listed with purity and pack sizes, no prices.

## Task 1 — `src/lib/content-index.ts`

Creates: `storefront/src/lib/content-index.ts`
Consumes: `./site` (`absoluteUrl`), `./medusa`, `./catalog` (`listCategories`),
`astro:content` (`getCollection`), `./sitemap` (`ChangeFrequency`, `SitemapImage` types)
Produces: `IndexedEntry`, `staticEntries`, `categoryEntries`, `productEntries`,
`articleEntries`, `termEntries`

- [x] Define `IndexedEntry` per the spec.
- [x] Move `staticRoutes` here from `sitemap.ts`, adding `title` + `description`.
- [x] `productEntries()` — one Medusa list call, fields incl. `*variants`; description
      from `metadata.purity` + variant titles (pack sizes), no prices.
- [x] `articleEntries()` / `termEntries()` — `!data.draft` filter lives only here.
- [x] Keep the "legal pages are noindex, stay out" comment with the static list.

## Task 2 — trim `src/lib/sitemap.ts` to rendering

Modifies: `storefront/src/lib/sitemap.ts`
Produces: unchanged `renderUrlset` / `renderSitemapIndex` / `xmlResponse` / types

- [x] Remove `staticRoutes` (moved in Task 1). No other behaviour change.

## Task 3 — rewrite the three sitemap routes

Modifies: `sitemap-pages.xml.ts`, `sitemap-products.xml.ts`, `sitemap-wissen.xml.ts`
Consumes: `content-index.ts`

- [x] Each route maps `IndexedEntry[]` → `SitemapUrl[]` via one shared helper.
- [x] Byte-comparable URL set to the pre-change snapshot.

## Task 4 — `src/pages/llms.txt.ts`

Creates: `storefront/src/pages/llms.txt.ts`
Consumes: all five `content-index.ts` functions

- [x] llmstxt.org layout: `# H1`, `>` summary, `## Produkte / Kategorien / Wissen /
      Lexikon / Seiten`, `- [Title](url): description` bullets.
- [x] `text/plain; charset=utf-8`.

## Task 5 — `src/pages/llms-full.txt.ts`

Creates: `storefront/src/pages/llms-full.txt.ts`

- [x] Full body markdown of every non-draft article and term, under `#` headings with
      canonical URLs. No prices, no product bodies.

## Task 6 — robots.txt discovery line

Modifies: `storefront/src/pages/robots.txt.ts`

- [x] Add `# llms.txt: <absolute url>` as a comment.

## Task 7 — verify + commit

- [x] `npm run typecheck`, `npm run build` (backend on :9000 first).
- [x] Diff `dist/sitemap-*.xml` URL set against the pre-change snapshot — must be empty.
- [x] Draft round-trip check on a throwaway lexicon entry, then delete it.
- [x] `git status --short`, commit.
