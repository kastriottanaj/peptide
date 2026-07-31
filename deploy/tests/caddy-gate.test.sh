#!/usr/bin/env bash
#
# Exercise the committed production Caddy routes on isolated loopback ports.
# The test adapts only addresses, the canonical redirect and the API upstream;
# every route, matcher, gate, error handler and imported maintenance snippet
# continues to come from deploy/Caddyfile.

set -euo pipefail
umask 077

TEST_DIR="$(builtin cd "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
DEPLOY_DIR="$(builtin cd "${TEST_DIR}/.." && builtin pwd -P)"
PRODUCTION_CONFIG="${DEPLOY_DIR}/Caddyfile"
FIXTURE_DIR="${TEST_DIR}/fixtures/caddy"
CADDY_BIN="${CADDY_BIN:-$(command -v caddy || true)}"
CURL_BIN="${CURL_BIN:-$(command -v curl || true)}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/peptides-caddy-gate.XXXXXX")"
ADAPTED_CONFIG="${TEST_TMP}/Caddyfile"
CADDY_LOG="${TEST_TMP}/caddy.log"
CADDY_PID=''
LAST_STATUS=''
LAST_HEADERS=''
LAST_BODY=''
ASSERTION_COUNT=0

readonly TEST_DIR DEPLOY_DIR PRODUCTION_CONFIG FIXTURE_DIR
readonly CADDY_BIN CURL_BIN NODE_BIN TEST_TMP ADAPTED_CONFIG CADDY_LOG

cleanup_caddy() {
	if [[ -n "${CADDY_PID}" ]] && kill -0 "${CADDY_PID}" 2>/dev/null; then
		kill "${CADDY_PID}" 2>/dev/null || true
		wait "${CADDY_PID}" 2>/dev/null || true
	fi
	CADDY_PID=''
}

cleanup() {
	cleanup_caddy
	if [[ "${KEEP_CADDY_TEST_TMP:-0}" == '1' ]]; then
		printf 'Caddy fixture retained at %s\n' "${TEST_TMP}" >&2
	else
		rm -rf "${TEST_TMP}"
	fi
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

fail() {
	local message="$1"
	if [[ -s "${CADDY_LOG}" ]]; then
		printf 'Caddy log:\n' >&2
		tail -n 80 "${CADDY_LOG}" >&2
	fi
	printf 'FAIL: %s\n' "${message}" >&2
	exit 1
}

pass() {
	ASSERTION_COUNT=$((ASSERTION_COUNT + 1))
}

[[ -n "${CADDY_BIN}" && -x "${CADDY_BIN}" ]] \
	|| fail 'caddy is required for the behavioral fixture'
[[ -n "${CURL_BIN}" && -x "${CURL_BIN}" ]] \
	|| fail 'curl is required for the behavioral fixture'
[[ -n "${NODE_BIN}" && -x "${NODE_BIN}" ]] \
	|| fail 'node is required to allocate isolated loopback ports'

assert_production_shape() {
	local expected="$1"
	local wanted="${2:-1}"
	local count
	count="$(
		awk -v expected="${expected}" '
			{
				line = $0
				sub(/^[[:space:]]+/, "", line)
				sub(/[[:space:]]+$/, "", line)
				if (line == expected) count += 1
			}
			END { print count + 0 }
		' "${PRODUCTION_CONFIG}"
	)"
	[[ "${count}" == "${wanted}" ]] \
		|| fail "production Caddyfile shape changed around: ${expected}"
}

