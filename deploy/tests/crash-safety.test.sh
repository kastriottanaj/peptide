#!/usr/bin/env bash

set -euo pipefail

TEST_DIR="$(builtin cd "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
DEPLOY_DIR="$(builtin cd "${TEST_DIR}/.." && builtin pwd -P)"
DEPLOY_SCRIPT="${DEPLOY_DIR}/deploy.sh"
BOOTSTRAP_SCRIPT="${DEPLOY_DIR}/bootstrap-backend.sh"
RECOVERY_LIBRARY="${DEPLOY_DIR}/lib/recovery.sh"
MEDUSA_UNIT="${DEPLOY_DIR}/medusa.service"
CANDIDATE_UNIT="${DEPLOY_DIR}/medusa-candidate@.service"
GUARD_UNIT="${DEPLOY_DIR}/peptides-deploy-guard@.service"
ACTIVATION_GUARD_UNIT="${DEPLOY_DIR}/peptides-activation-watchdog@.service"
ACTIVATION_HELPER="${DEPLOY_DIR}/activation-fail-closed.sh"

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

first_line() {
	local file="$1" text="$2"
	grep -nF -- "${text}" "${file}" | head -n 1 | cut -d: -f1
}

assert_order() {
	local file="$1" before="$2" after="$3" description="$4"
	local before_line after_line
	before_line="$(first_line "${file}" "${before}")"
	after_line="$(first_line "${file}" "${after}")"
	[[ -n "${before_line}" && -n "${after_line}" \
		&& "${before_line}" -lt "${after_line}" ]] \
		|| fail "${description}"
}

grep -Fq 'deploy_recovery_write_operator_review \' "${DEPLOY_SCRIPT}" \
	|| fail "normal deploy does not persist recovery intent"
grep -Fq 'deploy_recovery_write_operator_review \' "${BOOTSTRAP_SCRIPT}" \
	|| fail "bootstrap does not persist recovery intent"
assert_order "${DEPLOY_SCRIPT}" \
	'deploy_recovery_write_operator_review \' \
	'systemctl start medusa-migrate \' \
	"normal deploy starts migration before durable recovery intent"
assert_order "${BOOTSTRAP_SCRIPT}" \
	'deploy_recovery_write_operator_review \' \
	'systemctl start medusa-migrate \' \
	"bootstrap starts migration before durable recovery intent"

grep -Fq '/usr/bin/sync -f "${temporary}"' "${RECOVERY_LIBRARY}" \
	|| fail "recovery marker contents are not fsynced"
grep -Fq '/usr/bin/mv -Tf "${temporary}" "${marker}"' "${RECOVERY_LIBRARY}" \
	|| fail "recovery marker is not atomically renamed"
grep -Fq '/usr/bin/sync -f "${marker_directory}"' "${RECOVERY_LIBRARY}" \
	|| fail "recovery marker directory is not fsynced"
grep -Fq 'deploy_state_validate_recovery_marker \' "${RECOVERY_LIBRARY}" \
	|| fail "durable marker is not canonically validated"

grep -Fq \
	'ExecStartPre=/usr/bin/test ! -e /srv/peptides/recovery-required' \
	"${MEDUSA_UNIT}" \
	|| fail "permanent Medusa can reboot through unresolved recovery"
grep -Fq 'BindsTo=peptides-deploy-guard@%i.service' "${CANDIDATE_UNIT}" \
	|| fail "candidate backend is not bound to deploy-shell liveness"
grep -Fq 'ExecStart=/usr/bin/tail --pid=%i -f /dev/null' "${GUARD_UNIT}" \
	|| fail "deploy liveness guard does not watch the invoking PID"
grep -Fq 'RuntimeMaxSec=900' "${CANDIDATE_UNIT}" \
	|| fail "candidate backend has no independent runtime ceiling"
grep -Fq 'ExecStopPost=/usr/bin/bash /srv/peptides/ops-current/deploy/activation-fail-closed.sh' \
	"${ACTIVATION_GUARD_UNIT}" \
	|| fail "activation watchdog cannot fail closed after deploy-shell loss"
grep -Fq '/usr/bin/systemctl --no-block stop \' "${ACTIVATION_HELPER}" \
	|| fail "activation shell-loss helper does not queue fail-closed stops"
grep -Fq 'caddy.service medusa.service' "${ACTIVATION_HELPER}" \
	|| fail "activation shell-loss helper does not stop routing and background writes"
assert_order "${DEPLOY_SCRIPT}" \
	'deploy_activation_write \' \
	'set_maintenance off' \
	"public maintenance can end before durable activation intent"
assert_order "${DEPLOY_SCRIPT}" \
	'set_deploy_phase "${PHASE_EXTERNAL_VERIFIED}"' \
	'deploy_activation_remove \' \
	"activation can commit before external verification"
grep -Fq \
	'ExecStartPre=/usr/bin/test ! -e /srv/peptides/activation-required' \
	"${MEDUSA_UNIT}" \
	|| fail "permanent Medusa can reboot through pending activation"

for script in "${DEPLOY_SCRIPT}" "${BOOTSTRAP_SCRIPT}"; do
	grep -Fq 'deploy_stop_and_prove_unit medusa.service' "${script}" \
		|| fail "${script##*/} does not prove backend drain"
	grep -Fq 'stop_candidate_runtime' "${script}" \
		|| fail "${script##*/} does not stop hidden candidate workers"
done

printf 'PASS: durable migration and crash-safety contracts\n'
