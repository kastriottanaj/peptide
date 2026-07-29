#!/usr/bin/env bash
#
# Create, validate and upload one coherent database-and-upload snapshot.
#
# The scheduled systemd unit shares the deployment lock, stops Medusa for only
# the bounded local staging window, and leaves the existing Caddy/basic-auth
# gate untouched. The backend is restarted and health-checked before any slow
# off-host transfer. Configuration files are parsed as data through
# deploy/lib/env-file.sh; they are never sourced or evaluated.

set -euo pipefail
umask 077

SCRIPT_DIR="$(builtin cd "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"

# shellcheck source=lib/common.sh
builtin source "${SCRIPT_DIR}/lib/common.sh"
deploy_sanitize_environment
# shellcheck source=lib/env-file.sh
builtin source "${SCRIPT_DIR}/lib/env-file.sh"

backup_error() {
	deploy_error "$*"
}

backup_require_value() {
	local name="$1"
	local value="${!name-}"
	if [[ -z "${value}" ]]; then
		backup_error "${name} must be set"
		return 1
	fi
}

backup_mode_and_owner() {
	local file="$1"
	local owner
	local mode

	if owner="$(stat -c '%u' "${file}" 2>/dev/null)" &&
		mode="$(stat -c '%a' "${file}" 2>/dev/null)"; then
		:
	elif owner="$(stat -f '%u' "${file}" 2>/dev/null)" &&
		mode="$(stat -f '%Lp' "${file}" 2>/dev/null)"; then
		:
	else
		backup_error "${file}: cannot inspect owner and mode"
		return 1
	fi

	printf '%s %s\n' "${owner}" "${mode}"
}

backup_group_id() {
	local file="$1"
	local group_id=''

	if group_id="$(stat -c '%g' "${file}" 2>/dev/null)"; then
		:
	elif group_id="$(stat -f '%g' "${file}" 2>/dev/null)"; then
		:
	else
		backup_error "${file}: cannot inspect group ownership"
		return 1
	fi
	printf '%s\n' "${group_id}"
}

backup_require_private_file() {
	local file="$1"
	local expected_owner="$2"
	local owner_mode
	local owner
	local mode
	local mode_value

	if [[ ! -f "${file}" || -L "${file}" ]]; then
		backup_error "${file}: must be a regular, non-symlink file"
		return 1
	fi
	if [[ ! -r "${file}" ]]; then
		backup_error "${file}: is not readable"
		return 1
	fi

	owner_mode="$(backup_mode_and_owner "${file}")" || return 1
	owner="${owner_mode%% *}"
	mode="${owner_mode##* }"

	if [[ "${owner}" != "${expected_owner}" ]]; then
		backup_error "${file}: must be owned by the configured backup owner"
		return 1
	fi
	if [[ ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
		backup_error "${file}: has an unrecognized mode"
		return 1
	fi
	mode_value=$((8#${mode}))
	if (( (mode_value & 077) != 0 )); then
		backup_error "${file}: must not be readable or writable by group/other"
		return 1
	fi
}

backup_require_app_env() {
	local file="$1"
	local expected_owner="$2"
	local expected_group="$3"
	local expected_mode="$4"
	local owner_mode owner group_id mode

	if [[ ! -f "${file}" || -L "${file}" ]]; then
		backup_error "${file}: must be a regular, non-symlink file"
		return 1
	fi
	owner_mode="$(backup_mode_and_owner "${file}")" || return 1
	owner="${owner_mode%% *}"
	mode="${owner_mode##* }"
	group_id="$(backup_group_id "${file}")" || return 1
	if [[ "${owner}" != "${expected_owner}" ||
		"${group_id}" != "${expected_group}" ||
		"${mode}" != "${expected_mode}" ]]; then
		backup_error "${file}: application environment ownership or mode is unsafe"
		return 1
	fi
}

backup_refuse_recovery_markers() {
	local marker=''

	for marker in "${RECOVERY_REQUIRED}" "${ACTIVATION_REQUIRED}" \
		"${PROVISION_RECOVERY_REQUIRED}"; do
		if [[ -e "${marker}" || -L "${marker}" ]]; then
			backup_error \
				"recovery or activation marker exists; refusing a backup"
			return 1
		fi
	done
}

backup_require_remote_repository() {
	local file="$1"
	local repository=''
	local extra_line=''
	local normalized=''

	IFS= read -r repository <"${file}" || :
	if IFS= read -r extra_line; then
		backup_error "Restic repository file must contain exactly one line"
		return 1
	fi < <(sed -n '2p' "${file}")

	if [[ -z "${repository}" || "${repository}" == *$'\r'* ]]; then
		backup_error "Restic repository file is empty or malformed"
		return 1
	fi
	normalized="$(
		printf '%s' "${repository}" | LC_ALL=C tr '[:upper:]' '[:lower:]'
	)" || return 1

	if [[ "${normalized}" == *'http://'* ]]; then
		backup_error "Restic repository must use encrypted transport"
		return 1
	fi

	# A syntactically remote backend that points back at this VPS or its private
	# network is not an off-host disaster-recovery copy. DNS names cannot be
	# resolved safely inside this parser, but local names and literal loopback,
	# link-local, RFC1918 and IPv6-local addresses can and must be rejected.
	if [[ "${normalized}" == *localhost* ||
		"${normalized}" == *'.local:'* ||
		"${normalized}" == *'.local/'* ||
		"${normalized}" == *'0.0.0.0'* ||
		"${normalized}" == *'::1'* ||
		"${normalized}" == *'[::]'* ||
		"${normalized}" == *'[0:0:0:0:0:0:0:0]'* ||
		"${normalized}" == *'[0:0:0:0:0:0:0:1]'* ||
		"${normalized}" == *'[fc'* ||
		"${normalized}" == *'[fd'* ||
		"${normalized}" == *'[fe8'* ||
		"${normalized}" == *'[fe9'* ||
		"${normalized}" == *'[fea'* ||
		"${normalized}" == *'[feb'* ||
		"${normalized}" =~ (^|[^0-9])127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$) ||
		"${normalized}" =~ (^|[^0-9])10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$) ||
		"${normalized}" =~ (^|[^0-9])100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$) ||
		"${normalized}" =~ (^|[^0-9])172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$) ||
		"${normalized}" =~ (^|[^0-9])192\.168\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$) ||
		"${normalized}" =~ (^|[^0-9])169\.254\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$) ]]; then
		backup_error "Restic repository must not target a local or private address"
		return 1
	fi

	# A local directory protects against neither VPS loss nor disk loss. Accept
	# only encrypted Restic backends whose syntax names a remote service.
	if [[ "${repository}" =~ ^sftp:([^/@:]+@)?(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9][A-Za-z0-9._-]*):/.+ ||
		"${repository}" =~ ^rest:https://[^[:space:]/]+/.+ ||
		"${repository}" =~ ^s3:https://[^[:space:]/]+/.+ ||
		"${repository}" =~ ^(azure|gs|b2|swift):[^[:space:]]+$ ]]; then
		return 0
	fi

	backup_error "Restic repository must use an approved encrypted off-host backend"
	return 1
}

