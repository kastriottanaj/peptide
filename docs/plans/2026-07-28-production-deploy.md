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

## Phase B — server (done 2026-07-28)

Server: `2.28.21.11`, Hetzner CX22, Falkenstein, Ubuntu 24.04, in its own
Hetzner project — deliberately not the box running peptidebestellung.de.

- [x] **B1.** `@`, `www` and `api` point at the box (`www` is a CNAME to the
      apex and follows automatically).
- [x] **B2.** `provision.sh` on a fresh Ubuntu 24.04 box.
- [x] **B3.** `/srv/peptides/.env` generated by provision; gate credentials set
      in `caddy.env`.
- [x] **B4.** Phase 1 deploy, admin user created, catalog seeded
      (`seed-peptides`, `seed-shipping`, `seed-commerce-rules`), Medusa starter
      clothing and categories removed.
- [x] **B5.** Publishable key wired in, storefront built — 36 pages.
- [x] **B6.** Verified: apex returns **401 with a zero-byte body**; with
      credentials the site serves and product pages carry real EUR prices from
      the live catalog. Let's Encrypt certificates for apex and `www`, valid to
      2026-10-26. All security headers present including
      `Permissions-Policy: tools=(self)`. Canonicals, sitemaps and `llms.txt`
      all use the production origin, no `localhost` anywhere. Rebooted the box:
      everything returned unattended (~6 s of 502 while Medusa booted).

### Five bugs, all found by running it

Everything up to this point had passed local checks. None of these were
reachable without a real server:

1. **No writable `HOME`** — the Medusa CLI imports `configstore`, which writes
   under `$HOME` at import. The service user's home was root-owned; it died with
   EACCES and crash-looped 27 times. Migrations gave no warning because
   `deploy.sh` runs those as root. Fixed with `StateDirectory=`, plus start
   limits so a fatal misconfiguration stops instead of looping. (`5ccc132`)
2. **`deploy.sh` never installed the systemd unit** — only `provision.sh` did,
   and that runs once, so unit changes never reached the server. (`b505605`)
3. **`source` on the env files** — the gate's bcrypt hash is `$2a$14$…` and bash
   expanded `$2` as a positional parameter, aborting under `set -u`. The files
   are written for systemd's `EnvironmentFile`, which does no expansion;
   sourcing them imposed a stricter contract. Replaced with a `read`-based
   loader. (`c4de55f`)
4. **`root * /srv/storefront`** — a leftover from the Docker revision, where
   that path was a bind mount. Every authenticated request 404'd. (`52fbaff`)
5. **Gate bypass in `handle_errors`** — the `@404` matcher guarded only the
   rewrite, so a bare `file_server` ran for *every* error including the gate's
   401, serving the page from the error path. Proven against a fixture: status
   401, full homepage in the body. Production was never exposed only because
   bug 4 left `file_server` with nothing to serve — fixing the root alone would
   have opened it. (`52fbaff`)

Two process failures made bug 5 nearly ship, and both are now fixed:

- The local Caddy test **rewrote the `root` line** to a scratch directory, so it
  exercised a path the server never uses. The fixture now mirrors the real
  server layout.
- `deploy.sh` verified the **status code only**, so it printed "401 — the gate is
  on" while the body was readable. It now fetches the body and warns if an
  unauthenticated response contains HTML.

There is also a lesson about `| tail`: it masks the exit code of the command
before it, and made three failed runs look like they had succeeded.

## Explicitly not done

- Un-gating the shop. Blocked on go-live-checklist §1–§6.
- Order confirmation email and SPF/DKIM/DMARC — unblocked by B1, separate work.
- Automated backups, monitoring, Cloudflare, admin 2FA.
