#!/usr/bin/bash
#
# Explicit first-install bridge for a pristine database. A complete storefront
# release needs a Medusa publishable key, while that key is created by the first
# Medusa migration script. This command builds and activates only an immutable
# backend, records the generated public key in the root-owned environment file,
# and deliberately leaves the storefront in maintenance. The operator then
# runs deploy.sh with the same reviewed SHA to publish a complete release.
#
# Usage (root, after provision.sh and Caddy configuration):
#
#   /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC /usr/bin/bash /srv/peptides/ops-current/deploy/bootstrap-backend.sh <commit-sha>
#
# A forward-only migration that was interrupted after its durable recovery
# marker was committed may be resumed explicitly:
#
#   ... /usr/bin/bash /srv/peptides/ops-current/deploy/bootstrap-backend.sh <commit-sha> --resume

if [[ "${PEPTIDES_CLEAN_ENTRY:-0}" != "1" ]]; then
	set +x +v
	builtin unset -v BASH_ENV ENV CDPATH GLOBIGNORE LD_PRELOAD \
		LD_LIBRARY_PATH DYLD_INSERT_LIBRARIES TAR_OPTIONS 2>/dev/null || :
	_entry_dir="${BASH_SOURCE[0]%/*}"
	[[ "${_entry_dir}" != "${BASH_SOURCE[0]}" ]] || _entry_dir='.'
	_entry_dir="$(builtin cd -- "${_entry_dir}" && builtin pwd -P)"
	exec /usr/bin/env -i \
		PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
		HOME=/root \
		LANG=C.UTF-8 \
		LC_ALL=C.UTF-8 \
		TZ=UTC \
		PEPTIDES_CLEAN_ENTRY=1 \
		/usr/bin/bash "${_entry_dir}/${BASH_SOURCE[0]##*/}" "$@"
fi
builtin unset -v PEPTIDES_CLEAN_ENTRY _entry_dir

set -euo pipefail

SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
[[ "${SCRIPT_DIR}" != "${BASH_SOURCE[0]}" ]] || SCRIPT_DIR='.'
SCRIPT_DIR="$(builtin cd -- "${SCRIPT_DIR}" && builtin pwd -P)"
# shellcheck source=lib/env-file.sh
builtin source "${SCRIPT_DIR}/lib/env-file.sh"
# shellcheck source=lib/state.sh
builtin source "${SCRIPT_DIR}/lib/state.sh"
# shellcheck source=lib/recovery.sh
builtin source "${SCRIPT_DIR}/lib/recovery.sh"
# shellcheck source=lib/build-boundary.sh
builtin source "${SCRIPT_DIR}/lib/build-boundary.sh"
deploy_sanitize_environment

APP_DIR=/srv/peptides
REPO_DIR="${APP_DIR}/repo"
OPS_ROOT="$(builtin cd -- "${SCRIPT_DIR}/.." && builtin pwd -P)"
ENV_FILE="${APP_DIR}/.env"
CADDY_ENV_FILE="${APP_DIR}/caddy.env"
BUILD_DIR="${APP_DIR}/build"
BOOTSTRAP_ROOT="${APP_DIR}/bootstrap"
SNAPSHOT_DIR="${APP_DIR}/snapshots"
BACKEND_CURRENT="${APP_DIR}/backend-current"
BACKEND_CANDIDATE="${APP_DIR}/backend-candidate"
STOREFRONT_CURRENT="${APP_DIR}/storefront-current"
STOREFRONT_CANDIDATE="${APP_DIR}/storefront-candidate"
MAINTENANCE_CONFIG="${APP_DIR}/maintenance.caddy"
CSP_CURRENT="${APP_DIR}/csp-current"
RECOVERY_REQUIRED="${APP_DIR}/recovery-required"
ACTIVATION_REQUIRED="${APP_DIR}/activation-required"
PROVISION_RECOVERY="${APP_DIR}/provision-recovery-required"
DEPLOY_STATE_FILE="${APP_DIR}/deploy.state"
LOCK_FILE="${APP_DIR}/deploy.lock"
BUILD_USER=peptides-build
OPS_PROTOCOL_VALUE=peptides-ops-v2

