#!/usr/bin/env bash

set -u

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
status=0

secret_files=(
	".claude/settings.local.json"
	"CREDENTIALS.local.md"
	"storefront/.env"
	"backend/apps/backend/.env"
)

file_mode() {
	local path="$1"

	if stat -f '%Lp' "$path" >/dev/null 2>&1; then
		stat -f '%Lp' "$path"
	else
		stat -c '%a' "$path"
	fi
}

for relative_path in "${secret_files[@]}"; do
	path="${repo_root}/${relative_path}"

	if [[ ! -e "$path" ]]; then
		printf '%s mode=absent PASS\n' "$relative_path"
		continue
	fi

	if [[ -L "$path" ]]; then
		printf '%s mode=symlink FAIL\n' "$relative_path"
		status=1
		continue
	fi

	mode="$(file_mode "$path" 2>/dev/null || true)"
	if [[ -z "$mode" ]]; then
		printf '%s mode=unknown FAIL\n' "$relative_path"
		status=1
		continue
	fi

	if [[ "$mode" == "600" ]]; then
		printf '%s mode=%s PASS\n' "$relative_path" "$mode"
	else
		printf '%s mode=%s FAIL\n' "$relative_path" "$mode"
		status=1
	fi
done

exit "$status"
