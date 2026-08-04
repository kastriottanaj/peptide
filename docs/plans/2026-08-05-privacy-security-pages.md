# Privacy and security pages implementation plan

**Date:** 2026-08-05
**Status:** Implemented 2026-08-05 — awaiting review
**Approved spec:** `docs/specs/2026-08-05-privacy-security-pages.md`

## Constraints carried from the spec

- Create only `/datenschutz-anfrage/`, `/cookie-einstellungen/`, and `/sicherheit/`.
  Do not create `/status/`, `/cookies/`, or a new redirect subsystem.
- Keep `/datenschutz-anfrage/`, `/cookie-einstellungen/`, and the existing
  `/datenschutz/` at `noindex, nofollow` and outside every sitemap and llms inventory.
- Keep `/sicherheit/` indexable and include it exactly once in
  `sitemap-pages.xml` and exactly once in `llms.txt`.
- Reuse configured contact email and the existing email support path; add no form,
  upload, API route, database write, request-content logging, or backend behavior.
- Reuse the existing consent module and dialog; add no category, provider, duration,
  dependency, or parallel consent state.
- Do not expose infrastructure details or promise security rewards, response times,
  outcomes, or guarantees.
- Do not alter Inbox, IMAP, SMTP reply, checkout, product, category, pricing, cart, or
  ordering behavior. Do not commit, push, merge, or deploy.

## 1. Confirm the existing interfaces before editing

- [ ] Re-read the approved spec and inspect the clean worktree with
  `git status --short` before changing application files.
- [ ] Inspect these route and layout patterns:
  - `storefront/src/pages/support/anfrage.astro` for support routing, configured
    contact fallback, page structure, cards, links, and scoped styling.
  - `storefront/src/pages/datenschutz.astro` and
    `storefront/src/layouts/LegalLayout.astro` for the legal draft boundary and the
    requirement that `draft` continues to produce `noindex, nofollow`.
  - `storefront/src/pages/barrierefreiheit.astro` and
    `storefront/src/pages/redaktionsrichtlinien.astro` for indexable trust-page
    structure, breadcrumbs, JSON-LD, factual metadata, typography, and cards.
  - `storefront/src/layouts/BaseLayout.astro` and
    `storefront/src/components/Seo.astro` for header/footer reuse, canonical
    generation, and robots output.
- [ ] Inspect these contact and support interfaces:
  - `storefront/src/lib/company.ts` and `storefront/src/lib/contact.ts` for
    `CONTACT.email` and safe `mailtoHref()` construction.
  - `storefront/src/lib/support-anfrage.test.ts` and
    `storefront/src/lib/support-postfach.test.ts` for existing no-form, no-promise,
    configuration, Inbox, IMAP, and SMTP regression boundaries.
- [ ] Inspect these storage and consent interfaces:
  - `storefront/src/lib/consent.ts` for `readConsent()`,
    `requestConsentDialog()`, `onConsentChange()`, `CONSENT_CHANGED_EVENT`, and the
    single `statistics` category.
  - `storefront/src/components/ConsentBanner.astro` for dialog behavior, equal accept
    and reject actions, keyboard behavior, status language, and conditional rendering.
  - `storefront/src/lib/analytics.ts` for `ANALYTICS_ENABLED`, conditional GA loading,
    withdrawal behavior, and the `_ga` cookie cleanup that confirms which optional
    cookies may exist.
  - `storefront/src/lib/cart-state.ts` and `storefront/src/pages/datenschutz.astro`
    for the confirmed `peptide_cart_id` and `pe_consent_v1` local-storage entries.
- [ ] Inspect `storefront/src/lib/content-index.ts`, sitemap route handlers,
  `storefront/src/pages/llms.txt.ts`, and existing trust-page tests to confirm that
  `STATIC_ROUTES` is the sole discovery change needed for an indexable static page.