BUILD_WORKSPACE=""
ROOT_STAGING=""
ENV_STAGING=""
DEPLOY_PHASE="${PHASE_PRE_BUILD}"
MIGRATION_STARTED=0
BOOTSTRAP_SUCCEEDED=0
CANDIDATE_UNIT=""
DEPLOY_GUARD_UNIT=""
RESUME_MODE=0
RECOVERY_MARKER_PHASE=""
PERSISTED_PUBLISHABLE_KEY=""
PUBLISHABLE_KEY=""

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[fail] %s\033[0m\n' "$*" >&2; exit 1; }

assert_owner_mode() {
	local path="$1" expected_owner="$2" expected_mode="$3"
	local actual

	[[ -f "${path}" && ! -L "${path}" ]] \
		|| die "${path} must be a regular, non-symlink file."
	actual="$(stat -c '%U:%G %a' "${path}")"
	[[ "${actual}" == "${expected_owner} ${expected_mode}" ]] \
		|| die "${path} has unsafe ownership or mode."
}

assert_directory_owner_mode() {
	local path="$1" expected_owner="$2" expected_mode="$3"
	local actual

	[[ -d "${path}" && ! -L "${path}" ]] \
		|| die "${path} must be a real directory."
	actual="$(stat -c '%U:%G %a' "${path}")"
	[[ "${actual}" == "${expected_owner} ${expected_mode}" ]] \
		|| die "${path} has unsafe ownership or mode."
}

atomic_symlink() {
	local target="$1" link="$2"
	ln -sfn "${target}" "${link}.new"
	mv -Tf "${link}.new" "${link}"
	sync -f "$(dirname "${link}")"
}

set_deploy_phase() {
	local next_phase="$1"

	deploy_state_require_transition "${DEPLOY_PHASE}" "${next_phase}" \
		|| die "Refusing an invalid bootstrap phase transition."
	DEPLOY_PHASE="${next_phase}"
	deploy_durable_write_line \
		"${APP_DIR}/deploy.state" "${APP_DIR}" \
		"sha=${FULL_SHA} phase=${DEPLOY_PHASE} mode=first-install-bootstrap updated=$(date -Is)" \
		|| die "Could not durably record bootstrap state."
}

reload_caddy() {
	(
		deploy_sanitize_environment
		deploy_load_caddy_env_file "${CADDY_ENV_FILE}"
		caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
			>/dev/null 2>&1
	) || return 1
	systemctl reload-or-restart caddy
}

force_maintenance_fail_closed() {
	local temporary

	temporary="$(mktemp "${APP_DIR}/.maintenance-bootstrap.XXXXXX")" \
		|| {
			systemctl stop caddy >/dev/null 2>&1 || true
			return 1
		}
	if install -o root -g caddy -m 0644 \
		"${SCRIPT_DIR}/maintenance.on.caddy" "${temporary}" \
		&& mv -Tf "${temporary}" "${MAINTENANCE_CONFIG}" \
		&& reload_caddy >/dev/null 2>&1; then
		return 0
	fi
	unlink "${temporary}" >/dev/null 2>&1 || true
	systemctl stop caddy >/dev/null 2>&1 || true
	return 1
}

stop_candidate_runtime() {
	local status=0

	if [[ -n "${CANDIDATE_UNIT}" ]]; then
		deploy_stop_and_prove_unit "${CANDIDATE_UNIT}" || status=1
		CANDIDATE_UNIT=""
	fi
	if [[ -n "${DEPLOY_GUARD_UNIT}" ]]; then
		deploy_stop_and_prove_unit "${DEPLOY_GUARD_UNIT}" || status=1
		DEPLOY_GUARD_UNIT=""
	fi
	return "${status}"
}

start_candidate_runtime() {
	DEPLOY_GUARD_UNIT="peptides-deploy-guard@$$.service"
	CANDIDATE_UNIT="medusa-candidate@$$.service"
	systemctl reset-failed "${DEPLOY_GUARD_UNIT}" \
		"${CANDIDATE_UNIT}" >/dev/null 2>&1 || true
	systemctl start "${DEPLOY_GUARD_UNIT}" || return 1
	systemctl is-active --quiet "${DEPLOY_GUARD_UNIT}" || return 1
	systemctl start "${CANDIDATE_UNIT}" || return 1
	systemctl is-active --quiet "${CANDIDATE_UNIT}" || return 1
}

wait_for_backend_health() {
	local _
	for _ in $(seq 1 60); do
		if "${SCRIPT_DIR}/verify-release.sh" \
			backend "${SITE_DOMAIN_VALUE}" >/dev/null 2>&1; then
			return 0
		fi
		sleep 3
	done
	return 1
}

cleanup_bootstrap() {
	local status="$?"
	trap - EXIT
	set +e

	deploy_stop_transient_build
	if [[ -n "${BUILD_WORKSPACE}" ]]; then
		case "${BUILD_WORKSPACE}" in
			"${BUILD_DIR}/bootstrap-${FULL_SHA:-unresolved}."*)
				rm -rf -- "${BUILD_WORKSPACE}"
				;;
			*)
				warn "Refusing to clean an unexpected bootstrap build path."
				;;
		esac
	fi
	if [[ -n "${ENV_STAGING}" ]]; then
		case "${ENV_STAGING}" in
			"${APP_DIR}/.env.bootstrap."*)
				unlink "${ENV_STAGING}" 2>/dev/null || true
				;;
		esac
	fi
	if [[ -n "${ROOT_STAGING}" ]]; then
		case "${ROOT_STAGING}" in
			"${BUILD_DIR}/bootstrap-promote-${FULL_SHA:-unresolved}."*)
				rm -rf -- "${ROOT_STAGING}"
				;;
		esac
	fi

	if [[ "${status}" -ne 0 && "${MIGRATION_STARTED}" -eq 1 ]]; then
		stop_candidate_runtime \
			|| warn "The bootstrap candidate control group did not stop cleanly."
		deploy_stop_and_prove_unit medusa.service \
			|| warn "The bootstrap backend did not stop cleanly."
		if ! force_maintenance_fail_closed; then
			warn "Caddy was stopped because maintenance could not be proven."
		fi
		if ! deploy_recovery_write_operator_review \
			"${RECOVERY_REQUIRED}" "${APP_DIR}/control-snapshots" \
			"${FULL_SHA}" "${DEPLOY_PHASE}"; then
			systemctl stop caddy >/dev/null 2>&1 || true
			warn "Could not durably record recovery; Caddy remains stopped."
		fi
		warn "The first database migration began; operator review is required."
	fi

	exit "${status}"
}
trap cleanup_bootstrap EXIT