backup_runtime_active_state() {
	local output=''
	local status=0

	set +e
	output="$("${SYSTEMCTL_BIN}" is-active medusa.service 2>/dev/null)"
	status=$?
	set -e

	case "${output}" in
		active)
			[[ "${status}" -eq 0 ]] || {
				backup_error "medusa.service reported an inconsistent active state"
				return 1
			}
			printf '%s\n' "${output}"
			return 0
			;;
		inactive | failed)
			[[ "${status}" -eq 3 ]] || {
				backup_error "medusa.service reported an inconsistent stopped state"
				return 1
			}
			printf '%s\n' "${output}"
			return 0
			;;
		*)
			backup_error "cannot determine a safe medusa.service state"
			return 1
			;;
	esac
}

backup_assert_runtime_stopped() {
	local active_state=''
	local sub_state=''
	local control_group=''
	local cgroup_process_file=''

	active_state="$(
		"${SYSTEMCTL_BIN}" show medusa.service \
			--property=ActiveState --value
	)" || return 1
	sub_state="$(
		"${SYSTEMCTL_BIN}" show medusa.service \
			--property=SubState --value
	)" || return 1
	case "${active_state}:${sub_state}" in
		inactive:dead | failed:failed)
			;;
		*)
			backup_error "medusa.service did not reach a proven stopped state"
			return 1
			;;
	esac

	control_group="$(
		"${SYSTEMCTL_BIN}" show medusa.service \
			--property=ControlGroup --value
	)" || return 1
	if [[ -n "${control_group}" ]]; then
		case "${control_group}" in
			/system.slice/medusa.service)
				;;
			*)
			backup_error "medusa.service reported an unexpected control group"
				return 1
				;;
		esac
		cgroup_process_file="${CGROUP_ROOT}${control_group}/cgroup.procs"
		if [[ -e "${cgroup_process_file}" &&
			! -r "${cgroup_process_file}" ]]; then
			backup_error "cannot inspect medusa.service control-group processes"
			return 1
		fi
		if [[ -r "${cgroup_process_file}" &&
			-s "${cgroup_process_file}" ]]; then
			backup_error "medusa.service still owns a process after stop"
			return 1
		fi
	fi
}

backup_assert_runtime_running() {
	local active_state=''
	local sub_state=''

	active_state="$(
		"${SYSTEMCTL_BIN}" show medusa.service \
			--property=ActiveState --value
	)" || return 1
	sub_state="$(
		"${SYSTEMCTL_BIN}" show medusa.service \
			--property=SubState --value
	)" || return 1
	if [[ "${active_state}:${sub_state}" != 'active:running' ]]; then
		backup_error "medusa.service did not return to active/running"
		return 1
	fi
}

