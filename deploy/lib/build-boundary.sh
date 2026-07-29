#!/usr/bin/env bash
#
# Containment and promotion helpers for untrusted package lifecycle/build code.
# This library is sourced only after lib/common.sh has sanitized the caller.

if [[ "${DEPLOY_BUILD_BOUNDARY_LOADED:-0}" == "1" ]]; then
	return 0
fi
DEPLOY_BUILD_BOUNDARY_LOADED=1

BUILD_TRANSIENT_UNIT=""
BUILD_TRANSIENT_COUNTER=0
DEPLOY_BUILD_RESOLVER_FILE="$(
	/usr/bin/realpath -e -- "${BASH_SOURCE[0]%/*}/../build-resolv.conf"
)" || {
	deploy_error "could not resolve the build-sandbox resolver file"
	return 1
}
readonly DEPLOY_BUILD_RESOLVER_FILE

DEPLOY_BUILD_DENIED_NETWORKS=(
	0.0.0.0/8
	10.0.0.0/8
	100.64.0.0/10
	127.0.0.0/8
	169.254.0.0/16
	172.16.0.0/12
	192.0.0.0/24
	192.0.2.0/24
	192.168.0.0/16
	198.18.0.0/15
	198.51.100.0/24
	203.0.113.0/24
	224.0.0.0/4
	240.0.0.0/4
	::/128
	::1/128
	64:ff9b::/96
	100::/64
	2001:db8::/32
	fc00::/7
	fe80::/10
	ff00::/8
)

deploy_build_user_has_processes() {
	local build_user="$1"
	/usr/bin/pgrep -u "${build_user}" >/dev/null 2>&1
}

deploy_stop_transient_build() {
	if [[ -n "${BUILD_TRANSIENT_UNIT}" ]]; then
		/usr/bin/systemctl kill --kill-whom=all \
			--signal=KILL "${BUILD_TRANSIENT_UNIT}" >/dev/null 2>&1 || :
		/usr/bin/systemctl stop "${BUILD_TRANSIENT_UNIT}" \
			>/dev/null 2>&1 || :
		BUILD_TRANSIENT_UNIT=""
	fi
}

