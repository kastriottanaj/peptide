#!/usr/bin/env bash
#
# The single deploy path for peptideeinkaufen.de. Run on the server:
#
#   bash /srv/peptides/repo/deploy/deploy.sh <commit-sha>
#
# Per AGENTS.md: one scripted path, a specific locally verified commit SHA that
# is on origin/main, a server-side lock held for the whole run. Do not drive
# docker compose by hand alongside this.
#
# Expected durations (4 vCPU / 8 GB Hetzner box, warm caches). If output stalls
# well past these, inspect the lock and the running containers rather than
# waiting:
#
#   image build .............. 3-6 min   (first run: up to 12)
#   database migrations ...... 5-30 s
#   Medusa healthy ........... 30-90 s
#   storefront build ......... 2-4 min
#   total .................... roughly 6-11 min

set -euo pipefail

APP_DIR=/srv/peptides
REPO_DIR="${APP_DIR}/repo"
ENV_FILE="${APP_DIR}/.env"
WEB_ROOT="${APP_DIR}/storefront"
LOCK_FILE="${APP_DIR}/deploy.lock"
COMPOSE_FILE="${REPO_DIR}/deploy/docker-compose.yml"

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[fail] %s\033[0m\n' "$*" >&2; exit 1; }

TARGET_SHA="${1:-}"
[[ -n "${TARGET_SHA}" ]] || die "Usage: deploy.sh <commit-sha>"
[[ -f "${ENV_FILE}" ]]   || die "Missing ${ENV_FILE} — copy deploy/.env.template and fill it in."

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

: "${SITE_DOMAIN:?SITE_DOMAIN must be set in ${ENV_FILE}}"

compose() {
	docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

# ---------------------------------------------------------------------------
log "Resolving ${TARGET_SHA}"
# ---------------------------------------------------------------------------
cd "${REPO_DIR}"
git fetch --quiet origin main --tags

FULL_SHA="$(git rev-parse --verify "${TARGET_SHA}^{commit}")" \
	|| die "${TARGET_SHA} is not a commit in this repository."

# Refuse anything that is not on origin/main — no feature branches, no stashes,
# no local-only commits.
if ! git merge-base --is-ancestor "${FULL_SHA}" origin/main; then
	die "${FULL_SHA} is not an ancestor of origin/main.
     Deploy only commits that are merged to main and verified locally."
fi

git checkout --quiet --force "${FULL_SHA}"
export DEPLOY_SHA="${FULL_SHA:0:12}"
echo "Deploying ${FULL_SHA} ($(git log -1 --format=%s "${FULL_SHA}"))"

# ---------------------------------------------------------------------------
log "Building the Medusa image  (expect 3-6 min)"
# ---------------------------------------------------------------------------
compose build medusa

# ---------------------------------------------------------------------------
log "Starting Postgres and Redis"
# ---------------------------------------------------------------------------
# --wait blocks until both report healthy. Without it `up -d` returns as soon as
# the containers are *started*, and the migration below races an unready
# Postgres.
compose up -d --wait --wait-timeout 180 postgres redis \
	|| { compose logs --tail 40 postgres redis; die "Postgres/Redis did not become healthy."; }

# ---------------------------------------------------------------------------
log "Running database migrations  (expect 5-30 s)"
# ---------------------------------------------------------------------------
compose run --rm --no-deps medusa npx medusa db:migrate

# ---------------------------------------------------------------------------
log "Starting Medusa  (expect 30-90 s to healthy)"
# ---------------------------------------------------------------------------
compose up -d --wait --wait-timeout 300 medusa \
	|| { compose logs --tail 60 medusa; die "Medusa did not become healthy within 5 minutes."; }
echo "Medusa healthy."

# ---------------------------------------------------------------------------
log "Building the storefront  (expect 2-4 min)"
# ---------------------------------------------------------------------------
# The Astro build calls Medusa in getStaticPaths, so it runs only once the
# backend is up. astro.config.mjs reads ./.env via process.loadEnvFile, so the
# build values are written to a file rather than passed as -e flags.
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

	docker run --rm \
		-v "${REPO_DIR}/storefront:/build" \
		-w /build \
		node:22-bookworm-slim \
		sh -c "npm ci --no-audit --no-fund && npm run build"

	[[ -f "${REPO_DIR}/storefront/dist/index.html" ]] \
		|| die "Storefront build produced no dist/index.html."

	# Publish atomically enough that a request mid-deploy never sees a half-
	# written tree: build into place with --delete so removed pages disappear.
	mkdir -p "${WEB_ROOT}"
	rsync -a --delete "${REPO_DIR}/storefront/dist/" "${WEB_ROOT}/"
	echo "Storefront published to ${WEB_ROOT}"
fi

# ---------------------------------------------------------------------------
log "Starting Caddy"
# ---------------------------------------------------------------------------
compose up -d caddy
compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null \
	|| warn "Caddy reload returned non-zero (fine on a cold start — it was just created)."

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
	|| warn "API health check did not return 200. Check: compose logs medusa"

if [[ "${site_code}" == "200" ]]; then
	warn "The storefront answered 200 without credentials — THE GATE IS OFF."
	warn "If that was not intended, restore the basic_auth block in deploy/Caddyfile."
elif [[ "${site_code}" != "401" ]]; then
	warn "Storefront returned ${site_code}; expected 401 while gated."
fi

log "Deployed ${FULL_SHA}"
