#!/usr/bin/env bash
#
# Fixture tests for deploy/backup.sh. Every external command is a fake; this
# file never connects to PostgreSQL, systemd, Restic or the network.

set -euo pipefail
umask 077

TEST_DIR="$(builtin cd "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
DEPLOY_DIR="$(builtin cd "${TEST_DIR}/.." && builtin pwd -P)"
BACKUP_SCRIPT="${DEPLOY_DIR}/backup.sh"
FIXTURE_ROOT="$(mktemp -d)"
trap 'rm -rf "${FIXTURE_ROOT}"' EXIT

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

assert_contains() {
	local file="$1"
	local pattern="$2"
	local message="$3"
	grep -Eq -- "${pattern}" "${file}" || fail "${message}"
}

assert_not_contains() {
	local file="$1"
	local pattern="$2"
	local message="$3"
	if grep -Eq -- "${pattern}" "${file}"; then
		fail "${message}"
	fi
}

assert_before() {
	local file="$1"
	local first="$2"
	local second="$3"
	local message="$4"
	local first_line
	local second_line

	first_line="$(grep -n -m1 -F -- "${first}" "${file}" | cut -d: -f1 || :)"
	second_line="$(grep -n -m1 -F -- "${second}" "${file}" | cut -d: -f1 || :)"
	[[ -n "${first_line}" && -n "${second_line}" &&
		"${first_line}" -lt "${second_line}" ]] || fail "${message}"
}

file_mode() {
	local file="$1"
	stat -c '%a' "${file}" 2>/dev/null || stat -f '%Lp' "${file}"
}

FAKE_BIN="${FIXTURE_ROOT}/bin"
mkdir -p "${FAKE_BIN}"

cat >"${FAKE_BIN}/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

state="$(cat "${BACKUP_TEST_RUNTIME_STATE_FILE}")"
command="${1:-}"
shift || :

case "${command}" in
	is-active)
		[[ "${1:-}" == 'medusa.service' ]] || exit 55
		printf 'systemctl:is-active:%s\n' "${state}" \
			>>"${BACKUP_TEST_COMMAND_LOG}"
		printf '%s\n' "${state}"
		[[ "${state}" == 'active' ]] && exit 0
		[[ "${state}" == 'inactive' || "${state}" == 'failed' ]] && exit 3
		exit 4
		;;
	stop)
		[[ "${1:-}" == 'medusa.service' ]] || exit 55
		printf 'systemctl:stop\n' >>"${BACKUP_TEST_COMMAND_LOG}"
		[[ "${BACKUP_TEST_FAIL_STAGE:-}" != 'stop' ]] || exit 51
		printf 'inactive\n' >"${BACKUP_TEST_RUNTIME_STATE_FILE}"
		;;
	start)
		[[ "${1:-}" == 'medusa.service' ]] || exit 55
		printf 'systemctl:start\n' >>"${BACKUP_TEST_COMMAND_LOG}"
		[[ "${BACKUP_TEST_FAIL_STAGE:-}" != 'start' ]] || exit 52
		printf 'active\n' >"${BACKUP_TEST_RUNTIME_STATE_FILE}"
		;;
	show)
		[[ "${1:-}" == 'medusa.service' ]] || exit 55
		property=''
		for argument in "$@"; do
			case "${argument}" in
				--property=*) property="${argument#--property=}" ;;
			esac
		done
		state="$(cat "${BACKUP_TEST_RUNTIME_STATE_FILE}")"
		printf 'systemctl:show:%s:%s\n' "${property}" "${state}" \
			>>"${BACKUP_TEST_COMMAND_LOG}"
		case "${property}" in
			ActiveState)
				if [[ "${BACKUP_TEST_FAIL_STAGE:-}" == 'stopped-proof' &&
					"${state}" == 'inactive' ]]; then
					printf 'active\n'
				elif [[ "${BACKUP_TEST_FAIL_STAGE:-}" == 'running-proof' &&
					"${state}" == 'active' ]]; then
					printf 'inactive\n'
				else
					printf '%s\n' "${state}"
				fi
				;;
			SubState)
				case "${state}" in
					active) printf 'running\n' ;;
					inactive) printf 'dead\n' ;;
					failed) printf 'failed\n' ;;
					*) printf 'unknown\n' ;;
				esac
				;;
			ControlGroup)
				if [[ "${BACKUP_TEST_FAIL_STAGE:-}" == 'cgroup-busy' ]]; then
					printf '/system.slice/medusa.service\n'
				else
					printf '\n'
				fi
				;;
			*)
				exit 53
				;;
		esac
		;;
	*)
		exit 54
		;;
