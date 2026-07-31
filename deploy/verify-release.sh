#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
[[ "${SCRIPT_DIR}" != "${BASH_SOURCE[0]}" ]] || SCRIPT_DIR='.'
SCRIPT_DIR="$(builtin cd -- "${SCRIPT_DIR}" && builtin pwd -P)"
# shellcheck source=lib/common.sh
builtin source "${SCRIPT_DIR}/lib/common.sh"
deploy_sanitize_environment

MODE=""
SITE_DOMAIN=""
ASSET_PATH=""
VERIFY_TMP=""
REQUEST_STATUS=""
REQUEST_HEADERS=""
REQUEST_BODY=""
ASSERTIONS=0

pass() {
	ASSERTIONS=$((ASSERTIONS + 1))
	printf 'PASS: %s\n' "$1"
}

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

request() {
	local name="$1" url="$2"
	shift 2

	REQUEST_HEADERS="${VERIFY_TMP}/${name}.headers"
	REQUEST_BODY="${VERIFY_TMP}/${name}.body"
	REQUEST_STATUS="$(
		# --disable must be curl's first option so a root account's curlrc
		# cannot alter verification or supply credentials.
		curl --disable --silent --show-error \
			--max-time 15 \
			--dump-header "${REQUEST_HEADERS}" \
			--output "${REQUEST_BODY}" \
			--write-out '%{http_code}' \
			"$@" \
			"${url}"
	)" || REQUEST_STATUS=000
}

header_value() {
	local header_name="$1"
	awk -v wanted="${header_name}" '
		BEGIN { IGNORECASE = 1 }
		{
			sub(/\r$/, "")
			name = $0
			sub(/:.*/, "", name)
			if (tolower(name) == tolower(wanted)) {
				sub(/^[^:]*:[[:space:]]*/, "")
				value = $0
			}
		}
		END { print value }
	' "${REQUEST_HEADERS}"
}

assert_status() {
	local expected="$1" description="$2"
	[[ "${REQUEST_STATUS}" == "${expected}" ]] \
		|| fail "${description}: expected status ${expected}, got ${REQUEST_STATUS}"
	pass "${description} status=${expected}"
}

assert_empty_body() {
	local description="$1" size
	size="$(wc -c <"${REQUEST_BODY}" | tr -d '[:space:]')"
	[[ "${size}" == "0" ]] \
		|| fail "${description}: expected an empty body, got ${size} bytes"
	pass "${description} empty-body"
}

assert_body_exact() {
	local expected="$1" description="$2" actual
	actual="$(<"${REQUEST_BODY}")"
	[[ "${actual}" == "${expected}" ]] \
		|| fail "${description}: response body did not match the expected health marker"
	pass "${description} exact-body"
}

assert_body_contains() {
	local pattern="$1" description="$2"
	grep -qiE "${pattern}" "${REQUEST_BODY}" \
		|| fail "${description}: expected content was absent"
	pass "${description} content"
}

assert_header_contains() {
	local name="$1" pattern="$2" description="$3" value
	value="$(header_value "${name}")"
	[[ "${value}" =~ ${pattern} ]] \
		|| fail "${description}: ${name} was absent or invalid"
	pass "${description} header=${name}"
}

assert_header_absent() {
	local name="$1" description="$2" value
	value="$(header_value "${name}")"
	[[ -z "${value}" ]] \
		|| fail "${description}: forbidden ${name} header was present"
	pass "${description} no-${name}"
}

assert_common_security_headers() {
	local description="$1"

	assert_header_contains Strict-Transport-Security \
		'^max-age=31536000; includeSubDomains$' "${description}"
	assert_header_contains X-Content-Type-Options '^nosniff$' "${description}"
	assert_header_contains Referrer-Policy \
		'^strict-origin-when-cross-origin$' "${description}"
	assert_header_contains X-Frame-Options '^DENY$' "${description}"
	assert_header_contains Permissions-Policy \
		'^tools=\(self\)$' "${description}"
	assert_header_absent Server "${description}"
	assert_header_absent X-Powered-By "${description}"
}

# The storefront is public as of 2026-07-29. These assertions are the inverse of
# the pre-launch ones: a 401 here now means the site has been accidentally
# re-gated, which is a regression rather than the expected state.
verify_public_path() {
	local path="$1" description="$2" expected_status="${3:-200}"

	request "public-${ASSERTIONS}" "https://${SITE_DOMAIN}${path}"
	assert_status "${expected_status}" "${description}"
	assert_body_contains '<!doctype|<html' "${description}"
	assert_header_contains Content-Type \
		'^text/html([[:space:]]*;|$)' \
		"${description}"
	assert_header_absent WWW-Authenticate "${description}"
	assert_common_security_headers "${description}"
}