backup_wait_for_runtime_health() {
	local attempt=1

	while (( attempt <= HEALTH_ATTEMPTS )); do
		if "${CURL_BIN}" \
			--disable \
			--fail \
			--silent \
			--show-error \
			--max-time 5 \
			--noproxy '*' \
			--proto '=http' \
			'http://127.0.0.1:9000/health' >/dev/null 2>&1; then
			return 0
		fi
		if (( attempt < HEALTH_ATTEMPTS )); then
			"${SLEEP_BIN}" 2
		fi
		attempt=$((attempt + 1))
	done

	backup_error "medusa.service restarted but its health endpoint is unavailable"
	return 1
}

RUNTIME_RESTART_REQUIRED=0

backup_resume_runtime() {
	if [[ "${RUNTIME_RESTART_REQUIRED}" -ne 1 ]]; then
		return 0
	fi

	printf '[backup] restarting Medusa after local snapshot staging\n'
	"${SYSTEMCTL_BIN}" start medusa.service || return 1
	backup_assert_runtime_running || return 1
	backup_wait_for_runtime_health || return 1
	RUNTIME_RESTART_REQUIRED=0
	printf '[backup] Medusa is healthy; the existing storefront gate remains active\n'
}

BACKUP_SNAPSHOT_DIR=''
BACKUP_DATABASE_ARTIFACT=''
BACKUP_UPLOAD_ARTIFACT=''
BACKUP_MANIFEST=''
BACKUP_SNAPSHOT_OWNED=0
BACKUP_SNAPSHOT_COHERENT=0
BACKUP_COMPLETE=0
BACKUP_SNAPSHOT_SHARED=0
NETWORK_DIR=''
NETWORK_REPOSITORY_FILE=''
NETWORK_PASSWORD_FILE=''
NETWORK_DIR_OWNED=0

backup_revoke_network_access() {
	local status=0
	local protected_file=''

	# Remove the dedicated network identity's access to the retained snapshot
	# before reporting any failure. Root remains the owner and can inspect,
	# retry or delete the artifacts later.
	if [[ "${BACKUP_SNAPSHOT_SHARED}" -eq 1 ]]; then
		for protected_file in "${BACKUP_DATABASE_ARTIFACT}" \
			"${BACKUP_UPLOAD_ARTIFACT}" "${BACKUP_MANIFEST}"; do
			if [[ -f "${protected_file}" && ! -L "${protected_file}" ]]; then
				chmod 0600 "${protected_file}" || status=1
				chown "${EXPECTED_PRIVATE_OWNER}:${EXPECTED_ROOT_GROUP}" \
					"${protected_file}" || status=1
			fi
		done
		if [[ -d "${BACKUP_SNAPSHOT_DIR}" &&
			! -L "${BACKUP_SNAPSHOT_DIR}" ]]; then
			chmod 0700 "${BACKUP_SNAPSHOT_DIR}" || status=1
			chown "${EXPECTED_PRIVATE_OWNER}:${EXPECTED_ROOT_GROUP}" \
				"${BACKUP_SNAPSHOT_DIR}" || status=1
		fi
		[[ "${status}" -eq 0 ]] && BACKUP_SNAPSHOT_SHARED=0
	fi

	# Per-run copies prevent the unprivileged Restic process from reading the
	# authoritative root-only credential files. Revoke group access before
	# unlinking so even a cleanup error fails closed.
	if [[ "${NETWORK_DIR_OWNED}" -eq 1 ]]; then
		for protected_file in "${NETWORK_REPOSITORY_FILE}" \
			"${NETWORK_PASSWORD_FILE}"; do
			if [[ -f "${protected_file}" && ! -L "${protected_file}" ]]; then
				chmod 0600 "${protected_file}" || status=1
				chown "${EXPECTED_PRIVATE_OWNER}:${EXPECTED_ROOT_GROUP}" \
					"${protected_file}" || status=1
				unlink "${protected_file}" || status=1
			elif [[ -e "${protected_file}" || -L "${protected_file}" ]]; then
				status=1
			fi
		done
		if [[ -d "${NETWORK_DIR}" && ! -L "${NETWORK_DIR}" ]]; then
			chmod 0700 "${NETWORK_DIR}" || status=1
			chown "${EXPECTED_PRIVATE_OWNER}:${EXPECTED_ROOT_GROUP}" \
				"${NETWORK_DIR}" || status=1
			rmdir "${NETWORK_DIR}" || status=1
		elif [[ -e "${NETWORK_DIR}" || -L "${NETWORK_DIR}" ]]; then
			status=1
		fi
		[[ "${status}" -eq 0 ]] && NETWORK_DIR_OWNED=0
	fi

	return "${status}"
}

