# Deploy speed: where the time goes

Why a change takes ~8–17 minutes to appear on `peptideeinkaufen.de`, what has
been done about it, and what is still on the table.

Companion to [deploy.md](deploy.md), which is the runbook. This page is analysis
and status, not a procedure.

> **Status, 2026-07-31.** Nothing here has reached production yet. The
> `--prefer-offline` change lives on `worktree-incremental-deploy`, not on
> `main`. The backend cache is specified but not written. See
> [What is actually blocking a faster deploy](#what-is-actually-blocking-a-faster-deploy).

## Where the time actually goes

Measured on the 2–4 vCPU Hetzner box with a warm npm cache, from the published
durations in `deploy/deploy.sh`:

| Stage | Time | Needed for a storefront-only change? |
| ---- | ---- | ---- |
| backend `npm ci` + `medusa build` | 4–9 min (first run up to 15) | no |
| release `npm install` / `npm ci --omit=dev` | 1–3 min | no |
| database migrations | 5–30 s | no |
| Medusa restart + health wait | 20–60 s | no |
| storefront `npm ci` + build | 2–4 min | **yes** |
| Caddy validate + reload | seconds | only if the Caddyfile changed |
| IndexNow ping | < 5 s | yes |
| **Total** | **~8–17 min** | **~2–4 min of it is load-bearing** |

The headline: **a deploy rebuilds and restarts the backend regardless of what
the commit touched.** For a copy fix, an SEO tweak or a styling change, six to
thirteen minutes of that is pure waste.

How often does that matter? Over the last 25 commits on `main`:

| Change class | Count | Backend rebuild needed? |
| ---- | ---- | ---- |
| storefront-only | 4 | no — entirely wasted |
| touches `backend/` | 3 | yes |
| touches `deploy/` or root manifests | 11 | usually not |

The `deploy/` count is inflated by deploy tooling being actively worked on.
Once that settles, storefront-only is the class that will dominate — and it is
exactly the class paying the most for nothing.

## Two things that are commonly misunderstood

### Cloudflare is not in front of this site

There is no CDN to purge and nothing "propagating" after a deploy. The edge is
Caddy on the Hetzner box, terminating TLS directly. When the build finishes, the
new files are live.

The Cloudflare that *does* affect deploys is **npm's**: `registry.npmjs.org`
sits behind it, and it rate-limits by request volume, treating Hetzner ranges
harshly. That is the source of the `E429 Too Many Requests` failures documented
in [deploy.md](deploy.md). Three things about that failure mislead:

- **It names a package.** Whichever one npm happened to reach first. Nothing is
  wrong with that package.
- **A plain `curl` of the same URL returns 200.** One request is under the
  limit; npm opening many sockets is not.
- **Waiting does not fix it.** A 45-minute pause changes nothing, because the
  next deploy's first install empties the budget again within seconds.

`TECH_STACK.md` draws `Customer → Cloudflare (CDN / WAF)`. That is aspirational,
not what runs. Do not debug a deploy as though a CDN cache were involved.

### The storefront is static and reads the catalog at build time

Editing a product in the Medusa admin changes the API but not the built pages.
The site has to be rebuilt before the change is visible. There is no faster path
for content — this is a property of the architecture, not a missing feature.

## What has been done

### `--prefer-offline` on all three installs

*Status: committed on `worktree-incremental-deploy` (`a3865e5`). Not on `main`,
not deployed.*

A deploy runs **three** installs back to back — the backend build, the
production-only release install, and the storefront. Each went to the registry
for the full dependency set every run.

`--prefer-offline` serves from the local npm cache and contacts the registry
only for genuinely missing packages. It shortens warm installs and, more
usefully, cuts the request burst that trips `E429`. It complements the
`maxsockets 2` and retry settings `provision.sh` already sets rather than
replacing them.

Deliberately **not** `--offline`: a genuinely new dependency is still fetched,
so a lockfile change cannot silently install stale packages.

Modest on its own. It does not deliver the 8–17 → 3–5 minute win.

### Cache headers that let a deploy be seen at all

*Status: live on `main` since 2026-07-29; ported to the branch in `443340a`.*

Easy to overlook, but this is a visibility-latency fix rather than a build-time
one. `deploy/Caddyfile` sets:

- `/_astro/*` → `public, max-age=31536000, immutable`. Astro fingerprints these
  filenames, so they can be cached forever.
- everything else → `public, max-age=0, must-revalidate`.

Without the second rule a deploy can take a day to become visible to anyone who
already has the page cached — the build finishes in minutes and the change still
does not appear. The matcher is written by negation rather than `*.html` on
purpose: almost every page is served as a directory index (`/produkte/`,
`/wissen/lexikon/`) whose path does not end in `.html`.

## What is proposed but not built

### Cache the built backend instead of rebuilding it

Full design in
[specs/2026-07-31-incremental-deploy.md](specs/2026-07-31-incremental-deploy.md)
(on `worktree-incremental-deploy`). Summary:

Key a cache on `git rev-parse <sha>:backend` — the backend subtree hash — plus
the Node/npm/platform versions. Same key means the same build, so reuse the
previously built backend byte-for-byte instead of running `npm ci` and
`medusa build` again.

| Change class | Now | After |
| ---- | ---- | ---- |
| storefront-only | 8–17 min | **3–5 min** |
| docs-only | 8–17 min | 3–5 min |
| backend change | 8–17 min | 8–17 min, plus cache population |

**The obvious version of this does not work**, which is worth recording so it is
not attempted again. The first instinct is to skip the backend stages and leave
the backend out of the release. On the `codex/security-remediation` architecture
that fails: `validate_release` requires every release to carry a complete
backend (lockfile, installed Medusa CLI, runtime-state symlink), and releases
are content-addressed by `ARTIFACT_DIGEST`. Loosening that would trade six
minutes for the guarantee that any release verifies on its own. Not worth it.

Hence a cache rather than a skip: the release stays complete and
self-validating, and the digest covers the cached bytes exactly as it covers
rebuilt ones.

**Why it is not written yet:** it touches the boundary between the unprivileged
build user and code that becomes production. Only root may write or read the
cache, or a compromised build identity could inject a backend. That is precisely
what the security-remediation work exists to harden, so it wants review before
implementation, not after.

## What is actually blocking a faster deploy

Not the machine, and not the script. In order:

1. **The work is not on `main`.** `deploy.sh` refuses any commit that is not an
   ancestor of `origin/main` — deliberately, so nothing ships from a feature
   branch. The gate removal and `--prefer-offline` are on
   `worktree-incremental-deploy` and cannot be deployed until merged.

2. **`worktree-incremental-deploy` branches off a different deploy
   architecture.** `codex/security-remediation` rewrites `deploy.sh` from 345 to
   1448 lines and expects a server laid out with `ops-current`,
   `backend-current`, `storefront-current`, `csp-current`, snapshot directories
   and a dedicated `peptides-build` user. The live box has `current`,
   `releases/<sha>` and `storefront`, provisioned by `main`'s `provision.sh`.
   Landing that branch is a **server migration** governed by its own runbook,
   not a routine deploy.

3. **Deploys are manual by rule.** Per `AGENTS.md`, nothing releases as a side
   effect of a commit. The 8–17 minutes only starts when someone runs the
   script.

So the fastest realistic route to faster deploys is to port the backend-cache
design onto `main`, where deploys actually run today, rather than waiting on the
security-remediation migration.

## Rules of thumb

- A deploy that stalls is almost always npm hitting the registry rate limit.
  Check that before suspecting DNS, TLS or Caddy.
- A change to `deploy.sh` itself **takes effect one deploy later** — the script
  that runs is the copy already in `/srv/peptides/repo`, pinned to the previously
  deployed commit. Verify such a change by its second deploy.
- Database migrations do not roll back. Deploying an older SHA restores the
  code, not the schema. Dump the database before any deploy that migrates.
