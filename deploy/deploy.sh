#!/usr/bin/bash
#
# The single deploy path for peptideeinkaufen.de. Run on the server as root:
#
#   /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC /usr/bin/bash /srv/peptides/ops-current/deploy/deploy.sh <commit-sha>
#
# Per AGENTS.md: one scripted path, a specific locally verified commit SHA that
# is on origin/main, a server-side lock held for the whole run. Do not run git
# or systemctl against the app by hand alongside this.
#
# Builds into an immutable release and switches separate runtime pointers only
# after verification. Root-executed operational code is likewise staged under
# /srv/peptides/ops/<sha>; a failed target never becomes the scheduled backup
# implementation.
#
# Expected durations (2-4 vCPU Hetzner box, warm npm cache). If output stalls
# well past these, inspect the lock and the service rather than waiting:
#
#   npm ci + medusa build ..... 4-9 min   (first run: up to 15)
#   production npm ci ......... 1-3 min
#   database migrations ....... 5-30 s
#   Medusa healthy ............ 20-60 s
#   storefront build .......... 2-4 min
#   total ..................... roughly 8-17 min

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
OPS_DIR="${APP_DIR}/ops"
OPS_CURRENT="${APP_DIR}/ops-current"
ENV_FILE="${APP_DIR}/.env"
CADDY_ENV_FILE="${APP_DIR}/caddy.env"
RELEASES_DIR="${APP_DIR}/releases"
BUILD_DIR="${APP_DIR}/build"
BOOTSTRAP_ROOT="${APP_DIR}/bootstrap"
SNAPSHOT_DIR="${APP_DIR}/snapshots"
CONTROL_SNAPSHOT_DIR="${APP_DIR}/control-snapshots"
BACKEND_CURRENT="${APP_DIR}/backend-current"
BACKEND_CANDIDATE="${APP_DIR}/backend-candidate"
STOREFRONT_CURRENT="${APP_DIR}/storefront-current"
STOREFRONT_CANDIDATE="${APP_DIR}/storefront-candidate"
CSP_CURRENT="${APP_DIR}/csp-current"
MAINTENANCE_CONFIG="${APP_DIR}/maintenance.caddy"
PREVIOUS_RELEASE="${APP_DIR}/previous-release"
RECOVERY_REQUIRED="${APP_DIR}/recovery-required"
ACTIVATION_REQUIRED="${APP_DIR}/activation-required"
PROVISION_RECOVERY="${APP_DIR}/provision-recovery-required"
CADDY_OVERRIDE=/etc/systemd/system/caddy.service.d/override.conf
LOCK_FILE="${APP_DIR}/deploy.lock"
BUILD_USER=peptides-build
KEEP_RELEASES=5
OPS_PROTOCOL_VALUE=peptides-ops-v2

DEPLOY_PHASE="${PHASE_PRE_BUILD}"
BUILD_WORKSPACE=""
CATALOG_SNAPSHOT_DIR=""
CATALOG_SNAPSHOT=""
ROOT_STAGING=""
OPS_STAGING=""
CONTROL_SNAPSHOT=""
CONTROLS_INSTALLED=0
MAINTENANCE_ENTERED=0
MIGRATION_STARTED=0
DEPLOY_SUCCEEDED=0
AUTHENTICATED_GATE_VERIFIED=0
CANDIDATE_UNIT=""
DEPLOY_GUARD_UNIT=""
ACTIVATION_WATCHDOG_UNIT=""

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[fail] %s\033[0m\n' "$*" >&2; exit 1; }

assert_owner_mode() {
	local file="$1" expected_owner="$2" expected_mode="$3"
	local actual_owner actual_mode

	[[ -f "${file}" && ! -L "${file}" ]] \
		|| die "${file} must be a regular, non-symlink file."
	actual_owner="$(stat -c '%U:%G' "${file}")"
	actual_mode="$(stat -c '%a' "${file}")"
	[[ "${actual_owner}" == "${expected_owner}" ]] \
		|| die "${file} ownership is ${actual_owner}; expected ${expected_owner}."
	[[ "${actual_mode}" == "${expected_mode}" ]] \
		|| die "${file} mode is ${actual_mode}; expected ${expected_mode}."
}

assert_directory_owner_mode() {
	local directory="$1" expected_owner="$2" expected_mode="$3"
	local actual_owner actual_mode

	[[ -d "${directory}" && ! -L "${directory}" ]] \
		|| die "${directory} must be a real directory."
	actual_owner="$(stat -c '%U:%G' "${directory}")"
	actual_mode="$(stat -c '%a' "${directory}")"
	[[ "${actual_owner}" == "${expected_owner}" ]] \
		|| die "${directory} ownership is ${actual_owner}; expected ${expected_owner}."
	[[ "${actual_mode}" == "${expected_mode}" ]] \
		|| die "${directory} mode is ${actual_mode}; expected ${expected_mode}."
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
		|| die "Refusing an invalid deployment phase transition."
	DEPLOY_PHASE="${next_phase}"
	deploy_durable_write_line \
		"${APP_DIR}/deploy.state" "${APP_DIR}" \
		"sha=${FULL_SHA:-unresolved} phase=${DEPLOY_PHASE} updated=$(date -Is)" \
		|| die "Could not durably record deployment state."
}

cleanup_catalog_snapshot() {
	[[ -n "${CATALOG_SNAPSHOT_DIR}" ]] || return 0
	case "${CATALOG_SNAPSHOT_DIR}" in
		"${BUILD_DIR}/catalog-"*)
			[[ -z "${CATALOG_SNAPSHOT}" \
				|| "${CATALOG_SNAPSHOT}" == \
					"${CATALOG_SNAPSHOT_DIR}/catalog.json" ]] \
				|| return 1
			if [[ -n "${CATALOG_SNAPSHOT}" ]] \
				&& { [[ -e "${CATALOG_SNAPSHOT}" ]] \
					|| [[ -L "${CATALOG_SNAPSHOT}" ]]; }; then
				unlink -- "${CATALOG_SNAPSHOT}" || return 1
			fi
			rmdir -- "${CATALOG_SNAPSHOT_DIR}" || return 1
			sync -f "${BUILD_DIR}" || return 1
			CATALOG_SNAPSHOT=""
			CATALOG_SNAPSHOT_DIR=""
			;;
		*)
			return 1
			;;
	esac
}

cleanup_build_workspace_only() {
	local status="$?"
	trap - EXIT
	set +e
	deploy_stop_transient_build
	cleanup_catalog_snapshot || :
	if [[ -n "${BUILD_WORKSPACE}" ]]; then
		case "${BUILD_WORKSPACE}" in
			"${BUILD_DIR}/"*)
				rm -rf -- "${BUILD_WORKSPACE}"
				;;
		esac
	fi
	if [[ -n "${OPS_STAGING}" ]]; then
		case "${OPS_STAGING}" in
			"${OPS_DIR}/"*)
				rm -rf -- "${OPS_STAGING}"
				;;
		esac
	fi
	if [[ -n "${ROOT_STAGING}" ]]; then
		case "${ROOT_STAGING}" in
			"${BUILD_DIR}/promote-"*)
				rm -rf -- "${ROOT_STAGING}"
				;;
		esac
	fi
	exit "${status}"
}
trap cleanup_build_workspace_only EXIT

TARGET_SHA="${1:-}"
[[ -n "${TARGET_SHA}" ]] || die "Usage: deploy.sh <commit-sha>"
[[ "${TARGET_SHA}" =~ ^[0-9a-fA-F]{7,40}$ ]] \
	|| die "The target must be a 7-40 character hexadecimal commit SHA."
[[ -f "${ENV_FILE}" ]]   || die "Missing ${ENV_FILE} — run provision.sh first."
[[ "${EUID}" -eq 0 ]]    || die "Run as root (it manages systemd units and file ownership)."

# ---------------------------------------------------------------------------
# Lock. Held for the whole run; a second deploy aborts rather than interleaving.
# ---------------------------------------------------------------------------
if [[ "${PEPTIDES_DEPLOY_LOCK_FD:-}" == "9" ]]; then
	if ! : >&9 2>/dev/null || ! flock -n 9; then
		die "The inherited deployment lock is unavailable."
	fi
