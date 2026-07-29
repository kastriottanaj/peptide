# Spec — Peptid-Rechner (reconstitution and aliquot calculator)

- **Date:** 2026-07-29
- **Status:** approved
- **Owner:** storefront

## Goal

Ship `/peptid-rechner`: a lab tool that turns three inputs — peptide amount per
vial, solvent volume, target amount per aliquot — into concentration, volume in
ml, and the reading on a U-100 syringe scale, with the arithmetic shown.

The `peptide` project runs the same tool at
`peptidebestellung.de/peptid-rechner`, where it is a standalone organic entry
point that ranks for "peptid rechner" and needs no catalog, no login and no
cart. That is the reason to build it here: it is the cheapest indexable page in
the whole storefront that people actively search for.

What transfers from the prior art is the **model** — the four inputs, the
formula chain, the syringe visual, the two warnings. What does not transfer is
the implementation: `components/tools/peptide-calculator.tsx` is a 1036-line
React client component built on Tailwind, `lucide-react` and `useState`. Here it
becomes an `.astro` component with a plain `<script>` island and scoped CSS on
the existing tokens.

## Scope

### The calculation

One pure module, `storefront/src/lib/reconstitution.ts`, so the arithmetic is
readable in isolation and has exactly one definition:

```
totalMcg       = vialMg × 1000
concentration  = totalMcg ÷ solventMl          (mcg/ml)
volumeMl       = targetMcg ÷ concentration     (ml)
units          = volumeMl × 100                (U-100 scale)
aliquots       = floor(totalMcg ÷ targetMcg)   (whole aliquots per vial)
mcgPerUnit     = concentration ÷ 100
```

Two derived warnings, both carried over from the prior art because both are real
usability failures rather than decoration:

- **overflow** — `units` exceeds the selected scale, so the result cannot be
  read off the chosen syringe at all. Offers the smallest scale that does fit.
- **low precision** — `units` is below 2, where a U-100 scale stops being
  legible. Suggests more solvent.

Inputs are invalid unless all three are `> 0`; the module returns a `valid: false`
result rather than `NaN`/`Infinity` leaking into the markup.

### The page

- **URL:** `/peptid-rechner`. German slug, matching the search term and the
  prior art's URL.
- **Inputs:** U-100 scale (0,3 ml / 0,5 ml / 1,0 ml), vial amount (5 / 10 / 15
  mg), solvent volume (1 / 2 / 3 / 5 ml), target per aliquot (50 / 100 / 250 /
  500 mcg) — each preset row backed by a free-text field for any other value.
  German decimal comma accepted on input (`2,5` → `2.5`).
- **Outputs:** the headline reading in units, an SVG syringe scale with a
  labelled marker, four stats (concentration, volume per aliquot, aliquots per
  vial with remainder, amount per unit), and a "So entsteht das Ergebnis" table
  showing each formula step with the current numbers substituted in.
- **Renders complete without JavaScript.** The default setup (5 mg / 1 ml / 50
  mcg) is computed at build time and written into the HTML — headline, scale,
  stats and formula rows all filled in. The island only recomputes on input.
  This is what makes the page worth indexing: a crawler that never runs our
  script still sees a working worked example, not an empty shell.
- Numbers are formatted with `Intl.NumberFormat("de-DE")` at both build time and
  run time, from the same helper, so the pre-rendered and re-rendered strings
  cannot disagree.

### Compliance framing

This is the one place where a wrong word matters more than a wrong pixel. The
storefront sells research-use-only material, and a calculator is the page most
easily read as dosing guidance. The prior art's neutral vocabulary is kept
deliberately and is part of this spec, not incidental copy:

- "Zielmenge pro Aliquot", never "Dosis"; "Aliquot", never "Injektion".
- No body weight, no frequency, no schedule, no per-peptide recommended amounts
  — the tool converts units and nothing else.
- The existing research-use disclaimer appears on the page.

### Placement and discovery

- Header nav gains "Rechner" (fifth item, after "Zertifikate"); the footer
  "Wissen" column gains "Peptid-Rechner". Both in `BaseLayout.astro`.
- `content-index.ts` gains the route at priority **0.75**, `changefreq monthly`
  — the tools band in `AGENTS.md`. It reaches the pages sitemap and `llms.txt`
  from that one entry, per the module's existing contract.
- JSON-LD: a `WebApplication` node (`applicationCategory: UtilitiesApplication`,
  `offers` at price 0 EUR — it is free to use), a `BreadcrumbList`, and a
  `FAQPage` for the three questions the page answers in prose. `Organization` is
  referenced by `@id` as publisher, per the SEO baseline.

### Non-goals

- **No query-string state** (`?vial=5&ml=1`). Shareable setups would create
  faceted near-duplicates of an otherwise clean URL and pull the
  `noindex, follow` machinery onto a page that does not need it. If it is wanted
  later it is a deliberate SEO decision, not a free feature.
- **No `/peptide-rechner` alias.** The prior art carries one; one canonical URL
  is better than a redirect stub in a static build.
- **No catalog coupling.** Vial presets stay the fixed 5/10/15 mg rather than
  being read from Medusa variants. Reading them would tie a build-time fetch and
  the placeholder catalog to a page that currently needs neither.
- **No WebMCP tool** and **no GA events** for calculator use. Both are plausible
  follow-ups; neither is needed for the page to be complete.
- **No new consent surface.** The calculator runs entirely in the browser, sends
  nothing anywhere, and stores nothing — so it needs no consent category and no
  Datenschutz change.

## Files

| File | Change |
| --- | --- |
| `storefront/src/lib/reconstitution.ts` | new — pure math, input parsing, de-DE formatting |
| `storefront/src/components/ReconstitutionCalculator.astro` | new — markup, scoped CSS, `<script>` island |
| `storefront/src/pages/peptid-rechner.astro` | new — hero, prose, FAQ, SEO props, JSON-LD |
| `storefront/src/lib/content-index.ts` | edit — `STATIC_ROUTES` entry at 0.75 |
| `storefront/src/layouts/BaseLayout.astro` | edit — header nav + footer link |

No backend change, so only the storefront gate runs.

## Verification

```bash
cd storefront
npm run typecheck                 # astro check
npm run build                     # needs the backend on :9000
grep -rnE '#[0-9a-fA-F]{3,8}\b' --include='*.astro' src \
  | grep -vE '\-\-c-[a-z0-9-]+:\s*#|fill=|stroke='   # must stay empty
```

Manual, in the dev server:

1. Default state shows **1 Unit** for 5 mg / 1 ml / 50 mcg, with 5.000 mcg/ml,
   0,01 ml, 100 aliquots, 50 mcg per unit.
2. Every preset button and every custom field updates all outputs, and `2,5`
   with a comma parses as 2,5.
3. 5 mg / 5 ml / 500 mcg on the 0,3 ml scale triggers the overflow warning, and
   its "switch scale" button selects the 50-unit scale.
4. 15 mg / 1 ml / 50 mcg triggers the low-precision warning.
5. Zero or empty input shows the "Bitte Werte eingeben" state, never `NaN`.
6. **With JavaScript disabled**, the page still shows the complete default
   result and reads as a finished document.
7. Keyboard-only: every control reachable and operable, `aria-pressed` on the
   preset buttons, the result region announced via `aria-live`.
8. 375 px viewport: no horizontal scroll, the syringe SVG scales down intact.
9. `curl -s localhost:4321/sitemap-pages.xml | grep peptid-rechner` returns the
   entry, and `/llms.txt` lists the page.