esac
EOF

cat >"${FAKE_BIN}/pg_dump" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'pg_dump\n' >>"${BACKUP_TEST_COMMAND_LOG}"
[[ "${PGDATABASE:-}" == *'BACKUP_SECRET_MARKER'* ]] \
	|| { printf 'missing PGDATABASE\n' >&2; exit 90; }
[[ "$*" != *'BACKUP_SECRET_MARKER'* ]] \
	|| { printf 'secret was placed in argv\n' >&2; exit 91; }
[[ -z "${PGPASSWORD+x}" ]] \
	|| { printf 'inherited PGPASSWORD survived\n' >&2; exit 96; }
output=''
for argument in "$@"; do
	case "${argument}" in
		--file=*) output="${argument#--file=}" ;;
	esac
done
[[ -n "${output}" ]] || exit 92
if [[ "${BACKUP_TEST_FAIL_STAGE:-}" == 'empty-dump' ]]; then
	: >"${output}"
	exit 0
fi
printf 'fixture custom-format dump\n' >"${output}"
[[ "${BACKUP_TEST_FAIL_STAGE:-}" != 'pg-dump' ]] || exit 41
EOF

cat >"${FAKE_BIN}/pg_restore" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'pg_restore\n' >>"${BACKUP_TEST_COMMAND_LOG}"
[[ "${1:-}" == '--list' ]] || exit 93
[[ -s "${2:-}" ]] || exit 94
[[ "${BACKUP_TEST_FAIL_STAGE:-}" != 'pg-restore' ]] || exit 42
printf 'fixture restore listing\n'
EOF

cat >"${FAKE_BIN}/tar" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
action=''
output=''
source_dir=''
for argument in "$@"; do
	case "${argument}" in
		--create) action='create' ;;
		--list) action='list' ;;
		--file=*) output="${argument#--file=}" ;;
		--directory=*) source_dir="${argument#--directory=}" ;;
	esac
done
[[ -n "${action}" && -n "${output}" ]] || exit 101
printf 'tar:%s\n' "${action}" >>"${BACKUP_TEST_COMMAND_LOG}"
case "${action}" in
	create)
		[[ "${source_dir}" == "${BACKUP_TEST_UPLOAD_DIR}" ]] || exit 102
		[[ -f "${source_dir}/image.webp" ]] || exit 103
		printf 'fixture upload archive\n' >"${output}"
		[[ "${BACKUP_TEST_FAIL_STAGE:-}" != 'tar-create' ]] || exit 44
		;;
	list)
		[[ -s "${output}" ]] || exit 104
		[[ "${BACKUP_TEST_FAIL_STAGE:-}" != 'tar-list' ]] || exit 45
		printf './\n./image.webp\n'
		;;
esac
EOF

cat >"${FAKE_BIN}/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl:health\n' >>"${BACKUP_TEST_COMMAND_LOG}"
[[ "$*" == *'http://127.0.0.1:9000/health'* ]] || exit 105
[[ "${BACKUP_TEST_FAIL_STAGE:-}" != 'health' ]] || exit 46
EOF

cat >"${FAKE_BIN}/sleep" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'sleep\n' >>"${BACKUP_TEST_COMMAND_LOG}"
EOF

cat >"${FAKE_BIN}/setpriv" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

arguments=" $* "
for required in \
	"--reuid=${BACKUP_TEST_EXPECTED_BACKUP_UID}" \
	"--regid=${BACKUP_TEST_EXPECTED_BACKUP_GID}" \
	'--clear-groups' \
	'--bounding-set=-all' \
	'--inh-caps=-all' \
	'--ambient-caps=-all' \
	'--no-new-privs'; do
	[[ "${arguments}" == *" ${required} "* ]] \
		|| { printf 'setpriv missing %s\n' "${required}" >&2; exit 109; }
done
while [[ "${1:-}" == --* ]]; do
	shift
done
[[ "${1:-}" == "${BACKUP_TEST_ENV_BIN}" && "${2:-}" == '-i' ]] \
	|| { printf 'setpriv did not enter an empty environment\n' >&2; exit 110; }