else
	exec 9>>"${LOCK_FILE}"
	if ! flock -n 9; then
		die "Another deploy holds ${LOCK_FILE}. Wait for it to finish, then re-run.
	     Do not intervene on the server while it runs."
	fi
fi
printf 'pid=%s sha=%s started=%s\n' "$$" "${TARGET_SHA}" "$(date -Is)" >&9

assert_owner_mode "${ENV_FILE}" root:medusa 640
assert_owner_mode "${CADDY_ENV_FILE}" root:caddy 640
assert_directory_owner_mode "${REPO_DIR}" root:root 755
assert_directory_owner_mode "${OPS_DIR}" root:root 755
assert_directory_owner_mode "${RELEASES_DIR}" root:root 755
assert_directory_owner_mode "${BUILD_DIR}" root:root 755
assert_directory_owner_mode "${SNAPSHOT_DIR}" root:root 700
assert_directory_owner_mode "${CONTROL_SNAPSHOT_DIR}" root:root 700
assert_owner_mode "${CADDY_OVERRIDE}" root:root 644
deploy_assert_isolated_service_identities \
	|| die "Service, build and backup identities are not strictly isolated."
grep -Fxq \
	"ExecStartPre=/usr/bin/test ! -e ${ACTIVATION_REQUIRED}" \
	"${CADDY_OVERRIDE}" \
	|| die "Caddy is missing the durable activation boot guard."
grep -Fxq \
	"ExecStartPre=/usr/bin/test ! -e ${RECOVERY_REQUIRED}" \
	"${CADDY_OVERRIDE}" \
	|| die "Caddy is missing the durable migration boot guard."
grep -Fxq \
	"ExecStartPre=/usr/bin/test ! -L ${RECOVERY_REQUIRED}" \
	"${CADDY_OVERRIDE}" \
	|| die "Caddy migration boot guard does not reject symbolic links."
grep -Fxq \
	"ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile --address unix//run/caddy/admin.sock --force" \
	"${CADDY_OVERRIDE}" \
	|| die "Caddy reload is not pinned to its private admin socket."

if [[ -e "${RECOVERY_REQUIRED}" || -L "${RECOVERY_REQUIRED}" ]]; then
	assert_owner_mode "${RECOVERY_REQUIRED}" root:root 600
	if ! deploy_state_refuse_unresolved_recovery \
		"${RECOVERY_REQUIRED}" "${CONTROL_SNAPSHOT_DIR}"; then
		:
	fi
	die "An unresolved deployment recovery marker exists at ${RECOVERY_REQUIRED}.
	     Review the recorded phase, candidate, previous release and verified
	     snapshot. Complete a documented roll-forward or database restore, then
	     remove the marker explicitly before starting another deploy."
fi
[[ ! -e "${PROVISION_RECOVERY}" && ! -L "${PROVISION_RECOVERY}" ]] \
	|| die "An unresolved provisioning recovery marker exists at ${PROVISION_RECOVERY}."
[[ ! -e "${ACTIVATION_REQUIRED}" && ! -L "${ACTIVATION_REQUIRED}" ]] \
	|| die "An unresolved release activation marker exists at ${ACTIVATION_REQUIRED}."

if /usr/sbin/runuser -u "${BUILD_USER}" -- /usr/bin/test -r "${ENV_FILE}"; then
	die "${BUILD_USER} can read the runtime environment file."
fi
for protected_path in "${REPO_DIR}" "${RELEASES_DIR}" "${ENV_FILE}"; do
	if /usr/sbin/runuser -u medusa -- /usr/bin/test -w "${protected_path}"; then
		die "The medusa runtime can write ${protected_path}."
	fi
done

unexpected_trusted_path="$(
	find "${REPO_DIR}" -xdev \( ! -user root -o -perm /022 \) -print -quit
)"
[[ -z "${unexpected_trusted_path}" ]] \
	|| die "The root Git mirror contains an untrusted path: ${unexpected_trusted_path}"

deploy_load_app_env_file "${ENV_FILE}"
deploy_validate_app_secret_values \
	|| die "${ENV_FILE} contains weak or reused application secrets."
: "${DATABASE_URL:?DATABASE_URL must be set in ${ENV_FILE}}"
: "${PUBLIC_SITE_URL:?PUBLIC_SITE_URL must be set in ${ENV_FILE}}"
: "${PUBLIC_MEDUSA_BACKEND_URL:?PUBLIC_MEDUSA_BACKEND_URL must be set in ${ENV_FILE}}"

for app_env_name in "${DEPLOY_APP_ENV_ALLOWLIST[@]}"; do
	export -n "${app_env_name}" 2>/dev/null || true
done

deploy_load_caddy_env_file "${CADDY_ENV_FILE}"
: "${SITE_DOMAIN:?SITE_DOMAIN must be set in ${CADDY_ENV_FILE}}"
: "${GATE_USER:?GATE_USER must be set in ${CADDY_ENV_FILE}}"
: "${GATE_PASSWORD_HASH:?GATE_PASSWORD_HASH must be set in ${CADDY_ENV_FILE}}"
[[ "${GATE_USER}" =~ ^[A-Za-z0-9._-]{1,64}$ ]] \
	|| die "GATE_USER must contain only letters, digits, dot, underscore or dash."
[[ "${GATE_PASSWORD_HASH}" =~ ^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$ ]] \
	|| die "GATE_PASSWORD_HASH is not a supported bcrypt hash."
[[ "${SITE_GATED:-}" == "1" ]] \
	|| die "SITE_GATED must remain 1 until the separately approved launch."
[[ "${MAINTENANCE_CONFIG:-}" == "${APP_DIR}/maintenance.caddy" ]] \
	|| die "MAINTENANCE_CONFIG must be ${APP_DIR}/maintenance.caddy."
[[ "${CSP_CONFIG:-}" == "${APP_DIR}/csp-current" ]] \
	|| die "CSP_CONFIG must be ${APP_DIR}/csp-current."
SITE_DOMAIN_VALUE="${SITE_DOMAIN}"
GATE_USER_VALUE="${GATE_USER}"
unset ACME_EMAIL GATE_USER GATE_PASSWORD_HASH SITE_GATED SITE_DOMAIN \
	MAINTENANCE_CONFIG CSP_CONFIG

# ---------------------------------------------------------------------------
log "Resolving ${TARGET_SHA}"
# ---------------------------------------------------------------------------
git -C "${REPO_DIR}" -c core.hooksPath=/dev/null \
	fetch --quiet origin main --tags

FULL_SHA="$(git -C "${REPO_DIR}" rev-parse --verify \
	"${TARGET_SHA}^{commit}" 2>/dev/null)" \
	|| die "${TARGET_SHA} is not a commit in this repository."
[[ "${FULL_SHA}" =~ ^[0-9a-f]{40}$ ]] \
	|| die "Resolved commit is not a full hexadecimal SHA."
SOURCE_DATE_EPOCH="$(
	/usr/bin/env -i \
		PATH="${DEPLOY_TRUSTED_PATH}" \
		/usr/bin/git -C "${REPO_DIR}" -c core.hooksPath=/dev/null \
			show -s --format=%ct "${FULL_SHA}"
)" || die "Could not resolve the source commit timestamp."
[[ "${SOURCE_DATE_EPOCH}" =~ ^[1-9][0-9]{0,11}$ ]] \
	|| die "The source commit timestamp is malformed."

# Refuse anything that is not on origin/main — no feature branches, no stashes,
# no local-only commits.
if ! git -C "${REPO_DIR}" merge-base --is-ancestor \
	"${FULL_SHA}" origin/main; then
	die "${FULL_SHA} is not an ancestor of origin/main.
	     Deploy only commits that are merged to main and verified locally."
fi

