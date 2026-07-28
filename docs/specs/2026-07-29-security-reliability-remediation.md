# Security and reliability remediation

- **Date:** 2026-07-29
- **Status:** Approved 2026-07-29
- **Basis:** Repository and gated-production audit completed 2026-07-29
- **Priority:** The dependency order below is binding. Tests ship with each
  unit; they are not postponed to a final testing phase.

## Goal

Remove the confirmed security vulnerabilities and correctness bugs from the
deployment, Medusa backend and Astro storefront, starting with the paths that
can expose the server or customer data.

The finished system must:

1. prevent the Medusa runtime from turning the root deployment process into a
   privilege-escalation path;
2. stop guest order IDs, checkout state and customer data from acting as public
   capabilities;
3. bind the amount shown at checkout to the shipping method, policy acceptance
   and order that the server actually creates;
4. represent bank transfer as unpaid until an operator confirms receipt;
5. fail closed under abuse, missing Redis, placeholder catalog data and unsafe
   production configuration;
6. make deployments recoverable and releases immutable;
7. restore meaningful automated test and dependency gates; and
8. remove the remaining lower-risk cart, catalog, SEO, WebMCP and header bugs.

The storefront remains behind its current basic-auth and `noindex` gate
throughout this work.

## Priority and delivery boundaries

This is one remediation programme, delivered as independently reviewable units:

| Order | Unit | Release condition |
| --- | --- | --- |
| P0-A | Local credential containment | Local cleanup first; live rotation only in an approved maintenance step |
| P0-B | Deployment containment, safe activation, gated headers and release recovery | Must replace the old deploy path before any schema-changing unit |
| P0-C | Private checkout bundle: quote, policy, payment, confirmation, abuse controls and its tests | Ships fail-closed as one unit before any additional test orders |
| P1 | Redis sessions, MFA and production secret validation | Required before public launch |
| P1 | Catalog, inventory, seed and shipping convergence | Required before real products are published |
| P2 | Dependency remediation and CI | Required before the remediation branch merges |
| P3 | Cart resilience, availability, SEO and WebMCP | Complete before closing this remediation |

P0-C has no partially enabled state. The public API host must return `503` from
the custom checkout route while `CHECKOUT_ENABLED=0`; it is enabled only after
the quote lock, policy evidence, pending bank-transfer provider, confirmation
token, rate limits and their tests are all present. Every unit includes its own
regression tests before merge.

## P0-A — contain exposed local credentials

These are ignored local files, so part of the remediation is operational rather
than committed:

- remove the credential-bearing curl exception from
  `.claude/settings.local.json`;
- set mode `0600` on `.claude/settings.local.json`,
  `CREDENTIALS.local.md`, `storefront/.env` and
  `backend/apps/backend/.env`;
- document the required modes and a non-secret check command; and
- replace examples that put passwords in argv with interactive/password-manager
  input.

The live gate credential is considered exposed and must be rotated. Rotation is
not performed by a repository commit: it requires an explicit approved
maintenance action and a newly supplied/generated secret. The old value must
then return `401`, the new value `200`, and neither value may be printed in chat,
logs, command arguments or committed files.

## P0-B — close the deployment privilege boundary

This section, the later P0-B release/backup section and the P0-B
headers/CSP section form one unit and land before P0-C. Their detailed
descriptions are separated only for readability.

### Required behavior

- `/srv/peptides/.env` is `root:medusa` mode `0640`; the `medusa` process can
  read but cannot alter it.
- `caddy.env` remains `root:caddy` mode `0640`.
- The repository, completed releases and published storefront are root-owned
  and not writable by the runtime user.
- A separate non-login `peptides-build` user owns disposable build space. It
  cannot read runtime secrets.
- Every npm lifecycle, Medusa build and storefront build runs as
  `peptides-build`, never root and never the network-facing `medusa` user.
- The deploy process begins with a fixed system `PATH`, clears loader/shell/npm
  injection variables, and reads only an explicit allowlist of configuration
  keys. It never exports arbitrary keys from an environment file.
- Production dependencies are resolved from a lock-backed artifact. The local
  Medusa CLI is invoked directly; root never runs `npx` and no deploy command
  may download an executable implicitly.
- Medusa can write only its systemd state directory, created mode `0700`, and
  runs with `UMask=0077`. A future upload directory, if needed, gets a separate
  narrow grant rather than write access to `/srv/peptides`.
- Provisioning repairs unsafe ownership and modes on existing installations as
  well as creating safe new ones.

### Files

