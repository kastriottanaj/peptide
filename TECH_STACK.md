# Tech Stack

E-commerce site selling research peptides. Priorities: page speed / Core Web Vitals, SEO, CRO, and security (high-risk/restricted product category — avoid platform ban risk, avoid PCI card-data exposure).

## Overview

```
Customer → Cloudflare (CDN / WAF / DDoS / bot management)
         → Astro (storefront: product, category, blog/education, cart UI, checkout UI)
         → Medusa API (products, inventory, cart, orders, payments, shipping)
         → PostgreSQL (Medusa's database)
```

## Components

### Astro — storefront / frontend
- Renders product pages, category pages, blog/education content, cart, and checkout as static/SSR HTML.
- Islands architecture: ships ~0 JS by default, hydrates only interactive components (add-to-cart, quantity picker, filters, checkout form) using React or Svelte islands.
- Content Collections (Markdown/MDX) for blog/education pages — primary organic SEO driver for this niche.
- Owns: page speed, Core Web Vitals (LCP/INP/CLS), on-page SEO, on-page CRO/UX.

### Medusa — commerce backend
- Self-hosted, open-source, headless (Node.js/TypeScript). No storefront of its own — exposes an API.
- Owns: product catalog, pricing, inventory, customer accounts, cart logic, order management, shipping rules, admin dashboard.
- Payments: integrates directly with a high-risk-friendly processor (e.g. Durango, PaymentCloud, NMI) or crypto (BitPay, Coinbase Commerce) via tokenized/hosted fields — no raw card data touches our servers (PCI scope minimization).
- Self-hosting avoids the SaaS platform ban risk that comes with Shopify/BigCommerce's restrictions on research-chemical products.
- Database: PostgreSQL.

### Cloudflare — infrastructure / security
- CDN + DNS in front of Astro and Medusa.
- WAF, DDoS protection, bot management, rate limiting — applied especially to `/checkout` and Medusa's `/admin`.
- Does not run application logic; only accelerates and protects delivery.
- Note: Cloudflare acquired Astro (Jan 2026), giving tighter native integration between the two.

## Supporting tools

| Purpose | Tool |
|---|---|
| Product search / filtering | Meilisearch (self-hosted) |
| Analytics | Google Analytics 4 (consent-gated — see [docs/analytics.md](docs/analytics.md)) |
| Search performance / indexing | Google Search Console (domain property, DNS-verified) |
| Payments | High-risk processor (Durango / PaymentCloud / NMI) or crypto (BitPay / Coinbase Commerce) |
| Admin access | 2FA enforced, IP allowlist / VPN where feasible, separate subdomain |
| Dependency security | Dependabot / Snyk on both Astro app and Medusa backend |

## Alternatives considered

- **Next.js** (instead of Astro) — more mature ecosystem for large catalogs (ISR at scale), but ships more JS by default; worse out-of-the-box CWV for a content-heavy, small-to-mid catalog site like this one.
- **Shopify / BigCommerce** (instead of Medusa) — faster to launch, but ToS restrictions on research chemicals/peptides create real account-ban risk; also less control over checkout/payment integration.
- **Vendure** (instead of Medusa) — TypeScript/NestJS core, more rigid/opinionated architecture, arguably easier to audit for security/access control. Good alternative if a merchant-account underwriting review demands stricter architecture; Medusa chosen for faster build time and larger ecosystem.
- **Saleor** (instead of Medusa) — Python/GraphQL-first, strong multi-channel support, but breaks TypeScript-everywhere consistency with Astro.
