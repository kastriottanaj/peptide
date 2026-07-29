#!/usr/bin/env bash

set -euo pipefail

TEST_DIR="${BASH_SOURCE[0]%/*}"
[[ "${TEST_DIR}" != "${BASH_SOURCE[0]}" ]] || TEST_DIR='.'
TEST_DIR="$(builtin cd -- "${TEST_DIR}" && builtin pwd -P)"
REPO_DIR="$(builtin cd -- "${TEST_DIR}/../.." && builtin pwd -P)"

# shellcheck source=../lib/state.sh
source "${REPO_DIR}/deploy/lib/state.sh"

PASS_COUNT=0
FAIL_COUNT=0
TEST_COUNT=0

pass() {
	TEST_COUNT=$((TEST_COUNT + 1))
	PASS_COUNT=$((PASS_COUNT + 1))
	printf 'ok %s - %s\n' "${TEST_COUNT}" "$1"
}

fail() {
	TEST_COUNT=$((TEST_COUNT + 1))
	FAIL_COUNT=$((FAIL_COUNT + 1))
	printf 'not ok %s - %s\n' "${TEST_COUNT}" "$1" >&2
}

expect_success() {
	local description="$1"
	shift
	if "$@"; then
		pass "${description}"
	else
		fail "${description}"
	fi
}

expect_failure() {
	local description="$1"
	shift
	if "$@"; then
		fail "${description}"
	else
		pass "${description}"
	fi
}

expect_status() {
	local expected="$1" description="$2" status
	shift 2
	set +e
	"$@" >/dev/null 2>&1
	status="$?"
	set -e
	if [[ "${status}" -eq "${expected}" ]]; then
		pass "${description}"
	else
		printf 'expected status %s, got %s\n' "${expected}" "${status}" >&2
		fail "${description}"
	fi
}

expect_output() {
	local expected="$1" description="$2" actual
	shift 2
	if ! actual="$("$@")"; then
		fail "${description}"
		return
	fi
	if [[ "${actual}" == "${expected}" ]]; then
		pass "${description}"
	else
		printf 'expected output %q, got %q\n' "${expected}" "${actual}" >&2
		fail "${description}"
	fi
}

simulate_failure_policy() {
	local failure="$1" phase="${PHASE_PRE_BUILD}" target index

	case "${failure}" in
		build)
			target="${PHASE_PRE_BUILD}"
			;;
		backup)
			target="${PHASE_WRITES_STOPPED}"
			;;
		migration)
			target="${PHASE_MIGRATION_STARTED}"
			;;
		backend)
			# Backend startup/health can fail after migration began but before
			# backend-activated is persisted.
			target="${PHASE_MIGRATION_STARTED}"
			;;
		external)
			# Public verification runs after storefront activation.
			target="${PHASE_STOREFRONT_ACTIVATED}"
			;;
		*)
			return 2
			;;
	esac

	index=1
	while [[ "${phase}" != "${target}" ]]; do
		[[ "${index}" -lt "${#LEGAL_PHASES[@]}" ]] || return 1
		deploy_state_transition_allowed \
			"${phase}" "${LEGAL_PHASES[${index}]}" || return 1
		phase="${LEGAL_PHASES[${index}]}"
		index=$((index + 1))
	done
	deploy_state_recovery_policy "${phase}"
}

TMP_BASE="${TMPDIR:-/tmp}"
TMP_BASE="${TMP_BASE%/}"
TMP_ROOT="$(mktemp -d "${TMP_BASE}/peptides-state-test.XXXXXX")"
cleanup() {
	local status="$?"
	trap - EXIT
	case "${TMP_ROOT}" in
		"${TMP_BASE}/peptides-state-test."*)
			rm -rf -- "${TMP_ROOT}"
			;;
	esac
	exit "${status}"
}
trap cleanup EXIT

SNAPSHOT_ROOT="${TMP_ROOT}/control-snapshots"
mkdir -p "${SNAPSHOT_ROOT}"
SHA=0123456789abcdef0123456789abcdef01234567

LEGAL_PHASES=(
	"${PHASE_PRE_BUILD}"
	"${PHASE_BUILT}"
	"${PHASE_MAINTENANCE}"
	"${PHASE_WRITES_STOPPED}"
	"${PHASE_BACKUP_VERIFIED}"
	"${PHASE_MIGRATION_STARTED}"
	"${PHASE_BACKEND_ACTIVATED}"
	"${PHASE_STOREFRONT_ACTIVATED}"
	"${PHASE_EXTERNAL_VERIFIED}"
)