validate_ops_release() {
	local ops_release="$1" expected_sha="${2:-${FULL_SHA}}"
	local unexpected_path

	[[ -f "${ops_release}/.commit" && ! -L "${ops_release}/.commit" ]] \
		|| die "Operational bundle is missing its commit marker."
	[[ "$(<"${ops_release}/.commit")" == "${expected_sha}" ]] \
		|| die "Operational bundle commit marker does not match ${expected_sha}."
	[[ -f "${ops_release}/deploy/deploy.sh" ]] \
		|| die "Operational bundle is missing deploy.sh."
	[[ -f "${ops_release}/deploy/OPS_PROTOCOL" \
		&& ! -L "${ops_release}/deploy/OPS_PROTOCOL" ]] \
		|| die "Operational bundle is missing its security protocol marker."
	[[ "$(<"${ops_release}/deploy/OPS_PROTOCOL")" == \
		"${OPS_PROTOCOL_VALUE}" ]] \
		|| die "Operational bundle predates the required security protocol."
	[[ -f "${ops_release}/deploy/lib/env-file.sh" ]] \
		|| die "Operational bundle is missing its environment parser."
	for required_ops_file in \
		lib/state.sh \
		lib/recovery.sh \
		lib/build-boundary.sh \
		medusa.service \
		medusa-migrate.service \
		medusa-candidate@.service \
		peptides-deploy-guard@.service \
		peptides-activation-watchdog@.service \
		activation-fail-closed.sh \
		Caddyfile \
		maintenance.on.caddy \
		verify-release.sh \
		build-csp.mjs \
		build-identity.mjs \
		build-resolv.conf \
		bootstrap-site/index.html
	do
		[[ -f "${ops_release}/deploy/${required_ops_file}" ]] \
			|| die "Operational bundle is missing ${required_ops_file}."
	done
	unexpected_path="$(find "${ops_release}" ! -user root -print -quit)"
	[[ -z "${unexpected_path}" ]] \
		|| die "Operational bundle contains a non-root-owned path."
	unexpected_path="$(find "${ops_release}" -perm /022 -print -quit)"
	[[ -z "${unexpected_path}" ]] \
		|| die "Operational bundle contains a writable path."
	unexpected_path="$(find "${ops_release}" -type l -print -quit)"
	[[ -z "${unexpected_path}" ]] \
		|| die "Operational bundle contains a symbolic link."
}

OPS_RELEASE="${OPS_DIR}/${FULL_SHA}"
if [[ -e "${OPS_RELEASE}" ]]; then
	validate_ops_release "${OPS_RELEASE}"
else
	OPS_STAGING="$(mktemp -d "${OPS_DIR}/${FULL_SHA}.XXXXXX")"
	/usr/bin/env -i \
		PATH="${DEPLOY_TRUSTED_PATH}" \
		/usr/bin/git -C "${REPO_DIR}" -c core.hooksPath=/dev/null \
			archive --format=tar "${FULL_SHA}" deploy \
		| /usr/bin/env -i \
			PATH="${DEPLOY_TRUSTED_PATH}" \
			/usr/bin/tar --extract --file=- \
				--directory="${OPS_STAGING}" \
				--no-same-owner --no-same-permissions
	unexpected_ops_path="$(
		find "${OPS_STAGING}" -type l -print -quit
	)"
	[[ -z "${unexpected_ops_path}" ]] \
		|| die "Target operational bundle contains a symbolic link."
	printf '%s\n' "${FULL_SHA}" >"${OPS_STAGING}/.commit"
	chown -R root:root "${OPS_STAGING}"
	chmod -R u=rwX,go=rX "${OPS_STAGING}"
	chmod -R a-w "${OPS_STAGING}"
	mv "${OPS_STAGING}" "${OPS_RELEASE}"
	OPS_STAGING=""
	validate_ops_release "${OPS_RELEASE}"
fi

# The already-activated runner remains in control for this deployment. Target
# operational files are candidates, not executable root orchestration, until
# the complete application release passes external verification. This prevents
# a rollback target from reintroducing a historical unsafe deploy.sh.
RUNNER_OPS_RELEASE="$(builtin cd -- "${SCRIPT_DIR}/.." && builtin pwd -P)"
RUNNER_SHA="$(basename "${RUNNER_OPS_RELEASE}")"
[[ "$(dirname "${RUNNER_OPS_RELEASE}")" == "${OPS_DIR}" \
	&& "${RUNNER_SHA}" =~ ^[0-9a-f]{40}$ ]] \
	|| die "Run deploy.sh only from the activated immutable ops-current bundle."
validate_ops_release "${RUNNER_OPS_RELEASE}" "${RUNNER_SHA}"
CANDIDATE_SCRIPT_DIR="${OPS_RELEASE}/deploy"

echo "Deploying ${FULL_SHA}"

run_as_build() {
	local working_directory="$1"
	shift

	deploy_run_contained_build \
		"${BUILD_USER}" "${BUILD_WORKSPACE}" "${working_directory}" "$@"
}

write_storefront_build_env() {
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

compute_build_identity() {
	local mode="${1:-}" snapshot_path="${2:-}"
	local -a identity_arguments=()

	[[ "$#" -le 2 ]] || return 2
	case "${mode}" in
	"")
		[[ -z "${snapshot_path}" ]] || return 2
		;;
	--capture-snapshot | --from-snapshot)
		[[ -n "${snapshot_path}" ]] || return 2
		identity_arguments=("${mode}" "${snapshot_path}")
		;;
	*)
		return 2
		;;
	esac

	run_as_build "${BUILD_WORKSPACE}" \
		/usr/bin/env \
			PUBLIC_SITE_URL="${PUBLIC_SITE_URL}" \
			PUBLIC_MEDUSA_BACKEND_URL="${PUBLIC_MEDUSA_BACKEND_URL}" \
			PUBLIC_MEDUSA_PUBLISHABLE_KEY="${PUBLIC_MEDUSA_PUBLISHABLE_KEY}" \
			PUBLIC_BANK_ACCOUNT_HOLDER="${PUBLIC_BANK_ACCOUNT_HOLDER:-}" \
			PUBLIC_BANK_IBAN="${PUBLIC_BANK_IBAN:-}" \
			PUBLIC_BANK_BIC="${PUBLIC_BANK_BIC:-}" \
			PUBLIC_BANK_NAME="${PUBLIC_BANK_NAME:-}" \
			PUBLIC_GA_MEASUREMENT_ID="${PUBLIC_GA_MEASUREMENT_ID:-}" \
			PUBLIC_GOOGLE_SITE_VERIFICATION="${PUBLIC_GOOGLE_SITE_VERIFICATION:-}" \
			PEPTIDES_BUILD_NODE_VERSION="${BUILD_NODE_VERSION}" \
			PEPTIDES_BUILD_NPM_VERSION="${BUILD_NPM_VERSION}" \
			PEPTIDES_BUILD_PLATFORM="${BUILD_PLATFORM}" \
			PEPTIDES_BUILD_LIBC_VERSION="${BUILD_LIBC_VERSION}" \
			/usr/bin/node "${CANDIDATE_SCRIPT_DIR}/build-identity.mjs" \
			"${identity_arguments[@]}"
}

