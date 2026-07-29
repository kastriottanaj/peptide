#!/usr/bin/env bash

set -euo pipefail

TEST_DIR="$(builtin cd "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
DEPLOY_DIR="$(builtin cd "${TEST_DIR}/.." && builtin pwd -P)"
DEPLOY_SCRIPT="${DEPLOY_DIR}/deploy.sh"
BOOTSTRAP_SCRIPT="${DEPLOY_DIR}/bootstrap-backend.sh"
BOUNDARY_LIBRARY="${DEPLOY_DIR}/lib/build-boundary.sh"
PROVISION_SCRIPT="${DEPLOY_DIR}/provision.sh"

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

assert_contains() {
	local file="$1" pattern="$2" description="$3"
	grep -Eq -- "${pattern}" "${file}" || fail "${description}"
}

assert_fixed() {
	local file="$1" text="$2" description="$3"
	grep -Fq -- "${text}" "${file}" || fail "${description}"
}

assert_absent() {
	local file="$1" pattern="$2" description="$3"
	if grep -Eq -- "${pattern}" "${file}"; then
		fail "${description}"
	fi
}

assert_contains "${PROVISION_SCRIPT}" \
	'^BUILD_USER=peptides-build$' \
	'provisioning must define the dedicated build identity'
assert_contains "${PROVISION_SCRIPT}" \
	'useradd --system( --[a-z-]+)* --home-dir /nonexistent' \
	'build identity must have no usable home'
assert_fixed "${PROVISION_SCRIPT}" \
	'chown root:"${SERVICE_USER}" "${ENV_FILE}"' \
	'application environment must become root-owned'
assert_fixed "${PROVISION_SCRIPT}" \
	'chmod 0640 "${ENV_FILE}"' \
	'application environment must be read-only to the runtime group'

assert_fixed "${DEPLOY_SCRIPT}" 'run_as_build() {' \
	'deployment must centralize unprivileged build execution'
assert_contains "${BOUNDARY_LIBRARY}" '/usr/bin/env -i' \
	'builds must begin from an empty environment'
assert_fixed "${BOUNDARY_LIBRARY}" '/usr/bin/systemd-run \' \
	'builds must run in a transient systemd control group'
assert_fixed "${BOUNDARY_LIBRARY}" '--property="KillMode=control-group" \' \
	'build descendants must be killed with the transient control group'
assert_fixed "${BOUNDARY_LIBRARY}" '--property="ProtectSystem=strict" \' \
	'build processes must see the host filesystem read-only'
assert_fixed "${BOUNDARY_LIBRARY}" '--property="ReadWritePaths=${workspace}" \' \
	'build processes must write only their disposable workspace'
assert_fixed "${BOUNDARY_LIBRARY}" '"$@" </dev/null || status=$?' \
	'untrusted lifecycle scripts must never inherit the operator terminal'
assert_fixed "${BOUNDARY_LIBRARY}" \
	'--property="BindReadOnlyPaths=${DEPLOY_BUILD_RESOLVER_FILE}:/etc/resolv.conf" \' \
	'build DNS must not require access to the host loopback resolver'
assert_fixed "${BOUNDARY_LIBRARY}" \
	'network_properties+=("--property=IPAddressDeny=${network}")' \
	'build processes must deny local and private network ranges'
assert_fixed "${BOUNDARY_LIBRARY}" '127.0.0.0/8' \
	'build processes must not reach loopback services'
assert_fixed "${BOUNDARY_LIBRARY}" '169.254.0.0/16' \
	'build processes must not reach cloud metadata'
assert_fixed "${BOUNDARY_LIBRARY}" \
	'if deploy_build_user_has_processes "${build_user}"; then' \
	'promotion must refuse an active build identity'
assert_fixed "${DEPLOY_SCRIPT}" \
	'"${BACKEND_SOURCE}/package-lock.json"' \
	'production backend assembly must consume the committed lockfile'
assert_contains "${DEPLOY_SCRIPT}" \
	'/usr/bin/npm ci --omit=dev --no-audit --no-fund' \
	'production dependencies must use npm ci with dev dependencies omitted'
