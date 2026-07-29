#!/usr/bin/env bash
#
# Shared security primitives for the root-owned deployment scripts.
#
# This file intentionally uses Bash 3-compatible syntax so the focused tests
# can also run on the macOS development machines used for this repository.

# Remove every function and alias that existed before this root-controlled
# library was loaded. Bash imports BASH_FUNC_* definitions before executing a
# script, so unsetting only the environment variable is too late: a hostile
# `git()`, `source()` or `systemctl()` function would otherwise survive PATH
# sanitization and override the external command.
while IFS= read -r _deploy_inherited_function; do
	builtin unset -f "${_deploy_inherited_function}" 2>/dev/null || :
done < <(builtin compgen -A function)
builtin unalias -a 2>/dev/null || :
builtin unset -v _deploy_inherited_function

# Do not inherit the caller's executable search path. Every deployment process
# and child process starts from this root-controlled list instead.
if [[ "${DEPLOY_TRUSTED_PATH:-}" != \
	'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' ]]; then
	DEPLOY_TRUSTED_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
fi
readonly DEPLOY_TRUSTED_PATH

deploy_error() {
	printf '[deploy:error] %s\n' "$*" >&2
}

deploy_sanitize_environment() {
	local variable_name

	# Stop tracing before touching secrets. PS4 can itself contain command
	# substitutions, so discard it along with the other shell startup hooks.
	set +x +v
	builtin unset -v BASH_ENV ENV CDPATH GLOBIGNORE BASH_XTRACEFD \
		PROMPT_COMMAND PS4 2>/dev/null || :
	builtin export -n BASHOPTS SHELLOPTS 2>/dev/null || :

	# Remove every exported variable in the namespaces that can redirect a
	# loader, Git helper, Node runtime, or package manager. Prefix matching also
	# catches options added by future releases without maintaining a fragile
	# one-name-at-a-time denylist.
	while IFS= read -r variable_name; do
		case "${variable_name}" in
			BASH_FUNC_* | LD_* | DYLD_* | GIT_* | NODE_* | NPM_* | npm_* | \
				COREPACK_* | PNPM_* | YARN_* | PERL5OPT | PERL5LIB | \
				PYTHONHOME | PYTHONPATH | RUBYLIB | RUBYOPT | CURL_* | \
				SSL_CERT_* | OPENSSL_CONF | PGPASSFILE | PGSERVICE | \
				PGSERVICEFILE | RESTIC_* | RCLONE_* | RSYNC_* | \
				TAR_OPTIONS | GZIP | BZIP2 | BZIP | XZ_OPT | ZIPOPT | \
				UNZIP | UNZIPOPT | SYSTEMD_* | PAGER | LESS | \
				GREP_OPTIONS)
				builtin unset -v "${variable_name}" 2>/dev/null || :
				;;
		esac
	done < <(builtin compgen -e)

	IFS=$' \t\n'
	PATH="${DEPLOY_TRUSTED_PATH}"
	HOME=/root
	LANG=C.UTF-8
	LC_ALL=C.UTF-8
	TZ=UTC
	TMPDIR=/tmp
	export PATH HOME LANG LC_ALL TZ TMPDIR
	builtin hash -r
	umask 077
}