- [ ] Re-run `rg` for `/cookies`, redirect configuration, and `/status` before editing.
  If an established redirect or either route has appeared on `origin/main`, stop and
  reconcile the plan rather than creating a competing mechanism.

**Interfaces consumed:** `BaseLayout` props, `Seo` canonical/robots behavior,
`CONTACT.email`, `mailtoHref()`, `ANALYTICS_ENABLED`, consent read/open/change APIs,
`breadcrumbNode()`, `canonicalUrl()`, `ORGANIZATION_ID`, and `STATIC_ROUTES`.

## 2. Add focused tests first

**Files:**

- Create `storefront/src/lib/privacy-security-pages.test.ts`.
- Modify existing test files only if a shared registry makes that necessary; expected
  candidates are `storefront/src/lib/metadata-output.test.ts` and
  `storefront/src/lib/links.test.ts` or `links-output.test.ts`.

- [ ] Add source-level tests that run without `dist/` and assert:
  - exactly the three planned `.astro` route files are introduced and no `/status/`
    or `/cookies/` route is created;
  - privacy and security contact actions derive their address from `CONTACT.email` and
    use `mailtoHref()` with non-sensitive, prefilled subjects;
  - neither new contact page contains a form, upload input, hard-coded email address,
    request logger, backend endpoint, response-time promise, reward promise, guarantee,
    or placeholder content;
  - the privacy page lists all eight approved request categories, warns against the
    specified sensitive data and identification-document uploads, and describes only
    proportionate identity verification;
  - the cookie page imports the real consent and analytics interfaces, uses a native
    button, has a live accessible state region, and introduces no second storage key,
    consent category, provider, or made-up duration;
  - the security page contains all reporting categories, useful safe details,
    redaction guidance, prohibited testing boundaries, and no infrastructure IP,
    internal filesystem path, credential, version, SLA, or bug-bounty claim;
  - `/datenschutz/` still passes `draft` to `LegalLayout`;
  - only `/sicherheit` is added to `STATIC_ROUTES`, exactly once;
  - the required contextual and footer links use trailing-slash routes and existing
    links are not removed.
- [ ] Add built-output tests, skipped when `dist/` is absent, that assert:
  - all three routes build and contain one clear H1;
  - exact canonical paths are `/datenschutz-anfrage/`,
    `/cookie-einstellungen/`, and `/sicherheit/`;
  - exact robots behavior is `noindex, nofollow` on the first two, no robots meta tag
    on `/sicherheit/` (the established `index, follow` convention), and unchanged
    `noindex, nofollow` on `/datenschutz/`;
  - the two private routes occur zero times across every sitemap, `llms.txt`, and
    `llms-full.txt`;
  - `/sicherheit/` occurs once in `sitemap-pages.xml`, no other sitemap, and once in
    `llms.txt`;
  - required internal links resolve to built pages;
  - the cookie status uses an accessible status semantic and the settings control is a
    keyboard-native button with a visible focus rule.
- [ ] Use existing support-postfach tests plus a scoped `git diff --name-only` check in
  final verification to prove that backend Inbox, IMAP, and SMTP implementation files
  were not touched. Do not snapshot secrets or environment values.

**Interfaces produced:** executable regression coverage for page content, output
metadata, discovery, links, safety boundaries, and consent action wiring.

## 3. Implement `/datenschutz-anfrage/` through the existing support flow

**File:** Create `storefront/src/pages/datenschutz-anfrage.astro`.

- [ ] Build the page with `BaseLayout`, existing page typography/card patterns, one H1,
  semantic H2 sections, breadcrumbs, and factual `WebPage` JSON-LD.
- [ ] Pass `noindex` to `BaseLayout`; let `Seo.astro` derive the self-canonical from the
  route so the output is exactly `/datenschutz-anfrage/` and
  `noindex, nofollow`.
- [ ] Explain all approved rights in a structured list or definition list: Auskunft,
  Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch,
  Einwilligungswiderruf, and other privacy requests.
