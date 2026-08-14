# peptides

Monorepo for the peptides project.

> **⚠️ The shop is trading with known gaps.** Ordering opened 2026-08-15 by
> explicit decision, with several blockers still open — most sharply that
> **every purity value, COA status and price in the catalog is fabricated**,
> and that no order confirmation email exists, so a customer receives nothing
> in writing after paying.
>
> Payment is direct bank transfer into an **interim personal Wise account**
> (`PUBLIC_BANK_*` in `.env`, never committed), not the business account; the
> confirmation page explains the payee mismatch.
> **[docs/go-live-checklist.md](docs/go-live-checklist.md) is the canonical
> list; read it before any deployment.**

| Folder        | Stack                          | Description              |
| ------------- | ------------------------------ | ------------------------ |
| `storefront/` | Astro + `@medusajs/js-sdk`     | Customer-facing store    |
| `backend/`    | Medusa v2 (Turbo workspace)    | Commerce backend / admin |

## Setup on a new machine

```bash
git clone https://github.com/kastriottanaj/peptide.git
cd peptide
```

### 1. Environment variables (not committed)

The `.env` files hold secrets and are **git-ignored**, so you must recreate them.

**`storefront/.env`**

```dotenv
PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_...   # from Medusa admin → Settings → Publishable API keys
PUBLIC_SITE_URL=http://localhost:4321  # local dev only; production is peptideeinkaufen.de

# Optional — measurement. Both are safe to leave unset; see docs/analytics.md.
PUBLIC_GA_MEASUREMENT_ID=              # G-XXXXXXXXXX. Unset = no analytics, no consent dialog.
PUBLIC_GOOGLE_SITE_VERIFICATION=       # Search Console meta-tag token; DNS TXT is used instead today.

# Optional — IndexNow. Unset = no key file, no submissions. See docs/indexnow.md.
INDEXNOW_KEY=                          # 8-128 chars of [A-Za-z0-9-]; served at /<key>.txt

# Ordering. UNSET = CLOSED; only the exact string `true` opens it.
PUBLIC_ORDERS_ENABLED=true             # keep local dev open so checkout stays testable

# Optional — contact channels shown on /contact/. Unset = channel not offered.
PUBLIC_CONTACT_EMAIL=                  # e.g. kontakt@peptideeinkaufen.de
PUBLIC_CONTACT_PHONE=                  # printed verbatim; formatting is yours
PUBLIC_CONTACT_HOURS=                  # e.g. Mo–Fr 9–16 Uhr; ignored without a phone
```

`PUBLIC_SITE_URL` drives every canonical URL, OpenGraph tag, JSON-LD `@id` and sitemap
entry. If it is wrong, all of them are wrong. It defaults to
`https://peptideeinkaufen.de`, so set it to `http://localhost:4321` locally to keep dev
builds off the production origin.

`PUBLIC_GA_MEASUREMENT_ID` switches Google Analytics on. Leaving it unset is a complete
off switch: no Google script, no consent dialog, no "Cookie-Einstellungen" footer entry,
and the Datenschutz page keeps its "no tracking in use" wording. Analytics never loads
before explicit consent either way — see [docs/analytics.md](docs/analytics.md).

`PUBLIC_CONTACT_EMAIL` and `PUBLIC_CONTACT_PHONE` are the only contact details the
storefront will ever print. They are configuration rather than source for the same
reason the bank details are: no address exists in this repository, and inventing one
puts a dead contact route on an indexable page. `src/lib/contact.ts` refuses anything
empty, bracketed or carrying a placeholder marker, so a half-filled `.env` shows no
channel instead of a broken `mailto:`. With none set, `/contact/` says the channels are
being set up and routes people to the order lookup; the Datenschutz controller block and
the `Organization` JSON-LD pick up the address as soon as it is configured. See
[docs/launch-data-needed.md](docs/launch-data-needed.md) §1.

`INDEXNOW_KEY` switches IndexNow on: the build emits `/<key>.txt` and a deploy pushes
the URLs whose HTML changed to Bing, Yandex and the other participants. Unset means no
key file and no submissions. It is currently unset in production on purpose — see
[docs/indexnow.md](docs/indexnow.md).

**Ordering is OPEN in production as of 2026-08-15** — real customers can order and
transfer real money. It was reopened by explicit decision with the legal pages, the
B2B/B2C decision, the confirmation email and the fabricated catalog data still open.
One variable governs both apps: `ORDERS_ENABLED` in
`/srv/peptides/.env`, which the Medusa service reads at runtime and from which
`deploy.sh` derives the storefront's `PUBLIC_ORDERS_ENABLED`. Unset means closed. Set
both to `true` locally (`storefront/.env` and `backend/apps/backend/.env`) to work on
checkout. See [docs/specs/2026-07-30-orders-closed.md](docs/specs/2026-07-30-orders-closed.md).

