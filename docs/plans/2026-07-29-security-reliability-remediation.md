# Security and reliability remediation — implementation plan

- **Date:** 2026-07-29
- **Status:** In progress
- **Spec:** [2026-07-29-security-reliability-remediation.md](../specs/2026-07-29-security-reliability-remediation.md)
- **Branch:** `codex/security-remediation`
- **Worktree:** `/private/tmp/peptides-security-remediation`

## Delivery rules

- Implement in P0-A → P0-B → P0-C → P1 → P2 → P3 order.
- P0-B is complete before any P0-C migration is generated or applied.
- P0-C stays disabled (`CHECKOUT_ENABLED=0`) until its quote, payment, policy,
  token, rate-limit and test pieces are complete.
- Each task runs its focused checks before commit. Cross-application behavior
  runs both app gates.
- Fetch/rebase `origin/main` before each push and re-run affected gates after
  integrating upstream work.
- Production mutation, gate rotation, seed repair and deployment require
  separate explicit approval; repository implementation does not imply them.

## Task 0 — record approval and commit the design

**Files**

- `docs/specs/2026-07-29-security-reliability-remediation.md`
- `docs/plans/2026-07-29-security-reliability-remediation.md`

**Interfaces**

- Consumes the approved audit findings and repository `AGENTS.md`.
- Produces the binding scope, dependency order, API contracts and verification
  contract for every later task.

**Steps**

- [x] Mark the specification approved on 2026-07-29.
- [x] Write this file-by-file implementation plan.
- [x] Run Markdown/whitespace checks and verify only the two documentation files
      are changed in the isolated worktree.
- [x] Commit as the approved design unit and push the remediation branch.

## Task 1 — P0-A local credential containment

**Files**

- Local/ignored: `.claude/settings.local.json`, `CREDENTIALS.local.md`,
  `storefront/.env`, `backend/apps/backend/.env`
- Committed: `scripts/check-local-secret-modes.sh` (new), `README.md`,
  `backend/README.md`, `docs/deploy.md`, `deploy/provision.sh`,
  `docs/specs/2026-07-28-production-deploy.md`

**Interfaces**

- Consumes the locally stored gate command and secret-bearing environment files
  without printing their values.
- Produces local mode `0600`, a settings allowlist without embedded
  credentials, and safe password-manager/interactive runbook commands.

**Steps**

- [x] Mechanically remove only the credential-bearing live curl permission from
      `.claude/settings.local.json`, without putting the secret in a patch,
      terminal output, chat or logs.
- [x] Set all four local files to mode `0600`; tolerate an absent ignored file
      without creating a placeholder.
- [x] Add a checker that reports filename/mode/pass-fail only and never reads or
      prints contents.
- [x] Add a non-secret file-mode check and interactive/password-manager examples to
      the runbook; remove password-in-argv examples.
- [x] Verify the settings JSON parses, the sensitive entry is absent by boolean
      check, modes are `0600`, and no value is printed.
- [x] Verify every present local secret file is ignored and absent from tracked
      history.
- [x] Do not rotate the production gate until separately approved.
- [x] Commit and push the P0-A repository changes.

## Task 2 — P0-B runtime/build trust boundary

**Files**

- `deploy/provision.sh`
- `deploy/deploy.sh`
- `deploy/lib/common.sh` (new)
- `deploy/lib/env-file.sh` (new)
- `deploy/medusa.service`
- `deploy/medusa-migrate.service` (new)
- `deploy/.env.template`
- `deploy/tests/env-loader.test.sh` (new)
- `deploy/tests/permissions.test.sh` (new)
- `docs/deploy.md`

**Interfaces**

- Consumes root-owned `/srv/peptides/.env`, a fixed system `PATH`, an immutable
  source SHA and public storefront-build values.
- Produces a `peptides-build` user, root-owned immutable artifacts, a read-only
  `medusa` runtime and a hardened migration oneshot.
- `deploy.sh` exposes only named configuration variables; it never exports an
  arbitrary environment-file key.

**Steps**

- [ ] Set `umask 077` before provisioning secrets; enforce `.env`
      `root:medusa 0640`, `caddy.env` `root:caddy 0640`, and repair existing
      ownership idempotently.