validate_release() {
	local release="$1"
	local unexpected_path

	[[ -f "${release}/.complete" ]] \
		|| die "Release is missing its completion marker: ${release}"
	[[ ! -L "${release}/.complete" ]] \
		|| die "Release completion marker must not be a symbolic link."
	[[ "$(<"${release}/.complete")" == "${RELEASE_ID}" ]] \
		|| die "Release completion marker does not match ${RELEASE_ID}."
	[[ -f "${release}/.commit" && ! -L "${release}/.commit" ]] \
		|| die "Release is missing its commit marker."
	[[ "$(<"${release}/.commit")" == "${FULL_SHA}" ]] \
		|| die "Release commit marker does not match ${FULL_SHA}."
	[[ -f "${release}/.identity" && ! -L "${release}/.identity" ]] \
		|| die "Release is missing its build-identity marker."
	[[ "$(<"${release}/.identity")" == "${BUILD_IDENTITY}" ]] \
		|| die "Release build identity does not match current public inputs."
	[[ -f "${release}/.artifact-digest" \
		&& ! -L "${release}/.artifact-digest" ]] \
		|| die "Release is missing its generated-artifact digest."
	[[ "$(<"${release}/.artifact-digest")" == "${ARTIFACT_DIGEST}" ]] \
		|| die "Release artifact digest marker does not match its name."
	VALIDATED_ARTIFACT_DIGEST="$(
		deploy_hash_release_artifact "${release}"
	)" || die "Release generated-artifact digest could not be recomputed."
	[[ "${VALIDATED_ARTIFACT_DIGEST}" == "${ARTIFACT_DIGEST}" ]] \
		|| die "Release generated output does not match its digest."
	unset VALIDATED_ARTIFACT_DIGEST
	[[ -f "${release}/.catalog-snapshot.json" \
		&& ! -L "${release}/.catalog-snapshot.json" ]] \
		|| die "Release is missing its immutable catalog snapshot."
	[[ "$(stat -c '%a' "${release}/.catalog-snapshot.json")" == "444" ]] \
		|| die "Release catalog snapshot has an unsafe mode."
	RELEASE_SNAPSHOT_IDENTITY="$(
		compute_build_identity \
			--from-snapshot "${release}/.catalog-snapshot.json"
	)" || die "Release catalog snapshot failed identity validation."
	[[ "${RELEASE_SNAPSHOT_IDENTITY}" == "${BUILD_IDENTITY}" ]] \
		|| die "Release catalog snapshot does not match its identity."
	unset RELEASE_SNAPSHOT_IDENTITY
	[[ -f "${release}/backend/package-lock.json" ]] \
		|| die "Release is missing the backend production lock."
	[[ -f "${release}/backend/node_modules/@medusajs/cli/cli.js" ]] \
		|| die "Release is missing the installed Medusa CLI."
	[[ -L "${release}/backend/apps/backend/.medusa/server/static" ]] \
		|| die "Release is missing the runtime-state static-file link."
	[[ "$(readlink "${release}/backend/apps/backend/.medusa/server/static")" == \
		"/var/lib/peptides/static" ]] \
		|| die "Release static-file link points outside the runtime-state contract."
	[[ -f "${release}/storefront/index.html" ]] \
		|| die "Release is missing storefront/index.html."
	[[ -f "${release}/csp.caddy" ]] \
		|| die "Release is missing csp.caddy."
	[[ -f "${release}/csp-report-only.caddy" ]] \
		|| die "Release is missing its report-only CSP evidence."

	unexpected_path="$(find -P "${release}" ! -user root -print -quit)"
	[[ -z "${unexpected_path}" ]] \
		|| die "Release contains a non-root-owned path: ${unexpected_path}"
	deploy_validate_promoted_tree \
		"${release}" \
		"${release}/backend/apps/backend/.medusa/server/static" \
		|| die "Release filesystem validation failed: ${release}"
	deploy_validate_csp_import "${release}/csp.caddy" enforce \
		|| die "Release enforced CSP validation failed."
	deploy_validate_csp_import \
		"${release}/csp-report-only.caddy" report-only \
		|| die "Release report-only CSP validation failed."
}

: "${PUBLIC_MEDUSA_PUBLISHABLE_KEY:?The publishable key is required for a complete release build.}"
[[ "${PUBLIC_SITE_URL}" == "https://${SITE_DOMAIN_VALUE}" ]] \
	|| die "PUBLIC_SITE_URL must be https://${SITE_DOMAIN_VALUE} in production."
[[ "${PUBLIC_MEDUSA_BACKEND_URL}" == \
	"https://api.${SITE_DOMAIN_VALUE}" ]] \
	|| die "PUBLIC_MEDUSA_BACKEND_URL must be https://api.${SITE_DOMAIN_VALUE} in production."

BUILD_WORKSPACE="$(mktemp -d "${BUILD_DIR}/${FULL_SHA}.XXXXXX")"
chown "${BUILD_USER}:${BUILD_USER}" "${BUILD_WORKSPACE}"
install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 \
	"${BUILD_WORKSPACE}/home" \
	"${BUILD_WORKSPACE}/cache" \
		"${BUILD_WORKSPACE}/tmp" \
		"${BUILD_WORKSPACE}/npm-cache"

BUILD_NODE_VERSION="$(
	run_as_build "${BUILD_WORKSPACE}" /usr/bin/node --version
)" || die "Could not determine the contained Node.js version."
BUILD_NPM_VERSION="$(
	run_as_build "${BUILD_WORKSPACE}" /usr/bin/npm --version
)" || die "Could not determine the contained npm version."
BUILD_PLATFORM="$(/usr/bin/uname -s)-$(/usr/bin/uname -m)" \
	|| die "Could not determine the build platform."
BUILD_LIBC_VERSION="$(/usr/bin/getconf GNU_LIBC_VERSION)" \
	|| die "Could not determine the build C library version."
for build_tool_value in \
	"${BUILD_NODE_VERSION}" \
	"${BUILD_NPM_VERSION}" \
	"${BUILD_PLATFORM}" \
	"${BUILD_LIBC_VERSION}"
do
	[[ -n "${build_tool_value}" \
		&& "${#build_tool_value}" -le 256 \
		&& "${build_tool_value}" != *$'\n'* \
		&& "${build_tool_value}" != *$'\r'* ]] \
		|| die "A build toolchain identity value is malformed."
done
unset build_tool_value

WRITABLE_CATALOG_SNAPSHOT="${BUILD_WORKSPACE}/catalog-snapshot.json"
BUILD_IDENTITY="$(
	compute_build_identity \
		--capture-snapshot "${WRITABLE_CATALOG_SNAPSHOT}"
)" \
	|| die "Could not compute the authoritative storefront build identity."
[[ "${BUILD_IDENTITY}" =~ ^[0-9a-f]{64}$ ]] \
	|| die "The storefront build identity is malformed."
[[ -f "${WRITABLE_CATALOG_SNAPSHOT}" \
	&& ! -L "${WRITABLE_CATALOG_SNAPSHOT}" \
	&& "$(stat -c '%U:%G' "${WRITABLE_CATALOG_SNAPSHOT}")" == \
		"${BUILD_USER}:${BUILD_USER}" \
	&& "$(stat -c '%h' "${WRITABLE_CATALOG_SNAPSHOT}")" == "1" ]] \
	|| die "The captured catalog snapshot is not a safe build-owned file."
CATALOG_SNAPSHOT_BYTES="$(
	stat -c '%s' "${WRITABLE_CATALOG_SNAPSHOT}"
)" || die "Could not size the captured catalog snapshot."
[[ "${CATALOG_SNAPSHOT_BYTES}" =~ ^[1-9][0-9]*$ \
	&& "${CATALOG_SNAPSHOT_BYTES}" -le 67108864 ]] \
	|| die "The captured catalog snapshot has an unsafe size."
unset CATALOG_SNAPSHOT_BYTES
deploy_build_user_has_processes "${BUILD_USER}" \
	&& die "The catalog capture retained an untrusted build process."

CATALOG_SNAPSHOT_DIR="$(
	mktemp -d "${BUILD_DIR}/catalog-${FULL_SHA}.XXXXXX"
)" || die "Could not allocate trusted catalog snapshot staging."
chown root:root "${CATALOG_SNAPSHOT_DIR}"
chmod 0755 "${CATALOG_SNAPSHOT_DIR}"
CATALOG_SNAPSHOT="${CATALOG_SNAPSHOT_DIR}/catalog.json"
/usr/bin/dd \
	"if=${WRITABLE_CATALOG_SNAPSHOT}" \
	"of=${CATALOG_SNAPSHOT}" \
	iflag=fullblock,nofollow oflag=excl,nofollow status=none \
	|| die "Could not promote the captured catalog snapshot."
chown root:root "${CATALOG_SNAPSHOT}"
chmod 0444 "${CATALOG_SNAPSHOT}"
sync -f "${CATALOG_SNAPSHOT}"
sync -f "${CATALOG_SNAPSHOT_DIR}"
PROMOTED_SNAPSHOT_IDENTITY="$(
	compute_build_identity --from-snapshot "${CATALOG_SNAPSHOT}"
)" || die "The promoted catalog snapshot failed validation."
[[ "${PROMOTED_SNAPSHOT_IDENTITY}" == "${BUILD_IDENTITY}" ]] \
	|| die "The promoted catalog snapshot changed identity."
unset PROMOTED_SNAPSHOT_IDENTITY

# ---------------------------------------------------------------------------
log "Building immutable release for ${FULL_SHA}  (expect 8-17 min)"
# ---------------------------------------------------------------------------
install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 \
	"${BUILD_WORKSPACE}/source" \
	"${BUILD_WORKSPACE}/release" \
	"${BUILD_WORKSPACE}/release/backend/apps/backend/.medusa" \
	"${BUILD_WORKSPACE}/release/storefront"

