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
      present transitively, which would have broken a clean install on the
      server.
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

Native, no Docker — see the decision note in the spec.

- [x] `deploy/medusa.service` — systemd unit running `/srv/peptides/current` as
      the `medusa` user, bound to `127.0.0.1` so Caddy is the only way in
- [x] `deploy/Caddyfile` — auto-TLS, `Permissions-Policy: tools=(self)`, the
      basic-auth gate, immutable caching for `/_astro/*`
- [x] `deploy/.env.template` — Medusa + storefront-build variables
- [x] `deploy/caddy.env.template` — domain and gate only, so the `caddy` user
      never reads the database password or the signing secrets
- [x] `deploy/provision.sh` — idempotent fresh-box setup: Postgres 16, Redis 7
      (appendonly), Node 22, Caddy, role + database, service user, systemd
      units, ufw, 4 GB swap, unattended upgrades. Generates `DATABASE_URL`,
      `JWT_SECRET` and `COOKIE_SECRET` so there is less to fill in by hand.
- [x] `deploy/deploy.sh` — single path: SHA pinned to `origin/main`, `flock`,
      build into `releases/<sha>`, migrate, atomic symlink swap, restart, health
      check with automatic symlink rollback, build storefront, validate and
      reload Caddy, prune old releases, verify

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

The Caddyfile was exercised for real, not just adapted: Caddy was run locally
against a fixture site and the live local Medusa, confirming

- no credentials → **401**, wrong password → **401**, correct → **200**
- `Permissions-Policy: tools=(self)`, `X-Robots-Tag: noindex, nofollow`, HSTS,
  `X-Content-Type-Options` and `Referrer-Policy` all present
- `/produkte/` (a directory index) gets `must-revalidate` — the reason the cache
  matcher is written as `not path /_astro/*` rather than `*.html`, which misses
  every directory-index URL and so would have missed most of the site
- `/_astro/*` gets `immutable`
- an unknown path returns a real **404** with the custom page, not a soft 200
- `www.` → `301` to the apex
- `api.` proxies to Medusa and is *not* behind basic auth, since a cross-origin
  XHR would not carry the credentials
- `caddy validate` **fails** when `caddy.env` is incomplete, so `deploy.sh`
  catches a missing `SITE_DOMAIN` before installing a config that would emit
  `Location: https:///...`

Not verified: `provision.sh` and `deploy.sh` end to end. Both are syntax-checked
only — they need a real Ubuntu box (Phase B). `shellcheck` was not available.

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
