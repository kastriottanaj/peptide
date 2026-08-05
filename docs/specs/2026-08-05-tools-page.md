# Tools page

**Date:** 2026-08-05
**Status:** Approved 2026-08-05

## Goal

Create an indexable German `/tools/` landing page in the Astro storefront that
recreates the supplied reference page's information hierarchy and visual character:
a product-data introduction, a responsive grid of seven tool cards, and a prominent
Peptid-Rechner callout. The page will use this repository's brand, shared layout,
design tokens, routes, and SEO infrastructure rather than copying the prior Next.js
implementation.

## Current implementation findings

- The reference implementation is `app/tools/page.tsx` in the read-only `peptide`
  project. It defines seven cards and a calculator callout, but its Next.js,
  Tailwind, Lucide, and shared-component code does not transfer to Astro.
- The current storefront already has usable destinations for COA information
  (`/qualitaet-analyse/`), the calculator (`/peptid-rechner/`), product comparison
  (`/produkte/`), product questions (`/support/anfrage/`), storage guidance
  (`/wissen/lagerung-lyophilisierter-peptide/`), and support
  (`/support/anfrage/`).
- `/stack-builder/` is not present on `origin/main`. The Stack-Builder card will remain
  visible for fidelity but link to `/produkte/`, the closest live product-selection
  destination, so this page does not introduce a broken link. A later Stack-Builder
  change can update that single destination.
- `BaseLayout.astro` owns the header, footer, metadata integration, global tokens, and
  page container. The new page can use `wide` for its tinted full-width section while
  retaining the shared header and footer.
- Static discovery is centralized in `src/lib/content-index.ts`; the new route must be
  added there for the pages sitemap and language-model discovery outputs.

## Scope

- Create `/tools/` as a static Astro page with:
  - the eyebrow “Produktdaten”;
  - the H1 “Rechner, COA-Zertifikate und Produktvergleich”;
  - the supplied introductory copy;
  - seven linked cards in the supplied order, with small inline SVG icons, accessible
    link names, hover treatment, and visible keyboard focus;
  - a full-width dark calculator callout linking to `/peptid-rechner/`;
  - responsive three-, two-, and one-column layouts without horizontal overflow.
- Match the reference's spacious pale-blue section, white rounded cards, green icon
  treatments, and navy callout using existing CSS custom properties only.
- Add a `Tools` link to the shared header navigation and a Tools entry in the existing
  footer navigation, without otherwise redesigning either shared region.
- Add unique metadata, a self-canonical URL through `BaseLayout`/`Seo`, a
  `CollectionPage` JSON-LD node for the listed resources, and a breadcrumb node.
- Add `/tools` once to the static content index so it appears once in the pages sitemap
  and the relevant text discovery outputs.
- Add focused regression coverage for route output, metadata, structured data,
  destinations, discovery, accessibility hooks, and the raw-hex rule.

## Non-goals

- No implementation of Stack-Builder, certificate lookup, product comparison logic,
  product enquiry forms, or new calculator functionality.
- No new dependency, framework island, client-side JavaScript, image asset, Tailwind,
  React, or Lucide package.
- No direct copy of the prior site's header, footer, logo, cookie behavior, or
  unimplemented routes.
- No changes to products, catalog data, prices, orders, checkout, analytics, consent,
  legal drafts, backend APIs, Medusa, or the `ORDERS_ENABLED` launch gate.
- No removal or weakening of the existing research-use language.
- No deployment. Commit and push will occur only after the page is locally verified
  and the work is a finished unit, as required by repository rules.

## Concrete file changes

- Create `storefront/src/pages/tools.astro`.
- Modify `storefront/src/layouts/BaseLayout.astro` to expose the Tools route in the
  header and footer.
- Modify `storefront/src/lib/content-index.ts` to add the indexable static route.
- Create `storefront/src/lib/tools-page.test.ts` with focused output and source checks.
- Create `docs/plans/2026-08-05-tools-page.md` after this spec is approved.

## Verification

Run from `storefront/` unless otherwise stated:

```bash
node --test src/lib/tools-page.test.ts
npm test
npm run typecheck
npm run build
grep -rnE '#[0-9a-fA-F]{3,8}\b' --include='*.astro' src | grep -vE '\-\-c-[a-z0-9-]+:\s*#|fill=|stroke='
```

The build requires Medusa on port 9000 because catalog routes are generated at build
time. After the build, focused checks will verify:

- `/tools/` exists with one H1, a unique title and description, its self-canonical,
  and indexable robots metadata;
- the `CollectionPage` and breadcrumb structured data use absolute canonical URLs;
- all seven cards and the calculator CTA resolve to existing local routes, with no
  placeholder or empty link;
- `/tools` occurs exactly once in the pages sitemap and discovery text;
- the shared header and footer each expose the route;
- the page adds no hydrated island or page-specific client script;
- linked cards have descriptive text and visible `:focus-visible` treatment;
- no raw CSS colour literal is introduced outside the shared token definitions.

Also run from the worktree root:

```bash
git diff --check
git status --short
```

Perform a local browser check with the Astro development server at desktop and narrow
viewport widths. Compare against the supplied `tools.png` for section spacing, card
grid proportions, icon treatments, type hierarchy, callout prominence, footer
transition, focus states, wrapping, and absence of horizontal scrolling. Follow every
card and navigation link to confirm the destination is live.
