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
```

`PUBLIC_SITE_URL` drives every canonical URL, OpenGraph tag, JSON-LD `@id` and sitemap
entry. If it is wrong, all of them are wrong. It defaults to
`https://peptideeinkaufen.de`, so set it to `http://localhost:4321` locally to keep dev
builds off the production origin.

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

This repo has no production deployment and no host configuration, so the header
cannot be set here: a static Astro build emits files, not headers. Whoever
introduces the deploy path must add it, in whichever of these the host uses:

- Cloudflare Pages or Netlify: a `public/_headers` file containing `/*` and the
  header line beneath it.
- Vercel: a `headers` entry in `vercel.json`.
- Nginx or Caddy: an `add_header` / `header` directive on the site block.

Until that header ships, the tools register in code but no browser will call
them. Everything else (`llms.txt`, `llms-full.txt`, the search index) works
without it.

See `backend/README.md` and `storefront/README.md` for stack-specific details.
