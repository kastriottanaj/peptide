#!/usr/bin/env bash

set -euo pipefail

TEST_DIR="$(builtin cd "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
BOOTSTRAP_SCRIPT="${TEST_DIR}/../bootstrap-backend.sh"

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

assert_fixed() {
	local text="$1" description="$2"
	grep -Fq -- "${text}" "${BOOTSTRAP_SCRIPT}" || fail "${description}"
}

assert_pattern() {
	local pattern="$1" description="$2"
	grep -Eq -- "${pattern}" "${BOOTSTRAP_SCRIPT}" || fail "${description}"
}

assert_absent() {
	local pattern="$1" description="$2"
	if grep -Eq -- "${pattern}" "${BOOTSTRAP_SCRIPT}"; then
		fail "${description}"
	fi
}

line_number() {
	local text="$1"
	grep -nF -- "${text}" "${BOOTSTRAP_SCRIPT}" \
		| tail -n 1 \
		| cut -d: -f1
}

assert_order() {
	local before="$1" after="$2" description="$3"
	local before_line after_line

	before_line="$(line_number "${before}")"
	after_line="$(line_number "${after}")"
	[[ -n "${before_line}" && -n "${after_line}" \
		&& "${before_line}" -lt "${after_line}" ]] \
		|| fail "${description}"
}

/bin/bash -n "${BOOTSTRAP_SCRIPT}" \
	|| fail "bootstrap resume does not parse with the Bash 3.2 system shell"

assert_fixed '[[ "${2}" == "--resume" ]]' \
	"bootstrap resume is not an explicit CLI operation"
assert_fixed 'Explicit bootstrap resume requires a recovery marker.' \
	"bootstrap resume does not require durable recovery state"
assert_fixed 'use explicit --resume only after review.' \
	"normal bootstrap mode does not refuse unresolved recovery"

assert_fixed 'assert_owner_mode "${RECOVERY_REQUIRED}" root:root 600' \
	"bootstrap resume does not validate recovery-marker ownership"
assert_fixed 'deploy_state_validate_recovery_marker \' \
	"bootstrap resume does not validate the canonical marker grammar"
assert_fixed 'assert_owner_mode "${DEPLOY_STATE_FILE}" root:root 600' \
	"bootstrap resume does not validate deploy-state ownership"
assert_fixed 'mode=first-install-bootstrap' \
	"bootstrap resume is not bound to first-install state"
assert_fixed 'Bootstrap resume state is not canonical.' \
	"bootstrap resume accepts noncanonical deploy state"
assert_fixed \
	'"sha=${FULL_SHA} phase=${PHASE_MIGRATION_STARTED} action=${DEPLOY_RECOVERY_ACTION_OPERATOR_REVIEW}"' \
	"bootstrap resume does not bind migration recovery to the requested SHA"
assert_fixed \
	'"sha=${FULL_SHA} phase=${PHASE_BACKEND_ACTIVATED} action=${DEPLOY_RECOVERY_ACTION_OPERATOR_REVIEW}"' \
	"bootstrap resume cannot recover a failed final activation"
assert_fixed \
	'"${PHASE_MIGRATION_STARTED}:${PHASE_BACKEND_ACTIVATED}"' \
	"bootstrap resume cannot recover the durable phase-transition boundary"

assert_fixed \
	'assert_exact_root_symlink \' \
	"bootstrap resume does not validate root-managed pointers"
assert_fixed \
	'"${BACKEND_CANDIDATE}" "${BOOTSTRAP_RELEASE}/backend"' \
	"bootstrap resume accepts a backend candidate from another artifact"
assert_fixed \
	'"${STOREFRONT_CANDIDATE}" "${SCRIPT_DIR}/bootstrap-site"' \
	"bootstrap resume accepts an unexpected candidate storefront"
assert_fixed 'Bootstrap resume refuses an activated storefront.' \
	"bootstrap resume tolerates completed storefront state"

assert_fixed 'log "Re-running the idempotent first database migration"' \
	"bootstrap resume does not explicitly re-run migrations"
