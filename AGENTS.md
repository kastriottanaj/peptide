# Project & Agent Rules

`AGENTS.md` is the single committed source of truth for this repository's project and
agent rules. `CLAUDE.md` and `storefront/AGENTS.md` are adapters that point here — do
not duplicate rules in them.

Do not create or use numbered copies like `AGENTS 2.md`, `README 2.md` or `deploy 2.sh`.

## Stack

| Path                    | Stack                                  | Dev URL                    |
| ----------------------- | -------------------------------------- | -------------------------- |
| `storefront/`           | Astro 7, plain CSS, `@medusajs/js-sdk`  | http://localhost:4321      |
| `backend/`              | Turbo workspace wrapper                 | —                          |
| `backend/apps/backend/` | Medusa v2 (`@dtc/backend`) + Postgres   | :9000, admin at `/app`     |

No Tailwind, no React/Next.js, no Django. Prior art from the separate `peptide` project
(`~/Desktop/peptide`, Next.js + Django, live at `peptidebestellung.de`) is worth reading
for *what* it solved, but its Tailwind classes, `generateMetadata`, Django models and
custom `/ops` admin do not transfer — translate the intent into this stack instead.

Storefront copy is German (`/produkte`, "Packgröße", "Verfügbar"). Code, comments,
commit messages and these rules are English.

## Working style

- Multiple AI agents may work on this repo in parallel. Nothing is pushed or released
  automatically as a side effect of a single change.
- Every change is made ship-ready: verify locally, commit cleanly, push. Anything
  beyond that happens only for a finished unit of work or on explicit user approval.
- For small UI or copy changes, make the result visible locally first (dev server,
  screenshot) and only then sort out git. Do not spend minutes on git plumbing before
  the visible result has been checked.
- Work in an isolated worktree off `origin/main` rather than continuing in a divergent
  local branch. In Claude Code use the built-in worktree support; otherwise
  `git worktree add`.
- If a local git operation hangs for more than 60–90 seconds with no output, abort it.
  Do not run further risky git operations in the same worktree — check
  `git worktree list --porcelain` / `git worktree prune --verbose` and continue in a
  fresh checkout of `origin/main`.
- If `origin/main` is ahead of local, fetch and rebase the other agent's commits first,
  then re-run the checks. Never overwrite newer work with an older state.
- Never commit secrets, API keys or credentials. `.env` files stay git-ignored; document
  new variables in `README.md` and `.env.template` instead. The publishable key and
  `region_id` are read from `storefront/.env` — never pasted into committed code or docs.

## Non-trivial work: spec, then plan, then build

For anything larger than a contained fix, write the design down before implementing —
the `peptide` project's most reusable habit. Keep both under `docs/`:

- **Spec** (`docs/specs/YYYY-MM-DD-<slug>.md`): date, status, goal, scope, explicitly
  listed *non-goals*, the concrete file changes, and a **Verification** section naming
  the commands and the manual checks.
- **Plan** (`docs/plans/YYYY-MM-DD-<slug>.md`): tasks broken into checkbox steps, each
  task listing the files it creates/modifies and the interfaces it produces or consumes,
  ending in a verify + commit step.

Get the spec approved before writing the plan; state non-goals explicitly so scope does
not drift mid-implementation.

## Quality gates

Before every commit, and never on top of foreign or not-understood local changes:

```bash
git status --short
```

Storefront (`cd storefront`):

```bash
npm run typecheck   # astro check
npm run build
```

`npm run build` fetches the catalog from Medusa in `getStaticPaths`, so the backend must
be running on :9000 first or the build fails with `fetch failed`. That is an environment
problem, not a code regression — start the backend and re-run before investigating.

Backend (`cd backend`):

```bash
npm run lint        # turbo → medusa lint
npm run build
npm run test
```

Run the gate for the app you touched; if a change crosses both (a new Medusa field
consumed by an Astro page), gate both.

## Backend — Medusa v2

- **Do not rebuild what Medusa already ships.** The `peptide` project needed a large
  custom admin because Next.js gave it no backend; here the Medusa admin at
  `/app` already covers orders, inventory, customers, discounts and payments. Reach for
  a custom admin route only when the built-in dashboard genuinely cannot express it.
- Schema changes go through Medusa migrations and module models. Never hand-edit the
  `medusa_peptides` Postgres database to work around a model change.
- Catalog changes belong in a seed script under `src/scripts/` (see
  `seed-peptides.ts`) so another agent can reproduce the state — not in ad-hoc SQL.
- Custom endpoints go in `src/api/store/**` and `src/api/admin/**`; background work in
  `src/subscribers/` and `src/jobs/`; multi-step business logic in `src/workflows/`
  rather than inline in a route handler.
- Peptide attributes live in `product.metadata`: `research_code`, `purity`, and `demo`
  marking placeholder records. Variants are pack sizes via the "Packgröße" option, with
  the variant title carrying the size (e.g. `10 mg`).
- Current catalog data is **placeholder** — every purity value, COA status and price is
  fabricated and must be replaced with real analytical data before this store goes live.

