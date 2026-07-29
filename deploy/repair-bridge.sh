#!/usr/bin/bash
#
# Build the temporary repair runtime from an exact, fetched origin/main commit.
#
# This helper deliberately does not activate anything. provision.sh owns the
# service and Caddy transitions around the two phases:
#
#   repair-bridge.sh backend <legacy-sha>
#   repair-bridge.sh complete <legacy-sha>
#
# The backend phase creates a root-owned backend seed. provision.sh can start
# that seed behind maintenance so the complete phase can fetch the catalog and
# build the matching static storefront. No byte from the formerly
# Medusa-writable legacy release or web root enters either artifact.

set -euo pipefail

SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
[[ "${SCRIPT_DIR}" != "${BASH_SOURCE[0]}" ]] || SCRIPT_DIR='.'
SCRIPT_DIR="$(builtin cd -- "${SCRIPT_DIR}" && builtin pwd -P)"
# shellcheck source=lib/env-file.sh
builtin source "${SCRIPT_DIR}/lib/env-file.sh"
# shellcheck source=lib/build-boundary.sh
builtin source "${SCRIPT_DIR}/lib/build-boundary.sh"
deploy_sanitize_environment

APP_DIR=/srv/peptides
REPO_DIR="${APP_DIR}/repo"
BUILD_DIR="${APP_DIR}/build"
BRIDGE_ROOT="${APP_DIR}/repair-bridge"
ENV_FILE="${APP_DIR}/.env"
PROVISION_RECOVERY="${APP_DIR}/provision-recovery-required"
BUILD_USER=peptides-build

BUILD_WORKSPACE=""
ROOT_STAGING=""

die() {
	printf '[repair-bridge] %s\n' "$*" >&2
	exit 1
}

cleanup_repair_bridge() {
	local status="$?"
	trap - EXIT
	set +e
	deploy_stop_transient_build
	if [[ -n "${BUILD_WORKSPACE}" ]]; then
		case "${BUILD_WORKSPACE}" in
			"${BUILD_DIR}/repair-"*)
				rm -rf -- "${BUILD_WORKSPACE}"
				;;
		esac
	fi
	if [[ -n "${ROOT_STAGING}" ]]; then
		case "${ROOT_STAGING}" in
			"${BRIDGE_ROOT}/.promote-"*)
				rm -rf -- "${ROOT_STAGING}"
				;;
		esac
	fi
	exit "${status}"
}
trap cleanup_repair_bridge EXIT

atomic_symlink() {
	local target="$1" link="$2"

	ln -sfn "${target}" "${link}.new"
	mv -Tf "${link}.new" "${link}"
	sync -f "$(dirname "${link}")"
}

run_as_build() {
	local working_directory="$1"
	shift

	deploy_run_contained_build \
		"${BUILD_USER}" "${BUILD_WORKSPACE}" "${working_directory}" "$@"
}

validate_backend_seed() {
	local seed="$1" sha="$2"

	[[ -d "${seed}" && ! -L "${seed}" \
		&& -f "${seed}/.complete" && ! -L "${seed}/.complete" \
		&& "$(<"${seed}/.complete")" == "${sha}" \
		&& -f "${seed}/backend/package-lock.json" \
		&& -f "${seed}/backend/node_modules/@medusajs/cli/cli.js" \
		&& -L "${seed}/backend/apps/backend/.medusa/server/static" \
		&& "$(readlink \
			"${seed}/backend/apps/backend/.medusa/server/static")" == \
			"/var/lib/peptides/static" ]] || return 1
	[[ "$(stat -c '%U:%G' "${seed}")" == "root:root" ]] || return 1
	deploy_validate_promoted_tree \
		"${seed}" \
		"${seed}/backend/apps/backend/.medusa/server/static"
}