deploy_stop_and_prove_unit() {
	if [[ "$#" -ne 1 ]]; then
		deploy_error "deploy_stop_and_prove_unit requires one systemd unit"
		return 2
	fi
	local unit="$1" active_state sub_state control_group

	[[ "${unit}" =~ ^[A-Za-z0-9@_.-]+\.service$ ]] || {
		deploy_error "refusing a malformed systemd unit name"
		return 1
	}
	/usr/bin/systemctl stop "${unit}" || return 1
	active_state="$(
		/usr/bin/systemctl show "${unit}" \
			--property=ActiveState --value
	)" || return 1
	sub_state="$(
		/usr/bin/systemctl show "${unit}" \
			--property=SubState --value
	)" || return 1
	case "${active_state}:${sub_state}" in
		inactive:dead | failed:failed)
			;;
		*)
			deploy_error \
				"${unit} did not reach an inactive/dead or failed/failed state"
			return 1
			;;
	esac

	control_group="$(
		/usr/bin/systemctl show "${unit}" \
			--property=ControlGroup --value
	)" || return 1
	if [[ -n "${control_group}" ]]; then
		case "${control_group}" in
			/system.slice/*)
				;;
			*)
				deploy_error "${unit} reported an unexpected control group"
				return 1
				;;
		esac
		if [[ -r "/sys/fs/cgroup${control_group}/cgroup.procs" \
			&& -s "/sys/fs/cgroup${control_group}/cgroup.procs" ]]; then
			deploy_error "${unit} still owns a process after stop"
			return 1
		fi
	fi
	return 0
}

# Prove the three local identities that separate runtime secrets, untrusted
# package builds, and backup networking cannot alias one another. Each account
# owns a same-named primary group, has no supplementary groups, and is the sole
# passwd entry using that group.
deploy_validate_dedicated_identity() {
	if [[ "$#" -ne 2 ]]; then
		deploy_error \
			"deploy_validate_dedicated_identity requires USER EXPECTED_HOME"
		return 2
	fi
	local user="$1" expected_home="$2"
	local passwd_record group_record
	local name password uid gid gecos home shell
	local group_name group_password group_gid group_members
	local other_name other_password other_uid other_gid remainder

	passwd_record="$(/usr/bin/getent passwd "${user}")" || {
		deploy_error "could not resolve dedicated identity ${user}"
		return 1
	}
	IFS=: read -r name password uid gid gecos home shell \
		<<<"${passwd_record}"
	[[ "${name}" == "${user}" \
		&& "${uid}" =~ ^[1-9][0-9]*$ \
		&& "${gid}" =~ ^[1-9][0-9]*$ \
		&& "${home}" == "${expected_home}" \
		&& "${shell}" == "/usr/sbin/nologin" ]] || {
		deploy_error "${user} is not the expected dedicated non-login identity"
		return 1
	}

	group_record="$(/usr/bin/getent group "${user}")" || {
		deploy_error "could not resolve dedicated group ${user}"
		return 1
	}
	IFS=: read -r group_name group_password group_gid group_members \
		<<<"${group_record}"
	[[ "${group_name}" == "${user}" \
		&& "${group_gid}" == "${gid}" \
		&& -z "${group_members}" ]] || {
		deploy_error "${user} does not own an empty, same-named primary group"
		return 1
	}
	[[ "$(/usr/bin/id -G "${user}")" == "${gid}" ]] || {
		deploy_error "${user} has a supplementary group"
		return 1
	}

	while IFS=: read -r other_name other_password other_uid other_gid remainder; do
		if [[ "${other_name}" != "${user}" ]]; then
			if [[ "${other_uid}" == "${uid}" ]]; then
				deploy_error "${user} shares its UID with another account"
				return 1
			fi
			if [[ "${other_gid}" == "${gid}" ]]; then
				deploy_error "${user} shares its primary group with another account"
				return 1
			fi
		fi
	done < <(/usr/bin/getent passwd)
	return 0
}

deploy_assert_isolated_service_identities() {
	deploy_validate_dedicated_identity medusa /var/lib/peptides \
		|| return 1
	deploy_validate_dedicated_identity peptides-build /nonexistent \
		|| return 1
	deploy_validate_dedicated_identity \
		peptides-backup /var/lib/peptides-backup \
		|| return 1

	local medusa_uid medusa_gid build_uid build_gid backup_uid backup_gid
	medusa_uid="$(/usr/bin/id -u medusa)" || return 1
	medusa_gid="$(/usr/bin/id -g medusa)" || return 1
	build_uid="$(/usr/bin/id -u peptides-build)" || return 1
	build_gid="$(/usr/bin/id -g peptides-build)" || return 1
	backup_uid="$(/usr/bin/id -u peptides-backup)" || return 1
	backup_gid="$(/usr/bin/id -g peptides-backup)" || return 1

	[[ "${medusa_uid}" != "${build_uid}" \
		&& "${medusa_uid}" != "${backup_uid}" \
		&& "${build_uid}" != "${backup_uid}" \
		&& "${medusa_gid}" != "${build_gid}" \
		&& "${medusa_gid}" != "${backup_gid}" \
		&& "${build_gid}" != "${backup_gid}" ]] || {
		deploy_error "dedicated service identities share a UID or GID"
		return 1
	}
}

# Run a PostgreSQL client with a connection URI in its environment without ever
# placing that URI in an `env KEY=value` argument. `/proc/<pid>/cmdline` is
# broadly readable on many Linux hosts; the environment of the resulting
# root-owned client is not. The subshell also drops every inherited export
# before the direct exec.
deploy_run_pg_command() {
	if [[ "$#" -lt 2 ]]; then
		deploy_error "deploy_run_pg_command requires DATABASE_URL COMMAND [ARGS...]"
		return 2
	fi
	local database_url="$1"
	shift

	(
		local exported_name
		while IFS= read -r exported_name; do
			builtin unset -v "${exported_name}" 2>/dev/null || :
		done < <(builtin compgen -e)

		PATH="${DEPLOY_TRUSTED_PATH}"
		LANG=C.UTF-8
		LC_ALL=C.UTF-8
		TZ=UTC
		PGDATABASE="${database_url}"
		export PATH LANG LC_ALL TZ PGDATABASE
		exec "$@"
	)
}