## Storefront — Astro

- Start the dev server in background mode: `astro dev --background`; manage it with
  `astro dev stop`, `astro dev status`, `astro dev logs`.
- **Islands, not components-everywhere.** `.astro` files render to zero JS and stay that
  way. Hydrate only genuinely interactive pieces (add-to-cart, quantity picker, filters,
  checkout) and pick the narrowest `client:*` directive that works — `client:visible`
  or `client:idle` over `client:load`. Page speed and Core Web Vitals are product
  requirements here, not polish; see `TECH_STACK.md`.
- **Design tokens, no raw hex.** Colors, radii, container width and the font stack are
  CSS custom properties (`--c-navy`, `--c-green`, `--c-border`, `--radius`, …) defined in
  the `<style is:global>` block of `src/layouts/BaseLayout.astro`. Component styles use
  `var(--c-*)` and live in that component's scoped `<style>`. **No raw hex in CSS** —
  the codebase is clean as of 2026-07-27, so a new literal is a regression. If a colour
  genuinely has no token, add one to `:root` rather than inlining it. Decorative inline
  SVG `fill`/`stroke` attributes are the one accepted exception (the product vial
  illustration). Verify with:

  ```bash
  grep -rnE '#[0-9a-fA-F]{3,8}\b' --include='*.astro' src | grep -vE '\-\-c-[a-z0-9-]+:\s*#|fill=|stroke='
  ```
- Prices are formatted with `Intl.NumberFormat("de-DE", { style: "currency" })` from the
  variant's `calculated_price` — never hand-built strings.
- Product data can be missing fields (the catalog is partly demo data). Degrade
  gracefully the way `ProductCard.astro` does rather than assuming a field exists.
