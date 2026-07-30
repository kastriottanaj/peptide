#!/usr/bin/env bash
#
# The single deploy path for peptideeinkaufen.de. Run on the server as root:
#
#   bash /srv/peptides/repo/deploy/deploy.sh <commit-sha>
#
# Per AGENTS.md: one scripted path, a specific locally verified commit SHA that
# is on origin/main, a server-side lock held for the whole run. Do not run git
# or systemctl against the app by hand alongside this.
#
# Builds into /srv/peptides/releases/<sha> and repoints the `current` symlink,
# so a failed build never touches the running release and a rollback is just
# this script with an older SHA.
#
# Expected durations (2-4 vCPU Hetzner box, warm npm cache). If output stalls
# well past these, inspect the lock and the service rather than waiting:
#
#   npm ci + medusa build ..... 4-9 min   (first run: up to 15)
#   release npm install ....... 1-3 min
#   database migrations ....... 5-30 s
#   Medusa healthy ............ 20-60 s
#   storefront build .......... 2-4 min
#   IndexNow ping ............. under 5 s (skips unless INDEXNOW_KEY is set)
#   total ..................... roughly 8-17 min

set -euo pipefail

APP_DIR=/srv/peptides
REPO_DIR="${APP_DIR}/repo"
ENV_FILE="${APP_DIR}/.env"
RELEASES_DIR="${APP_DIR}/releases"
CURRENT_LINK="${APP_DIR}/current"
WEB_ROOT="${APP_DIR}/storefront"
LOCK_FILE="${APP_DIR}/deploy.lock"
SERVICE_USER=medusa
KEEP_RELEASES=5

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[fail] %s\033[0m\n' "$*" >&2; exit 1; }

TARGET_SHA="${1:-}"
[[ -n "${TARGET_SHA}" ]] || die "Usage: deploy.sh <commit-sha>"
[[ -f "${ENV_FILE}" ]]   || die "Missing ${ENV_FILE} — run provision.sh first."
[[ "${EUID}" -eq 0 ]]    || die "Run as root (it manages systemd units and file ownership)."

# ---------------------------------------------------------------------------
# Lock. Held for the whole run; a second deploy aborts rather than interleaving.
# ---------------------------------------------------------------------------
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
	die "Another deploy holds ${LOCK_FILE}. Wait for it to finish, then re-run.
     Do not intervene on the server while it runs."
fi
printf 'pid=%s sha=%s started=%s\n' "$$" "${TARGET_SHA}" "$(date -Is)" >&9

# Load a KEY=VALUE file without letting the shell touch the values.
#
# `source` is wrong for these files. The gate's bcrypt hash looks like
# $2a$14$..., and bash expands $2 as a positional parameter — empty here, and
# under `set -u` it aborts the script outright. `read` performs no expansion, so
# the value arrives exactly as written. These files are consumed by systemd's
# EnvironmentFile, which also does no expansion; this keeps the deploy script on
# the same contract instead of quietly requiring a different one.
load_env_file() {
	local file="$1" key value
	[[ -f "${file}" ]] || return 0
	while IFS='=' read -r key value; do
		[[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
		export "${key}=${value}"
	done < <(grep -vE '^[[:space:]]*(#|$)' "${file}")
}

load_env_file "${ENV_FILE}"

: "${DATABASE_URL:?DATABASE_URL must be set in ${ENV_FILE}}"

SITE_DOMAIN="$(grep -E '^SITE_DOMAIN=' "${APP_DIR}/caddy.env" 2>/dev/null | cut -d= -f2- || true)"
: "${SITE_DOMAIN:=peptideeinkaufen.de}"

# ---------------------------------------------------------------------------
log "Resolving ${TARGET_SHA}"
# ---------------------------------------------------------------------------
cd "${REPO_DIR}"
git fetch --quiet origin main --tags

FULL_SHA="$(git rev-parse --verify "${TARGET_SHA}^{commit}" 2>/dev/null)" \
	|| die "${TARGET_SHA} is not a commit in this repository."

# Refuse anything that is not on origin/main — no feature branches, no stashes,
# no local-only commits.
if ! git merge-base --is-ancestor "${FULL_SHA}" origin/main; then
	die "${FULL_SHA} is not an ancestor of origin/main.
     Deploy only commits that are merged to main and verified locally."
fi

git checkout --quiet --force "${FULL_SHA}"
echo "Deploying ${FULL_SHA} ($(git log -1 --format=%s "${FULL_SHA}"))"

RELEASE_DIR="${RELEASES_DIR}/${FULL_SHA}"

# ---------------------------------------------------------------------------
log "Building Medusa  (expect 4-9 min)"
# ---------------------------------------------------------------------------
cd "${REPO_DIR}/backend"
npm ci --no-audit --no-fund

# NODE_ENV must not be production for the build: medusa-config.ts refuses to
# load a production config without the runtime secrets, and `medusa build` loads
# the config to generate types.
NODE_ENV=development npx turbo run build --filter=@dtc/backend

BUILD_OUTPUT="${REPO_DIR}/backend/apps/backend/.medusa/server"
[[ -d "${BUILD_OUTPUT}" ]] || die "medusa build produced no ${BUILD_OUTPUT}"

# ---------------------------------------------------------------------------
log "Assembling release  (expect 1-3 min)"
# ---------------------------------------------------------------------------
rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"
cp -a "${BUILD_OUTPUT}/." "${RELEASE_DIR}/"

# The build output is a self-contained app with its own package.json.
cd "${RELEASE_DIR}"
npm install --omit=dev --no-audit --no-fund

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${RELEASE_DIR}"

# ---------------------------------------------------------------------------
log "Running database migrations  (expect 5-30 s)"
# ---------------------------------------------------------------------------
# Against the new release, before it starts serving. Migrations are forward-only
# — see "Rollback" in docs/deploy.md before deploying across a schema change.
( cd "${RELEASE_DIR}" && NODE_ENV=production npx medusa db:migrate )

# ---------------------------------------------------------------------------
log "Switching to the new release"
# ---------------------------------------------------------------------------
PREVIOUS_SHA=""
if [[ -L "${CURRENT_LINK}" ]]; then
	PREVIOUS_SHA="$(basename "$(readlink -f "${CURRENT_LINK}")")"
fi

# ln -sfn onto a temp name then mv is atomic; `ln -sfn` directly on an existing
# symlink is not, and a request landing in the gap would find nothing.
ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}.tmp"
mv -Tf "${CURRENT_LINK}.tmp" "${CURRENT_LINK}"

# Reinstall the unit from the deployed commit. provision.sh also does this, but
# it runs once — without this a change to medusa.service would sit in the repo
# and never reach systemd, and the discrepancy only shows up as behaviour that
# does not match the file you are reading.
install -m 0644 "${REPO_DIR}/deploy/medusa.service" /etc/systemd/system/medusa.service
systemctl daemon-reload

# Clear any failed state from a previous crash loop, or `restart` refuses once
# the start limit has been hit.
systemctl reset-failed medusa 2>/dev/null || true
systemctl restart medusa

# ---------------------------------------------------------------------------
log "Waiting for Medusa  (expect 20-60 s)"
# ---------------------------------------------------------------------------
healthy=0
for _ in $(seq 1 60); do
	if curl -fsS --max-time 3 http://127.0.0.1:9000/health >/dev/null 2>&1; then
		healthy=1
		break
	fi
	sleep 3
done

if [[ "${healthy}" -ne 1 ]]; then
	journalctl -u medusa -n 60 --no-pager || true
	if [[ -n "${PREVIOUS_SHA}" && -d "${RELEASES_DIR}/${PREVIOUS_SHA}" ]]; then
		warn "Rolling the symlink back to ${PREVIOUS_SHA} and restarting."
		ln -sfn "${RELEASES_DIR}/${PREVIOUS_SHA}" "${CURRENT_LINK}.tmp"
		mv -Tf "${CURRENT_LINK}.tmp" "${CURRENT_LINK}"
		systemctl restart medusa
		die "Medusa did not become healthy. Rolled back to ${PREVIOUS_SHA}.
     NOTE: migrations already ran and are NOT undone."
	fi
	die "Medusa did not become healthy within 3 minutes."
fi
echo "Medusa healthy."

# ---------------------------------------------------------------------------
log "Building the storefront  (expect 2-4 min)"
# ---------------------------------------------------------------------------
# The Astro build calls Medusa in getStaticPaths, so it runs only once the
# backend is up. astro.config.mjs reads ./.env via process.loadEnvFile, so the
# build values go into a file rather than the environment.
#
# PUBLIC_ORDERS_ENABLED is derived from ORDERS_ENABLED rather than being its own
# variable: medusa.service reads ORDERS_ENABLED from this same env file at
# runtime, and two variables for one question would eventually disagree — a
# checkout the API refuses, or worse, the reverse.
# See docs/specs/2026-07-30-orders-closed.md.
if [[ -z "${PUBLIC_MEDUSA_PUBLISHABLE_KEY:-}" ]]; then
	warn "PUBLIC_MEDUSA_PUBLISHABLE_KEY is empty — skipping the storefront build."
	warn "This is expected on the FIRST deploy. Create an admin user and a"
	warn "publishable key, put it in ${ENV_FILE}, then re-run this script."
	warn "See 'First deploy' in docs/deploy.md."
else
	cat >"${REPO_DIR}/storefront/.env" <<-EOF
		PUBLIC_SITE_URL=${PUBLIC_SITE_URL}
		PUBLIC_MEDUSA_BACKEND_URL=${PUBLIC_MEDUSA_BACKEND_URL}
		PUBLIC_MEDUSA_PUBLISHABLE_KEY=${PUBLIC_MEDUSA_PUBLISHABLE_KEY}
		PUBLIC_BANK_ACCOUNT_HOLDER=${PUBLIC_BANK_ACCOUNT_HOLDER:-}
		PUBLIC_BANK_IBAN=${PUBLIC_BANK_IBAN:-}
		PUBLIC_BANK_BIC=${PUBLIC_BANK_BIC:-}
		PUBLIC_BANK_NAME=${PUBLIC_BANK_NAME:-}
		PUBLIC_GA_MEASUREMENT_ID=${PUBLIC_GA_MEASUREMENT_ID:-}
		PUBLIC_GOOGLE_SITE_VERIFICATION=${PUBLIC_GOOGLE_SITE_VERIFICATION:-}
		INDEXNOW_KEY=${INDEXNOW_KEY:-}
		PUBLIC_ORDERS_ENABLED=${ORDERS_ENABLED:-}
	EOF
	chmod 600 "${REPO_DIR}/storefront/.env"

	cd "${REPO_DIR}/storefront"
	npm ci --no-audit --no-fund
	npm run build

	[[ -f "${REPO_DIR}/storefront/dist/index.html" ]] \
		|| die "Storefront build produced no dist/index.html."

	mkdir -p "${WEB_ROOT}"
	rsync -a --delete "${REPO_DIR}/storefront/dist/" "${WEB_ROOT}/"
	chown -R "${SERVICE_USER}:${SERVICE_USER}" "${WEB_ROOT}"
	echo "Storefront published to ${WEB_ROOT}"
	STOREFRONT_BUILT=1
fi

# ---------------------------------------------------------------------------
log "Reloading Caddy"
# ---------------------------------------------------------------------------
# Validate the repo copy BEFORE installing it, or an invalid Caddyfile is
# already on disk when validation fails and the next restart takes the site
# down. The subshell loads caddy.env because the config is full of {$VAR}
# placeholders that only the caddy unit normally has in its environment —
# without them validation fails on a perfectly good file.
(
	load_env_file "${APP_DIR}/caddy.env"
	caddy validate --config "${REPO_DIR}/deploy/Caddyfile" --adapter caddyfile >/dev/null 2>&1
) || die "deploy/Caddyfile is invalid, or ${APP_DIR}/caddy.env is incomplete.
     Not installing it — the running config is untouched.
     Reproduce with: caddy validate --config ${REPO_DIR}/deploy/Caddyfile --adapter caddyfile"

install -m 0644 "${REPO_DIR}/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl reload-or-restart caddy

# ---------------------------------------------------------------------------
log "Pruning old releases (keeping ${KEEP_RELEASES})"
# ---------------------------------------------------------------------------
# shellcheck disable=SC2012
ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null | tail -n "+$((KEEP_RELEASES + 1))" | while read -r old; do
	[[ "$(readlink -f "${old}")" == "$(readlink -f "${CURRENT_LINK}")" ]] && continue
	echo "  removing $(basename "${old}")"
	rm -rf "${old}"
done

# ---------------------------------------------------------------------------
log "Verifying"
# ---------------------------------------------------------------------------
api_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
	"https://api.${SITE_DOMAIN}/health" || echo 000)"
site_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
	"https://${SITE_DOMAIN}/" || echo 000)"