assert_production_shape '{$SITE_DOMAIN} {'
assert_production_shape 'www.{$SITE_DOMAIN} {'
assert_production_shape 'api.{$SITE_DOMAIN} {'
assert_production_shape 'redir https://{$SITE_DOMAIN}{uri} permanent'
assert_production_shape 'reverse_proxy 127.0.0.1:9000 {'
assert_production_shape 'root * /srv/peptides/storefront-current'
# One loopback-only route serves the candidate tree: the root verification
# bypass. The second one, the gate probe that exercised the basic-auth hash
# before a storefront existed, went with the gate on 2026-07-29.
assert_production_shape 'root * /srv/peptides/storefront-candidate'
assert_production_shape 'remote_ip 127.0.0.1 ::1'
assert_production_shape 'header X-Peptides-Candidate 1'
# The site is public. A basic_auth block anywhere in the production config is a
# regression — re-gating is a deliberate change that must update this test too.
assert_production_shape 'basic_auth {' 0
assert_production_shape 'admin unix//run/caddy/admin.sock'
assert_production_shape 'persist_config off'

allocate_ports() {
	"${NODE_BIN}" -e '
		const net = require("node:net");
		const servers = [];
		const open = () => new Promise((resolve, reject) => {
			const server = net.createServer();
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				servers.push(server);
				resolve(server.address().port);
			});
		});
		Promise.all([open(), open(), open(), open()])
			.then((ports) => {
				process.stdout.write(`${ports.join(" ")}\n`);
				let remaining = servers.length;
				for (const server of servers) {
					server.close(() => {
						remaining -= 1;
						if (remaining === 0) process.exit(0);
					});
				}
			})
			.catch((error) => {
				process.stderr.write(`${error.stack || error}\n`);
				process.exit(1);
			});
	'
}

PORT_VALUES=''
PORT_VALUES="$(allocate_ports)" \
	|| fail 'could not allocate isolated loopback ports'
read -r STOREFRONT_PORT WWW_PORT API_PORT UPSTREAM_PORT <<<"${PORT_VALUES}"
[[ "${STOREFRONT_PORT}" =~ ^[0-9]+$ \
	&& "${WWW_PORT}" =~ ^[0-9]+$ \
	&& "${API_PORT}" =~ ^[0-9]+$ \
	&& "${UPSTREAM_PORT}" =~ ^[0-9]+$ ]] \
	|| fail 'loopback port allocator returned invalid output'
readonly STOREFRONT_PORT WWW_PORT API_PORT UPSTREAM_PORT
readonly STOREFRONT_URL="http://127.0.0.1:${STOREFRONT_PORT}"
readonly WWW_URL="http://127.0.0.1:${WWW_PORT}"
readonly API_URL="http://127.0.0.1:${API_PORT}"

awk \
	-v storefront_port="${STOREFRONT_PORT}" \
	-v www_port="${WWW_PORT}" \
	-v api_port="${API_PORT}" \
	-v upstream_port="${UPSTREAM_PORT}" \
	-v storefront_root="${FIXTURE_DIR}/storefront" \
	-v candidate_root="${FIXTURE_DIR}/candidate" '
	BEGIN {
		global_block = 0
		apex = 0
		www = 0
		api = 0
		redirect = 0
		upstream = 0
		storefront = 0
		candidate = 0
	}
	!global_block && $0 == "{" {
		print
		global_block = 1
		next
	}
	$0 ~ /^[[:space:]]*admin unix\/\/run\/caddy\/admin.sock[[:space:]]*$/ {
		print "\tadmin off"
		next
	}
	$0 == "{$SITE_DOMAIN} {" {
		print "http://127.0.0.1:" storefront_port " {"
		apex += 1
		next
	}
	$0 == "www.{$SITE_DOMAIN} {" {
		print "http://127.0.0.1:" www_port " {"
		www += 1
		next
	}
	$0 == "api.{$SITE_DOMAIN} {" {
		print "http://127.0.0.1:" api_port " {"
		api += 1
		next
	}
	index($0, "redir https://{$SITE_DOMAIN}{uri} permanent") {
		print "\t\tredir http://127.0.0.1:" storefront_port "{uri} permanent"
		redirect += 1
		next
	}
	index($0, "reverse_proxy 127.0.0.1:9000 {") {
		print "\t\treverse_proxy 127.0.0.1:" upstream_port " {"
		upstream += 1
		next
	}
	index($0, "root * /srv/peptides/storefront-candidate") {
		line = $0
		sub(/\/srv\/peptides\/storefront-candidate$/, candidate_root, line)
		print line
		candidate += 1
		next
	}
	index($0, "root * /srv/peptides/storefront-current") {
		line = $0
		sub(/\/srv\/peptides\/storefront-current$/, storefront_root, line)
		print line
		storefront += 1
		next
	}
	{
		print
	}
	END {
		if (global_block != 1 || apex != 1 || www != 1 || api != 1 \
				|| redirect != 1 || upstream != 1 || storefront != 1 \
				|| candidate != 1) {
			print "production Caddyfile adaptation was incomplete" > "/dev/stderr"
			exit 90
		}
		print ""
		print "http://127.0.0.1:" upstream_port " {"
		print "\theader Server fixture-upstream"
		print "\theader X-Powered-By fixture-runtime"
		print "\trespond \"fixture-api\" 200"
		print "}"
	}