TARGET_SHA="${1:-}"
case "$#" in
	1)
		;;
	2)
		[[ "${2}" == "--resume" ]] \
			|| die "Usage: bootstrap-backend.sh <commit-sha> [--resume]"
		RESUME_MODE=1
		;;
	*)
		die "Usage: bootstrap-backend.sh <commit-sha> [--resume]"
		;;
esac
[[ "${TARGET_SHA}" =~ ^[0-9a-fA-F]{7,40}$ ]] \
	|| die "Usage: bootstrap-backend.sh <commit-sha> [--resume]"
[[ "${EUID}" -eq 0 ]] || die "Run as root."

assert_owner_mode "${ENV_FILE}" root:medusa 640
assert_owner_mode "${CADDY_ENV_FILE}" root:caddy 640
assert_owner_mode "${OPS_ROOT}/.commit" root:root 444
assert_owner_mode "${SCRIPT_DIR}/OPS_PROTOCOL" root:root 444
[[ "$(<"${SCRIPT_DIR}/OPS_PROTOCOL")" == "${OPS_PROTOCOL_VALUE}" ]] \
	|| die "First-install bootstrap requires the hardened ops protocol."
assert_owner_mode "${LOCK_FILE}" root:root 600
assert_directory_owner_mode "${REPO_DIR}" root:root 755
assert_directory_owner_mode "${BUILD_DIR}" root:root 755
assert_directory_owner_mode "${BOOTSTRAP_ROOT}" root:root 755
assert_directory_owner_mode "${SNAPSHOT_DIR}" root:root 700
deploy_assert_isolated_service_identities \
	|| die "Service, build and backup identities are not strictly isolated."
if /usr/sbin/runuser -u "${BUILD_USER}" -- /usr/bin/test -r "${ENV_FILE}"; then
	die "${BUILD_USER} can read the runtime environment file."
fi

exec 9>>"${LOCK_FILE}"
flock -n 9 \
	|| die "A deployment or backup holds ${LOCK_FILE}; retry after it finishes."
printf 'pid=%s sha=%s mode=first-install started=%s\n' \
	"$$" "${TARGET_SHA}" "$(date -Is)" >&9

if [[ "${RESUME_MODE}" -eq 1 ]]; then
	[[ -e "${RECOVERY_REQUIRED}" || -L "${RECOVERY_REQUIRED}" ]] \
		|| die "Explicit bootstrap resume requires a recovery marker."
else
	[[ ! -e "${RECOVERY_REQUIRED}" && ! -L "${RECOVERY_REQUIRED}" ]] \
		|| die "An unresolved recovery marker exists; use explicit --resume only after review."
fi
[[ ! -e "${PROVISION_RECOVERY}" && ! -L "${PROVISION_RECOVERY}" ]] \
	|| die "An unresolved provisioning recovery marker exists."
[[ ! -e "${ACTIVATION_REQUIRED}" && ! -L "${ACTIVATION_REQUIRED}" ]] \
	|| die "An unresolved release activation marker exists."
if [[ "${RESUME_MODE}" -eq 0 ]]; then
	for pointer in \
		"${BACKEND_CURRENT}" \
		"${STOREFRONT_CURRENT}" \
		"${STOREFRONT_CANDIDATE}"
	do
		[[ ! -e "${pointer}" && ! -L "${pointer}" ]] \
			|| die "First-install bootstrap refuses an existing runtime pointer: ${pointer}"
	done
fi

unexpected_repo_path="$(
	find "${REPO_DIR}" -xdev \( ! -user root -o -perm /022 \) -print -quit
)"
[[ -z "${unexpected_repo_path}" ]] \
	|| die "The root Git mirror contains an untrusted path."

deploy_load_app_env_file "${ENV_FILE}"
deploy_validate_app_secret_values \
	|| die "${ENV_FILE} contains weak or reused application secrets."