/usr/bin/env -i \
	PATH="${DEPLOY_TRUSTED_PATH}" \
	/usr/bin/git -C "${REPO_DIR}" -c core.hooksPath=/dev/null \
		archive --format=tar "${FULL_SHA}" \
	| run_as_build "${BUILD_WORKSPACE}/source" \
		/usr/bin/tar --extract --file=- \
			--no-same-owner --no-same-permissions

BACKEND_SOURCE="${BUILD_WORKSPACE}/source/backend"
BACKEND_APP_SOURCE="${BACKEND_SOURCE}/apps/backend"
run_as_build "${BACKEND_SOURCE}" \
	/usr/bin/npm ci --no-audit --no-fund
run_as_build "${BACKEND_SOURCE}" \
	/usr/bin/env NODE_ENV=development \
	"${BACKEND_SOURCE}/node_modules/.bin/turbo" \
	run build --filter=@dtc/backend

BUILD_OUTPUT="${BACKEND_APP_SOURCE}/.medusa/server"
[[ -d "${BUILD_OUTPUT}" ]] \
	|| die "Medusa build produced no generated server."
cmp -s "${BACKEND_APP_SOURCE}/package.json" \
	"${BUILD_OUTPUT}/package.json" \
	|| die "Generated Medusa package manifest diverges from the lock-backed workspace manifest."

ARTIFACT="${BUILD_WORKSPACE}/release"
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

STOREFRONT_SOURCE="${BUILD_WORKSPACE}/source/storefront"
write_storefront_build_env "${STOREFRONT_SOURCE}/.env"
run_as_build "${STOREFRONT_SOURCE}" \
	/usr/bin/npm ci --no-audit --no-fund
run_as_build "${STOREFRONT_SOURCE}" \
	/usr/bin/env \
		SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH}" \
		MEDUSA_BUILD_SNAPSHOT_FILE="${CATALOG_SNAPSHOT}" \
		MEDUSA_BUILD_SNAPSHOT_REQUIRED=1 \
		/usr/bin/npm run build
[[ -f "${STOREFRONT_SOURCE}/dist/index.html" ]] \
	|| die "Storefront build produced no dist/index.html."
run_as_build "${ARTIFACT}/storefront" \
	/usr/bin/cp -a "${STOREFRONT_SOURCE}/dist/." \
		"${ARTIFACT}/storefront/"
run_as_build "${BUILD_WORKSPACE}" \
	/usr/bin/node \
	"${CANDIDATE_SCRIPT_DIR}/build-csp.mjs" \
	"${ARTIFACT}/storefront" \
	"${ARTIFACT}/csp.caddy"
run_as_build "${BUILD_WORKSPACE}" \
	/usr/bin/node \
	"${CANDIDATE_SCRIPT_DIR}/build-csp.mjs" \
	--report-only \
	"${ARTIFACT}/storefront" \
	"${ARTIFACT}/csp-report-only.caddy"

POST_BUILD_IDENTITY="$(
	compute_build_identity --from-snapshot "${CATALOG_SNAPSHOT}"
)" || die "Could not re-check the storefront build identity."
[[ "${POST_BUILD_IDENTITY}" == "${BUILD_IDENTITY}" ]] \
	|| die "The immutable catalog snapshot changed during the storefront build."
unset POST_BUILD_IDENTITY

if deploy_build_user_has_processes "${BUILD_USER}"; then
	die "The build identity retained a process before artifact promotion."
fi
ROOT_STAGING="$(
	mktemp -d "${BUILD_DIR}/promote-${FULL_SHA}.XXXXXX"
)"
chown root:root "${ROOT_STAGING}"
chmod 0700 "${ROOT_STAGING}"
deploy_promote_release_tree \
	"${ARTIFACT}" "${ROOT_STAGING}" "${FULL_SHA}" \
	|| die "Could not safely promote the unprivileged build artifact."
install -o root -g root -m 0444 \
	"${CATALOG_SNAPSHOT}" \
	"${ROOT_STAGING}/.catalog-snapshot.json"
printf '%s\n' "${BUILD_IDENTITY}" >"${ROOT_STAGING}/.identity"
chown root:root "${ROOT_STAGING}/.identity"
chmod 0444 "${ROOT_STAGING}/.commit" "${ROOT_STAGING}/.identity"

ARTIFACT_DIGEST="$(
	deploy_hash_release_artifact "${ROOT_STAGING}"
)" || die "Could not hash the promoted generated artifact."
[[ "${ARTIFACT_DIGEST}" =~ ^[0-9a-f]{64}$ ]] \
	|| die "The generated-artifact digest is malformed."
RELEASE_ID="${FULL_SHA}-${BUILD_IDENTITY}-${ARTIFACT_DIGEST}"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"
printf '%s\n' "${ARTIFACT_DIGEST}" >"${ROOT_STAGING}/.artifact-digest"
printf '%s\n' "${RELEASE_ID}" >"${ROOT_STAGING}/.complete"
chown root:root \
	"${ROOT_STAGING}/.artifact-digest" "${ROOT_STAGING}/.complete"
chmod 0444 \
	"${ROOT_STAGING}/.artifact-digest" "${ROOT_STAGING}/.complete"
deploy_validate_promoted_tree \
	"${ROOT_STAGING}" \
	"${ROOT_STAGING}/backend/apps/backend/.medusa/server/static" \
	|| die "Promoted release failed final filesystem validation."
validate_release "${ROOT_STAGING}"

if [[ -e "${RELEASE_DIR}" ]]; then
	validate_release "${RELEASE_DIR}"
	rm -rf -- "${ROOT_STAGING}"
	ROOT_STAGING=""
	echo "Reusing byte-identical immutable release ${RELEASE_ID}."
else
	mv "${ROOT_STAGING}" "${RELEASE_DIR}"
	sync -f "${RELEASES_DIR}"
	ROOT_STAGING=""
	validate_release "${RELEASE_DIR}"
fi
cleanup_catalog_snapshot \
	|| die "Could not remove trusted catalog snapshot staging."
set_deploy_phase "${PHASE_BUILT}"

validate_caddy_config() {
	local caddyfile="$1" csp_file="$2"

	(
		deploy_sanitize_environment
		deploy_load_caddy_env_file "${CADDY_ENV_FILE}"
		[[ "${SITE_GATED:-}" == "1" ]] || exit 1
		CSP_CONFIG="${csp_file}"
		export CSP_CONFIG
		caddy validate --config "${caddyfile}" --adapter caddyfile \
			>/dev/null 2>&1
	)
}

reload_caddy() {
	validate_caddy_config /etc/caddy/Caddyfile "${CSP_CURRENT}" \
		|| return 1
	systemctl reload-or-restart caddy
}

set_maintenance() {
	local state="$1" source temporary

	case "${state}" in
		on)
			source="${SCRIPT_DIR}/maintenance.on.caddy"
			;;
		off)
			source="${SCRIPT_DIR}/maintenance.off.caddy"
			;;
		*)
			return 2
			;;
	esac

	temporary="$(mktemp "${APP_DIR}/.maintenance.XXXXXX")" || return
	if ! install -o root -g caddy -m 0644 \
		"${source}" "${temporary}"; then
		unlink "${temporary}" 2>/dev/null || true
		return 1
	fi
	mv -Tf "${temporary}" "${MAINTENANCE_CONFIG}" || {
		unlink "${temporary}" 2>/dev/null || true
		return 1
	}
	sync -f "${APP_DIR}" || return
	reload_caddy || return
	[[ "${state}" == "on" ]] && MAINTENANCE_ENTERED=1 \
		|| MAINTENANCE_ENTERED=0
	return 0
}

force_maintenance_fail_closed() {
	local temporary

	temporary="$(mktemp "${APP_DIR}/.maintenance-emergency.XXXXXX")" \
		|| {
			systemctl stop caddy >/dev/null 2>&1 || true
			return 1
		}
	if install -o root -g caddy -m 0644 \
		"${SCRIPT_DIR}/maintenance.on.caddy" "${temporary}" \
		&& mv -Tf "${temporary}" "${MAINTENANCE_CONFIG}" \
		&& sync -f "${APP_DIR}" \
		&& reload_caddy >/dev/null 2>&1; then
		MAINTENANCE_ENTERED=1
		return 0
	fi
	unlink "${temporary}" >/dev/null 2>&1 || true
	systemctl stop caddy >/dev/null 2>&1 || true
	warn "Maintenance could not be proven; Caddy was stopped fail-closed."
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
	return 0
}

