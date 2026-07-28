# Plan — Production deploy (Hetzner + Hostinger DNS)

Spec: [../specs/2026-07-28-production-deploy.md](../specs/2026-07-28-production-deploy.md)

Phase A is everything that needs no server access. Phase B needs the Hetzner IP,
SSH access and a DNS change at Hostinger, so it is executed by hand from the
runbook rather than from here.

---

## Phase A — repository (done)

### A1. Merge the outstanding branches into `main`

- [x] `fix/security-and-checkout-bugs` — first, deliberately. Fixes the stored
      XSS in the JSON-LD graph and the `supersecret` JWT/cookie defaults, and
      adds the production boot guard this deploy relies on.
- [x] `feat/webmcp` (contains `feat/llms-txt`)
- [x] `feat/wissen-lexikon-search`

Conflict resolved in `storefront/src/pages/sitemap-wissen.xml.ts`: both branches
changed it. Kept the WebMCP `content-index` refactor **and** re-applied the
security branch's newest-entry `lastmod` for `/wissen` and `/wissen/lexikon` —
`wissenIndexEntries()` returns hand-maintained static routes that carry no date,
so taking either side alone would have lost something.

### A2. Redis modules

Files: `backend/apps/backend/medusa-config.ts`, `backend/apps/backend/package.json`

- [x] Declare `@medusajs/cache-redis`, `@medusajs/event-bus-redis`,
      `@medusajs/workflow-engine-redis` as real dependencies — they were only
      present transitively, which would have broken a clean Docker build.
- [x] Register the three modules when `REDIS_URL` is set; throw in production
      when it is not. Local dev without Redis is unaffected.
- [x] Locking deliberately left on the in-memory default — it is a
      `providers`-shaped module, and sharing it only matters with more than one
      Medusa instance.

Three things had to be discovered by running it:

- `@medusajs/locking-redis` cannot be resolved as a module directly — it needs a
  provider block. Removed.
- The return type must be `ConfigModule['modules']`; inference widens the
  no-Redis branch to `event_bus?: undefined` and fails to typecheck.
- `workflow-engine-redis` reads `options.redis.redisUrl`, not `options.redisUrl`
  like the other two. The flat form typechecks, then fails at boot with
  `Cannot destructure property 'url'`.

### A3. Deploy infrastructure

- [x] `deploy/Dockerfile.backend` — multi-stage Node 22; `medusa build`, then
      run the emitted `.medusa/server` as non-root with a healthcheck
- [x] `.dockerignore` — build context is the repo root
- [x] `deploy/docker-compose.yml` — postgres 16, redis 7 (appendonly), medusa,
      caddy; only Caddy publishes ports
- [x] `deploy/Caddyfile` — auto-TLS, `Permissions-Policy: tools=(self)`, the
      basic-auth gate, immutable caching for `/_astro/*`
- [x] `deploy/.env.template` — every variable documented with its generator
- [x] `deploy/provision.sh` — idempotent fresh-box setup (Docker, ufw, 4 GB
      swap, unattended upgrades, directories)
- [x] `deploy/deploy.sh` — single path: SHA pinned to `origin/main`, `flock`,
      build, migrate, wait healthy, build storefront, reload, verify

### A4. Documentation

- [x] `docs/deploy.md` — the runbook
- [x] `AGENTS.md` — Deployment section rewritten from conditional to actual
- [x] `README.md` — deploy section; corrected the WebMCP claim that the
      `Permissions-Policy` header could not be set
- [x] `docs/go-live-checklist.md` — §7 deployment ticked, §6 mail unblocked,
      backups and monitoring added as new open items

### A5. Gates

- [x] `cd backend && npm run lint` — clean
- [x] `cd backend && npm run build` — clean
- [x] `cd storefront && npm run typecheck` — 0 errors, 0 warnings
- [x] `cd storefront && npm run build` — 36 pages
- [x] Raw-hex check — clean
- [x] Commit on `main`

`npm run test` in `backend/` runs nothing — there is no `test` task in
`turbo.json`, so the gate documented in `AGENTS.md` is currently a no-op. Left
as found; worth fixing separately.

---

## Phase B — server (needs access)

Not executable from here: needs the Hetzner IP, an SSH key and the Hostinger DNS
panel. Full detail in [../deploy.md](../deploy.md).

- [ ] **B1.** Point `@`, `www` and `api` at the Hetzner IPv4 in Hostinger hPanel;
      confirm all three resolve before deploying. Certificate issuance fails
      until they do.
- [ ] **B2.** `bash deploy/provision.sh` on a fresh Ubuntu 24.04 box.
- [ ] **B3.** Fill `/srv/peptides/.env` — secrets, gate hash, ACME email.
- [ ] **B4.** Deploy phase 1 (backend only), create the admin user, seed the
      catalog.
- [ ] **B5.** Copy the publishable key into `.env`, redeploy to build the
      storefront.
- [ ] **B6.** Verify per the spec's checklist — especially that the apex returns
      **401** without credentials.

## Explicitly not done

- Un-gating the shop. Blocked on go-live-checklist §1–§6.
- Order confirmation email and SPF/DKIM/DMARC — unblocked by B1, separate work.
- Automated backups, monitoring, Cloudflare, admin 2FA.