backup_prepare_network_access() {
	local owner_mode=''
	local cache_owner=''
	local cache_group=''
	local cache_mode=''
	local shared_file=''

	RESTIC_CACHE_DIR="${STAGING_DIR}/restic-cache-v2"
	if [[ ! -e "${RESTIC_CACHE_DIR}" && ! -L "${RESTIC_CACHE_DIR}" ]]; then
		mkdir "${RESTIC_CACHE_DIR}" || return 1
		chmod 0700 "${RESTIC_CACHE_DIR}" || return 1
		chown "${BACKUP_USER_UID}:${BACKUP_USER_GID}" \
			"${RESTIC_CACHE_DIR}" || return 1
	fi
	if [[ ! -d "${RESTIC_CACHE_DIR}" || -L "${RESTIC_CACHE_DIR}" ]]; then
		backup_error "restricted Restic cache must be a real directory"
		return 1
	fi
	owner_mode="$(backup_mode_and_owner "${RESTIC_CACHE_DIR}")" || return 1
	cache_owner="${owner_mode%% *}"
	cache_mode="${owner_mode##* }"
	cache_group="$(backup_group_id "${RESTIC_CACHE_DIR}")" || return 1
	if [[ "${cache_owner}" != "${BACKUP_USER_UID}" ||
		"${cache_group}" != "${BACKUP_USER_GID}" ||
		"${cache_mode}" != '700' ]]; then
		backup_error "restricted Restic cache ownership or mode is unsafe"
		return 1
	fi

	NETWORK_DIR="${STAGING_DIR}/network-${TIMESTAMP}"
	NETWORK_REPOSITORY_FILE="${NETWORK_DIR}/repository"
	NETWORK_PASSWORD_FILE="${NETWORK_DIR}/password"
	if ! mkdir "${NETWORK_DIR}"; then
		backup_error "refusing to reuse an existing Restic network directory"
		return 1
	fi
	NETWORK_DIR_OWNED=1
	chown "${EXPECTED_PRIVATE_OWNER}:${BACKUP_USER_GID}" \
		"${NETWORK_DIR}" || return 1
	chmod 0750 "${NETWORK_DIR}" || return 1

	install -m 0600 "${BACKUP_REPOSITORY_FILE}" \
		"${NETWORK_REPOSITORY_FILE}" || return 1
	install -m 0600 "${BACKUP_PASSWORD_FILE}" \
		"${NETWORK_PASSWORD_FILE}" || return 1
	chown "${EXPECTED_PRIVATE_OWNER}:${BACKUP_USER_GID}" \
		"${NETWORK_REPOSITORY_FILE}" "${NETWORK_PASSWORD_FILE}" || return 1
	chmod 0640 "${NETWORK_REPOSITORY_FILE}" \
		"${NETWORK_PASSWORD_FILE}" || return 1
	backup_require_remote_repository "${NETWORK_REPOSITORY_FILE}" || return 1
	if [[ ! -s "${NETWORK_PASSWORD_FILE}" ]]; then
		backup_error "restricted Restic password copy is empty"
		return 1
	fi

	# Grant read/search only to this run's coherent snapshot. The dedicated UID
	# cannot read the live Medusa tree, application environment, or root-owned
	# snapshots retained from earlier failures.
	BACKUP_SNAPSHOT_SHARED=1
	for shared_file in "${BACKUP_DATABASE_ARTIFACT}" \
		"${BACKUP_UPLOAD_ARTIFACT}" "${BACKUP_MANIFEST}"; do
		chown "${EXPECTED_PRIVATE_OWNER}:${BACKUP_USER_GID}" \
			"${shared_file}" || return 1
		chmod 0640 "${shared_file}" || return 1
	done
	chown "${EXPECTED_PRIVATE_OWNER}:${BACKUP_USER_GID}" \
		"${BACKUP_SNAPSHOT_DIR}" || return 1
	chmod 0750 "${BACKUP_SNAPSHOT_DIR}" || return 1
}

