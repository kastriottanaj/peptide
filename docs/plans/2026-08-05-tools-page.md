# Tools page implementation plan

**Date:** 2026-08-05
**Status:** Implemented 2026-08-05 — awaiting review
**Approved spec:** `docs/specs/2026-08-05-tools-page.md`

## 1. Lock down the page contract with tests

**File:** Create `storefront/src/lib/tools-page.test.ts`.

- [x] Assert the route source, seven cards, live local destinations, calculator CTA,
  shared navigation links, discovery entry, no client island/script, focus styling,
  and design-token-only CSS.
- [x] Add built-output assertions for the H1, title, description, canonical,
  indexability, JSON-LD, sitemap/discovery presence, and internal links.

**Interfaces consumed:** Astro source files and built `dist/` output.
**Interface produced:** focused regression coverage for `/tools/`.

## 2. Build the static Astro page

**File:** Create `storefront/src/pages/tools.astro`.

- [x] Define the seven resources once and render semantic linked cards in the supplied
  order, using inline SVG icons with `aria-hidden="true"`.
- [x] Add `CollectionPage` and breadcrumb JSON-LD using `canonicalUrl()`,
  `breadcrumbNode()`, and the shared Organization `@id`.
- [x] Recreate the pale-blue directory section and navy calculator callout with scoped
  responsive CSS and existing design tokens.
- [x] Add descriptive focus, hover, reduced-motion, tablet, and mobile behavior with
  no page-specific JavaScript.

**Interfaces consumed:** `BaseLayout`, shared tokens, site URL helpers, and live local
routes. **Interface produced:** static, indexable `/tools/` HTML.

## 3. Integrate navigation and discovery

**Files:** Modify `storefront/src/layouts/BaseLayout.astro` and
`storefront/src/lib/content-index.ts`.

- [x] Replace the header's direct calculator entry with `Tools` and add `Tools` beside
  the existing calculator entry in the footer Wissen column.
- [x] Add `/tools` exactly once to `STATIC_ROUTES` with monthly change frequency and
  tool-focused description and keywords.

**Interfaces consumed:** shared navigation and static discovery registry.
**Interfaces produced:** site-wide entry points, sitemap entry, and llms entry.

## 4. Verify, visually inspect, and deliver

- [x] Run the focused test, full tests, typecheck, build, raw-hex scan, and
  `git diff --check`.
- [x] Start Astro in background mode and inspect desktop and mobile screenshots against
  the supplied reference, including keyboard focus and every destination.
- [x] Review the final diff and clean status, mark this plan implemented, then commit
  and push the finished feature branch. Do not deploy.

**Verification commands:** those listed in the approved spec.
