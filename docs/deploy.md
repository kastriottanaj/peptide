# Deploy runbook

Production is a single Hetzner VPS with DNS delegated from Hostinger. The domain
is `peptideeinkaufen.de`. **No Docker** — Postgres, Redis, Node and Caddy come
from apt, and Medusa runs as a systemd service.

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
        └── api.…                → 127.0.0.1:9000  (medusa.service)
              ├── postgresql.service    (127.0.0.1:5432)
              └── redis-server.service  (127.0.0.1:6379)
```

Medusa binds loopback only, so Caddy is the only way in. Postgres and Redis are
on their Ubuntu defaults, which also bind loopback.

## Layout on the server

| Path | What |
| ---- | ---- |
| `/srv/peptides/repo` | Git checkout, used to build; pinned to the deployed SHA |
| `/srv/peptides/releases/<sha>` | A built, self-contained Medusa server |
| `/srv/peptides/current` | Symlink to the live release — the atomic switch |
| `/srv/peptides/storefront` | Built static site, served by Caddy |
| `/srv/peptides/.env` | Medusa + storefront-build config, mode 600, user `medusa` |
| `/srv/peptides/caddy.env` | Domain and gate credentials, mode 640, root:caddy |
| `/srv/peptides/deploy.lock` | Held for the duration of a deploy |

The two env files are separate on purpose: Caddy runs as its own user and has no
business reading the database password or the Medusa signing secrets.

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

If the box has IPv6, add the same three as `AAAA` records.

Delete any pre-existing `A`/`CNAME` records for `@`, `www` or `api` pointing at
Hostinger parking — two records for one name resolve unpredictably.

**Do this before deploying.** Caddy requests certificates on first request per
hostname and issuance fails until the names resolve. Verify:

```bash
dig +short peptideeinkaufen.de
dig +short www.peptideeinkaufen.de
dig +short api.peptideeinkaufen.de
```

All three must return the Hetzner IP before continuing.

## 2. Provision the box (once)

Fresh Ubuntu 24.04, as root:

```bash
ssh root@<hetzner-ipv4>
apt-get update && apt-get install -y git
git clone https://github.com/kastriottanaj/peptide.git /srv/peptides/repo
bash /srv/peptides/repo/deploy/provision.sh
```

That installs Postgres 16, Redis 7 (with `appendonly`), Node 22 and Caddy;
creates the `medusa` role, database and system user; installs the systemd units;
opens 22/80/443 in `ufw`; adds 4 GB of swap (the admin build gets OOM-killed on a
small box without it); and enables unattended security upgrades.

It also **generates** `/srv/peptides/.env` with a fresh database password,
`JWT_SECRET` and `COOKIE_SECRET` already filled in. It is idempotent and never
overwrites an existing env file.

## 3. Fill in the gate

`provision.sh` generated the Medusa secrets. What is left is the Caddy side:

```bash
nano /srv/peptides/caddy.env
```

Set `ACME_EMAIL`, `GATE_USER`, and generate the hash on the box:

```bash
caddy hash-password --plaintext 'choose-a-password'
```

Paste it verbatim — it starts with `$2a$` and the `$` must not be quoted or
escaped. systemd's `EnvironmentFile` does no shell expansion.

> `deploy.sh` validates the Caddyfile against this file before installing it, so
> a missing value fails the deploy rather than producing a broken site.

## 4. First deploy (two phases)

The storefront build needs a publishable key, which does not exist until Medusa
is running. So the first deploy runs twice.

### Phase 1 — backend up

```bash
bash /srv/peptides/repo/deploy/deploy.sh <commit-sha>
```

Use a SHA on `main` that you verified locally — the script refuses anything that
is not an ancestor of `origin/main`. It will report that it is skipping the
storefront build; expected here.

Then create an admin user and seed the catalog:

```bash
cd /srv/peptides/current
sudo -u medusa NODE_ENV=production npx medusa user -e you@example.com -p '<strong-password>'
sudo -u medusa NODE_ENV=production npx medusa exec ./src/scripts/seed-peptides.ts
```

### Phase 2 — publishable key, then the storefront

Open `https://api.peptideeinkaufen.de/app`, log in, go to **Settings →
Publishable API keys**. Copy the `pk_…` value, and make sure it is linked to a
sales channel containing the products — an unlinked key returns an empty catalog
and the storefront builds an empty shop.

