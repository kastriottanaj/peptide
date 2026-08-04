# Privacy and security pages

**Date:** 2026-08-05
**Status:** Approved 2026-08-05

## Goal

Add three German trust and privacy routes that match the existing Astro storefront,
reuse its configured contact and consent mechanisms, and publish only the security
page through search and language-model discovery:

- `/datenschutz-anfrage/`
- `/cookie-einstellungen/`
- `/sicherheit/`

## Current implementation findings

- `/support/anfrage/` is intentionally a routing page without a form. The static
  storefront has no public support-form endpoint; contact is made through channels
  resolved from `PUBLIC_CONTACT_EMAIL` and the shared contact page. The new privacy
  and security pages will reuse this mechanism rather than introduce a form or change
  Inbox/SMTP behavior.
- Consent is owned by `src/lib/consent.ts` and `ConsentBanner.astro`. It stores the
  versioned `pe_consent_v1` record in `localStorage`, exposes
  `requestConsentDialog()`, and can report the current `statistics` choice through
  `readConsent()`.
- The cart identifier `peptide_cart_id` is stored in `localStorage` when a cart is in
  use. Analytics is optional and exists only when `PUBLIC_GA_MEASUREMENT_ID` is set.
  Google Analytics is loaded only after statistics consent and may then set `_ga`
  cookies; withdrawing consent disables measurement and clears those cookies.
- There is no established redirect table or Astro redirect mechanism for public
  storefront pages. `/cookies/` does not exist, so this change will not create it or a
  bespoke redirect mechanism.
- Static discovery is controlled centrally by `src/lib/content-index.ts`. Adding only
  `/sicherheit` there includes it in the pages sitemap and `llms.txt` while keeping the
  two `noindex` routes out of both.

## Scope

### Privacy requests

Create `src/pages/datenschutz-anfrage.astro` with one H1, breadcrumbs, factual metadata,
and `noindex, nofollow`. It will:

- explain Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung,
  Datenübertragbarkeit, Widerspruch, Widerruf einer Einwilligung, and other privacy
  requests;
- explain that proportionate identity verification may be necessary;
- explicitly reject passwords, payment credentials, medical data, unnecessary ID
  documents, and unsolicited uploads;
- link to `/datenschutz/`, `/support/anfrage/`, and the existing contact page;
- render the verified configured email only through `CONTACT.email`, and, when present,
  offer a `mailto:` link with a `Datenschutzanfrage` subject so the existing email,
  Inbox, spam filtering, and SMTP infrastructure remain unchanged;
- make no response-time promise and add no form, upload, logging, or backend endpoint.

Update the Datenschutz section of `/support/anfrage/` to route privacy requests to this
new page. Add contextual links from `/datenschutz/` to the privacy-request and cookie
settings pages without removing its `draft` state.

### Cookie and consent settings

Create `src/pages/cookie-einstellungen.astro` with one H1, breadcrumbs, factual
metadata, and `noindex, nofollow`. It will:

- distinguish technically necessary local storage from optional Google Analytics;
- describe only the storage and cookies confirmed in the implementation;
- state that rejecting statistics does not prevent basic site use;
- link to `/datenschutz/`;
- show whether statistics are not configured, undecided, allowed, or rejected;
- provide a keyboard-operable button that calls the existing
  `requestConsentDialog()` API when analytics is configured, then refreshes the visible
  state after the existing `consent:changed` event;
- show an accurate non-interactive explanation instead of a dead button when analytics
  is not configured.

The footer's existing consent button remains functional. Its legal/trust area will
also link to the dedicated settings route, without introducing a second consent
system.

### Security reporting

Create `src/pages/sicherheit.astro` with one H1, breadcrumbs, factual `WebPage` JSON-LD,
and indexable metadata. It will:

- cover vulnerability reports, exposed personal information, authentication issues,
  impersonation emails, and privacy or infrastructure incidents;
- list useful, safely shareable report details and instruct reporters to redact
  screenshots;