validate_complete_bridge() {
	local bridge="$1" sha="$2"

	[[ -d "${bridge}" && ! -L "${bridge}" \
		&& -f "${bridge}/.commit" && ! -L "${bridge}/.commit" \
		&& "$(<"${bridge}/.commit")" == "${sha}" \
		&& -f "${bridge}/.complete" && ! -L "${bridge}/.complete" \
		&& "$(<"${bridge}/.complete")" == \
			"repair-bridge-v1 sha=${sha} source=origin/main" \
		&& -f "${bridge}/storefront/index.html" \
		&& -f "${bridge}/csp.caddy" \
		&& -f "${bridge}/csp-report-only.caddy" \
		&& -L "${bridge}/backend/apps/backend/.medusa/server/static" \
		&& "$(readlink \
			"${bridge}/backend/apps/backend/.medusa/server/static")" == \
			"/var/lib/peptides/static" ]] || return 1
	[[ "$(stat -c '%U:%G' "${bridge}")" == "root:root" ]] || return 1
	deploy_validate_csp_import "${bridge}/csp.caddy" enforce || return 1
	deploy_validate_csp_import \
		"${bridge}/csp-report-only.caddy" report-only || return 1
	deploy_validate_promoted_tree \
		"${bridge}" \
		"${bridge}/backend/apps/backend/.medusa/server/static"
}

allocate_workspace() {
	BUILD_WORKSPACE="$(
		mktemp -d "${BUILD_DIR}/repair-${LEGACY_SHA}.XXXXXX"
	)"
	chown "${BUILD_USER}:${BUILD_USER}" "${BUILD_WORKSPACE}"
	install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 \
		"${BUILD_WORKSPACE}/home" \
		"${BUILD_WORKSPACE}/cache" \
		"${BUILD_WORKSPACE}/tmp" \
		"${BUILD_WORKSPACE}/npm-cache" \
		"${BUILD_WORKSPACE}/source" \
		"${BUILD_WORKSPACE}/artifact"
}

extract_source() {
	/usr/bin/env -i \
		PATH="${DEPLOY_TRUSTED_PATH}" \
		/usr/bin/git -C "${REPO_DIR}" -c core.hooksPath=/dev/null \
			archive --format=tar "${LEGACY_SHA}" \
		| run_as_build "${BUILD_WORKSPACE}/source" \
			/usr/bin/tar --extract --file=- \
				--no-same-owner --no-same-permissions
}

write_storefront_env() {
	local destination="$1"

	{
		printf 'PUBLIC_SITE_URL=%s\n' "${PUBLIC_SITE_URL}"
		printf 'PUBLIC_MEDUSA_BACKEND_URL=%s\n' \
			"${PUBLIC_MEDUSA_BACKEND_URL}"
		printf 'PUBLIC_MEDUSA_PUBLISHABLE_KEY=%s\n' \
			"${PUBLIC_MEDUSA_PUBLISHABLE_KEY}"
		printf 'PUBLIC_BANK_ACCOUNT_HOLDER=%s\n' \
			"${PUBLIC_BANK_ACCOUNT_HOLDER:-}"
		printf 'PUBLIC_BANK_IBAN=%s\n' "${PUBLIC_BANK_IBAN:-}"
		printf 'PUBLIC_BANK_BIC=%s\n' "${PUBLIC_BANK_BIC:-}"
		printf 'PUBLIC_BANK_NAME=%s\n' "${PUBLIC_BANK_NAME:-}"
		printf 'PUBLIC_GA_MEASUREMENT_ID=%s\n' \
			"${PUBLIC_GA_MEASUREMENT_ID:-}"
		printf 'PUBLIC_GOOGLE_SITE_VERIFICATION=%s\n' \
			"${PUBLIC_GOOGLE_SITE_VERIFICATION:-}"
	} | run_as_build "$(dirname "${destination}")" \
		/usr/bin/dd "of=${destination}" \
			iflag=fullblock oflag=excl,nofollow status=none
	run_as_build "$(dirname "${destination}")" \
		/usr/bin/chmod 0600 "${destination}"
}

