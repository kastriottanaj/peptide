# Plan — Peptid-Rechner

Spec: [docs/specs/2026-07-29-peptid-rechner.md](../specs/2026-07-29-peptid-rechner.md)
(approved 2026-07-29). Scope confirmed standalone; linked from header nav and footer.

## Task 1 — The math module

**Creates:** `storefront/src/lib/reconstitution.ts`

Pure, no DOM, no Astro imports — so the same functions run at build time in the
component frontmatter and at run time in the island.

- [ ] `parseDecimal(value: string): number` — trims, accepts a German decimal
      comma, returns `0` for anything non-finite.
- [ ] `formatDe(value: number, digits?: number): string` — one
      `Intl.NumberFormat("de-DE")` wrapper, so build-time and run-time strings
      are produced by identical code.
- [ ] `SYRINGE_SCALES` — the three U-100 scales (30/50/100 units) with German
      labels; `VIAL_PRESETS`, `SOLVENT_PRESETS`, `TARGET_PRESETS`.
- [ ] `DEFAULT_SETUP` — 5 mg / 1 ml / 50 mcg on the 30-unit scale. The single
      definition of what the page renders before any interaction.
- [ ] `calculate(input: ReconstitutionInput): ReconstitutionResult` — the
      formula chain from the spec, plus `overflow`, `lowPrecision`,
      `suggestedScale`, `aliquots`, `remainingMcg`, `fillPct`. Returns
      `valid: false` with zeroed numbers unless all three inputs are `> 0`.
- [ ] `formulaSteps(result)` — the four label/expression rows of the
      "So entsteht das Ergebnis" table, built from the same numbers so the shown
      arithmetic cannot drift from the computed answer.

**Produces:** `calculate`, `formatDe`, `parseDecimal`, `formulaSteps`, the preset
constants and the two result types.

## Task 2 — The calculator component

**Creates:** `storefront/src/components/ReconstitutionCalculator.astro`
**Consumes:** everything from Task 1.

- [ ] Frontmatter calls `calculate(DEFAULT_SETUP)` and renders every output —
      headline, stats, formula rows, marker position — into the HTML. Nothing is
      left blank for the script to fill in.
- [ ] Inputs: three `radiogroup`-style preset rows plus a custom field each, and
      the scale picker. Native `<input type="radio">` where possible so keyboard
      and screen-reader behaviour comes for free rather than being reimplemented
      with `aria-pressed` on buttons.
- [ ] The syringe scale as inline SVG with a `viewBox` and no fixed width;
      ticks generated per scale. Colours via `currentColor` and CSS custom
      properties — the `fill=`/`stroke=` exception in `AGENTS.md` is for the
      decorative product vial, and is not a licence to inline new hex here.
- [ ] Result region wrapped in `aria-live="polite"` so recalculation is
      announced once, not per-field.
- [ ] `<script>` island: reads the controls, calls `calculate`, writes the
      results back through `data-` hooks. Plain bundled script, the
      `AddToCart.astro` pattern — no framework, no `client:*` directive.
- [ ] Scoped `<style>` on the existing tokens only.

**Verify:** `npm run typecheck`.

## Task 3 — The page

**Creates:** `storefront/src/pages/peptid-rechner.astro`
**Consumes:** Task 2, `BaseLayout`, `breadcrumbNode`/`absoluteUrl`/`ORGANIZATION_ID`.

- [ ] Hero: eyebrow, `h1`, lead paragraph, the three highlight cards.
- [ ] The calculator.
- [ ] Prose below it: how the formula works, what the two warnings mean, and the
      FAQ — the part that actually ranks. Neutral vocabulary per the spec, plus
      the research-use disclaimer.
- [ ] `jsonLd`: `WebApplication` + `BreadcrumbList` + `FAQPage`, publisher by
      `@id`. Unique title and description; canonical is automatic.

**Verify:** `npm run typecheck`.

## Task 4 — Discovery

**Modifies:** `storefront/src/lib/content-index.ts`, `storefront/src/layouts/BaseLayout.astro`

- [ ] `STATIC_ROUTES` entry: `/peptid-rechner`, `changefreq monthly`, priority
      `0.75`. Reaches the pages sitemap and llms.txt from this one edit.
- [ ] Header nav: "Rechner" after "Zertifikate". Check the 820 px breakpoint
      still fits five items.
- [ ] Footer "Wissen" column: "Peptid-Rechner".

## Task 5 — Verify and commit

- [ ] `npm run typecheck` and `npm run build` (backend on :9000).
- [ ] The no-raw-hex grep returns nothing.
- [ ] Walk the nine manual checks in the spec's Verification section, including
      JS-disabled and 375 px, with screenshots.
- [ ] `git status --short`, then one commit, then push.