: "${DATABASE_URL:?DATABASE_URL must be set in ${ENV_FILE}}"
: "${PUBLIC_SITE_URL:?PUBLIC_SITE_URL must be set in ${ENV_FILE}}"
: "${PUBLIC_MEDUSA_BACKEND_URL:?PUBLIC_MEDUSA_BACKEND_URL must be set in ${ENV_FILE}}"
PERSISTED_PUBLISHABLE_KEY="${PUBLIC_MEDUSA_PUBLISHABLE_KEY:-}"
if [[ "${RESUME_MODE}" -eq 0 ]]; then
	[[ -z "${PERSISTED_PUBLISHABLE_KEY}" ]] \
		|| die "First-install bootstrap requires a blank publishable key."
elif [[ -n "${PERSISTED_PUBLISHABLE_KEY}" \
	&& ! "${PERSISTED_PUBLISHABLE_KEY}" =~ ^pk_[0-9a-f]{64}$ ]]; then
	die "Bootstrap resume found a malformed persisted publishable key."
fi
for app_env_name in "${DEPLOY_APP_ENV_ALLOWLIST[@]}"; do
	export -n "${app_env_name}" 2>/dev/null || true
done

deploy_load_caddy_env_file "${CADDY_ENV_FILE}"
: "${SITE_DOMAIN:?SITE_DOMAIN must be set in ${CADDY_ENV_FILE}}"
[[ "${MAINTENANCE_CONFIG:-}" == "${APP_DIR}/maintenance.caddy" ]] \
	|| die "MAINTENANCE_CONFIG is outside the root-controlled contract."
[[ "${CSP_CONFIG:-}" == "${APP_DIR}/csp-current" ]] \
	|| die "CSP_CONFIG is outside the root-controlled contract."
[[ "${PUBLIC_SITE_URL}" == "https://${SITE_DOMAIN}" ]] \
	|| die "PUBLIC_SITE_URL does not match the production domain."
[[ "${PUBLIC_MEDUSA_BACKEND_URL}" == "https://api.${SITE_DOMAIN}" ]] \
	|| die "PUBLIC_MEDUSA_BACKEND_URL does not match the production API domain."
SITE_DOMAIN_VALUE="${SITE_DOMAIN}"
unset ACME_EMAIL GATE_USER GATE_PASSWORD_HASH SITE_GATED SITE_DOMAIN \
	MAINTENANCE_CONFIG CSP_CONFIG

if [[ "${RESUME_MODE}" -eq 1 ]]; then
	log "Validating the interrupted first-install bootstrap"
else
	log "Proving this is a pristine first install"
fi
git -C "${REPO_DIR}" -c core.hooksPath=/dev/null \
	fetch --quiet origin main --tags
FULL_SHA="$(git -C "${REPO_DIR}" rev-parse --verify \
	"${TARGET_SHA}^{commit}" 2>/dev/null)" \
	|| die "${TARGET_SHA} is not a commit in the trusted mirror."
[[ "${FULL_SHA}" =~ ^[0-9a-f]{40}$ ]] \
	|| die "The reviewed target did not resolve to a full SHA."
git -C "${REPO_DIR}" merge-base --is-ancestor "${FULL_SHA}" origin/main \
	|| die "First-install bootstrap accepts only a commit on origin/main."
[[ "$(<"${OPS_ROOT}/.commit")" == "${FULL_SHA}" ]] \
	|| die "Run the bootstrap implementation extracted from the target commit."

assert_pristine_database() {
	local object_count
	object_count="$(
		deploy_run_pg_command "${DATABASE_URL}" \
			/usr/bin/psql --no-psqlrc --no-password \
				--tuples-only --no-align --set=ON_ERROR_STOP=1 \
				--command="SELECT (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast') + (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_') + (SELECT count(*) FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND t.typrelid = 0);"
	)" || return 1
	[[ "${object_count}" =~ ^[[:space:]]*0[[:space:]]*$ ]]
}

if [[ "${RESUME_MODE}" -eq 0 ]]; then
	assert_pristine_database \
		|| die "The database is not pristine; use the explicit recovery path."
fi

run_as_build() {
	local working_directory="$1"
	shift

	deploy_run_contained_build \
		"${BUILD_USER}" "${BUILD_WORKSPACE}" "${working_directory}" "$@"
}

