#!/usr/bin/env bash

set -euo pipefail

TEST_DIR="$(builtin cd "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
VERIFY_SCRIPT="${TEST_DIR}/../verify-release.sh"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/peptides-verify-test.XXXXXX")"
trap 'rm -rf -- "${TEST_TMP}"' EXIT

# Load the verifier before defining test doubles. Its root-script sanitizer
# intentionally removes every pre-existing shell function.
# shellcheck source=../verify-release.sh
builtin source "${VERIFY_SCRIPT}"

fail_test() {
	printf 'not ok - %s\n' "$1" >&2
	exit 1
}

write_common_headers() {
	local headers_file="$1"

	printf '%s\r\n' \
		'Strict-Transport-Security: max-age=31536000; includeSubDomains' \
		'X-Content-Type-Options: nosniff' \
		'Referrer-Policy: strict-origin-when-cross-origin' \
		'X-Frame-Options: DENY' \
		>>"${headers_file}"
	if [[ "${OMIT_API_PERMISSIONS:-0}" != "1" ]]; then
		printf '%s\r\n' 'Permissions-Policy: tools=(self)' >>"${headers_file}"
	fi
}

fake_curl() {
	local headers_file="" body_file="" url="" fake_user="" argument=""

	printf '%s\n' BEGIN >>"${FAKE_ARGUMENT_LOG}"
	for argument in "$@"; do
		printf 'ARG=%s\n' "${argument}" >>"${FAKE_ARGUMENT_LOG}"
	done

	while [[ "$#" -gt 0 ]]; do
		case "$1" in
			--dump-header)
				headers_file="$2"
				shift 2
				;;
			--output)
				body_file="$2"
				shift 2
				;;
			--user)
				fake_user="$2"
				shift 2
				;;
			--max-time | --write-out | --resolve | --header | --request)
				shift 2
				;;
			http://* | https://*)
				url="$1"
				shift
				;;
			*)
				shift
				;;
		esac
	done

	[[ -n "${headers_file}" && -n "${body_file}" && -n "${url}" ]] \
		|| {
			printf 'fake curl received an incomplete request\n' >&2
			return 90
		}

	: >"${headers_file}"
	: >"${body_file}"

	case "${url}" in
		https://api.example.test/health)
			printf 'HTTP/2 200\r\n' >>"${headers_file}"
			printf 'Content-Type: text/plain\r\n' >>"${headers_file}"
			write_common_headers "${headers_file}"
			printf '\r\n' >>"${headers_file}"
			printf OK >"${body_file}"
			printf 200
			;;
		https://example.test/)
			if [[ "${fake_user}" == "fixture-user" ]]; then
				printf 'HTTP/2 200\r\n' >>"${headers_file}"
				printf '%s\r\n' \
					'Content-Type: text/html; charset=utf-8' \
					'Cache-Control: private, no-store' \
					"Content-Security-Policy: default-src 'self'" \
					'X-Robots-Tag: noindex, nofollow' \
					>>"${headers_file}"
				write_common_headers "${headers_file}"
				printf '\r\n' >>"${headers_file}"
				printf '<!doctype html><html><body>fixture</body></html>' \
					>"${body_file}"
				printf 200
			else
				write_unauthenticated_response \
					"${headers_file}"
			fi
			;;
		https://example.test/*)
			write_unauthenticated_response "${headers_file}"
			;;
		*)
			printf 'unexpected fake URL: %s\n' "${url}" >&2
			return 91
			;;
	esac
}

write_unauthenticated_response() {
	local headers_file="$1"

	printf 'HTTP/2 401\r\n' >>"${headers_file}"
	printf '%s\r\n' \
		'WWW-Authenticate: Basic realm="Private preview"' \
		'Cache-Control: private, no-store' \
		'X-Robots-Tag: noindex, nofollow' \
		>>"${headers_file}"
	write_common_headers "${headers_file}"
	printf '\r\n' >>"${headers_file}"
	printf 401
}

FAKE_ARGUMENT_LOG="${TEST_TMP}/authenticated-curl.arguments"
: >"${FAKE_ARGUMENT_LOG}"
if ! (
	curl() {
		fake_curl "$@"
	}
	require_interactive_authentication() {
		return 0
	}
	verify_main authenticated example.test fixture-user
) >"${TEST_TMP}/authenticated.out" 2>"${TEST_TMP}/authenticated.err"; then
	cat "${TEST_TMP}/authenticated.err" >&2
	fail_test 'authenticated fixture verification failed'