build_backend_seed() {
	local backend_source backend_app_source build_output artifact seed

	seed="${BRIDGE_ROOT}/${LEGACY_SHA}-backend-seed"
	if [[ -e "${seed}" || -L "${seed}" ]]; then
		validate_backend_seed "${seed}" "${LEGACY_SHA}" \
			|| die "Existing repair backend seed is malformed."
		printf '%s\n' "${seed}"
		return 0
	fi

	allocate_workspace
	extract_source
	backend_source="${BUILD_WORKSPACE}/source/backend"
	backend_app_source="${backend_source}/apps/backend"
	artifact="${BUILD_WORKSPACE}/artifact"
	install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 \
		"${artifact}/backend/apps/backend/.medusa"

	run_as_build "${backend_source}" \
		/usr/bin/npm ci --no-audit --no-fund
	run_as_build "${backend_source}" \
		/usr/bin/env NODE_ENV=development \
		"${backend_source}/node_modules/.bin/turbo" \
		run build --filter=@dtc/backend

	build_output="${backend_app_source}/.medusa/server"
	[[ -d "${build_output}" && ! -L "${build_output}" ]] \
		|| die "Origin-backed Medusa build produced no generated server."
	cmp -s "${backend_app_source}/package.json" \
		"${build_output}/package.json" \
		|| die "Generated Medusa manifest diverges from the locked workspace."

	run_as_build "${artifact}" /usr/bin/cp \
		"${backend_source}/package.json" \
		"${backend_source}/package-lock.json" \
		"${artifact}/backend/"
	run_as_build "${artifact}" /usr/bin/cp \
		"${backend_app_source}/package.json" \
		"${artifact}/backend/apps/backend/package.json"
	run_as_build "${artifact}" /usr/bin/cp -a "${build_output}" \
		"${artifact}/backend/apps/backend/.medusa/server"
	[[ ! -e "${artifact}/backend/apps/backend/.medusa/server/static" \
		&& ! -L "${artifact}/backend/apps/backend/.medusa/server/static" ]] \
		|| die "Generated Medusa server unexpectedly contains static state."
	run_as_build "${artifact}/backend" \
		/usr/bin/npm ci --omit=dev --no-audit --no-fund
	deploy_build_user_has_processes "${BUILD_USER}" \
		&& die "The contained backend build retained a process."

	ROOT_STAGING="$(
		mktemp -d "${BRIDGE_ROOT}/.promote-${LEGACY_SHA}.XXXXXX"
	)"
	chown root:root "${ROOT_STAGING}"
	chmod 0700 "${ROOT_STAGING}"
	deploy_promote_bootstrap_backend \
		"${artifact}" "${ROOT_STAGING}" "${LEGACY_SHA}" \
		|| die "Could not promote the origin-backed repair backend."
	validate_backend_seed "${ROOT_STAGING}" "${LEGACY_SHA}" \
		|| die "Promoted repair backend failed validation."
	mv "${ROOT_STAGING}" "${seed}"
	sync -f "${BRIDGE_ROOT}"
	ROOT_STAGING=""
	validate_backend_seed "${seed}" "${LEGACY_SHA}" \
		|| die "Committed repair backend failed validation."
	printf '%s\n' "${seed}"
}

