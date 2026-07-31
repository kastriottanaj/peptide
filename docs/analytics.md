# Analytics and Search Console

Runbook for Google Analytics 4 and Google Search Console on
`peptideeinkaufen.de`. Design decisions live in
[specs/2026-07-29-analytics-and-search-console.md](specs/2026-07-29-analytics-and-search-console.md).

This page covers **collection**: the consent-gated `gtag` on the storefront, and
Search Console. For **reading reports back out** of GA4 — the backend's
service-account credentials and the three admin endpoints that query the Data
API — see [analytics-ga4-api.md](analytics-ga4-api.md).

> **The gate came off on 2026-07-29.** Everything below that was blocked by the
> 401 now works: Googlebot can fetch, the sitemap can be submitted, and GA4 sees
> real traffic. The historical constraint is kept in the table because it
> explains why the domain property was verified by DNS TXT rather than by a
> meta tag — that choice still stands and needs no revisiting.

## What the gate used to block

| | While gated (until 2026-07-29) | Now |
| --- | --- | --- |
| Search Console DNS TXT verification | ✅ worked — DNS is answered by Hostinger, not by the gated server | ✅ still valid, no action |
| Search Console HTML file / meta tag | ❌ Googlebot got 401 | ✅ possible, but unnecessary — DNS verification already holds |
| Sitemap submission | ❌ fetch failed with 401 | ✅ **do this now** — see step 3 below |
| Indexing | ❌ blocked by `noindex` even if fetched | ✅ site-wide; the four legal pages stay `noindex` via their `draft` prop |
| GA4 collection | ⚠️ only your own through-the-gate sessions | ✅ real traffic, once `PUBLIC_GA_MEASUREMENT_ID` is set on the server |

Note GA4 is still not collecting: `PUBLIC_GA_MEASUREMENT_ID` is unset in
`/srv/peptides/.env`, so no script loads and no consent dialog appears. That is
consistent, not broken — but it now means real traffic is going unmeasured.

## Google Search Console

### 1. Create the property (domain property, not URL prefix)

In Search Console, **Add property → Domain**, enter `peptideeinkaufen.de`. A
domain property covers the apex, `www.` and `api.` and both schemes with one
record, and it survives un-gating with no further action.

### 2. Verify by DNS TXT

Google shows a value like `google-site-verification=<token>`. Add it in
Hostinger hPanel (DNS is delegated from Hostinger; the A records already point
at the Hetzner box):

- **Type:** `TXT`
- **Name / Host:** `@` (the apex — not `www`)
- **Value:** the full `google-site-verification=<token>` string
- **TTL:** whatever the default is

Then press Verify. If it fails, propagation is the usual cause — check with:

```bash
dig +short TXT peptideeinkaufen.de
```

and retry once the record shows up. **Do not delete the TXT record afterwards**;
Google re-checks it periodically and removing it un-verifies the property.

The meta-tag method is wired up in code (`PUBLIC_GOOGLE_SITE_VERIFICATION` →
`Seo.astro`). It is usable now that the gate is off, but unnecessary — the DNS
verification already holds. It is there for a URL-prefix property added later.

### 3. Now that the gate is off — do this

In this order:

1. Confirm the gate is really gone: `curl -sI https://peptideeinkaufen.de | head -5`
   must return `200` with no `X-Robots-Tag` header.
2. Submit the sitemap index in Search Console → Sitemaps: `sitemap.xml`. It
   fronts the per-type sitemaps (`sitemap-products.xml`, `sitemap-pages.xml`,
   `sitemap-wissen.xml`, `sitemap-lexikon.xml`), so submitting the index is
   enough. Search Console then reports coverage per child sitemap, which is the
   point of the split — a glossary term failing to index looks nothing like an
   article failing to index.
3. Use **URL inspection → Request indexing** on the homepage and the catalog
   listing to prompt the first crawl.
4. Expect coverage reports to stay noisy for a week or two. Filtered listing
   URLs (`/produkte?q=…`) are `noindex, follow` by design and will show up as
   "Excluded by noindex" — that is correct, not a problem to fix.

## Google Analytics 4

### 1. Create the property

