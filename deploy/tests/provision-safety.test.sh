#!/usr/bin/env bash

set -euo pipefail

TEST_DIR="$(builtin cd "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
PROVISION="$(builtin cd "${TEST_DIR}/.." && builtin pwd -P)/provision.sh"

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

line_of() {
	grep -nF -- "$2" "$1" | head -n 1 | cut -d: -f1
}

assert_before() {
	local before after
	before="$(line_of "${PROVISION}" "$1")"
	after="$(line_of "${PROVISION}" "$2")"
	[[ -n "${before}" && -n "${after}" && "${before}" -lt "${after}" ]] \
		|| fail "$3"
}

assert_before 'flock -n 9 \' \
	'systemctl stop medusa.service' \
	"provisioning stops Medusa before acquiring the deployment lock"
assert_before 'flock -n 9 \' \
	'apt-get update -qq' \
	"provisioning mutates apt before acquiring the deployment lock"
assert_before 'systemctl mask caddy.service' \
	'apt-get install -y -qq caddy' \
	"Caddy can start its package default site during installation"

grep -Fq 'Existing runtime state requires --repair-existing.' "${PROVISION}" \
	|| fail "fresh provisioning does not refuse an existing runtime"
grep -Fq 'systemctl stop caddy.service' "${PROVISION}" \
	|| fail "provisioning does not keep Caddy stopped"
grep -Fq '"${OPS_SOURCE}/maintenance.on.caddy"' "${PROVISION}" \
	|| fail "fresh provisioning does not install fail-closed maintenance"
grep -Fq 'for control_name in maintenance.caddy csp-current' "${PROVISION}" \
	|| fail "provisioning preserves imported Caddy control code"
grep -Fq 'provision-recovery-required' "${PROVISION}" \
	|| fail "repair-mode failure has no durable operator marker"
assert_before '"${OPS_SOURCE}/verify-release.sh" \' \
	'systemctl enable medusa.service caddy.service' \
	"repair must verify the gate before enabling repaired services"
grep -Fq 'RuntimeDirectoryMode=0700' "${PROVISION}" \
	|| fail "Caddy admin socket directory is not private to Caddy"
grep -Fq -- '--address unix//run/caddy/admin.sock' "${PROVISION}" \
	|| fail "Caddy reload is not pinned to the private admin socket"
grep -Fq \
	'ExecStartPre=/usr/bin/test ! -e ${APP_DIR}/activation-required' \
	"${PROVISION}" \
	|| fail "Caddy can reboot through an unverified release activation"

# The legacy upload directory was writable by the runtime this provisioning
# run exists to contain, so adopting it must not follow or recreate links.
grep -Fq 'deploy_validate_build_source_tree "${LEGACY_STATIC}"' "${PROVISION}" \
	|| fail "the legacy upload tree is adopted without a no-follow review"
grep -Fq -- 'rsync --archive --safe-links --no-devices --no-specials \' \
	"${PROVISION}" \
	|| fail "the legacy upload tree is copied without --safe-links"
grep -Fq 'chown -R --no-dereference \' "${PROVISION}" \
	|| fail "adopting uploads can dereference a planted symlink during chown"
if grep -Eq '^[[:space:]]*rsync -a --ignore-existing' "${PROVISION}"; then
	fail "an unsafe legacy upload copy remains"
fi
if grep -Eq '^[[:space:]]*chown -R "\$\{SERVICE_USER\}' "${PROVISION}"; then
	fail "a dereferencing recursive chown of untrusted paths remains"
fi

# Reproduce the escalation the flags above prevent: rsync without --safe-links
# recreates an escaping symlink, and a dereferencing chown then follows it.
LINK_FIXTURE="$(mktemp -d)"
mkdir -p "${LINK_FIXTURE}/source" "${LINK_FIXTURE}/destination" \
	"${LINK_FIXTURE}/outside"
printf 'host secret\n' >"${LINK_FIXTURE}/outside/target"
ln -s ../outside/target "${LINK_FIXTURE}/source/escape"
rsync -a --ignore-existing \
	"${LINK_FIXTURE}/source/" "${LINK_FIXTURE}/unsafe/" >/dev/null 2>&1 \
	|| true
