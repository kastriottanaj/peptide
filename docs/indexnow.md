# IndexNow

Runbook for IndexNow submission on `peptideeinkaufen.de`. Design decisions live in
[specs/2026-07-30-indexnow.md](specs/2026-07-30-indexnow.md).

IndexNow is a push protocol: instead of waiting to be crawled, the site tells the
participating engines which URLs were added, changed or deleted, and they
prioritise recrawling them. One POST to `api.indexnow.org` reaches all of them —
there is no per-engine call, no account and no API token.

Participants, per [indexnow.org](https://www.indexnow.org/): **Microsoft Bing,
Naver, Seznam.cz, Yandex, Yep.** Submitted URLs count against the site's normal
crawl quota; IndexNow changes what gets crawled first, not how much.

**Google does not participate.** Its discovery path stays Search Console plus the
sitemaps ([analytics.md](analytics.md)). IndexNow adds Bing (and therefore
ChatGPT's and Copilot's web results, which are Bing-backed), not Google.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| `INDEXNOW_KEY` | `storefront/.env`, `/srv/peptides/.env` | The key. Unset = feature off, everywhere. |
| Key file route | [`src/pages/[indexnowKey].txt.ts`](../storefront/src/pages/%5BindexnowKey%5D.txt.ts) | Emits `/<key>.txt` containing the key |
| Submitter | [`scripts/indexnow-submit.mjs`](../storefront/scripts/indexnow-submit.mjs) | Diffs the build, POSTs changed URLs |
| Deploy step | [`deploy/deploy.sh`](../deploy/deploy.sh) | Runs the submitter after publishing |
| State | `/srv/peptides/indexnow-state.json` | Hash per URL from the last submission |

## The key

Any string of 8–128 characters from `a-z A-Z 0-9 -` works, as long as it is
served at `https://peptideeinkaufen.de/<key>.txt` with the key as the entire body.
That file is the whole authentication model: whoever can put a file at the site
root controls the site. It is therefore **public by design and not a secret** — it
is committed to no file only because `.env` is where configuration belongs, not
because it needs protecting.

**The key in use was generated in Bing Webmaster Tools → IndexNow → Get Started**
(step 1 of its four-step flow: generate, host, submit, verify). Using the
portal's key means the portal and the site cannot disagree about it, and the
portal doubles as the submission-history view. Its exact value is in
`CREDENTIALS.local.md`.

Any self-hosted key is equally valid to the protocol, so a locally generated one
works too — but do not introduce a second one while the first is live, since the
served key file and the submitted key must match:

```bash
node -e "console.log(require('crypto').randomUUID().replace(/-/g,''))"
```

The protocol also allows hosting the key file somewhere other than the root and
naming it freely, as long as `keyLocation` points at it. We host it at the root
under its own name, which is the simpler contract and covers every URL on the
host.

Set it in `storefront/.env` for local work, and in `/srv/peptides/.env` for
production:

```dotenv
INDEXNOW_KEY=<key>
```

> **The key is baked into the build.** `deploy.sh` writes `INDEXNOW_KEY` into the
> build `.env`, so the key file appears on the site only after a deploy. Rotating
> the key means changing `/srv/peptides/.env` **and** deploying — otherwise the
> submitted key and the served key file disagree and every submission is
> rejected with 403. The submitter checks for exactly this and skips instead.

## How a deploy submits

`deploy.sh` runs the submitter as its **last** step, after `rsync` publishes the
build and Caddy has reloaded, so every URL it advertises already serves the new
content. Pinging earlier would invite a crawl of the release being replaced.

What the submitter does, in order:

1. Reads `dist/sitemap-*.xml` — the sitemaps are generated from
   `content-index.ts`, the single inventory of what the site publishes, so the
   submission cannot drift from what shipped and drafts stay excluded in one
   place.
2. Hashes each URL's built HTML and compares it with the state file. **Only pages
   whose bytes changed are submitted.** Not `<lastmod>`: the pages and category
   sitemaps carry build time there, so a lastmod diff would resubmit the whole
   site on every deploy — which the protocol explicitly asks you not to do.
3. Adds URLs that were submitted before, have left the sitemap, and have no file
   in `dist` any more. Submitting a dead URL is how you get the 404 seen and the
   entry dropped.
4. Checks `https://peptideeinkaufen.de/<key>.txt` returns 200 with the key.
5. POSTs `{ host, key, keyLocation, urlList }` in batches of 10,000.
6. Writes the state file — only if every batch was accepted, so a failure retries
   next deploy rather than marking URLs as done.

Every reason *not* to submit is a clean skip with exit 0: no key, a non-https
origin, an unreachable key file, nothing changed. A deploy must not fail because
a search engine is unreachable. Only a rejected submission exits non-zero, and
even then `deploy.sh` only warns.

## Manual submission

From `storefront/`, against a build in `dist/`:

```bash
npm run indexnow -- --dry-run     # print what would be submitted, submit nothing
npm run indexnow                  # submit changed URLs
npm run indexnow -- --all         # ignore the state; resubmit everything
```

`--all` is the launch-day command: the first submission should cover the whole
site. Other flags: `--state <file>`, `--dist <dir>`.

Locally this always skips, because `PUBLIC_SITE_URL` is `http://localhost:4321`
and a crawler cannot fetch localhost. To exercise the real path, run it on the
server after a deploy:

```bash
cd /srv/peptides/repo/storefront
node scripts/indexnow-submit.mjs --state /srv/peptides/indexnow-state.json --dry-run
```

## Status as of 2026-07-30

**Not enabled in production.** `INDEXNOW_KEY` is unset in `/srv/peptides/.env`, so
no key file is deployed and no deploy submits anything. Setting that one variable
and deploying is the entire activation step, followed by one `--all` run.

Whether to do that now is a decision, not a formality. The gate came off on
2026-07-29 with the hard blockers in
[go-live-checklist.md](go-live-checklist.md) still open, so the site is already
public and crawlable: **Bing will index it either way — IndexNow only decides
whether that takes minutes or weeks.** Pulling it forward while purity values are
fabricated and the legal pages render `[Platzhalter]` is a choice about how fast
that content spreads, and the four legal pages are the only ones carrying
`noindex` (from the `draft` prop, per page, independent of Caddy).

Because the site answers 200, the submitter's key-file preflight is a correctness
check here rather than a safety net. **The off switch is `INDEXNOW_KEY`.**

## Troubleshooting

The submitter prints its reason for every outcome. By HTTP status:

| Status | Meaning | Fix |
| --- | --- | --- |
| `200` | URLs submitted successfully | — |
| `202` | Accepted, key validation pending | Normal on a first submission |
| `400` | Bad request — invalid format | Bug in the script, not configuration |
| `403` | Key not valid: not found, or the file exists but does not contain the key | Deploy the current `INDEXNOW_KEY` so the served file matches what is submitted |
| `422` | URLs do not belong to the host, or the key does not match the protocol schema | `PUBLIC_SITE_URL` disagrees with the submitted host |
| `429` | Too many requests (potential spam) | Back off; the next deploy retries |

**"skipped: key file … returned 404".** The key file is not deployed. Set
`INDEXNOW_KEY` in `/srv/peptides/.env` and deploy.

**"skipped: … returned 401".** Something is asking for a password — the
pre-launch gate is back on ("Re-gating" in [deploy.md](deploy.md)). Nothing to
do: a crawler could not fetch the URLs either.

**"skipped: nothing changed since the last submission".** Working as intended —
the build is byte-identical to the last submitted one. Force with `--all`.

**"skipped: origin is http://localhost:4321, not https".** A local build. Nothing
to submit.

**Submissions accepted but nothing appears in Bing.** IndexNow buys crawl
priority, not indexing. A page that is `noindex`, thin, or duplicate still will
not be indexed — check Bing Webmaster Tools → URL Inspection for the verdict.

**Everything is resubmitted every deploy.** The state file is missing or
unwritable. On the server it must be `/srv/peptides/indexnow-state.json`; check
that `deploy.sh` passes `--state` and that the path is writable.