validate_bootstrap_release() {
	local release="$1" unexpected_path recomputed_digest

	[[ -f "${release}/.complete" && ! -L "${release}/.complete" ]] \
		|| die "Bootstrap backend is missing its completion marker."
	[[ "$(<"${release}/.complete")" == "${FULL_SHA}" ]] \
		|| die "Bootstrap backend marker does not match ${FULL_SHA}."
	# A resume must not trust a tree only because it is named after the target
	# commit: recompute the byte-level identity of the promoted backend.
	[[ -f "${release}/.artifact-digest" \
		&& ! -L "${release}/.artifact-digest" ]] \
		|| die "Bootstrap backend is missing its generated-artifact digest."
	recomputed_digest="$(deploy_hash_bootstrap_artifact "${release}")" \
		|| die "Bootstrap backend digest could not be recomputed."
	[[ "$(<"${release}/.artifact-digest")" == "${recomputed_digest}" ]] \
		|| die "Bootstrap backend contents do not match their recorded digest."
	[[ -f "${release}/backend/package-lock.json" ]] \
		|| die "Bootstrap backend is missing its production lock."
	[[ -f "${release}/backend/node_modules/@medusajs/cli/cli.js" ]] \
		|| die "Bootstrap backend is missing the installed Medusa CLI."
	[[ -L "${release}/backend/apps/backend/.medusa/server/static" \
		&& "$(readlink "${release}/backend/apps/backend/.medusa/server/static")" == \
			"/var/lib/peptides/static" ]] \
		|| die "Bootstrap backend has an invalid runtime-state link."
	unexpected_path="$(find -P "${release}" ! -user root -print -quit)"
	[[ -z "${unexpected_path}" ]] \
		|| die "Bootstrap backend contains a non-root-owned path."
	deploy_validate_promoted_tree \
		"${release}" \
		"${release}/backend/apps/backend/.medusa/server/static" \
			|| die "Bootstrap backend filesystem validation failed."
}

BOOTSTRAP_RELEASE="${BOOTSTRAP_ROOT}/${FULL_SHA}"

assert_exact_root_symlink() {
	local pointer="$1" target="$2" actual_owner

	[[ -L "${pointer}" ]] \
		|| die "Bootstrap resume requires an exact symbolic link at ${pointer}."
	[[ "$(readlink "${pointer}")" == "${target}" ]] \
		|| die "Bootstrap resume found an unexpected target at ${pointer}."
	actual_owner="$(stat -c '%U:%G' "${pointer}")"
	[[ "${actual_owner}" == "root:root" ]] \
		|| die "Bootstrap resume found unsafe pointer ownership at ${pointer}."
}

validate_resume_recovery_state() {
	local marker_line state_line current_line line_count
	local state_sha state_phase state_mode state_updated state_extra

	assert_owner_mode "${RECOVERY_REQUIRED}" root:root 600
	deploy_state_validate_recovery_marker \
		"${RECOVERY_REQUIRED}" "${APP_DIR}/control-snapshots" \
		|| die "Bootstrap resume requires a canonical recovery marker."
	marker_line="$(<"${RECOVERY_REQUIRED}")"
	case "${marker_line}" in
		"sha=${FULL_SHA} phase=${PHASE_MIGRATION_STARTED} action=${DEPLOY_RECOVERY_ACTION_OPERATOR_REVIEW}")
			RECOVERY_MARKER_PHASE="${PHASE_MIGRATION_STARTED}"
			;;
		"sha=${FULL_SHA} phase=${PHASE_BACKEND_ACTIVATED} action=${DEPLOY_RECOVERY_ACTION_OPERATOR_REVIEW}")
			RECOVERY_MARKER_PHASE="${PHASE_BACKEND_ACTIVATED}"
			;;
		*)
			die "Bootstrap resume marker does not belong to this SHA and workflow."
			;;
	esac

	assert_owner_mode "${DEPLOY_STATE_FILE}" root:root 600
	state_line=""
	line_count=0
	while IFS= read -r current_line || [[ -n "${current_line}" ]]; do
		line_count=$((line_count + 1))
		[[ "${line_count}" -eq 1 ]] \
			|| die "Bootstrap resume state must contain exactly one line."
		state_line="${current_line}"
	done <"${DEPLOY_STATE_FILE}"
	[[ "${line_count}" -eq 1 && -n "${state_line}" ]] \
		|| die "Bootstrap resume state is empty."

	state_sha=""
	state_phase=""
	state_mode=""
	state_updated=""
	state_extra=""
	IFS=' ' read -r state_sha state_phase state_mode state_updated state_extra \
		<<<"${state_line}"
	[[ "${state_sha}" == "sha=${FULL_SHA}" \
		&& "${state_mode}" == "mode=first-install-bootstrap" \
		&& -z "${state_extra}" ]] \
		|| die "Bootstrap resume state does not belong to this SHA and workflow."
	[[ "${state_updated}" =~ ^updated=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:[0-9]{2})$ ]] \
		|| die "Bootstrap resume state timestamp is malformed."

	case "${state_phase}" in
		phase=*)
			;;
		*)
			die "Bootstrap resume state phase is malformed."
			;;
	esac
	state_phase="${state_phase#phase=}"
	[[ "${state_line}" == \
		"sha=${FULL_SHA} phase=${state_phase} mode=first-install-bootstrap ${state_updated}" ]] \
		|| die "Bootstrap resume state is not canonical."
	case "${state_phase}:${RECOVERY_MARKER_PHASE}" in
		"${PHASE_MIGRATION_STARTED}:${PHASE_MIGRATION_STARTED}" \
		| "${PHASE_MIGRATION_STARTED}:${PHASE_BACKEND_ACTIVATED}" \
		| "${PHASE_BACKEND_ACTIVATED}:${PHASE_BACKEND_ACTIVATED}")
			;;
		*)
			die "Bootstrap resume marker and state are not a safe forward-only pair."
			;;
	esac
	DEPLOY_PHASE="${state_phase}"
}

