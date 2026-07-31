#!/usr/bin/bash
#
# One-time setup for a fresh Hetzner box (Ubuntu 24.04). No Docker: Postgres,
# Redis, Node and Caddy come from apt, and Medusa runs as a systemd service.
#
# Fresh-install mode refuses an existing runtime. A separately explicit
# --repair-existing mode is fail-closed and intended only for the reviewed
# one-time trust-boundary repair described in docs/deploy.md.
#
# Run from a reviewed root-controlled copy as root on the server:
#   /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC /usr/bin/bash provision.sh <commit-sha>
#
# Afterwards: fill in the blanks in /srv/peptides/.env and
# /srv/peptides/caddy.env, then run deploy/deploy.sh.

if [[ "${PEPTIDES_CLEAN_ENTRY:-0}" != "1" ]]; then
	set +x +v
	builtin unset -v BASH_ENV ENV CDPATH GLOBIGNORE LD_PRELOAD \
		LD_LIBRARY_PATH DYLD_INSERT_LIBRARIES TAR_OPTIONS 2>/dev/null || :
	_entry_dir="${BASH_SOURCE[0]%/*}"
	[[ "${_entry_dir}" != "${BASH_SOURCE[0]}" ]] || _entry_dir='.'
	_entry_dir="$(builtin cd -- "${_entry_dir}" && builtin pwd -P)"
	exec /usr/bin/env -i \
		PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
		HOME=/root \
		LANG=C.UTF-8 \
		LC_ALL=C.UTF-8 \
		TZ=UTC \
		PEPTIDES_CLEAN_ENTRY=1 \
		/usr/bin/bash "${_entry_dir}/${BASH_SOURCE[0]##*/}" "$@"
fi
builtin unset -v PEPTIDES_CLEAN_ENTRY _entry_dir

set -euo pipefail

SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
[[ "${SCRIPT_DIR}" != "${BASH_SOURCE[0]}" ]] || SCRIPT_DIR='.'
SCRIPT_DIR="$(builtin cd -- "${SCRIPT_DIR}" && builtin pwd -P)"
# shellcheck source=lib/env-file.sh
builtin source "${SCRIPT_DIR}/lib/env-file.sh"
# shellcheck source=lib/build-boundary.sh
builtin source "${SCRIPT_DIR}/lib/build-boundary.sh"
deploy_sanitize_environment

APP_DIR=/srv/peptides
REPO_URL=https://github.com/kastriottanaj/peptide.git
REPO_DIR="${APP_DIR}/repo"
OPS_DIR="${APP_DIR}/ops"
OPS_CURRENT="${APP_DIR}/ops-current"
QUARANTINE_DIR="${APP_DIR}/quarantine"
TRUST_MARKER="${APP_DIR}/.trust-boundary-v1"
ENV_FILE="${APP_DIR}/.env"
CADDY_ENV_FILE="${APP_DIR}/caddy.env"
BACKUP_ENV_FILE="${APP_DIR}/backup.env"
PROVISION_RECOVERY="${APP_DIR}/provision-recovery-required"
ACTIVATION_REQUIRED="${APP_DIR}/activation-required"
LEGACY_CURRENT="${APP_DIR}/current"
LEGACY_STOREFRONT="${APP_DIR}/storefront"

DB_NAME=medusa_peptides
DB_USER=medusa
SERVICE_USER=medusa
BUILD_USER=peptides-build
BACKUP_USER=peptides-backup
OPS_PROTOCOL_VALUE=peptides-ops-v2
PROVISION_MARKER_WRITTEN=0
PROVISION_SNAPSHOT=""
LEGACY_RELEASE=""
LEGACY_SHA=""

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[fail] %s\033[0m\n' "$*" >&2; exit 1; }

# Fetch a third-party APT signing key and install it only if the exact bytes
# apt will trust contain one public key with the pinned fingerprint.
#
# apt trusts *every* key in a `signed-by` keyring, so checking the first
# fingerprint in the downloaded block is not sufficient: a block carrying a
# legitimate key followed by an appended attacker key passes that check while
# `--dearmor` writes both into the keyring. Inspect the dearmored output —
# the bytes actually installed — and require a single public key.
install_pinned_apt_key() {
	local url="$1" expected_fingerprint="$2" destination="$3"
	local ascii_key binary_key key_count fingerprint

	ascii_key="$(mktemp /tmp/apt-key.XXXXXX)"
	binary_key="$(mktemp /tmp/apt-keyring.XXXXXX)"

	curl --proto '=https' --tlsv1.2 -fsSL "${url}" -o "${ascii_key}" \
		|| die "Could not fetch the signing key from ${url}."
	gpg --batch --yes --dearmor --output "${binary_key}" "${ascii_key}" \
		|| die "Could not dearmor the signing key from ${url}."

	key_count="$(
		gpg --batch --show-keys --with-colons "${binary_key}" \
			| awk -F: '$1 == "pub" { count += 1 } END { print count + 0 }'
	)" || die "Could not inspect the keyring fetched from ${url}."
	[[ "${key_count}" == '1' ]] \
		|| die "The keyring from ${url} carries ${key_count} public keys; expected exactly one."

	fingerprint="$(
		gpg --batch --show-keys --with-colons "${binary_key}" \
			| awk -F: '$1 == "fpr" { print toupper($10); exit }'
	)" || die "Could not read the signing-key fingerprint from ${url}."
	[[ "${fingerprint}" == "${expected_fingerprint}" ]] \
		|| die "Signing-key fingerprint from ${url} changed; review before provisioning."

	install -d -o root -g root -m 0755 "$(dirname "${destination}")"
	install -o root -g root -m 0644 "${binary_key}" "${destination}"
	unlink "${ascii_key}" "${binary_key}"
}

# Write an APT source that can only be satisfied by the pinned keyring.
install_pinned_apt_source() {
	local destination="$1" entry="$2"
	local source_temporary

	source_temporary="$(mktemp /tmp/apt-source.XXXXXX)"
	printf '%s\n' "${entry}" >"${source_temporary}"
	install -o root -g root -m 0644 "${source_temporary}" "${destination}"
	unlink "${source_temporary}"
}

[[ "${EUID}" -eq 0 ]] || die "Run as root."
TARGET_SHA="${1:-}"
PROVISION_MODE=fresh
if [[ "$#" -eq 2 && "${2}" == "--repair-existing" ]]; then
	PROVISION_MODE=repair
