# peptides

Monorepo for the peptides project.

> **⚠️ Open before launch: real bank details.** Payment is direct bank transfer,
> so no real order can be paid until the business account details are set in
> `storefront/.env` (`PUBLIC_BANK_ACCOUNT_HOLDER`, `PUBLIC_BANK_IBAN`,
> `PUBLIC_BANK_BIC`, `PUBLIC_BANK_NAME`). Until then every confirmation page
> shows placeholders and tells the customer not to transfer.
>
> That is one of four hard blockers — bank details, real company data on the
> legal pages, the B2B/B2C decision, and the order confirmation email.
> **[docs/go-live-checklist.md](docs/go-live-checklist.md) is the canonical list;
> read it before any deployment.**

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
```

`PUBLIC_SITE_URL` drives every canonical URL, OpenGraph tag, JSON-LD `@id` and sitemap
entry. If it is wrong, all of them are wrong. It defaults to
`https://peptideeinkaufen.de`, so set it to `http://localhost:4321` locally to keep dev
builds off the production origin.

`PUBLIC_GA_MEASUREMENT_ID` switches Google Analytics on. Leaving it unset is a complete
off switch: no Google script, no consent dialog, no "Cookie-Einstellungen" footer entry,
and the Datenschutz page keeps its "no tracking in use" wording. Analytics never loads
before explicit consent either way — see [docs/analytics.md](docs/analytics.md).

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

#### Protect local secrets

Keep ignored credential and environment files readable only by your account. This
command repairs every file that is present without creating missing placeholders:

```bash
for secret_file in \
  .claude/settings.local.json \
  CREDENTIALS.local.md \
  storefront/.env \
  backend/apps/backend/.env
do
  test ! -e "$secret_file" || chmod 600 "$secret_file"
done

bash scripts/check-local-secret-modes.sh
```

The checker reports only filenames, modes and pass/fail; it never reads or prints
file contents. Store gate credentials in a password manager. Local tool permissions
may allow a command shape, but must never contain a username/password pair,
`Authorization` header or other secret.

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

Create a one-time admin invitation, then choose the password in the browser:

```bash
cd backend/apps/backend
npx medusa user --invite -e you@example.com
```

Treat the invitation URL as a secret until it has been used. Credentials are never
committed. Use the admin password-reset flow if you lose the password.

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

The storefront is **public**. The pre-launch gate (HTTP basic auth plus a site-wide
`noindex`) was removed on 2026-07-29 by explicit decision, ahead of the blockers in
[docs/go-live-checklist.md](docs/go-live-checklist.md) — the legal pages still show
placeholder company data, bank details are empty and the catalog carries fabricated
purity values. Those are live exposures now, not pre-launch tasks. The four legal
pages keep their own per-page `noindex` until their real company data lands.

Note that the storefront is a static build that fetches the catalog at build time, so a
product edited in the admin only appears on the site after a redeploy.

See `backend/README.md` and `storefront/README.md` for stack-specific details.