printf 'setpriv\n' >>"${BACKUP_TEST_COMMAND_LOG}"
[[ "${BACKUP_TEST_FAIL_STAGE:-}" != 'setpriv' ]] || exit 47
exec "$@"
EOF

cat >"${FAKE_BIN}/restic" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${BACKUP_TEST_RESTRICTED_CHILD:-}" == '1' ]] \
	|| { printf 'Restic bypassed restricted child\n' >&2; exit 111; }
action=''
repository_file=''
password_file=''
cache_dir=''
for argument in "$@"; do
	case "${argument}" in
		backup | forget | check)
			action="${argument}"
			;;
	esac
done
previous=''
for argument in "$@"; do
	case "${previous}" in
		--repository-file) repository_file="${argument}" ;;
		--password-file) password_file="${argument}" ;;
		--cache-dir) cache_dir="${argument}" ;;
	esac
	previous="${argument}"
done
[[ -n "${action}" ]] || exit 95
[[ -z "${PGDATABASE+x}" ]] \
	|| { printf 'PGDATABASE reached Restic\n' >&2; exit 96; }
[[ -z "${PGPASSWORD+x}" ]] \
	|| { printf 'PGPASSWORD reached Restic\n' >&2; exit 97; }
[[ -z "${RESTIC_PASSWORD+x}" ]] \
	|| { printf 'RESTIC_PASSWORD reached Restic\n' >&2; exit 98; }
[[ "${HOME}" == "${BACKUP_TEST_STAGING_DIR}" ]] \
	|| { printf 'backup HOME did not use private state\n' >&2; exit 99; }
[[ "${repository_file}" != "${BACKUP_TEST_ORIGINAL_REPOSITORY_FILE}" &&
	"${password_file}" != "${BACKUP_TEST_ORIGINAL_PASSWORD_FILE}" ]] \
	|| { printf 'Restic received authoritative root credentials\n' >&2; exit 112; }
expected_network_dir="${BACKUP_TEST_STAGING_DIR}/network-${BACKUP_TEST_TIMESTAMP}"
[[ "${repository_file}" == "${expected_network_dir}/repository" &&
	"${password_file}" == "${expected_network_dir}/password" &&
	"${cache_dir}" == "${BACKUP_TEST_STAGING_DIR}/restic-cache-v2" ]] \
	|| { printf 'Restic received unexpected restricted paths\n' >&2; exit 113; }
[[ "$(stat -c '%a' "${repository_file}" 2>/dev/null ||
	stat -f '%Lp' "${repository_file}")" == '640' &&
	"$(stat -c '%a' "${password_file}" 2>/dev/null ||
	stat -f '%Lp' "${password_file}")" == '640' ]] \
	|| { printf 'restricted credential copies have unsafe modes\n' >&2; exit 114; }
if [[ "${action}" == 'backup' ]]; then
	snapshot="${BACKUP_TEST_STAGING_DIR}/snapshot-${BACKUP_TEST_TIMESTAMP}"
	[[ " $* " == *" ${snapshot} "* ]] \
		|| { printf 'Restic did not receive staged snapshot\n' >&2; exit 106; }
	[[ " $* " != *" ${BACKUP_TEST_UPLOAD_DIR} "* ]] \
		|| { printf 'Restic received live upload tree\n' >&2; exit 107; }
	[[ -s "${snapshot}/postgres.dump" &&
		-s "${snapshot}/uploads.tar" &&
		-s "${snapshot}/manifest" ]] \
		|| { printf 'coherent snapshot was incomplete\n' >&2; exit 108; }
	[[ "$(stat -c '%a' "${snapshot}" 2>/dev/null ||
		stat -f '%Lp' "${snapshot}")" == '750' &&
		"$(stat -c '%a' "${snapshot}/postgres.dump" 2>/dev/null ||
		stat -f '%Lp' "${snapshot}/postgres.dump")" == '640' ]] \
		|| { printf 'snapshot was not narrowly shared\n' >&2; exit 115; }
fi
if [[ "${action}" == 'forget' &&
	" $* " != *' --group-by host,tags '* ]]; then
	printf 'retention did not use stable grouping\n' >&2
	exit 100
fi
printf 'restic:%s\n' "${action}" >>"${BACKUP_TEST_COMMAND_LOG}"
[[ "${BACKUP_TEST_FAIL_STAGE:-}" != "restic-${action}" ]] || exit 43
EOF

