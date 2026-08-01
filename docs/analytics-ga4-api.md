# GA4 Data API (backend)

Server-side Google Analytics 4 reporting, exposed as three authenticated Medusa
Admin endpoints. Runbook for configuring, testing and reasoning about it.

For the *client-side* half — the consent-gated `gtag` collection on the
storefront — see [analytics.md](analytics.md). The two are independent: this one
reads reports out of GA4, that one puts events in.

## What GA4 is and is not the source of truth for

| Question | Ask |
| --- | --- |
| How many visitors, from where, on what device | **GA4** |
| Which channel, source/medium, landing pages | **GA4** |
| Which events fired, how many key events | **GA4** |
| **How many orders, and for how much money** | **Medusa** |

GA4's ecommerce metrics (`transactions`, `purchaseRevenue`, `totalRevenue`,
`itemsPurchased`) are its own processed view of browser events. They will not
tie out to the shop's books, and are not supposed to:

- This is a German storefront with a **hard consent gate**. Visitors who decline
  statistics consent send nothing at all, so they are invisible to GA4 and fully
  visible to Medusa.
- GA4 attributes on its own model and applies its own processing latency.
- Realtime is an **activity signal, not live revenue**. Do not label a number
  from `/realtime` as sales.

Medusa's order records are the source of truth for anything to do with money.

## Configuration

