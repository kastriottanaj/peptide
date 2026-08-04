# Homepage CRO Redesign

- Date: 2026-08-05
- Status: Approved — 2026-08-05

## Goal

Redesign the German storefront homepage to follow the supplied CRO/SEO mockup's
composition: a premium navy hero, restrained gold announcement bar, green primary
accents, a server-rendered featured-product card, compact factual trust navigation,
quality/transparency content, research-category navigation, and a closing CTA. The
result must preserve the production brand, Astro/Medusa architecture, established
metadata, accessibility, and the current ordering-disabled state.

The current homepage metadata remains unchanged:

- Title: `Peptide kaufen in Deutschland für Forschung & Analyse`
- Description: `Forschungspeptide für Labor und Analyse mit klaren Produktdaten, Packgrößen und COA-Status. Jetzt Produkte vergleichen!`

## Scope

- Keep `BaseLayout.astro` as the owner of the announcement bar, production header,
  search form, responsive navigation, footer, consent UI, and SEO component.
- Rebuild the homepage with exactly one H1:
  `Forschungspeptide in Deutschland kaufen`, with any highlighted continuation kept
  inside that H1.
- Create a responsive two-column desktop hero and stacked mobile hero. Use a
  purpose-generated, text-free abstract molecular/labor background as a decorative
  image with a dark overlay, explicit dimensions, responsive delivery, and no factual
  or medical implication.
- Render the featured-product card from the existing Medusa catalog query. Select the
  first product carrying a `research_code`, as the current homepage does, rather than
  hard-coding BPC-157 or a "Top product" rule. Show only real title, URL, thumbnail,
  calculated variant price, variant/pack-size data, and metadata fields that actually
  exist. Missing values receive neutral fallbacks. The CTA is `Produkt ansehen`.
- Add a factual trust/navigation strip linked to existing pages for quality/analysis,
  research-use restrictions, shipping/payment information, and support. It will not
  contain ratings, review counts, delivery SLAs, payment guarantees, or universal COA
  claims.
- Add three compact linked quality/transparency cards covering analysis information,
  certificates/documentation, and shipping information. Copy will be qualified and
  aligned with the linked repository pages.
- Replace the mockup's testimonial concept with a dark `Qualität und Transparenz im
  Überblick` section linking to `/qualitaet-analyse/`, `/forschungszwecke/`,
  `/redaktionsrichtlinien/`, and `/faq/`.
- Render four research-category cards for the required existing category handles,
  using catalog category names/descriptions where available and conservative repository
  fallback copy otherwise. Each card has a decorative accessible icon treatment and a
  descriptive `Produkte ansehen` link.
- Add a restrained final CTA titled `Forschungsprodukte und Informationen entdecken`
  with links to `/produkte/` and `/support/anfrage/`.
- Add an optional mobile sticky `Produkte ansehen` link that is non-transactional,
  keyboard accessible, respects safe-area insets, and does not obscure footer content.
- Preserve the existing WebSite and FAQPage JSON-LD nodes, canonical behavior,
  indexability, German language, and current approved homepage metadata. Revise FAQ
  wording only where the current homepage incorrectly describes an enabled checkout or
  contains placeholders, keeping rendered FAQ content and JSON-LD sourced from the same
  array.
- Use only existing global design tokens. Any genuinely missing reusable color/shadow
  values will be added as named tokens in `BaseLayout.astro`; no component-level raw
  color literals will be introduced.

## Non-goals

- No checkout, cart, add-to-cart, `Jetzt bestellen`, or order-enablement changes.
- No backend, Medusa model, seed, migration, catalog record, or database changes.
- No redesign of the shared header, search, navigation, footer, consent banner, or
  non-homepage pages.
- No fake reviews, testimonials, people, credentials, ratings, purity values, COA
  availability, delivery promises, payment guarantees, medical claims, or "Top
  product" label.
- No change to the approved homepage title, description, canonical, robots policy,
  Organization/WebSite ownership, or language attributes.
- No client framework, carousel, animation library, or additional runtime dependency.
- No commit, push, merge, deployment, or production data mutation.

## Concrete File Changes

- `storefront/src/pages/index.astro`
  - Rebuild homepage markup, data shaping, factual content, structured data inputs,
    responsive CSS, featured-product presentation, and non-transactional mobile CTA.
- `storefront/public/images/homepage-scientific-hero.webp`
  - Add one optimized, text-free decorative scientific hero image generated for this
    layout. It will contain no logo, product, person, certificate, or factual claim.
- `storefront/src/lib/homepage-output.test.ts`
  - Add focused source/output regression coverage for one H1, section hierarchy,
    required links and category handles, real featured-product data bindings, factuality
    exclusions, ordering-disabled presentation, canonical/robots behavior, navigation
    accessibility invariants, and image loading/dimensions.
- `storefront/src/layouts/BaseLayout.astro` (only if required)
  - Add narrowly scoped global design token(s); shared header/navigation behavior and
    markup remain unchanged.
- Existing homepage-sensitive tests such as `images.test.ts`,
  `metadata-output.test.ts`, `canonical.test.ts`, `faq-output.test.ts`, or
  `operational-claims.test.ts` will be adjusted only if their assertions correctly need
  to reflect the approved homepage structure.

## Performance and Accessibility

- Homepage content and product data remain server-rendered Astro HTML.
- The hero background will be compressed WebP, rendered responsively with dimensions
  that reserve space; the featured product image keeps explicit dimensions and is the
  only eligible eager product image.
- Below-the-fold content images remain lazy loaded. No Medusa SDK is added to the page
  bundle and no new client script is introduced except a CSS-only sticky link if used.
- The page uses semantic sections and landmarks, one H1, sequential H2/H3 headings,
  descriptive links, decorative-image empty alt text, meaningful product alt text,
  visible existing focus styles, sufficient token-based contrast, and overflow-safe
  mobile layouts.

## Verification

From `storefront/`:

```bash
node --test src/lib/homepage-output.test.ts
npm test
npm run typecheck
npm run build
grep -rnE '#[0-9a-fA-F]{3,8}\b' --include='*.astro' src | grep -vE '\-\-c-[a-z0-9-]+:\s*#|fill=|stroke='
```

From the worktree root:

```bash
git diff --check
git status --short
```

Manual checks:

- Run the backend on `:9000`, then start the storefront with
  `astro dev --background` and inspect the homepage at desktop and mobile widths.
- Confirm the current brand/header/search/mobile menu/consent behavior still works.
- Confirm one H1, sequential section headings, keyboard focus, no horizontal overflow,
  no obscured content, and graceful featured-product behavior with missing metadata or
  image data.
- Confirm every homepage link resolves to the intended existing route.
- Confirm there is no cart/add-to-cart/checkout control or transactional mobile CTA on
  the homepage and that `ORDERS_ENABLED` remains untouched.
- Capture desktop and mobile screenshots for review before any git discussion.
- Confirm Inbox, IMAP, SMTP, backend, consent, and shared operational code has no diff.

If the production build cannot fetch the catalog, start the local Medusa backend and
rerun it before treating the failure as a code regression.