chmod 0755 "${FAKE_BIN}/systemctl" "${FAKE_BIN}/pg_dump" \
	"${FAKE_BIN}/pg_restore" "${FAKE_BIN}/tar" "${FAKE_BIN}/curl" \
	"${FAKE_BIN}/sleep" "${FAKE_BIN}/setpriv" "${FAKE_BIN}/restic"

APP_ENV="${FIXTURE_ROOT}/app.env"
BACKUP_ENV="${FIXTURE_ROOT}/backup.env"
REPOSITORY_FILE="${FIXTURE_ROOT}/repository"
PASSWORD_FILE="${FIXTURE_ROOT}/password"
UPLOAD_DIR="${FIXTURE_ROOT}/uploads"

cat >"${APP_ENV}" <<'EOF'
DATABASE_URL=postgres://backup_user:BACKUP_SECRET_MARKER@127.0.0.1/peptides
REDIS_URL=redis://127.0.0.1:6379
FILE_UPLOAD_DIR=/var/lib/peptides/static
FILE_BACKEND_URL=https://api.peptideeinkaufen.de/static
JWT_SECRET=fixture-jwt-secret
COOKIE_SECRET=fixture-cookie-secret
AUTH_MFA_ENCRYPTION_KEY=fixture-mfa-secret
SECURITY_HMAC_SECRET=fixture-hmac-secret
STORE_CORS=http://localhost:4321
ADMIN_CORS=http://localhost:9000
AUTH_CORS=http://localhost:9000
EOF
printf 'sftp:fixture.invalid:/restic/peptides\n' >"${REPOSITORY_FILE}"
printf 'RESTIC_SECRET_MARKER\n' >"${PASSWORD_FILE}"
mkdir -p "${UPLOAD_DIR}"
printf 'fixture upload\n' >"${UPLOAD_DIR}/image.webp"
chmod 0600 "${APP_ENV}" "${REPOSITORY_FILE}" "${PASSWORD_FILE}"

write_backup_env() {
	local require_stopped="${1:-1}"
	local include_requirement="${2:-1}"
	cat >"${BACKUP_ENV}" <<EOF
BACKUP_REPOSITORY_FILE=${REPOSITORY_FILE}
BACKUP_PASSWORD_FILE=${PASSWORD_FILE}
BACKUP_KEEP_DAILY=7
BACKUP_KEEP_WEEKLY=5
BACKUP_KEEP_MONTHLY=12
BACKUP_CHECK_READ_DATA_SUBSET=
EOF
	if [[ "${include_requirement}" == '1' ]]; then
		printf 'BACKUP_REQUIRE_STOPPED=%s\n' "${require_stopped}" \
			>>"${BACKUP_ENV}"
	fi
	chmod 0600 "${BACKUP_ENV}"
}
write_backup_env

LAST_OUTPUT=''
LAST_LOG=''
LAST_STAGING=''
LAST_SNAPSHOT=''
LAST_DATABASE_ARTIFACT=''
LAST_UPLOAD_ARTIFACT=''
LAST_MANIFEST=''
LAST_NETWORK_DIR=''
LAST_MARKER_DIR=''
LAST_RUNTIME_STATE_FILE=''
LAST_STATUS=0