- [ ] Create the non-login `peptides-build` user and its disposable build/cache
      directories without granting runtime-secret access.
- [ ] Make repository, releases and storefront artifacts root-owned and
      non-writable by `medusa`.
- [ ] Replace the generic env exporter with strict named readers; set a fixed
      `PATH` and clear shell/loader/Git/Node/npm injection variables before any
      external command.
- [ ] Run backend/storefront dependency lifecycle and build commands as
      `peptides-build` in disposable space with a sanitized environment.
- [ ] Resolve the generated Medusa server from a lock-backed dependency
      artifact; invoke installed CLIs directly and never run root `npx`.
- [ ] Harden `medusa.service` with `ProtectSystem=strict`,
      `StateDirectoryMode=0700`, `UMask=0077` and no
      `ReadWritePaths=/srv/peptides`.
- [ ] Add `medusa-migrate.service` using the candidate backend, runtime env and
      the local CLI as `medusa`.
- [ ] Add adversarial env/path and permission fixture tests.
- [ ] Run `bash -n`, focused deploy tests and a local systemd-unit syntax review.
- [ ] Commit and push the trust-boundary unit.

No intermediate P0-B commit is production-deployable. The first eligible
containment SHA is the one for which Tasks 2–4 all pass together.

## Task 3 — P0-B immutable activation, recovery snapshots and off-host backup

**Files**

- `deploy/deploy.sh`
- `deploy/provision.sh`
- `deploy/medusa.service`
- `deploy/medusa-migrate.service`
- `deploy/peptides-backup.service` (new)
- `deploy/peptides-backup.timer` (new)
- `deploy/backup.sh` (new)
- `deploy/backup.env.template` (new)
- `deploy/tests/release-state.test.sh` (new)
- `deploy/tests/backup.test.sh` (new)
- `docs/deploy.md`
- `docs/go-live-checklist.md`

**Interfaces**

- Consumes one fully built `releases/<sha>/{backend,storefront,csp.caddy}`
  artifact, a stopped-write database and an operator-configured Restic target.
- Produces separate `backend-current`/`storefront-current` pointers, a
  root-managed candidate pointer, verified release snapshots, maintenance-state
  transitions and encrypted off-host backups.

**Steps**

- [ ] Assemble backend, storefront and CSP into one immutable release before any
      production mutation.
- [ ] Validate all candidate artifacts and Caddy configuration before
      maintenance.
- [ ] Add an explicit deployment state machine and cleanup traps that
      distinguish pre-maintenance, maintenance, migrated and activated phases.
- [ ] Enter maintenance, reject/drain writes and stop Medusa before
      `pg_dump -Fc`; require non-empty output and `pg_restore --list`.
- [ ] Migrate through the hardened candidate unit; never start old code after a
      migration failure.
- [ ] Activate backend while public maintenance remains, require local health
      status/body, then activate the matching storefront.
- [ ] Preserve current/previous/candidate/recovery-required releases from
      pruning and make same-SHA deploys idempotent.
- [ ] Add local release-snapshot retention and provider-neutral encrypted Restic
      replication with root-only configuration, retention and `restic check`.
- [ ] Document explicit restore/recovery and a disposable restore drill.
- [ ] Add state-machine tests for build, backup, migration and health failures;
      run destructive failure injection only against fixtures/disposable data.
- [ ] Commit and push the activation/backup unit.

## Task 4 — P0-B gated Caddy, CSP and authoritative verification

**Files**

- `deploy/Caddyfile`
- `deploy/caddy.env.template`
- `deploy/deploy.sh`
- `deploy/build-csp.mjs` (new)
- `deploy/verify-release.sh` (new)
- `deploy/tests/validate-caddy.sh` (new)
- `deploy/tests/caddy-gate.test.sh` (new)
- `docs/deploy.md`
- `docs/analytics.md`

**Interfaces**

- Consumes `SITE_GATED=1`, a non-secret fixture bcrypt hash for tests, the
  immutable storefront and its generated inline hash inventory.
- Produces fail-closed maintenance routing, gated `private, no-store` responses,
  complete security headers, a hash-based CSP and verification with nonzero
  failure semantics.