- Consult the Astro docs before related work:
  [routing](https://docs.astro.build/en/guides/routing/),
  [components](https://docs.astro.build/en/basics/astro-components/),
  [framework components](https://docs.astro.build/en/guides/framework-components/),
  [content collections](https://docs.astro.build/en/guides/content-collections/),
  [styling](https://docs.astro.build/en/guides/styling/),
  [i18n](https://docs.astro.build/en/guides/internationalization/).

## SEO baseline

Organic search is the main acquisition channel in this niche, so every indexable page
ships with SEO in place rather than as a follow-up. `src/components/Seo.astro` owns all
head metadata and is rendered by `BaseLayout.astro` — pass props through the layout
(`title`, `description`, `ogType`, `image`, `noindex`, `jsonLd`) rather than hand-rolling
head tags in a page:

- Unique `<title>`, `description` and self-referencing canonical per page. No page may
  inherit the homepage title.
- Product pages emit `Product` + `AggregateOffer` JSON-LD — price range from the variant
  `calculated_price` values, `priceCurrency` EUR, availability mapped from stock status —
  plus a `BreadcrumbList`.
- Category and listing pages emit `CollectionPage` with an embedded `ItemList`, plus a
  `BreadcrumbList`.
- Define the `Organization` node once and reference it by `@id` as `seller`/`publisher`
  from the other nodes instead of repeating it.
- Filtered, sorted or searched listing URLs (`/produkte?q=`, `?sort=`) are
  faceted-navigation near-duplicates: `noindex, follow`, with the clean listing URL
  indexable and self-canonical. Do not add a cross-URL canonical on top of `noindex` —
  the mixed signal is worse than either alone. Emit the `CollectionPage` graph only on
  the clean canonical URL.
- Unknown slugs return `noindex, nofollow` rather than a soft 200.

### Crawl control

- `robots.txt` disallows `/api/`, account and admin paths. Do **not** also disallow the
  faceted URLs that are handled with `noindex, follow` — a disallowed URL is never
  crawled, so the `noindex` is never seen and the page can still surface as a bare link.
  Pick one mechanism per URL pattern. (The `peptide` project does both, in
  `app/robots.ts` vs. its SEO doc; that contradiction is a bug, not a pattern to copy.)

### Sitemaps and discovery

- Production domain is `https://peptideeinkaufen.de`. The origin comes from
  `PUBLIC_SITE_URL` in `storefront/.env`, read by both `astro.config.mjs` (`site`) and
  `src/lib/site.ts` (`SITE_URL`) so the two cannot drift. It falls back to the
  production domain deliberately — a missing env var in a real build should not publish
  localhost canonicals. Local dev sets `PUBLIC_SITE_URL=http://localhost:4321`.
- Derive every absolute URL from `absoluteUrl()` in `src/lib/site.ts`. Never hand-build
  absolute URLs at call sites.
- Split the sitemap by content type behind a sitemap index (products / pages / content)
  rather than one flat file, with `changefreq` and `priority` per type and a real
  `lastmod` from content dates. Rough priorities that worked there: home 1.0, catalog
  listing 0.95, product 0.9, category and tools 0.7–0.75, legal pages 0.2.
- Include the image sitemap extension (`xmlns:image`) on product entries with
  `<image:title>` and `<image:caption>` built from the product's name, purity and form.
  Google Images is a real traffic source for this niche.
- IndexNow pings Bing, Yandex and the other participants when content changes, so they
  recrawl within minutes. The key is a public file at the site root, not a secret.
  **[docs/indexnow.md](docs/indexnow.md) is the runbook.** `INDEXNOW_KEY` is the off
  switch; `deploy.sh` submits the changed URLs after publishing, never during the build,
  and only pages whose built HTML actually changed are submitted.

### Images

- Standardise product image dimensions and format (they used 1200×1490 webp for product
  images, 1200×1200 jpeg for social previews) and declare width, height and type on the
  OpenGraph tags.
- Generate alt text from a structured per-product profile (name, amount, kind, view,
  visual detail, quality detail) rather than writing ad-hoc strings, so every image gets
  consistent, descriptive, keyword-bearing German alt text. See
  `lib/product-image-alt.ts` in the `peptide` project for the shape.

## Privacy and consent

German market, so DSGVO/TTDSG apply to the storefront:

Analytics is Google Analytics 4, gated on consent. **[docs/analytics.md](docs/analytics.md)
is the runbook** — read it before touching consent or measurement.

- Analytics loads **only** after explicit statistics consent — default off, no
  pre-ticked toggles. A hard block, not Google Consent Mode: before consent there is
  no script tag, no request to Google and no cookie.
- Reject and accept must be equally prominent; a decision is required, so the dialog
  does not dismiss on backdrop click or ESC.
- Consent logic lives in `src/lib/consent.ts` and nowhere else, with a versioned storage
  key (`pe_consent_v1`) and a migration path when the shape changes: bump
  `CONSENT_VERSION`, add the old key to `LEGACY_KEYS`, and everyone is asked again.
  `src/components/ConsentBanner.astro` owns the dialog, reopened from the footer.
- Only offer categories that correspond to tracking actually present on the site. There
  is one, `statistics`. A new category needs its own section in `datenschutz.astro`.
- `PUBLIC_GA_MEASUREMENT_ID` is the off switch: unset means no Google script, no dialog,
  and a Datenschutz page that says no tracking is in use. Keep those three consistent —
  a privacy policy describing tracking that is not there is as wrong as the reverse.

## Deployment

Production is a single Hetzner VPS with DNS delegated from Hostinger. The domain is
`peptideeinkaufen.de`. **No Docker** — Postgres, Redis, Node and Caddy come from apt,
Medusa runs as `medusa.service`, and deploys build into `/srv/peptides/releases/<sha>`
and repoint the `current` symlink. **[docs/deploy.md](docs/deploy.md) is the runbook** —
read it before touching anything on the server.

Do not copy deploy scripts or server credentials from the `peptide` project into this
codebase. That project is read-only prior art; never edit or deploy it from here.

**The storefront is public.** The pre-launch gate (HTTP basic auth plus a
site-wide `X-Robots-Tag: noindex`) was removed on 2026-07-29 by explicit decision,
ahead of the blockers in [docs/go-live-checklist.md](docs/go-live-checklist.md).
Those blockers are still open: bank details are empty, the legal pages still render
`[Platzhalter]` company data, there is no order confirmation email, and catalog
purity values are fabricated.

Three consequences for any change you make here:

- **Ordering is closed** (2026-07-30). `ORDERS_ENABLED` is unset in
  `/srv/peptides/.env`, so add-to-cart, the checkout form and the `add_to_cart`
  WebMCP tool are not rendered, and the store API refuses cart completion with
  503. The switch lives in `storefront/src/lib/shop.ts` and
  `backend/apps/backend/src/api/middlewares.ts`. **Reopening it is a launch
  decision** tied to the bank details, governed by
  [docs/go-live-checklist.md](docs/go-live-checklist.md) §1 — never a side effect
  of other work, and never one app without the other.
- The four legal pages keep their own `noindex` via the `draft` prop in
  `LegalLayout`. **Do not remove a `draft` prop** until that page's real company
  data is in place — it is the only thing keeping unreviewed legal text out of
  the index.
- Anything you ship is immediately public and crawlable. There is no longer a
  password between a half-finished change and a real visitor.

Rules, all enforced by `deploy/deploy.sh`:

- One scripted deploy path only: `bash /srv/peptides/repo/deploy/deploy.sh <sha>`. No
  manual parallel `ssh`, `git reset`, `npm ci` or `systemctl restart` against the
  server.
- Deploy a specific locally verified commit SHA, from the target branch (`main`) — never
  from a feature branch, stash or detached HEAD. The script refuses any commit that is
  not an ancestor of `origin/main`.
- Hold a server-side lock for the duration; if another deploy holds it, abort, re-sync,
  re-run the checks and start over rather than intervening on the server.
- Publish expected durations, and when output stalls past them, inspect the lock and the
  running processes instead of waiting.

Two things that surprise people:

- **The storefront is static and reads the catalog at build time.** Editing a product in
  the Medusa admin changes the API but not the built pages — the site has to be rebuilt
  before the change is visible.
- **Database migrations do not roll back.** Deploying an older SHA restores the code, not
  the schema. Dump the database before any deploy that migrates.