run_case() {
	local name="$1"
	local state="${2:-active}"
	local failure="${3:-}"

	LAST_OUTPUT="${FIXTURE_ROOT}/${name}.output"
	LAST_LOG="${FIXTURE_ROOT}/${name}.commands"
	LAST_STAGING="${FIXTURE_ROOT}/${name}-staging"
	LAST_SNAPSHOT="${LAST_STAGING}/snapshot-${name}"
	LAST_DATABASE_ARTIFACT="${LAST_SNAPSHOT}/postgres.dump"
	LAST_UPLOAD_ARTIFACT="${LAST_SNAPSHOT}/uploads.tar"
	LAST_MANIFEST="${LAST_SNAPSHOT}/manifest"
	LAST_NETWORK_DIR="${LAST_STAGING}/network-${name}"
	LAST_MARKER_DIR="${FIXTURE_ROOT}/${name}-markers"
	LAST_RUNTIME_STATE_FILE="${FIXTURE_ROOT}/${name}.runtime-state"
	: >"${LAST_LOG}"
	mkdir "${LAST_MARKER_DIR}"
	printf '%s\n' "${state}" >"${LAST_RUNTIME_STATE_FILE}"
	if [[ "${failure}" == 'cgroup-busy' ]]; then
		mkdir -p \
			"${LAST_STAGING}/cgroup/system.slice/medusa.service"
		printf '4242\n' \
			>"${LAST_STAGING}/cgroup/system.slice/medusa.service/cgroup.procs"
	fi
	case "${failure}" in
		recovery-marker)
			: >"${LAST_MARKER_DIR}/recovery-required"
			;;
		activation-marker)
			: >"${LAST_MARKER_DIR}/activation-required"
			;;
		provision-marker-symlink)
			ln -s "${LAST_MARKER_DIR}/missing" \
				"${LAST_MARKER_DIR}/provision-recovery-required"
			;;
	esac

	set +e
	PEPTIDES_BACKUP_FIXTURE_MODE=1 \
	BACKUP_TEST_APP_ENV_FILE="${APP_ENV}" \
	BACKUP_TEST_ENV_FILE="${BACKUP_ENV}" \
	BACKUP_TEST_STAGING_DIR="${LAST_STAGING}" \
	BACKUP_TEST_SYSTEMCTL_BIN="${FAKE_BIN}/systemctl" \
	BACKUP_TEST_PG_DUMP_BIN="${FAKE_BIN}/pg_dump" \
	BACKUP_TEST_PG_RESTORE_BIN="${FAKE_BIN}/pg_restore" \
	BACKUP_TEST_TAR_BIN="${FAKE_BIN}/tar" \
	BACKUP_TEST_RESTIC_BIN="${FAKE_BIN}/restic" \
	BACKUP_TEST_SETPRIV_BIN="${FAKE_BIN}/setpriv" \
	BACKUP_TEST_ENV_BIN="/usr/bin/env" \
	BACKUP_TEST_CURL_BIN="${FAKE_BIN}/curl" \
	BACKUP_TEST_SLEEP_BIN="${FAKE_BIN}/sleep" \
	BACKUP_TEST_UPLOAD_DIR="${UPLOAD_DIR}" \
	BACKUP_TEST_MARKER_DIR="${LAST_MARKER_DIR}" \
	BACKUP_TEST_TIMESTAMP="${name}" \
	BACKUP_TEST_HEALTH_ATTEMPTS=2 \
	BACKUP_TEST_EXPECTED_BACKUP_UID="$(id -u)" \
	BACKUP_TEST_EXPECTED_BACKUP_GID="$(id -g)" \
	BACKUP_TEST_COMMAND_LOG="${LAST_LOG}" \
	BACKUP_TEST_RUNTIME_STATE_FILE="${LAST_RUNTIME_STATE_FILE}" \
	BACKUP_TEST_FAIL_STAGE="${failure}" \
	PGPASSWORD='INHERITED_PG_SECRET_MARKER' \
	RESTIC_PASSWORD='INHERITED_RESTIC_SECRET_MARKER' \
	bash "${BACKUP_SCRIPT}" >"${LAST_OUTPUT}" 2>&1
	LAST_STATUS=$?
	set -e

	assert_not_contains "${LAST_OUTPUT}" \
		'BACKUP_SECRET_MARKER|RESTIC_SECRET_MARKER|INHERITED_.*_SECRET_MARKER' \
		"${name}: output disclosed a secret"
	assert_not_contains "${LAST_LOG}" \
		'BACKUP_SECRET_MARKER|RESTIC_SECRET_MARKER|INHERITED_.*_SECRET_MARKER' \
		"${name}: command arguments disclosed a secret"
}

# A normal scheduled run stops/proves the active backend, validates both local
# artifacts, restarts/proves health, and only then invokes remote Restic.
run_case success
if [[ "${LAST_STATUS}" -ne 0 ]]; then
	sed 's/^/  /' "${LAST_OUTPUT}" >&2
	fail "successful backup returned ${LAST_STATUS}"
fi
[[ ! -e "${LAST_SNAPSHOT}" ]] || fail "successful backup retained its snapshot"
[[ ! -e "${LAST_NETWORK_DIR}" ]] \
	|| fail "successful backup retained restricted credential copies"
[[ "$(cat "${LAST_RUNTIME_STATE_FILE}")" == 'active' ]] \
	|| fail "successful backup did not restore the active runtime"