**Steps**

- [ ] Make gated authenticated/unauthenticated HTML and assets
      `private, no-store`; remove public immutable caching until launch.
- [ ] Ensure 401 responses are zero-byte and include the challenge, HSTS,
      robots, content-type, referrer, frame and permissions headers without
      `Server`.
- [ ] Strip upstream `X-Powered-By`/server headers from the API.
- [ ] Add root-controlled maintenance routing plus a loopback-only candidate
      verification path.
- [ ] Inventory built inline scripts/styles/JSON-LD, externalize executable code
      where possible and generate exact SHA-256 CSP hashes with the release.
- [ ] Exercise CSP report-only in browser tests, then enforce without
      `unsafe-eval` or unrestricted `unsafe-inline`.
- [ ] Replace deploy warnings with hard assertions for API body/status,
      gate/body/headers/cache and gate-state expectations.
- [ ] On external verification failure, immediately re-enter maintenance before
      nonzero exit.
- [ ] Validate through the fixture harness, not a bare unresolved Caddyfile.
- [ ] Commit and push the gated-header/verification unit.

## Task 5 — P0-C backend foundations: secrets, Redis security and bank state

**Files**

- `backend/apps/backend/medusa-config.ts`
- `backend/apps/backend/package.json`
- `backend/apps/backend/jest.config.js`
- `backend/apps/backend/integration-tests/setup.js` (new)
- `backend/apps/backend/.env.template`
- `deploy/.env.template`
- `deploy/provision.sh`
- `backend/apps/backend/src/config/policy-versions.json` (new)
- `backend/apps/backend/src/modules/security/{index,service}.ts` (new)
- `backend/apps/backend/src/modules/bank-transfer/**` (new)
- `backend/apps/backend/src/modules/bank-transfer-payment/**` (new)
- `backend/apps/backend/src/links/order-bank-transfer.ts` (new)
- generated bank-transfer module migration (new)
- `backend/apps/backend/src/lib/order-bank-reference.ts` (new)
- `backend/apps/backend/src/workflows/confirm-bank-transfer.ts` (new)
- `backend/apps/backend/src/api/admin/orders/[id]/bank-transfer/route.ts` (new)
- `backend/apps/backend/src/api/admin/orders/[id]/bank-transfer/confirm/route.ts`
  (new)
- focused admin order widget under `backend/apps/backend/src/admin/` (new)
- `backend/apps/backend/src/jobs/expire-bank-transfer-orders.ts` (new)

**Interfaces**

- Consumes real Redis, `SECURITY_HMAC_SECRET`, current policy versions and
  Medusa's payment/order/lock services.
- Produces atomic HMAC-keyed limits, a unique per-order bank-transfer companion
  record, seven-character reference, pending payment provider and conditional
  confirm/expire transitions.

**Steps**

- [ ] Confirm current Medusa module/payment/workflow extension contracts from
      installed source and official version-matched docs before implementation.
- [ ] Generate/validate the 32-byte security secret and fail checkout closed
      without real Redis.
- [ ] Add `ioredis` as a direct runtime dependency rather than depending on a
      transitive installation.
- [ ] Make the app/root test scripts execute real unit/module/HTTP work and add
      the missing integration setup before implementing security behavior.
- [ ] Implement atomic Redis counters with the approved limits, HMACed PII keys,
      `Retry-After` and concurrency tests.
- [ ] Add the bank-transfer companion model with unique order/reference,
      payment state and policy evidence; generate/review its migration.
- [ ] Move the pure seven-character generator into the backend and add boundary
      property tests.
- [ ] Implement a payment provider that remains pending at order creation.
- [ ] Implement authenticated admin confirmation and the 120-hour expiry job
      using the same distributed lock plus conditional database transition.
- [ ] Add the narrow admin order widget only for the unsupported bank-receipt
      action.
- [ ] Keep `CHECKOUT_ENABLED=0`; run backend lint/build/unit/integration tests.
- [ ] Commit and push backend foundations.

## Task 6 — P0-C secure quote, completion and confirmation APIs

**Files**