build_complete_bridge() {
	local seed bridge storefront_source artifact

	seed="${BRIDGE_ROOT}/${LEGACY_SHA}-backend-seed"
	bridge="${BRIDGE_ROOT}/${LEGACY_SHA}"
	validate_backend_seed "${seed}" "${LEGACY_SHA}" \
		|| die "The origin-backed repair backend seed is missing."

	if [[ -e "${bridge}" || -L "${bridge}" ]]; then
		validate_complete_bridge "${bridge}" "${LEGACY_SHA}" \
			|| die "Existing complete repair bridge is malformed."
		printf '%s\n' "${bridge}"
		return 0
	fi

	[[ "$(curl --disable --silent --show-error \
		--noproxy '*' --max-time 3 \
		http://127.0.0.1:9000/health 2>/dev/null || true)" == "OK" ]] \
		|| die "The origin-backed repair backend is not healthy."
	deploy_load_app_env_file "${ENV_FILE}"
	: "${PUBLIC_SITE_URL:?PUBLIC_SITE_URL is required for repair.}"
	: "${PUBLIC_MEDUSA_BACKEND_URL:?PUBLIC_MEDUSA_BACKEND_URL is required for repair.}"
	: "${PUBLIC_MEDUSA_PUBLISHABLE_KEY:?The publishable key is required for repair.}"

	allocate_workspace
	extract_source
	storefront_source="${BUILD_WORKSPACE}/source/storefront"
	artifact="${BUILD_WORKSPACE}/artifact"
	install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 \
		"${artifact}/backend" \
		"${artifact}/storefront"

	run_as_build "${artifact}/backend" \
		/usr/bin/rsync --archive --safe-links \
			--no-devices --no-specials \
			--exclude=/apps/backend/.medusa/server/static \
			"${seed}/backend/" "${artifact}/backend/"
	write_storefront_env "${storefront_source}/.env"
	run_as_build "${storefront_source}" \
		/usr/bin/npm ci --no-audit --no-fund
	run_as_build "${storefront_source}" \
		/usr/bin/env SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH}" \
		/usr/bin/npm run build
	[[ -f "${storefront_source}/dist/index.html" ]] \
		|| die "Origin-backed storefront build produced no index."
	run_as_build "${artifact}/storefront" \
		/usr/bin/cp -a "${storefront_source}/dist/." \
			"${artifact}/storefront/"
	run_as_build "${BUILD_WORKSPACE}" \
		/usr/bin/node "${SCRIPT_DIR}/build-csp.mjs" \
		"${artifact}/storefront" "${artifact}/csp.caddy"
	run_as_build "${BUILD_WORKSPACE}" \
		/usr/bin/node "${SCRIPT_DIR}/build-csp.mjs" \
		--report-only \
		"${artifact}/storefront" \
		"${artifact}/csp-report-only.caddy"
	deploy_build_user_has_processes "${BUILD_USER}" \
		&& die "The contained storefront build retained a process."

	ROOT_STAGING="$(
		mktemp -d "${BRIDGE_ROOT}/.promote-${LEGACY_SHA}.XXXXXX"
	)"
	chown root:root "${ROOT_STAGING}"
	chmod 0700 "${ROOT_STAGING}"
	deploy_promote_release_tree \
		"${artifact}" "${ROOT_STAGING}" "${LEGACY_SHA}" \
		|| die "Could not promote the complete origin-backed repair bridge."
	printf 'repair-bridge-v1 sha=%s source=origin/main\n' \
		"${LEGACY_SHA}" >"${ROOT_STAGING}/.complete"
	chown root:root "${ROOT_STAGING}/.complete"
	chmod 0444 "${ROOT_STAGING}/.complete"
	validate_complete_bridge "${ROOT_STAGING}" "${LEGACY_SHA}" \
		|| die "Promoted complete repair bridge failed validation."
	mv "${ROOT_STAGING}" "${bridge}"
	sync -f "${BRIDGE_ROOT}"
	ROOT_STAGING=""
	validate_complete_bridge "${bridge}" "${LEGACY_SHA}" \
		|| die "Committed complete repair bridge failed validation."
	printf '%s\n' "${bridge}"
}

[[ "${EUID}" -eq 0 ]] || die "Run as root."
[[ "$#" -eq 2 ]] || die "Usage: repair-bridge.sh backend|complete <legacy-sha>"
PHASE="$1"
LEGACY_SHA="$2"
[[ "${PHASE}" == "backend" || "${PHASE}" == "complete" ]] \
	|| die "Usage: repair-bridge.sh backend|complete <legacy-sha>"
[[ "${LEGACY_SHA}" =~ ^[0-9a-f]{40}$ ]] \
	|| die "The legacy release name must be a full lowercase commit SHA."