**`backend/apps/backend/.env`** — copy the template and fill in the blanks:

```bash
cp backend/apps/backend/.env.template backend/apps/backend/.env
```

Then set at least `DATABASE_URL` (Postgres) in that file.

`JWT_SECRET` and `COOKIE_SECRET` sign admin and customer sessions, and the template
ships them **blank** on purpose: whoever knows them can mint a valid admin session, so
a value that lives in the repository is no better than an open door. Local development
runs fine without them. For anything non-local, generate one per environment:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`medusa-config.ts` refuses to boot with `NODE_ENV=production` unless both are set to
something other than the old `supersecret` placeholder.

**The admin email inbox is off by default.** `INBOX_ENABLED` unset means the mailbox
importer never connects, and `/app/inbox` shows an empty state — the backend runs
exactly as it did without the feature. Turning it on connects Medusa to the existing
`info@peptideeinkaufen.de` mailbox over IMAP, **read-only**: it never marks a message
read, never deletes and never moves one, so the mailbox stays exactly as webmail
shows it. Read state in the admin is Medusa's own and is not written back. The
address is public; the mailbox password lives only in `.env`, never in the
repository. `INBOX_IMPORT_EXISTING=false` means the first connection records the
mailbox's current position and imports only mail that arrives *after* it — existing
history is left alone. Retention is unset, so nothing is ever deleted; enabling it
needs a retention decision *and* a Datenschutz update first. See
[docs/inbox.md](docs/inbox.md).

### 2. Install dependencies

```bash
cd backend && npm install && cd ..
cd storefront && npm install && cd ..
```

Node: backend needs `>=20`, storefront needs `>=22.12`.

### 3. Run

```bash
# backend (Medusa, http://localhost:9000)
cd backend && npm run dev

# storefront (Astro, http://localhost:4321)
cd storefront && npm run dev
```

### 4. Admin dashboard

Medusa ships its own admin — there is no custom backend to build. With the
backend running, open:

**http://localhost:9000/app**

It covers orders, products, categories, inventory, customers, promotions, price
lists and settings.

Create a login:

```bash
cd backend/apps/backend
npx medusa user -e you@example.com -p '<strong-password>'
```

Credentials are never committed. If you lose the password, re-run the command
with the same email to set a new one.

## Agent-facing surfaces

The storefront publishes three files for language models and agentic browsers.
All are Astro endpoints generated at build time from `src/lib/content-index.ts`,
so new products and articles appear in them automatically:

| URL               | Contents                                                |
| ----------------- | ------------------------------------------------------- |
| `/llms.txt`       | Map of the site plus the registered WebMCP tools         |
| `/llms-full.txt`  | Full text of every Wissen article and Lexikon entry      |
| `/api/search.json`| Search index behind the `search_site` tool               |

WebMCP tools (`search_site`, `get_product_details`, `add_to_cart`) are declared
in `src/lib/webmcp-tools.ts` and registered by `src/components/WebMCPTools.astro`.
See https://developer.chrome.com/docs/ai/webmcp.

### Required at deploy time: Permissions-Policy

Browsers only expose `navigator.modelContext` to a page that sends:

```http
Permissions-Policy: tools=(self)
```

A static Astro build emits files, not headers, so this is set by the host. In
production Caddy sends it on every response — see the `security_headers` snippet
in [deploy/Caddyfile](deploy/Caddyfile). If the site ever moves hosts, the header
has to move with it, or the tools register in code and no browser ever calls
them. Everything else (`llms.txt`, `llms-full.txt`, the search index) works
without it.

It is not sent by `astro dev`, so WebMCP cannot be exercised locally against the
dev server.

## Deployment

Production is a single Hetzner VPS with DNS pointed at it from Hostinger. The domain is
`peptideeinkaufen.de`. No Docker: Postgres, Redis, Node and Caddy come from apt, and
Medusa runs as a systemd service from an atomically swapped release directory.

**[docs/deploy.md](docs/deploy.md) is the runbook.** Everything it needs lives in
[deploy/](deploy/).

```bash
# routine deploy, on the server
bash /srv/peptides/repo/deploy/deploy.sh <commit-sha>
```

The storefront is currently **gated** behind HTTP basic auth and `noindex` — the legal
pages still show placeholder company data and the catalog carries fabricated purity
values. Opening it up is the last step of
[docs/go-live-checklist.md](docs/go-live-checklist.md), not a routine change.

Note that the storefront is a static build that fetches the catalog at build time, so a
product edited in the admin only appears on the site after a redeploy.

See `backend/README.md` and `storefront/README.md` for stack-specific details.