index=0
while [[ "${index}" -lt 8 ]]; do
	next=$((index + 1))
	expect_success \
		"legal transition ${LEGAL_PHASES[${index}]} -> ${LEGAL_PHASES[${next}]}" \
		deploy_state_require_transition \
		"${LEGAL_PHASES[${index}]}" "${LEGAL_PHASES[${next}]}"
	index="${next}"
done

expect_failure "phase skipping is rejected" \
	deploy_state_require_transition \
	"${PHASE_PRE_BUILD}" "${PHASE_MAINTENANCE}"
expect_failure "reverse transitions are rejected" \
	deploy_state_require_transition \
	"${PHASE_BACKEND_ACTIVATED}" "${PHASE_MIGRATION_STARTED}"
expect_failure "repeated transitions are rejected" \
	deploy_state_require_transition \
	"${PHASE_BUILT}" "${PHASE_BUILT}"
expect_failure "unknown current phases are rejected" \
	deploy_state_require_transition \
	compromised "${PHASE_BUILT}"
expect_failure "unknown target phases are rejected" \
	deploy_state_require_transition \
	"${PHASE_BUILT}" compromised

expect_output "${DEPLOY_RECOVERY_RESTORE_CONTROLS_CURRENT}" \
	"build failure restores prior controls and current service" \
	simulate_failure_policy build
expect_output "${DEPLOY_RECOVERY_RESTORE_CONTROLS_CURRENT}" \
	"backup failure restores prior controls and current service" \
	simulate_failure_policy backup
expect_output "${DEPLOY_RECOVERY_FAIL_CLOSED}" \
	"migration failure fails closed for operator review" \
	simulate_failure_policy migration
expect_output "${DEPLOY_RECOVERY_FAIL_CLOSED}" \
	"backend failure after migration fails closed for operator review" \
	simulate_failure_policy backend
expect_output "${DEPLOY_RECOVERY_FAIL_CLOSED}" \
	"external verification failure fails closed for operator review" \
	simulate_failure_policy external
expect_failure "unknown failure phases cannot be classified" \
	deploy_state_recovery_policy compromised

PRE_MARKER="${TMP_ROOT}/pre-recovery"
printf 'sha=%s phase=%s action=%s snapshot=%s/%s.A1b2C3\n' \
	"${SHA}" "${PHASE_WRITES_STOPPED}" \
	"${DEPLOY_RECOVERY_ACTION_RESTORE}" \
	"${SNAPSHOT_ROOT}" "${SHA}" >"${PRE_MARKER}"
expect_success "canonical pre-migration recovery marker is valid" \
	deploy_state_validate_recovery_marker "${PRE_MARKER}" "${SNAPSHOT_ROOT}"

POST_MARKER="${TMP_ROOT}/post-recovery"
printf 'sha=%s phase=%s action=%s\n' \
	"${SHA}" "${PHASE_MIGRATION_STARTED}" \
	"${DEPLOY_RECOVERY_ACTION_OPERATOR_REVIEW}" >"${POST_MARKER}"
expect_success "canonical post-migration recovery marker is valid" \
	deploy_state_validate_recovery_marker "${POST_MARKER}" "${SNAPSHOT_ROOT}"

expect_status 0 "an absent recovery marker permits deployment" \
	deploy_state_refuse_unresolved_recovery \
	"${TMP_ROOT}/absent" "${SNAPSHOT_ROOT}"
expect_status 1 "a valid unresolved marker refuses deployment" \
	deploy_state_refuse_unresolved_recovery \
	"${POST_MARKER}" "${SNAPSHOT_ROOT}"

BAD_ACTION="${TMP_ROOT}/bad-action"
printf 'sha=%s phase=%s action=%s\n' \
	"${SHA}" "${PHASE_WRITES_STOPPED}" \
	"${DEPLOY_RECOVERY_ACTION_OPERATOR_REVIEW}" >"${BAD_ACTION}"
expect_failure "pre-migration marker cannot demand post-migration policy" \
	deploy_state_validate_recovery_marker "${BAD_ACTION}" "${SNAPSHOT_ROOT}"

BAD_DOWNGRADE="${TMP_ROOT}/bad-downgrade"
printf 'sha=%s phase=%s action=%s snapshot=%s/%s.A1b2C3\n' \
	"${SHA}" "${PHASE_MIGRATION_STARTED}" \
	"${DEPLOY_RECOVERY_ACTION_RESTORE}" \
	"${SNAPSHOT_ROOT}" "${SHA}" >"${BAD_DOWNGRADE}"
expect_failure "post-migration marker cannot request automatic restoration" \
	deploy_state_validate_recovery_marker "${BAD_DOWNGRADE}" "${SNAPSHOT_ROOT}"