' "${PRODUCTION_CONFIG}" >"${ADAPTED_CONFIG}"

# Validate both the unmodified production addresses and the loopback-adapted
# behavioral config before starting any listener.
"${TEST_DIR}/validate-caddy.sh"
"${TEST_DIR}/validate-caddy.sh" "${ADAPTED_CONFIG}"

start_caddy() {
	local maintenance_config="$1"
	: >"${CADDY_LOG}"
	mkdir -p \
		"${TEST_TMP}/home" \
		"${TEST_TMP}/config" \
		"${TEST_TMP}/data"

	/usr/bin/env -i \
		PATH='/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin' \
		HOME="${TEST_TMP}/home" \
		XDG_CONFIG_HOME="${TEST_TMP}/config" \
		XDG_DATA_HOME="${TEST_TMP}/data" \
		TMPDIR="${TEST_TMP}" \
		ACME_EMAIL='fixture@example.invalid' \
		SITE_DOMAIN='fixture.invalid' \
		STOREFRONT_ROOT="${FIXTURE_DIR}/storefront" \
		CANDIDATE_STOREFRONT_ROOT="${FIXTURE_DIR}/candidate" \
		MAINTENANCE_CONFIG="${maintenance_config}" \
		CSP_CONFIG="${DEPLOY_DIR}/csp.bootstrap.caddy" \
		"${CADDY_BIN}" run \
			--config "${ADAPTED_CONFIG}" \
			--adapter caddyfile \
			>"${CADDY_LOG}" 2>&1 &
	CADDY_PID="$!"

	local attempt
	for attempt in $(seq 1 100); do
		if ! kill -0 "${CADDY_PID}" 2>/dev/null; then
			wait "${CADDY_PID}" 2>/dev/null || true
			CADDY_PID=''
			fail 'Caddy exited before the fixture became ready'
		fi
		if "${CURL_BIN}" --silent --noproxy '*' \
			--connect-timeout 1 --max-time 1 \
			--output /dev/null "${STOREFRONT_URL}/"; then
			return
		fi
		sleep 0.05
	done
	fail 'Caddy fixture did not become ready'
}

request() {
	local name="$1"
	local method="$2"
	local url="$3"
	shift 3

	LAST_HEADERS="${TEST_TMP}/${name}.headers"
	LAST_BODY="${TEST_TMP}/${name}.body"
	if ! LAST_STATUS="$(
		"${CURL_BIN}" --silent --show-error --noproxy '*' \
			--connect-timeout 2 --max-time 5 \
			--request "${method}" \
			--dump-header "${LAST_HEADERS}" \
			--output "${LAST_BODY}" \
			--write-out '%{http_code}' \
			"$@" \
			"${url}"
	)"; then
		fail "request failed: ${method} ${url}"
	fi
}