- prohibit passwords, private keys, payment credentials, and unrelated personal data;
- state that this is not a public bug-bounty programme, no reward is promised, and no
  response time is promised;
- set clear boundaries against accessing or changing others' data, availability
  disruption, destructive automation, spam, and social engineering;
- use `CONTACT.email` and a prefilled security-report subject when configured, plus link
  to `/datenschutz-anfrage/`, `/datenschutz/`, and `/support/anfrage/`;
- disclose no infrastructure identifiers, internal paths, credentials, versions, or
  security controls.

Add the security page exactly once to `STATIC_ROUTES`, which places it exactly once in
the pages sitemap and `llms.txt`. Add a contextual link from `/support/anfrage/` and a
single consistent footer trust link.

## Non-goals

- No `/status/` or `/cookies/` page and no new redirect subsystem.
- No new public form, file upload, API route, database model, backend workflow, spam
  system, rate limiter, email behavior, Inbox behavior, or SMTP behavior.
- No change to products, catalog categories, carts, checkout, ordering, prices, or the
  `ORDERS_ENABLED` launch gate.
- No change to analytics providers, consent categories, consent defaults, retention
  claims, or measurement behavior.
- No removal of `draft` from `/datenschutz/` or any other legal draft.
- No invented legal entity, processor, SLA, policy date, bug-bounty reward, guarantee,
  or infrastructure detail.
- No new dependency, separate layout, or new visual design system.
- No commit, push, merge, or deployment.

## Concrete file changes

- Create `storefront/src/pages/datenschutz-anfrage.astro`.
- Create `storefront/src/pages/cookie-einstellungen.astro`.
- Create `storefront/src/pages/sicherheit.astro`.
- Modify `storefront/src/pages/datenschutz.astro` with contextual links while retaining
  `draft`.
- Modify `storefront/src/pages/support/anfrage.astro` to route privacy and security
  topics to the new pages.
- Modify `storefront/src/layouts/BaseLayout.astro` with consistent footer links while
  preserving the existing consent-dialog control.
- Modify `storefront/src/lib/content-index.ts` to index `/sicherheit` only.
- Create focused storefront tests (one or more `src/lib/*.test.ts` files) covering
  routes, metadata, discovery, links, contact/consent integration, content safety, and
  interactive accessibility.

No backend file is expected to change because the existing support path is configured
email, not a server-side form endpoint.

## Verification

Run from `storefront/` unless otherwise stated:

```bash
node --test src/lib/privacy-security-pages.test.ts
npm test
npm run typecheck
npm run build
```

The build requires the Medusa backend on port 9000 because catalog routes are generated
at build time. After the build, focused tests will verify:

- all three built routes exist and use their exact self-canonical URLs;
- `/datenschutz-anfrage/` and `/cookie-einstellungen/` are `noindex, nofollow`, while
  `/sicherheit/` is `index, follow`;
- only `/sicherheit/` occurs exactly once in the public pages sitemap and `llms.txt`;
- the new internal links resolve and `/datenschutz/` remains `noindex, nofollow`;
- privacy requests reuse configured email/support routing without a new form or upload;
- the cookie settings button invokes the existing consent API, exposes an accessible
  current-state status, and is absent as an action when analytics is unavailable;
- security copy contains the required reporting boundaries and no placeholder,
  credential, internal path, IP address, software-version, or unsupported SLA text;
- interactive controls have accessible names, keyboard-native elements, and visible
  focus styling;
- existing support Inbox and SMTP implementation files are unchanged.

Also run from the worktree root:

```bash
git diff --check
git status --short
```

Perform a local browser check with the Astro development server for desktop and narrow
viewport layout, keyboard focus, the consent-dialog reopening action, current-state
updates, configured/unconfigured contact fallbacks, and all contextual links. Backend
tests and lint are required only if implementation discovers that a backend change is
unavoidable; that would first require revising and re-approving this spec.
