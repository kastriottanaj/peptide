# Spec — Google Analytics 4 and Google Search Console

- **Date:** 2026-07-29
- **Status:** approved
- **Owner:** storefront

## Goal

Put the two measurement tools in place for `peptideeinkaufen.de`:

1. **Google Search Console** — the property verified and the sitemap ready to
   submit, so search data starts accruing the moment the shop opens.
2. **Google Analytics 4** — loaded on the storefront, but only after explicit
   statistics consent, with the Datenschutz page describing it.

GA4 **replaces PostHog** as the analytics tool (decision, 2026-07-29).
`TECH_STACK.md` is updated to match; PostHog is not integrated.

## The constraint that shapes everything: the gate

The storefront sits behind HTTP basic auth plus `X-Robots-Tag: noindex`
(`deploy/Caddyfile`, "PRE-LAUNCH GATE"). The `basic_auth` directive carries no
matcher, so **every** request to the domain answers 401 — Googlebot included.
Three consequences drive the design:

- **Search Console verification by HTML file or `<meta>` tag cannot succeed.**
  Google fetches the URL, receives 401, and fails verification. **DNS TXT
  (domain property) is the only method that works while gated**, and it is the
  better property type regardless: one record covers the apex, `www.` and
  `api.` subdomains. It also survives the un-gating with no further action.
- **The sitemap cannot be fetched, and nothing can be indexed**, until the gate
  is removed. Submitting `sitemap.xml` is therefore a launch-day step, not a
  today step. Search Console will legitimately show zero data until then.
- **GA4 will record only our own through-the-gate sessions.** That is expected
  and is not a reason to defer the work: the consent flow, the Datenschutz text
  and the property all need to exist and be verified *before* real traffic
  arrives, not after.

## Scope

### Search Console

- Support the `google-site-verification` meta tag through `Seo.astro`, driven by
  `PUBLIC_GOOGLE_SITE_VERIFICATION`. Unset (the default) emits nothing. This is
  a post-launch convenience for URL-prefix properties; it is **not** the route
  used now, for the 401 reason above.
- Document the DNS TXT route, the launch-day sitemap submission and the
  expected "no data" state in a new `docs/analytics.md`.

### Analytics and consent

- `storefront/src/lib/consent.ts` — the single source of truth for consent:
  read, save, subscribe, and an "open the dialog" event. Versioned storage key
  with a defined migration path.
- `storefront/src/lib/analytics.ts` — GA4 loading, gated on consent. Injects
  `gtag.js` only after statistics consent is granted; on withdrawal it sets
  Google's documented `ga-disable-<ID>` flag and deletes the GA cookies.
- `storefront/src/components/ConsentBanner.astro` — the dialog. Reject and
  accept identically styled, no pre-ticked anything, no dismissal without a
  decision.
- `BaseLayout.astro` renders the banner on every page and gains a
  "Cookie-Einstellungen" footer entry point that reopens it.
- `datenschutz.astro` §8 rewritten from "we use nothing" to a GA4 section; §6
  gains the third-country transfer that §8 introduces.
- `PUBLIC_GA_MEASUREMENT_ID` threaded through `deploy/deploy.sh`,
  `deploy/.env.template` and `README.md`.

### Non-goals

- **Removing or weakening the gate.** Out of scope entirely; it is a launch
  decision under `docs/go-live-checklist.md`.
- **Google Consent Mode v2.** Deliberately not used. It transmits cookieless
  pings *before* a decision; `AGENTS.md` requires that analytics load only
  after explicit consent, so this is a hard block — no network request to
  Google until the user opts in.
- **Google Tag Manager.** GA4 direct, no container.
- **A marketing/advertising consent category.** Only categories matching
  tracking actually present may be offered, and there is no ad tech here.
- **Server-side or e-commerce event tracking** (`purchase`, `add_to_cart`).
  Page views only for now; conversion events are a follow-up once real orders
  exist.
- **PostHog.** Superseded by this decision.
- **Bing Webmaster Tools / IndexNow.** IndexNow is already covered in
  `AGENTS.md` as separate future work.

## File changes