elif [[ "$#" -ne 1 ]]; then
	die "Usage: provision.sh <reviewed-commit-sha> [--repair-existing]"
fi
[[ "${TARGET_SHA}" =~ ^[0-9a-fA-F]{7,40}$ ]] \
	|| die "Usage: provision.sh <reviewed-commit-sha> [--repair-existing]"

# Acquire the same root-owned lock as deploy and backup before stopping a
# service, touching apt, or changing the database. The application directory
# and lock are the only mutations allowed before lock acquisition.
if [[ ! -e "${APP_DIR}" ]]; then
	/usr/bin/install -d -o root -g root -m 0755 "${APP_DIR}"
fi
[[ -d "${APP_DIR}" && ! -L "${APP_DIR}" \
	&& "$(stat -c '%U:%G %a' "${APP_DIR}")" == "root:root 755" ]] \
	|| die "${APP_DIR} has unsafe ownership, mode or type."
if [[ ! -e "${APP_DIR}/deploy.lock" ]]; then
	/usr/bin/install -o root -g root -m 0600 \
		/dev/null "${APP_DIR}/deploy.lock"
fi
[[ -f "${APP_DIR}/deploy.lock" && ! -L "${APP_DIR}/deploy.lock" \
	&& "$(stat -c '%U:%G %a' "${APP_DIR}/deploy.lock")" == \
		"root:root 600" ]] \
	|| die "${APP_DIR}/deploy.lock has unsafe ownership, mode or type."
exec 9>>"${APP_DIR}/deploy.lock"
flock -n 9 \
	|| die "A deployment or backup is active; provisioning made no service changes."

[[ ! -e "${PROVISION_RECOVERY}" && ! -L "${PROVISION_RECOVERY}" ]] \
	|| die "An unresolved provisioning recovery marker exists."
[[ ! -e "${APP_DIR}/recovery-required" \
	&& ! -L "${APP_DIR}/recovery-required" ]] \
	|| die "An unresolved deployment recovery marker exists."
[[ ! -e "${ACTIVATION_REQUIRED}" && ! -L "${ACTIVATION_REQUIRED}" ]] \
	|| die "An unresolved release activation marker exists."

if [[ "${PROVISION_MODE}" == "fresh" ]]; then
	for existing_pointer in \
		"${APP_DIR}/backend-current" \
		"${APP_DIR}/storefront-current" \
		"${APP_DIR}/current"
	do
		[[ ! -e "${existing_pointer}" && ! -L "${existing_pointer}" ]] \
			|| die "Existing runtime state requires --repair-existing."
	done
fi

cleanup_provision() {
	local status="$?"
	trap - EXIT
	set +e
	if [[ "${status}" -ne 0 ]]; then
		systemctl stop caddy.service >/dev/null 2>&1 || true
		if [[ "${PROVISION_MODE}" == "repair" ]]; then
			deploy_stop_and_prove_unit medusa.service >/dev/null 2>&1 || true
			if [[ "${PROVISION_MARKER_WRITTEN}" -ne 1 ]]; then
				warn "Repair failed before a durable recovery marker was committed; no runtime mutation should have started."
			fi
		fi
	fi
	exit "${status}"
}
trap cleanup_provision EXIT

if [[ "${PROVISION_MODE}" == "repair" ]]; then
	[[ -L "${LEGACY_CURRENT}" ]] \
		|| die "Repair mode requires the legacy ${LEGACY_CURRENT} pointer."
	LEGACY_RELEASE="$(readlink -f "${LEGACY_CURRENT}")"
	LEGACY_SHA="$(basename "${LEGACY_RELEASE}")"
	[[ "${LEGACY_SHA}" =~ ^[0-9a-f]{40}$ \
		&& "${LEGACY_RELEASE}" == \
			"${APP_DIR}/releases/${LEGACY_SHA}" ]] \
		|| die "The legacy current pointer must identify one full commit SHA."
	[[ -d "${LEGACY_RELEASE}" && ! -L "${LEGACY_RELEASE}" ]] \
		|| die "The legacy backend release is missing or malformed."
	[[ -d "${LEGACY_STOREFRONT}" && ! -L "${LEGACY_STOREFRONT}" ]] \
		|| die "Repair mode requires the legacy static storefront."
	[[ -f /etc/systemd/system/medusa.service \
		&& ! -L /etc/systemd/system/medusa.service \
		&& "$(stat -c '%U:%G' /etc/systemd/system/medusa.service)" == \
			"root:root" \
		&& "$(stat -c '%a' /etc/systemd/system/medusa.service)" =~ \
			^(600|640|644)$ ]] \
		|| die "The legacy Medusa unit is not a trusted regular file."

	if [[ -e "${APP_DIR}/control-snapshots" \
		|| -L "${APP_DIR}/control-snapshots" ]]; then
		[[ -d "${APP_DIR}/control-snapshots" \
			&& ! -L "${APP_DIR}/control-snapshots" ]] \
			|| die "The control-snapshot root is malformed."
	fi
	install -d -o root -g root -m 0700 \
		"${APP_DIR}/control-snapshots"
	PROVISION_SNAPSHOT="$(
		mktemp -d "${APP_DIR}/control-snapshots/provision-${TARGET_SHA}.XXXXXX"
	)"
	chown root:root "${PROVISION_SNAPSHOT}"
	chmod 0700 "${PROVISION_SNAPSHOT}"
	install -o root -g root -m 0600 \
		/etc/systemd/system/medusa.service \
		"${PROVISION_SNAPSHOT}/medusa.service"
	if [[ -f /etc/caddy/Caddyfile && ! -L /etc/caddy/Caddyfile ]]; then
		install -o root -g root -m 0600 \
			/etc/caddy/Caddyfile \
			"${PROVISION_SNAPSHOT}/Caddyfile"
	fi

	# Disable both boot paths before committing the recovery marker. A power
	# loss between these operations is therefore fail-closed on reboot rather
	# than restarting the formerly writable runtime without a marker guard.
	systemctl disable caddy.service medusa.service >/dev/null 2>&1 \
		|| die "Could not disable the legacy services for fail-closed repair."
	# `systemctl disable` changes symlinks in multiple target directories.
	# Flush that enable-state before the marker rename so a power loss cannot
	# reboot into the legacy units without the durable repair guard.
	sync

	temporary_marker="$(
		mktemp "${APP_DIR}/.provision-recovery.XXXXXX"
	)"
	printf 'sha=%s mode=repair action=operator-review-required snapshot=%s\n' \
		"${TARGET_SHA}" "${PROVISION_SNAPSHOT}" >"${temporary_marker}"
	chown root:root "${temporary_marker}"
	chmod 0600 "${temporary_marker}"
	sync -f "${temporary_marker}"
	mv -Tf "${temporary_marker}" "${PROVISION_RECOVERY}"
	sync -f "${APP_DIR}"
	[[ -f "${PROVISION_RECOVERY}" && ! -L "${PROVISION_RECOVERY}" \
		&& "$(stat -c '%U:%G %a' "${PROVISION_RECOVERY}")" == \
			"root:root 600" ]] \
		|| die "Could not validate the durable provisioning marker."
	PROVISION_MARKER_WRITTEN=1
