#!/usr/bin/env bash
#
# Deployment state and recovery-policy helpers.
#
# This file deliberately uses Bash builtins only. It is sourced by deploy.sh and
# can also be exercised in fixture tests without touching systemd, Caddy, the
# database, or production paths.

if [[ "${DEPLOY_STATE_LIBRARY_LOADED:-0}" == "1" ]]; then
	return 0
fi
DEPLOY_STATE_LIBRARY_LOADED=1

readonly PHASE_PRE_BUILD=pre-build
readonly PHASE_BUILT=built
readonly PHASE_MAINTENANCE=maintenance-entered
readonly PHASE_WRITES_STOPPED=writes-stopped
readonly PHASE_BACKUP_VERIFIED=backup-verified
readonly PHASE_MIGRATION_STARTED=migration-started
readonly PHASE_BACKEND_ACTIVATED=backend-activated
readonly PHASE_STOREFRONT_ACTIVATED=storefront-activated
readonly PHASE_EXTERNAL_VERIFIED=external-verified

readonly DEPLOY_RECOVERY_RESTORE_CONTROLS_CURRENT=restore-controls-and-current-service
readonly DEPLOY_RECOVERY_FAIL_CLOSED=fail-closed-and-require-operator-review

readonly DEPLOY_RECOVERY_ACTION_RESTORE=control-restore-required
readonly DEPLOY_RECOVERY_ACTION_OPERATOR_REVIEW=operator-review-required

deploy_state_is_phase() {
	local phase="${1:-}"

	case "${phase}" in
		"${PHASE_PRE_BUILD}" \
		| "${PHASE_BUILT}" \
		| "${PHASE_MAINTENANCE}" \
		| "${PHASE_WRITES_STOPPED}" \
		| "${PHASE_BACKUP_VERIFIED}" \
		| "${PHASE_MIGRATION_STARTED}" \
		| "${PHASE_BACKEND_ACTIVATED}" \
		| "${PHASE_STOREFRONT_ACTIVATED}" \
		| "${PHASE_EXTERNAL_VERIFIED}")
			return 0
			;;
		*)
			return 1
			;;
	esac
}

# A deployment may advance by exactly one phase. Skips, repeats, reversals and
# unknown phases are all rejected so cleanup never has to infer skipped work.
deploy_state_transition_allowed() {
	local current="${1:-}" target="${2:-}"

	case "${current}:${target}" in
		"${PHASE_PRE_BUILD}:${PHASE_BUILT}" \
		| "${PHASE_BUILT}:${PHASE_MAINTENANCE}" \
		| "${PHASE_MAINTENANCE}:${PHASE_WRITES_STOPPED}" \
		| "${PHASE_WRITES_STOPPED}:${PHASE_BACKUP_VERIFIED}" \
		| "${PHASE_BACKUP_VERIFIED}:${PHASE_MIGRATION_STARTED}" \
		| "${PHASE_MIGRATION_STARTED}:${PHASE_BACKEND_ACTIVATED}" \
		| "${PHASE_BACKEND_ACTIVATED}:${PHASE_STOREFRONT_ACTIVATED}" \
		| "${PHASE_STOREFRONT_ACTIVATED}:${PHASE_EXTERNAL_VERIFIED}")
			return 0
			;;
		*)
			return 1
			;;
	esac
}

deploy_state_require_transition() {
	local current="${1:-}" target="${2:-}"

	if ! deploy_state_is_phase "${current}"; then
		printf 'Unknown current deployment phase.\n' >&2
		return 1
	fi
	if ! deploy_state_is_phase "${target}"; then
		printf 'Unknown target deployment phase.\n' >&2
		return 1
	fi
	if ! deploy_state_transition_allowed "${current}" "${target}"; then
		printf 'Illegal deployment phase transition: %s -> %s\n' \
			"${current}" "${target}" >&2
		return 1
	fi
	return 0
}

# Before migration begins, the database schema still matches the active
# backend. Restoring the prior controls and starting that backend is safe.
# Once migration begins, old code must never be restarted automatically.
deploy_state_recovery_policy() {
	local phase="${1:-}"

	case "${phase}" in
		"${PHASE_PRE_BUILD}" \
		| "${PHASE_BUILT}" \
		| "${PHASE_MAINTENANCE}" \
		| "${PHASE_WRITES_STOPPED}" \
		| "${PHASE_BACKUP_VERIFIED}")
			printf '%s\n' "${DEPLOY_RECOVERY_RESTORE_CONTROLS_CURRENT}"
			;;
		"${PHASE_MIGRATION_STARTED}" \
		| "${PHASE_BACKEND_ACTIVATED}" \
		| "${PHASE_STOREFRONT_ACTIVATED}" \
		| "${PHASE_EXTERNAL_VERIFIED}")
			printf '%s\n' "${DEPLOY_RECOVERY_FAIL_CLOSED}"
			;;
		*)
			printf 'Cannot classify an unknown deployment phase.\n' >&2
			return 1
			;;
	esac
}

