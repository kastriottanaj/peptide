#!/usr/bin/env bash
#
# Static contracts for the hardened systemd units. This test intentionally
# parses unit text instead of calling systemctl/systemd-analyze, so it also runs
# on developer machines and CI containers without systemd.

set -euo pipefail

TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd -- "${TEST_DIR}/.." && pwd)"

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

assert_line() {
	local file="$1" pattern="$2" description="$3"
	grep -Eq -- "${pattern}" "${file}" \
		|| fail "${description} (${file})"
}

assert_no_line() {
	local file="$1" pattern="$2" description="$3"
	if grep -Eq -- "${pattern}" "${file}"; then
		fail "${description} (${file})"
	fi
}

MEDUSA="${DEPLOY_DIR}/medusa.service"
MIGRATE="${DEPLOY_DIR}/medusa-migrate.service"
BACKUP="${DEPLOY_DIR}/peptides-backup.service"
TIMER="${DEPLOY_DIR}/peptides-backup.timer"
BACKUP_SCRIPT="${DEPLOY_DIR}/backup.sh"
PROVISION="${DEPLOY_DIR}/provision.sh"

for required in "${MEDUSA}" "${MIGRATE}" "${BACKUP}" "${TIMER}" \
	"${BACKUP_SCRIPT}" "${PROVISION}"; do
	[[ -f "${required}" ]] || fail "missing required unit ${required}"
done

# Runtime: an unprivileged process, an immutable release pointer and one private
# writable state directory. There must be no writable /srv exception.
assert_line "${MEDUSA}" '^User=medusa$' "runtime must run as medusa"
assert_line "${MEDUSA}" '^Group=medusa$' "runtime must use the medusa group"
assert_line "${MEDUSA}" '^WorkingDirectory=/srv/peptides/backend-current/apps/backend/\.medusa/server$' \
	"runtime must use the built server inside the root-managed backend pointer"
assert_line "${MEDUSA}" '^StateDirectory=peptides$' \
	"runtime must use the dedicated state directory"
assert_line "${MEDUSA}" '^StateDirectoryMode=0700$' \
	"runtime state directory must be private"
assert_line "${MEDUSA}" '^UMask=0077$' "runtime umask must be private"
assert_line "${MEDUSA}" '^ProtectSystem=strict$' \
	"runtime filesystem protection must be strict"
assert_line "${MEDUSA}" '^ReadOnlyPaths=/srv/peptides$' \
	"runtime must see the application boundary read-only"
assert_line "${MEDUSA}" '^ExecStartPre=/usr/bin/mkdir -p /var/lib/peptides/static$' \
	"runtime must keep uploaded files in its state directory"
assert_line "${MEDUSA}" '^ExecStart=/usr/bin/node /srv/peptides/backend-current/node_modules/@medusajs/cli/cli\.js start --host 127\.0\.0\.1 --port 9000$' \
	"runtime must invoke the release-local CLI by absolute path"
assert_no_line "${MEDUSA}" '^ReadWritePaths=.*(/srv/peptides|/srv($|[[:space:]]))' \
	"runtime must not receive a writable /srv path"
assert_no_line "${MEDUSA}" '(^|[[:space:]])(npx|/usr/bin/env)([[:space:]]|$)' \
	"runtime must not resolve an executable through npx or env"

# Migration: same filesystem boundary and runtime identity, but the root-owned
# candidate pointer and the release-local db:migrate command.
assert_line "${MIGRATE}" '^Type=oneshot$' "migration must be a oneshot"
assert_line "${MIGRATE}" '^User=medusa$' "migration must run as medusa"
assert_line "${MIGRATE}" '^Group=medusa$' "migration must use the medusa group"
assert_line "${MIGRATE}" '^WorkingDirectory=/srv/peptides/backend-candidate/apps/backend/\.medusa/server$' \
	"migration must use the built server inside the candidate pointer"
assert_line "${MIGRATE}" '^ExecStart=/usr/bin/node /srv/peptides/backend-candidate/node_modules/@medusajs/cli/cli\.js db:migrate$' \
	"migration must invoke the candidate-local CLI"
assert_line "${MIGRATE}" '^Conflicts=medusa\.service$' \
	"migration must not overlap the runtime"
assert_line "${MIGRATE}" '^StateDirectory=peptides$' \
	"migration must share only the runtime state directory"
assert_line "${MIGRATE}" '^StateDirectoryMode=0700$' \
	"migration state directory must be private"
assert_line "${MIGRATE}" '^UMask=0077$' "migration umask must be private"
assert_line "${MIGRATE}" '^ProtectSystem=strict$' \
	"migration filesystem protection must be strict"
assert_line "${MIGRATE}" '^ReadOnlyPaths=/srv/peptides$' \
	"migration must see the application boundary read-only"
assert_no_line "${MIGRATE}" '^ReadWritePaths=.*(/srv/peptides|/srv($|[[:space:]]))' \
	"migration must not receive a writable /srv path"
assert_no_line "${MIGRATE}" '(^|[[:space:]])(npx|/usr/bin/env)([[:space:]]|$)' \
	"migration must not resolve an executable through npx or env"

# Backup: root parses its root-only Restic configuration after process startup;
# strict filesystem protection confines writes to the private staging state.
assert_line "${BACKUP}" '^Type=oneshot$' "backup must be a oneshot"
assert_line "${BACKUP}" '^User=root$' "backup must run as root"
assert_line "${BACKUP}" '^Group=peptides-backup$' \
	"root orchestration must share state only with the dedicated backup group"