- `backend/apps/backend/src/api/store/checkout/quote/route.ts` (new)
- `backend/apps/backend/src/api/store/checkout/complete/route.ts` (new)
- `backend/apps/backend/src/api/store/checkout/abandon/route.ts` (new)
- `backend/apps/backend/src/api/store/order-confirmation/route.ts` (new)
- `backend/apps/backend/src/api/store/order-lookup/route.ts` (remove)
- `backend/apps/backend/src/api/middlewares.ts` (new)
- `backend/apps/backend/src/workflows/complete-bank-transfer-checkout.ts` (new)
- focused steps under `backend/apps/backend/src/workflows/steps/` (new)
- `backend/apps/backend/src/lib/safe-order-summary.ts` (new)
- `backend/apps/backend/src/jobs/expire-abandoned-checkouts.ts` (new)
- backend unit/HTTP integration tests (new)

**Interfaces**

- Consumes cart capability, publishable-key sales-channel context, the
  bank-transfer/security modules, Medusa's locked complete-cart workflow and
  policy versions.
- Produces `POST /store/checkout/quote`,
  `POST /store/checkout/complete`, `POST /store/checkout/abandon` and
  `POST /store/order-confirmation` exactly as specified.

**Steps**

- [ ] Add strict Zod/Medusa validators and no-store responses.
- [ ] Issue a short-lived authenticated quote containing cart revision,
      shipping, currency, integer minor total and policy versions; initial TTL
      is five minutes.
- [ ] Validate quote and policies under the effective core cart lock with no
      mutation/validation race.
- [ ] Bind idempotency key to caller/cart/request hash; changed reuse returns
      `409`, concurrent/replayed completion creates one order.
- [ ] Persist policy/bank companion state synchronously before success.
- [ ] Store only confirmation-token digests for 24 hours; rate-limited replay
      mints an additional token without invalidating in-flight tokens.
- [ ] Return an exact-key `SafeConfirmationSummary`.
- [ ] Deny public core cart completion, order retrieval and obsolete payment
      initiation; apply cart/checkout/auth limits.
- [ ] Remove number-plus-email disclosure and add generic disabled recovery.
- [ ] Add abandoned PII-cart stamping, explicit abandon and 24-hour cleanup.
- [ ] Test cross-channel/draft isolation, lock races, response loss, Redis
      failure, token TTL, exact allowlist and blocked bypasses.
- [ ] Enable checkout only after the whole P0-C backend and storefront suite
      passes.
- [ ] Commit and push secure checkout APIs.

## Task 7 — P0-C storefront checkout and private confirmation

**Files**

- `storefront/src/lib/cart.ts`
- `storefront/src/lib/cart-storage.ts` (new)
- `storefront/src/lib/checkout.ts` (new)
- `storefront/src/lib/order-confirmation.ts` (new)
- `storefront/src/lib/bank.ts`
- `storefront/src/lib/legal.ts` (new)
- `storefront/src/lib/analytics.ts`
- `storefront/src/components/ConsentBanner.astro`
- `storefront/src/layouts/BaseLayout.astro`
- `storefront/src/layouts/LegalLayout.astro`
- `storefront/src/pages/kasse.astro`
- `storefront/src/pages/bestellung.astro`
- `storefront/src/pages/bestellung/suchen.astro`
- `storefront/src/pages/agb.astro`
- `storefront/src/pages/datenschutz.astro`
- `storefront/src/pages/widerruf.astro`
- `storefront/src/pages/warenkorb.astro`
- `storefront/package.json` and `storefront/package-lock.json`
- storefront unit/browser tests (new)
- `storefront/vitest.config.ts` (new)
- `storefront/playwright.config.ts` (new)
- `docs/checkout.md`
- `docs/analytics.md`

**Interfaces**

- Consumes the safe quote/complete/confirmation DTOs and policy versions.
- Produces a versioned cart capability record, stale-safe shipping state
  machine, fixed confirmation session record and sensitive-route analytics
  exclusion.

**Steps**

- [ ] Replace direct payment/cart completion and order retrieve calls with the
      custom contracts.
- [ ] Add the dev-only unit/browser dependencies, scripts, lockfile, runnable
      harness and typed DTO boundary before switching the page flow; no
      production test dependency.
