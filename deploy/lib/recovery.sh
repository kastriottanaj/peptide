#!/usr/bin/env bash
#
# Durable recovery-marker writes. A marker is committed before any forward-only
# database migration and fsynced so power loss cannot silently return the host
# to an old backend against a changed schema.

if [[ "${DEPLOY_RECOVERY_LIBRARY_LOADED:-0}" == "1" ]]; then
	return 0
fi
DEPLOY_RECOVERY_LIBRARY_LOADED=1

deploy_durable_write_line() {
	if [[ "$#" -ne 3 ]]; then
		deploy_error "deploy_durable_write_line requires FILE DIRECTORY LINE"
		return 2
	fi
	local destination="$1" directory="$2" line="$3" temporary

	[[ "${destination}" == "${directory}/"* \
		&& -d "${directory}" && ! -L "${directory}" \
		&& "${line}" != *$'\n'* && "${line}" != *$'\r'* \
		&& "${#line}" -le 16384 ]] || return 1
	temporary="$(
		/usr/bin/mktemp "${directory}/.durable-line.XXXXXX"
	)" || return 1
	printf '%s\n' "${line}" >"${temporary}" || return 1
	/usr/bin/chown root:root "${temporary}" || return 1
	/usr/bin/chmod 0600 "${temporary}" || return 1
	/usr/bin/sync -f "${temporary}" || return 1
	/usr/bin/mv -Tf "${temporary}" "${destination}" || return 1
	/usr/bin/sync -f "${directory}" || return 1
	[[ -f "${destination}" && ! -L "${destination}" \
		&& "$(<"${destination}")" == "${line}" ]]
}

deploy_recovery_write() {
	if [[ "$#" -lt 5 || "$#" -gt 6 ]]; then
		deploy_error \
			"deploy_recovery_write requires MARKER ROOT SHA PHASE ACTION [SNAPSHOT]"
		return 2
	fi

	local marker="$1" snapshot_root="$2" sha="$3" phase="$4" action="$5"
	local snapshot="${6:-}" marker_directory temporary

	[[ "${marker}" == /* && "${marker}" != "/" ]] || return 1
	marker_directory="${marker%/*}"
	[[ -d "${marker_directory}" && ! -L "${marker_directory}" ]] || return 1
	temporary="$(/usr/bin/mktemp "${marker_directory}/.recovery-required.XXXXXX")" \
		|| return 1

	if [[ -n "${snapshot}" ]]; then
		printf 'sha=%s phase=%s action=%s snapshot=%s\n' \
			"${sha}" "${phase}" "${action}" "${snapshot}" >"${temporary}" \
			|| return 1
	else
		printf 'sha=%s phase=%s action=%s\n' \
			"${sha}" "${phase}" "${action}" >"${temporary}" \
			|| return 1
	fi
	/usr/bin/chown root:root "${temporary}" || return 1
	/usr/bin/chmod 0600 "${temporary}" || return 1
	deploy_state_validate_recovery_marker \
		"${temporary}" "${snapshot_root}" || return 1
	/usr/bin/sync -f "${temporary}" || return 1
	/usr/bin/mv -Tf "${temporary}" "${marker}" || return 1
	/usr/bin/sync -f "${marker_directory}" || return 1
	deploy_state_validate_recovery_marker \
		"${marker}" "${snapshot_root}" || return 1
	return 0
}

deploy_recovery_write_operator_review() {
	[[ "$#" -eq 4 ]] || return 2
	deploy_recovery_write \
		"$1" "$2" "$3" "$4" \
		"${DEPLOY_RECOVERY_ACTION_OPERATOR_REVIEW}"
}

deploy_recovery_write_control_restore() {
	[[ "$#" -eq 5 ]] || return 2
	deploy_recovery_write \
		"$1" "$2" "$3" "$4" \
		"${DEPLOY_RECOVERY_ACTION_RESTORE}" "$5"
}

deploy_recovery_remove() {
	if [[ "$#" -ne 3 ]]; then
		deploy_error "deploy_recovery_remove requires MARKER ROOT DIRECTORY"
		return 2
	fi
	local marker="$1" snapshot_root="$2" marker_directory="$3"

	[[ -f "${marker}" && ! -L "${marker}" ]] || return 1
	deploy_state_validate_recovery_marker \
		"${marker}" "${snapshot_root}" || return 1
	/usr/bin/unlink "${marker}" || return 1
	/usr/bin/sync -f "${marker_directory}" || return 1
	[[ ! -e "${marker}" && ! -L "${marker}" ]]
}

deploy_activation_validate() {
	[[ "$#" -eq 2 ]] || return 2
	local marker="$1" sha="$2" line current_line line_count=0

	[[ -f "${marker}" && ! -L "${marker}" ]] || return 1
	[[ "${sha}" =~ ^[0-9a-f]{40}$ ]] || return 1
	line=""
	while IFS= read -r current_line || [[ -n "${current_line}" ]]; do
		line_count=$((line_count + 1))
		[[ "${line_count}" -eq 1 ]] || return 1
		line="${current_line}"
	done <"${marker}"
	[[ "${line}" == \
		"sha=${sha} phase=activation-pending action=external-verification-required" ]]
}

deploy_activation_write() {
	[[ "$#" -eq 3 ]] || return 2
	local marker="$1" directory="$2" sha="$3" temporary

	[[ "${marker}" == "${directory}/activation-required" \
		&& -d "${directory}" && ! -L "${directory}" ]] || return 1
	temporary="$(
		/usr/bin/mktemp "${directory}/.activation-required.XXXXXX"
	)" || return 1
	printf 'sha=%s phase=activation-pending action=external-verification-required\n' \
		"${sha}" >"${temporary}" || return 1
	/usr/bin/chown root:root "${temporary}" || return 1
	/usr/bin/chmod 0600 "${temporary}" || return 1
	deploy_activation_validate "${temporary}" "${sha}" || return 1
	/usr/bin/sync -f "${temporary}" || return 1
	/usr/bin/mv -Tf "${temporary}" "${marker}" || return 1
	/usr/bin/sync -f "${directory}" || return 1
	deploy_activation_validate "${marker}" "${sha}"
}

deploy_activation_remove() {
	[[ "$#" -eq 3 ]] || return 2
	local marker="$1" directory="$2" sha="$3"

	deploy_activation_validate "${marker}" "${sha}" || return 1
	/usr/bin/unlink "${marker}" || return 1
	/usr/bin/sync -f "${directory}" || return 1
	[[ ! -e "${marker}" && ! -L "${marker}" ]]
}