- `deploy/provision.sh`
- `deploy/deploy.sh`
- `deploy/medusa.service`
- `deploy/medusa-migrate.service` (new)
- `deploy/.env.template`
- `docs/deploy.md`
- deploy-focused tests under `deploy/tests/` (new)

`medusa-migrate.service` is a hardened `Type=oneshot` unit running as `medusa`
against a root-managed candidate symlink. It loads runtime configuration
through systemd and invokes the installed CLI directly.

### Acceptance

- Runtime-user writes to `.env`, the current release, release history,
  repository and storefront fail; writes to `/var/lib/medusa` succeed.
- The build user cannot read `.env`.
- Process inspection during a fixture deploy shows every package/build command
  owned by `peptides-build`.
- Fixture environment keys such as `PATH`, `BASH_ENV`, `LD_PRELOAD`,
  `NODE_OPTIONS`, `npm_config_*` and unknown names are rejected and cannot
  influence command resolution.
- A Medusa-owned fake executable in a Medusa-writable fixture is never resolved
  or invoked by the root deploy.
- The hardened unit still boots the current release and serves `OK` from
  `/health`.

### Production rollout constraint

The current deployment path is itself inside the trust boundary being fixed.
The first server repair must therefore not run the old script after a possibly
compromised `medusa` user has had a chance to alter `.env` or release files.
The runbook will define a one-time, reviewed bootstrap from the Hetzner console
or a root-controlled checkout:

1. stop Medusa;
2. inspect and repair `.env` ownership and content without evaluating it;
3. install the reviewed service/build-user changes;
4. prove the existing release works read-only; and only then
5. use the new deploy path.

If compromise is suspected, the step is performed from the provider rescue
environment. Repository work does not itself perform this live mutation.

## P0-C — private checkout and order confirmation

### One application-owned quote and completion contract

The browser stops calling Medusa's public cart-complete and order-retrieve
routes. It first obtains an authoritative quote:

```text
POST /store/checkout/quote
```

with the cart ID, selected shipping option, email, VAT ID and complete
shipping/billing address. Under a per-cart distributed lock, the server applies
those values, recalculates shipping/promotions/tax and returns:

```json
{
  "quote_token": "short-lived authenticated token",
  "expires_at": "ISO-8601",
  "quote": {
    "cart_updated_at": "server revision after every quote mutation",
    "currency_code": "eur",
    "total_minor": 10990,
    "shipping_option_id": "so_…",
    "policy_versions": {
      "terms": "…",
      "privacy_notice": "…",
      "withdrawal_notice": "…"
    }
  }
}
```

`total_minor` is an integer in the currency's minor unit; the browser never
derives it from a floating-point formatted price. The authenticated quote token
binds the cart, publishable-key sales-channel context, post-mutation revision,
currency, minor-unit total, shipping option, policy versions and a short
expiry. It is never put in a URL or log.

Completion uses:

```text
POST /store/checkout/complete
```

with:

```json
{
  "cart_id": "cart_…",
  "quote_token": "…",
  "currency_code": "eur",
  "expected_total_minor": 10990,
  "policy_acceptance": {
    "terms": { "accepted": true, "version": "…" },
    "privacy_notice": { "acknowledged": true, "version": "…" },
    "withdrawal_notice": { "acknowledged": true, "version": "…" }
  }
}
```

The request carries an idempotency key bound to the cart, caller/sales-channel
context and a canonical hash of the request body. Reusing the key with a changed
payload returns `409`.

The completion workflow acquires the same per-cart lock and, before any new cart
mutation:

1. verifies the quote signature, expiry, caller, cart revision, shipping option,
   currency and minor-unit total;
2. validates current policy versions and stamps the server acceptance time;
3. attaches quote/policy validation to Medusa's core complete-cart validation
   hook so the check and core completion share the effective cart lock and
   inventory validation, with lock ordering covered by a concurrency test;
4. initiates the dedicated bank-transfer provider;
5. completes the cart idempotently;
6. persists the one canonical bank-transfer companion record and reference; and
7. issues the confirmation capability.

If any quoted value changed, it returns `409` with a new safe quote and creates
no order. The workflow must not validate, release its lock, and then invoke core
completion in a separate race window.

The response contains a 32-byte random token, its expiry and an allowlisted
`SafeConfirmationSummary`. That DTO contains only:

- display number and creation date;
- currency;
- item title, variant title, quantity and line total;
- merchandise subtotal, discount, shipping and grand total; and
- the persisted bank reference.

It contains no internal order/cart/customer IDs, email, address, phone,
payment collection, arbitrary metadata or unrequested relations.