fi

grep -q 'authenticated public storefront status=200' \
	"${TEST_TMP}/authenticated.out" \
	|| fail_test 'authenticated mode did not verify the 200 response'
grep -q 'authenticated public storefront content' \
	"${TEST_TMP}/authenticated.out" \
	|| fail_test 'authenticated mode did not verify the HTML body'
grep -q 'header=Content-Type' "${TEST_TMP}/authenticated.out" \
	|| fail_test 'authenticated mode did not verify the HTML content type'
grep -q 'header=Cache-Control' "${TEST_TMP}/authenticated.out" \
	|| fail_test 'authenticated mode did not verify private cache control'
grep -q 'header=Content-Security-Policy' "${TEST_TMP}/authenticated.out" \
	|| fail_test 'authenticated mode did not verify the enforced CSP'
grep -q 'header=Permissions-Policy' "${TEST_TMP}/authenticated.out" \
	|| fail_test 'authenticated mode did not verify common security headers'

[[ "$(sed -n '2p' "${FAKE_ARGUMENT_LOG}")" == 'ARG=--disable' ]] \
	|| fail_test 'curl config disabling was not the first curl option'
awk '
	$0 == "ARG=--user" {
		getline
		if ($0 == "ARG=fixture-user") {
			found = 1
		}
	}
	END { exit !found }
' "${FAKE_ARGUMENT_LOG}" \
	|| fail_test 'authenticated mode did not pass the username to curl'
if grep -q 'fixture-user:' "${FAKE_ARGUMENT_LOG}"; then
	fail_test 'authenticated mode passed a password-shaped userinfo argument'
fi
if grep -q 'fixture-password' "${FAKE_ARGUMENT_LOG}"; then
	fail_test 'authenticated mode exposed a password to curl arguments'
fi

FAKE_ARGUMENT_LOG="${TEST_TMP}/authenticated-candidate-curl.arguments"
: >"${FAKE_ARGUMENT_LOG}"
if ! (
	curl() {
		fake_curl "$@"
	}
	require_interactive_authentication() {
		return 0
	}
	verify_main authenticated-candidate example.test fixture-user
) >"${TEST_TMP}/authenticated-candidate.out" \
	2>"${TEST_TMP}/authenticated-candidate.err"; then
	cat "${TEST_TMP}/authenticated-candidate.err" >&2
	fail_test 'authenticated candidate fixture verification failed'
fi

grep -q 'authenticated loopback candidate storefront status=200' \
	"${TEST_TMP}/authenticated-candidate.out" \
	|| fail_test 'authenticated candidate mode did not verify the 200 response'
grep -q 'authenticated loopback candidate storefront content' \
	"${TEST_TMP}/authenticated-candidate.out" \
	|| fail_test 'authenticated candidate mode did not verify the HTML body'
grep -q 'header=Content-Type' "${TEST_TMP}/authenticated-candidate.out" \
	|| fail_test 'authenticated candidate mode did not verify the HTML content type'
grep -q 'header=Cache-Control' "${TEST_TMP}/authenticated-candidate.out" \
	|| fail_test 'authenticated candidate mode did not verify private cache control'
grep -q 'header=Content-Security-Policy' \
	"${TEST_TMP}/authenticated-candidate.out" \
	|| fail_test 'authenticated candidate mode did not verify the enforced CSP'
grep -q 'header=Permissions-Policy' \
	"${TEST_TMP}/authenticated-candidate.out" \
	|| fail_test 'authenticated candidate mode skipped common security headers'

awk '
	$0 == "ARG=--resolve" {
		getline
		if ($0 == "ARG=example.test:443:127.0.0.1") {
			found = 1
		}
	}
	END { exit !found }
' "${FAKE_ARGUMENT_LOG}" \
	|| fail_test 'authenticated candidate mode did not pin DNS to loopback'
awk '
	$0 == "ARG=--noproxy" {
		getline
		if ($0 == "ARG=*") {
			found = 1
		}
	}
	END { exit !found }
' "${FAKE_ARGUMENT_LOG}" \
	|| fail_test 'authenticated candidate mode allowed a proxy to bypass loopback'
awk '
	$0 == "ARG=--header" {
		getline
		if ($0 == "ARG=X-Peptides-Gate-Probe: 1") {
			found = 1
		}
	}
	END { exit !found }
' "${FAKE_ARGUMENT_LOG}" \
	|| fail_test 'authenticated candidate mode omitted its gate-probe header'
