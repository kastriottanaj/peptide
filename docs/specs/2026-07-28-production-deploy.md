# Production deploy — Hetzner VPS, Hostinger DNS

- **Date:** 2026-07-28
- **Status:** Implemented in the repository (2026-07-28); not yet applied to a
  server — see Phase B of the
  [plan](../plans/2026-07-28-production-deploy.md)
- **Supersedes:** the "no production deployment exists" statement in `AGENTS.md`
  and `README.md`

## Goal

Introduce the first production deploy path for this repo: the Astro storefront
and the Medusa backend running on a fresh Hetzner VPS, served over TLS at
`peptideeinkaufen.de`, with DNS pointed there from Hostinger.

The site goes up **gated** — HTTP basic auth plus `noindex` — because
[go-live-checklist.md](../go-live-checklist.md) has four unresolved hard
blockers. Deploying now is still worth doing: checklist §6 notes the order
confirmation email needs a sending domain on `peptideeinkaufen.de`, which
depends on DNS, which depends on this deploy. Un-gating later is a two-line
change to one file.

## Non-goals

Explicitly out of scope, so this does not drift:

- **Opening the shop to the public or taking real orders.** Blocked on
  go-live-checklist §1 (bank details), §2 (company data), §3 (B2B/B2C) and §6
  (confirmation email). This spec deliberately ships the gate *on*.
- **The order confirmation email, SPF/DKIM/DMARC.** Needs DNS to exist first;
  it is the natural next unit of work, not this one.
- **Replacing placeholder company data, bank details or the fabricated
  purity/COA values.** Content, not deployment.
- **Cloudflare in front** (CDN/WAF per `TECH_STACK.md`), **Meilisearch**,
  **PostHog and the consent banner.** All still open; none block this.
- **CI/CD on push.** Deploy stays a deliberate, explicit command per the
  `AGENTS.md` rule that nothing releases as a side effect of a single change.
- **Admin 2FA and IP allowlist** (`TECH_STACK.md`). Worth doing before the shop
  opens; not required for a gated site whose admin already needs a login.
- **Zero-downtime deploys.** A few seconds of restart is fine for a gated site.

## Architecture

One Hetzner box, no containers. Postgres, Redis, Node and Caddy from apt; Medusa
as a systemd service. Caddy terminates TLS and issues certificates automatically
via Let's Encrypt.

> **Decided 2026-07-28:** an earlier revision of this spec used Docker Compose.
> Rejected in favour of native packages. On Linux the container overhead
> argument is weak either way, but this box has one operator who will SSH in to
> debug it, and `systemctl` / `journalctl` / `psql` / `pg_dump` are more direct
> than the same operations through a container. Postgres in particular is easier
> to back up and major-version upgrade on the distribution's own path. Atomic
> deploys and rollback — the real thing Docker was buying — are covered by
> release directories and a symlink swap.

```
Internet
  │
  └── Caddy  :80 / :443  (auto-TLS, security headers, the gate)
        │
        ├── peptideeinkaufen.de, www.  →  static files from /srv/peptides/storefront
        │      basic auth + X-Robots-Tag: noindex  ← removed at real launch
        │      Permissions-Policy: tools=(self)    ← required by WebMCP, see README
        │
        └── api.peptideeinkaufen.de     →  127.0.0.1:9000
        │
        ├── medusa.service        (Node 22, runs /srv/peptides/current)
        ├── postgresql.service    16, loopback only
        └── redis-server.service  7, appendonly, loopback only
```

**Releases, not images:** each deploy builds into
`/srv/peptides/releases/<sha>`, runs migrations, then repoints the
`/srv/peptides/current` symlink and restarts the unit. A failed build never
touches the running release; a failed health check puts the symlink back.

**Why static files rather than a Node server for the storefront:** the Astro
build has no adapter and no `prerender = false` anywhere — all 26 pages and
endpoints emit files. Caddy serves them directly; there is no storefront
process to run or restart.

**Where the storefront is built:** on the server, inside the deploy script,
*after* Medusa is healthy. `getStaticPaths` fetches the catalog from Medusa at
build time (`AGENTS.md` calls this out), so the backend has to be reachable
first. Building on the box means one `PUBLIC_MEDUSA_BACKEND_URL`
(`https://api.peptideeinkaufen.de`) is correct for both the build-time fetch and
the browser at runtime.

### DNS at Hostinger

Hostinger stays the registrar and keeps hosting the DNS zone. Three records
point at the Hetzner IPv4 (plus `AAAA` equivalents if the box has IPv6):

| Type | Name  | Value              | TTL  |
| ---- | ----- | ------------------ | ---- |
| A    | `@`   | `<hetzner-ipv4>`   | 3600 |
| A    | `www` | `<hetzner-ipv4>`   | 3600 |
| A    | `api` | `<hetzner-ipv4>`   | 3600 |

No nameserver change, no Hostinger hosting product involved. Caddy cannot issue
certificates until these resolve, so DNS goes first.

### First deploy is two-phase

There is a chicken-and-egg problem worth stating up front: the storefront build
needs `PUBLIC_MEDUSA_PUBLISHABLE_KEY`, which only exists once Medusa is running
and an admin user has created it.

1. **Phase 1** — bring up Postgres, Redis, Medusa and Caddy. Run migrations,
   create the admin user, seed the catalog (`seed-peptides.ts`).
2. **Phase 2** — read the publishable key out of the admin, write it into the
   server `.env`, build the storefront, reload Caddy.