start_activation_watchdog() {
	ACTIVATION_WATCHDOG_UNIT="peptides-activation-watchdog@$$.service"
	systemctl reset-failed "${ACTIVATION_WATCHDOG_UNIT}" \
		>/dev/null 2>&1 || true
	systemctl start "${ACTIVATION_WATCHDOG_UNIT}" || return 1
	systemctl is-active --quiet "${ACTIVATION_WATCHDOG_UNIT}"
}

stop_activation_watchdog() {
	[[ -n "${ACTIVATION_WATCHDOG_UNIT}" ]] || return 0
	deploy_stop_and_prove_unit "${ACTIVATION_WATCHDOG_UNIT}" || return 1
	ACTIVATION_WATCHDOG_UNIT=""
}

wait_for_backend_health() {
	local attempts="${1:-60}"
	local _

	for _ in $(seq 1 "${attempts}"); do
		if "${SCRIPT_DIR}/verify-release.sh" \
			backend "${SITE_DOMAIN_VALUE}" >/dev/null 2>&1; then
			return 0
		fi
		sleep 3
	done
	return 1
}

capture_control_file() {
	local target="$1" name="$2"

	if [[ -e "${target}" || -L "${target}" ]]; then
		[[ -f "${target}" && ! -L "${target}" ]] \
			|| die "Control file ${target} must be a regular, non-symlink file."
		cp --preserve=mode,ownership,timestamps \
			"${target}" "${CONTROL_SNAPSHOT}/${name}"
	else
		: >"${CONTROL_SNAPSHOT}/${name}.absent"
	fi
}

snapshot_controls() {
	[[ -z "${CONTROL_SNAPSHOT}" ]] \
		|| die "A control-file snapshot already exists for this deploy."

	CONTROL_SNAPSHOT="$(
		mktemp -d "${CONTROL_SNAPSHOT_DIR}/${FULL_SHA}.XXXXXX"
	)" || return
	chown root:root "${CONTROL_SNAPSHOT}" || return
	chmod 0700 "${CONTROL_SNAPSHOT}" || return

	capture_control_file /etc/caddy/Caddyfile caddy || return
	capture_control_file /etc/systemd/system/medusa.service medusa || return
	capture_control_file \
		/etc/systemd/system/medusa-migrate.service medusa-migrate || return
	capture_control_file \
		/etc/systemd/system/medusa-candidate@.service medusa-candidate \
		|| return
	capture_control_file \
		/etc/systemd/system/peptides-deploy-guard@.service deploy-guard \
		|| return
	capture_control_file \
		/etc/systemd/system/peptides-activation-watchdog@.service \
		activation-watchdog || return
	capture_control_file \
		/etc/systemd/system/peptides-backup.service peptides-backup || return
	capture_control_file \
		/etc/systemd/system/peptides-backup.timer peptides-backup-timer || return
	capture_control_file "${MAINTENANCE_CONFIG}" maintenance || return
	sync -f "${CONTROL_SNAPSHOT}" || return
	sync -f "${CONTROL_SNAPSHOT_DIR}" || return
}

restore_control_file() {
	local target="$1" name="$2"

	if [[ -f "${CONTROL_SNAPSHOT}/${name}.absent" ]]; then
		rm -f -- "${target}"
		return
	fi
	[[ -f "${CONTROL_SNAPSHOT}/${name}" ]] || return 1
	cp --preserve=mode,ownership,timestamps \
		"${CONTROL_SNAPSHOT}/${name}" "${target}.restore"
	mv -Tf "${target}.restore" "${target}"
}

restore_controls() {
	[[ -n "${CONTROL_SNAPSHOT}" ]] || return 1
	case "${CONTROL_SNAPSHOT}" in
		"${CONTROL_SNAPSHOT_DIR}/${FULL_SHA}."*)
			;;
		*)
			warn "Refusing to restore from an unexpected control snapshot path."
			return 1
			;;
	esac

	restore_control_file "${MAINTENANCE_CONFIG}" maintenance || return 1
	restore_control_file /etc/caddy/Caddyfile caddy || return 1
	restore_control_file /etc/systemd/system/medusa.service medusa || return 1
	restore_control_file \
		/etc/systemd/system/medusa-migrate.service medusa-migrate || return 1
	restore_control_file \
		/etc/systemd/system/medusa-candidate@.service medusa-candidate \
		|| return 1
	restore_control_file \
		/etc/systemd/system/peptides-deploy-guard@.service deploy-guard \
		|| return 1
	restore_control_file \
		/etc/systemd/system/peptides-activation-watchdog@.service \
		activation-watchdog || return 1
	restore_control_file \
		/etc/systemd/system/peptides-backup.service peptides-backup || return 1
	restore_control_file \
		/etc/systemd/system/peptides-backup.timer peptides-backup-timer || return 1

	systemctl daemon-reload || return 1
	return 0
}

remove_control_snapshot() {
	[[ -n "${CONTROL_SNAPSHOT}" ]] || return 0
	case "${CONTROL_SNAPSHOT}" in
		"${CONTROL_SNAPSHOT_DIR}/${FULL_SHA}."*)
			rm -rf -- "${CONTROL_SNAPSHOT}"
			CONTROL_SNAPSHOT=""
			;;
		*)
			warn "Refusing to remove an unexpected control snapshot path."
			return 1
			;;
	esac
}

install_candidate_controls_in_maintenance() {
	local maintenance_temporary

	snapshot_controls || return
	CONTROLS_INSTALLED=1

	maintenance_temporary="$(
		mktemp "${APP_DIR}/.maintenance-candidate.XXXXXX"
	)" || return
	if ! install -o root -g caddy -m 0644 \
		"${SCRIPT_DIR}/maintenance.on.caddy" \
		"${maintenance_temporary}"; then
		unlink "${maintenance_temporary}" 2>/dev/null || true
		return 1
	fi
	mv -Tf "${maintenance_temporary}" "${MAINTENANCE_CONFIG}" || {
		unlink "${maintenance_temporary}" 2>/dev/null || true
		return 1
	}

	install -m 0644 "${CANDIDATE_SCRIPT_DIR}/medusa.service" \
		/etc/systemd/system/medusa.service || return
	install -m 0644 "${CANDIDATE_SCRIPT_DIR}/medusa-migrate.service" \
		/etc/systemd/system/medusa-migrate.service || return
	install -m 0644 "${CANDIDATE_SCRIPT_DIR}/medusa-candidate@.service" \
		/etc/systemd/system/medusa-candidate@.service || return
	install -m 0644 \
		"${CANDIDATE_SCRIPT_DIR}/peptides-deploy-guard@.service" \
		/etc/systemd/system/peptides-deploy-guard@.service || return
	install -m 0644 \
		"${CANDIDATE_SCRIPT_DIR}/peptides-activation-watchdog@.service" \
		/etc/systemd/system/peptides-activation-watchdog@.service || return
	install -m 0644 "${CANDIDATE_SCRIPT_DIR}/peptides-backup.service" \
		/etc/systemd/system/peptides-backup.service || return
	install -m 0644 "${CANDIDATE_SCRIPT_DIR}/peptides-backup.timer" \
		/etc/systemd/system/peptides-backup.timer || return
	install -m 0644 "${CANDIDATE_SCRIPT_DIR}/Caddyfile" \
		/etc/caddy/Caddyfile \
		|| return

	sync -f "${MAINTENANCE_CONFIG}" || return
	sync -f "${APP_DIR}" || return
	sync -f /etc/caddy/Caddyfile || return
	sync -f /etc/caddy || return
	sync -f /etc/systemd/system || return
	systemctl daemon-reload || return
	reload_caddy || return
	MAINTENANCE_ENTERED=1
	return 0
}