# Fetch the BODY too, not just the status. A status alone proves little: a
# misconfigured error handler can return one status and serve entirely different
# content, which has shipped here before.
site_body="$(curl -s --max-time 10 "https://${SITE_DOMAIN}/" 2>/dev/null | head -c 4000 || true)"

echo "  https://api.${SITE_DOMAIN}/health  -> ${api_code}  (expect 200)"
echo "  https://${SITE_DOMAIN}/            -> ${site_code}  (expect 200, public since 2026-07-29)"

[[ "${api_code}" == "200" ]] \
	|| warn "API health check did not return 200. Check: journalctl -u medusa -n 100"

# The site is public by decision. A 401 now means someone reinstated basic auth
# without meaning to — the inverse of the check this replaced.
if [[ "${site_code}" == "401" ]]; then
	warn "The storefront answered 401 — something is asking for credentials."
	warn "The pre-launch gate was removed on 2026-07-29; check deploy/Caddyfile."
elif [[ "${site_code}" != "200" ]]; then
	warn "Storefront returned ${site_code}; expected 200."
elif ! grep -qiE '<!doctype|<html' <<<"${site_body}"; then
	warn "Storefront returned 200 but the body is not HTML. Check the root path and"
	warn "the handle_errors block in deploy/Caddyfile."