Google Analytics → Admin → Create property. Set the reporting time zone to
Germany and the currency to EUR. Create a **Web** data stream for
`https://peptideeinkaufen.de`. The stream yields a measurement ID shaped
`G-XXXXXXXXXX`.

While setting it up, also do the two things the Datenschutz text depends on:

- **Data retention** (Admin → Data settings → Data retention): pick 2 or 14
  months, then write the chosen value into §8 of `datenschutz.astro`, replacing
  the `[Platzhalter]` note there.
- **Data processing terms** (Admin → Account settings): accept them. This is the
  Art. 28 DSGVO processing agreement with Google that §6 refers to.

### 2. Configure the storefront

Local (`storefront/.env`):

```dotenv
PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

Production (`/srv/peptides/.env` on the server, same key), then deploy normally:

```bash
bash /srv/peptides/repo/deploy/deploy.sh <sha>
```

> **The value is baked in at build time.** Setting it on the server changes
> nothing until the storefront is rebuilt and redeployed — the same trap as
> editing a product in the Medusa admin. `deploy.sh` writes the variable into
> the build `.env` and rebuilds, so a normal deploy is all it takes.

Leaving the variable unset is a complete off switch: no Google script, no
consent dialog, no footer entry point, and `/datenschutz` keeps its "no tracking
in use" wording.

### 3. How consent gates it

`AGENTS.md` requires that analytics load only after explicit statistics consent,
and § 25 TTDSG requires it independently. The implementation is a hard block,
not Google Consent Mode: **before consent there is no script tag, no request to
Google and no cookie.**

- [`src/lib/consent.ts`](../storefront/src/lib/consent.ts) — the only place that
  knows the consent state. Key `pe_consent_v1`; no stored decision means "ask",
  never "allowed".
- [`src/lib/analytics.ts`](../storefront/src/lib/analytics.ts) — injects
  `gtag.js` on grant; on withdrawal sets `ga-disable-<ID>` and deletes `_ga` and
  `_ga_*`.
- [`src/components/ConsentBanner.astro`](../storefront/src/components/ConsentBanner.astro)
  — the dialog. Reject and accept are identically styled, reject first, and
  neither ESC nor a backdrop click dismisses it.
- Reopened from "Cookie-Einstellungen" in the footer.

**Changing the consent shape** — adding a category, changing what is asked —
means bumping `CONSENT_VERSION` and adding the old key to `LEGACY_KEYS`. That
re-asks everyone, which is the point: their old answer was to a different
question. A new category also needs its own section in `datenschutz.astro`, and
`AGENTS.md` allows only categories that match tracking actually on the site.

### 4. Verify it works

With `astro dev` and a measurement ID set, in a fresh private window:

```
1. Load any page          → dialog appears; Network shows nothing from
                            googletagmanager.com; no _ga cookie
2. Press ESC / click away → dialog stays open
3. "Ablehnen"             → dialog closes, still no Google request, and it does
                            not reappear on the next page load
4. Footer → Cookie-Einstellungen → dialog reopens showing the current choice
5. "Statistiken erlauben" → gtag/js?id=G-… loads and a _ga cookie appears
6. Switch back to reject  → _ga and _ga_* are gone
```

In GA4 itself, Reports → Realtime should show your own session within a minute
of step 5.

## Troubleshooting

**Search Console verification fails.** Check the TXT record is on the apex (`@`),
not `www`, and that the full `google-site-verification=` prefix is included.
`dig +short TXT peptideeinkaufen.de` shows what is actually published.

**Sitemap reports "Couldn't fetch".** Expected while gated — Google gets a 401.
Re-submit after un-gating.

**No data in GA4.** In order: is `PUBLIC_GA_MEASUREMENT_ID` set *and* the
storefront rebuilt since? Was statistics consent granted in this browser? Is an
ad blocker suppressing `googletagmanager.com`? And is there any traffic at all —
behind the gate there is not.

**Consent dialog does not appear.** It only renders when
`PUBLIC_GA_MEASUREMENT_ID` is set, and only opens when no decision is stored.
Clear `pe_consent_v1` from localStorage to get it back.