run_restricted_restic() {
	local -a restricted_environment=(
		"PATH=${DEPLOY_TRUSTED_PATH}"
		"HOME=${STAGING_DIR}"
		"XDG_CACHE_HOME=${RESTIC_CACHE_DIR}"
		"LANG=C.UTF-8"
		"LC_ALL=C.UTF-8"
		"TZ=UTC"
		"TMPDIR=/tmp"
	)

	if [[ "${FIXTURE_MODE}" == '1' ]]; then
		restricted_environment+=(
			"BACKUP_TEST_COMMAND_LOG=${BACKUP_TEST_COMMAND_LOG}"
			"BACKUP_TEST_FAIL_STAGE=${BACKUP_TEST_FAIL_STAGE:-}"
			"BACKUP_TEST_STAGING_DIR=${BACKUP_TEST_STAGING_DIR}"
			"BACKUP_TEST_TIMESTAMP=${BACKUP_TEST_TIMESTAMP}"
			"BACKUP_TEST_UPLOAD_DIR=${BACKUP_TEST_UPLOAD_DIR}"
			"BACKUP_TEST_ORIGINAL_REPOSITORY_FILE=${BACKUP_REPOSITORY_FILE}"
			"BACKUP_TEST_ORIGINAL_PASSWORD_FILE=${BACKUP_PASSWORD_FILE}"
			"BACKUP_TEST_RESTRICTED_CHILD=1"
		)
	fi

	"${SETPRIV_BIN}" \
		"--reuid=${BACKUP_USER_UID}" \
		"--regid=${BACKUP_USER_GID}" \
		--clear-groups \
		--bounding-set=-all \
		--inh-caps=-all \
		--ambient-caps=-all \
		--no-new-privs \
		"${ENV_BIN}" -i \
		"${restricted_environment[@]}" \
		"${RESTIC_BIN}" "$@"
}

backup_on_exit() {
	local status="$1"
	trap - EXIT
	trap - HUP INT TERM

	if [[ "${RUNTIME_RESTART_REQUIRED}" -eq 1 ]]; then
		if ! backup_resume_runtime; then
			backup_error "failed to restore medusa.service after backup staging"
			status=1
		fi
	fi

	if ! backup_revoke_network_access; then
		backup_error "could not fully revoke restricted Restic file access"
		status=1
	fi

	if [[ "${BACKUP_COMPLETE}" -ne 1 &&
		"${BACKUP_SNAPSHOT_OWNED}" -eq 1 &&
		-n "${BACKUP_SNAPSHOT_DIR}" &&
		-d "${BACKUP_SNAPSHOT_DIR}" ]]; then
		local retained_file
		chmod 0700 "${BACKUP_SNAPSHOT_DIR}" 2>/dev/null || :
		for retained_file in "${BACKUP_DATABASE_ARTIFACT}" \
			"${BACKUP_UPLOAD_ARTIFACT}" "${BACKUP_MANIFEST}"; do
			if [[ -n "${retained_file}" && -f "${retained_file}" ]]; then
				chmod 0600 "${retained_file}" 2>/dev/null || :
			fi
		done
		if [[ "${BACKUP_SNAPSHOT_COHERENT}" -eq 1 ]]; then
			backup_error \
				"backup failed; coherent local snapshot retained at ${BACKUP_SNAPSHOT_DIR}"
		else
			backup_error \
				"backup failed; incomplete local staging retained at ${BACKUP_SNAPSHOT_DIR}"
		fi
	fi

	exit "${status}"
}
trap 'backup_on_exit "$?"' EXIT

backup_on_signal() {
	local signal_status="$1"
	trap - HUP INT TERM
	exit "${signal_status}"
}
trap 'backup_on_signal 129' HUP
trap 'backup_on_signal 130' INT
trap 'backup_on_signal 143' TERM

# Test-only command and filesystem injection. Production ignores every override
# and uses fixed system paths. The scheduled unit never sets fixture mode.
FIXTURE_MODE="${PEPTIDES_BACKUP_FIXTURE_MODE:-0}"
if [[ "${FIXTURE_MODE}" == '1' ]]; then
	APP_ENV_FILE="${BACKUP_TEST_APP_ENV_FILE:?fixture app env is required}"
	BACKUP_ENV_FILE="${BACKUP_TEST_ENV_FILE:?fixture backup env is required}"
	STAGING_DIR="${BACKUP_TEST_STAGING_DIR:?fixture staging directory is required}"
	SYSTEMCTL_BIN="${BACKUP_TEST_SYSTEMCTL_BIN:?fixture systemctl is required}"
	PG_DUMP_BIN="${BACKUP_TEST_PG_DUMP_BIN:?fixture pg_dump is required}"
	PG_RESTORE_BIN="${BACKUP_TEST_PG_RESTORE_BIN:?fixture pg_restore is required}"
	TAR_BIN="${BACKUP_TEST_TAR_BIN:?fixture tar is required}"
	RESTIC_BIN="${BACKUP_TEST_RESTIC_BIN:?fixture restic is required}"
	SETPRIV_BIN="${BACKUP_TEST_SETPRIV_BIN:?fixture setpriv is required}"
	ENV_BIN="${BACKUP_TEST_ENV_BIN:?fixture env is required}"
	CURL_BIN="${BACKUP_TEST_CURL_BIN:?fixture curl is required}"
	SLEEP_BIN="${BACKUP_TEST_SLEEP_BIN:?fixture sleep is required}"
	UPLOAD_DIR="${BACKUP_TEST_UPLOAD_DIR:?fixture upload directory is required}"
	MARKER_DIR="${BACKUP_TEST_MARKER_DIR:?fixture marker directory is required}"
	RECOVERY_REQUIRED="${MARKER_DIR}/recovery-required"
	ACTIVATION_REQUIRED="${MARKER_DIR}/activation-required"
	PROVISION_RECOVERY_REQUIRED="${MARKER_DIR}/provision-recovery-required"
	TIMESTAMP="${BACKUP_TEST_TIMESTAMP:-fixture}"
	HEALTH_ATTEMPTS="${BACKUP_TEST_HEALTH_ATTEMPTS:-2}"
	CGROUP_ROOT="${BACKUP_TEST_CGROUP_ROOT:-${STAGING_DIR}/cgroup}"
	EXPECTED_PRIVATE_OWNER="$(id -u)"
	EXPECTED_ROOT_GROUP="$(id -g)"
	BACKUP_USER_UID="$(id -u)"
	BACKUP_USER_GID="$(id -g)"
	EXPECTED_APP_ENV_GROUP="$(id -g)"
	EXPECTED_APP_ENV_MODE='600'