Only `SHA-256(token)` is stored in Redis, mapped to the order for 24 hours. The
raw token is returned in the response, kept under one versioned
`sessionStorage` key, and sent in the body of:

```text
POST /store/order-confirmation
```

It never appears in a URL, log, analytics event, storage key or database.
Invalid, expired and unknown tokens receive the same generic response.

Redis availability and the idempotency record are checked before order
creation. Business completion is idempotent, but its raw confirmation token is
not stored for replay: a successful replay locates the already-created order,
safely mints an additional token without creating another order. Previously
issued digests remain valid until their original TTL so a concurrent response
cannot invalidate a token still in flight. A different key for an
already-completed cart follows the same cart/caller proof and cannot duplicate
the order. Token reissue has its own rate limit and never extends the TTL of an
older token.

The storefront navigates only after the fixed `sessionStorage` write succeeds.
If storage is unavailable, it renders the safe confirmation response in place,
warns the customer to keep the tab open and does not put the token in another
persistent location.

Medusa middleware denies guest access to:

- `POST /store/carts/:id/complete`; and
- `GET /store/orders/:id`.

The obsolete public payment-session initiation path is also denied for this
store; the custom workflow invokes the payment module internally.

The custom workflow invokes core Medusa workflows internally; it does not
reimplement order, reservation or totals logic.

### Recovery flow

Order number plus email no longer returns order data. The existing
`/store/order-lookup` route and public lookup UI are removed.

Until transactional email exists, the recovery page explains that the user
must use the active confirmation tab or contact support. The store stays gated
and the confirmation email remains a hard go-live blocker.

When email is implemented, recovery will be:

1. `POST /store/order-recovery/request`, always the same `202`;
2. if a non-draft, same-sales-channel order and normalized email match, email a
   raw random 10–15 minute single-use token exactly once, while storing only
   its digest server-side;
3. `POST /store/order-recovery/exchange` consumes it and issues a normal
   confirmation token.

Returning number-and-email order details is not retained as a temporary
fallback.

### Analytics and browser handling

- Successful checkout redirects to exactly `/bestellung/`, with no query or
  fragment.
- The browser stores only the token, expiry and safe DTO, not a raw Medusa
  order.
- `/kasse/`, `/bestellung/` and future recovery pages never initialize GA,
  even when the visitor previously granted statistics consent.
- Elsewhere GA automatic page views are disabled. The explicit page view
  normalizes both location and referrer to origin plus pathname, dropping
  queries and fragments.
- Confirmation API responses and sensitive pages use `Cache-Control: no-store`.

### Cart capability and retention

The cart identifier is treated as a pseudonymous bearer capability, not as
“non-personal data”:

- pre-checkout local storage uses a versioned `{ id, createdAt, lastUsedAt }`
  record with a 30-day inactivity expiry;
- once the quote endpoint attaches email/address, the ID moves to
  `sessionStorage` only and is removed from `localStorage`;
- completed and terminal carts clear both stores;
- an explicit reset calls a custom abandon endpoint and clears browser state;
- the server stamps when checkout PII was attached, and a daily job deletes or
  anonymizes incomplete PII-bearing carts after 24 hours of inactivity; and
- completed-order retention remains governed by the legal/accounting policy,
  not the abandoned-cart timer.

`datenschutz.astro` describes the capability, purposes and both retention
periods accurately. Cart reads and quote/abandon responses use `no-store`.

### Bank reference

- The generator moves to a tested backend helper and uses seven characters.
  `31^7` covers the full signed PostgreSQL serial range without the current
  modulo wrap.
- A small bank-transfer companion model stores a unique order relation,
  unique reference, policy evidence and payment state. Database uniqueness and
  the cart lock make its creation idempotent.
- The reference is committed to that model before the completion response is
  returned. It is not maintained through a read/spread/write of order metadata.
- The current subscriber is removed. Any repair command uses a transaction or
  conditional insert against the companion model and cannot overwrite
  unrelated order metadata.
- All storefront fallbacks (`PE-000001`, `PE-1`, or similar) are removed.
- A missing persisted reference is an error state; the customer is never shown
  competing payment instructions.

### Files

Backend:

- `src/api/store/checkout/quote/route.ts` (new)
- `src/api/store/checkout/complete/route.ts` (new)
- `src/api/store/checkout/abandon/route.ts` (new)
- `src/api/store/order-confirmation/route.ts` (new)
- `src/api/store/order-lookup/route.ts` (remove/replace)
- `src/api/middlewares.ts` (new)
- `src/workflows/complete-bank-transfer-checkout.ts` (new)
- focused workflow steps under `src/workflows/steps/` (new)
- `src/lib/order-bank-reference.ts` (new)
- `src/config/policy-versions.json` (new canonical values)
- `src/lib/safe-order-summary.ts` (new)
- a bank-transfer companion model/migration under
  `src/modules/bank-transfer/` (new)
