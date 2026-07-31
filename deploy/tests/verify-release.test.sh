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
			if [[ "${FAKE_REGATED:-0}" == "1" ]]; then
				write_regated_response "${headers_file}"
			else
				write_public_html_response "${headers_file}" \
					"${body_file}" 200
			fi
			;;
		https://example.test/__deploy_missing__)
			write_public_html_response "${headers_file}" \
				"${body_file}" 404
			;;
		https://example.test/_astro/*)
			printf 'HTTP/2 200\r\n' >>"${headers_file}"
			printf '%s\r\n' \
				'Content-Type: text/javascript' \
				'Cache-Control: public, max-age=31536000, immutable' \
				>>"${headers_file}"
			write_common_headers "${headers_file}"
			printf '\r\n' >>"${headers_file}"
			printf 'globalThis.fixture = true;' >"${body_file}"
			printf 200
			;;
		*)
			printf 'unexpected fake URL: %s\n' "${url}" >&2
			return 91
			;;
	esac
}

# The storefront is public: HTML, cacheable-but-revalidating, and carrying
# neither WWW-Authenticate nor a site-wide noindex.
write_public_html_response() {
	local headers_file="$1" body_file="$2" status="$3"

	printf 'HTTP/2 %s\r\n' "${status}" >>"${headers_file}"
	printf '%s\r\n' \
		'Content-Type: text/html; charset=utf-8' \
		'Cache-Control: public, max-age=0, must-revalidate' \
		"Content-Security-Policy: default-src 'self'" \
		>>"${headers_file}"
	write_common_headers "${headers_file}"
	printf '\r\n' >>"${headers_file}"
	printf '<!doctype html><html><body>fixture</body></html>' \
		>"${body_file}"
	printf '%s' "${status}"
}

# What an accidental re-gating would look like. Verification must reject it.
write_regated_response() {
	local headers_file="$1"

	printf 'HTTP/2 401\r\n' >>"${headers_file}"
	printf '%s\r\n' \
		'WWW-Authenticate: Basic realm="Private preview"' \
		'Cache-Control: private, no-store' \
		>>"${headers_file}"
	write_common_headers "${headers_file}"
	printf '\r\n' >>"${headers_file}"
	printf 401
}

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

# The storefront went public on 2026-07-29. A 401 on the apex now means the
# site has been accidentally re-gated, and every future deploy must fail on it
# rather than reporting success against a shop nobody can reach.
FAKE_ARGUMENT_LOG="${TEST_TMP}/regated.arguments"
: >"${FAKE_ARGUMENT_LOG}"
if (
	FAKE_REGATED=1
	curl() {
		fake_curl "$@"
	}
	verify_main external example.test
) >"${TEST_TMP}/regated.out" 2>"${TEST_TMP}/regated.err"; then
	fail_test 'external mode accepted a re-gated 401 storefront'
fi
grep -q 'expected status 200, got 401' "${TEST_TMP}/regated.err" \
	|| fail_test 're-gating refusal reported the wrong reason'

# The gate modes are gone. Asking for them must be a usage error, not a
# silently accepted no-op that a stale runbook could keep invoking.
for removed_mode in authenticated authenticated-candidate; do
	FAKE_ARGUMENT_LOG="${TEST_TMP}/removed-${removed_mode}.arguments"
	: >"${FAKE_ARGUMENT_LOG}"
	if (
		curl() {
			fake_curl "$@"
		}
		verify_main "${removed_mode}" example.test fixture-user
	) >"${TEST_TMP}/removed-${removed_mode}.out" \
		2>"${TEST_TMP}/removed-${removed_mode}.err"; then
		fail_test "${removed_mode} mode is still accepted"
	fi
	grep -q 'usage: verify-release.sh' \
		"${TEST_TMP}/removed-${removed_mode}.err" \
		|| fail_test "${removed_mode} refusal did not report a usage error"
	[[ ! -s "${FAKE_ARGUMENT_LOG}" ]] \
		|| fail_test "${removed_mode} reached curl before refusing"
done

printf 'ok - public storefront and external API verification hardening\n'