fi

# Stop the old runtime before any repair. `systemctl stop` waits for the unit,
# then the cgroup check proves it did not leave a process holding a writable
# descriptor into the checkout that is about to be quarantined.
if [[ "$(systemctl show medusa.service -p LoadState --value \
	2>/dev/null || true)" != "not-found" ]]; then
	warn "Stopping the existing Medusa runtime before repairing trust."
	systemctl stop medusa.service || die "Could not stop medusa.service."
	if systemctl is-active --quiet medusa.service; then
		die "medusa.service remained active after the stop request."
	fi
	medusa_cgroup="$(
		systemctl show medusa.service -p ControlGroup --value 2>/dev/null || true
	)"
	if [[ -n "${medusa_cgroup}" \
		&& -r "/sys/fs/cgroup${medusa_cgroup}/cgroup.procs" \
		&& -s "/sys/fs/cgroup${medusa_cgroup}/cgroup.procs" ]]; then
		die "The stopped Medusa cgroup still contains a process."
	fi
	unset medusa_cgroup
fi
systemctl stop peptides-backup.timer >/dev/null 2>&1 || true
systemctl stop peptides-backup.service >/dev/null 2>&1 || true
systemctl stop caddy.service >/dev/null 2>&1 || true

if [[ "${PROVISION_MODE}" == "repair" ]]; then
	# Both trees were writable by the former runtime. They are retained only
	# for recovery evidence and the narrowly copied upload state below. The
	# repair bridge is rebuilt independently from the matching origin/main
	# commit; neither of these legacy trees is ever executed or served again.
	deploy_validate_build_source_tree "${LEGACY_RELEASE}" \
		|| die "The legacy backend tree failed the no-follow safety review."
	deploy_validate_build_source_tree "${LEGACY_STOREFRONT}" \
		|| die "The legacy storefront tree failed the no-follow safety review."
	chown -R --no-dereference root:root "${LEGACY_RELEASE}" "${LEGACY_STOREFRONT}"
	chmod -R u=rwX,go=rX "${LEGACY_RELEASE}" "${LEGACY_STOREFRONT}"
	chmod -R a-w "${LEGACY_RELEASE}" "${LEGACY_STOREFRONT}"
fi

# ---------------------------------------------------------------------------
log "System packages"
# ---------------------------------------------------------------------------
# Disable the two project-managed third-party repositories before the first
# apt update. Existing definitions came from the pre-hardening installer and
# are replaced below only after their signing keys pass pinned fingerprints.
install -d -o root -g root -m 0700 "${APP_DIR}/quarantine"
apt_source_quarantine="${APP_DIR}/quarantine/apt-sources-$(date -u '+%Y%m%dT%H%M%SZ')-$$"
install -d -o root -g root -m 0700 "${apt_source_quarantine}"
for managed_apt_source in \
	/etc/apt/sources.list.d/nodesource.list \
	/etc/apt/sources.list.d/nodesource.sources \
	/etc/apt/sources.list.d/caddy-stable.list
do
	if [[ -e "${managed_apt_source}" || -L "${managed_apt_source}" ]]; then
		[[ -f "${managed_apt_source}" && ! -L "${managed_apt_source}" ]] \
			|| die "A managed apt source is not a regular file."
		mv "${managed_apt_source}" "${apt_source_quarantine}/"
	fi
done
unset managed_apt_source

env DEBIAN_FRONTEND=noninteractive apt-get update -qq
env DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
	ca-certificates curl git gnupg rsync ufw \
	debian-keyring debian-archive-keyring apt-transport-https \
	postgresql postgresql-contrib redis-server \
	restic util-linux unattended-upgrades \
	build-essential python3
# build-essential and python3 are node-gyp's toolchain. Most of Medusa's native
# dependencies ship prebuilt binaries, but when one does not match the platform
# npm falls back to compiling — and without a compiler that surfaces as a
# confusing `npm ci` failure in the middle of the first deploy rather than as a
# missing package here.

# ---------------------------------------------------------------------------
log "Node.js 22"
# ---------------------------------------------------------------------------
# The storefront requires >= 22.12; Ubuntu 24.04 ships 18.
install -d -o root -g root -m 0755 /etc/apt/keyrings
install_pinned_apt_key \
	https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
	6F71F525282841EEDAF851B42F59B5F99B1BE0B4 \
	/etc/apt/keyrings/nodesource.gpg
install_pinned_apt_source \
	/etc/apt/sources.list.d/nodesource.list \
	'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main'