BAD_PHASE="${TMP_ROOT}/bad-phase"
printf 'sha=%s phase=not-a-phase action=%s\n' \
	"${SHA}" "${DEPLOY_RECOVERY_ACTION_OPERATOR_REVIEW}" >"${BAD_PHASE}"
expect_failure "unknown marker phase is rejected" \
	deploy_state_validate_recovery_marker "${BAD_PHASE}" "${SNAPSHOT_ROOT}"

BAD_SHA="${TMP_ROOT}/bad-sha"
printf 'sha=HEAD phase=%s action=%s\n' \
	"${PHASE_MIGRATION_STARTED}" \
	"${DEPLOY_RECOVERY_ACTION_OPERATOR_REVIEW}" >"${BAD_SHA}"
expect_failure "noncanonical marker SHA is rejected" \
	deploy_state_validate_recovery_marker "${BAD_SHA}" "${SNAPSHOT_ROOT}"

BAD_ROOT="${TMP_ROOT}/bad-root"
printf 'sha=%s phase=%s action=%s snapshot=/tmp/%s.A1b2C3\n' \
	"${SHA}" "${PHASE_WRITES_STOPPED}" \
	"${DEPLOY_RECOVERY_ACTION_RESTORE}" "${SHA}" >"${BAD_ROOT}"
expect_failure "snapshot outside the trusted root is rejected" \
	deploy_state_validate_recovery_marker "${BAD_ROOT}" "${SNAPSHOT_ROOT}"

BAD_TRAVERSAL="${TMP_ROOT}/bad-traversal"
printf 'sha=%s phase=%s action=%s snapshot=%s/../%s.A1b2C3\n' \
	"${SHA}" "${PHASE_WRITES_STOPPED}" \
	"${DEPLOY_RECOVERY_ACTION_RESTORE}" \
	"${SNAPSHOT_ROOT}" "${SHA}" >"${BAD_TRAVERSAL}"
expect_failure "snapshot traversal is rejected" \
	deploy_state_validate_recovery_marker "${BAD_TRAVERSAL}" "${SNAPSHOT_ROOT}"

BAD_SUFFIX="${TMP_ROOT}/bad-suffix"
printf 'sha=%s phase=%s action=%s snapshot=%s/%s.not-sixteen\n' \
	"${SHA}" "${PHASE_WRITES_STOPPED}" \
	"${DEPLOY_RECOVERY_ACTION_RESTORE}" \
	"${SNAPSHOT_ROOT}" "${SHA}" >"${BAD_SUFFIX}"
expect_failure "unexpected snapshot suffix is rejected" \
	deploy_state_validate_recovery_marker "${BAD_SUFFIX}" "${SNAPSHOT_ROOT}"

BAD_SPACING="${TMP_ROOT}/bad-spacing"
printf 'sha=%s  phase=%s action=%s\n' \
	"${SHA}" "${PHASE_MIGRATION_STARTED}" \
	"${DEPLOY_RECOVERY_ACTION_OPERATOR_REVIEW}" >"${BAD_SPACING}"
expect_failure "noncanonical marker spacing is rejected" \
	deploy_state_validate_recovery_marker "${BAD_SPACING}" "${SNAPSHOT_ROOT}"

BAD_MULTILINE="${TMP_ROOT}/bad-multiline"
printf 'sha=%s phase=%s action=%s\nignored=true\n' \
	"${SHA}" "${PHASE_MIGRATION_STARTED}" \
	"${DEPLOY_RECOVERY_ACTION_OPERATOR_REVIEW}" >"${BAD_MULTILINE}"
expect_failure "multiline marker injection is rejected" \
	deploy_state_validate_recovery_marker "${BAD_MULTILINE}" "${SNAPSHOT_ROOT}"

SYMLINK_MARKER="${TMP_ROOT}/symlink-marker"
ln -s "${POST_MARKER}" "${SYMLINK_MARKER}"
expect_failure "symlink recovery marker is rejected" \
	deploy_state_validate_recovery_marker "${SYMLINK_MARKER}" "${SNAPSHOT_ROOT}"
expect_status 2 "malformed marker fails closed during refusal" \
	deploy_state_refuse_unresolved_recovery \
	"${BAD_MULTILINE}" "${SNAPSHOT_ROOT}"
expect_status 2 "symlink marker fails closed during refusal" \
	deploy_state_refuse_unresolved_recovery \
	"${SYMLINK_MARKER}" "${SNAPSHOT_ROOT}"

printf '1..%s\n' "${TEST_COUNT}"
if [[ "${FAIL_COUNT}" -ne 0 ]]; then
	printf '%s state-machine test(s) failed\n' "${FAIL_COUNT}" >&2
	exit 1
fi