# Run one command as the non-login build identity inside a transient systemd
# service. KillMode=control-group prevents a lifecycle script from daemonizing
# and retaining writable descriptors after the command appears to finish.
deploy_run_contained_build() {
	if [[ "$#" -lt 4 ]]; then
		deploy_error \
			"deploy_run_contained_build requires USER WORKSPACE WORKDIR COMMAND"
		return 2
	fi

	local build_user="$1" workspace="$2" working_directory="$3"
	local status=0 suffix resolved_workspace resolved_working_directory
	local network resolver_owner resolver_mode
	local -a network_properties=()
	shift 3

	[[ "${workspace}" == /srv/peptides/build/* \
		&& -d "${workspace}" && ! -L "${workspace}" ]] || {
		deploy_error "build workspace is outside the trusted disposable root"
		return 1
	}
	[[ "${working_directory}" == "${workspace}" \
		|| "${working_directory}" == "${workspace}/"* ]] || {
		deploy_error "build working directory escapes the disposable workspace"
		return 1
	}
	[[ -d "${working_directory}" && ! -L "${working_directory}" ]] || {
		deploy_error "build working directory is not a real directory"
		return 1
	}
	resolved_workspace="$(/usr/bin/realpath -e -- "${workspace}")" || return 1
	resolved_working_directory="$(
		/usr/bin/realpath -e -- "${working_directory}"
	)" || return 1
	case "${resolved_working_directory}" in
		"${resolved_workspace}" | "${resolved_workspace}/"*)
			;;
		*)
			deploy_error "build working directory resolves outside its workspace"
			return 1
			;;
	esac

	if deploy_build_user_has_processes "${build_user}"; then
		deploy_error \
			"the build identity already owns a process; refusing ambiguous state"
		return 1
	fi

	[[ -f "${DEPLOY_BUILD_RESOLVER_FILE}" \
		&& ! -L "${DEPLOY_BUILD_RESOLVER_FILE}" ]] || {
		deploy_error "build resolver configuration is not a regular file"
		return 1
	}
	resolver_owner="$(
		/usr/bin/stat -c '%U:%G' "${DEPLOY_BUILD_RESOLVER_FILE}"
	)" || return 1
	resolver_mode="$(
		/usr/bin/stat -c '%a' "${DEPLOY_BUILD_RESOLVER_FILE}"
	)" || return 1
	[[ "${resolver_owner}" == "root:root" \
		&& "${resolver_mode}" == "444" ]] || {
		deploy_error "build resolver configuration is not root-owned and immutable"
		return 1
	}
	for network in "${DEPLOY_BUILD_DENIED_NETWORKS[@]}"; do
		network_properties+=("--property=IPAddressDeny=${network}")
	done

	BUILD_TRANSIENT_COUNTER=$((BUILD_TRANSIENT_COUNTER + 1))
	suffix="${FULL_SHA:-bootstrap}"
	suffix="${suffix:0:12}"
	BUILD_TRANSIENT_UNIT="peptides-build-${suffix}-$$-${BUILD_TRANSIENT_COUNTER}.service"

	/usr/bin/systemd-run \
		--unit="${BUILD_TRANSIENT_UNIT}" \
		--wait \
		--collect \
		--pipe \
		--quiet \
		--service-type=exec \
		--property="User=${build_user}" \
		--property="Group=${build_user}" \
		--property="WorkingDirectory=${working_directory}" \
		--property="KillMode=control-group" \
		--property="TimeoutStopSec=15" \
		--property="UMask=0077" \
		--property="ProtectSystem=strict" \
		--property="ReadWritePaths=${workspace}" \
		--property="BindReadOnlyPaths=${DEPLOY_BUILD_RESOLVER_FILE}:/etc/resolv.conf" \
		--property="ProtectHome=true" \
		--property="PrivateDevices=true" \
		--property="PrivateTmp=true" \
		--property="NoNewPrivileges=true" \
		--property="ProtectClock=true" \
		--property="ProtectControlGroups=true" \
		--property="ProtectHostname=true" \
		--property="ProtectKernelLogs=true" \
		--property="ProtectKernelModules=true" \
		--property="ProtectKernelTunables=true" \
		--property="RestrictNamespaces=true" \
		--property="RestrictRealtime=true" \
		--property="RestrictSUIDSGID=true" \
		--property="LockPersonality=true" \
		--property="RemoveIPC=true" \
		--property="CapabilityBoundingSet=" \
		--property="AmbientCapabilities=" \
		--property="RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6" \
		"${network_properties[@]}" \
		/usr/bin/env -i \
			PATH="${DEPLOY_TRUSTED_PATH}" \
			HOME="${workspace}/home" \
			XDG_CACHE_HOME="${workspace}/cache" \
			TMPDIR="${workspace}/tmp" \
			npm_config_cache="${workspace}/npm-cache" \
			CI=1 \
			"$@" </dev/null || status=$?

	# systemd-run --wait should already have completed the control group. A
	# second explicit kill plus a global UID check turns that expectation into
	# a hard assertion and catches a future unit-property regression.
	deploy_stop_transient_build
	if deploy_build_user_has_processes "${build_user}"; then
		deploy_error \
			"the contained build left a process behind after control-group teardown"
		return 1
	fi
	return "${status}"
}

deploy_validate_build_source_tree() {
	local root="$1" unexpected link resolved

	[[ -d "${root}" && ! -L "${root}" ]] || {
		deploy_error "build source artifact is not a real directory"
		return 1
	}
	unexpected="$(
		/usr/bin/find -P "${root}" \
			! -type d ! -type f ! -type l -print -quit
	)"
	[[ -z "${unexpected}" ]] || {
		deploy_error "build source artifact contains a special filesystem object"
		return 1
	}
	unexpected="$(
		/usr/bin/find -P "${root}" -type f -links +1 -print -quit
	)"
	[[ -z "${unexpected}" ]] || {
		deploy_error "build source artifact contains a hard-linked regular file"
		return 1
	}
	while IFS= read -r link; do
		[[ -n "${link}" ]] || continue
		resolved="$(/usr/bin/realpath -m -- "${link}")" || return 1
		case "${resolved}" in
			"${root}/"*)
				;;
			*)
				deploy_error "build source artifact contains an escaping symlink"
				return 1
				;;
		esac
	done < <(/usr/bin/find -P "${root}" -type l -print)
	return 0
}

deploy_validate_csp_import() {
	local csp_file="$1" mode="$2"
	local header_name line_count byte_count

	case "${mode}" in
		enforce)
			header_name=Content-Security-Policy
			;;
		report-only)
			header_name=Content-Security-Policy-Report-Only
			;;
		*)
			deploy_error "unknown CSP validation mode"
			return 2
			;;
	esac

	[[ -f "${csp_file}" && ! -L "${csp_file}" ]] || return 1
	byte_count="$(/usr/bin/wc -c <"${csp_file}")" || return 1
	line_count="$(/usr/bin/wc -l <"${csp_file}")" || return 1
	[[ "${byte_count}" -ge 256 && "${byte_count}" -le 131072 \
		&& "${line_count}" -eq 4 ]] || {
		deploy_error "generated CSP import has an unexpected size or shape"
		return 1
	}
	/usr/bin/grep -Fxq \
		"# Generated by deploy/build-csp.mjs; do not edit." \
		"${csp_file}" || return 1
	/usr/bin/grep -Eq \
		"^header ${header_name} \"default-src 'self'; script-src 'self' " \
		"${csp_file}" || return 1
	/usr/bin/grep -Eq \
		"; script-src-attr 'none'; .*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'\"$" \
		"${csp_file}" || return 1
	if /usr/bin/grep -Eq \
		"unsafe-eval|script-src[^;]*'unsafe-inline'|default-src \\*" \
		"${csp_file}"; then
		deploy_error "generated CSP import contains a forbidden broad source"
		return 1
	fi
	return 0
}

deploy_validate_promoted_tree() {
	if [[ "$#" -ne 2 ]]; then
		deploy_error "deploy_validate_promoted_tree requires ROOT STATIC_LINK"
		return 2
	fi

	local root="$1" expected_static="$2"
	local unexpected link resolved

	[[ -d "${root}" && ! -L "${root}" ]] || {
		deploy_error "promoted artifact root is not a real directory"
		return 1
	}

	unexpected="$(
		/usr/bin/find -P "${root}" \
			! -type d ! -type f ! -type l -print -quit
	)"
	[[ -z "${unexpected}" ]] || {
		deploy_error "promoted artifact contains a special filesystem object"
		return 1
	}

	unexpected="$(
		/usr/bin/find -P "${root}" -type f -links +1 -print -quit
	)"
	[[ -z "${unexpected}" ]] || {
		deploy_error "promoted artifact contains a hard-linked regular file"
		return 1
	}

	while IFS= read -r link; do
		[[ -n "${link}" ]] || continue
		if [[ "${link}" == "${expected_static}" ]]; then
			[[ "$(/usr/bin/readlink "${link}")" == \
				"/var/lib/peptides/static" ]] || {
				deploy_error "runtime-state link has an unexpected target"
				return 1
			}
			continue
		fi
		resolved="$(/usr/bin/realpath -m -- "${link}")" || return 1
		case "${resolved}" in
			"${root}/"*)
				;;
			*)
				deploy_error "promoted artifact contains an escaping symlink"
				return 1
				;;
		esac
	done < <(/usr/bin/find -P "${root}" -type l -print)

	unexpected="$(
		/usr/bin/find -P "${root}" \
			\( -type d -o -type f \) -perm /022 -print -quit
	)"
	[[ -z "${unexpected}" ]] || {
		deploy_error "promoted artifact contains a writable file or directory"
		return 1
	}
	return 0
}

# Hash the exact generated/runtime artifact, independent of staging path,
# ownership IDs, and timestamps. Release metadata is deliberately outside this
# digest; source/public inputs and the catalog snapshot have their own
# validated markers.
deploy_hash_artifact_members() {
	if [[ "$#" -lt 2 ]]; then
		deploy_error "deploy_hash_artifact_members requires ROOT MEMBER..."
		return 2
	fi
	local root="$1" checksum digest
	shift

	checksum="$(
		LC_ALL=C /usr/bin/tar \
			--create \
			--file=- \
			--directory="${root}" \
			--sort=name \
			--format=gnu \
			--mtime='@0' \
			--owner=0 \
			--group=0 \
			--numeric-owner \
			"$@" \
			| /usr/bin/sha256sum
	)" || return 1
	digest="${checksum%% *}"
	[[ "${digest}" =~ ^[0-9a-f]{64}$ ]] || {
		deploy_error "release artifact digest is malformed"
		return 1
	}
	printf '%s\n' "${digest}"
}

deploy_hash_release_artifact() {
	if [[ "$#" -ne 1 ]]; then
		deploy_error "deploy_hash_release_artifact requires ROOT"
		return 2
	fi
	local root="$1"

	[[ -d "${root}/backend" && ! -L "${root}/backend" \
		&& -d "${root}/storefront" && ! -L "${root}/storefront" \
		&& -f "${root}/csp.caddy" && ! -L "${root}/csp.caddy" \
		&& -f "${root}/csp-report-only.caddy" \
		&& ! -L "${root}/csp-report-only.caddy" ]] || {
		deploy_error "release artifact is incomplete"
		return 1
	}

	deploy_hash_artifact_members "${root}" \
		backend storefront csp.caddy csp-report-only.caddy
}

# A first-install bootstrap release carries only the backend: the storefront is
# the static maintenance page and no CSP has been derived yet. It still needs a
# byte-level identity so an interrupted bootstrap cannot be resumed against a
# tree that changed while the run was stopped.
deploy_hash_bootstrap_artifact() {
	if [[ "$#" -ne 1 ]]; then
		deploy_error "deploy_hash_bootstrap_artifact requires ROOT"
		return 2
	fi
	local root="$1"

	[[ -d "${root}/backend" && ! -L "${root}/backend" ]] || {
		deploy_error "bootstrap artifact is incomplete"
		return 1
	}

	deploy_hash_artifact_members "${root}" backend
}

# Copy from a quiescent build-owned tree without following links or preserving
# hard links/devices, then validate the complete root-owned result.
deploy_promote_release_tree() {
	if [[ "$#" -ne 3 ]]; then
		deploy_error \
			"deploy_promote_release_tree requires SOURCE ROOT_STAGING COMMIT"
		return 2
	fi

	local source="$1" root_staging="$2" commit="$3"
	local static_link="${root_staging}/backend/apps/backend/.medusa/server/static"

	[[ -d "${source}" && ! -L "${source}" ]] || {
		deploy_error "build output root is not a real directory"
		return 1
	}
	[[ -d "${source}/backend" && ! -L "${source}/backend" ]] || {
		deploy_error "build output backend is not a real directory"
		return 1
	}
	[[ -d "${source}/storefront" && ! -L "${source}/storefront" ]] || {
		deploy_error "build output storefront is not a real directory"
		return 1
	}
	[[ -f "${source}/csp.caddy" && ! -L "${source}/csp.caddy" ]] || {
		deploy_error "build output CSP is not a regular file"
		return 1
	}
	[[ -f "${source}/csp-report-only.caddy" \
		&& ! -L "${source}/csp-report-only.caddy" ]] || {
		deploy_error "build output report-only CSP is not a regular file"
		return 1
	}
	[[ -d "${root_staging}" && ! -L "${root_staging}" ]] || {
		deploy_error "root promotion staging is not a real directory"
		return 1
	}

	deploy_validate_build_source_tree "${source}" || return 1
	deploy_validate_csp_import "${source}/csp.caddy" enforce || {
		deploy_error "build output enforced CSP failed its narrow grammar"
		return 1
	}
	deploy_validate_csp_import \
		"${source}/csp-report-only.caddy" report-only || {
		deploy_error "build output report-only CSP failed its narrow grammar"
		return 1
	}

	/usr/bin/install -d -o root -g root -m 0700 \
		"${root_staging}/backend" "${root_staging}/storefront"
	/usr/bin/rsync --archive --safe-links --no-devices --no-specials \
		--no-owner --no-group \
		"${source}/backend/" "${root_staging}/backend/"
	/usr/bin/rsync --archive --safe-links --no-devices --no-specials \
		--no-owner --no-group \
		"${source}/storefront/" "${root_staging}/storefront/"
	/usr/bin/install -o root -g root -m 0444 \
		"${source}/csp.caddy" "${root_staging}/csp.caddy"
	/usr/bin/install -o root -g root -m 0444 \
		"${source}/csp-report-only.caddy" \
		"${root_staging}/csp-report-only.caddy"

	[[ ! -e "${static_link}" && ! -L "${static_link}" ]] || {
		deploy_error "promoted backend unexpectedly contains a static path"
		return 1
	}
	/usr/bin/ln -s /var/lib/peptides/static "${static_link}"
	printf '%s\n' "${commit}" >"${root_staging}/.commit"
	/usr/bin/chown -R root:root "${root_staging}"
	/usr/bin/chmod -R u=rwX,go=rX "${root_staging}"
	/usr/bin/chmod -R a-w "${root_staging}"

	deploy_validate_promoted_tree "${root_staging}" "${static_link}"
}

deploy_promote_bootstrap_backend() {
	if [[ "$#" -ne 3 ]]; then
		deploy_error \
			"deploy_promote_bootstrap_backend requires SOURCE ROOT_STAGING COMMIT"
		return 2
	fi

	local source="$1" root_staging="$2" commit="$3"
	local static_link="${root_staging}/backend/apps/backend/.medusa/server/static"
	local bootstrap_digest

	[[ -d "${source}" && ! -L "${source}" ]] || return 1
	[[ -d "${source}/backend" && ! -L "${source}/backend" ]] || return 1
	[[ -d "${root_staging}" && ! -L "${root_staging}" ]] || return 1
	deploy_validate_build_source_tree "${source}" || return 1

	/usr/bin/install -d -o root -g root -m 0700 "${root_staging}/backend"
	/usr/bin/rsync --archive --safe-links --no-devices --no-specials \
		--no-owner --no-group \
		"${source}/backend/" "${root_staging}/backend/"
	[[ ! -e "${static_link}" && ! -L "${static_link}" ]] || {
		deploy_error "promoted bootstrap unexpectedly contains a static path"
		return 1
	}
	/usr/bin/ln -s /var/lib/peptides/static "${static_link}"
	printf '%s\n' "${commit}" >"${root_staging}/.complete"
	/usr/bin/chown -R root:root "${root_staging}"
	/usr/bin/chmod -R u=rwX,go=rX "${root_staging}"
	/usr/bin/chmod -R a-w "${root_staging}"
	/usr/bin/chmod 0444 "${root_staging}/.complete"

	# The digest covers recorded modes, so it must be taken after ownership
	# and modes are normalized — otherwise a resume recompute cannot match.
	bootstrap_digest="$(
		deploy_hash_bootstrap_artifact "${root_staging}"
	)" || return 1
	printf '%s\n' "${bootstrap_digest}" >"${root_staging}/.artifact-digest"
	/usr/bin/chown root:root "${root_staging}/.artifact-digest"
	/usr/bin/chmod 0444 "${root_staging}/.artifact-digest"

	deploy_validate_promoted_tree "${root_staging}" "${static_link}"
}