[[ "${PEPTIDES_PROVISION_LOCK_FD:-}" == "9" ]] \
	|| die "Run only from the locked repair-existing provision path."
if ! : >&9 2>/dev/null || ! flock -n 9; then
	die "The inherited provisioning lock is unavailable."
fi
unset PEPTIDES_PROVISION_LOCK_FD

OPS_RELEASE="$(builtin cd -- "${SCRIPT_DIR}/.." && builtin pwd -P)"
TARGET_SHA="$(basename "${OPS_RELEASE}")"
[[ "$(dirname "${OPS_RELEASE}")" == "${APP_DIR}/ops" \
	&& "${TARGET_SHA}" =~ ^[0-9a-f]{40}$ \
	&& -f "${OPS_RELEASE}/.commit" && ! -L "${OPS_RELEASE}/.commit" \
	&& "$(<"${OPS_RELEASE}/.commit")" == "${TARGET_SHA}" ]] \
	|| die "Run only from an immutable reviewed operational bundle."
unexpected_ops_path="$(
	find "${OPS_RELEASE}" \( ! -user root -o -perm /022 -o -type l \) \
		-print -quit
)"
[[ -z "${unexpected_ops_path}" ]] \
	|| die "The reviewed operational bundle is not immutable."

[[ -f "${PROVISION_RECOVERY}" && ! -L "${PROVISION_RECOVERY}" \
	&& "$(stat -c '%U:%G %a' "${PROVISION_RECOVERY}")" == \
		"root:root 600" ]] \
	|| die "A durable repair recovery marker is required."
[[ -d "${REPO_DIR}/.git" && ! -L "${REPO_DIR}" \
	&& "$(stat -c '%U:%G %a' "${REPO_DIR}")" == "root:root 755" ]] \
	|| die "The trusted root Git mirror is malformed."
[[ -d "${BUILD_DIR}" && ! -L "${BUILD_DIR}" \
	&& "$(stat -c '%U:%G %a' "${BUILD_DIR}")" == "root:root 755" ]] \
	|| die "The build root is malformed."
install -d -o root -g root -m 0755 "${BRIDGE_ROOT}"
[[ -d "${BRIDGE_ROOT}" && ! -L "${BRIDGE_ROOT}" \
	&& "$(stat -c '%U:%G %a' "${BRIDGE_ROOT}")" == "root:root 755" ]] \
	|| die "The repair-bridge root is malformed."

RESOLVED_LEGACY_SHA="$(
	/usr/bin/git -C "${REPO_DIR}" -c core.hooksPath=/dev/null \
		rev-parse --verify "${LEGACY_SHA}^{commit}" 2>/dev/null
)" || die "The legacy release SHA is absent from the trusted Git mirror."
[[ "${RESOLVED_LEGACY_SHA}" == "${LEGACY_SHA}" ]] \
	|| die "The legacy release did not resolve to its exact commit."
/usr/bin/git -C "${REPO_DIR}" -c core.hooksPath=/dev/null \
	merge-base --is-ancestor "${LEGACY_SHA}" origin/main \
	|| die "The legacy release is not an ancestor of fetched origin/main."
SOURCE_DATE_EPOCH="$(
	/usr/bin/git -C "${REPO_DIR}" -c core.hooksPath=/dev/null \
		show -s --format=%ct "${LEGACY_SHA}"
)" || die "Could not determine the legacy source timestamp."
[[ "${SOURCE_DATE_EPOCH}" =~ ^[1-9][0-9]{0,11}$ ]] \
	|| die "The legacy source timestamp is malformed."

# The contained-build helper uses FULL_SHA only to generate a bounded transient
# systemd unit name. The code archive remains pinned separately above.
FULL_SHA="${LEGACY_SHA}"

case "${PHASE}" in
	backend)
		build_backend_seed
		;;
	complete)
		build_complete_bridge
		;;
esac