expected_success=$'systemctl:is-active:active\nsystemctl:stop\nsystemctl:show:ActiveState:inactive\nsystemctl:show:SubState:inactive\nsystemctl:show:ControlGroup:inactive\npg_dump\npg_restore\ntar:create\ntar:list\nsystemctl:start\nsystemctl:show:ActiveState:active\nsystemctl:show:SubState:active\ncurl:health\nsetpriv\nrestic:backup\nsetpriv\nrestic:forget\nsetpriv\nrestic:check'
[[ "$(cat "${LAST_LOG}")" == "${expected_success}" ]] \
	|| {
		sed 's/^/  /' "${LAST_LOG}" >&2
		fail "successful backup used an unexpected command sequence"
	}
assert_before "${LAST_LOG}" 'curl:health' 'restic:backup' \
	"Restic started before backend health was restored"
[[ "$(grep -c '^setpriv$' "${LAST_LOG}")" -eq 3 ]] \
	|| fail "not every Restic command crossed the restricted UID boundary"

# ExecStartPre checks happen before the blocking flock. Repeat them inside the
# script so recovery state created by a failed deploy while this job waited
# aborts before credentials, Medusa or snapshot tooling are touched.
for marker_failure in recovery-marker activation-marker \
	provision-marker-symlink; do
	run_case "${marker_failure}" active "${marker_failure}"
	[[ "${LAST_STATUS}" -ne 0 ]] \
		|| fail "${marker_failure}: recovery state was ignored"
	[[ ! -s "${LAST_LOG}" ]] \
		|| fail "${marker_failure}: marker check ran after an external command"
done

# A runtime that was already stopped remains stopped; the snapshot is still
# coherent and the backup must not silently change the operator-visible state.
run_case initially-inactive inactive
[[ "${LAST_STATUS}" -eq 0 ]] || fail "inactive-runtime backup failed"
[[ "$(cat "${LAST_RUNTIME_STATE_FILE}")" == 'inactive' ]] \
	|| fail "backup started a runtime that was initially inactive"
assert_not_contains "${LAST_LOG}" '^systemctl:(stop|start)$' \
	"already-inactive runtime was changed"

# Missing BACKUP_REQUIRE_STOPPED defaults fail-closed to coherent staging.
write_backup_env 1 0
run_case default-stopped
[[ "${LAST_STATUS}" -eq 0 ]] \
	|| fail "missing stopped requirement did not default to safe behavior"

# An explicit attempt to opt into an online/incoherent upload-tree backup is
# rejected before Medusa or any backup tool is touched.
write_backup_env 0
run_case unsafe-online
[[ "${LAST_STATUS}" -ne 0 ]] || fail "online backup opt-out was accepted"
[[ ! -s "${LAST_LOG}" ]] || fail "unsafe online mode reached an external command"
write_backup_env

# Unknown or transitional runtime state fails before snapshot tools run.
run_case unknown-runtime activating
[[ "${LAST_STATUS}" -ne 0 ]] || fail "unknown runtime state was accepted"
assert_not_contains "${LAST_LOG}" '^(pg_dump|tar:create|restic:backup)$' \
	"unknown runtime state reached snapshot tooling"

assert_retained_failure() {
	local name="$1"
	local failure="$2"
	local expected_coherent="$3"
	local expected_runtime="${4:-active}"

	run_case "${name}" active "${failure}"
	[[ "${LAST_STATUS}" -ne 0 ]] || fail "${name}: injected failure succeeded"
	[[ -d "${LAST_SNAPSHOT}" ]] || fail "${name}: local snapshot was not retained"
	[[ "$(file_mode "${LAST_SNAPSHOT}")" == '700' ]] \
		|| fail "${name}: retained snapshot directory is not mode 0700"
	[[ "$(cat "${LAST_RUNTIME_STATE_FILE}")" == "${expected_runtime}" ]] \
		|| fail "${name}: runtime ended in an unexpected state"
	assert_not_contains "${LAST_LOG}" '^restic:backup$' \
		"${name}: remote upload ran before coherent local staging and restart"
	[[ ! -e "${LAST_NETWORK_DIR}" ]] \
		|| fail "${name}: restricted credential copies were retained"

	if [[ "${expected_coherent}" == '1' ]]; then
		for artifact in "${LAST_DATABASE_ARTIFACT}" \
			"${LAST_UPLOAD_ARTIFACT}" "${LAST_MANIFEST}"; do
			[[ -s "${artifact}" ]] \
				|| fail "${name}: coherent local artifact is missing"
			[[ "$(file_mode "${artifact}")" == '600' ]] \
				|| fail "${name}: retained artifact is not mode 0600"
		done
		assert_contains "${LAST_OUTPUT}" 'coherent local snapshot retained' \
			"${name}: coherent retained snapshot was not reported"
	else
		assert_contains "${LAST_OUTPUT}" 'incomplete local staging retained' \
			"${name}: incomplete retained staging was not reported"
	fi
}

