#!/usr/bin/env bash
#
# One-time setup for a fresh Hetzner box (Ubuntu 24.04). Idempotent — safe to
# re-run; it checks for what it is about to install.
#
# Run as root on the server:
#   bash provision.sh
#
# Afterwards: fill in /srv/peptides/.env, then run deploy/deploy.sh.

set -euo pipefail

APP_DIR=/srv/peptides
REPO_URL=https://github.com/kastriottanaj/peptide.git
REPO_DIR="${APP_DIR}/repo"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
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
apt-get install -y -qq ca-certificates curl git ufw rsync ntpsec unattended-upgrades

# ---------------------------------------------------------------------------
log "Docker"
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
	install -m 0755 -d /etc/apt/keyrings
	curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
		-o /etc/apt/keyrings/docker.asc
	chmod a+r /etc/apt/keyrings/docker.asc
	cat >/etc/apt/sources.list.d/docker.list <<-EOF
		deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME}") stable
	EOF
	apt-get update -qq
	apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
		docker-buildx-plugin docker-compose-plugin
	systemctl enable --now docker
else
	echo "Docker already installed: $(docker --version)"
fi

# Cap journald and container logs — a chatty Medusa can otherwise fill the disk.
if [[ ! -f /etc/docker/daemon.json ]]; then
	log "Docker log rotation"
	cat >/etc/docker/daemon.json <<-'EOF'
		{
		  "log-driver": "json-file",
		  "log-opts": { "max-size": "10m", "max-file": "3" }
		}
	EOF
	systemctl restart docker
fi

# ---------------------------------------------------------------------------
log "Firewall"
# ---------------------------------------------------------------------------
# Docker publishes ports by writing iptables rules that bypass ufw's INPUT
# chain, so ufw is a backstop for host services, not for the containers. Only
# Caddy publishes ports, and 80/443 are open here anyway.
ufw allow 22/tcp   >/dev/null
ufw allow 80/tcp   >/dev/null
ufw allow 443/tcp  >/dev/null
ufw allow 443/udp  >/dev/null
ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
ufw --force enable >/dev/null
ufw status verbose

# ---------------------------------------------------------------------------
log "Swap"
# ---------------------------------------------------------------------------
# `medusa build` compiles the admin dashboard and is memory hungry; on a small
# Hetzner instance it gets OOM-killed without swap.
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
log "Application directories"
# ---------------------------------------------------------------------------
mkdir -p "${APP_DIR}" "${APP_DIR}/storefront"

if [[ ! -d "${REPO_DIR}/.git" ]]; then
	git clone "${REPO_URL}" "${REPO_DIR}"
else
	echo "Repo already cloned at ${REPO_DIR}"
fi

if [[ ! -f "${APP_DIR}/.env" ]]; then
	cp "${REPO_DIR}/deploy/.env.template" "${APP_DIR}/.env"
	chmod 600 "${APP_DIR}/.env"
	warn "Created ${APP_DIR}/.env from the template — fill it in before deploying."
else
	chmod 600 "${APP_DIR}/.env"
	echo ".env already present"
fi

# ---------------------------------------------------------------------------
log "Done"
# ---------------------------------------------------------------------------
cat <<-EOF

	Next steps:

	  1. Point DNS at this box (A records for @, www and api) — Caddy cannot
	     issue certificates until they resolve. See docs/deploy.md.
	  2. Fill in ${APP_DIR}/.env  (secrets, gate password hash, ACME email).
	  3. bash ${REPO_DIR}/deploy/deploy.sh <commit-sha>

EOF
