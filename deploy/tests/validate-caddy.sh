#!/usr/bin/env bash
#
# Validate the production Caddyfile with isolated, non-secret fixture values.
# An optional first argument may point at an adapted Caddyfile, which lets the
# behavioral test validate its localhost-only version through the same path.

set -euo pipefail
umask 077

TEST_DIR="$(builtin cd "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
DEPLOY_DIR="$(builtin cd "${TEST_DIR}/.." && builtin pwd -P)"
FIXTURE_DIR="${TEST_DIR}/fixtures/caddy"
CONFIG_PATH="${1:-${DEPLOY_DIR}/Caddyfile}"
CADDY_BIN="${CADDY_BIN:-$(command -v caddy || true)}"
VALIDATE_TMP="$(mktemp -d "${TMPDIR:-/tmp}/peptides-caddy-validate.XXXXXX")"
readonly TEST_DIR DEPLOY_DIR FIXTURE_DIR CONFIG_PATH CADDY_BIN VALIDATE_TMP

cleanup() {
	rm -rf "${VALIDATE_TMP}"
}
trap cleanup EXIT HUP INT TERM

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

[[ -n "${CADDY_BIN}" && -x "${CADDY_BIN}" ]] \
	|| fail 'caddy is required to validate deploy/Caddyfile'
[[ -f "${CONFIG_PATH}" ]] || fail "Caddyfile not found: ${CONFIG_PATH}"
[[ -d "${FIXTURE_DIR}/storefront" ]] \
	|| fail 'storefront Caddy fixture is missing'
[[ -d "${FIXTURE_DIR}/candidate" ]] \
	|| fail 'candidate Caddy fixture is missing'

mkdir -p \
	"${VALIDATE_TMP}/home" \
	"${VALIDATE_TMP}/config" \
	"${VALIDATE_TMP}/data"

if ! /usr/bin/env -i \
	PATH='/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin' \
	HOME="${VALIDATE_TMP}/home" \
	XDG_CONFIG_HOME="${VALIDATE_TMP}/config" \
	XDG_DATA_HOME="${VALIDATE_TMP}/data" \
	TMPDIR="${VALIDATE_TMP}" \
	ACME_EMAIL='fixture@example.invalid' \
	SITE_DOMAIN='fixture.invalid' \
	STOREFRONT_ROOT="${FIXTURE_DIR}/storefront" \
	CANDIDATE_STOREFRONT_ROOT="${FIXTURE_DIR}/candidate" \
	MAINTENANCE_CONFIG="${MAINTENANCE_CONFIG:-${DEPLOY_DIR}/maintenance.off.caddy}" \
	CSP_CONFIG="${DEPLOY_DIR}/csp.bootstrap.caddy" \
	"${CADDY_BIN}" validate \
		--config "${CONFIG_PATH}" \
		--adapter caddyfile \
		>"${VALIDATE_TMP}/validate.log" 2>&1; then
	sed -n '1,160p' "${VALIDATE_TMP}/validate.log" >&2
	fail 'Caddy configuration did not validate'
fi

printf 'PASS: Caddy configuration validates with isolated fixture values\n'
