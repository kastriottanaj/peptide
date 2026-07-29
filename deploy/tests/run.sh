#!/usr/bin/env bash

set -euo pipefail

TEST_DIR="$(builtin cd "${BASH_SOURCE[0]%/*}" && builtin pwd -P)"
test_file=''
test_count=0

for test_file in "${TEST_DIR}"/*.test.sh; do
	printf 'running %s\n' "${test_file##*/}"
	bash "${test_file}"
	test_count=$((test_count + 1))
done

for test_file in "${TEST_DIR}"/*.test.mjs; do
	[[ -e "${test_file}" ]] || continue
	printf 'running %s\n' "${test_file##*/}"
	node --test "${test_file}"
	test_count=$((test_count + 1))
done

if [[ "${test_count}" -eq 0 ]]; then
	printf 'no deployment tests found\n' >&2
	exit 1
fi

printf 'ok - %s deployment test file(s)\n' "${test_count}"