validate_resume_paths() {
	validate_bootstrap_release "${BOOTSTRAP_RELEASE}"
	assert_exact_root_symlink \
		"${BACKEND_CANDIDATE}" "${BOOTSTRAP_RELEASE}/backend"
	assert_exact_root_symlink \
		"${STOREFRONT_CANDIDATE}" "${SCRIPT_DIR}/bootstrap-site"

	if [[ -e "${BACKEND_CURRENT}" || -L "${BACKEND_CURRENT}" ]]; then
		assert_exact_root_symlink \
			"${BACKEND_CURRENT}" "${BOOTSTRAP_RELEASE}/backend"
	fi
	[[ ! -e "${STOREFRONT_CURRENT}" && ! -L "${STOREFRONT_CURRENT}" ]] \
		|| die "Bootstrap resume refuses an activated storefront."
}

query_single_publishable_key() {
	local query_output line key_count candidate_key

	query_output="$(
		deploy_run_pg_command "${DATABASE_URL}" \
			/usr/bin/psql --no-psqlrc --no-password --tuples-only --no-align \
				--set=ON_ERROR_STOP=1 \
				--command="SELECT token FROM api_key WHERE type = 'publishable' AND revoked_at IS NULL AND deleted_at IS NULL ORDER BY created_at, id LIMIT 2;"
	)" || return 1
	[[ -n "${query_output}" ]] || return 1

	key_count=0
	candidate_key=""
	while IFS= read -r line || [[ -n "${line}" ]]; do
		[[ "${line}" =~ ^pk_[0-9a-f]{64}$ ]] || return 1
		key_count=$((key_count + 1))
		candidate_key="${line}"
	done <<<"${query_output}"
	[[ "${key_count}" -eq 1 ]] || return 1
	PUBLISHABLE_KEY="${candidate_key}"
}

persist_generated_publishable_key() {
	local publishable_lines env_line app_env_name

	ENV_STAGING="$(mktemp "${APP_DIR}/.env.bootstrap.XXXXXX")"
	publishable_lines=0
	while IFS= read -r env_line || [[ -n "${env_line}" ]]; do
		case "${env_line}" in
			PUBLIC_MEDUSA_PUBLISHABLE_KEY=)
				printf 'PUBLIC_MEDUSA_PUBLISHABLE_KEY=%s\n' \
					"${PUBLISHABLE_KEY}"
				publishable_lines=$((publishable_lines + 1))
				;;
			PUBLIC_MEDUSA_PUBLISHABLE_KEY=*)
				die "The publishable key changed during first-install bootstrap."
				;;
			*)
				printf '%s\n' "${env_line}"
				;;
		esac
	done <"${ENV_FILE}" >"${ENV_STAGING}"
	[[ "${publishable_lines}" -eq 1 ]] \
		|| die "The environment file has no canonical blank publishable-key record."
	chown root:medusa "${ENV_STAGING}"
	chmod 0640 "${ENV_STAGING}"
	/usr/bin/sync -f "${ENV_STAGING}"
	mv -Tf "${ENV_STAGING}" "${ENV_FILE}"
	ENV_STAGING=""
	/usr/bin/sync -f "${APP_DIR}"
	assert_owner_mode "${ENV_FILE}" root:medusa 640

	deploy_load_app_env_file "${ENV_FILE}"
	[[ "${PUBLIC_MEDUSA_PUBLISHABLE_KEY:-}" == "${PUBLISHABLE_KEY}" ]] \
		|| die "The persisted publishable key failed exact verification."
	for app_env_name in "${DEPLOY_APP_ENV_ALLOWLIST[@]}"; do
		export -n "${app_env_name}" 2>/dev/null || true
	done
	unset env_line publishable_lines
}

if [[ "${RESUME_MODE}" -eq 1 ]]; then
	validate_resume_recovery_state
	validate_resume_paths
	MIGRATION_STARTED=1