- [ ] Explain useful minimal identification details and that additional identity
  verification may be requested only when reasonably necessary. Explicitly say not to
  send identity-document copies unless later specifically and lawfully requested; do
  not add upload capability.
- [ ] Warn against passwords, access credentials, payment credentials, medical data,
  and unrelated personal data.
- [ ] Import `CONTACT` and `mailtoHref`; when `CONTACT.email` exists, expose a mail link
  whose subject is `Datenschutzanfrage`. When it is absent, show the same honest
  configured-contact fallback pattern as `/support/anfrage/`.
- [ ] Link to `/datenschutz/`, `/support/anfrage/`, and `/contact/`.
- [ ] Add no `<form>`, endpoint, client submission code, logging, rate-limit bypass, or
  spam-protection replacement. The mail provider's current receipt path remains the
  only submission mechanism.

**Support reuse strategy:** the repository has no public support form or form endpoint.
The secure existing flow is a configured mailto/contact route into the current mailbox,
which is subsequently handled by the existing Inbox/IMAP/SMTP system. Reuse it with a
prefilled category subject; do not pretend a server-side form exists and do not modify
backend mail code.

**Interfaces consumed:** `CONTACT.email`, `mailtoHref()`, `BaseLayout`, site JSON-LD
helpers. **Interface produced:** a privacy-specific entry point into the existing email
support path.

## 4. Implement `/cookie-einstellungen/` with the real consent system

**File:** Create `storefront/src/pages/cookie-einstellungen.astro`.

- [ ] Build the page with `BaseLayout`, one H1, semantic H2 sections, breadcrumbs,
  consistent cards/spacing, and `noindex`.
- [ ] Describe only confirmed storage:
  - technically necessary `peptide_cart_id` local storage when a cart is used;
  - `pe_consent_v1` local storage for the versioned statistics decision;
  - optional Google Analytics `_ga` cookies only after statistics consent when
    analytics is configured.
- [ ] Do not state cookie lifetimes or storage durations beyond behavior directly
  proven in code, and do not add marketing, preferences, functional, or other invented
  categories/providers.
- [ ] Explain that optional statistics consent can be refused or withdrawn without
  blocking basic website use, and link to `/datenschutz/`.
- [ ] Branch server-rendered copy/control availability on `ANALYTICS_ENABLED`:
  - when false, state that optional analytics is not configured and render no dead
    settings button;
  - when true, render a native `type="button"` that imports and calls
    `requestConsentDialog()`.
- [ ] Render a labelled `role="status"`/`aria-live="polite"` current-state element.
  On load, call `readConsent()` and show one of: not yet decided, statistics allowed,
  or statistics rejected. Subscribe through the existing consent change interface and
  repaint after either dialog choice.
- [ ] Keep the actual accept/reject action in `ConsentBanner.astro`; the page button
  opens that real modal rather than duplicating its controls or writing local storage.
- [ ] Add explicit `:focus-visible` styling using existing color/radius tokens and
  preserve the native dialog's focus trap and non-dismissible decision requirement.

**Current consent implementation:** `pe_consent_v1` is the only consent record;
`statistics` is the only optional category; `PUBLIC_GA_MEASUREMENT_ID` controls whether
GA and the consent UI exist; `ConsentBanner` owns decisions; `requestConsentDialog()`
opens it; `readConsent()` and the change event expose state. The new page is only an
accessible view/controller for those existing interfaces.

**Interfaces consumed:** `ANALYTICS_ENABLED`, `readConsent()`,
`requestConsentDialog()`, and consent-change notification. **Interface produced:** a
permanent route that displays state and invokes the existing dialog.

## 5. Implement `/sicherheit/` without risky disclosure

**File:** Create `storefront/src/pages/sicherheit.astro`.

- [ ] Build an indexable trust page with `BaseLayout`, one H1, semantic H2 sections,
  breadcrumbs, factual title/description, and `WebPage` JSON-LD. Do not pass
  `noindex`; the established indexable output intentionally has no robots meta tag.