All variables are read from the backend's `.env` (`backend/apps/backend/.env`),
which is git-ignored. Blank placeholders and the full commentary live in
`.env.template`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GA4_PROPERTY_ID` | yes | Numeric property id. **Not** the `G-XXXXXXXXXX` measurement id — the Data API does not accept that, and a measurement id here fails validation. |
| `GA4_MEASUREMENT_ID` | no | Recorded for consistency only; the Data API never uses it. |
| `GA4_CACHE_TTL_SECONDS` | no | Successful-report cache lifetime. Default `60`, clamped to `3600`, `0` disables caching. |
| `GA4_SERVICE_ACCOUNT_JSON` | one of | Whole service-account key as one line of JSON. |
| `GOOGLE_APPLICATION_CREDENTIALS` | one of | Absolute path to a service-account key file. |
| `GA4_ALLOW_DEFAULT_CREDENTIALS` | one of | `true` to use Application Default Credentials from the host. |

### Authentication

Exactly one method is selected, in this precedence order:

1. **`GA4_SERVICE_ACCOUNT_JSON`** — the production path. The JSON is parsed in
   memory, validated for `client_email` and `private_key`, and handed straight to
   the client. Escaped `\n` inside `private_key` is normalised to real newlines,
   because OpenSSL rejects the escaped form with an opaque PEM error that looks
   nothing like "your newlines are wrong". **Nothing is written to disk.**
2. **`GOOGLE_APPLICATION_CREDENTIALS`** — the local development path. An absolute
   path to a key file.
3. **`GA4_ALLOW_DEFAULT_CREDENTIALS=true`** — Application Default Credentials
   (workload identity, an attached service account).

Inline JSON wins over a key file so a production host can set it without having
to unset whatever path the platform already exports. Setting none of the three
is `GA4_NOT_CONFIGURED`, never a silent fallback to ADC — ADC resolves to a GCE
metadata identity or to whoever last ran `gcloud auth login`, so a forgotten
variable would otherwise report on whatever property that other identity can
reach instead of failing.

Production never needs a local filesystem path. Use `GA4_SERVICE_ACCOUNT_JSON`
there.

### The credential file stays outside the repository

A service-account key grants API access on its own. **It must live outside this
repo and must never be committed**, in any form — not the file, not its contents
pasted into a config, not a copy under a different name. Git history is
permanent: a key committed once stays retrievable after it is deleted, and the
only remedy is rotating it in Google Cloud.

`.env`, `.env.local` and `.env.production` are git-ignored. `.env.template`
carries blank placeholders only.

### Granting access

The service account needs **Viewer** on the GA4 property itself — a Google Cloud
project role is not enough. In GA4: *Admin → Property access management → add
the service account's email as Viewer*. Without it the endpoints return
`GA4_PERMISSION_DENIED`.

## Endpoints

All three are **admin-only** and require an authenticated Medusa admin. That is
structural: Medusa v2 applies `authenticate("user", ["bearer","session","api-key"])`
to everything under `/admin`, so the routes are protected by living in
`src/api/admin/**`. There are deliberately **no store routes** for analytics.

### `GET /admin/analytics/ga4/health`

Runs a minimal one-metric report to prove the service account really can read
the property — a config check alone would pass with a revoked key or a property
that was never granted.

```json
{
  "configured": true,
  "authenticated": true,
  "propertyAccessible": true,
  "propertyIdLastFour": "6789",
  "measurementIdConfigured": true,
  "authMethod": "key_file",
  "generatedAt": "2026-07-31T21:49:09.843Z"
}
```

Not cached — it is the button you press *because* you changed something.

### `GET /admin/analytics/ga4/realtime`

Current activity, via `runRealtimeReport`. Returns `totals` (`activeUsers`,
`screenPageViews`, `eventCount`, `keyEvents`), plus `activeUsersByCountry`,
`activeUsersByDeviceCategory`, `topPages` (by `unifiedScreenName`),
`eventCountsByEventName`, `generatedAt` and `cache`.

Issued as five separate Google calls, run concurrently: the Realtime API
supports a much narrower set of dimensions and metrics than the core API and
rejects most multi-dimension requests.

### `GET /admin/analytics/ga4/summary?period=today|7d|30d|90d`

Aggregated reporting via `runReport`. `period` defaults to `7d`; anything
outside the four values is `400 GA4_INVALID_PERIOD`. The set is closed on
purpose — each period is a cache key, and arbitrary date ranges would both
defeat the cache and hand an authenticated caller a way to burn the property's
Data API quota.

`7d` means the last seven days **including today** (`6daysAgo`..`today`), not
the eight days that `7daysAgo`..`today` would span. `90d` is `89daysAgo`..`today`
on the same rule; it was added for the admin dashboard's 90D button, and the
daily series is capped at 100 rows so ninety days are never clipped.

Returns `totals` (all ten metrics), `daily` (time series with ISO dates),
`byChannelGroup` (`sessionDefaultChannelGroup`), `bySourceMedium`
(`sessionSourceMedium`), `topPages` (`pagePath` with `screenPageViews` and
`activeUsers`), `period`, `dateRange`, `generatedAt` and `cache`.

`itemsPurchased` appears only in `totals`: it is item-scoped and does not
combine reliably with session-scoped acquisition dimensions.

`topPages` was added after the endpoint first shipped; callers that ignore it
are unaffected. It uses page-scoped metrics rather than `sessions`, because a
session spans several pages and "sessions per page" answers a different
question from "views of this page".

## Errors

Google's errors are never passed through. A missing key file reports its full
path in the message and a permission failure names the service-account email, so
every failure is collapsed into one of five codes with a fixed message.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `GA4_NOT_CONFIGURED` | 503 | No property id, or no authentication method set. |
| `GA4_INVALID_CREDENTIALS` | 503 | Key rejected, unreadable, or malformed inline JSON. |
| `GA4_PERMISSION_DENIED` | 403 | Service account lacks access to the property. |
| `GA4_PROPERTY_NOT_FOUND` | 404 | No such property. |
| `GA4_API_UNAVAILABLE` | 502 | Google is unavailable, or quota is exhausted. |

`GA4_INVALID_CREDENTIALS` is 503 rather than 401: the caller is an authenticated
admin who did nothing wrong, and answering 401 would send them to debug their
own session instead of the server's key.

Responses never contain the full property id, service-account email, credential
path, project id, private key, access token, raw Google error or stack trace.
Logs carry the error code and attempt count only.

The error body repeats `code` and `message` at the **top level** as well as
inside `error`. That is for `@medusajs/js-sdk`, which the admin dashboard uses:
it keeps only the body's top-level `message` when it converts a non-2xx into a
`FetchError`, so without the repetition the dashboard would show "Service
Unavailable" instead of the message written for the operator. The nested `error`
object stays because it is the documented shape.

**Retries.** Transient failures (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `INTERNAL`,
`ABORTED`) are retried up to three times with backoff. Invalid credentials and
permission denials are **never** retried — a rejected key is rejected just as
hard the second time. Quota exhaustion (`RESOURCE_EXHAUSTED`) is reported as
`GA4_API_UNAVAILABLE` and **not** retried: it is the one failure where retrying
makes things worse for every other caller of the property.

## Caching

Successful reports are cached for `GA4_CACHE_TTL_SECONDS`, and concurrent
identical requests are coalesced onto a single Google call. **Failures are never
cached** — granting access in the GA4 UI takes effect immediately rather than
after a TTL of an error nobody wanted kept.

Cache keys include the property id and a non-reversible fingerprint of the
credential, so repointing `GA4_PROPERTY_ID` or rotating a key under a running
process cannot serve a report fetched for the previous one.

## Testing the health endpoint

The backend must be running (`:9000`) with Postgres and Redis up.

```bash
cd backend/apps/backend
npm run dev
```

Confirm the route is actually protected — this must be `401`:

```bash
curl -i -s -o /dev/null -w '%{http_code}\n' \
  http://localhost:9000/admin/analytics/ga4/health
```

Then authenticate as an admin user and call it. Medusa v2 issues a JWT from
`/auth/user/emailpass`:

```bash
TOKEN=$(curl -s -X POST http://localhost:9000/auth/user/emailpass \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"your-password"}' \
  | jq -r '.token')

curl -s http://localhost:9000/admin/analytics/ga4/health \
  -H "Authorization: Bearer $TOKEN" | jq
```

The other two endpoints take the same header:

```bash
curl -s http://localhost:9000/admin/analytics/ga4/realtime \
  -H "Authorization: Bearer $TOKEN" | jq '.totals'

curl -s "http://localhost:9000/admin/analytics/ga4/summary?period=7d" \
  -H "Authorization: Bearer $TOKEN" | jq '.totals'
```

If you have no admin user yet:

```bash
npx medusa user -e you@example.com -p your-password
```

Reading `propertyAccessible: true` back means the credential, the property id
and the property grant are all correct.

## After changing configuration

Medusa reads the environment at boot. Restart it:

```bash
# local
cd backend/apps/backend && npm run dev

# production
sudo systemctl restart medusa
```

## Code map

| Path | Role |
| --- | --- |
| `src/lib/ga4/config.ts` | Env reading, validation, auth-method precedence |
| `src/lib/ga4/credentials.ts` | Inline JSON parsing, newline normalisation, fingerprinting |
| `src/lib/ga4/client.ts` | Shared `BetaAnalyticsDataClient`, rebuilt when the credential changes |
| `src/lib/ga4/errors.ts` | The five safe codes, classification, retry policy |
| `src/lib/ga4/cache.ts` | TTL cache and in-flight de-duplication |
| `src/lib/ga4/normalize.ts` | GA4 strings → numbers, rows → JSON |
| `src/lib/ga4/service.ts` | `checkHealth`, `getRealtime`, `getSummary` |
| `src/lib/ga4/http.ts` | The single funnel turning a failure into a response |
| `src/api/admin/analytics/ga4/*/route.ts` | The three admin routes |

Tests live in `src/lib/ga4/__tests__/` and run with `npm run test`. They mock
`BetaAnalyticsDataClient` and use fabricated credentials — no test reads the real
key.

The admin dashboard that consumes these endpoints is documented separately in
[analytics-dashboard.md](analytics-dashboard.md).