if ! command -v node >/dev/null 2>&1 \
	|| [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
	env DEBIAN_FRONTEND=noninteractive apt-get update -qq
	env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
fi
echo "node $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------------------
log "Caddy"
# ---------------------------------------------------------------------------
install_pinned_apt_key \
	https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
	65760C51EDEA2017CEA2CA15155B6D79CA56EA34 \
	/usr/share/keyrings/caddy-stable-archive-keyring.gpg
install_pinned_apt_source \
	/etc/apt/sources.list.d/caddy-stable.list \
	'deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main'

if ! command -v caddy >/dev/null 2>&1; then
	# The package normally starts its public default site immediately. Mask the
	# unit across installation so Caddy's placeholder page cannot answer on this
	# domain even briefly.
	systemctl mask caddy.service >/dev/null
	apt-get update -qq
	apt-get install -y -qq caddy
	systemctl stop caddy.service >/dev/null 2>&1 || true
fi
systemctl unmask caddy.service >/dev/null
systemctl disable caddy.service >/dev/null 2>&1 || true
echo "$(caddy version)"

# ---------------------------------------------------------------------------
log "Redis"
# ---------------------------------------------------------------------------
# Default Ubuntu config already binds 127.0.0.1 only. Enable persistence so
# queued events survive a restart — the reason Redis is here at all.
if ! grep -q '^appendonly yes' /etc/redis/redis.conf; then
	sed -i 's/^appendonly no/appendonly yes/' /etc/redis/redis.conf
	grep -q '^appendonly' /etc/redis/redis.conf || echo 'appendonly yes' >>/etc/redis/redis.conf
fi
systemctl enable --now redis-server
systemctl restart redis-server
redis-cli ping

# ---------------------------------------------------------------------------
log "Postgres role and database"
# ---------------------------------------------------------------------------
systemctl enable --now postgresql

DB_PASSWORD=""
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
	# Hex contains no SQL quoting characters. Feed the statement through stdin
	# so the generated password never appears in a child process argument.
	DB_PASSWORD="$(openssl rand -hex 24)"
	printf "CREATE ROLE %s LOGIN PASSWORD '%s';\n" \
		"${DB_USER}" "${DB_PASSWORD}" \
		| sudo -u postgres psql -v ON_ERROR_STOP=1 -q
	echo "Created role ${DB_USER}"
else
	echo "Role ${DB_USER} already exists — leaving its password alone"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
	sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
	echo "Created database ${DB_NAME}"
else
	echo "Database ${DB_NAME} already exists"
fi

# ---------------------------------------------------------------------------
log "Service users, trusted checkout and directories"
# ---------------------------------------------------------------------------
if [[ "${PROVISION_MODE}" == "repair" ]] \
	&& id -u "${SERVICE_USER}" >/dev/null 2>&1; then
	legacy_service_record="$(getent passwd "${SERVICE_USER}")" \
		|| die "Could not resolve the existing ${SERVICE_USER} identity."
	IFS=: read -r legacy_service_name _ _ _ _ \
		legacy_service_home legacy_service_shell <<<"${legacy_service_record}"
	if [[ "${legacy_service_name}" == "${SERVICE_USER}" \
		&& "${legacy_service_home}" == "${APP_DIR}" \
		&& "${legacy_service_shell}" == "/usr/sbin/nologin" ]]; then
		# The pre-hardening installer used /srv/peptides as Medusa's passwd
		# home. Do not move that application tree; only normalize the account
		# record now that the service is stopped.
		usermod --home /var/lib/peptides "${SERVICE_USER}"
	fi
	unset legacy_service_record legacy_service_name legacy_service_home \
		legacy_service_shell
fi
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
	useradd --system --user-group --home-dir /var/lib/peptides \
		--shell /usr/sbin/nologin "${SERVICE_USER}"
fi
if ! id -u "${BUILD_USER}" >/dev/null 2>&1; then
	useradd --system --user-group --home-dir /nonexistent \
		--shell /usr/sbin/nologin "${BUILD_USER}"
fi
if ! id -u "${BACKUP_USER}" >/dev/null 2>&1; then
	useradd --system --user-group \
		--home-dir /var/lib/peptides-backup \
		--shell /usr/sbin/nologin "${BACKUP_USER}"
fi
deploy_assert_isolated_service_identities \
	|| die "Service, build and backup identities are not strictly isolated."

install -d -o root -g root -m 0755 \
	"${APP_DIR}/releases" \
	"${APP_DIR}/build" \
	"${OPS_DIR}" \
	"${APP_DIR}/bootstrap"
install -d -o root -g root -m 0700 \
	"${APP_DIR}/snapshots" \
	"${APP_DIR}/control-snapshots" \
	"${QUARANTINE_DIR}"
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0700 \
	/var/lib/peptides \
	/var/lib/peptides/static
install -d -o root -g "${BACKUP_USER}" -m 0750 \
	/var/lib/peptides-backup

if [[ ! -e "${TRUST_MARKER}" ]]; then
	clone_staging="$(mktemp -d "${APP_DIR}/repo-bootstrap.XXXXXX")"
	git clone --no-checkout --quiet "${REPO_URL}" \
		"${clone_staging}/repo"

	if [[ -e "${REPO_DIR}" || -L "${REPO_DIR}" ]]; then
		quarantine_target="$(
			date -u '+%Y%m%dT%H%M%SZ'
		)"
		quarantine_target="${QUARANTINE_DIR}/repo-${quarantine_target}"
		[[ ! -e "${quarantine_target}" ]] \
			|| die "A checkout quarantine target already exists."
		mv "${REPO_DIR}" "${quarantine_target}"
		chown -R root:root "${quarantine_target}"
		chmod -R go-rwx "${quarantine_target}"
		warn "The former checkout was quarantined at ${quarantine_target}."
	fi

	mv "${clone_staging}/repo" "${REPO_DIR}"
	rmdir "${clone_staging}"
else
	[[ -f "${TRUST_MARKER}" && ! -L "${TRUST_MARKER}" ]] \
		|| die "${TRUST_MARKER} must be a regular file."
	[[ "$(stat -c '%U:%G %a' "${TRUST_MARKER}")" == "root:root 600" ]] \
		|| die "${TRUST_MARKER} has unsafe ownership or mode."
	[[ -d "${REPO_DIR}/.git" && ! -L "${REPO_DIR}" ]] \
		|| die "Trusted checkout is missing or malformed."
	unexpected_repo_path="$(
		find "${REPO_DIR}" -xdev \( ! -user root -o -perm /022 \) \
			-print -quit
	)"
	[[ -z "${unexpected_repo_path}" ]] \
		|| die "Trusted checkout contains an unsafe path."
fi

chown -R root:root "${REPO_DIR}" "${APP_DIR}/releases"
chmod -R go-w "${REPO_DIR}" "${APP_DIR}/releases"
chmod 0755 "${REPO_DIR}" "${APP_DIR}/releases" "${APP_DIR}/build" \
	"${OPS_DIR}"
chmod 0755 "${APP_DIR}/bootstrap"
chmod 0700 "${APP_DIR}/snapshots" "${APP_DIR}/control-snapshots"

git -C "${REPO_DIR}" -c core.hooksPath=/dev/null \
	fetch --quiet origin main --tags
FULL_SHA="$(git -C "${REPO_DIR}" rev-parse --verify \
	"${TARGET_SHA}^{commit}" 2>/dev/null)" \
	|| die "${TARGET_SHA} is not a commit in the fresh checkout."
[[ "${FULL_SHA}" =~ ^[0-9a-f]{40}$ ]] \
	|| die "The reviewed commit did not resolve to a full SHA."
git -C "${REPO_DIR}" merge-base --is-ancestor "${FULL_SHA}" origin/main \
	|| die "${FULL_SHA} is not an ancestor of origin/main."