header_value() {
	local name
	name="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
	awk -v wanted="${name}" '
		{
			line = $0
			sub(/\r$/, "", line)
			colon = index(line, ":")
			if (!colon) next
			header_name = tolower(substr(line, 1, colon - 1))
			if (header_name == wanted) {
				value = substr(line, colon + 1)
				sub(/^[[:space:]]+/, "", value)
				print value
			}
		}
	' "${LAST_HEADERS}"
}

assert_status() {
	local expected="$1"
	local context="$2"
	[[ "${LAST_STATUS}" == "${expected}" ]] \
		|| fail "${context}: expected HTTP ${expected}, got ${LAST_STATUS}"
	pass
}

assert_body_empty() {
	local context="$1"
	[[ ! -s "${LAST_BODY}" ]] \
		|| fail "${context}: response body must be zero bytes"
	pass
}

assert_body_contains() {
	local text="$1"
	local context="$2"
	grep -Fq -- "${text}" "${LAST_BODY}" \
		|| fail "${context}: response body is missing ${text}"
	pass
}

assert_header_exact() {
	local name="$1"
	local expected="$2"
	local context="$3"
	local actual
	actual="$(header_value "${name}")"
	[[ "${actual}" == "${expected}" ]] \
		|| fail "${context}: ${name} expected '${expected}', got '${actual}'"
	pass
}

assert_header_contains() {
	local name="$1"
	local expected="$2"
	local context="$3"
	local actual
	actual="$(header_value "${name}")"
	[[ "${actual}" == *"${expected}"* ]] \
		|| fail "${context}: ${name} is missing '${expected}' (got '${actual}')"
	pass
}

assert_header_absent() {
	local name="$1"
	local context="$2"
	local actual
	actual="$(header_value "${name}")"
	[[ -z "${actual}" ]] \
		|| fail "${context}: ${name} must be absent (got '${actual}')"
	pass
}

assert_security_headers() {
	local context="$1"
	assert_header_exact \
		'Strict-Transport-Security' \
		'max-age=31536000; includeSubDomains' \
		"${context}"
	assert_header_exact 'X-Content-Type-Options' 'nosniff' "${context}"
	assert_header_exact \
		'Referrer-Policy' \
		'strict-origin-when-cross-origin' \
		"${context}"
	assert_header_exact 'X-Frame-Options' 'DENY' "${context}"
	assert_header_exact 'Permissions-Policy' 'tools=(self)' "${context}"
	assert_header_absent 'Server' "${context}"
	assert_header_absent 'X-Powered-By' "${context}"
}

# The storefront is public as of 2026-07-29: no basic auth, no site-wide
# noindex, and cacheable rather than `private, no-store`. A WWW-Authenticate
# header or a noindex on these paths is now a regression.
assert_public_headers() {
	local context="$1"
	assert_header_absent 'WWW-Authenticate' "${context}"
	assert_header_absent 'X-Robots-Tag' "${context}"
}

assert_storefront_headers() {
	local context="$1"
	assert_security_headers "${context}"
	assert_public_headers "${context}"
	# Pages revalidate on every request, or a deploy takes a day to show up.
	assert_header_contains \
		'Cache-Control' 'must-revalidate' "${context}"
	assert_header_contains \
		'Content-Security-Policy' \
		"default-src 'none'" \
		"${context}"
}

assert_api_headers() {
	local context="$1"
	assert_security_headers "${context}"
	assert_header_contains 'Cache-Control' 'no-store' "${context}"
	assert_header_exact 'X-Robots-Tag' 'noindex, nofollow' "${context}"
}

start_caddy "${DEPLOY_DIR}/maintenance.off.caddy"

request public GET "${STOREFRONT_URL}/"
assert_status 200 'public storefront'
assert_body_contains 'production storefront fixture' 'public storefront'
assert_storefront_headers 'public storefront'

request public_asset GET "${STOREFRONT_URL}/assets/app.js"
assert_status 200 'public asset'
assert_body_contains \
	'globalThis.caddyFixtureLoaded = true;' \
	'public asset'