awk '
	$0 == "ARG=--user" {
		getline
		if ($0 == "ARG=fixture-user") {
			found = 1
		}
	}
	END { exit !found }
' "${FAKE_ARGUMENT_LOG}" \
	|| fail_test 'authenticated candidate mode did not pass the username to curl'
if grep -q 'fixture-user:' "${FAKE_ARGUMENT_LOG}"; then
	fail_test 'authenticated candidate mode passed password-shaped userinfo'
fi
if grep -q 'fixture-password' "${FAKE_ARGUMENT_LOG}"; then
	fail_test 'authenticated candidate mode exposed a password to curl arguments'
fi

FAKE_ARGUMENT_LOG="${TEST_TMP}/external-curl.arguments"
: >"${FAKE_ARGUMENT_LOG}"
if ! (
	curl() {
		fake_curl "$@"
	}
	verify_main external example.test
) >"${TEST_TMP}/external.out" 2>"${TEST_TMP}/external.err"; then
	cat "${TEST_TMP}/external.err" >&2
	fail_test 'external fixture verification failed'
fi
grep -q 'public backend health header=Strict-Transport-Security' \
	"${TEST_TMP}/external.out" \
	|| fail_test 'external mode skipped API transport-security verification'
grep -q 'public backend health header=Permissions-Policy' \
	"${TEST_TMP}/external.out" \
	|| fail_test 'external mode skipped API permissions-policy verification'

FAKE_ARGUMENT_LOG="${TEST_TMP}/missing-api-header.arguments"
: >"${FAKE_ARGUMENT_LOG}"
if (
	OMIT_API_PERMISSIONS=1
	curl() {
		fake_curl "$@"
	}
	verify_main external example.test
) >"${TEST_TMP}/missing-api-header.out" \
	2>"${TEST_TMP}/missing-api-header.err"; then
	fail_test 'external mode accepted an API response missing a security header'
fi
grep -q 'Permissions-Policy was absent or invalid' \
	"${TEST_TMP}/missing-api-header.err" \
	|| fail_test 'external mode failed for the wrong missing-header reason'

FAKE_ARGUMENT_LOG="${TEST_TMP}/noninteractive.arguments"
: >"${FAKE_ARGUMENT_LOG}"
if (
	curl() {
		fake_curl "$@"
	}
	verify_main authenticated example.test fixture-user </dev/null
) >"${TEST_TMP}/noninteractive.out" 2>"${TEST_TMP}/noninteractive.err"; then
	fail_test 'authenticated mode accepted a non-interactive input stream'
fi
grep -q 'requires an interactive terminal' "${TEST_TMP}/noninteractive.err" \
	|| fail_test 'non-interactive refusal did not explain the secure prompt requirement'
[[ ! -s "${FAKE_ARGUMENT_LOG}" ]] \
	|| fail_test 'non-interactive mode reached curl before refusing'

FAKE_ARGUMENT_LOG="${TEST_TMP}/malformed-user.arguments"
: >"${FAKE_ARGUMENT_LOG}"
if (
	curl() {
		fake_curl "$@"
	}
	verify_main authenticated example.test 'fixture-user:password'
) >"${TEST_TMP}/malformed-user.out" 2>"${TEST_TMP}/malformed-user.err"; then
	fail_test 'authenticated mode accepted a malformed gate username'
fi
grep -q 'gate username is malformed' "${TEST_TMP}/malformed-user.err" \
	|| fail_test 'malformed username refusal reported the wrong reason'
[[ ! -s "${FAKE_ARGUMENT_LOG}" ]] \
	|| fail_test 'malformed username reached curl before validation'

FAKE_ARGUMENT_LOG="${TEST_TMP}/empty-user.arguments"
: >"${FAKE_ARGUMENT_LOG}"
if (
	curl() {
		fake_curl "$@"
	}
	verify_main authenticated example.test ''
) >"${TEST_TMP}/empty-user.out" 2>"${TEST_TMP}/empty-user.err"; then
	fail_test 'authenticated mode accepted an empty gate username'
fi
grep -q 'gate username is malformed' "${TEST_TMP}/empty-user.err" \
	|| fail_test 'empty username refusal reported the wrong reason'
[[ ! -s "${FAKE_ARGUMENT_LOG}" ]] \
	|| fail_test 'empty username reached curl before validation'

printf 'ok - authenticated gate and external API verification hardening\n'