fi

# The legal pages carry their own noindex until the [Platzhalter] company data
# is replaced (docs/go-live-checklist.md §2). Losing that silently would put
# unreviewed legal text into the index, so it is checked on every deploy.
if ! grep -qi 'noindex' "${WEB_ROOT}/impressum/index.html" 2>/dev/null; then
	warn "/impressum no longer carries noindex. If its company data is still"
	warn "[Platzhalter], restore the draft prop before Google crawls it."
fi

# ---------------------------------------------------------------------------
log "Pinging IndexNow  (expect under 5 s)"
# ---------------------------------------------------------------------------
# Last, on purpose: the new files are published, Caddy has reloaded, and the URLs
# we are about to advertise already serve the new content. Pinging any earlier
# invites a crawl of the release being replaced.
#
# The script decides for itself whether to submit: it checks that
# https://<domain>/<key>.txt is publicly readable and that the built HTML actually
# changed, and skips cleanly otherwise. Never fatal — a search engine being
# unreachable is not a bad deploy. See docs/indexnow.md.
#
# Gated on STOREFRONT_BUILT rather than on dist/ existing: a deploy that skipped
# the storefront build leaves the PREVIOUS build in dist/, and diffing that would
# resubmit whatever it happens to contain.
if [[ -z "${INDEXNOW_KEY:-}" ]]; then
	echo "  INDEXNOW_KEY not set in ${ENV_FILE} — skipping (this is the off switch)."
elif [[ "${STOREFRONT_BUILT:-0}" != "1" ]]; then
	echo "  No storefront build in this deploy — skipping."
else
	(
		cd "${REPO_DIR}/storefront"
		node scripts/indexnow-submit.mjs --state "${APP_DIR}/indexnow-state.json"
	) || warn "IndexNow submission failed. The deploy itself is fine; the state file was
       not updated, so the next deploy retries these URLs."
fi

log "Deployed ${FULL_SHA}"
