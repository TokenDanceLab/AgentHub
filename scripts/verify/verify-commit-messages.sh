#!/usr/bin/env bash
# Verify Conventional Commit subjects for every commit in an explicit range.
# Usage: verify-commit-messages.sh <base-ref> [head-ref]
set -euo pipefail

BASE_REF="${1:-}"
HEAD_REF="${2:-HEAD}"
TYPES="init|feat|fix|docs|refactor|chore|test|perf|ci|revert"
PATTERN="^(${TYPES})(\([a-z0-9._-]+\))?: .+"

fail() {
  printf '::error::commit message gate: %s\n' "$*" >&2
  exit 1
}

if [[ -z "$BASE_REF" ]]; then
  fail "base ref argument is required"
fi
if ! git rev-parse --verify "${BASE_REF}^{commit}" >/dev/null 2>&1; then
  fail "base ref is unavailable: ${BASE_REF}"
fi
if ! git rev-parse --verify "${HEAD_REF}^{commit}" >/dev/null 2>&1; then
  fail "head ref is unavailable: ${HEAD_REF}"
fi

records_file="$(mktemp)"
trap 'rm -f "$records_file"' EXIT
if ! git log --format='%H%x09%s' "${BASE_REF}..${HEAD_REF}" >"$records_file"; then
  fail "git log failed for range ${BASE_REF}..${HEAD_REF}"
fi

checked=0
failed=0
while IFS=$'\t' read -r sha subject; do
  [[ -z "$sha" ]] && continue
  checked=$((checked + 1))
  if [[ ! "$subject" =~ $PATTERN ]]; then
    printf '::error::%s does not follow Conventional Commits: %s\n' "${sha:0:7}" "$subject" >&2
    failed=1
  fi
done <"$records_file"

if [[ "$checked" -eq 0 ]]; then
  fail "range ${BASE_REF}..${HEAD_REF} contains no commits"
fi
if [[ "$failed" -ne 0 ]]; then
  fail "subjects must match type(scope): summary"
fi

printf 'commit message check ok (%d commits)\n' "$checked"