OPS_RELEASE="${OPS_DIR}/${FULL_SHA}"
if [[ ! -e "${OPS_RELEASE}" ]]; then
	ops_staging="$(mktemp -d "${OPS_DIR}/${FULL_SHA}.XXXXXX")"
	/usr/bin/env -i \
		PATH="${DEPLOY_TRUSTED_PATH}" \
		/usr/bin/git -C "${REPO_DIR}" -c core.hooksPath=/dev/null \
			archive --format=tar "${FULL_SHA}" deploy \
		| /usr/bin/env -i \
			PATH="${DEPLOY_TRUSTED_PATH}" \
			/usr/bin/tar --extract --file=- \
				--directory="${ops_staging}" \
				--no-same-owner --no-same-permissions
	unexpected_ops_path="$(find "${ops_staging}" -type l -print -quit)"
	[[ -z "${unexpected_ops_path}" ]] \
		|| die "Reviewed operational bundle contains a symbolic link."
	printf '%s\n' "${FULL_SHA}" >"${ops_staging}/.commit"
	chown -R root:root "${ops_staging}"
	chmod -R u=rwX,go=rX "${ops_staging}"
	chmod -R a-w "${ops_staging}"
	mv "${ops_staging}" "${OPS_RELEASE}"
fi
[[ -f "${OPS_RELEASE}/.commit" \
	&& "$(<"${OPS_RELEASE}/.commit")" == "${FULL_SHA}" \
	&& -f "${OPS_RELEASE}/deploy/OPS_PROTOCOL" \
		&& ! -L "${OPS_RELEASE}/deploy/OPS_PROTOCOL" \
		&& "$(<"${OPS_RELEASE}/deploy/OPS_PROTOCOL")" == \
			"${OPS_PROTOCOL_VALUE}" \
	&& -f "${OPS_RELEASE}/deploy/provision.sh" \
	&& -f "${OPS_RELEASE}/deploy/deploy.sh" \
	&& -f "${OPS_RELEASE}/deploy/repair-bridge.sh" ]] \
	|| die "The extracted operational bundle is incomplete."
unexpected_ops_path="$(
	find "${OPS_RELEASE}" \( ! -user root -o -perm /022 -o -type l \) \
		-print -quit
)"
[[ -z "${unexpected_ops_path}" ]] \
	|| die "The extracted operational bundle is not immutable."

ln -sfn "${OPS_RELEASE}" "${OPS_CURRENT}.new"
mv -Tf "${OPS_CURRENT}.new" "${OPS_CURRENT}"
OPS_SOURCE="${OPS_CURRENT}/deploy"

if [[ ! -e "${TRUST_MARKER}" ]]; then
	printf 'sha=%s repaired=%s\n' \
		"${FULL_SHA}" "$(date -u -Is)" >"${TRUST_MARKER}"
	chown root:root "${TRUST_MARKER}"
	chmod 0600 "${TRUST_MARKER}"
fi

if [[ -e "${APP_DIR}/storefront" ]]; then
	chown -R root:root "${APP_DIR}/storefront"
	chmod -R go-w "${APP_DIR}/storefront"
fi

# The legacy upload directory was writable by the compromised-runtime model
# this provisioning run exists to close, so it is untrusted input. A plain
# `rsync -a` recreates symlinks verbatim and a following `chown -R`
# dereferences them, which would let a pre-provision Medusa compromise chown
# arbitrary host files to the runtime user. Validate the tree, copy without
# following or recreating escaping links, and never dereference during chown.
LEGACY_STATIC="${APP_DIR}/current/static"
if [[ -e "${LEGACY_STATIC}" || -L "${LEGACY_STATIC}" ]]; then
	[[ -d "${LEGACY_STATIC}" && ! -L "${LEGACY_STATIC}" ]] \
		|| die "${LEGACY_STATIC} must be a real directory to be adopted."
	deploy_validate_build_source_tree "${LEGACY_STATIC}" \
		|| die "The legacy Medusa upload tree failed the no-follow safety review."
	rsync --archive --safe-links --no-devices --no-specials \
		--no-owner --no-group --ignore-existing \
		"${LEGACY_STATIC}/" \
		/var/lib/peptides/static/
	deploy_validate_build_source_tree /var/lib/peptides/static \
		|| die "The adopted upload tree failed the no-follow safety review."
	chown -R --no-dereference \
		"${SERVICE_USER}:${SERVICE_USER}" /var/lib/peptides/static
	find -P /var/lib/peptides/static -type d -exec chmod 0700 {} +
	find -P /var/lib/peptides/static -type f -exec chmod 0600 {} +
	echo "Copied legacy Medusa static files into the runtime-state directory."
fi
unset LEGACY_STATIC

# ---------------------------------------------------------------------------
log "Environment files"
# ---------------------------------------------------------------------------
[[ ! -L "${ENV_FILE}" ]] || die "${ENV_FILE} must not be a symlink."
if [[ ! -f "${ENV_FILE}" ]]; then
	DATABASE_URL_VALUE=""
	if [[ -n "${DB_PASSWORD}" ]]; then
		DATABASE_URL_VALUE="postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}"
	else
		warn "The Postgres role already existed, so its password is unknown here."
		warn "Set DATABASE_URL in ${ENV_FILE} by hand."
	fi

	JWT_SECRET_VALUE="$(openssl rand -base64 48 | tr -d '\n')"
	COOKIE_SECRET_VALUE="$(openssl rand -base64 48 | tr -d '\n')"
	AUTH_MFA_ENCRYPTION_KEY_VALUE="$(openssl rand -base64 48 | tr -d '\n')"
	SECURITY_HMAC_SECRET_VALUE="$(openssl rand -base64 48 | tr -d '\n')"

	ENV_FILE_TMP="$(mktemp "${APP_DIR}/.env.new.XXXXXX")"
	while IFS= read -r template_line || [[ -n "${template_line}" ]]; do
		case "${template_line}" in
			DATABASE_URL=*)
				printf 'DATABASE_URL=%s\n' "${DATABASE_URL_VALUE}"
				;;
			JWT_SECRET=*)
				printf 'JWT_SECRET=%s\n' "${JWT_SECRET_VALUE}"
				;;
			COOKIE_SECRET=*)
				printf 'COOKIE_SECRET=%s\n' "${COOKIE_SECRET_VALUE}"
				;;
			AUTH_MFA_ENCRYPTION_KEY=*)
				printf 'AUTH_MFA_ENCRYPTION_KEY=%s\n' \
					"${AUTH_MFA_ENCRYPTION_KEY_VALUE}"
				;;
			SECURITY_HMAC_SECRET=*)
				printf 'SECURITY_HMAC_SECRET=%s\n' \
					"${SECURITY_HMAC_SECRET_VALUE}"
				;;
			*)
				printf '%s\n' "${template_line}"
				;;
		esac
	done < "${OPS_SOURCE}/.env.template" > "${ENV_FILE_TMP}"

	install -o root -g "${SERVICE_USER}" -m 0640 \
		"${ENV_FILE_TMP}" "${ENV_FILE}"
	unlink "${ENV_FILE_TMP}"
	unset DATABASE_URL_VALUE JWT_SECRET_VALUE COOKIE_SECRET_VALUE \
		AUTH_MFA_ENCRYPTION_KEY_VALUE SECURITY_HMAC_SECRET_VALUE

	echo "Created ${ENV_FILE} with generated database URL and security secrets"
