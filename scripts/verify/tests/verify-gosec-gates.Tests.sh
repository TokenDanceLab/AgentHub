#!/usr/bin/env bash
# Self-tests for verify-gosec-gates.sh (#1574) — fail-closed contract.
#
# Positive: a parseable, schema-valid, zero-issue gosec JSON stream exits 0.
# Negative: real findings, unparseable output, empty output, and missing
# schema fields must ALL exit non-zero. Run locally or in CI validate job.
set -uo pipefail

VERIFIER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/verify-gosec-gates.sh"
PASS=0
FAIL=0

check() {
  local name="$1" expect_fail="$2" actual="$3"
  if { [[ "$expect_fail" == "yes" ]] && [[ "$actual" -ne 0 ]]; } || \
     { [[ "$expect_fail" == "no" ]] && [[ "$actual" -eq 0 ]]; }; then
    echo "  PASS  $name (exit=$actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name (exit=$actual, expected $([[ "$expect_fail" == "yes" ]] && echo "!=0" || echo "0"))"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== gosec: clean JSON (real gosec -fmt=json shape) ==="
printf '%s\n' '{"GolangVersion":"go1.25","Issues":[],"Stats":{"files":1,"lines":10,"nosec":0,"found":0}}' \
  | bash "$VERIFIER" >/dev/null 2>&1
check "clean stream exits 0" no $?

echo "=== gosec: finding present (e.g. injected weak-random violation) ==="
printf '%s\n' '{"GolangVersion":"go1.25","Issues":[{"severity":"HIGH","confidence":"MEDIUM","rule_id":"G404","details":"Use of weak random number generator","file":"fixture.go","line":"5"}],"Stats":{"files":1,"lines":10,"nosec":0,"found":1}}' \
  | bash "$VERIFIER" >/dev/null 2>&1
check "issue present exits !=0" yes $?

echo "=== gosec: empty output ==="
printf '' | bash "$VERIFIER" >/dev/null 2>&1
check "empty output exits !=0" yes $?

echo "=== gosec: non-JSON output ==="
printf '%s\n' 'panic: gosec crashed' | bash "$VERIFIER" >/dev/null 2>&1
check "non-JSON exits !=0" yes $?

echo "=== gosec: missing Issues field ==="
printf '%s\n' '{"GolangVersion":"go1.25","Stats":{"found":0}}' | bash "$VERIFIER" >/dev/null 2>&1
check "missing schema field exits !=0" yes $?

echo "=== gosec: Issues is not an array ==="
printf '%s\n' '{"GolangVersion":"go1.25","Issues":"nope"}' | bash "$VERIFIER" >/dev/null 2>&1
check "Issues not array exits !=0" yes $?

echo ""
echo "Passed: $PASS | Failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