assert_fixed '[[ "${key_count}" -eq 1 ]]' \
	"bootstrap resume does not require exactly one active publishable key"
assert_fixed '[[ "${PERSISTED_PUBLISHABLE_KEY}" == "${PUBLISHABLE_KEY}" ]]' \
	"bootstrap resume does not bind the persisted key to the database key"
assert_fixed '/usr/bin/sync -f "${ENV_STAGING}"' \
	"bootstrap key contents are not durably persisted"
assert_fixed '/usr/bin/sync -f "${APP_DIR}"' \
	"bootstrap key rename is not durably committed"
assert_absent 'mapfile|PUBLISHABLE_KEYS' \
	"bootstrap resume uses a post-Bash-3.2 key reader"

assert_order \
	'query_single_publishable_key \' \
	'Could not durably record completed bootstrap activation.' \
	"bootstrap marks completion before proving the migrated key"
assert_order \
	'The hidden bootstrap backend failed exact health verification.' \
	'Could not durably record completed bootstrap activation.' \
	"bootstrap marks completion before proving the intended backend"
assert_order \
	'set_deploy_phase "${PHASE_BACKEND_ACTIVATED}"' \
	'deploy_recovery_remove \' \
	"bootstrap removes recovery before recording completed state"
assert_order \
	'The committed bootstrap backend failed exact health verification.' \
	'MIGRATION_STARTED=0' \
	"bootstrap disables recovery before final backend verification"

assert_absent 'printf.*(PUBLISHABLE_KEY|PERSISTED_PUBLISHABLE_KEY).*(stdout|/dev/stdout)' \
	"bootstrap resume can print a publishable key"

# A resumed bootstrap re-adopts a release directory that survived the
# interruption, so the commit name alone must not authorize it.
assert_fixed 'Bootstrap backend is missing its generated-artifact digest.' \
	"bootstrap resume adopts a release with no byte-level identity"
assert_fixed 'recomputed_digest="$(deploy_hash_bootstrap_artifact "${release}")"' \
	"bootstrap resume does not recompute the promoted backend digest"
assert_fixed \
	'[[ "$(<"${release}/.artifact-digest")" == "${recomputed_digest}" ]]' \
	"bootstrap resume does not compare the recorded and actual digests"

# The digest records file modes, so promotion must take it after ownership and
# modes are normalized. Computing it earlier makes every resume recompute fail.
BOUNDARY_LIBRARY="${TEST_DIR}/../lib/build-boundary.sh"
boundary_line_number() {
	grep -nF -- "$1" "${BOUNDARY_LIBRARY}" | tail -n 1 | cut -d: -f1
}
NORMALIZE_LINE="$(boundary_line_number '/usr/bin/chmod -R a-w "${root_staging}"')"
DIGEST_LINE="$(boundary_line_number 'deploy_hash_bootstrap_artifact "${root_staging}"')"
[[ -n "${NORMALIZE_LINE}" && -n "${DIGEST_LINE}" \
	&& "${NORMALIZE_LINE}" -lt "${DIGEST_LINE}" ]] \
	|| fail "the bootstrap digest is taken before modes are normalized"
grep -Fq 'deploy_hash_bootstrap_artifact() {' "${BOUNDARY_LIBRARY}" \
	|| fail "the bootstrap digest helper is missing"
grep -Fq 'deploy_hash_artifact_members "${root}" backend' "${BOUNDARY_LIBRARY}" \
	|| fail "the bootstrap digest does not cover exactly the backend tree"
grep -Fq -- '--sort=name \' "${BOUNDARY_LIBRARY}" \
	|| fail "artifact digests are not order-independent"
grep -Fq -- "--mtime='@0' \\" "${BOUNDARY_LIBRARY}" \
	|| fail "artifact digests are not timestamp-independent"
grep -Fq -- '--numeric-owner \' "${BOUNDARY_LIBRARY}" \
	|| fail "artifact digests are not owner-name-independent"

printf 'PASS: crash-safe first-install bootstrap resume contracts\n'