assert_security_headers 'public asset'
assert_public_headers 'public asset'

request candidate GET "${STOREFRONT_URL}/" \
	--header 'X-Peptides-Candidate: 1'
assert_status 200 'loopback candidate bypass'
assert_body_contains 'candidate storefront fixture' 'loopback candidate bypass'
assert_storefront_headers 'loopback candidate bypass'

request www_redirect GET "${WWW_URL}/path?value=1"
assert_status 301 'public www redirect'
assert_header_exact \
	'Location' \
	"${STOREFRONT_URL}/path?value=1" \
	'public www redirect'
assert_body_empty 'public www redirect'
assert_public_headers 'public www redirect'
assert_security_headers 'public www redirect'

request api_read GET "${API_URL}/health"
assert_status 200 'normal API read'
assert_body_contains 'fixture-api' 'normal API read'
assert_api_headers 'normal API read'

request api_write_before_maintenance POST "${API_URL}/store/carts"
assert_status 200 'normal API write'
assert_body_contains 'fixture-api' 'normal API write'
assert_api_headers 'normal API write'

cleanup_caddy
start_caddy "${DEPLOY_DIR}/maintenance.on.caddy"

# A maintenance 503 must never be cached, so it keeps `private, no-store` even
# though the storefront itself is now publicly cacheable.
assert_maintenance_headers() {
	local context="$1"
	assert_header_contains 'Cache-Control' 'private' "${context}"
	assert_header_contains 'Cache-Control' 'no-store' "${context}"
	assert_header_exact 'Retry-After' '300' "${context}"
	assert_public_headers "${context}"
	assert_security_headers "${context}"
}

request maintenance_www GET "${WWW_URL}/"
assert_status 503 'maintenance www'
assert_body_empty 'maintenance www'
assert_maintenance_headers 'maintenance www'

request maintenance_candidate GET "${STOREFRONT_URL}/" \
	--header 'X-Peptides-Candidate: 1'
assert_status 200 'maintenance candidate bypass'
assert_body_contains \
	'candidate storefront fixture' \
	'maintenance candidate bypass'
assert_storefront_headers 'maintenance candidate bypass'

request maintenance_api_read GET "${API_URL}/health"
assert_status 200 'maintenance API read'
assert_body_contains 'fixture-api' 'maintenance API read'
assert_api_headers 'maintenance API read'

for method in POST PUT PATCH DELETE; do
	request "maintenance_api_${method}" "${method}" "${API_URL}/store/write"
	assert_status 503 "maintenance API ${method}"
	assert_body_empty "maintenance API ${method}"
	assert_header_exact 'Retry-After' '300' "maintenance API ${method}"
	assert_api_headers "maintenance API ${method}"
done

# Check the apex maintenance response after the independent www/API branches,
# so a directive-order regression cannot conceal their results.
request maintenance_storefront GET "${STOREFRONT_URL}/"
assert_status 503 'maintenance storefront'
assert_body_empty 'maintenance storefront'
assert_maintenance_headers 'maintenance storefront'

# Keep the custom error route last so a header regression there does not hide
# independent gate, proxy or maintenance regressions in the same test run.
cleanup_caddy
start_caddy "${DEPLOY_DIR}/maintenance.off.caddy"
# A missing path serves the custom 404 page while KEEPING the 404 status.
# Returning 200 here would be a soft 404 that search engines index as a real
# page — the reason `file_server` is matched inside handle_errors, not bare.
request not_found GET "${STOREFRONT_URL}/definitely-missing"
assert_status 404 'public missing page'
assert_body_contains 'fixture custom 404' 'public missing page'
assert_security_headers 'public missing page'
assert_public_headers 'public missing page'

printf 'PASS: Caddy gate and maintenance behavior (%s assertions)\n' \
	"${ASSERTION_COUNT}"