Every subsequent deploy is a single `deploy.sh <sha>`.

## Concrete file changes

New directory `deploy/`, all committed (no secrets):

| File | Purpose |
| ---- | ------- |
| `deploy/medusa.service` | systemd unit: runs `/srv/peptides/current` as the `medusa` user, bound to loopback, with `ProtectSystem`/`NoNewPrivileges` hardening |
| `deploy/Caddyfile` | TLS, the basic-auth gate, `Permissions-Policy: tools=(self)`, HSTS/`X-Content-Type-Options`/frame options, static serving, API proxy |
| `deploy/.env.template` | Medusa + storefront-build variables. `provision.sh` generates the database URL and signing secrets into it |
| `deploy/caddy.env.template` | Domain and gate credentials only — kept apart so the `caddy` user cannot read the database password or signing secrets |
| `deploy/provision.sh` | One-time fresh-box setup: Postgres/Redis/Node/Caddy from apt, role + database, service user, systemd units, `ufw` (22/80/443 only), swap |
| `deploy/deploy.sh` | The single deploy path: pins a commit SHA, holds a server-side lock, builds a release, migrates, swaps the symlink, builds the storefront, reloads Caddy |

Modified:

| File | Change |
| ---- | ------ |
| `backend/apps/backend/medusa-config.ts` | Register the Redis event-bus, cache and workflow-engine modules when `REDIS_URL` is set. `REDIS_URL` is already in `.env.template` but nothing reads it — on a single box the in-memory defaults lose queued work on every restart. |
| `README.md` | Replace the "no production deployment" note with a pointer to the runbook |
| `AGENTS.md` | Rewrite the Deployment section: the rules it lists conditionally ("when a deploy path is introduced") become active and describe the real scripts |
| `docs/go-live-checklist.md` | Tick §7 "Deployment"; note the gate and what un-gating requires |
| `docs/deploy.md` (new) | Runbook: DNS, first deploy, routine deploy, rollback, un-gating, troubleshooting |

Branches merged into `main` first, in this order (all three merge cleanly,
verified with `git merge-tree`):

1. `fix/security-and-checkout-bugs` — **must** be first. Fixes a stored XSS in
   the JSON-LD graph and the `supersecret` JWT/cookie defaults, and makes Medusa
   refuse to boot under `NODE_ENV=production` with placeholder secrets. That
   guard is load-bearing for this deploy.
2. `feat/webmcp` — WebMCP tools + `llms.txt` (contains `feat/llms-txt`).
3. `feat/wissen-lexikon-search` — client-side search on the Wissen/Lexikon
   indexes.

## Secrets

None committed. Split across two files so the `caddy` user cannot read the
database password or the Medusa signing secrets:

`/srv/peptides/.env` — mode `600`, owned `medusa`. `provision.sh` generates:

- `DATABASE_URL`, with a password it creates the Postgres role with
- `JWT_SECRET`, `COOKIE_SECRET` — `openssl rand -base64 32`

Left for the operator: `PUBLIC_MEDUSA_PUBLISHABLE_KEY` (from the admin in phase
2) and the four `PUBLIC_BANK_*` values (blocked on checklist §1).

`/srv/peptides/caddy.env` — mode `640`, owned `root:caddy`: `SITE_DOMAIN`,
`ACME_EMAIL`, `GATE_USER`, `GATE_PASSWORD_HASH` (`caddy hash-password`).

`.gitignore` already covers `.env` and `*.local.md`; no change needed.

## Verification

**Local, before pushing:**

```bash
cd backend    && npm run lint && npm run build && npm run test
cd storefront && npm run typecheck && npm run build   # backend must be on :9000
grep -rnE '#[0-9a-fA-F]{3,8}\b' --include='*.astro' src \
  | grep -vE '\-\-c-[a-z0-9-]+:\s*#|fill=|stroke='     # must return nothing
```

**On the server, after deploy:**

```bash
curl -sI https://peptideeinkaufen.de            # 401 — the gate is on
curl -sI -u '<user>:<pass>' https://peptideeinkaufen.de
#   200, Permissions-Policy: tools=(self), X-Robots-Tag: noindex
curl -s  https://api.peptideeinkaufen.de/health # OK
```

**Manual checks:**

- [ ] `https://peptideeinkaufen.de` prompts for basic auth; wrong password fails
- [ ] Behind the gate: homepage, a product page, a Wissen article all render
- [ ] Product page shows real prices from Medusa, not an empty catalog
- [ ] TLS certificate valid for apex, `www` and `api`; `www` redirects to apex
- [ ] `https://api.peptideeinkaufen.de/app` reaches the Medusa admin login
- [ ] Canonicals, `sitemap.xml` and `llms.txt` all use
      `https://peptideeinkaufen.de` — not `localhost`
- [ ] Add-to-cart works end to end against the live API
- [ ] Reboot the box; everything comes back without manual intervention

## Risks

- **The gate is the only thing between placeholder legal pages and the public.**
  If basic auth is misconfigured the site is publicly indexable with a
  `[Platzhalter]` Impressum. `X-Robots-Tag: noindex` is deliberate redundancy,
  and the curl check above is the gate test.
- **`/store/order-lookup` is unauthenticated** (checklist §6). Behind the gate
  it is unreachable; it must be rate-limited before un-gating.
- **DNS propagation** can delay certificate issuance. Caddy retries; do not
  interpret an early failure as a broken config.