else
	echo "${ENV_FILE} already present — left untouched"
fi
chown root:"${SERVICE_USER}" "${ENV_FILE}"
chmod 0640 "${ENV_FILE}"

deploy_load_app_env_file "${ENV_FILE}" \
	|| die "${ENV_FILE} failed strict configuration validation."

JWT_SECRET_VALUE="${JWT_SECRET:-}"
COOKIE_SECRET_VALUE="${COOKIE_SECRET:-}"
AUTH_MFA_ENCRYPTION_KEY_VALUE="${AUTH_MFA_ENCRYPTION_KEY:-}"
SECURITY_HMAC_SECRET_VALUE="${SECURITY_HMAC_SECRET:-}"
SECRETS_REPAIRED=0

if [[ "${#JWT_SECRET_VALUE}" -lt 32 \
	|| "${JWT_SECRET_VALUE}" == "supersecret" ]]; then
	JWT_SECRET_VALUE="$(openssl rand -base64 48 | tr -d '\n')"
	SECRETS_REPAIRED=1
fi
if [[ "${#COOKIE_SECRET_VALUE}" -lt 32 \
	|| "${COOKIE_SECRET_VALUE}" == "supersecret" \
	|| "${COOKIE_SECRET_VALUE}" == "${JWT_SECRET_VALUE}" ]]; then
	COOKIE_SECRET_VALUE="$(openssl rand -base64 48 | tr -d '\n')"
	SECRETS_REPAIRED=1
fi
if [[ "${#AUTH_MFA_ENCRYPTION_KEY_VALUE}" -lt 32 \
	|| "${AUTH_MFA_ENCRYPTION_KEY_VALUE}" == "supersecret" \
	|| "${AUTH_MFA_ENCRYPTION_KEY_VALUE}" == "${JWT_SECRET_VALUE}" \
	|| "${AUTH_MFA_ENCRYPTION_KEY_VALUE}" == "${COOKIE_SECRET_VALUE}" ]]; then
	AUTH_MFA_ENCRYPTION_KEY_VALUE="$(
		openssl rand -base64 48 | tr -d '\n'
	)"
	SECRETS_REPAIRED=1
fi
if [[ "${#SECURITY_HMAC_SECRET_VALUE}" -lt 32 \
	|| "${SECURITY_HMAC_SECRET_VALUE}" == "supersecret" \
	|| "${SECURITY_HMAC_SECRET_VALUE}" == "${JWT_SECRET_VALUE}" \
	|| "${SECURITY_HMAC_SECRET_VALUE}" == "${COOKIE_SECRET_VALUE}" \
	|| "${SECURITY_HMAC_SECRET_VALUE}" == \
		"${AUTH_MFA_ENCRYPTION_KEY_VALUE}" ]]; then
	SECURITY_HMAC_SECRET_VALUE="$(openssl rand -base64 48 | tr -d '\n')"
	SECRETS_REPAIRED=1
fi

ENV_FILE_TMP="$(mktemp "${APP_DIR}/.env.secrets.XXXXXX")"
seen_jwt=0
seen_cookie=0
seen_mfa=0
seen_hmac=0
while IFS= read -r env_line || [[ -n "${env_line}" ]]; do
	case "${env_line}" in
	JWT_SECRET=*)
		printf 'JWT_SECRET=%s\n' "${JWT_SECRET_VALUE}"
		seen_jwt=1
		;;
	COOKIE_SECRET=*)
		printf 'COOKIE_SECRET=%s\n' "${COOKIE_SECRET_VALUE}"
		seen_cookie=1
		;;
	AUTH_MFA_ENCRYPTION_KEY=*)
		printf 'AUTH_MFA_ENCRYPTION_KEY=%s\n' \
			"${AUTH_MFA_ENCRYPTION_KEY_VALUE}"
		seen_mfa=1
		;;
	SECURITY_HMAC_SECRET=*)
		printf 'SECURITY_HMAC_SECRET=%s\n' "${SECURITY_HMAC_SECRET_VALUE}"
		seen_hmac=1
		;;
	*)
		printf '%s\n' "${env_line}"
		;;
	esac
done <"${ENV_FILE}" >"${ENV_FILE_TMP}"
[[ "${seen_jwt}" -eq 1 ]] \
	|| printf 'JWT_SECRET=%s\n' "${JWT_SECRET_VALUE}" >>"${ENV_FILE_TMP}"
[[ "${seen_cookie}" -eq 1 ]] \
	|| printf 'COOKIE_SECRET=%s\n' "${COOKIE_SECRET_VALUE}" >>"${ENV_FILE_TMP}"
[[ "${seen_mfa}" -eq 1 ]] \
	|| printf 'AUTH_MFA_ENCRYPTION_KEY=%s\n' \
		"${AUTH_MFA_ENCRYPTION_KEY_VALUE}" >>"${ENV_FILE_TMP}"
[[ "${seen_hmac}" -eq 1 ]] \
	|| printf 'SECURITY_HMAC_SECRET=%s\n' \
		"${SECURITY_HMAC_SECRET_VALUE}" >>"${ENV_FILE_TMP}"
chown root:"${SERVICE_USER}" "${ENV_FILE_TMP}"
chmod 0640 "${ENV_FILE_TMP}"
sync -f "${ENV_FILE_TMP}"
mv -Tf "${ENV_FILE_TMP}" "${ENV_FILE}"
sync -f "${APP_DIR}"
if [[ "${SECRETS_REPAIRED}" -eq 1 ]]; then
	warn "Weak, missing or reused application secrets were rotated; existing sessions are invalid."