cleanup_deploy() {
	local status="$?" RESTORE_SUCCEEDED=0
	trap - EXIT
	set +e

	deploy_stop_transient_build
	cleanup_catalog_snapshot \
		|| warn "Could not clean trusted catalog snapshot staging."
	if [[ -n "${BUILD_WORKSPACE}" ]]; then
		case "${BUILD_WORKSPACE}" in
			"${BUILD_DIR}/${FULL_SHA}."*)
				rm -rf -- "${BUILD_WORKSPACE}"
				;;
			*)
				warn "Refusing to clean unexpected build path."
				;;
		esac
	fi
	if [[ -n "${ROOT_STAGING}" ]]; then
		case "${ROOT_STAGING}" in
			"${BUILD_DIR}/promote-${FULL_SHA}."*)
				rm -rf -- "${ROOT_STAGING}"
				;;
			*)
				warn "Refusing to clean unexpected root promotion staging."
				;;
		esac
	fi
	if [[ -n "${OPS_STAGING}" ]]; then
		case "${OPS_STAGING}" in
			"${OPS_DIR}/${FULL_SHA}."*)
				rm -rf -- "${OPS_STAGING}"
				;;
			*)
				warn "Refusing to clean unexpected operational staging path."
				;;
		esac
	fi

	if [[ "${status}" -ne 0 && "${DEPLOY_SUCCEEDED}" -ne 1 ]]; then
		if [[ "${MIGRATION_STARTED}" -eq 1 ]]; then
			stop_candidate_runtime \
				|| warn "Candidate control group did not stop cleanly."
			deploy_stop_and_prove_unit medusa.service \
				|| warn "The permanent backend did not stop cleanly."
			force_maintenance_fail_closed || true
			if ! deploy_recovery_write_operator_review \
				"${RECOVERY_REQUIRED}" "${CONTROL_SNAPSHOT_DIR}" \
				"${FULL_SHA}" "${DEPLOY_PHASE}"; then
				systemctl stop caddy >/dev/null 2>&1 || true
				warn "Could not durably record recovery; Caddy remains stopped."
			fi
			warn "Migration began; maintenance remains enabled. Old code was not reactivated."
		elif [[ "${CONTROLS_INSTALLED}" -eq 1 ]]; then
			if restore_controls \
				&& { [[ ! -L "${BACKEND_CURRENT}" ]] \
					|| { systemctl reset-failed medusa >/dev/null 2>&1 \
						&& systemctl start medusa \
						&& wait_for_backend_health 60; }; } \
				&& reload_caddy; then
				RESTORE_SUCCEEDED=1
				CONTROLS_INSTALLED=0
				MAINTENANCE_ENTERED=0
				remove_control_snapshot \
					|| warn "The restored control snapshot could not be removed."
			fi
			if [[ "${RESTORE_SUCCEEDED}" -ne 1 ]]; then
				force_maintenance_fail_closed || true
				if ! deploy_recovery_write_control_restore \
					"${RECOVERY_REQUIRED}" "${CONTROL_SNAPSHOT_DIR}" \
					"${FULL_SHA}" "${DEPLOY_PHASE}" \
					"${CONTROL_SNAPSHOT}"; then
					systemctl stop caddy >/dev/null 2>&1 || true
				fi
				warn "Could not restore the prior controls; operator review is required."
			fi
		fi
	fi

	exit "${status}"
}
trap cleanup_deploy EXIT

release_is_referenced() {
	local release="$1" pointer target release_name
	release_name="$(basename "${release}")"
	for pointer in \
		"${BACKEND_CURRENT}" \
		"${BACKEND_CANDIDATE}" \
		"${STOREFRONT_CURRENT}" \
		"${STOREFRONT_CANDIDATE}" \
		"${PREVIOUS_RELEASE}"
	do
		[[ -L "${pointer}" ]] || continue
		target="$(readlink -f "${pointer}")"
		case "${target}" in
			"${release}" | "${release}/"*)
				return 0
				;;
		esac
	done

	if [[ -f "${RECOVERY_REQUIRED}" ]] \
		&& grep -q "^sha=${release_name%%-*} " "${RECOVERY_REQUIRED}"; then
		return 0
	fi
	return 1
}

prune_old_releases() {
	local kept=0 release release_name

	while IFS= read -r release; do
		[[ -n "${release}" ]] || continue
		if release_is_referenced "${release}"; then
			continue
		fi
		if [[ "${kept}" -lt "${KEEP_RELEASES}" ]]; then
			kept=$((kept + 1))
			continue
		fi

		release_name="$(basename "${release}")"
		[[ "${release_name}" =~ ^[0-9a-f]{40}-[0-9a-f]{64}-[0-9a-f]{64}$ ]] \
			|| {
				warn "Refusing to prune unexpected release path ${release}."
				return 1
			}
		[[ "$(stat -c '%U:%G' "${release}")" == "root:root" ]] \
			|| {
				warn "Refusing to prune non-root-owned release ${release_name}."
				return 1
			}
		echo "  removing ${release_name}"
		rm -rf -- "${release}"
	done < <(
		find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d \
			-printf '%T@ %p\n' \
			| sort -nr \
			| cut -d' ' -f2-
	)
}

prune_local_snapshots() {
	local kept=0 snapshot snapshot_name

	while IFS= read -r snapshot; do
		[[ -n "${snapshot}" ]] || continue
		if [[ "${kept}" -lt 10 ]]; then
			kept=$((kept + 1))
			continue
		fi
		snapshot_name="$(basename "${snapshot}")"
		[[ "${snapshot_name}" =~ ^pre-migrate-[0-9a-f]{40}\.[A-Za-z0-9]{6}\.dump$ ]] \
			|| {
				warn "Refusing to prune unexpected snapshot path."
				return 1
			}
		[[ "$(stat -c '%U:%G' "${snapshot}")" == "root:root" ]] \
			|| {
				warn "Refusing to prune a non-root-owned snapshot."
				return 1
			}
		unlink "${snapshot}"
	done < <(
		find "${SNAPSHOT_DIR}" -mindepth 1 -maxdepth 1 -type f \
			-name 'pre-migrate-*.dump' -printf '%T@ %p\n' \
			| sort -nr \
			| cut -d' ' -f2-
	)
}

atomic_symlink "${RELEASE_DIR}/backend" "${BACKEND_CANDIDATE}"
atomic_symlink "${RELEASE_DIR}/storefront" "${STOREFRONT_CANDIDATE}"

validate_caddy_config \
	"${CANDIDATE_SCRIPT_DIR}/Caddyfile" \
	"${RELEASE_DIR}/csp.caddy" \
	|| die "Candidate Caddyfile or release CSP failed validation."

ASSET_FILE="$(
	find "${RELEASE_DIR}/storefront/_astro" \
		-maxdepth 1 -type f -print -quit 2>/dev/null || true
)"
ASSET_PATH=""
if [[ -n "${ASSET_FILE}" ]]; then
	ASSET_PATH="/_astro/$(basename "${ASSET_FILE}")"
fi

# A routine deploy proves the operator still knows the live gate credential
# before migrations make rollback an operator action. The first complete
# release follows the explicit backend bootstrap and has no storefront to
# authenticate against yet; it performs the same prompt immediately after
# activation while the database remains fail-closed behind maintenance.
if [[ -L "${STOREFRONT_CURRENT}" ]]; then
	log "Verifying the current gate credential before production mutation"
	"${SCRIPT_DIR}/verify-release.sh" \
		authenticated "${SITE_DOMAIN_VALUE}" "${GATE_USER_VALUE}" \
		|| die "Authenticated gate verification failed before maintenance."
	AUTHENTICATED_GATE_VERIFIED=1
else
	[[ -L "${BACKEND_CURRENT}" ]] \
		|| die "No active storefront exists. Run bootstrap-backend.sh first."
	BOOTSTRAP_BACKEND="$(readlink -f "${BACKEND_CURRENT}")"
	[[ "${BOOTSTRAP_BACKEND}" == \
		"${BOOTSTRAP_ROOT}/${FULL_SHA}/backend" ]] \
		|| die "The backend pointer is not an approved first-install bootstrap."
	[[ -f "${BOOTSTRAP_ROOT}/${FULL_SHA}/.complete" \
		&& ! -L "${BOOTSTRAP_ROOT}/${FULL_SHA}/.complete" \
		&& "$(<"${BOOTSTRAP_ROOT}/${FULL_SHA}/.complete")" == \
			"${FULL_SHA}" ]] \
		|| die "The first-install bootstrap marker is invalid."
	deploy_validate_promoted_tree \
		"${BOOTSTRAP_ROOT}/${FULL_SHA}" \
		"${BOOTSTRAP_BACKEND}/apps/backend/.medusa/server/static" \
		|| die "The first-install bootstrap artifact is not immutable."
	unset BOOTSTRAP_BACKEND
