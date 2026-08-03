#!/usr/bin/env bash
# Self-tests for verify-rust-advisories.sh (#1578) — fail-closed contract.
#
# Positive: the real desktop lockfile (glib disposition allowlisted with a
# future deadline) must exit 0.
# Negative: an unknown vulnerability, the glib unsound advisory when the
# allowlist is disabled, an expired review deadline, and a missing workspace
# must ALL exit non-zero. Requires cargo-audit + network to fetch the
# advisory DB (same prerequisites as the gate itself).
set -uo pipefail

VERIFIER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/verify-rust-advisories.sh"
FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fixtures/rust-advisories"
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

echo "=== rust advisories: real desktop lockfile (glib allowlisted) ==="
bash "$VERIFIER" >/dev/null 2>&1
check "real lockfile with disposition exits 0" no $?

echo "=== rust advisories: glib unsound caught when allowlist disabled ==="
RUST_ADVISORY_ALLOWLIST="" bash "$VERIFIER" >/dev/null 2>&1
check "glib (RUSTSEC-2024-0429) blocks when not allowlisted" yes $?

echo "=== rust advisories: injected vulnerability fixture (time 0.1.44) ==="
bash "$VERIFIER" --workspace "$FIXTURE_DIR/vuln-time" >/dev/null 2>&1
check "injected RUSTSEC-2020-0071 exits !=0" yes $?

echo "=== rust advisories: expired review deadline ==="
RUST_ADVISORY_ALLOWLIST="RUSTSEC-2024-0429:2000-01-01" bash "$VERIFIER" >/dev/null 2>&1
check "expired allowlist deadline exits !=0" yes $?

echo "=== rust advisories: missing workspace ==="
bash "$VERIFIER" --workspace "$FIXTURE_DIR/does-not-exist" >/dev/null 2>&1
check "missing Cargo.lock exits !=0" yes $?

echo "=== rust advisories: unknown argument ==="
bash "$VERIFIER" --bogus >/dev/null 2>&1
check "unknown argument exits !=0" yes $?

echo ""
echo "Passed: $PASS | Failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