- [ ] Explain how to report suspected vulnerabilities, exposed personal information,
  authentication problems, shop-impersonation email, and privacy/infrastructure
  incidents.
- [ ] List safe useful context: affected public URL or feature, reproducible steps that
  do not cause harm, date/approximate time, relevant browser/device, and redacted
  screenshots.
- [ ] Warn against passwords, private keys, payment credentials, and unrelated personal
  data.
- [ ] State explicitly that this is not a public bug-bounty programme, no reward is
  promised, reports are reviewed without a response-time promise, and no outcome or
  security guarantee is made.
- [ ] Prohibit accessing/changing/downloading/deleting others' data, availability
  disruption, destructive automated testing, spam, and social engineering.
- [ ] Import `CONTACT` and `mailtoHref`; expose a configured mail link with a neutral
  security-report subject only when email exists, with honest fallback otherwise.
- [ ] Link to `/datenschutz-anfrage/`, `/datenschutz/`, and `/support/anfrage/`.
- [ ] Keep content at the public reporting-policy level. Include no hostnames beyond the
  public site, internal IPs, server paths, credentials, dependency/software versions,
  defensive architecture, or operational security controls.

**Interfaces consumed:** configured contact helpers and site metadata helpers.
**Interface produced:** a public, indexable responsible-reporting policy and contact
entry point.

## 6. Wire metadata and public discovery

**File:** Modify `storefront/src/lib/content-index.ts`.

- [ ] Add one `/sicherheit` entry to `STATIC_ROUTES` with a factual German title,
  description, appropriate trust-page keywords, `yearly` change frequency, and a low
  trust/legal-style priority consistent with nearby entries.
- [ ] Do not add `/datenschutz-anfrage` or `/cookie-einstellungen`; their deliberate
  absence keeps them out of `sitemap-pages.xml` and `llms.txt` through the existing
  single-source inventory.
- [ ] Do not add or edit sitemap handlers or `llms.txt.ts` unless verification proves
  the existing `STATIC_ROUTES` pipeline is insufficient. Any such discovery requires
  revising this plan before expanding scope.
- [ ] Keep `/datenschutz` absent from `STATIC_ROUTES` and keep its `draft` prop.

**Metadata mapping:** each route uses `BaseLayout`/`Seo` for one exact trailing-slash
self-canonical. The two private routes pass `noindex`; `/sicherheit` does not. No page
hand-writes canonical or robots tags.

**Interfaces consumed/produced:** one new `IndexedEntry` consumed by both the pages
sitemap and `llms.txt` generators.

## 7. Add contextual and footer links

**Files:**

- Modify `storefront/src/pages/datenschutz.astro`.
- Modify `storefront/src/pages/support/anfrage.astro`.
- Modify `storefront/src/layouts/BaseLayout.astro`.

- [ ] In `/datenschutz/`, add contextual links to `/datenschutz-anfrage/` and
  `/cookie-einstellungen/` near the rights and analytics/storage content; retain every
  existing section, placeholder, and the `draft` prop.
- [ ] In `/support/anfrage/`, change the existing Datenschutzanfrage category target
  from `/datenschutz/` to `/datenschutz-anfrage/`, retain the Datenschutz declaration
  link in its explanatory section, and add a contextual security-reporting link for
  suspicious or security-relevant technical issues.
- [ ] In the footer legal/trust area, add normal links to
  `/cookie-einstellungen/`, `/datenschutz-anfrage/`, and `/sicherheit/` in a compact,
  consistent order. Do not remove or rename existing links.
- [ ] Preserve the existing analytics-conditional footer button that directly opens
  the dialog. Distinguish its action label if necessary so both the settings-page link
  and immediate dialog action are understandable and non-duplicative.
- [ ] Keep the main navigation unchanged to avoid crowding it.

