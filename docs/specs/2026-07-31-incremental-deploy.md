# Faster deploys: cache the built backend instead of skipping it

- **Date:** 2026-07-31
- **Status:** proposed — **not approved, not implemented**
- **Branch:** builds on `codex/security-remediation`
- **Supersedes:** the same-named spec drafted against `main`'s 345-line
  `deploy.sh`, which assumed a skip-the-stage design that does not fit here.

## Problem

Every deploy pays the full backend build regardless of what the commit touched:

| Stage | Time | Needed for a storefront-only change? |
| ---- | ---- | ---- |
| backend `npm ci` + `turbo build` | 4–9 min (first run up to 15) | no |
| backend `npm ci --omit=dev` | 1–3 min | no |
| migrations | 5–30 s | no |
| backend candidate start / health / restart | 1–2 min | no |
| storefront `npm ci` + build + CSP | 2–4 min | **yes** |
| **Total** | **~8–17 min** | **~2–4 min is load-bearing** |

Over the last 25 commits on `main`: 4 were storefront-only, 3 touched `backend/`,
11 touched `deploy/` or root manifests. Storefront-only is the class that will
dominate once deploy tooling settles, and it is the class paying the most for
nothing.

## Why the obvious fix does not work here

The first instinct — skip the backend stages and leave the backend out of the
release — is **incompatible with this branch's release contract**, and that
contract is the point of the security remediation:

- `validate_release` (`deploy.sh:551-559`) requires every release to carry
  `backend/package-lock.json`, an installed `@medusajs/cli`, and the
  `/var/lib/peptides/static` runtime-state symlink.
- `RELEASE_ID` is `${FULL_SHA}-${BUILD_IDENTITY}-${ARTIFACT_DIGEST}`
  (`deploy.sh:771`); the digest covers the whole promoted tree.
- Releases are immutable, root-owned, and independently re-validated on reuse
  (`deploy.sh:785-795`).

A release missing its backend fails validation, and loosening validation to
permit it would trade a 6-minute saving for the guarantee that any release can
be verified on its own. Not worth it.

Two things the architecture *already* gets right and this design keeps:

- `release_is_referenced` (`deploy.sh:1168-1192`) checks `BACKEND_CURRENT`,
  `STOREFRONT_CURRENT` and their candidates **independently**, so pointers may
  legitimately reference different releases.
- The storefront builds from an immutable catalog snapshot
  (`MEDUSA_BUILD_SNAPSHOT_FILE`), so it no longer needs a live backend.

## Goal

A commit whose `backend/` tree is unchanged reuses the previously built backend
byte-for-byte instead of rebuilding it, cutting a storefront-only deploy from
~8–17 min to ~3–5 min — **without changing the release contract**. Every release
still contains a complete, self-validating backend.

## Non-goals

- **Not changing `validate_release`, `RELEASE_ID` or the artifact digest.** The
  release contract is unchanged; a cached backend must produce a release
  indistinguishable from a rebuilt one.
- **Not skipping migrations when `backend/` changed.** Unchanged backend tree
  means no new migrations by definition; this adds no new judgement.
- **Not touching the gate, the Caddyfile, or the basic-auth question.** That is
  the separate merge blocker recorded in
  `docs/plans/2026-07-29-security-reliability-remediation.md` and is a launch
  decision, not deploy tuning.
- **Not weakening the build boundary.** The unprivileged build user must never
  gain write access to a cached artifact that later becomes production code.
- No auto-deploy on push. This changes how long a deploy takes, not who
  triggers it.
- No CDN or Cloudflare in front of the site. There is no cache to purge; Caddy
  serves the files directly.

## Design

### 1. Key the cache on the git tree, not on a diff

`git rev-parse "${FULL_SHA}:backend"` yields the backend subtree hash directly.
Two commits with the same backend tree produce the same build, and the
comparison needs no diff parsing and no knowledge of the deployed SHA:

```bash
BACKEND_TREE_HASH="$(git -C "${REPO_DIR}" rev-parse "${FULL_SHA}:backend")"
BACKEND_CACHE_KEY="$(printf '%s\n' \
    "${BACKEND_TREE_HASH}" "${BUILD_NODE_VERSION}" "${BUILD_NPM_VERSION}" \
    "${BUILD_PLATFORM}" "${BUILD_LIBC_VERSION}" \
  | sha256sum | cut -d' ' -f1)"
```

The toolchain versions are in the key because the same source under a different
Node produces a different `node_modules`. These values are already computed for
`compute_build_identity` (`deploy.sh:502-505`), so nothing new is introduced.

Cache lives at `${APP_DIR}/backend-cache/<key>/`, root-owned, mode 0555, with a
`.complete` marker holding the key.

### 2. Root populates and consumes the cache — the build user never touches it

This is the security-sensitive part. The cached backend becomes production code,
so the unprivileged build user must not be able to write it or read it into an
artifact it controls. Therefore:

- **On a cache miss**, the backend builds exactly as today, as `BUILD_USER`, in
  the build workspace. After `deploy_promote_release_tree` has moved the tree to
  root ownership in `ROOT_STAGING`, **root** copies
  `ROOT_STAGING/backend` into the cache and seals it (`chown -R root:root`,
  `chmod -R a-w`, write `.complete` last). Populating from the *promoted* tree,
  not the build workspace, means only root-validated bytes ever enter the cache.
- **On a cache hit**, the backend build, the release `npm ci --omit=dev` and the
  workspace backend copy are all skipped. **Root** copies the cache into
  `ROOT_STAGING/backend` after promotion of the storefront-only artifact. The
  build user's artifact never contains a backend at all, so it cannot influence
  one.

