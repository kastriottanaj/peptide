# peptides

Monorepo for the peptides project.

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

Then set at least `DATABASE_URL` (Postgres) in that file. `JWT_SECRET` and
`COOKIE_SECRET` default to `supersecret` for local dev — change them for anything
non-local.

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

See `backend/README.md` and `storefront/README.md` for stack-specific details.