fi
unset ENV_FILE_TMP env_line seen_jwt seen_cookie seen_mfa seen_hmac \
	SECRETS_REPAIRED JWT_SECRET_VALUE COOKIE_SECRET_VALUE \
	AUTH_MFA_ENCRYPTION_KEY_VALUE SECURITY_HMAC_SECRET_VALUE
deploy_load_app_env_file "${ENV_FILE}"
deploy_validate_app_secret_values \
	|| die "${ENV_FILE} contains weak or reused application secrets."

[[ ! -L "${CADDY_ENV_FILE}" ]] || die "${CADDY_ENV_FILE} must not be a symlink."
if [[ ! -f "${CADDY_ENV_FILE}" ]]; then
	install -o root -g caddy -m 0640 \
		"${OPS_SOURCE}/caddy.env.template" "${CADDY_ENV_FILE}"
	warn "Created ${CADDY_ENV_FILE} — set ACME_EMAIL."
else
	echo "${CADDY_ENV_FILE} already present — left untouched"
fi
chown root:caddy "${CADDY_ENV_FILE}"
chmod 0640 "${CADDY_ENV_FILE}"

if ! grep -q '^MAINTENANCE_CONFIG=' "${CADDY_ENV_FILE}"; then
	printf 'MAINTENANCE_CONFIG=%s/maintenance.caddy\n' \
		"${APP_DIR}" >>"${CADDY_ENV_FILE}"
fi
if ! grep -q '^CSP_CONFIG=' "${CADDY_ENV_FILE}"; then
	printf 'CSP_CONFIG=%s/csp-current\n' "${APP_DIR}" >>"${CADDY_ENV_FILE}"
fi

[[ ! -L "${BACKUP_ENV_FILE}" ]] \
	|| die "${BACKUP_ENV_FILE} must not be a symlink."
if [[ ! -f "${BACKUP_ENV_FILE}" ]]; then
	install -o root -g root -m 0600 \
		"${OPS_SOURCE}/backup.env.template" "${BACKUP_ENV_FILE}"
	warn "Created ${BACKUP_ENV_FILE} — configure off-host Restic before launch."
else
	echo "${BACKUP_ENV_FILE} already present — left untouched"
fi
chown root:root "${BACKUP_ENV_FILE}"
chmod 0600 "${BACKUP_ENV_FILE}"

(
	deploy_load_app_env_file "${ENV_FILE}"
	deploy_validate_app_secret_values
) || die "${ENV_FILE} failed strict configuration validation."
(
	deploy_load_caddy_env_file "${CADDY_ENV_FILE}"
	[[ "${MAINTENANCE_CONFIG:-}" == "${APP_DIR}/maintenance.caddy" ]]
	[[ "${CSP_CONFIG:-}" == "${APP_DIR}/csp-current" ]]
) || die "${CADDY_ENV_FILE} failed strict configuration validation."

# ---------------------------------------------------------------------------
log "systemd units"
# ---------------------------------------------------------------------------
install -m 0644 \
	"${OPS_SOURCE}/medusa.service" \
	/etc/systemd/system/medusa.service
install -m 0644 "${OPS_SOURCE}/medusa-migrate.service" \
	/etc/systemd/system/medusa-migrate.service
install -m 0644 "${OPS_SOURCE}/medusa-candidate@.service" \
	/etc/systemd/system/medusa-candidate@.service
install -m 0644 "${OPS_SOURCE}/peptides-deploy-guard@.service" \
	/etc/systemd/system/peptides-deploy-guard@.service
install -m 0644 "${OPS_SOURCE}/peptides-activation-watchdog@.service" \
	/etc/systemd/system/peptides-activation-watchdog@.service
install -m 0644 "${OPS_SOURCE}/peptides-backup.service" \
	/etc/systemd/system/peptides-backup.service
install -m 0644 "${OPS_SOURCE}/peptides-backup.timer" \
	/etc/systemd/system/peptides-backup.timer

# Imported Caddy snippets are executable configuration. Never preserve them
# across the trust repair: quarantine the old objects recoverably, then install
# known fail-closed regular files from the reviewed ops bundle.
control_quarantine="${QUARANTINE_DIR}/controls-$(date -u '+%Y%m%dT%H%M%SZ')-$$"
install -d -o root -g root -m 0700 "${control_quarantine}"
for control_name in maintenance.caddy csp-current; do
	control_path="${APP_DIR}/${control_name}"
	if [[ -e "${control_path}" || -L "${control_path}" ]]; then
		mv "${control_path}" "${control_quarantine}/${control_name}"
	fi
done
install -o root -g caddy -m 0644 \
	"${OPS_SOURCE}/maintenance.on.caddy" \
	"${APP_DIR}/maintenance.caddy"
install -o root -g caddy -m 0644 \
	"${OPS_SOURCE}/csp.bootstrap.caddy" \
	"${APP_DIR}/csp-current"
unset control_name control_path control_quarantine

# Caddy needs SITE_DOMAIN and the root-controlled import paths from caddy.env.
install -d -o root -g root -m 0755 /etc/systemd/system/caddy.service.d
caddy_override_temporary="$(
	mktemp /etc/systemd/system/caddy.service.d/.override.XXXXXX
)"
cat >"${caddy_override_temporary}" <<-EOF
	[Service]
	EnvironmentFile=${CADDY_ENV_FILE}
	UMask=0027
	RuntimeDirectory=caddy
	RuntimeDirectoryMode=0700
	ExecStartPre=/usr/bin/test ! -e ${APP_DIR}/recovery-required
	ExecStartPre=/usr/bin/test ! -L ${APP_DIR}/recovery-required
	ExecStartPre=/usr/bin/test ! -e ${APP_DIR}/activation-required
	ExecStartPre=/usr/bin/test ! -L ${APP_DIR}/activation-required
	ExecReload=
	ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile --address unix//run/caddy/admin.sock --force
EOF
chown root:root "${caddy_override_temporary}"
chmod 0644 "${caddy_override_temporary}"
mv -Tf "${caddy_override_temporary}" \
	/etc/systemd/system/caddy.service.d/override.conf
sync -f /etc/systemd/system/caddy.service.d/override.conf
sync -f /etc/systemd/system/caddy.service.d
unset caddy_override_temporary