- an abandoned-checkout cleanup job under `src/jobs/` (new)
- `src/subscribers/order-bank-reference.ts` (remove)

Storefront:

- `storefront/src/lib/cart.ts`
- `storefront/src/lib/bank.ts`
- `storefront/src/lib/legal.ts` (new build-time policy import)
- `storefront/src/lib/analytics.ts`
- `storefront/src/layouts/BaseLayout.astro`
- `storefront/src/pages/kasse.astro`
- `storefront/src/pages/bestellung.astro`
- `storefront/src/pages/bestellung/suchen.astro`
- `storefront/src/pages/datenschutz.astro`
- `docs/checkout.md`
- `docs/analytics.md`

### Acceptance

- A publishable key plus a real order ID cannot read an order, including with
  `fields=+metadata`.
- Direct cart completion cannot bypass policy/quote checks.
- Missing, false, malformed or stale acceptance, wrong shipping, stale
  quote revision or a changed minor-unit total creates no order.
- Retried and concurrent completion creates one order, one companion record and
  one reference while preserving unrelated order metadata.
- Successful checkout history, URL, DOM and Google requests contain no raw
  internal ID, raw order or capability. The one fixed `sessionStorage` value
  contains only the confirmation token, its expiry and the safe DTO; the token
  is never part of the storage key.
- The safe DTO is verified by an exact-key test.
- Reference property tests cover IDs `0`, `1`, `31^6` and `2_147_483_647`.

## P0-C — bind shipping, amount and policy evidence

The checkout becomes a single state machine rather than independent async
handlers:

- Initial country selection stores the country, lists valid shipping options,
  binds the first valid option on the server and paints that returned cart
  before enabling submit.
- Country, address and radio updates increment a generation. Stale responses
  are ignored and the form stays blocked while any authoritative update is
  pending.
- A selected zero-cost method renders `Kostenlos`; an unbound method renders
  `—`.
- On submit the address and chosen shipping method are rebound and the server
  cart is repainted. If the revision or any total changed, no completion call
  occurs and the customer must explicitly confirm the new amount.
- The final custom completion repeats the comparison server-side.
- Quantities are integers in the DOM, WebMCP schema and server validation.

Policy wording distinguishes accepting the AGB from acknowledging the privacy
and withdrawal notices. Current immutable version IDs live in a backend module,
are returned in every signed quote, and are embedded in the matching static
legal pages during the same release build. The release-manifest test proves
both artifacts contain identical values; a material legal-text change bumps
the values. Durable order evidence records the server time and exact versions
without retaining IP or user-agent unless legal review later establishes a
need and lawful basis.

Acceptance includes delayed-response tests for DE → FR, €10/€20/free shipping,
quote changes, double click, stale policy and direct API bypass.

## P0-C — represent bank transfer as unpaid

`pp_system_default` is a test provider and is replaced by a dedicated Medusa
payment provider:

- checkout creates an `awaiting bank transfer` / pending-authorization session;
- order creation does not claim that funds are authorized or captured;
- a minimal authenticated admin workflow confirms receipt, records operator
  and time, authorizes/captures the payment idempotently, and updates the order;
- the order detail gets a narrow admin extension only because the stock Medusa
  action cannot prove a bank transfer arrived; and
- an overdue-order job cancels still-unpaid bank-transfer orders and releases
  reservations after an initial committed timeout of 120 hours, but never
  touches confirmed funds. Changing that commercial timeout requires a reviewed
  config change and matching customer/email copy.

Admin confirmation and expiry acquire the same per-order distributed lock,
re-read payment and companion state, and perform a database conditional
transition from `awaiting`. Exactly one transition can win. If confirmation
wins, expiry cannot cancel it; if expiry wins first, a later bank receipt is
raised for explicit operator resolution rather than silently changing a
canceled order.

Files include a new provider under `src/modules/bank-transfer/`, a confirmation
workflow and admin route/widget, the region/store seed, checkout code and an
expiry job under `src/jobs/`.

Tests prove that creating an order is not payment, only an authenticated admin
can confirm receipt, confirmation is idempotent, expiry cannot cancel a paid
order, and simultaneous confirmation/expiry has one deterministic winner.

## P0-C — Redis-backed abuse controls