else
	log "Building the immutable first-install backend"
	if [[ -e "${BOOTSTRAP_RELEASE}" ]]; then
		validate_bootstrap_release "${BOOTSTRAP_RELEASE}"
	else
		BUILD_WORKSPACE="$(
			mktemp -d "${BUILD_DIR}/bootstrap-${FULL_SHA}.XXXXXX"
		)"
		chown "${BUILD_USER}:${BUILD_USER}" "${BUILD_WORKSPACE}"
		install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 \
			"${BUILD_WORKSPACE}/source" \
			"${BUILD_WORKSPACE}/home" \
			"${BUILD_WORKSPACE}/cache" \
			"${BUILD_WORKSPACE}/tmp" \
			"${BUILD_WORKSPACE}/npm-cache" \
			"${BUILD_WORKSPACE}/bootstrap-release" \
			"${BUILD_WORKSPACE}/bootstrap-release/backend/apps/backend/.medusa"
		/usr/bin/env -i \
			PATH="${DEPLOY_TRUSTED_PATH}" \
			/usr/bin/git -C "${REPO_DIR}" -c core.hooksPath=/dev/null \
				archive --format=tar "${FULL_SHA}" \
			| run_as_build "${BUILD_WORKSPACE}/source" \
				/usr/bin/tar --extract --file=- \
					--no-same-owner --no-same-permissions

		BACKEND_SOURCE="${BUILD_WORKSPACE}/source/backend"
		BACKEND_APP_SOURCE="${BACKEND_SOURCE}/apps/backend"
		run_as_build "${BACKEND_SOURCE}" /usr/bin/npm ci --no-audit --no-fund
		run_as_build "${BACKEND_SOURCE}" \
			/usr/bin/env NODE_ENV=development \
			"${BACKEND_SOURCE}/node_modules/.bin/turbo" \
			run build --filter=@dtc/backend

		BUILD_OUTPUT="${BACKEND_APP_SOURCE}/.medusa/server"
		[[ -d "${BUILD_OUTPUT}" ]] \
			|| die "Medusa build produced no generated server."
		cmp -s "${BACKEND_APP_SOURCE}/package.json" \
			"${BUILD_OUTPUT}/package.json" \
			|| die "Generated Medusa manifest diverges from the lock-backed manifest."

		ARTIFACT="${BUILD_WORKSPACE}/bootstrap-release"
		run_as_build "${ARTIFACT}" /usr/bin/cp \
			"${BACKEND_SOURCE}/package.json" \
			"${BACKEND_SOURCE}/package-lock.json" \
			"${ARTIFACT}/backend/"
		run_as_build "${ARTIFACT}" /usr/bin/cp \
			"${BACKEND_APP_SOURCE}/package.json" \
			"${ARTIFACT}/backend/apps/backend/package.json"
		run_as_build "${ARTIFACT}" /usr/bin/cp -a "${BUILD_OUTPUT}" \
			"${ARTIFACT}/backend/apps/backend/.medusa/server"
		[[ ! -e "${ARTIFACT}/backend/apps/backend/.medusa/server/static" ]] \
			|| die "Generated server unexpectedly contains a static path."
		run_as_build "${ARTIFACT}/backend" \
			/usr/bin/npm ci --omit=dev --no-audit --no-fund

		if deploy_build_user_has_processes "${BUILD_USER}"; then
			die "The build identity retained a process before bootstrap promotion."
		fi
		ROOT_STAGING="$(
			mktemp -d "${BUILD_DIR}/bootstrap-promote-${FULL_SHA}.XXXXXX"
		)"
		chown root:root "${ROOT_STAGING}"
		chmod 0700 "${ROOT_STAGING}"
		deploy_promote_bootstrap_backend \
			"${ARTIFACT}" "${ROOT_STAGING}" "${FULL_SHA}" \
			|| die "Could not safely promote the bootstrap backend."
		mv "${ROOT_STAGING}" "${BOOTSTRAP_RELEASE}"
		ROOT_STAGING=""
		validate_bootstrap_release "${BOOTSTRAP_RELEASE}"
	fi
	set_deploy_phase "${PHASE_BUILT}"

	atomic_symlink "${BOOTSTRAP_RELEASE}/backend" "${BACKEND_CANDIDATE}"
	atomic_symlink "${SCRIPT_DIR}/bootstrap-site" "${STOREFRONT_CANDIDATE}"
fi

log "Entering fail-closed first-install maintenance"
MAINTENANCE_TEMPORARY="$(
	mktemp "${APP_DIR}/.maintenance-bootstrap-entry.XXXXXX"
)"
install -o root -g caddy -m 0644 \
	"${SCRIPT_DIR}/maintenance.on.caddy" "${MAINTENANCE_TEMPORARY}"
mv -Tf "${MAINTENANCE_TEMPORARY}" "${MAINTENANCE_CONFIG}"
unset MAINTENANCE_TEMPORARY
install -m 0644 "${SCRIPT_DIR}/Caddyfile" /etc/caddy/Caddyfile
install -m 0644 "${SCRIPT_DIR}/medusa.service" \
	/etc/systemd/system/medusa.service
install -m 0644 "${SCRIPT_DIR}/medusa-migrate.service" \
	/etc/systemd/system/medusa-migrate.service
install -m 0644 "${SCRIPT_DIR}/medusa-candidate@.service" \
	/etc/systemd/system/medusa-candidate@.service
	install -m 0644 "${SCRIPT_DIR}/peptides-deploy-guard@.service" \
		/etc/systemd/system/peptides-deploy-guard@.service
	sync -f "${MAINTENANCE_CONFIG}"
	sync -f "${APP_DIR}"
	sync -f /etc/caddy/Caddyfile
	sync -f /etc/caddy
	sync -f /etc/systemd/system
	systemctl daemon-reload