else
	if [[ "${EUID}" -ne 0 ]]; then
		backup_error "backup.sh must run as root"
		exit 1
	fi
	deploy_assert_isolated_service_identities \
		|| {
			backup_error "service, build and backup identities are not isolated"
			exit 1
		}
	APP_ENV_FILE='/srv/peptides/.env'
	BACKUP_ENV_FILE='/srv/peptides/backup.env'
	STAGING_DIR='/var/lib/peptides-backup'
	SYSTEMCTL_BIN='/usr/bin/systemctl'
	PG_DUMP_BIN='/usr/bin/pg_dump'
	PG_RESTORE_BIN='/usr/bin/pg_restore'
	TAR_BIN='/usr/bin/tar'
	RESTIC_BIN='/usr/bin/restic'
	SETPRIV_BIN='/usr/bin/setpriv'
	ENV_BIN='/usr/bin/env'
	CURL_BIN='/usr/bin/curl'
	SLEEP_BIN='/usr/bin/sleep'
	UPLOAD_DIR='/var/lib/peptides/static'
	RECOVERY_REQUIRED='/srv/peptides/recovery-required'
	ACTIVATION_REQUIRED='/srv/peptides/activation-required'
	PROVISION_RECOVERY_REQUIRED='/srv/peptides/provision-recovery-required'
	TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
	HEALTH_ATTEMPTS=30
	CGROUP_ROOT='/sys/fs/cgroup'
	EXPECTED_PRIVATE_OWNER='0'
	EXPECTED_ROOT_GROUP='0'
	BACKUP_USER_UID="$(/usr/bin/id -u peptides-backup)" \
		|| {
			backup_error "cannot resolve the restricted backup user"
			exit 1
		}
	BACKUP_USER_GID="$(/usr/bin/id -g peptides-backup)" \
		|| {
			backup_error "cannot resolve the restricted backup group"
			exit 1
		}
	if [[ ! "${BACKUP_USER_UID}" =~ ^[1-9][0-9]*$ ||
		! "${BACKUP_USER_GID}" =~ ^[1-9][0-9]*$ ]]; then
		backup_error "restricted backup identity must not be root"
		exit 1
	fi
	EXPECTED_APP_ENV_GROUP="$(/usr/bin/id -g medusa)" \
		|| {
			backup_error "cannot resolve the medusa application group"
			exit 1
		}
	MEDUSA_USER_UID="$(/usr/bin/id -u medusa)" \
		|| {
			backup_error "cannot resolve the medusa application user"
			exit 1
		}
	if [[ "${BACKUP_USER_UID}" == "${MEDUSA_USER_UID}" ||
		"${BACKUP_USER_GID}" == "${EXPECTED_APP_ENV_GROUP}" ]]; then
		backup_error "restricted backup identity must be distinct from Medusa"
		exit 1
	fi
	EXPECTED_APP_ENV_MODE='640'
fi

backup_refuse_recovery_markers

for executable in "${SYSTEMCTL_BIN}" "${PG_DUMP_BIN}" "${PG_RESTORE_BIN}" \
	"${TAR_BIN}" "${RESTIC_BIN}" "${SETPRIV_BIN}" "${ENV_BIN}" \
	"${CURL_BIN}" "${SLEEP_BIN}"; do
	if [[ ! -x "${executable}" ]]; then
		backup_error "required backup executable is unavailable"
		exit 1
	fi
done

# Check the root-only backup file before parsing it. The application env has
# the provisioned root:medusa 0640 contract and is validated as a regular,
# non-symlink data file by deploy_load_app_env_file below.
backup_require_private_file "${BACKUP_ENV_FILE}" "${EXPECTED_PRIVATE_OWNER}"
backup_require_app_env "${APP_ENV_FILE}" \
	"${EXPECTED_PRIVATE_OWNER}" "${EXPECTED_APP_ENV_GROUP}" \
	"${EXPECTED_APP_ENV_MODE}"