assert_no_line "${BACKUP}" '^EnvironmentFile=' \
	"backup must not preload an environment file before sanitization"
assert_line "${BACKUP}" '^ExecStart=/usr/bin/flock --exclusive --wait 1800 /srv/peptides/deploy\.lock /usr/bin/bash /srv/peptides/ops-current/deploy/backup\.sh$' \
	"backup must wait a bounded time for the deploy lock before opening operational code"
assert_no_line "${BACKUP}" '^ExecStart=.*--nonblock' \
	"scheduled backup must not silently skip when a deploy owns the lock"
assert_line "${BACKUP}" '^TimeoutStartSec=21600$' \
	"backup timeout must include bounded lock wait and remote verification"
assert_line "${BACKUP}" '^TimeoutStopSec=180$' \
	"backup must have time to run its backend-restart exit trap"
assert_line "${BACKUP}" '^Environment=HOME=/var/lib/peptides-backup$' \
	"backup must use its private state as HOME"
assert_line "${BACKUP}" '^StateDirectory=peptides-backup$' \
	"backup must use a dedicated staging directory"
assert_line "${BACKUP}" '^StateDirectoryMode=0750$' \
	"backup state must grant only dedicated-group traversal"
assert_line "${BACKUP}" '^UMask=0077$' "backup umask must be private"
assert_line "${BACKUP}" '^ProtectSystem=strict$' \
	"backup filesystem protection must be strict"
assert_line "${BACKUP}" '^ReadOnlyPaths=/srv/peptides$' \
	"backup must not alter the application boundary"
assert_no_line "${BACKUP}" '^ReadWritePaths=.*(/srv/peptides|/srv($|[[:space:]]))' \
	"backup must not receive a writable /srv path"
assert_line "${BACKUP}" '^CapabilityBoundingSet=CAP_DAC_READ_SEARCH CAP_CHOWN CAP_SETUID CAP_SETGID CAP_SETPCAP$' \
	"root backup must retain only staging and credential-drop capabilities"
assert_line "${BACKUP}" '^AmbientCapabilities=CAP_DAC_READ_SEARCH CAP_CHOWN CAP_SETUID CAP_SETGID CAP_SETPCAP$' \
	"setpriv must receive the capabilities required to drop identity and bounds"
assert_line "${BACKUP_SCRIPT}" '^[[:space:]]*"--reuid=\$\{BACKUP_USER_UID\}"' \
	"Restic runner must switch to the dedicated backup UID"
assert_line "${BACKUP_SCRIPT}" '^[[:space:]]*"--regid=\$\{BACKUP_USER_GID\}"' \
	"Restic runner must switch to the dedicated backup GID"
assert_line "${BACKUP_SCRIPT}" '^[[:space:]]*--clear-groups' \
	"Restic runner must clear supplementary groups"
assert_line "${BACKUP_SCRIPT}" '^[[:space:]]*--bounding-set=-all' \
	"Restic runner must clear the capability bounding set"
assert_line "${BACKUP_SCRIPT}" '^[[:space:]]*--inh-caps=-all' \
	"Restic runner must clear inheritable capabilities"
assert_line "${BACKUP_SCRIPT}" '^[[:space:]]*--ambient-caps=-all' \
	"Restic runner must clear ambient capabilities"
assert_line "${BACKUP_SCRIPT}" '^[[:space:]]*--no-new-privs' \
	"Restic runner must forbid regaining privilege"
assert_line "${BACKUP_SCRIPT}" 'RECOVERY_REQUIRED=.*/recovery-required' \
	"backup script must re-check recovery state after acquiring the lock"
assert_line "${BACKUP_SCRIPT}" 'ACTIVATION_REQUIRED=.*/activation-required' \
	"backup script must re-check activation state after acquiring the lock"
assert_line "${BACKUP_SCRIPT}" 'PROVISION_RECOVERY_REQUIRED=.*/provision-recovery-required' \
	"backup script must re-check provisioning recovery state after the lock"

# Provisioning creates a locked non-login identity and a shared-traversal-only
# state directory before systemd can start the timer.
assert_line "${PROVISION}" '^BACKUP_USER=peptides-backup$' \
	"provisioning must name the dedicated backup identity"
assert_line "${PROVISION}" '^[[:space:]]*useradd --system --user-group' \
	"provisioning must create an isolated backup system user/group"
assert_line "${PROVISION}" '^[[:space:]]*--shell /usr/sbin/nologin "\$\{BACKUP_USER\}"$' \
	"backup identity must not have a login shell"
assert_line "${PROVISION}" '^[[:space:]]*install -d -o root -g "\$\{BACKUP_USER\}" -m 0750' \
	"provisioning must protect the shared backup state root"

# Timer: missed runs are caught up after reboot and the timer targets only the
# hardened backup service.
assert_line "${TIMER}" '^Persistent=true$' \
	"backup timer must catch up missed runs"
assert_line "${TIMER}" '^Unit=peptides-backup\.service$' \
	"backup timer must target the hardened service"
assert_line "${TIMER}" '^WantedBy=timers\.target$' \
	"backup timer must be installable"

printf 'PASS: hardened unit permission contracts\n'
