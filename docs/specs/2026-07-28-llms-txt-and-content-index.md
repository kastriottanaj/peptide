# llms.txt and a shared content index

- **Date:** 2026-07-28
- **Status:** Implemented (2026-07-28) — approved with products listed by purity and
  pack size, no prices
- **Slug:** `llms-txt-and-content-index`

## Goal

Every new product and every new Wissen/Lexikon entry should appear in the sitemap
*and* in `/llms.txt` automatically, with no second place to remember to edit.

## Starting point

The sitemap half of this is already done and works:

| Route | Source | Automatic? |
| --- | --- | --- |
| `sitemap-products.xml` | `medusa.store.product.list()` | yes |
| `sitemap-wissen.xml` | `getCollection("wissen" \| "lexikon")` | yes |
| `sitemap-pages.xml` | `staticRoutes` + `listCategories()` | categories yes, static pages hand-listed |

`/llms.txt` does not exist. `staticRoutes` lives inside `src/lib/sitemap.ts`, which
mixes the *inventory* of URLs with the *XML rendering* of them — so a second consumer
(llms.txt) would either import from a rendering module or duplicate the list.

## Scope

### 1. Extract the URL inventory into `src/lib/content-index.ts`

One module that answers "what does this site publish?", independent of output format.

```ts
export type IndexedEntry = {
	path: string;              // site-relative, e.g. "/produkte/bpc-157"
	title: string;
	description?: string;      // one line, for llms.txt
	lastModified?: Date;
	changeFrequency: ChangeFrequency;
	priority: number;
	images?: SitemapImage[];   // product thumbnails, for the image sitemap
};

export async function staticEntries(): Promise<IndexedEntry[]>;
export async function categoryEntries(): Promise<IndexedEntry[]>;
export async function productEntries(): Promise<IndexedEntry[]>;
export async function articleEntries(): Promise<IndexedEntry[]>;
export async function termEntries(): Promise<IndexedEntry[]>;
```

`src/lib/sitemap.ts` keeps only the XML rendering helpers (`renderUrlset`,
`renderSitemapIndex`, `escapeXml`, `xmlResponse`) and the `ChangeFrequency` /
`SitemapImage` / `SitemapUrl` types. `staticRoutes` moves into `content-index.ts` and
gains `title` + `description`, which llms.txt needs and the sitemap ignores.

Draft filtering (`!data.draft`) lives in this module only, so a draft can never leak
into one surface but not the other.

### 2. Rewrite the three sitemap routes on top of it

Behaviour-preserving. Same URLs, same `lastmod`/`changefreq`/`priority`, same image
extension on products. Each route becomes a mapping from `IndexedEntry[]` to
`SitemapUrl[]`.

### 3. New route `src/pages/llms.txt.ts`

Serves `/llms.txt` as `text/plain`, in the llmstxt.org format: an `# H1` with the site
name, a `>` blockquote summary, then one `## H2` section per content type with
`- [Title](absolute-url): description` bullets. Sections: Produkte, Kategorien, Wissen,
Lexikon, Seiten. Built from the same five `content-index.ts` functions, so a new
product or article appears here for exactly the same reason it appears in the sitemap.

Descriptions come from what each type already carries — product `description` plus
`metadata.purity`, category `description`, article `excerpt`, term `summary`.

### 4. New route `src/pages/llms-full.txt.ts`

The full German text of every non-draft Wissen article and Lexikon entry, concatenated
under `#` headings with their canonical URLs. This is the file an LLM crawler actually
ingests; `/llms.txt` is only a map. Product data is *not* inlined here — prices and
stock go stale, and the catalog is still placeholder data.

### 5. Discovery

Add a `# llms.txt: <url>` comment line to `robots.txt`. It is a comment, not a
directive, so it cannot affect crawling; the well-known `/llms.txt` path is the real
discovery mechanism.

## Non-goals

- No change to which URLs are indexable, and no change to any `noindex` decision.
- No new sitemap types, no change to the sitemap index structure.
- Not adding the legal pages — they are still `draft`/`noindex` and stay out of both
  the sitemap and llms.txt until final.
- No build-time write of a static `public/llms.txt`. These are Astro endpoints,
  prerendered by `astro build` like the existing sitemaps.
- No IndexNow ping wiring in this change.
- No inlining of prices or stock into `llms-full.txt`.

## Files

| File | Change |
| --- | --- |
| `storefront/src/lib/content-index.ts` | new — the URL inventory |
| `storefront/src/lib/sitemap.ts` | modified — rendering only, `staticRoutes` moves out |
| `storefront/src/pages/sitemap-pages.xml.ts` | modified — read from `content-index` |
| `storefront/src/pages/sitemap-products.xml.ts` | modified — read from `content-index` |
| `storefront/src/pages/sitemap-wissen.xml.ts` | modified — read from `content-index` |
| `storefront/src/pages/llms.txt.ts` | new |
| `storefront/src/pages/llms-full.txt.ts` | new |
| `storefront/src/pages/robots.txt.ts` | modified — llms.txt comment line |

## Verification

Backend must be on :9000 first — `npm run build` fetches the catalog.

```bash
cd storefront
npm run typecheck
npm run build
```

Then, against the build output:

```bash
# Same URL set before and after the refactor (must be empty diff vs. a pre-change copy)
grep -o '<loc>[^<]*</loc>' dist/sitemap-*.xml | sort

# llms.txt lists every product and every non-draft article/term
grep -c '^- \[' dist/llms.txt
```

Manual checks on the dev server:

- `/llms.txt` renders as plain text, links are absolute and use `PUBLIC_SITE_URL`.
- `/llms-full.txt` contains the body text of all 3 articles and 8 lexicon entries.
- Add a throwaway `src/content/lexikon/test.md`; it appears in `sitemap-wissen.xml`,
  `/llms.txt` and `/llms-full.txt` after a rebuild. Set `draft: true`; it disappears
  from all three. Delete the file afterwards.
- `/robots.txt` still parses — the added line begins with `#`.