A small backend security service uses atomic Redis increments and expiry.
HMAC-derived keys are used for email, cart and order inputs; raw PII is never a
Redis key.

Provisioning generates a distinct 32-byte `SECURITY_HMAC_SECRET`. Production
boot refuses to enable checkout without that secret and real Redis; neither
falls back to an in-memory implementation.

Initial committed production limits are:

| Action | Limit |
| --- | --- |
| Cart creation | 30 per trusted IP per hour |
| Cart/line mutation | 120 per trusted IP per 15 minutes |
| Quote/complete attempts | 20 per trusted IP per 15 minutes; 10 per cart per 15 minutes |
| Newly created orders | 5 per trusted IP per hour; 3 per normalized email per 24 hours |
| Idempotent token reissues | 5 per completed cart per hour |
| Invalid confirmation tokens | 30 per trusted IP per 15 minutes; 10 per token digest per 15 minutes |
| Future recovery requests | 5 per trusted IP per hour; 3 per order/email tuple per 24 hours |
| Failed password authentication | 30 per trusted IP per 15 minutes; 10 per normalized account per 15 minutes |

Normalized email/account values, cart IDs and order/email tuples are HMACed
before use as keys. A successful idempotent replay does not consume another
new-order allowance, but does consume the token-reissue allowance. Stale,
malformed and changed-payload attempts consume the applicable attempt budget.
Successful authentication clears the account-failure bucket without clearing
the IP bucket.

State-changing and recovery endpoints fail closed when Redis is unavailable.
Responses use `429` plus `Retry-After`; recovery responses remain
indistinguishable. Caddy overwrites forwarding headers and Medusa trusts only
the loopback proxy, so a caller cannot choose the rate-limit IP.

The values may be lowered through validated configuration. Raising them is a
reviewed code/config change rather than an unconstrained production override.
Concurrent tests prove that the maximum cannot be exceeded. These are
application controls; a future edge WAF is an additional layer, not a
replacement.

## P0-B — atomic release, migration and backup model

### Release layout and sequence

Each immutable release contains both artifacts:

```text
/srv/peptides/releases/<sha>/backend
/srv/peptides/releases/<sha>/storefront
/srv/peptides/releases/<sha>/csp.caddy
```

Runtime uses separate root-managed `backend-current` and `storefront-current`
symlinks; the release-specific CSP snippet is validated and activated with the
storefront pointer. During activation Caddy serves a root-controlled maintenance response
for the storefront and state-changing/store API routes, so neither the old
storefront against the new backend nor the new storefront against an unhealthy
backend is externally visible.

The safe sequence is:

1. validate target SHA and server ownership/modes;
2. build backend and storefront in disposable unprivileged space;
3. install lock-backed production dependencies;
4. validate the candidate Caddy config and both artifacts;
5. enter maintenance, reject new writes, drain active requests and stop Medusa;
6. create a PostgreSQL custom-format release snapshot and prove
   `pg_restore --list` can read it after writes are stopped;
7. point a root-managed candidate symlink at the release and run the hardened
   migration unit;
8. switch `backend-current`, start Medusa while it is still hidden by
   maintenance, and require the local health status and body to pass;
9. switch `storefront-current` while public maintenance remains active, then
   exercise the real Caddy/TLS virtual host through a loopback-only verification
   matcher (`curl --resolve`) for gate body/status, cache and headers;
10. only after those checks pass leave maintenance and run authoritative
    external verification; and
11. print success only after external verification passes.

Both artifacts are published by symlink swap. `rsync --delete` never mutates the
live webroot.

Before maintenance, any failure leaves current code, database, Caddy and
storefront untouched. Once migration begins, the deploy script never
automatically starts old code against the new schema. A migration or new-backend
health failure keeps maintenance active, exits nonzero, preserves both pointers,
candidate, previous release and backup, and prints the explicit recovery path.
Database restore remains an operator action.

Any external gate/header/cache/API verification failure immediately re-enters
the root-controlled maintenance state before the script exits nonzero. It never
leaves a release serving after reporting that its gate may be bypassed. Recovery
and a second activation are explicit operator actions.

Schema changes use expand/contract compatibility. Zero-downtime migration is
not required; a short maintenance window is acceptable.

### Release snapshots and automated off-host backups

The pre-migration local dump is a release-recovery snapshot, not protection from
VPS loss. Add root-controlled systemd backup service/timer files that:

1. create a mode-`0600` `pg_dump -Fc` file;
2. verify it with `pg_restore --list`;
3. send it through an encrypted, provider-neutral Restic repository configured
   in a root-only environment/password file;
