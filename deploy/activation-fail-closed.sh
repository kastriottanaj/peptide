#!/usr/bin/bash
#
# ExecStopPost helper for the deployment activation watchdog. If the invoking
# deploy shell disappears before external verification commits activation,
# stop both public routing and background application work. The durable marker
# also blocks both units on reboot.

set -u
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

ACTIVATION_REQUIRED=/srv/peptides/activation-required

if [[ -e "${ACTIVATION_REQUIRED}" || -L "${ACTIVATION_REQUIRED}" ]]; then
	/usr/bin/systemctl --no-block stop \
		caddy.service medusa.service >/dev/null 2>&1 || :
fi

exit 0