# Do not inherit libpq or Restic controls from the root caller. The connection
# URI and Restic file paths loaded below are the authoritative inputs.
while IFS= read -r inherited_name; do
	case "${inherited_name}" in
		PG* | RESTIC_*)
			builtin unset -v "${inherited_name}" 2>/dev/null || :
			;;
	esac
done < <(builtin compgen -e)

# The application file contains more than DATABASE_URL. Validate it against its
# complete committed allowlist, retain the database URI privately, then remove
# every exported application value before invoking backup tools.
deploy_load_app_env_file "${APP_ENV_FILE}"
backup_require_value DATABASE_URL
BACKUP_DATABASE_URL="${DATABASE_URL}"
for app_env_name in "${DEPLOY_APP_ENV_ALLOWLIST[@]}"; do
	builtin unset -v "${app_env_name}" 2>/dev/null || :
done

deploy_env_load_file "${BACKUP_ENV_FILE}" \
	BACKUP_REPOSITORY_FILE \
	BACKUP_PASSWORD_FILE \
	BACKUP_KEEP_DAILY \
	BACKUP_KEEP_WEEKLY \
	BACKUP_KEEP_MONTHLY \
	BACKUP_CHECK_READ_DATA_SUBSET \
	BACKUP_REQUIRE_STOPPED

backup_require_value BACKUP_REPOSITORY_FILE
backup_require_value BACKUP_PASSWORD_FILE
backup_require_value BACKUP_KEEP_DAILY
backup_require_value BACKUP_KEEP_WEEKLY
backup_require_value BACKUP_KEEP_MONTHLY
: "${BACKUP_REQUIRE_STOPPED:=1}"

for retention_name in BACKUP_KEEP_DAILY BACKUP_KEEP_WEEKLY \
	BACKUP_KEEP_MONTHLY; do
	retention_value="${!retention_name}"
	if [[ ! "${retention_value}" =~ ^[1-9][0-9]*$ ]]; then
		backup_error "${retention_name} must be a positive integer"
		exit 1
	fi
done

if [[ -n "${BACKUP_CHECK_READ_DATA_SUBSET:-}" &&
	! "${BACKUP_CHECK_READ_DATA_SUBSET}" =~ ^([1-9]|[1-9][0-9]|100)%$ ]]; then
	backup_error "BACKUP_CHECK_READ_DATA_SUBSET must be blank or 1%-100%"
	exit 1
fi
if [[ "${BACKUP_REQUIRE_STOPPED}" != "1" ]]; then
	backup_error \
		"BACKUP_REQUIRE_STOPPED must be 1 for a coherent database-and-upload snapshot"
	exit 1
fi

backup_require_private_file "${BACKUP_REPOSITORY_FILE}" \
	"${EXPECTED_PRIVATE_OWNER}"
backup_require_private_file "${BACKUP_PASSWORD_FILE}" \
	"${EXPECTED_PRIVATE_OWNER}"
if [[ ! -s "${BACKUP_REPOSITORY_FILE}" || ! -s "${BACKUP_PASSWORD_FILE}" ]]; then
	backup_error "Restic repository and password files must be nonempty"
	exit 1
fi
backup_require_remote_repository "${BACKUP_REPOSITORY_FILE}"
if [[ ! -d "${UPLOAD_DIR}" || -L "${UPLOAD_DIR}" ]]; then
	backup_error "Medusa static-file state must be a real directory"
	exit 1
fi

if [[ ! -e "${STAGING_DIR}" && ! -L "${STAGING_DIR}" ]]; then
	mkdir "${STAGING_DIR}"
fi
if [[ ! -d "${STAGING_DIR}" || -L "${STAGING_DIR}" ]]; then
	backup_error "backup state directory must be a real directory"
	exit 1
fi
chown "${EXPECTED_PRIVATE_OWNER}:${BACKUP_USER_GID}" "${STAGING_DIR}"
chmod 0750 "${STAGING_DIR}"
BACKUP_SNAPSHOT_DIR="${STAGING_DIR}/snapshot-${TIMESTAMP}"
BACKUP_DATABASE_ARTIFACT="${BACKUP_SNAPSHOT_DIR}/postgres.dump"
BACKUP_UPLOAD_ARTIFACT="${BACKUP_SNAPSHOT_DIR}/uploads.tar"
BACKUP_MANIFEST="${BACKUP_SNAPSHOT_DIR}/manifest"
if ! mkdir "${BACKUP_SNAPSHOT_DIR}"; then
	backup_error "refusing to overwrite an existing backup snapshot"
	exit 1
fi
BACKUP_SNAPSHOT_OWNED=1
chmod 0700 "${BACKUP_SNAPSHOT_DIR}"