4. apply documented retention and run periodic `restic check`; and
5. delete the local staging copy only after the off-host write succeeds.

The code supports an operator-supplied SFTP/S3-compatible/Restic destination
without choosing a vendor or committing credentials. Missing off-host
configuration remains a hard go-live blocker and makes the scheduled unit fail
visibly. The runbook includes a restore drill onto a disposable database.
Release-time local snapshots remain mandatory even when the off-host timer is
healthy.

### Authoritative verification

Warnings become hard failures. In gated mode verification requires:

- API `/health`: `200` and body `OK`;
- unauthenticated storefront/page/asset: `401`, zero body and
  `WWW-Authenticate`;
- `X-Robots-Tag: noindex, nofollow`;
- `Cache-Control: private, no-store`; and
- all required security headers with no `Server` leak.

A root-controlled `SITE_GATED=1` setting defines the expected state. The deploy
prints `Deployed` only after every required assertion passes. It never stores a
plaintext gate password just to automate the authenticated browser check.

### Files

- `deploy/deploy.sh`
- `deploy/provision.sh`
- `deploy/Caddyfile`
- `deploy/caddy.env.template`
- `deploy/medusa.service`
- `deploy/medusa-migrate.service` (new)
- backup `.service` / `.timer` units (new)
- `deploy/tests/` (new)
- `docs/deploy.md`
- `docs/go-live-checklist.md`

## P0-B — gated headers, caching and CSP

While the gate exists, every storefront response—including fingerprinted
assets and authenticated responses—uses `Cache-Control: private, no-store`.
Public immutable caching is restored only as part of the deliberate launch
change.

The 401 path explicitly emits HSTS, content-type protection, referrer policy,
frame policy, Permissions Policy, robots policy and the authentication
challenge, with no body and no server banner. The API proxy strips
`X-Powered-By` and upstream server headers. The custom file server remains
restricted to real 404s.

Inventory executable scripts, JSON-LD and styles in every built page first.
Externalize executable inline code where possible; generate per-build SHA-256
hashes for unavoidable inline blocks and install the reviewed hash list with
the matching immutable storefront artifact. Exercise the policy in
`Content-Security-Policy-Report-Only` against cart, checkout, consent, search,
JSON-LD and GA, then enforce it in the same unit.

The enforced policy covers `default-src`, explicit `script-src`/`style-src`,
`base-uri`, `object-src`, `frame-ancestors`, `form-action`, image/font/connect
sources and consent-gated GA endpoints. Both `unsafe-eval` and an unrestricted
`unsafe-inline` are forbidden; the implementation cannot make CSP “pass” by
granting a global inline exception.

Local Caddy fixtures exercise authenticated and unauthenticated known pages,
assets and 404s before production verification.

## P1 — Redis sessions, MFA and production secrets

- Add `projectConfig.redisUrl` and a project-specific Redis prefix so HTTP
  sessions do not use Express MemoryStore.
- Generate `AUTH_MFA_ENCRYPTION_KEY` during provisioning. Medusa 2.18 consumes
  this variable automatically; no redundant Auth module override is added.
- Production boot requires Redis and the MFA key.
- JWT, cookie, MFA and `SECURITY_HMAC_SECRET` values must be at least 32 UTF-8
  bytes, reject common placeholders and be distinct where they protect
  different purposes; JWT and cookie secrets must differ.
- Admin TOTP enrollment remains an operational requirement before launch and
  is added to the go-live checklist.

Acceptance proves an admin session survives a Medusa restart, Redis contains a
namespaced session key, no MemoryStore warning appears, weak/equal/missing
secrets fail boot, and TOTP enrollment/login succeeds.

## P1 — convergent catalog, inventory and shipping

- Remove the non-idempotent starter `initial-data-seed.ts`.
- Add an explicit `seed-store.ts` that resolves the store, channel, region,
  location, profile and fulfillment set by stable identity and fails on
  ambiguity instead of choosing `[0]`.
- Every seed—including peptide, shipping and promotion reconciliation—uses
  those stable identities; none may fall back to the first result.
- It creates no demo clothing and never assigns inventory to unrelated items.
- `seed-peptides.ts` upserts by stable handle/SKU. It updates existing demo
  metadata, categories, options, variants and price sets rather than skipping.
- Demo/placeholder products are draft, `manage_inventory: true`,
  `allow_backorder: false`, and start at zero unless explicit verified inventory
  is supplied.
- Publication is refused while required analytical fields are missing or
  placeholder flags remain.
- Product availability, `AggregateOffer`, cards, selectors, search output and
  WebMCP all use one tested availability predicate.
