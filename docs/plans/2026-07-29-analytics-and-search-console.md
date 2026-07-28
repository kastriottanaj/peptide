# Plan — Google Analytics 4 and Google Search Console

Spec: [../specs/2026-07-29-analytics-and-search-console.md](../specs/2026-07-29-analytics-and-search-console.md)

## Task 1 — Consent module

Creates `storefront/src/lib/consent.ts`.

Produces: `ConsentState`, `CONSENT_VERSION`, `CONSENT_CHANGED_EVENT`,
`OPEN_CONSENT_EVENT`, `readConsent()`, `hasDecision()`, `isGranted()`,
`saveConsent()`, `onConsentChange()`, `requestConsentDialog()`.
Consumes: nothing.

- [x] Versioned key `pe_consent_v1`; `LEGACY_KEYS` swept on read.
- [x] All storage access wrapped in try/catch (private mode), matching `cart.ts`.
- [x] Changes announced as a `CustomEvent` on `window`, as `cart.ts` does.

## Task 2 — GA4 loader

Creates `storefront/src/lib/analytics.ts`.

Consumes: `consent.ts`. Produces: `initAnalytics()`.

- [x] No-op when `PUBLIC_GA_MEASUREMENT_ID` is unset.
- [x] `gtag.js` injected only on granted statistics consent, once per document.
- [x] Withdrawal sets `ga-disable-<ID>` and clears `_ga` / `_ga_*` on the host
      and the registrable domain.
- [x] `window.dataLayer` typed in a `declare global` block.

## Task 3 — Consent dialog

Creates `storefront/src/components/ConsentBanner.astro`.

Consumes: `consent.ts`, `analytics.ts`.

- [x] Renders nothing at all when `PUBLIC_GA_MEASUREMENT_ID` is unset.
- [x] `<dialog>` + `showModal()`; `cancel` prevented so ESC cannot dismiss.
- [x] Two identically styled buttons; reject listed first.
- [x] Scoped styles, `var(--c-*)` only, no raw hex.

## Task 4 — Layout wiring

Modifies `storefront/src/layouts/BaseLayout.astro`.

- [x] `--c-scrim` added to `:root`.
- [x] `<ConsentBanner />` rendered before the closing `</body>`.
- [x] "Cookie-Einstellungen" button in the Rechtliches footer column, firing
      `OPEN_CONSENT_EVENT`.

## Task 5 — Search Console verification hook

Modifies `storefront/src/components/Seo.astro`.

- [x] `PUBLIC_GOOGLE_SITE_VERIFICATION` renders a `google-site-verification`
      meta tag; unset renders nothing.

## Task 6 — Datenschutz

Modifies `storefront/src/pages/datenschutz.astro`.

- [x] §6 gains the US transfer with its Art. 45/46 basis.
- [x] §8 rewritten: GA4, Art. 6 (1) (a) consent, cookies and retention, the
      withdrawal route via the footer, Google Ireland/LLC named.
- [x] Head comment updated — it currently asserts no tracking exists.

## Task 7 — Environment plumbing

Modifies `deploy/deploy.sh`, `deploy/.env.template`, `README.md`.

- [x] Both vars written into the generated `storefront/.env` at build time,
      defaulted empty so an unset var is not a deploy failure.
- [x] Documented in both the template and the README.

## Task 8 — Docs

Creates `docs/analytics.md`; modifies `TECH_STACK.md`,
`docs/go-live-checklist.md`.

- [x] Runbook: DNS TXT verification, why file/meta verification 401s, the
      launch-day sitemap step, GA4 property setup, the rebuild requirement.
- [x] `TECH_STACK.md` analytics row and prose switched to GA4.
- [x] Checklist §7 consent item ticked; Search Console added to launch day.

## Task 9 — Verify and commit

- [x] `npm run typecheck`, `npm run build`, the hex grep.
- [x] Manual checks from the spec against `astro dev`.
- [x] Commit.
