#!/usr/bin/env bash
#
# Strict, data-only readers for deployment EnvironmentFile inputs.
#
# Accepted records are plain KEY=VALUE lines. Values are assigned with Bash's
# `export NAME=VALUE` builtin after the complete file has passed validation;
# this file never uses source, eval, shell expansion, or command substitution
# on input data.

_deploy_env_lib_dir="${BASH_SOURCE[0]%/*}"
if [[ "${_deploy_env_lib_dir}" == "${BASH_SOURCE[0]}" ]]; then
	_deploy_env_lib_dir='.'
fi
# Always replace inherited function definitions with the repository copy.
# shellcheck source=common.sh
builtin source "${_deploy_env_lib_dir}/common.sh"
builtin unset -v _deploy_env_lib_dir

# /srv/peptides/.env. Keep this list synchronized with deploy/.env.template.
DEPLOY_APP_ENV_ALLOWLIST=(
	DATABASE_URL
	REDIS_URL
	FILE_UPLOAD_DIR
	FILE_BACKEND_URL
	JWT_SECRET
	COOKIE_SECRET
	AUTH_MFA_ENCRYPTION_KEY
	SECURITY_HMAC_SECRET
	STORE_CORS
	ADMIN_CORS
	AUTH_CORS
	PUBLIC_SITE_URL
	PUBLIC_MEDUSA_BACKEND_URL
	PUBLIC_MEDUSA_PUBLISHABLE_KEY
	PUBLIC_GA_MEASUREMENT_ID
	PUBLIC_GOOGLE_SITE_VERIFICATION
	PUBLIC_BANK_ACCOUNT_HOLDER
	PUBLIC_BANK_IBAN
	PUBLIC_BANK_BIC
	PUBLIC_BANK_NAME
)

# /srv/peptides/caddy.env. GATE_USER, GATE_PASSWORD_HASH and SITE_GATED are
# still accepted but nothing reads them: the pre-launch gate was removed on
# 2026-07-29 and the Caddyfile no longer references them.
#
# They stay on the allowlist on purpose. An unknown key is a hard load failure,
# and the live server's caddy.env still carries all three — dropping them here
# would fail the next deploy until someone hand-edited a file on the box, which
# is exactly the manual intervention the single scripted path exists to avoid.
# They can be deleted from caddy.env whenever convenient; nothing breaks either
# way. Removing them from this list is safe only once that has happened.
DEPLOY_CADDY_ENV_ALLOWLIST=(
	SITE_DOMAIN
	ACME_EMAIL
	GATE_USER
	GATE_PASSWORD_HASH
	SITE_GATED
	MAINTENANCE_CONFIG
	CSP_CONFIG
)

deploy_env_error() {
	local file="$1"
	local line_number="$2"
	local message="$3"

	# Never include the rejected line or value: it may contain a credential.
	deploy_error "${file}:${line_number}: ${message}"
}

deploy_env_key_is_forbidden() {
	case "$1" in
		PATH | IFS | ENV | BASH_ENV | CDPATH | GLOBIGNORE | BASHOPTS | \
			SHELLOPTS | BASH_XTRACEFD | PROMPT_COMMAND | PS4 | \
			BASH_FUNC_* | LD_* | DYLD_* | GIT_* | NODE_* | NPM_* | npm_* | \
			COREPACK_* | PNPM_* | YARN_* | PERL5OPT | PERL5LIB | \
			PYTHONHOME | PYTHONPATH | RUBYLIB | RUBYOPT | CURL_* | \
			SSL_CERT_* | OPENSSL_CONF | PGPASSFILE | PGSERVICE | \
			PGSERVICEFILE | RESTIC_* | RCLONE_*)
			return 0
			;;
	esac
	return 1
}

deploy_env_key_is_allowed() {
	local requested_key="$1"
	local allowed_key
	shift

	for allowed_key in "$@"; do
		if [[ "${requested_key}" == "${allowed_key}" ]]; then
			return 0
		fi
	done
	return 1
}

deploy_env_value_has_shell_syntax() {
	local value="$1"

	# Dollar signs remain legal because Caddy bcrypt hashes contain them.
	# Reject only forms that a future accidental `source`/`eval` could execute,
	# along with quoting, escaping, and shell control/redirection syntax. Plain
	# URL query separators (`&`) and embedded spaces remain valid data.
	case "${value}" in
		*'$('* | *'${'* | *'`'* | *"'"* | *'"'* | *'\'* | *';'* | *'&&'* | \
			*'||'* | *'|'* | *'<'* | *'>'*)
			return 0
			;;
	esac
	return 1
}