- Shipping/region seeds share one canonical country set and update existing
  regions, zones, rates and options rather than skipping by name. The initial
  set is the seven countries the current region already offers
  (`de`, `dk`, `es`, `fr`, `gb`, `it`, `se`); adding destinations remains
  subject to the export/legal launch review rather than silently inheriting the
  larger shipping-script list.
- Quantity discount preserves the current documented per-line schedule: a
  tier is based on the quantity of one identical product/pack-size line. The
  storefront never derives an “earned” discount from total cart units and never
  claims it unless Medusa's returned `discount_total` contains it.

Add a separate, dry-run-by-default repair command for databases that may already
contain starter demo clothing or one-million-unit inventory. It identifies only
known starter handles/SKUs and the exact suspicious levels, prints the proposed
changes, requires an explicit apply flag, and never rewrites all inventory.
Running it against production data is a separately approved data operation.

Seed acceptance:

- two identical runs leave the second database snapshot unchanged;
- changing a fixture price, analytical value, country or rate updates the
  existing entity without duplication;
- a forced mid-run failure converges on rerun;
- no placeholder is published and no unrelated inventory changes; and
- `2 × A + 1 × B` receives no quantity discount, while `3 × A` receives the
  documented 3% on line A only.

## P2 — cross-cutting tests and dependency remediation

The security/correctness tests named here are authored with their owning
P0/P1 unit. P2 completes shared harnesses, dependency cleanup and CI; it is not
permission to merge an earlier behavior without its tests.

### Backend

- Add an app-level `test` script so root `turbo test` executes work.
- Add the missing Jest setup file and real unit/integration tests.
- Cover blocked core routes, safe tokens/TTL, rate-limit concurrency, quote and
  policy rejection, completion idempotency, reference consistency, payment
  state, secret validation, Redis sessions and seed convergence.

### Storefront

Add a small unit/browser test setup. Cover:

- terminal (404/410) versus transient cart retrieval errors;
- stale shipping generations and quote reconfirmation;
- clean confirmation URL/storage and zero GA on sensitive routes;
- per-line mixed-cart discounts;
- availability and lowest available price;
- analytics URL sanitizing;
- filter URL/canonical normalization; and
- WebMCP registration and integer quantity validation.

### Dependencies

- Re-run `npm audit` separately for production and development trees.
- Upgrade compatible Medusa/admin, React Router, Lodash, Vite/AJV/UUID and
  affected transitive paths; regenerate lockfiles with the pinned npm version.
- Do not use `npm audit fix --force`.
- `npm ls` must be clean.
- Production dependencies finish with no critical/high advisory. Any
  unavoidable production or development transitive exception must document
  reachability, affected commands/runtime, owner, upstream issue and an
  expiry/review date.

### CI

Add `.github/workflows/quality.yml` so pull requests and `main` run the same
backend/storefront gates with disposable Postgres and Redis services, a seeded
non-production catalog, Caddy validation and dependency review. CI uses only
generated test secrets and never receives production `.env` or gate values.
The workflow does not deploy.

## P3 — cart, availability, SEO and WebMCP cleanup

### Cart resilience and async races

- `getCart()` clears the local ID only for a confirmed terminal 404/410.
  Offline, parsing, auth, throttling and 5xx errors retain the ID and reject;
  `getOrCreateCart()` cannot create a replacement after a transient failure.
- Mutations are serialized or versioned so country, address, quantity and line
  responses cannot overwrite newer state.
- Buttons surface safe retry errors and cannot send fractional quantities.

### Availability

- Unavailable variants are disabled and labeled.
- The first available variant, not array index zero, is selected.
- All-sold-out products disable purchase controls, emit `OutOfStock`, expose no
  usable variant ID through search/WebMCP, and do not use an unavailable price
  for “ab”.
- Medusa remains authoritative for stock races.

### Facets and URL normalization

Client-only filters use URL fragments rather than indexable query documents on
`/produkte/`, `/wissen/` and `/wissen/lexikon/`. Header and in-page search write
fragment state. Legacy `?q=`/`?sort=` requests intentionally discard the old
filter and permanently redirect to the corresponding clean listing; this avoids
reflecting an untrusted query into a `Location` fragment and leaves no
indexable query document. No runtime robots-meta mutation remains.

Directory-style trailing slashes are made canonical because that matches the
static output Caddy already serves:

- `/produkte/`, product, category, article and legal directory routes return
  `200` directly;
- the no-slash form redirects once;
- internal links, canonical/OG/JSON-LD URLs, sitemaps and `llms.txt` use the
  same form; and
