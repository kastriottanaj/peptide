# Deploy runbook

Production is a single Hetzner VPS running Docker Compose, with DNS delegated
from Hostinger. The domain is `peptideeinkaufen.de`.

> **The site is currently gated.** The storefront sits behind HTTP basic auth and
> `X-Robots-Tag: noindex`. This is deliberate: the legal pages still render
> `[Platzhalter]` company data, bank details are placeholders and every purity
> value in the catalog is fabricated. See
> [go-live-checklist.md](go-live-checklist.md). Do not remove the gate before
> those clear — [Opening the shop](#opening-the-shop) is the last step, not the
> first.

```
Internet
  └── Caddy :80/:443 ── auto-TLS, security headers, the gate
        ├── peptideeinkaufen.de  → static files in /srv/peptides/storefront
        ├── www.…                → redirect to apex
        └── api.…                → medusa:9000  (store API + admin at /app)
              ├── postgres:5432   (internal only)
              └── redis:6379      (internal only)
```

Only Caddy publishes ports. Postgres, Redis and Medusa are reachable on the
compose network and nowhere else.

## Layout on the server

| Path | What |
| ---- | ---- |
| `/srv/peptides/repo` | Git checkout, pinned to the deployed SHA |
| `/srv/peptides/.env` | All production secrets, mode `600`, never committed |
| `/srv/peptides/storefront` | Built static site, served by Caddy |
| `/srv/peptides/deploy.lock` | Held for the duration of a deploy |

---

## 1. DNS at Hostinger

Hostinger stays the registrar and keeps hosting the zone — no nameserver change
and no Hostinger hosting product is involved. In **hPanel → Domains → DNS / Name
Servers → DNS records**, add three A records pointing at the Hetzner IPv4:

| Type | Name | Points to | TTL |
| ---- | ---- | --------- | --- |
| A | `@` | `<hetzner-ipv4>` | 3600 |
| A | `www` | `<hetzner-ipv4>` | 3600 |
| A | `api` | `<hetzner-ipv4>` | 3600 |

If the box has IPv6, add the same three as `AAAA` records with the IPv6 address.

Delete any pre-existing `A`/`CNAME` records for `@`, `www` or `api` that point at
Hostinger parking — two records for one name will resolve unpredictably.

**Do this before deploying.** Caddy requests certificates from Let's Encrypt on
first request per hostname, and issuance fails until the names resolve to the
box. Verify:

```bash
dig +short peptideeinkaufen.de
dig +short www.peptideeinkaufen.de
dig +short api.peptideeinkaufen.de
```

All three must return the Hetzner IP before continuing. Propagation is usually
minutes but the TTL of the record you replaced can hold it up.

## 2. Provision the box (once)

Fresh Ubuntu 24.04, as root:

```bash
ssh root@<hetzner-ipv4>
apt-get update && apt-get install -y git
git clone https://github.com/kastriottanaj/peptide.git /srv/peptides/repo
bash /srv/peptides/repo/deploy/provision.sh
```

That installs Docker, opens 22/80/443 in `ufw`, adds 4 GB of swap (the Medusa
admin build gets OOM-killed on a small box without it), enables unattended
security upgrades, and creates `/srv/peptides/.env` from the template.

It is idempotent — safe to re-run.

## 3. Fill in the environment

```bash
nano /srv/peptides/.env
```

Every field is documented in [deploy/.env.template](../deploy/.env.template).
Generate the secrets:

```bash
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # COOKIE_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD

# Gate password hash — paste the output verbatim, $ signs and all
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'choose-a-password'
```

`medusa-config.ts` refuses to boot under `NODE_ENV=production` if `JWT_SECRET`,
`COOKIE_SECRET`, `REDIS_URL` or the CORS origins are missing or still on the old
`supersecret` placeholder. That is intentional — a weak signing key looks
identical to a strong one until someone forges an admin session with it.

Leave `PUBLIC_MEDUSA_PUBLISHABLE_KEY` blank for now.

## 4. First deploy (two phases)

The storefront build needs a publishable key, which does not exist until Medusa
is running. So the first deploy runs twice.

### Phase 1 — backend up

```bash
bash /srv/peptides/repo/deploy/deploy.sh <commit-sha>
```

Use a SHA on `main` that you have verified locally — the script refuses anything
that is not an ancestor of `origin/main`. It will report that it is skipping the
storefront build; that is expected here.

Then create an admin user and seed the catalog:

```bash
cd /srv/peptides/repo
compose() { docker compose --env-file /srv/peptides/.env -f deploy/docker-compose.yml "$@"; }

compose exec medusa npx medusa user -e you@example.com -p '<strong-password>'
compose exec medusa npx medusa exec ./src/scripts/seed-peptides.ts
```

### Phase 2 — publishable key, then the storefront

Open `https://api.peptideeinkaufen.de/app`, log in, and go to
**Settings → Publishable API keys**. Copy the `pk_…` value, and make sure it is
linked to a sales channel that has the products — an unlinked key returns an
empty catalog and the storefront builds an empty shop.

```bash
nano /srv/peptides/.env    # set PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_…
bash /srv/peptides/repo/deploy/deploy.sh <same-sha>
```

This time the storefront builds and publishes to `/srv/peptides/storefront`.

## 5. Verify

```bash
curl -sI https://peptideeinkaufen.de            # 401 — the gate is on
curl -sI -u '<user>:<pass>' https://peptideeinkaufen.de | head -20
curl -s  https://api.peptideeinkaufen.de/health # OK
```

Behind the gate, in a browser, check:

- Homepage, a product page and a Wissen article all render
- Product pages show real prices — not an empty catalog
- `https://api.peptideeinkaufen.de/app` reaches the admin login
- `Permissions-Policy: tools=(self)` is present (required for WebMCP —
  without it `navigator.modelContext` is never exposed)
- `X-Robots-Tag: noindex, nofollow` is present
- `/sitemap.xml` and `/llms.txt` contain `https://peptideeinkaufen.de` URLs,
  not `localhost`
- Add to cart works against the live API
- `reboot` the box and confirm everything returns unattended

---

## Routine deploy

```bash
ssh root@<hetzner-ipv4>
bash /srv/peptides/repo/deploy/deploy.sh <commit-sha>
```

One scripted path only. Do not run `docker compose build`, `git reset` or
`docker compose up` by hand alongside it — `deploy.sh` holds
`/srv/peptides/deploy.lock` for the whole run and a second deploy aborts rather
than interleaving.

Expected durations on a 4 vCPU / 8 GB box with warm caches:

| Step | Time |
| ---- | ---- |
| Image build | 3–6 min (first run up to 12) |
| Migrations | 5–30 s |
| Medusa healthy | 30–90 s |
| Storefront build | 2–4 min |
| **Total** | **~6–11 min** |

If output stalls well past these, inspect the lock and the containers rather
than waiting:

```bash
cat /srv/peptides/deploy.lock
docker compose --env-file /srv/peptides/.env -f /srv/peptides/repo/deploy/docker-compose.yml ps
docker compose --env-file /srv/peptides/.env -f /srv/peptides/repo/deploy/docker-compose.yml logs --tail 100 medusa
```

### The catalog and the storefront are coupled

The storefront is static and fetches the catalog **at build time**. Editing a
product in the Medusa admin changes the API immediately but does **not** change
the built pages. After a catalog change, re-run `deploy.sh` with the current SHA
to rebuild.

## Rollback

Deploy the previous SHA:

```bash
bash /srv/peptides/repo/deploy/deploy.sh <previous-sha>
```

This rebuilds the image and the storefront from that commit. **Database
migrations are not rolled back** — Medusa has no down-migration path, so a
rollback across a schema change needs a database restore, not just an older SHA.
Take a dump before any deploy that migrates:

```bash
docker compose --env-file /srv/peptides/.env -f /srv/peptides/repo/deploy/docker-compose.yml \
  exec -T postgres pg_dump -U medusa medusa_peptides | gzip > ~/medusa-$(date +%F-%H%M).sql.gz
```

## Opening the shop

**Only after every hard blocker in [go-live-checklist.md](go-live-checklist.md)
is ticked** — real bank details, real company data on the legal pages, the
B2B/B2C decision, and the order confirmation email.

1. Set the four `PUBLIC_BANK_*` values in `/srv/peptides/.env`.
2. Remove the `draft` prop from each legal page that is now final, so the "not
   legally binding" banner goes and the page becomes indexable.
3. Rate-limit `/store/order-lookup` before it is publicly reachable. It is an
   unauthenticated endpoint taking an order number and an email; the generic
   error stops probing for which half was wrong, but nothing stops volume.
4. Delete the `=== PRE-LAUNCH GATE ===` block in
   [deploy/Caddyfile](../deploy/Caddyfile) — the `basic_auth` directive and the
   `X-Robots-Tag` line.
5. Deploy, then confirm:

   ```bash
   curl -sI https://peptideeinkaufen.de | head -5   # 200, and no X-Robots-Tag
   ```

`deploy.sh` warns loudly if the storefront answers 200 without credentials, so
an accidental un-gating is visible in the deploy output.

## Still missing

Deliberately out of scope for this deploy, in rough priority order:

- **Order confirmation email** (checklist §6) — needs a mailbox on the domain
  plus SPF, DKIM and DMARC records at Hostinger. Now unblocked: DNS exists.
- **Backups.** There is no automated database backup yet. The `pg_dump` above is
  manual. This should not stay true once real orders exist.
- **Cloudflare** in front, per `TECH_STACK.md` — CDN, WAF, rate limiting.
- **Admin hardening** — 2FA and an IP allowlist on `/app`.
- **Monitoring / uptime alerting.** Nothing currently tells you the box is down.
