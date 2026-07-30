#!/usr/bin/env bash
#
# One-time setup for a fresh Hetzner box (Ubuntu 24.04). No Docker: Postgres,
# Redis, Node and Caddy come from apt, and Medusa runs as a systemd service.
#
# Idempotent — safe to re-run. It checks for what it is about to install and
# never overwrites an existing /srv/peptides/.env.
#
# Run as root on the server:
#   bash provision.sh
#
# Afterwards: fill in the blanks in /srv/peptides/.env and
# /srv/peptides/caddy.env, then run deploy/deploy.sh.

set -euo pipefail

APP_DIR=/srv/peptides
REPO_URL=https://github.com/kastriottanaj/peptide.git
REPO_DIR="${APP_DIR}/repo"
ENV_FILE="${APP_DIR}/.env"
CADDY_ENV_FILE="${APP_DIR}/caddy.env"

DB_NAME=medusa_peptides
DB_USER=medusa
SERVICE_USER=medusa

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
	echo "Run as root." >&2
	exit 1
fi

# ---------------------------------------------------------------------------
log "System packages"
# ---------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
	ca-certificates curl git gnupg rsync ufw \
	debian-keyring debian-archive-keyring apt-transport-https \
	postgresql postgresql-contrib redis-server \
	unattended-upgrades \
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
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
	curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
	apt-get install -y -qq nodejs
fi
echo "node $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------------------
log "npm fetch tuning"
# ---------------------------------------------------------------------------
# registry.npmjs.org sits behind Cloudflare, which rate-limits by request volume
# per IP — and Hetzner ranges are treated harshly. A deploy runs two installs:
# `npm ci` for the build (~1400 packages) and a second `npm install` when
# assembling the release. The first one spends the IP's budget, and the second
# then walks into a wall of 429s.
#
# npm's default of 2 retries gives up long before that budget refills, so the
# deploy dies at "Assembling release" with `E429 Too Many Requests` on whichever
# @medusajs package it happened to reach. Retrying the deploy does not help; the
# budget is still empty. Waiting 45 minutes between attempts does not help
# either, because the first install empties it again immediately.
#
# More patient retries are what actually clears it: 8 attempts backing off up to
# 180 s outlast the refill. Fewer sockets lower the burst rate that trips the
# limit in the first place. Deploys get slower and stop failing.
#
# Observed 2026-07-30: five consecutive deploys of c9fc26e failed here; the
# sixth, with these settings, went through. See docs/deploy.md.
npm config set maxsockets 2
npm config set fetch-retries 8
npm config set fetch-retry-mintimeout 20000
npm config set fetch-retry-maxtimeout 180000
echo "npm: maxsockets=$(npm config get maxsockets), retries=$(npm config get fetch-retries)"

# ---------------------------------------------------------------------------
log "Caddy"
# ---------------------------------------------------------------------------
if ! command -v caddy >/dev/null 2>&1; then
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
		| gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
		> /etc/apt/sources.list.d/caddy-stable.list
	apt-get update -qq
	apt-get install -y -qq caddy
fi
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
	DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
	sudo -u postgres psql -qc \
		"CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';"
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
log "Service user and directories"
# ---------------------------------------------------------------------------
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
	useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

mkdir -p "${APP_DIR}/releases" "${APP_DIR}/storefront"

if [[ ! -d "${REPO_DIR}/.git" ]]; then
	git clone --quiet "${REPO_URL}" "${REPO_DIR}"
else
	echo "Repo already cloned at ${REPO_DIR}"
fi

# ---------------------------------------------------------------------------
log "Environment files"
# ---------------------------------------------------------------------------
if [[ ! -f "${ENV_FILE}" ]]; then
	cp "${REPO_DIR}/deploy/.env.template" "${ENV_FILE}"

	if [[ -n "${DB_PASSWORD}" ]]; then
		sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}|" "${ENV_FILE}"
	else
		warn "The Postgres role already existed, so its password is unknown here."
		warn "Set DATABASE_URL in ${ENV_FILE} by hand."
	fi

	sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 32)|"       "${ENV_FILE}"
	sed -i "s|^COOKIE_SECRET=.*|COOKIE_SECRET=$(openssl rand -base64 32)|" "${ENV_FILE}"

	echo "Created ${ENV_FILE} with generated database URL and signing secrets"
else
	echo "${ENV_FILE} already present — left untouched"
fi
chown "${SERVICE_USER}:${SERVICE_USER}" "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

if [[ ! -f "${CADDY_ENV_FILE}" ]]; then
	cp "${REPO_DIR}/deploy/caddy.env.template" "${CADDY_ENV_FILE}"
	warn "Created ${CADDY_ENV_FILE} — set ACME_EMAIL, GATE_USER and GATE_PASSWORD_HASH."
else
	echo "${CADDY_ENV_FILE} already present — left untouched"
fi
chown root:caddy "${CADDY_ENV_FILE}"
chmod 640 "${CADDY_ENV_FILE}"

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}/releases" "${APP_DIR}/storefront"

# ---------------------------------------------------------------------------
log "systemd units"
# ---------------------------------------------------------------------------
install -m 0644 "${REPO_DIR}/deploy/medusa.service" /etc/systemd/system/medusa.service

# Caddy needs SITE_DOMAIN and the gate variables from caddy.env.
mkdir -p /etc/systemd/system/caddy.service.d
cat >/etc/systemd/system/caddy.service.d/override.conf <<-EOF
	[Service]
	EnvironmentFile=${CADDY_ENV_FILE}
EOF

install -m 0644 "${REPO_DIR}/deploy/Caddyfile" /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl enable medusa >/dev/null
# Not started here: there is no release to run yet. deploy.sh starts it.

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

# ---------------------------------------------------------------------------
log "Done"
# ---------------------------------------------------------------------------
cat <<-EOF

	Next steps:

	  1. Point DNS at this box (A records for @, www and api) — Caddy cannot
	     issue certificates until they resolve. See docs/deploy.md.

	  2. Set ACME_EMAIL, GATE_USER and GATE_PASSWORD_HASH in:
	       ${CADDY_ENV_FILE}
	     Generate the hash with:
	       caddy hash-password --plaintext 'your-password'

	  3. bash ${REPO_DIR}/deploy/deploy.sh <commit-sha>

EOF