assert_retained_failure fail-pg-dump pg-dump 0
assert_retained_failure fail-empty-dump empty-dump 0
assert_retained_failure fail-pg-restore pg-restore 0
assert_retained_failure fail-tar-create tar-create 0
assert_retained_failure fail-tar-list tar-list 0
assert_retained_failure fail-stop stop 0
assert_retained_failure fail-stopped-proof stopped-proof 0
assert_retained_failure fail-cgroup-proof cgroup-busy 0

# Once both local artifacts validate, any restart failure retains them and
# absolutely forbids a remote upload.
assert_retained_failure fail-start start 1 inactive
[[ "$(grep -c '^systemctl:start$' "${LAST_LOG}")" -ge 2 ]] \
	|| fail "failed restart was not retried by the exit trap"
assert_contains "${LAST_OUTPUT}" 'failed to restore medusa.service' \
	"terminal restart failure was not reported"
assert_retained_failure fail-running-proof running-proof 1
assert_retained_failure fail-health health 1
assert_retained_failure fail-setpriv setpriv 1

assert_remote_failure_retained() {
	local name="$1"
	local failure="$2"

	run_case "${name}" active "${failure}"
	[[ "${LAST_STATUS}" -ne 0 ]] || fail "${name}: injected failure succeeded"
	[[ "$(cat "${LAST_RUNTIME_STATE_FILE}")" == 'active' ]] \
		|| fail "${name}: runtime was not active during remote failure"
	for artifact in "${LAST_DATABASE_ARTIFACT}" \
		"${LAST_UPLOAD_ARTIFACT}" "${LAST_MANIFEST}"; do
		[[ -s "${artifact}" ]] || fail "${name}: coherent snapshot was not retained"
		[[ "$(file_mode "${artifact}")" == '600' ]] \
			|| fail "${name}: retained artifact is not mode 0600"
	done
	[[ ! -e "${LAST_NETWORK_DIR}" ]] \
		|| fail "${name}: restricted credential copies were retained"
	assert_contains "${LAST_OUTPUT}" 'coherent local snapshot retained' \
		"${name}: retained coherent snapshot was not reported"
	assert_before "${LAST_LOG}" 'curl:health' 'restic:backup' \
		"${name}: remote work started before backend recovery"
}

assert_remote_failure_retained fail-restic-backup restic-backup
assert_remote_failure_retained fail-restic-forget restic-forget
assert_remote_failure_retained fail-restic-check restic-check

# A writable backup configuration is rejected before any external command.
write_backup_env
chmod 0644 "${BACKUP_ENV}"
run_case unsafe-config
[[ "${LAST_STATUS}" -ne 0 ]] || fail "group/other-readable backup env was accepted"
[[ ! -s "${LAST_LOG}" ]] || fail "unsafe config reached an external command"
write_backup_env

# Unknown variables and shell-looking values fail as data without evaluating or
# printing their values.
cat >>"${BACKUP_ENV}" <<'EOF'
UNEXPECTED_BACKUP_KEY=$(printf SHOULD_NOT_EXECUTE)
EOF
chmod 0600 "${BACKUP_ENV}"
run_case malformed-config
[[ "${LAST_STATUS}" -ne 0 ]] || fail "unexpected backup env key was accepted"
[[ ! -s "${LAST_LOG}" ]] || fail "malformed config reached an external command"
assert_not_contains "${LAST_OUTPUT}" 'SHOULD_NOT_EXECUTE' \
	"malformed config value was printed or evaluated"

