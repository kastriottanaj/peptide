#!/usr/bin/env bash

set -euo pipefail

TEST_DIR="$(builtin cd "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
DEPLOY_DIR="$(builtin cd "${TEST_DIR}/.." && builtin pwd -P)"
DEPLOY_SCRIPT="${DEPLOY_DIR}/deploy.sh"
BOOTSTRAP_SCRIPT="${DEPLOY_DIR}/bootstrap-backend.sh"
PROVISION_SCRIPT="${DEPLOY_DIR}/provision.sh"

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

assert_fixed() {
	local file="$1" text="$2" description="$3"
	grep -Fq -- "${text}" "${file}" || fail "${description}"
}

assert_pattern() {
	local file="$1" pattern="$2" description="$3"
	grep -Eq -- "${pattern}" "${file}" || fail "${description}"
}

assert_absent() {
	local file="$1" pattern="$2" description="$3"
	if grep -Eq -- "${pattern}" "${file}"; then
		fail "${description}"
	fi
}

assert_fixed "${DEPLOY_SCRIPT}" \
	'--capture-snapshot "${WRITABLE_CATALOG_SNAPSHOT}"' \
	"normal deploy must compute an authoritative build identity"
assert_fixed "${DEPLOY_SCRIPT}" \
	'compute_build_identity --from-snapshot "${CATALOG_SNAPSHOT}"' \
	"normal deploy must detect catalog changes during a build"
assert_fixed "${DEPLOY_SCRIPT}" 'POST_BUILD_IDENTITY="$(' \
	"normal deploy must re-check the identity after the storefront build"
assert_fixed "${DEPLOY_SCRIPT}" 'chmod 0444 "${CATALOG_SNAPSHOT}"' \
	"the catalog snapshot the build consumed must become immutable"
assert_fixed "${DEPLOY_SCRIPT}" \
	'SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH}"' \
	"storefront output must be bound to the source commit timestamp"
assert_fixed "${DEPLOY_SCRIPT}" \
	'RELEASE_ID="${FULL_SHA}-${BUILD_IDENTITY}-${ARTIFACT_DIGEST}"' \
	"release names must bind source, public build data and generated output"
assert_fixed "${DEPLOY_SCRIPT}" \
	'printf '\''%s\n'\'' "${ARTIFACT_DIGEST}" >"${ROOT_STAGING}/.artifact-digest"' \
	"immutable releases must record their generated-artifact digest"
assert_fixed "${DEPLOY_SCRIPT}" \
	'OPS_PROTOCOL_VALUE=peptides-ops-v2' \
	"deployment must enforce the hardened operational protocol"
assert_fixed "${DEPLOY_SCRIPT}" \
	'CANDIDATE_SCRIPT_DIR="${OPS_RELEASE}/deploy"' \
	"target operational files must remain candidates during deployment"
assert_fixed "${DEPLOY_SCRIPT}" \
	'RUNNER_OPS_RELEASE="$(builtin cd -- "${SCRIPT_DIR}/.." && builtin pwd -P)"' \
	"the activated immutable runner must remain in control"
assert_absent "${DEPLOY_SCRIPT}" \
	'exec .*OPS_RELEASE.*/deploy/deploy\\.sh|PEPTIDES_DEPLOY_REEXEC_SHA' \
	"rollback targets must never execute their historical root runner"
assert_fixed "${DEPLOY_SCRIPT}" \
	'printf '\''%s\n'\'' "${BUILD_IDENTITY}" >"${ROOT_STAGING}/.identity"' \
	"immutable releases must record their complete build identity"
assert_fixed "${DEPLOY_SCRIPT}" \
	'[[ "${release_name}" =~ ^[0-9a-f]{40}-[0-9a-f]{64}-[0-9a-f]{64}$ ]]' \
	"release pruning must accept only canonical source-plus-identity names"
assert_fixed "${DEPLOY_SCRIPT}" \
	'external "${SITE_DOMAIN_VALUE}" "${ASSET_PATH}"' \
	"deploy must verify the public storefront from outside the box"
# The pre-launch gate was removed on 2026-07-29. Deploy must not reacquire a
# basic-auth credential by any route — neither a hash nor a plaintext password.
assert_absent "${DEPLOY_SCRIPT}" \
	'(GATE_PASSWORD|password)[[:space:]]*=' \
	"deploy must never obtain or store a gate password"
assert_absent "${DEPLOY_SCRIPT}" \
	'verify-release\.sh.*authenticated|authenticated-candidate' \
	"deploy must not perform authenticated gate verification"
assert_absent "${DEPLOY_SCRIPT}" \
	'PGDATABASE="\\$\\{DATABASE_URL\\}"' \
	"database credentials must never be placed in a child argument vector"
assert_absent "${BOOTSTRAP_SCRIPT}" \
	'PGDATABASE="\\$\\{DATABASE_URL\\}"' \
	"bootstrap database credentials must never enter a child argument vector"

assert_fixed "${PROVISION_SCRIPT}" '"${APP_DIR}/bootstrap"' \
	"provisioning must create a root-owned first-install artifact directory"
assert_fixed "${BOOTSTRAP_SCRIPT}" \
	'[[ -z "${PERSISTED_PUBLISHABLE_KEY}" ]]' \
	"bootstrap must refuse an already-configured installation"
assert_fixed "${BOOTSTRAP_SCRIPT}" \
	'First-install bootstrap refuses an existing runtime pointer' \
	"bootstrap must refuse existing runtime state"
assert_fixed "${BOOTSTRAP_SCRIPT}" \
	'The database is not pristine; use the explicit recovery path.' \
	"bootstrap must prove the database is pristine"
assert_fixed "${BOOTSTRAP_SCRIPT}" \
	'--no-psqlrc --no-password --tuples-only --no-align' \
	"bootstrap database checks must never prompt for credentials"
assert_fixed "${BOOTSTRAP_SCRIPT}" \
	'[[ "$(<"${OPS_ROOT}/.commit")" == "${FULL_SHA}" ]]' \
	"bootstrap must run from the reviewed target operational bundle"
assert_fixed "${BOOTSTRAP_SCRIPT}" \
	'/usr/bin/npm ci --omit=dev --no-audit --no-fund' \
	"bootstrap production dependencies must remain lock-backed"
assert_fixed "${BOOTSTRAP_SCRIPT}" \
	'query_single_publishable_key \' \
	"bootstrap must accept exactly one generated publishable key"
assert_fixed "${BOOTSTRAP_SCRIPT}" \
	'[[ "${PERSISTED_PUBLISHABLE_KEY}" == "${PUBLISHABLE_KEY}" ]]' \
	"bootstrap resume must bind a persisted key to the migrated database"
assert_absent "${BOOTSTRAP_SCRIPT}" \
	'mapfile|PUBLISHABLE_KEYS' \
	"bootstrap key validation must remain compatible with Bash 3.2"
assert_fixed "${BOOTSTRAP_SCRIPT}" \
	'mv -Tf "${ENV_STAGING}" "${ENV_FILE}"' \
	"bootstrap must replace the root environment atomically"
assert_absent "${BOOTSTRAP_SCRIPT}" \
	'printf.*PUBLISHABLE_KEY.*(stdout|/dev/stdout)' \
	"bootstrap must never print the generated publishable key"
assert_absent "${BOOTSTRAP_SCRIPT}" \
	'set_maintenance[[:space:]]+off|maintenance\\.off\\.caddy' \
	"bootstrap must leave the storefront fail-closed"

printf 'PASS: release identity and first-install bootstrap contracts\n'