| File | Change |
| --- | --- |
| `storefront/src/lib/consent.ts` | New. Consent state, storage, events. |
| `storefront/src/lib/analytics.ts` | New. Consent-gated GA4 loader. |
| `storefront/src/components/ConsentBanner.astro` | New. The dialog. |
| `storefront/src/layouts/BaseLayout.astro` | Render banner; footer link; `--c-scrim` token. |
| `storefront/src/components/Seo.astro` | Optional verification meta tag. |
| `storefront/src/pages/datenschutz.astro` | §6 third-country transfer; §8 rewritten for GA4. |
| `deploy/deploy.sh` | Pass the two new vars into the build `.env`. |
| `deploy/.env.template` | Document both vars. |
| `README.md` | Document both vars. |
| `TECH_STACK.md` | PostHog → GA4. |
| `docs/analytics.md` | New. Runbook for both tools. |
| `docs/go-live-checklist.md` | §7 consent item ticked; launch-day GSC steps added. |

## Design notes

**Consent shape.** One category, `statistics`. Stored as JSON under the
versioned key `pe_consent_v1`:

```json
{ "version": 1, "decidedAt": "2026-07-29T10:00:00.000Z", "statistics": false }
```

**Migration path.** The version lives in the key, not only in the payload. A
shape change means bumping `CONSENT_VERSION`, which makes the old key invisible
to the reader — the visitor is asked again, which is the correct outcome when
what we are asking about has changed. Superseded keys are listed in
`LEGACY_KEYS` and deleted on read so storage does not accumulate dead consent
records.

**No decision ≠ refusal.** `readConsent()` returns `null` when nothing is
stored, and null means "ask". Only an explicit rejection is stored as
`statistics: false`, which suppresses the dialog on later visits.

**Why `<dialog>`.** `showModal()` gives a focus trap and an inert background for
free, and browsers do **not** light-dismiss it on backdrop click unless
`closedby` says so. ESC is the one native escape hatch, and preventing the
`cancel` event closes it. Hand-rolling a modal to get the same guarantees would
be more code and worse.

**Static build.** `PUBLIC_GA_MEASUREMENT_ID` is inlined at build time, so
setting it on the server changes nothing until the storefront is rebuilt and
deployed. Same trap as the catalog. Called out in `docs/analytics.md`.

**Withdrawal.** `gtag.js` cannot be unloaded once evaluated. Withdrawal
therefore sets `window['ga-disable-<ID>'] = true` (Google's documented opt-out,
which suppresses all further transmission) and deletes `_ga` and `_ga_*` on both
the host and the registrable domain, since GA sets them on the latter.

## Verification

Commands (`cd storefront`):

```bash
npm run typecheck
npm run build          # needs the backend on :9000 first
grep -rnE '#[0-9a-fA-F]{3,8}\b' --include='*.astro' src \
  | grep -vE '\-\-c-[a-z0-9-]+:\s*#|fill=|stroke='   # must print nothing
```

Manual, against `astro dev`. All verified 2026-07-29 with a throwaway
measurement ID:

- [x] First load shows the dialog. Zero requests to `googletagmanager.com` or
      `google-analytics.com`, and no cookies at all.
- [x] ESC does not close it; a backdrop click does not close it (the element at
      the backdrop coordinates is the `<dialog>` itself, and the click leaves
      `open === true`). There is no close button.
- [x] "Statistiken erlauben" loads `gtag/js?id=G-…`, and a real `page_view` hit
      reaches `/g/collect` — confirming the `arguments`-push is processed as a
      gtag command rather than silently ignored as a dataLayer event.
- [x] Return visit: no dialog, GA loads straight from the stored decision.
- [x] Reopening from the footer shows "Aktuelle Auswahl: Statistiken erlaubt.";
      switching to reject deletes `_ga` and `_ga_*`, sets `ga-disable-<ID>`, and
      the next page load makes no Google request.
- [x] With `PUBLIC_GA_MEASUREMENT_ID` unset the built output contains no consent
      markup, no footer entry point and no reference to `googletagmanager`
      anywhere in `dist/`.
- [x] `/datenschutz` §8 describes GA4 and §6 names the US transfer when enabled;
      both revert to the "no tracking in use" wording when it is not.