- the root remains `/`.

Filtered state has no separately crawlable HTTP URL, while the clean listing
retains its self-canonical `CollectionPage` graph.

Built-output and Caddy tests cover raw and redirected responses for all three
filterable listings.

### WebMCP

- Register against `document.modelContext`, with defensive feature detection
  and rejected-registration handling.
- Availability rules prevent tools from offering sold-out variant IDs.
- Tool schemas and runtime reject fractional/out-of-range quantities.
- Outputs containing catalog/content text carry the appropriate
  `untrustedContentHint: true` annotation.

## Documentation and concrete file set

In addition to the files named above, update:

- `README.md`
- `AGENTS.md` where the fragment filter architecture supersedes query facets
- `docs/checkout.md`
- `docs/analytics.md`
- `docs/deploy.md`
- `docs/go-live-checklist.md`
- both backend and deployment `.env.template` files
- backend/storefront `package.json` and lockfiles
- Astro configuration and shared URL/catalog helpers
- product cards/pages, cart/checkout pages, search output and WebMCP components

The implementation plan must name exact files and interfaces per task and end
each unit with verification, commit and push.

## Non-goals

- Removing or weakening the basic-auth/`noindex` gate.
- Deploying to production, rotating a live credential or changing DNS without a
  separate explicit approval.
- Inventing real purity, COA, price, inventory, bank or company/legal data.
- Declaring the shop ready for public orders.
- Transactional-email provider selection or credentials. The insecure lookup
  is removed until that separate blocker is implemented.
- Customer accounts, crypto payments or a custom replacement for Medusa admin.
- Docker, Kubernetes, multi-node operation or a hosting-platform migration.
- Zero-downtime schema migration, automatic down-migrations or silent database
  restore.
- Choosing or purchasing an external uptime-alerting provider. The repository
  can add health checks and hooks, but off-box alerting needs a provider and
  destination supplied by the operator.
- A forensic compromise assessment of the VPS. This remediation closes the
  code path; suspected compromise requires separate incident response.

## Verification

### Repository gates

```bash
git status --short

cd backend
npm ci
npm run lint
npm run build
npm run test
npm ls
npm audit --omit=dev
npm audit

cd ../storefront
npm ci
npm run test
npm run typecheck
npm run build
npm ls
npm audit --omit=dev
npm audit

cd ..
bash -n deploy/provision.sh deploy/deploy.sh
bash deploy/tests/validate-caddy.sh
```

The Caddy harness supplies a complete non-secret fixture environment, including
a test-only bcrypt hash and gate-state values, before running `caddy validate`;
the bare config is not expected to validate with required variables missing.

Also run:

- deploy fixture/adversarial environment tests;
- backend HTTP integration tests against Postgres and Redis;
- storefront browser tests against a disposable backend;
- built-output link, canonical, sitemap, JSON-LD and secret scans;
- the repository raw-hex check from `AGENTS.md`; and
- a dependency advisory review that separates runtime from dev-only reachability.

### Manual local checks

- Complete DE, non-DE and free-shipping carts; the selected method and final
  amount are visible before the binding click.
- Force a quote change and a delayed country response; neither creates an order
  without reconfirmation.
- Refresh confirmation, expire its token and retry completion.
- Confirm browser history, DOM, ordinary network URLs and GA contain no
  internal ID or token; inspect the one fixed `sessionStorage` value to confirm
  it contains only the token, expiry and safe DTO.
- Verify direct core completion/order read is denied.
- Confirm an unpaid bank transfer in admin, repeat it, then exercise expiry on a
  separate unpaid fixture.
- Run all seeds twice and inspect placeholder/inventory/shipping state.
- Exercise sold-out, mixed-stock and stock-race product variants.

### Server checks (only after separate infrastructure/deploy approval)

- Take and verify a database dump and VPS snapshot before the first containment
  rollout.
- Prove file ownership and failed runtime writes.
- Prove build processes run as `peptides-build` and cannot read runtime secrets.
- On a disposable VM/database restored from a backup, test a no-schema release,
  an intentional build failure, a migration failure and a candidate health
  failure. Never inject those failures into the only production VPS.
- Production receives only the normal reviewed containment/deployment and
  passive verification.
- Reboot and verify API, Redis sessions, admin MFA and scheduled backups.
- Verify authenticated and unauthenticated storefront headers, cache behavior,
  zero-byte gate responses, 404s, API CORS and sensitive-route analytics.
- Run normal read-only live smoke checks; do not brute-force, fuzz or create
  production orders without explicit authorization.