- [ ] Bind the initial shipping option before submit; version async country,
      address and option operations and ignore stale responses.
- [ ] Render €10/€20/`Kostenlos` from the authoritative cart and block while
      shipping/quote state is unresolved.
- [ ] Send exact minor total/policy versions; on `409`, repaint and require a
      new explicit click.
- [ ] Generate/reuse an idempotency key and prevent double-submit duplicates.
- [ ] Store only `{ token, expiresAt, safeSummary }` under one fixed
      `sessionStorage` key; redirect to `/bestellung/` with no identifier.
- [ ] Render in place if session storage is unavailable.
- [ ] Remove every bank-reference and lookup fallback.
- [ ] Disable GA entirely on cart/checkout/confirmation/recovery: the base
      layout must omit both the consent renderer and footer control and must
      never invoke analytics on those routes; sanitize location/referrer
      elsewhere.
- [ ] Migrate cart storage to a 30-day versioned record; move PII-bearing cart
      IDs to session-only storage and implement explicit reset.
- [ ] Correct privacy/retention text and policy version embedding.
- [ ] Run unit/browser race, storage, GA and confirmation tests plus storefront
      typecheck/build.
- [ ] Run the cross-app checkout suite, then set the documented production
      enablement prerequisite.
- [ ] Commit and push the P0-C storefront unit atomically. Any intermediate
      commit is non-enabling; checkout remains disabled until the final
      cross-app P0-C gate passes.

## Task 8 — P1 Redis sessions, MFA and convergent commerce data

**Files**

- `backend/apps/backend/medusa-config.ts`
- both backend/deploy `.env.template` files
- `deploy/provision.sh`
- `backend/apps/backend/src/migration-scripts/initial-data-seed.ts` (remove)
- `backend/apps/backend/src/scripts/seed-store.ts` (new)
- `backend/apps/backend/src/scripts/seed-peptides.ts`
- `backend/apps/backend/src/scripts/seed-shipping.ts`
- `backend/apps/backend/src/scripts/seed-commerce-rules.ts`
- `backend/apps/backend/src/scripts/audit-starter-data.ts` (new)
- `storefront/src/lib/catalog.ts`
- affected product/card/search/WebMCP/JSON-LD files
- seed/config/catalog tests (new)
- `docs/deploy.md`, `docs/checkout.md`, `docs/go-live-checklist.md`

**Interfaces**

- Consumes `REDIS_URL`, `AUTH_MFA_ENCRYPTION_KEY`, the seven-country allowlist
  and explicit verified inventory input.
- Produces Redis HTTP sessions, strong boot validation, stable-identity seeds,
  draft/zero-stock placeholders and one storefront availability predicate.

**Steps**

- [ ] Set `projectConfig.redisUrl`/prefix and prove sessions survive restart
      without MemoryStore.
- [ ] Generate/validate MFA and distinct signing secrets; smoke-test TOTP.
- [ ] Replace the starter seed with stable-identity, idempotent store bootstrap.
- [ ] Make every seed fail on ambiguity and converge existing products,
      variants, prices, regions, zones, shipping and promotions.
- [ ] Keep demo products draft, inventory-managed, no-backorder and zero-stock.
- [ ] Add dry-run starter-data audit/repair scoped to known demo SKUs/levels;
      never apply it to production without approval.
- [ ] Preserve per-line quantity tiers and correct storefront messages for mixed
      lines.
- [ ] Centralize availability across purchase UI, price surfaces, JSON-LD,
      search and WebMCP.
- [ ] Run seeds twice plus forced-failure/convergence tests, backend gates and
      storefront gates.
- [ ] Commit and push P1.

## Task 9 — P2 complete test gates, dependency remediation and CI

**Files**

- backend `package.json` and lockfiles; storefront manifests only for later
  harness/dependency extensions
- `backend/apps/backend/jest.config.js`
- `backend/apps/backend/integration-tests/setup.js` (new)
- backend unit/integration tests (new)
- storefront Vitest/Playwright configuration and tests already runnable from
  P0-C
- dependency-audit allowlist/review script (new, only if unavoidable)
- `.github/workflows/quality.yml` (new)
- app READMEs

**Interfaces**