fi

# ---------------------------------------------------------------------------
log "Entering maintenance and stopping writes"
# ---------------------------------------------------------------------------
install_candidate_controls_in_maintenance \
	|| die "Could not install candidate controls in maintenance."
set_deploy_phase "${PHASE_MAINTENANCE}"
"${SCRIPT_DIR}/verify-release.sh" \
	maintenance "${SITE_DOMAIN_VALUE}" \
	|| die "Maintenance did not reject storefront and API writes."
"${SCRIPT_DIR}/verify-release.sh" \
	candidate "${SITE_DOMAIN_VALUE}" "${ASSET_PATH}" \
	|| die "Candidate storefront failed while maintenance was active."
log "Verifying the target gate while public maintenance remains active"
"${SCRIPT_DIR}/verify-release.sh" \
	authenticated-candidate \
	"${SITE_DOMAIN_VALUE}" "${GATE_USER_VALUE}" \
	|| die "Target gate verification failed under maintenance."
AUTHENTICATED_GATE_VERIFIED=1

MAINTENANCE_BUILD_IDENTITY="$(compute_build_identity)" \
	|| die "Could not re-check build inputs under maintenance."
[[ "${MAINTENANCE_BUILD_IDENTITY}" == "${BUILD_IDENTITY}" ]] \
	|| die "Catalog or public build inputs changed before write shutdown; rebuild required."
unset MAINTENANCE_BUILD_IDENTITY

deploy_stop_and_prove_unit medusa.service \
	|| die "Medusa did not drain completely after write shutdown."
set_deploy_phase "${PHASE_WRITES_STOPPED}"

# ---------------------------------------------------------------------------
log "Creating and verifying the pre-migration snapshot"
# ---------------------------------------------------------------------------
SNAPSHOT_FILE="$(
	mktemp "${SNAPSHOT_DIR}/pre-migrate-${FULL_SHA}.XXXXXX.dump"
)"
chmod 0600 "${SNAPSHOT_FILE}"
deploy_run_pg_command "${DATABASE_URL}" \
	/usr/bin/pg_dump --format=custom --no-password --file="${SNAPSHOT_FILE}"
[[ -s "${SNAPSHOT_FILE}" ]] || die "Pre-migration snapshot is empty."
/usr/bin/pg_restore --list "${SNAPSHOT_FILE}" >/dev/null \
	|| die "Pre-migration snapshot failed pg_restore validation."
set_deploy_phase "${PHASE_BACKUP_VERIFIED}"

# ---------------------------------------------------------------------------
log "Running candidate migrations  (expect 5-30 s)"
# ---------------------------------------------------------------------------
deploy_recovery_write_operator_review \
	"${RECOVERY_REQUIRED}" "${CONTROL_SNAPSHOT_DIR}" \
	"${FULL_SHA}" "${PHASE_MIGRATION_STARTED}" \
	|| die "Could not durably record migration recovery intent."
MIGRATION_STARTED=1
set_deploy_phase "${PHASE_MIGRATION_STARTED}"
systemctl reset-failed medusa-migrate >/dev/null 2>&1 || true
systemctl start medusa-migrate \
	|| die "Candidate migration failed. Maintenance remains enabled; inspect medusa-migrate logs."

# ---------------------------------------------------------------------------
log "Activating backend while maintenance remains enabled"
# ---------------------------------------------------------------------------
if [[ -L "${BACKEND_CURRENT}" ]]; then
	PREVIOUS_BACKEND="$(readlink -f "${BACKEND_CURRENT}")"
	case "${PREVIOUS_BACKEND}" in
		"${RELEASES_DIR}/"*/backend)
			atomic_symlink "${PREVIOUS_BACKEND%/backend}" "${PREVIOUS_RELEASE}"
			;;
	esac
fi
atomic_symlink "${RELEASE_DIR}/backend" "${BACKEND_CURRENT}"
start_candidate_runtime \
	|| die "The hidden migrated backend did not start."
wait_for_backend_health 60 \
	|| die "The migrated backend failed exact loopback health verification."

CANDIDATE_BUILD_IDENTITY="$(compute_build_identity)" \
	|| die "Could not compute build identity against the migrated candidate."
[[ "${CANDIDATE_BUILD_IDENTITY}" == "${BUILD_IDENTITY}" ]] \
	|| die "The migrated backend changes static storefront inputs; a matching rebuild is required."
unset CANDIDATE_BUILD_IDENTITY

stop_candidate_runtime \
	|| die "The hidden candidate backend did not stop cleanly."
deploy_recovery_remove \
	"${RECOVERY_REQUIRED}" "${CONTROL_SNAPSHOT_DIR}" "${APP_DIR}" \
	|| die "Could not durably commit the new backend pointer."
systemctl reset-failed medusa >/dev/null 2>&1 || true
systemctl start medusa \
	|| die "The committed migrated backend did not start."
wait_for_backend_health 60 \
	|| die "The committed backend failed exact loopback health verification."
set_deploy_phase "${PHASE_BACKEND_ACTIVATED}"
deploy_activation_write \
	"${ACTIVATION_REQUIRED}" "${APP_DIR}" "${FULL_SHA}" \
	|| die "Could not durably guard pending public activation."
start_activation_watchdog \
	|| die "Could not start the fail-closed activation watchdog."

# ---------------------------------------------------------------------------
log "Activating matching storefront and CSP"
# ---------------------------------------------------------------------------
atomic_symlink "${RELEASE_DIR}/storefront" "${STOREFRONT_CURRENT}"
atomic_symlink "${RELEASE_DIR}/csp.caddy" "${CSP_CURRENT}"
reload_caddy \
	|| die "Caddy rejected the activated storefront CSP. Maintenance remains enabled."
"${SCRIPT_DIR}/verify-release.sh" \
	candidate "${SITE_DOMAIN_VALUE}" "${ASSET_PATH}" \
	|| die "Activated storefront failed loopback virtual-host verification."
set_deploy_phase "${PHASE_STOREFRONT_ACTIVATED}"

set_maintenance off || die "Could not leave maintenance."
PUBLIC_VERIFICATION_FAILED=0
"${SCRIPT_DIR}/verify-release.sh" \
	external "${SITE_DOMAIN_VALUE}" "${ASSET_PATH}" \
	|| PUBLIC_VERIFICATION_FAILED=1
if [[ "${PUBLIC_VERIFICATION_FAILED}" -eq 0 \
	&& "${AUTHENTICATED_GATE_VERIFIED}" -eq 0 ]]; then
	"${SCRIPT_DIR}/verify-release.sh" \
		authenticated "${SITE_DOMAIN_VALUE}" "${GATE_USER_VALUE}" \
		|| PUBLIC_VERIFICATION_FAILED=1
fi
if [[ "${PUBLIC_VERIFICATION_FAILED}" -ne 0 ]]; then
	set_maintenance on >/dev/null 2>&1 || true
	MAINTENANCE_ENTERED=1
	die "Public verification failed; maintenance was re-enabled."
fi
set_deploy_phase "${PHASE_EXTERNAL_VERIFIED}"
atomic_symlink "${OPS_RELEASE}" "${OPS_CURRENT}" \
	|| die "Could not durably advance the operational control plane."
deploy_activation_remove \
	"${ACTIVATION_REQUIRED}" "${APP_DIR}" "${FULL_SHA}" \
	|| die "Could not durably commit externally verified activation."
stop_activation_watchdog \
	|| warn "Activation committed, but its inert watchdog needs cleanup."
DEPLOY_SUCCEEDED=1
MIGRATION_STARTED=0

remove_control_snapshot \
	|| warn "Application deployed, but its control snapshot needs cleanup."

log "Pruning unreferenced old releases (keeping ${KEEP_RELEASES})"
prune_old_releases \
	|| warn "Application deployed, but old release pruning needs attention."
prune_local_snapshots \
	|| warn "Application deployed, but local snapshot pruning needs attention."

log "Deployed and verified ${FULL_SHA}"
