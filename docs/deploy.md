# Deploy runbook

Production is a single Hetzner VPS with DNS delegated from Hostinger. The domain
is `peptideeinkaufen.de`. **No Docker** — Postgres, Redis, Node and Caddy come
from apt, and Medusa runs as a systemd service.

> **The site is public as of 2026-07-29.** The pre-launch gate — HTTP basic auth
> plus a site-wide `X-Robots-Tag: noindex` — was removed by explicit decision,
> before the hard blockers in [go-live-checklist.md](go-live-checklist.md) were
> cleared. Bank details are still empty, the legal pages still render
> `[Platzhalter]` company data and there is still no order confirmation email, so
> **the shop can take an order it cannot be paid for.** Closing that gap is the
> live priority; see [What is still open](#what-is-still-open).
>
> The four legal pages remain `noindex` through the `draft` prop in
> `LegalLayout`. That is per-page and independent of Caddy — leave it until the
> real company data lands.

```
Internet
  └── Caddy :80/:443 ── auto-TLS, security headers, the gate
        ├── peptideeinkaufen.de  → static files in /srv/peptides/storefront
        ├── www.…                → redirect to apex
        ├── api.…                → 127.0.0.1:9000  (medusa.service)
        │     ├── postgresql.service    (127.0.0.1:5432)
        │     └── redis-server.service  (127.0.0.1:6379)
        └── admin.…              → 127.0.0.1:9000  (the same Medusa)
```

Medusa binds loopback only, so Caddy is the only way in. Postgres and Redis are
on their Ubuntu defaults, which also bind loopback.

`api.` and `admin.` are the same process. Medusa serves the dashboard from the
Node server at `/app`, so the second hostname is a Caddy-level split, not a
second app to deploy or restart. See [The admin dashboard](#the-admin-dashboard).

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
| A | `admin` | `<hetzner-ipv4>` | 3600 |

If the box has IPv6, add the same four as `AAAA` records.

Delete any pre-existing `A`/`CNAME` records for `@`, `www`, `api` or `admin`
pointing at Hostinger parking — two records for one name resolve unpredictably.

**Do this before deploying.** Caddy requests certificates on first request per
hostname and issuance fails until the names resolve. Verify:

```bash
dig +short peptideeinkaufen.de
dig +short www.peptideeinkaufen.de
dig +short api.peptideeinkaufen.de
dig +short admin.peptideeinkaufen.de
```

All four must return the Hetzner IP before continuing. A hostname that does not
resolve does not get a certificate, and Caddy retries issuance rather than
serving the site — so `admin.` will look broken until the record propagates.

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

Open `https://admin.peptideeinkaufen.de`, log in, go to **Settings →
Publishable API keys**. Copy the `pk_…` value, and make sure it is linked to a
sales channel containing the products — an unlinked key returns an empty catalog
and the storefront builds an empty shop.

```bash
nano /srv/peptides/.env    # set PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_…
bash /srv/peptides/repo/deploy/deploy.sh <same-sha>
```

## 5. Verify

```bash
curl -sI https://peptideeinkaufen.de            # 200, no X-Robots-Tag
curl -s  https://api.peptideeinkaufen.de/health # OK
curl -sI https://admin.peptideeinkaufen.de      # 302 → https://admin.…/app
curl -sI https://api.peptideeinkaufen.de/app    # 302 → https://admin.…/app
curl -sI https://peptideeinkaufen.de/impressum | grep -i x-robots  # per-page noindex stays
```

In a browser:

- Homepage, a product page and a Wissen article render
- Product pages show real prices — not an empty catalog
- `https://admin.peptideeinkaufen.de` reaches the admin login, and logging in
  lands on the dashboard rather than bouncing back to the login form
- `Permissions-Policy: tools=(self)` present (required for WebMCP)
- No site-wide `X-Robots-Tag` — but `/impressum` and the other three legal pages
  still carry a per-page `noindex`
- `/sitemap.xml` and `/llms.txt` contain `https://peptideeinkaufen.de` URLs,
  not `localhost`
- Add to cart works against the live API
- `reboot` the box and confirm everything returns unattended

---

## The admin dashboard

**<https://admin.peptideeinkaufen.de>** — log in with the email and password of
a Medusa user. Credentials for this deployment are in the untracked
`CREDENTIALS.local.md`, not here.

The bare hostname redirects to `/app`, which is where the dashboard actually
lives, so the address bar always ends up on `https://admin.peptideeinkaufen.de/app`.
That path is not a Caddy choice and cannot be moved by config: `medusa build`
compiles it into the bundle as Vite's `base` and mounts the dashboard's router
under it. Changing it means changing `admin.path` in `medusa-config.ts` and
rebuilding.

`admin.` and `api.` are one Medusa process on `127.0.0.1:9000`; the split is two
Caddy site blocks. Nothing extra runs, so there is nothing extra to restart or
monitor — `systemctl status medusa` covers both.

- **The whole host is proxied, not just `/app`.** The dashboard calls `/admin`
  and `/auth` on whatever origin served it, so proxying everything keeps those
  calls same-origin. That is deliberate: it means a login cannot break because
  `ADMIN_CORS`/`AUTH_CORS` in `/srv/peptides/.env` forgot a hostname. Do not
  "tidy" this into a `/app`-only proxy.
- **`api.…/app` redirects here** (302). One admin URL to bookmark and one to
  lock down. The old link keeps working, it just does not stay.
- Both hosts send `X-Robots-Tag: noindex, nofollow`.
- No basic auth in front of it — the dashboard has its own login, and the same
  origin serves the store API, which the storefront calls cross-origin without
  credentials. `GATE_USER`/`GATE_PASSWORD_HASH` sit unused in `caddy.env`; see
  [Re-gating](#re-gating) before reaching for them here.

Adding or resetting a user (the password is a CLI argument, so it lands in the
shell history and the terminal scrollback — rotate anything typed on a shared
machine):

```bash
cd /srv/peptides/current
sudo -u medusa HOME=/var/lib/medusa NODE_ENV=production \
  npx medusa user -e you@example.com -p '<strong-password>'
```

`HOME=` is not optional: `npx` writes to a cache under `$HOME`, and the `medusa`
system user's home is `/var/lib/medusa`.

There is no self-service password reset and no email transport configured, so an
account whose password is lost is recovered with the same command, not from the
login screen.

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

Most of that is the backend rebuild, which runs whether or not the commit
touched `backend/`. [deploy-speed.md](deploy-speed.md) breaks down where the
time goes and what can be cut.

If output stalls well past these:

```bash
cat /srv/peptides/deploy.lock
systemctl status medusa
journalctl -u medusa -n 100 --no-pager
```

### `E429 Too Many Requests` at "Assembling release"

```
==> Assembling release  (expect 1-3 min)
npm error code E429
npm error 429 Too Many Requests - GET https://registry.npmjs.org/@medusajs%2fmodules-sdk
```

`registry.npmjs.org` is behind Cloudflare, which rate-limits by request volume
per IP and treats Hetzner ranges harshly. A deploy runs **two** installs: `npm
ci` for the build (~1400 packages), then a second `npm install` when assembling
the release. The first spends the IP's budget; the second hits the wall.

**The failure is not what it looks like.** Three things mislead:

- *It names a package.* The package in the message is just whichever one npm
  reached first — it moved between `@medusajs/modules-sdk`, `admin-sdk` and
  `types` across runs. Nothing is wrong with that package.
- *A plain `curl` of the same URL returns 200.* One request is under the limit;
  npm opening 15 sockets is not. A green `curl` does **not** mean the deploy
  will get through, and probing that way will send you in circles.
- *Waiting does not fix it.* A 45-minute pause changed nothing, because the
  next deploy's first install empties the budget again within seconds.

The fix is patience in the npm client, not retrying the deploy. `provision.sh`
sets these; if you are on a box that predates that, apply them by hand:

```bash
npm config set maxsockets 2            # lower the burst that trips the limit
npm config set fetch-retries 8         # default 2 — gives up before the refill
npm config set fetch-retry-mintimeout 20000
npm config set fetch-retry-maxtimeout 180000
```

Then re-run the deploy normally. Expect the assemble step to take longer than
the 1–3 min in the table above; that is the trade, and it succeeds.

Confirm it is this and not a genuine registry outage — the blocked fetch returns
`server: cloudflare` and a `retry-after` header, and *other* packages still
return 200 from the same box:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/express
curl -sD- -o /dev/null 'https://registry.npmjs.org/@medusajs%2ftypes' | head -5
```

A failure here is safe: it happens long before the symlink moves, so the running
release is untouched. Observed 2026-07-30, when five consecutive deploys of
`c9fc26e` died this way and the sixth, with these settings, went through.

### A change to `deploy.sh` itself takes effect one deploy later

**The script that runs is the one already on the box, not the one at the SHA you
are deploying.** `bash /srv/peptides/repo/deploy/deploy.sh <sha>` starts executing
the working copy in `/srv/peptides/repo`, which is pinned to the *previously*
deployed commit; the `git checkout` to `<sha>` happens inside that run, after
bash has begun reading the file. So a deploy that ships a new step in `deploy.sh`
does not perform that step — the next deploy does, because by then the new script
is on disk.

Observed on 2026-07-30: the deploy of `2f62d6c` added the IndexNow submission
step and did not run it. The step first ran on the following deploy (`86f0d7b`),
six minutes later, which is why the first submission timestamp does not match the
deploy that introduced it.

Practical consequences:

- **Verify a `deploy.sh` change by its second deploy, not its first.** A missing
  step in the first run is expected, not a bug to chase.
- If a step must run with the commit that introduces it, deploy twice — the
  second run is fast, since npm caches and the build are warm.
- Do not "fix" this by editing the script on the server. It re-installs from the
  repo on every deploy, so a hand edit is lost at the next run and, worse, makes
  the server disagree with the file you are reading.
- Editing a running bash script is genuinely hazardous — bash reads scripts by
  byte offset, so a mid-run change can splice the old and new file. Treat a
  deploy that modifies `deploy.sh` as one whose *later* steps are unpredictable,
  and re-run it once the new script is in place.

### The catalog and the storefront are coupled

The storefront is static and fetches the catalog **at build time**. Editing a
product in the admin changes the API immediately but does **not** change the
built pages. After a catalog change, re-run `deploy.sh` with the current SHA.

### Publishing the contact email

`/contact/`, the Datenschutz controller block and the `Organization` JSON-LD all
read one variable, `PUBLIC_CONTACT_EMAIL`. While it is unset the pages state that
no contact channel is published — which is correct, and better than an address
nobody reads. Publishing one is therefore a deploy step, not a code change.

**The intended address is `info@peptideeinkaufen.de`. As of 2026-08-01 it is
NOT confirmed to receive mail, so it is not configured anywhere.**

1. **Verify the mailbox first.** Send a message to it from an unrelated account
   and confirm it arrives and can be replied to. An address on an indexable page
   that bounces is worse than no address: § 5 DDG requires a channel that works,
   and a customer only discovers the failure after writing. Do not skip this
   because the domain resolves — MX records and a working mailbox are different
   things.
2. **Back up the environment file** before editing it. It also holds the database
   password and the Medusa signing secrets, so a slip costs more than this
   variable:
   ```bash
   cp -a /srv/peptides/.env /srv/peptides/.env.bak-$(date +%F-%H%M)
   ```
3. **Set it exactly once.** Append the line, then confirm there is exactly one:
   ```bash
   nano /srv/peptides/.env          # PUBLIC_CONTACT_EMAIL=info@peptideeinkaufen.de
   grep -c '^PUBLIC_CONTACT_EMAIL=' /srv/peptides/.env   # must print 1
   ```
   A duplicate key is not an error — the last one silently wins, which is how a
   corrected address gets overridden by the typo above it.
4. **Rebuild and deploy.** The storefront is static and bakes the value in at
   build time, so the variable does nothing until a build reads it:
   ```bash
   bash /srv/peptides/repo/deploy/deploy.sh <sha>
   ```
   **`systemctl restart medusa` is not sufficient** — it restarts the API, which
   never reads this variable. Nothing on the storefront changes until the build
   runs.
5. **Verify on the live site**, not in the shell: `/contact/` must show the
   address as a `mailto:` link, and `/datenschutz/` must show it in section 1.

`src/lib/contact.ts` rejects anything empty, bracketed or carrying a placeholder
marker, so a half-filled value renders no channel rather than a broken
`mailto:`. Note that reserved example domains are rejected too — a test address
like `kontakt@example.com` will silently render nothing.

Never commit the value: it belongs in `/srv/peptides/.env` and, for local work,
in the git-ignored `storefront/.env`.

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

### Apply the seven-category catalog expansion

This is an explicit Medusa data operation, not a migration and not an automatic
deploy step. It creates the three approved categories (`glp-1-forschung`,
`peptid-stacks`, and `laborbedarf`) and adds the existing repository-owned
Retatrutide record to GLP-1-Forschung without removing any existing category.
The operation never creates a product.

Do not proceed if production differs from the expected one Retatrutide demo record,
if a desired handle has a conflicting name, or if any protected product field differs
unexpectedly. First capture the current product and category records through the
Medusa Admin/API, including Retatrutide's ID, category IDs, variants, prices,
inventory, images, description, metadata, and the total product count. Save that
read-only output with the change record.

Back up the database before the first write:

```bash
sudo -u postgres pg_dump medusa_peptides | gzip > ~/medusa-before-category-expansion-$(date +%F-%H%M).sql.gz
```

After the verified commit has reached `main` and has been deployed through the normal
scripted path, run the built-in dry run from the active release:

```bash
cd /srv/peptides/current/backend/apps/backend
sudo -u medusa env CATEGORY_EXPANSION_DRY_RUN=true NODE_ENV=production npx medusa exec ./src/scripts/expand-product-categories.ts
```

The dry run performs ownership and conflict checks and reports intended changes but
writes nothing. If it matches the approved change, apply it once, then immediately
run it again. The second run must report zero category creations and an existing
Retatrutide GLP-1 assignment:

```bash
sudo -u medusa env NODE_ENV=production npx medusa exec ./src/scripts/expand-product-categories.ts
sudo -u medusa env NODE_ENV=production npx medusa exec ./src/scripts/expand-product-categories.ts
```

Re-read the same Medusa records and compare them with the captured before-state.
There must still be one Retatrutide product and the same total product count. Its old
category IDs, variants, prices, inventory, images, description, and metadata must be
unchanged; only the GLP-1 category ID is added. Peptid-Stacks and Laborbedarf must
have zero products. Then rebuild the static storefront through the one approved
deployment command so the new routes and navigation reflect live Medusa data:

```bash
bash /srv/peptides/repo/deploy/deploy.sh <verified-main-sha>
```

Verify the public catalog, all seven category routes, robots metadata, sitemap, and
`llms.txt`. GLP-1-Forschung is indexable and discoverable; the two empty categories
render `noindex, follow` and are absent from sitemap and `llms.txt` until a real
product relationship exists.

For a targeted rollback, use Medusa Admin/API operations—not SQL—to restore the exact
captured pre-change category-ID set on Retatrutide. Delete only category records that
this operation created, and only after verifying that no unexpected product is linked;
GLP-1 must be unlinked first, while Peptid-Stacks and Laborbedarf should already be
empty. Rebuild the storefront afterward. If the changed records cannot be identified
unambiguously or any broader data changed, stop and restore the database backup. A
code rollback does not roll back Medusa catalog data.

## What is still open

The gate came off on 2026-07-29, **before** the hard blockers in
[go-live-checklist.md](go-live-checklist.md) were cleared. The site is public and
crawlable, so these are now live exposures rather than pre-launch tasks. In
priority order:

1. **Bank details.** The four `PUBLIC_BANK_*` values in `/srv/peptides/.env` are
   empty, so an order confirmation shows no account to pay into. A customer can
   order right now and has no way to pay. Set them and redeploy — the storefront
   is static, so the values only reach the page on a rebuild.
2. **Company data on the legal pages.** All four still render `[Platzhalter]`.
   They keep a per-page `noindex` from the `draft` prop, so they are not indexed,
   but they *are* publicly reachable — and a German commercial site is required
   to carry a valid Impressum. Fill in the data, then drop the `draft` prop.
3. **Order confirmation email.** Still absent (checklist §6). With bank transfer
   the payment reference exists only on the confirmation page.
4. **Rate-limit `/store/order-lookup`.** Now publicly reachable. Unauthenticated,
   takes an order number and an email; the generic error stops probing for which
   half was wrong, but nothing stops volume.
5. **Catalog purity values** are still fabricated and tagged `demo`.

To submit the sitemap now that Google can reach the site, see step 6 in
[analytics.md](analytics.md).

### IndexNow

Wired but **off**: `INDEXNOW_KEY` is unset in `/srv/peptides/.env`, so no key file
is published and no deploy submits anything. Turning it on is one variable plus a
deploy:

```bash
nano /srv/peptides/.env    # INDEXNOW_KEY=<8-128 chars of [A-Za-z0-9-]>
bash /srv/peptides/repo/deploy/deploy.sh <commit-sha>
```

Then submit the whole site once. Every later deploy submits only the pages whose
built HTML changed, automatically:

```bash
cd /srv/peptides/repo/storefront
node scripts/indexnow-submit.mjs --state /srv/peptides/indexnow-state.json --all
```

Be clear about what that buys: the site is already crawlable, so Bing will reach
it either way — IndexNow decides whether that takes minutes or weeks. With items
1–5 above still open, pulling it forward is a judgement call, not a free win.
Runbook: [indexnow.md](indexnow.md).

### Re-gating

If the site needs to go back behind a password, restore a `basic_auth` block in
[deploy/Caddyfile](../deploy/Caddyfile) and redeploy. `GATE_USER` and
`GATE_PASSWORD_HASH` are still present in `/srv/peptides/caddy.env`:

```caddyfile
basic_auth {
	{$GATE_USER} {$GATE_PASSWORD_HASH}
}
header X-Robots-Tag "noindex, nofollow"
```

`deploy.sh` verifies the storefront answers **200** on every deploy and warns on a
401, so an accidental re-gating is visible in the deploy output.

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
