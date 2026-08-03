#!/usr/bin/env bash
# Self-tests for verify-commit-messages.sh (#1576).
set -uo pipefail

VERIFIER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/verify-commit-messages.sh"
TMP_ROOT="$(mktemp -d)"
PASS=0
FAIL=0
trap 'rm -rf "$TMP_ROOT"' EXIT

check() {
  local name="$1" expected="$2" actual="$3"
  if { [[ "$expected" == "pass" ]] && [[ "$actual" -eq 0 ]]; } || \
     { [[ "$expected" == "fail" ]] && [[ "$actual" -ne 0 ]]; }; then
    printf '  PASS  %s (exit=%d)\n' "$name" "$actual"
    PASS=$((PASS + 1))
  else
    printf '  FAIL  %s (exit=%d, expected=%s)\n' "$name" "$actual" "$expected"
    FAIL=$((FAIL + 1))
  fi
}

cd "$TMP_ROOT" || exit 1
git init -q
git config user.name "AgentHub CI Fixture"
git config user.email "fixture@example.invalid"
git config commit.gpgsign false

echo base > fixture.txt
git -c core.hooksPath=/dev/null add fixture.txt
git -c core.hooksPath=/dev/null commit -q -m "init: fixture baseline"
BASE_SHA="$(git rev-parse HEAD)"

echo one >> fixture.txt
git -c core.hooksPath=/dev/null commit -qam "ci: preserve a valid multi word subject"
echo two >> fixture.txt
git -c core.hooksPath=/dev/null commit -qam "fix(commit-gate): validate another subject with spaces"
VALID_HEAD="$(git rev-parse HEAD)"

output="$(bash "$VERIFIER" "$BASE_SHA" "$VALID_HEAD" 2>&1)"
code=$?
check "valid multi-commit range" pass "$code"
if [[ "$output" == *"ok (2 commits)"* ]]; then
  check "records are not split on spaces" pass 0
else
  check "records are not split on spaces" pass 1
fi

echo bad >> fixture.txt
git -c core.hooksPath=/dev/null commit -qam "@ fixup! invalid subject"
INVALID_HEAD="$(git rev-parse HEAD)"
INVALID_SHORT="${INVALID_HEAD:0:7}"
output="$(bash "$VERIFIER" "$VALID_HEAD" "$INVALID_HEAD" 2>&1)"
code=$?
check "invalid subject fails" fail "$code"
if [[ "$output" == *"$INVALID_SHORT"* && "$output" == *"@ fixup! invalid subject"* ]]; then
  check "invalid output identifies SHA and subject" pass 0
else
  check "invalid output identifies SHA and subject" pass 1
fi

output="$(bash "$VERIFIER" refs/heads/does-not-exist "$VALID_HEAD" 2>&1)"
code=$?
check "missing base ref fails closed" fail "$code"
if [[ "$output" == *"base ref is unavailable"* ]]; then
  check "missing base reason is explicit" pass 0
else
  check "missing base reason is explicit" pass 1
fi

output="$(bash "$VERIFIER" "$BASE_SHA" refs/heads/does-not-exist 2>&1)"
code=$?
check "missing head ref fails closed" fail "$code"

output="$(bash "$VERIFIER" "$BASE_SHA" "$BASE_SHA" 2>&1)"
code=$?
check "empty range fails closed" fail "$code"

printf '\nCommit-message gate self-test: %d pass | %d fail\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