reload_caddy || die "The Caddy configuration is invalid."
if [[ "${RESUME_MODE}" -eq 0 ]]; then
	set_deploy_phase "${PHASE_MAINTENANCE}"
fi
"${SCRIPT_DIR}/verify-release.sh" maintenance "${SITE_DOMAIN_VALUE}" \
	|| die "First-install maintenance verification failed."

deploy_stop_and_prove_unit medusa.service \
	|| die "Medusa did not drain completely during first-install bootstrap."
if [[ "${RESUME_MODE}" -eq 0 ]]; then
	set_deploy_phase "${PHASE_WRITES_STOPPED}"

	assert_pristine_database \
		|| die "The database changed during the bootstrap build; refusing migration."

	log "Creating the pristine pre-migration snapshot"
	SNAPSHOT_FILE="$(
		mktemp "${SNAPSHOT_DIR}/pre-migrate-${FULL_SHA}.XXXXXX.dump"
	)"
	chmod 0600 "${SNAPSHOT_FILE}"
	deploy_run_pg_command "${DATABASE_URL}" \
		/usr/bin/pg_dump --format=custom --no-password --file="${SNAPSHOT_FILE}"
	[[ -s "${SNAPSHOT_FILE}" ]] || die "First-install snapshot is empty."
	/usr/bin/pg_restore --list "${SNAPSHOT_FILE}" >/dev/null \
		|| die "First-install snapshot failed validation."
		set_deploy_phase "${PHASE_BACKUP_VERIFIED}"

		log "Running the reviewed first database migration"
		deploy_recovery_write_operator_review \
			"${RECOVERY_REQUIRED}" "${APP_DIR}/control-snapshots" \
			"${FULL_SHA}" "${PHASE_MIGRATION_STARTED}" \
			|| die "Could not durably record first-migration recovery intent."
		MIGRATION_STARTED=1
		set_deploy_phase "${PHASE_MIGRATION_STARTED}"
else
	log "Re-running the idempotent first database migration"
fi
systemctl reset-failed medusa-migrate >/dev/null 2>&1 || true
systemctl start medusa-migrate \
	|| die "First-install migration failed; maintenance remains enabled."

query_single_publishable_key \
	|| die "The migration did not produce exactly one valid publishable key."
if [[ -n "${PERSISTED_PUBLISHABLE_KEY}" ]]; then
	[[ "${PERSISTED_PUBLISHABLE_KEY}" == "${PUBLISHABLE_KEY}" ]] \
		|| die "The persisted publishable key does not match the migrated database."
else
	persist_generated_publishable_key
	PERSISTED_PUBLISHABLE_KEY="${PUBLISHABLE_KEY}"
fi
unset PUBLIC_MEDUSA_PUBLISHABLE_KEY

log "Activating the hidden bootstrap backend"
atomic_symlink "${BOOTSTRAP_RELEASE}/backend" "${BACKEND_CURRENT}"
assert_exact_root_symlink \
	"${BACKEND_CURRENT}" "${BOOTSTRAP_RELEASE}/backend"
start_candidate_runtime \
	|| die "The hidden bootstrap backend did not start."
wait_for_backend_health \
	|| die "The hidden bootstrap backend failed exact health verification."
stop_candidate_runtime \
	|| die "The hidden bootstrap backend did not stop cleanly."

deploy_recovery_write_operator_review \
	"${RECOVERY_REQUIRED}" "${APP_DIR}/control-snapshots" \
	"${FULL_SHA}" "${PHASE_BACKEND_ACTIVATED}" \
	|| die "Could not durably record completed bootstrap activation."
if [[ "${DEPLOY_PHASE}" == "${PHASE_MIGRATION_STARTED}" ]]; then
	set_deploy_phase "${PHASE_BACKEND_ACTIVATED}"
elif [[ "${DEPLOY_PHASE}" != "${PHASE_BACKEND_ACTIVATED}" ]]; then
	die "Bootstrap completion reached an unexpected deployment phase."
fi
deploy_recovery_remove \
	"${RECOVERY_REQUIRED}" "${APP_DIR}/control-snapshots" "${APP_DIR}" \
	|| die "Could not durably commit the completed bootstrap state."
systemctl reset-failed medusa >/dev/null 2>&1 || true
systemctl start medusa \
	|| die "The committed bootstrap backend did not start."
wait_for_backend_health \
	|| die "The committed bootstrap backend failed exact health verification."

BOOTSTRAP_SUCCEEDED=1
MIGRATION_STARTED=0
unset PUBLISHABLE_KEY PERSISTED_PUBLISHABLE_KEY
log "First-install backend is healthy; storefront maintenance remains enabled"
printf '%s\n' \
	"Run the clean deploy command from docs/deploy.md with SHA ${FULL_SHA}."
