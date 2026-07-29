#!/usr/bin/env bash

set -euo pipefail

TEST_DIR="$(builtin cd "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
# shellcheck source=../lib/common.sh
builtin source "${TEST_DIR}/../lib/common.sh"
# shellcheck source=../lib/env-file.sh
builtin source "${TEST_DIR}/../lib/env-file.sh"

TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/peptides-env-loader.XXXXXX")"
readonly TEST_TMP
trap 'rm -rf "${TEST_TMP}"' EXIT

TEST_COUNT=0

fail() {
	printf 'not ok - %s\n' "$1" >&2
	exit 1
}

pass() {
	TEST_COUNT=$((TEST_COUNT + 1))
}

write_lines() {
	local destination="$1"
	shift
	printf '%s\n' "$@" > "${destination}"
}

assert_rejected() {
	local fixture="$1"
	shift
	if deploy_env_load_file "${fixture}" "$@" \
		>"${TEST_TMP}/stdout" 2>"${TEST_TMP}/stderr"; then
		fail 'invalid environment fixture was accepted'
	fi
	pass
}

# The repository templates are executable contracts for the two production
# allowlists. Loading them here catches drift when a variable is added to a
# template without a security review of the corresponding allowlist.
deploy_load_app_env_file "${TEST_DIR}/../.env.template"
deploy_load_caddy_env_file "${TEST_DIR}/../caddy.env.template"
pass

valid_file="${TEST_TMP}/valid.env"
write_lines "${valid_file}" \
	'# values are data, not shell input' \
	'SAFE_URL=postgres://user:p%40ss@127.0.0.1/db?sslmode=require&timeout=5' \
	'SAFE_HASH=$2a$14$literalbcryptdata' \
	'SAFE_LABEL=Bank Name & Co' \
	'SAFE_EMPTY='
deploy_env_load_file "${valid_file}" \
	SAFE_URL SAFE_HASH SAFE_LABEL SAFE_EMPTY
[[ "${SAFE_URL}" == \
	'postgres://user:p%40ss@127.0.0.1/db?sslmode=require&timeout=5' ]] \
	|| fail 'valid URL did not round-trip'
[[ "${SAFE_HASH}" == '$2a$14$literalbcryptdata' ]] \
	|| fail 'dollar-containing value did not remain literal'
[[ "${SAFE_LABEL}" == 'Bank Name & Co' ]] \
	|| fail 'embedded spaces did not round-trip'
[[ -z "${SAFE_EMPTY}" ]] || fail 'empty value did not round-trip'
pass

duplicate_file="${TEST_TMP}/duplicate.env"
write_lines "${duplicate_file}" 'SAFE_ONE=first' 'SAFE_ONE=second'
assert_rejected "${duplicate_file}" SAFE_ONE

malformed_file="${TEST_TMP}/malformed.env"
write_lines "${malformed_file}" 'SAFE_ONE'
assert_rejected "${malformed_file}" SAFE_ONE

malformed_name_file="${TEST_TMP}/malformed-name.env"
write_lines "${malformed_name_file}" ' SAFE_ONE=value'
assert_rejected "${malformed_name_file}" SAFE_ONE

unexpected_file="${TEST_TMP}/unexpected.env"
write_lines "${unexpected_file}" 'UNEXPECTED_NAME=value'
assert_rejected "${unexpected_file}" SAFE_ONE

forbidden_file="${TEST_TMP}/forbidden.env"
write_lines "${forbidden_file}" 'PATH=/untrusted/bin'
assert_rejected "${forbidden_file}" SAFE_ONE
assert_rejected "${forbidden_file}" PATH

atomic_file="${TEST_TMP}/atomic.env"
write_lines "${atomic_file}" 'SAFE_ONE=replacement' 'SAFE_TWO=$(exit 99)'
SAFE_ONE='original'
export SAFE_ONE
assert_rejected "${atomic_file}" SAFE_ONE SAFE_TWO
[[ "${SAFE_ONE}" == 'original' ]] \
	|| fail 'rejected file partially changed the environment'
pass

authoritative_file="${TEST_TMP}/authoritative.env"
write_lines "${authoritative_file}" 'SAFE_ONE=from-file'
SAFE_TWO='inherited'
export SAFE_TWO
deploy_env_load_file "${authoritative_file}" SAFE_ONE SAFE_TWO
[[ "${SAFE_ONE}" == 'from-file' ]] || fail 'validated value was not exported'
[[ -z "${SAFE_TWO+x}" ]] \
	|| fail 'absent allowlisted variable survived from the caller'