install -m 0644 "${OPS_SOURCE}/Caddyfile" /etc/caddy/Caddyfile
sync -f /etc/caddy/Caddyfile
sync -f /etc/caddy
sync -f "${APP_DIR}"

systemctl daemon-reload
if [[ "${PROVISION_MODE}" == "fresh" ]]; then
	systemctl enable medusa >/dev/null
	systemctl enable --now peptides-backup.timer >/dev/null
fi
# Caddy and Medusa stay stopped. bootstrap-backend.sh starts them only after the
# reviewed fail-closed configuration validates.
# Repair mode instead restores and proves the legacy read-only runtime below.

# ---------------------------------------------------------------------------
log "Firewall"
# ---------------------------------------------------------------------------
ufw allow 22/tcp   >/dev/null
ufw allow 80/tcp   >/dev/null
ufw allow 443/tcp  >/dev/null
ufw allow 443/udp  >/dev/null
ufw --force default deny incoming  >/dev/null
ufw --force default allow outgoing >/dev/null
ufw --force enable >/dev/null
ufw status verbose

# ---------------------------------------------------------------------------
log "Swap"
# ---------------------------------------------------------------------------
# `medusa build` compiles the admin dashboard with Vite and is memory hungry; on
# a small Hetzner instance it gets OOM-killed without swap.
if ! swapon --show | grep -q '/swapfile'; then
	fallocate -l 4G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile >/dev/null
	swapon /swapfile
	grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
	echo "4G swap enabled"
else
	echo "Swap already present"
fi

# ---------------------------------------------------------------------------
log "Unattended security upgrades"
# ---------------------------------------------------------------------------
dpkg-reconfigure -f noninteractive unattended-upgrades

if [[ "${PROVISION_MODE}" == "repair" ]]; then
	# Restore the exact stopped legacy runtime under the new root-owned
	# storefront pointer and generated CSP. It remains the temporary production
	# runtime only until deploy.sh activates the first complete immutable
	# backend/storefront pair.
	deploy_load_caddy_env_file "${CADDY_ENV_FILE}"
	: "${SITE_DOMAIN:?SITE_DOMAIN must be configured for repair verification.}"
	[[ "${SITE_DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]] \
		|| die "SITE_DOMAIN is malformed."

	caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
		>/dev/null \
		|| die "Caddy rejected the repaired configuration."

	systemctl reset-failed medusa.service >/dev/null 2>&1 || true
	systemctl start medusa.service \
		|| die "The read-only legacy Medusa service did not start."
	legacy_backend_healthy=0
	for _ in $(seq 1 60); do
		if [[ "$(
			curl --disable --silent --show-error \
				--noproxy '*' --max-time 3 \
				http://127.0.0.1:9000/health 2>/dev/null || true
		)" == "OK" ]]; then
			legacy_backend_healthy=1
			break
		fi
		sleep 3
	done
	[[ "${legacy_backend_healthy}" -eq 1 ]] \
		|| die "The read-only legacy backend failed its exact health check."
	unset legacy_backend_healthy

	legacy_main_pid="$(
		systemctl show medusa.service --property=MainPID --value
	)"
	legacy_control_group="$(
		systemctl show medusa.service --property=ControlGroup --value
	)"
	[[ "${legacy_main_pid}" =~ ^[1-9][0-9]*$ \
		&& "${legacy_control_group}" == /system.slice/* \
		&& -r "/sys/fs/cgroup${legacy_control_group}/cgroup.procs" \
		&& "$(/usr/bin/readlink -f "/proc/${legacy_main_pid}/cwd")" == \
			"${LEGACY_RELEASE}" \
		&& "$(stat -c '%U' "/proc/${legacy_main_pid}")" == "medusa" ]] \
		|| die "The healthy process is not the intended legacy Medusa unit."
	grep -Fxq "${legacy_main_pid}" \
		"/sys/fs/cgroup${legacy_control_group}/cgroup.procs" \
		|| die "The legacy Medusa PID is outside the expected service cgroup."
	unset legacy_main_pid legacy_control_group

	unexpected_legacy_path="$(
		find -P "${LEGACY_RELEASE}" "${LEGACY_STOREFRONT}" \
			\( ! -user root -o -perm /022 \) -print -quit
	)"
	[[ -z "${unexpected_legacy_path}" ]] \
		|| die "The restored legacy runtime is not root-owned and immutable."
	if /usr/sbin/runuser -u "${SERVICE_USER}" -- \
		/usr/bin/test -w "${LEGACY_RELEASE}"; then
		die "The restored runtime identity can still write the legacy release."
	fi
	unset unexpected_legacy_path

	systemctl reset-failed caddy.service >/dev/null 2>&1 || true
	systemctl start caddy.service \
		|| die "The repaired Caddy service did not start."
	"${OPS_SOURCE}/verify-release.sh" \
		external "${SITE_DOMAIN}" \
		|| die "The repaired public storefront or legacy API failed verification."

	systemctl enable medusa.service caddy.service >/dev/null
	systemctl enable --now peptides-backup.timer >/dev/null
	unlink "${PROVISION_RECOVERY}"
	sync -f "${APP_DIR}"
	PROVISION_MARKER_WRITTEN=0
	unset ACME_EMAIL GATE_USER GATE_PASSWORD_HASH SITE_GATED SITE_DOMAIN \
		MAINTENANCE_CONFIG CSP_CONFIG
fi

# ---------------------------------------------------------------------------
log "Done"
# ---------------------------------------------------------------------------
if [[ "${PROVISION_MODE}" == "fresh" ]]; then
	cat <<-EOF

	Next steps:

	  1. Point DNS at this box (A records for @, www and api) — Caddy cannot
	     issue certificates until they resolve. See docs/deploy.md.

	  2. Set ACME_EMAIL in:
	       ${CADDY_ENV_FILE}
	     The storefront is public — there is no gate credential to configure.

		  3. On a pristine database only:
		       bash ${OPS_CURRENT}/deploy/bootstrap-backend.sh ${FULL_SHA}

		  4. Complete the matching immutable release:
		       bash ${OPS_CURRENT}/deploy/deploy.sh ${FULL_SHA}

	EOF
else
	cat <<-EOF

	Repair complete. The legacy backend and storefront are root-owned,
	read-only and externally verified. Complete the immutable transition:

	  /usr/bin/env -i PATH=${DEPLOY_TRUSTED_PATH} HOME=/root LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC /usr/bin/bash ${OPS_CURRENT}/deploy/deploy.sh ${FULL_SHA}

	EOF
fi