- Consumes disposable Postgres/Redis, generated test secrets and pinned npm
  lockfiles.
- Produces a real root `turbo test`, storefront unit/browser gates, clean
  production audits and a non-deploying CI workflow.

**Steps**

- [ ] Extend the backend and storefront harnesses already introduced with their
      P0 units; prove root `turbo test` runs real work.
- [ ] Re-run full and production-only audits; make compatible targeted upgrades
      without `--force`.
- [ ] Require clean `npm ls`; document only unavoidable, reachable,
      owner/expiry-bound exceptions.
- [ ] Add CI services/seeding and run backend lint/build/test, storefront
      test/typecheck/build, Caddy/deploy tests and audits.
- [ ] Run the complete local gate twice from clean installs.
- [ ] Commit and push P2.

## Task 10 — P3 cart resilience, SEO URL model and WebMCP

**Files**

- `storefront/src/lib/cart.ts`
- `storefront/src/lib/pricing.ts`
- `storefront/src/lib/site.ts`
- `storefront/src/lib/catalog.ts`
- `storefront/src/lib/content-index.ts`
- `storefront/src/components/Seo.astro`
- `storefront/src/layouts/BaseLayout.astro`
- `storefront/src/components/{AddToCart,ProductCard,ContentSearch,WebMCPTools}.astro`
- `storefront/src/lib/webmcp-tools.ts`
- `storefront/src/webmcp.d.ts`
- `storefront/src/pages/produkte/index.astro`
- `storefront/src/pages/wissen/index.astro`
- `storefront/src/pages/wissen/lexikon/index.astro`
- affected product, category, article and legal page route files
- sitemap route files and `storefront/src/pages/llms*.txt.ts`
- `storefront/astro.config.mjs`
- `deploy/Caddyfile`
- `AGENTS.md`, SEO/analytics docs
- focused unit/browser/built-output tests

**Interfaces**

- Consumes Medusa error statuses/availability, fragment filter state and
  `document.modelContext`.
- Produces terminal-only cart clearing, serialized/versioned mutations,
  consistent trailing-slash URLs, non-indexable fragment filters and safe
  WebMCP annotations.

**Steps**

- [ ] Clear cart IDs only on terminal 404/410; retain/rethrow transient failures.
- [ ] Serialize/version cart/line mutations and reject fractional quantities.
- [ ] Consume Task 8's single availability predicate everywhere: select the
      first available variant, disable and label unavailable options, suppress
      purchase controls when all variants are sold out, emit `OutOfStock`,
      expose no unavailable variant ID and show no unavailable “ab” price.
- [ ] Move product/content listing filters to fragments; permanently discard
      legacy query filters on all three listing routes.
- [ ] Normalize directory trailing slashes across links, redirects, canonical,
      OG, JSON-LD, sitemaps and `llms.txt`.
- [ ] Register WebMCP on `document.modelContext`, catch async rejection, enforce
      availability/integer schemas and set `untrustedContentHint: true`.
- [ ] Run cart, SEO built-output, redirect and WebMCP tests plus both app gates
      where crossed.
- [ ] Commit and push P3.

## Task 11 — final verification, audit and handoff

**Files**

- Spec/plan status
- Any final finding register or documented dependency exception

**Interfaces**

- Consumes every completed remediation unit and the original audit finding list.
- Produces a clean, pushed branch with evidence that each finding is fixed,
  explicitly deferred for missing external input, or retained as a go-live
  blocker.

**Steps**

- [ ] Fetch/rebase latest `origin/main`; inspect foreign changes before
      integration.
- [ ] Run backend lint/build/test, storefront test/typecheck/build, deploy/Caddy
      tests, audits, seed convergence and built-output security/SEO checks.
- [ ] Re-run read-only live checks to establish the still-gated baseline; do not
      deploy or create orders.
- [ ] Map every original finding to commit/test evidence.
- [ ] Update spec/plan status and go-live checklist without claiming production
      deployment.
- [ ] Confirm `git status --short` is clean.
- [ ] Commit any final documentation, push, and report the exact remaining
      separately authorized operational steps: live gate rotation, safe
      containment rollout, off-host backup credentials, email provider and real
      business/catalog data.