assert_fixed "${DEPLOY_SCRIPT}" \
	'cmp -s "${BACKEND_APP_SOURCE}/package.json"' \
	'generated and lock-backed backend manifests must be compared'
assert_fixed "${DEPLOY_SCRIPT}" \
	'deploy_promote_release_tree \' \
	'normal releases must cross the no-follow root promotion boundary'
assert_fixed "${BOOTSTRAP_SCRIPT}" \
	'deploy_promote_bootstrap_backend \' \
	'bootstrap releases must cross the same root promotion boundary'
assert_fixed "${BOUNDARY_LIBRARY}" \
	'/usr/bin/rsync --archive --safe-links --no-devices --no-specials \' \
	'promotion must not follow unsafe links or recreate special files'
assert_fixed "${BOUNDARY_LIBRARY}" \
	'/usr/bin/find -P "${root}" -type f -links +1 -print -quit' \
	'promotion must reject hard-linked regular files'
assert_fixed "${BOUNDARY_LIBRARY}" \
	'deploy_validate_csp_import "${source}/csp.caddy" enforce' \
	'Caddy imports must pass a narrow root-controlled grammar'

assert_absent "${DEPLOY_SCRIPT}" '(^|[[:space:]])npx([[:space:]]|$)' \
	'deployment must never invoke npx'
assert_absent "${DEPLOY_SCRIPT}" 'npm[[:space:]]+install' \
	'deployment must never perform an unlocked npm install'
assert_absent "${DEPLOY_SCRIPT}" \
	'chown -R.*(medusa|SERVICE_USER)' \
	'completed releases must not be owned by the runtime'
assert_absent "${DEPLOY_SCRIPT}" \
	'chown -R root:root "\\$\\{ARTIFACT\\}"|chmod -R.*"\\$\\{ARTIFACT\\}"' \
	'root must not recursively traverse the build-user artifact'
assert_absent "${BOOTSTRAP_SCRIPT}" \
	'chown -R root:root "\\$\\{ARTIFACT\\}"|chmod -R.*"\\$\\{ARTIFACT\\}"' \
	'bootstrap root must not recursively traverse the build-user artifact'
assert_absent "${DEPLOY_SCRIPT}" \
	'(source|\\.)[[:space:]]+[^[:space:]]*\\.env([[:space:]]|$)' \
	'environment files must never be sourced as shell'

# Regression fixture for the reproduced root-copy primitive: rsync's
# --safe-links preserves an internal package link but neither follows nor
# recreates a link escaping the source tree.
FIXTURE_ROOT="$(mktemp -d)"
trap 'rm -rf "${FIXTURE_ROOT}"' EXIT
mkdir -p "${FIXTURE_ROOT}/source/pkg" \
	"${FIXTURE_ROOT}/source/inside" \
	"${FIXTURE_ROOT}/destination" \
	"${FIXTURE_ROOT}/outside"
printf 'inside\n' >"${FIXTURE_ROOT}/source/inside/file"
ln -s ../inside/file "${FIXTURE_ROOT}/source/pkg/safe"
ln -s ../../../outside "${FIXTURE_ROOT}/source/pkg/escape"
/usr/bin/rsync --archive --safe-links --no-devices --no-specials \
	--no-owner --no-group \
	"${FIXTURE_ROOT}/source/" "${FIXTURE_ROOT}/destination/" \
	>/dev/null
[[ -L "${FIXTURE_ROOT}/destination/pkg/safe" ]] \
	|| fail "safe internal symlink was not preserved"
[[ ! -e "${FIXTURE_ROOT}/destination/pkg/escape" \
	&& ! -L "${FIXTURE_ROOT}/destination/pkg/escape" ]] \
	|| fail "escaping source symlink crossed the promotion boundary"
[[ ! -e "${FIXTURE_ROOT}/outside/proof" ]] \
	|| fail "promotion wrote through an escaping source symlink"

printf 'PASS: unprivileged immutable build contracts\n'
