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

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

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
	set -a
	# shellcheck disable=SC1091
	source "${APP_DIR}/caddy.env"
	set +a
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

echo "  https://api.${SITE_DOMAIN}/health  -> ${api_code}  (expect 200)"
echo "  https://${SITE_DOMAIN}/            -> ${site_code}  (expect 401 while gated)"

[[ "${api_code}" == "200" ]] \
	|| warn "API health check did not return 200. Check: journalctl -u medusa -n 100"

if [[ "${site_code}" == "200" ]]; then
	warn "The storefront answered 200 without credentials — THE GATE IS OFF."
	warn "If that was not intended, restore the basic_auth block in deploy/Caddyfile."
elif [[ "${site_code}" != "401" ]]; then
	warn "Storefront returned ${site_code}; expected 401 while gated."
fi

log "Deployed ${FULL_SHA}"