[[ -L "${LINK_FIXTURE}/unsafe/escape" ]] \
	|| fail "the fixture does not reproduce the unsafe symlink copy"
rsync --archive --safe-links --no-devices --no-specials \
	--no-owner --no-group --ignore-existing \
	"${LINK_FIXTURE}/source/" "${LINK_FIXTURE}/destination/" >/dev/null
[[ ! -e "${LINK_FIXTURE}/destination/escape" \
	&& ! -L "${LINK_FIXTURE}/destination/escape" ]] \
	|| fail "an escaping upload symlink crossed the adoption boundary"
rm -rf "${LINK_FIXTURE}"

grep -Fq 'install_pinned_apt_key \' "${PROVISION}" \
	|| fail "third-party apt keys are not installed through the pinned helper"
if grep -Eq '^[[:space:]]*curl .*(gpgkey|gpg\.key)' "${PROVISION}"; then
	fail "an apt signing key is still fetched outside the pinned helper"
fi
grep -Fq \
	'die "The keyring from ${url} carries ${key_count} public keys; expected exactly one."' \
	"${PROVISION}" \
	|| fail "apt keyrings are not restricted to a single trusted public key"

# Behavioral fixture for the appended-key bypass: a block whose *first* key
# carries the pinned fingerprint must still be rejected when a second public
# key rides along, because apt would trust both.
if command -v gpg >/dev/null 2>&1; then
	KEY_FIXTURE="$(mktemp -d)"
	trap 'rm -rf "${KEY_FIXTURE}"' EXIT
	export GNUPGHOME="${KEY_FIXTURE}/gnupg"
	install -d -m 0700 "${GNUPGHOME}"

	for key_name in pinned appended; do
		gpg --batch --quiet --passphrase '' --quick-generate-key \
			"${key_name} <${key_name}@fixture.invalid>" default default never \
			>/dev/null 2>&1 \
			|| fail "could not generate the ${key_name} fixture key"
		gpg --batch --quiet --armor \
			--export "${key_name}@fixture.invalid" \
			>"${KEY_FIXTURE}/${key_name}.asc"
	done

	cat "${KEY_FIXTURE}/pinned.asc" "${KEY_FIXTURE}/appended.asc" \
		>"${KEY_FIXTURE}/combined.asc"
	gpg --batch --yes --dearmor \
		--output "${KEY_FIXTURE}/combined.gpg" "${KEY_FIXTURE}/combined.asc"

	# The vulnerable check — first pub, then first fpr, then exit — accepts
	# the combined block.
	FIRST_FINGERPRINT="$(
		gpg --batch --show-keys --with-colons "${KEY_FIXTURE}/combined.gpg" \
			| awk -F: \
				'$1 == "pub" { primary = 1; next }
				 primary && $1 == "fpr" { print toupper($10); exit }'
	)"
	PINNED_FINGERPRINT="$(
		gpg --batch --show-keys --with-colons "${KEY_FIXTURE}/pinned.asc" \
			| awk -F: '$1 == "fpr" { print toupper($10); exit }'
	)"
	[[ -n "${PINNED_FINGERPRINT}" \
		&& "${FIRST_FINGERPRINT}" == "${PINNED_FINGERPRINT}" ]] \
		|| fail "the fixture does not reproduce the appended-key bypass"

	# The shipped check counts the keys apt would trust and rejects it.
	KEY_COUNT="$(
		gpg --batch --show-keys --with-colons "${KEY_FIXTURE}/combined.gpg" \
			| awk -F: '$1 == "pub" { count += 1 } END { print count + 0 }'
	)"
	[[ "${KEY_COUNT}" == '2' ]] \
		|| fail "the installed keyring key count is not observable"

	unset GNUPGHOME
	rm -rf "${KEY_FIXTURE}"
	trap - EXIT
fi

printf 'PASS: provisioning lock and fail-closed contracts\n'