# Local, plaintext, loopback and literal private-network repositories are not
# disaster-recovery copies. Reject every one before runtime interruption.
write_backup_env
unsafe_repositories=(
	"${FIXTURE_ROOT}/local-restic"
	'rest:http://backup.example/restic'
	's3:http://objects.example/bucket'
	'sftp:backup@localhost:/restic'
	'rest:https://127.0.0.1/restic'
	'sftp:backup@10.0.0.7:/restic'
	'sftp:backup@100.64.0.7:/restic'
	'sftp:backup@172.16.5.4:/restic'
	's3:https://192.168.1.8/bucket'
	'rest:https://169.254.2.3/restic'
	'sftp:backup@[::1]:/restic'
	'sftp:backup@[0:0:0:0:0:0:0:1]:/restic'
	'sftp:backup@[fd12::7]:/restic'
)
repository_index=0
for unsafe_repository in "${unsafe_repositories[@]}"; do
	repository_index=$((repository_index + 1))
	printf '%s\n' "${unsafe_repository}" >"${REPOSITORY_FILE}"
	chmod 0600 "${REPOSITORY_FILE}"
	run_case "unsafe-repository-${repository_index}"
	[[ "${LAST_STATUS}" -ne 0 ]] \
		|| fail "unsafe Restic repository ${repository_index} was accepted"
	[[ ! -s "${LAST_LOG}" ]] \
		|| fail "unsafe repository ${repository_index} interrupted the runtime"
done

# Explicit HTTPS Rest and S3 endpoints remain supported. These fixtures also
# guard against an over-broad plaintext-HTTP rejection.
safe_repositories=(
	'rest:https://backup.example/restic'
	's3:https://objects.example/peptides'
)
repository_index=0
for safe_repository in "${safe_repositories[@]}"; do
	repository_index=$((repository_index + 1))
	printf '%s\n' "${safe_repository}" >"${REPOSITORY_FILE}"
	chmod 0600 "${REPOSITORY_FILE}"
	run_case "safe-repository-${repository_index}"
	[[ "${LAST_STATUS}" -eq 0 ]] \
		|| fail "approved encrypted repository ${repository_index} was rejected"
done

printf 'sftp:fixture.invalid:/restic/peptides\n' >"${REPOSITORY_FILE}"
chmod 0600 "${REPOSITORY_FILE}"

# Exercise the real util-linux implementation when the test host can perform
# credential transitions. macOS fixtures still cover orchestration, while
# rootful Linux CI proves that the exact production flags leave no groups,
# capabilities or privilege-regain path in the executed child.
if [[ "$(uname -s)" == 'Linux' && "${EUID}" -eq 0 &&
	-x /usr/bin/setpriv && -r /proc/self/status ]] &&
	backup_test_uid="$(id -u nobody 2>/dev/null)" &&
	backup_test_gid="$(id -g nobody 2>/dev/null)" &&
	[[ "${backup_test_uid}" =~ ^[1-9][0-9]*$ &&
		"${backup_test_gid}" =~ ^[1-9][0-9]*$ ]]; then
	setpriv_result="$(
		/usr/bin/setpriv \
			"--reuid=${backup_test_uid}" \
			"--regid=${backup_test_gid}" \
			--clear-groups \
			--bounding-set=-all \
			--inh-caps=-all \
			--ambient-caps=-all \
			--no-new-privs \
			/usr/bin/env -i PATH=/usr/bin:/bin \
			/bin/sh -c '
				printf "uid=%s gid=%s groups=%s\n" \
					"$(id -u)" "$(id -g)" "$(id -G)"
				grep -E "^(Cap(Inh|Prm|Eff|Bnd|Amb)|NoNewPrivs):" \
					/proc/self/status
			'
	)" || fail "real setpriv credential transition failed"
	assert_contains <(printf '%s\n' "${setpriv_result}") \
		"^uid=${backup_test_uid} gid=${backup_test_gid} groups=${backup_test_gid}$" \
		"real setpriv child retained an unexpected identity or group"
	for capability_field in CapInh CapPrm CapEff CapBnd CapAmb; do
		assert_contains <(printf '%s\n' "${setpriv_result}") \
			"^${capability_field}:[[:space:]]+0+$" \
			"real setpriv child retained ${capability_field}"
	done
	assert_contains <(printf '%s\n' "${setpriv_result}") \
		'^NoNewPrivs:[[:space:]]+1$' \
		"real setpriv child can regain privilege"
fi

printf 'PASS: coherent backup pipeline fixtures\n'