**Interfaces produced:** reciprocal discovery paths among Datenschutz, privacy request,
cookie settings, support, and security pages without indexing the two private routes.

## 8. Accessibility and visual verification

- [ ] Confirm German content throughout and exactly one H1 per page.
- [ ] Use semantic sections/headings, lists or definition lists, native links, and a
  native button; do not add click handlers to non-interactive elements.
- [ ] Give the cookie button an unambiguous accessible name and ensure its visible label
  describes opening the real settings dialog.
- [ ] Give current consent state an accessible labelled status with polite updates;
  do not announce hidden or unavailable controls.
- [ ] Confirm keyboard focus is visible for page links and the settings button using
  existing tokens, and that opening the consent dialog moves/traps focus according to
  the native dialog implementation.
- [ ] Confirm the unconfigured-analytics state contains no inert button.
- [ ] Reuse scoped styles and design tokens only; run the repository raw-hex check.
- [ ] Start the local storefront with `astro dev --background`, check all three pages at
  desktop and narrow width, tab through every control, exercise the consent dialog and
  state update, inspect both configured/unconfigured fallbacks as feasible, capture or
  inspect screenshots, then stop the server with `astro dev stop`.

## 9. Full verification and review handoff

- [ ] From `storefront/`, run the focused test without requiring a build:

  ```bash
  node --test src/lib/privacy-security-pages.test.ts
  ```

- [ ] Run the full storefront source-test and typecheck gates:

  ```bash
  npm test
  npm run typecheck
  ```

- [ ] Ensure the Medusa backend is available on port 9000, then build and rerun the
  focused/full tests so built-output assertions execute:

  ```bash
  npm run build
  node --test src/lib/privacy-security-pages.test.ts
  npm test
  ```

- [ ] Run the raw-color regression check from `storefront/`:

  ```bash
  grep -rnE '#[0-9a-fA-F]{3,8}\b' --include='*.astro' src | grep -vE '\-\-c-[a-z0-9-]+:\s*#|fill=|stroke='
  ```

- [ ] From the worktree root, run:

  ```bash
  git diff --check
  git status --short
  git diff --name-only
  ```

- [ ] Confirm the diff contains only the approved spec/status, this plan, the three new
  pages, focused storefront tests, and the specifically listed storefront link/index
  files. Confirm no backend, Inbox, IMAP, SMTP, checkout, product, category, price,
  ordering, dependency manifest, lockfile, `/status`, or `/cookies` file changed.
- [ ] Do not run backend gates unless a backend change becomes unavoidable. If that
  happens, stop implementation, document the conflict, revise the spec and plan, and
  obtain approval before proceeding.
- [ ] Leave all changes uncommitted on `feat/privacy-security-pages`; do not push,
  merge, or deploy. Report test results, manual-check results, and review paths.

## Known ambiguity and repository conflict

1. The request uses the phrase “support form” and asks to keep server validation, rate
   limiting, spam protection, and safe form errors active. The repository currently has
   no public support form or public form endpoint: `/support/anfrage/` explicitly
   forbids one, and the static storefront routes contact through configured email.
   Therefore there is no form validation/rate-limit interface to reuse or preserve.
   The approved resolution is to reuse the real configured email/Inbox path with a
   prefilled privacy subject and make no backend change.
2. There is no established storefront redirect mechanism and `/cookies/` does not
   exist. The approved resolution is not to create either one. The canonical settings
   route is only `/cookie-einstellungen/`.
3. The existing site represents `index, follow` by omitting a robots meta tag; only
   noindex pages emit one. `/sicherheit/` will follow that convention rather than add a
   redundant explicit directive.
4. `PUBLIC_GA_MEASUREMENT_ID` can be absent. In that build, the consent dialog does not
   render by design. The cookie page must report that analytics is not configured and
   must not render a non-functional settings action.
5. Production build validation depends on the Medusa catalog API at port 9000. A
   `fetch failed` build without it is an environment failure; start the backend and
   rerun before treating it as a regression.