# Usage:
#   deploy_env_load_file FILE ALLOWED_KEY [ALLOWED_KEY ...]
#
# On success, every allowlisted key is first removed from the inherited
# environment, then only keys present in FILE are exported. On failure, no
# parsed assignment is applied.
deploy_env_load_file() {
	if [[ "$#" -lt 2 ]]; then
		deploy_error 'deploy_env_load_file requires a file and an explicit allowlist'
		return 2
	fi

	local file="$1"
	shift
	local allowed_key
	local line=''
	local line_number=0
	local key
	local value
	local seen_keys='|'
	local parsed_count=0
	local index
	local -a parsed_keys=()
	local -a parsed_values=()

	for allowed_key in "$@"; do
		if [[ ! "${allowed_key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
			deploy_error 'environment allowlist contains a malformed name'
			return 2
		fi
		if deploy_env_key_is_forbidden "${allowed_key}"; then
			deploy_error "environment allowlist contains forbidden name ${allowed_key}"
			return 2
		fi
	done

	if [[ ! -f "${file}" || -L "${file}" ]]; then
		deploy_error "${file}: must be a regular, non-symlink file"
		return 1
	fi
	if [[ ! -r "${file}" ]]; then
		deploy_error "${file}: is not readable"
		return 1
	fi

	while IFS= read -r line || [[ -n "${line}" ]]; do
		line_number=$((line_number + 1))

		# Accept CRLF input, but reject any other carriage return below.
		if [[ "${line}" == *$'\r' ]]; then
			line="${line%$'\r'}"
		fi

		if [[ "${#line}" -gt 16384 ]]; then
			deploy_env_error "${file}" "${line_number}" 'line exceeds 16384 bytes'
			return 1
		fi
		if [[ "${line}" =~ ^[[:space:]]*$ || "${line}" =~ ^[[:space:]]*# ]]; then
			continue
		fi
		if [[ "${line}" != *=* ]]; then
			deploy_env_error "${file}" "${line_number}" 'expected KEY=VALUE'
			return 1
		fi

		key="${line%%=*}"
		value="${line#*=}"

		if [[ ! "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
			deploy_env_error "${file}" "${line_number}" 'malformed variable name'
			return 1
		fi
		if deploy_env_key_is_forbidden "${key}"; then
			deploy_env_error "${file}" "${line_number}" \
				"forbidden environment name ${key}"
			return 1
		fi
		if ! deploy_env_key_is_allowed "${key}" "$@"; then
			deploy_env_error "${file}" "${line_number}" \
				"unexpected environment name ${key}"
			return 1
		fi
		case "${seen_keys}" in
			*"|${key}|"*)
				deploy_env_error "${file}" "${line_number}" \
					"duplicate environment name ${key}"
				return 1
				;;
		esac
		if [[ "${value}" == [[:space:]]* || "${value}" == *[[:space:]] ]]; then
			deploy_env_error "${file}" "${line_number}" \
				'leading or trailing whitespace is not allowed in values'
			return 1
		fi
		if [[ "${value}" == *$'\r'* ]]; then
			deploy_env_error "${file}" "${line_number}" \
				'carriage returns are not allowed in values'
			return 1
		fi
		if deploy_env_value_has_shell_syntax "${value}"; then
			deploy_env_error "${file}" "${line_number}" \
				'shell syntax is not allowed in values'
			return 1
		fi

		seen_keys="${seen_keys}${key}|"
		parsed_keys[${parsed_count}]="${key}"
		parsed_values[${parsed_count}]="${value}"
		parsed_count=$((parsed_count + 1))
	done < "${file}"

	# The file is authoritative: do not retain allowlisted variables from the
	# root caller when they are absent from the validated file.
	for allowed_key in "$@"; do
		builtin unset -v "${allowed_key}" 2>/dev/null || :
	done
	for ((index = 0; index < parsed_count; index++)); do
		if ! builtin export \
			"${parsed_keys[${index}]}=${parsed_values[${index}]}"; then
			deploy_env_error "${file}" 0 'could not export a validated value'
			return 1
		fi
	done
}

deploy_load_app_env_file() {
	deploy_env_load_file "$1" "${DEPLOY_APP_ENV_ALLOWLIST[@]}"
}

deploy_validate_app_secret_values() {
	local secret_name secret_value first_name second_name
	local -a secret_names=(
		JWT_SECRET
		COOKIE_SECRET
		AUTH_MFA_ENCRYPTION_KEY
		SECURITY_HMAC_SECRET
	)

	for secret_name in "${secret_names[@]}"; do
		secret_value="${!secret_name-}"
		if [[ "${#secret_value}" -lt 32 \
			|| "${secret_value}" == "supersecret" ]]; then
			deploy_error \
				"${secret_name} must be a non-placeholder secret of at least 32 bytes"
			return 1
		fi
	done

	for first_name in "${secret_names[@]}"; do
		for second_name in "${secret_names[@]}"; do
			[[ "${first_name}" == "${second_name}" ]] && continue
			if [[ "${!first_name}" == "${!second_name}" ]]; then
				deploy_error "application signing/encryption secrets must be distinct"
				return 1
			fi
		done
	done
	return 0
}

deploy_load_caddy_env_file() {
	deploy_env_load_file "$1" "${DEPLOY_CADDY_ENV_ALLOWLIST[@]}"
}