verify_main() {
	MODE="${1:-}"
	SITE_DOMAIN="${2:-}"
	ASSET_PATH=""
	ASSERTIONS=0

	case "${MODE}" in
		backend | candidate | maintenance | external)
			if [[ "$#" -lt 2 || "$#" -gt 3 ]]; then
				deploy_error \
					'usage: verify-release.sh backend|candidate|maintenance|external DOMAIN [ASSET_PATH]'
				return 2
			fi
			ASSET_PATH="${3:-}"
			;;
		*)
			deploy_error \
				'usage: verify-release.sh backend|candidate|maintenance|external DOMAIN [ASSET_PATH]'
			return 2
			;;
	esac

	[[ "${SITE_DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]] \
		|| {
			deploy_error 'verification domain is malformed'
			return 2
		}
	if [[ -n "${ASSET_PATH}" \
		&& ! "${ASSET_PATH}" =~ ^/_astro/[A-Za-z0-9._-]+$ ]]; then
		deploy_error 'verification asset path is malformed'
		return 2
	fi
	VERIFY_TMP="$(mktemp -d "${TMPDIR:-/tmp}/peptides-verify.XXXXXX")"
	trap 'rm -rf -- "${VERIFY_TMP}"' EXIT

	case "${MODE}" in
		backend)
			request backend-health http://127.0.0.1:9000/health
			assert_status 200 'loopback backend health'
			assert_body_exact OK 'loopback backend health'
			;;
		candidate)
			request candidate-index "https://${SITE_DOMAIN}/" \
				--resolve "${SITE_DOMAIN}:443:127.0.0.1" \
				--header 'X-Peptides-Candidate: 1'
			assert_status 200 'loopback candidate storefront'
			assert_body_contains '<!doctype|<html' 'loopback candidate storefront'
			# Pages must revalidate, or a deploy takes a day to become visible.
			assert_header_contains Cache-Control \
				'must-revalidate' 'loopback candidate storefront'
			assert_header_contains Content-Security-Policy \
				'default-src' 'loopback candidate storefront'
			assert_common_security_headers 'loopback candidate storefront'

			if [[ -n "${ASSET_PATH}" ]]; then
				request candidate-asset \
					"https://${SITE_DOMAIN}${ASSET_PATH}" \
					--resolve "${SITE_DOMAIN}:443:127.0.0.1" \
					--header 'X-Peptides-Candidate: 1'
				assert_status 200 'loopback candidate asset'
				# Fingerprinted under /_astro/, so cacheable forever.
				assert_header_contains Cache-Control \
					'immutable' 'loopback candidate asset'
			fi
			;;
		maintenance)
			request maintenance-site "https://${SITE_DOMAIN}/" \
				--resolve "${SITE_DOMAIN}:443:127.0.0.1"
			assert_status 503 'maintenance storefront'
			assert_empty_body 'maintenance storefront'
			assert_header_contains Retry-After '^300$' 'maintenance storefront'

			request maintenance-api \
				"https://api.${SITE_DOMAIN}/store/carts" \
				--resolve "api.${SITE_DOMAIN}:443:127.0.0.1" \
				--request POST
			assert_status 503 'maintenance state-changing API'
			assert_empty_body 'maintenance state-changing API'
			assert_header_contains Retry-After '^300$' \
				'maintenance state-changing API'
			;;
		external)
			request public-health "https://api.${SITE_DOMAIN}/health"
			assert_status 200 'public backend health'
			assert_body_exact OK 'public backend health'
			assert_common_security_headers 'public backend health'

			verify_public_path / 'public storefront'
			# The custom 404 page is HTML and must keep the 404 status: a 200
			# here would be a soft 404 that search engines index as a real page.
			verify_public_path /__deploy_missing__ \
				'public missing path' 404

			if [[ -n "${ASSET_PATH}" ]]; then
				request public-asset "https://${SITE_DOMAIN}${ASSET_PATH}"
				assert_status 200 'public asset'
				assert_header_absent WWW-Authenticate 'public asset'
				assert_header_contains Cache-Control \
					'immutable' 'public asset'
				assert_common_security_headers 'public asset'
			fi
			;;
	esac

	printf 'PASS: %s verification assertions\n' "${ASSERTIONS}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	verify_main "$@"
fi