pass

marker="${TEST_TMP}/command-substitution-ran"
secret_token='fixture-secret-must-not-appear'
hostile_file="${TEST_TMP}/hostile.env"
write_lines "${hostile_file}" \
	"SAFE_ONE=\$(printf '${secret_token}' > '${marker}')"
if deploy_env_load_file "${hostile_file}" SAFE_ONE \
	>"${TEST_TMP}/hostile.stdout" 2>"${TEST_TMP}/hostile.stderr"; then
	fail 'command substitution fixture was accepted'
fi
[[ ! -e "${marker}" ]] || fail 'command substitution fixture executed'
if grep -F "${secret_token}" "${TEST_TMP}/hostile.stdout" \
	"${TEST_TMP}/hostile.stderr" >/dev/null; then
	fail 'a rejected fixture value was printed'
fi
pass

for syntax_case in \
	'SAFE_ONE=one;two' \
	'SAFE_ONE=`exit 99`' \
	'SAFE_ONE=${HOME}' \
	'SAFE_ONE=one|two' \
	'SAFE_ONE=one>two' \
	'SAFE_ONE="quoted"'
do
	syntax_file="${TEST_TMP}/syntax-${TEST_COUNT}.env"
	write_lines "${syntax_file}" "${syntax_case}"
	assert_rejected "${syntax_file}" SAFE_ONE
done

fake_bin="${TEST_TMP}/fake-bin"
mkdir -p "${fake_bin}"
write_lines "${fake_bin}/git" \
	'#!/usr/bin/env bash' \
	"printf 'executed' > '${TEST_TMP}/fake-git-ran'"
chmod 0700 "${fake_bin}/git"

PATH="${fake_bin}:${PATH}"
BASH_ENV="${TEST_TMP}/bash-env"
ENV="${TEST_TMP}/env"
CDPATH="${TEST_TMP}"
GLOBIGNORE='*'
LD_PRELOAD="${TEST_TMP}/loader"
GIT_SSH_COMMAND="${fake_bin}/git"
NODE_OPTIONS='--require=/does/not/exist'
NPM_CONFIG_SCRIPT_SHELL="${fake_bin}/git"
npm_config_userconfig="${TEST_TMP}/npmrc"
OPENSSL_CONF="${TEST_TMP}/openssl.cnf"
PGPASSFILE="${TEST_TMP}/pgpass"
RESTIC_PASSWORD='must-not-survive'
export PATH BASH_ENV ENV CDPATH GLOBIGNORE LD_PRELOAD GIT_SSH_COMMAND \
	NODE_OPTIONS NPM_CONFIG_SCRIPT_SHELL npm_config_userconfig OPENSSL_CONF \
	PGPASSFILE RESTIC_PASSWORD

deploy_sanitize_environment

[[ "${PATH}" == "${DEPLOY_TRUSTED_PATH}" ]] \
	|| fail 'trusted PATH was not installed'
for cleared_name in BASH_ENV ENV CDPATH GLOBIGNORE LD_PRELOAD \
	GIT_SSH_COMMAND NODE_OPTIONS NPM_CONFIG_SCRIPT_SHELL npm_config_userconfig \
	OPENSSL_CONF PGPASSFILE RESTIC_PASSWORD
do
	if [[ -n "${!cleared_name+x}" ]]; then
		fail 'an injection variable survived sanitization'
	fi
done
git --version >/dev/null
[[ ! -e "${TEST_TMP}/fake-git-ran" ]] \
	|| fail 'fake executable from the inherited PATH ran'
pass

# Bash imports exported functions before line one. The common entry library
# must remove them before any PATH-resolved root command can be dispatched.
inherited_function_result="$(
	env \
		'BASH_FUNC_git%%=() { printf "HIJACKED"; }' \
		'BASH_FUNC_source%%=() { printf "HIJACKED"; }' \
		TAR_OPTIONS='--checkpoint-action=exec=printf HIJACKED' \
		/bin/bash --noprofile --norc -c '
			builtin source "$1"
			deploy_sanitize_environment
			[[ -z "${TAR_OPTIONS+x}" ]] || exit 90
			[[ "$(type -t git)" != function ]] || exit 91
			[[ "$(type -t source)" != function ]] || exit 92
			printf SAFE
		' entry-test "${TEST_DIR}/../lib/common.sh"
)"
[[ "${inherited_function_result}" == SAFE ]] \
	|| fail 'imported functions or archive options survived sanitization'
pass

printf 'ok - %s environment loader assertions\n' "${TEST_COUNT}"