`ARTIFACT_DIGEST` is computed after this copy, as it is today, so the digest and
`validate_release` cover the cached backend exactly as they cover a rebuilt one.

### 3. Fall back to a full build whenever the cache is not trustworthy

Reuse is an optimisation, never a guess. Rebuild when any of these hold:

- `.complete` is missing, unreadable, or does not match the key.
- Any path under the cache entry is not root-owned or is group/other-writable.
- `git rev-parse` fails or returns a non-hash.
- `PEPTIDES_DEPLOY_NO_CACHE=1` is set, or `--no-backend-cache` is passed — the
  documented escape hatch.

A rejected cache entry is logged and rebuilt, never silently repaired.

### 4. Prune the cache alongside releases

`prune_old_releases` keeps `KEEP_RELEASES=5`. Add `prune_backend_cache` on the
same principle: keep the entry referenced by `BACKEND_CURRENT`'s release plus
the 3 most recent, remove the rest, with the same
`[[ "$(stat -c '%U:%G' …)" == "root:root" ]]` refusal already used at
`deploy.sh:1213`.

### 5. Cut registry pressure on the installs that still run

Add `--prefer-offline` to the three installs (`deploy.sh:686`, `:712`, `:717`).
npm then serves from the local cache and contacts the registry only for genuinely
missing packages. This shortens warm installs and directly reduces the request
burst behind the documented `E429` failures — `registry.npmjs.org` sits behind
Cloudflare, which rate-limits the Hetzner IP by volume. It complements the
`maxsockets 2` and retry settings `provision.sh` already sets rather than
replacing them.

`--prefer-offline` is not `--offline`: a genuinely new dependency is still
fetched, so a lockfile change cannot silently install stale packages.

## Expected result

| Change class | Now | After |
| ---- | ---- | ---- |
| storefront-only | 8–17 min | **3–5 min** |
| docs-only | 8–17 min | 3–5 min (storefront still rebuilds; identical output is reused at `deploy.sh:785`) |
| backend change | 8–17 min | 8–17 min (unchanged, plus cache population) |

## Files changed

| File | Change |
| ---- | ---- |
| `deploy/deploy.sh` | Cache key, hit/miss branch around the backend build, root-side populate/consume, `prune_backend_cache`, `--no-backend-cache`, `--prefer-offline`, updated duration header |
| `deploy/lib/build-boundary.sh` | Helper asserting a cache entry is root-owned and non-writable before use |
| `deploy/tests/backend-cache.test.sh` | New — see Verification |
| `deploy/provision.sh` | Create `${APP_DIR}/backend-cache` with root:root 0755 |
| `docs/deploy.md` | "What a deploy reuses" section, revised durations, the escape hatch, and that a cache entry is never repaired in place |

## Verification

Static:

```bash
bash -n deploy/deploy.sh
bash deploy/tests/run.sh        # 14 files green before this change
```

New `deploy/tests/backend-cache.test.sh`, following the existing harness style,
asserting against fixtures rather than a live server:

- Same backend tree + same toolchain → same cache key; a one-byte change in
  `backend/` → different key.
- A cache entry whose `.complete` mismatches is rejected, not used.
- A cache entry containing a non-root-owned or group-writable path is rejected.
- A consumed cache produces a `ROOT_STAGING/backend` that passes the same
  ownership and mode assertions as a freshly built one.
- `PEPTIDES_DEPLOY_NO_CACHE=1` forces a rebuild even on a valid hit.

On the server, in order — noting that **this change takes effect one deploy
later**, so the deploy that ships it still runs the old script and takes the
full 8–17 min:

1. Deploy a backend-touching commit. Expect a full build and the cache
   populated; `ls /srv/peptides/backend-cache/` shows one sealed entry.
2. Deploy a storefront-only commit. Expect the cache hit logged, ~3–5 min, and
   `systemctl show -p ActiveEnterTimestamp medusa` **unchanged** — proof the
   backend was genuinely not rebuilt or restarted.
3. Confirm `validate_release` passed on that release and its `.artifact-digest`
   recomputes — the cached backend is inside the digest.
4. `PEPTIDES_DEPLOY_NO_CACHE=1` on the same commit. Expect a full rebuild
   producing the **same** `ARTIFACT_DIGEST`, which is the real proof that a
   cached backend is byte-identical to a rebuilt one.
5. Corrupt a cache entry deliberately (`touch` a file inside it) and redeploy.
   Expect rejection and a clean rebuild.

Rollback is `git revert` plus one full deploy, then `rm -rf` the cache
directory. Nothing here changes on-disk release layout or the database.

## Risk

The failure mode that matters is a stale or tampered cache becoming production
code while the deploy reports success. Three things contain it: the key includes
the full backend tree hash and toolchain, so staleness cannot go unnoticed; only
root writes and reads the cache, so the unprivileged build user cannot influence
it; and `ARTIFACT_DIGEST` plus `validate_release` cover the cached bytes exactly
as they cover rebuilt ones. Verification step 4 is the decisive check and should
be re-run whenever the Node version on the box changes.

**Merge blocker, resolved 2026-07-31:** this branch previously assumed a
basic-auth-gated site, conflicting with `origin/main`, which removed the gate on
2026-07-29. The gate has now been removed here too — `basic_auth`, the site-wide
`X-Robots-Tag`, the loopback gate probe, `SITE_GATED` and the authenticated
verification modes are gone, and the assertions are inverted so an accidental
**re-gating** fails a deploy. This spec does not depend on that work beyond
sharing `deploy.sh`.