deploy_state_snapshot_path_is_safe() {
	local snapshot="${1:-}" sha="${2:-}" snapshot_root="${3:-}"
	local basename suffix

	[[ "${snapshot}" == /* ]] || return 1
	case "${snapshot}" in
		*'//'* \
		| *'/./'* \
		| *'/../'* \
		| */. \
		| */..)
			return 1
			;;
	esac

	basename="${snapshot##*/}"
	case "${basename}" in
		"${sha}."*)
			suffix="${basename#"${sha}."}"
			;;
		*)
			return 1
			;;
	esac
	[[ "${suffix}" =~ ^[A-Za-z0-9]{6}$ ]] || return 1

	if [[ -n "${snapshot_root}" ]]; then
		[[ "${snapshot_root}" == /* && "${snapshot_root}" != "/" ]] || return 1
		snapshot_root="${snapshot_root%/}"
		case "${snapshot_root}" in
			*'//'* \
			| *'/./'* \
			| *'/../'* \
			| */. \
			| */..)
				return 1
				;;
		esac
		case "${snapshot}" in
			"${snapshot_root}/${sha}."*)
				;;
			*)
				return 1
				;;
		esac
	fi
	return 0
}

# Recovery markers have one canonical line:
#
#   sha=<40 lowercase hex> phase=<phase> action=operator-review-required
#   sha=<40 lowercase hex> phase=<phase> action=control-restore-required \
#     snapshot=<absolute control-snapshot path>
#
# Marker ownership and mode remain deploy.sh's responsibility because obtaining
# them portably requires external stat implementations.
deploy_state_validate_recovery_marker() {
	local marker="${1:-}" snapshot_root="${2:-}"
	local line="" current_line="" line_count=0
	local sha phase action snapshot expected policy
	local -a fields

	[[ -n "${marker}" && -f "${marker}" && ! -L "${marker}" ]] || return 1

	while IFS= read -r current_line || [[ -n "${current_line}" ]]; do
		line_count=$((line_count + 1))
		[[ "${line_count}" -le 1 ]] || return 1
		line="${current_line}"
	done <"${marker}"
	[[ "${line_count}" -eq 1 && -n "${line}" ]] || return 1

	IFS=' ' read -r -a fields <<<"${line}"
	[[ "${#fields[@]}" -eq 3 || "${#fields[@]}" -eq 4 ]] || return 1

	case "${fields[0]}" in
		sha=*)
			sha="${fields[0]#sha=}"
			;;
		*)
			return 1
			;;
	esac
	[[ "${sha}" =~ ^[0-9a-f]{40}$ ]] || return 1

	case "${fields[1]}" in
		phase=*)
			phase="${fields[1]#phase=}"
			;;
		*)
			return 1
			;;
	esac
	deploy_state_is_phase "${phase}" || return 1

	case "${fields[2]}" in
		action=*)
			action="${fields[2]#action=}"
			;;
		*)
			return 1
			;;
	esac

	snapshot=""
	if [[ "${#fields[@]}" -eq 4 ]]; then
		case "${fields[3]}" in
			snapshot=*)
				snapshot="${fields[3]#snapshot=}"
				;;
			*)
				return 1
				;;
		esac
	fi

	policy="$(deploy_state_recovery_policy "${phase}")" || return 1
	case "${policy}:${action}" in
		"${DEPLOY_RECOVERY_RESTORE_CONTROLS_CURRENT}:${DEPLOY_RECOVERY_ACTION_RESTORE}")
			[[ -n "${snapshot}" ]] || return 1
			deploy_state_snapshot_path_is_safe \
				"${snapshot}" "${sha}" "${snapshot_root}" || return 1
			expected="sha=${sha} phase=${phase} action=${action} snapshot=${snapshot}"
			;;
		"${DEPLOY_RECOVERY_FAIL_CLOSED}:${DEPLOY_RECOVERY_ACTION_OPERATOR_REVIEW}")
			[[ -z "${snapshot}" ]] || return 1
			expected="sha=${sha} phase=${phase} action=${action}"
			;;
		*)
			return 1
			;;
	esac

	# This also rejects tabs, repeated/trailing spaces and reordered keys.
	[[ "${line}" == "${expected}" ]]
}

# Return codes:
#   0: no marker exists
#   1: a valid unresolved marker exists
#   2: a marker-like path exists but is malformed or unsafe
#
# Both nonzero outcomes must stop a deployment. Invalid markers fail closed
# rather than being ignored or removed automatically.
deploy_state_refuse_unresolved_recovery() {
	local marker="${1:-}" snapshot_root="${2:-}"

	[[ -n "${marker}" ]] || {
		printf 'Recovery marker path is required.\n' >&2
		return 2
	}
	if [[ ! -e "${marker}" && ! -L "${marker}" ]]; then
		return 0
	fi
	if deploy_state_validate_recovery_marker "${marker}" "${snapshot_root}"; then
		printf 'An unresolved deployment recovery marker exists; operator review is required.\n' >&2
		return 1
	fi
	printf 'The deployment recovery marker is malformed or unsafe; operator review is required.\n' >&2
	return 2
}