```bash
nano /srv/peptides/.env    # set PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_…
bash /srv/peptides/repo/deploy/deploy.sh <same-sha>
```

## 5. Verify

```bash
curl -sI https://peptideeinkaufen.de            # 401 — the gate is on
curl -sI -u '<user>:<pass>' https://peptideeinkaufen.de | head -20
curl -s  https://api.peptideeinkaufen.de/health # OK
```

Behind the gate, in a browser:

- Homepage, a product page and a Wissen article render
- Product pages show real prices — not an empty catalog
- `https://api.peptideeinkaufen.de/app` reaches the admin login
- `Permissions-Policy: tools=(self)` present (required for WebMCP)
- `X-Robots-Tag: noindex, nofollow` present
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

One scripted path only. Do not run `git`, `npm` or `systemctl` against the app by
hand alongside it — `deploy.sh` holds `/srv/peptides/deploy.lock` for the whole
run and a second deploy aborts rather than interleaving.

It builds into `releases/<sha>`, runs migrations, repoints `current` and restarts
`medusa.service`. A failed build never touches the running release, and if the
new release does not come up healthy the script puts the symlink back and
restarts.

Expected durations on a 2–4 vCPU box with a warm npm cache:

| Step | Time |
| ---- | ---- |
| `npm ci` + `medusa build` | 4–9 min (first run up to 15) |
| Release `npm install` | 1–3 min |
| Migrations | 5–30 s |
| Medusa healthy | 20–60 s |
| Storefront build | 2–4 min |
| **Total** | **~8–17 min** |

If output stalls well past these:

```bash
cat /srv/peptides/deploy.lock
systemctl status medusa
journalctl -u medusa -n 100 --no-pager
```

### The catalog and the storefront are coupled

The storefront is static and fetches the catalog **at build time**. Editing a
product in the admin changes the API immediately but does **not** change the
built pages. After a catalog change, re-run `deploy.sh` with the current SHA.

## Rollback

```bash
bash /srv/peptides/repo/deploy/deploy.sh <previous-sha>
```

Old releases are kept (the last 5), so this is fast — but it still rebuilds, so
for an emergency the fastest path is repointing the symlink by hand:

```bash
ln -sfn /srv/peptides/releases/<previous-sha> /srv/peptides/current.tmp
mv -Tf /srv/peptides/current.tmp /srv/peptides/current
systemctl restart medusa
```

**Database migrations are not rolled back.** Medusa has no down-migration path,
so a rollback across a schema change needs a database restore, not an older SHA.
Dump before any deploy that migrates:

```bash
sudo -u postgres pg_dump medusa_peptides | gzip > ~/medusa-$(date +%F-%H%M).sql.gz
```

## Common operations

```bash
systemctl status medusa
journalctl -u medusa -f              # live logs
systemctl restart medusa
sudo -u postgres psql medusa_peptides
redis-cli ping
systemctl reload caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
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

`deploy.sh` warns loudly if the storefront answers 200 without credentials, so an
accidental un-gating is visible in the deploy output.

## Still missing

Deliberately out of scope for this deploy, in rough priority order:

- **Order confirmation email** (checklist §6) — needs a mailbox on the domain
  plus SPF, DKIM and DMARC records at Hostinger. Now unblocked: DNS exists.
- **Backups.** No automated database backup yet; the `pg_dump` above is manual.
  This should not stay true once real orders exist. Hetzner's own daily snapshot
  backups are enabled on the box, which covers total loss but is not a substitute
  for a database dump you can restore selectively.
- **Session store.** Medusa logs `connect.session() MemoryStore is not designed
  for a production environment` at boot. Admin sessions live in process memory,
  so every deploy or restart logs admins out, and it would not survive running
  more than one instance. Survivable for one operator on one box; worth moving to
  Redis before the shop is busy.
- **Cloudflare** in front, per `TECH_STACK.md` — CDN, WAF, rate limiting.
- **Admin hardening** — 2FA and an IP allowlist on `/app`.
- **Monitoring / uptime alerting.** Nothing currently reports that the box is
  down.