runtime_state="$(backup_runtime_active_state)" || exit 1
case "${runtime_state}" in
	active)
		RUNTIME_RESTART_REQUIRED=1
		printf '[backup] stopping Medusa for coherent local snapshot staging\n'
		"${SYSTEMCTL_BIN}" stop medusa.service
		backup_assert_runtime_stopped
		;;
	inactive | failed)
		# Preserve an operator-visible outage instead of silently starting a
		# runtime that was already stopped before this backup began.
		backup_assert_runtime_stopped
		;;
	*)
		backup_error "cannot prove a safe runtime state"
		exit 1
		;;
esac

# PGDATABASE accepts the same connection URI as --dbname without exposing it in
# the process argument list. pg_dump must fail rather than prompt.
PGDATABASE="${BACKUP_DATABASE_URL}"
export PGDATABASE
unset BACKUP_DATABASE_URL

printf '[backup] creating PostgreSQL snapshot\n'
"${PG_DUMP_BIN}" \
	--format=custom \
	--no-password \
	--file="${BACKUP_DATABASE_ARTIFACT}"
unset PGDATABASE
chmod 0600 "${BACKUP_DATABASE_ARTIFACT}"

if [[ ! -s "${BACKUP_DATABASE_ARTIFACT}" ]]; then
	backup_error "pg_dump produced an empty artifact"
	exit 1
fi

printf '[backup] validating PostgreSQL snapshot\n'
"${PG_RESTORE_BIN}" --list "${BACKUP_DATABASE_ARTIFACT}" >/dev/null

# Archive the upload tree while Medusa is still proven stopped. The archive is
# deliberately uncompressed to keep this write-unavailable window short;
# Restic performs content-defined deduplication and encryption after restart.
printf '[backup] staging Medusa uploads locally\n'
"${TAR_BIN}" \
	--create \
	--file="${BACKUP_UPLOAD_ARTIFACT}" \
	--directory="${UPLOAD_DIR}" \
	.
chmod 0600 "${BACKUP_UPLOAD_ARTIFACT}"
if [[ ! -s "${BACKUP_UPLOAD_ARTIFACT}" ]]; then
	backup_error "upload staging produced an empty archive"
	exit 1
fi
printf '[backup] validating upload archive\n'
"${TAR_BIN}" --list --file="${BACKUP_UPLOAD_ARTIFACT}" >/dev/null

{
	printf 'format=peptides-coherent-backup-v1\n'
	printf 'database=postgres.dump\n'
	printf 'uploads=uploads.tar\n'
} >"${BACKUP_MANIFEST}"
chmod 0600 "${BACKUP_MANIFEST}"
BACKUP_SNAPSHOT_COHERENT=1

# Restart and health-check the backend before any off-host transfer. Caddy and
# the pre-launch basic-auth gate remain active throughout this short pause.
backup_resume_runtime

backup_prepare_network_access

RESTIC_BASE_ARGS=(
	--repository-file "${NETWORK_REPOSITORY_FILE}"
	--password-file "${NETWORK_PASSWORD_FILE}"
	--cache-dir "${RESTIC_CACHE_DIR}"
)

printf '[backup] uploading encrypted snapshot\n'
run_restricted_restic "${RESTIC_BASE_ARGS[@]}" backup \
	--quiet \
	--tag peptideeinkaufen-backup \
	--tag coherent-v1 \
	--host peptideeinkaufen.de \
	"${BACKUP_SNAPSHOT_DIR}"

printf '[backup] applying retention\n'
run_restricted_restic "${RESTIC_BASE_ARGS[@]}" forget \
	--quiet \
	--prune \
	--tag peptideeinkaufen-backup \
	--group-by host,tags \
	--keep-daily "${BACKUP_KEEP_DAILY}" \
	--keep-weekly "${BACKUP_KEEP_WEEKLY}" \
	--keep-monthly "${BACKUP_KEEP_MONTHLY}"

printf '[backup] checking off-host repository\n'
RESTIC_CHECK_ARGS=(check --quiet)
if [[ -n "${BACKUP_CHECK_READ_DATA_SUBSET:-}" ]]; then
	RESTIC_CHECK_ARGS+=(
		"--read-data-subset=${BACKUP_CHECK_READ_DATA_SUBSET}"
	)
fi
run_restricted_restic "${RESTIC_BASE_ARGS[@]}" "${RESTIC_CHECK_ARGS[@]}"

# Local coherent artifacts are removed only after upload, retention and
# repository checks have all completed successfully.
backup_revoke_network_access
rm -f -- "${BACKUP_DATABASE_ARTIFACT}"
rm -f -- "${BACKUP_UPLOAD_ARTIFACT}"
rm -f -- "${BACKUP_MANIFEST}"
rmdir "${BACKUP_SNAPSHOT_DIR}"
BACKUP_SNAPSHOT_DIR=''
BACKUP_SNAPSHOT_OWNED=0
BACKUP_COMPLETE=1
printf '[backup] off-host backup verified; local coherent snapshot removed\n'
