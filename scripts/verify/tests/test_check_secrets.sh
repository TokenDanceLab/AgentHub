#!/usr/bin/env bash
# Self-tests for check-secrets.sh.
#
# The content rules now belong to gitleaks (and its default rule set), which
# ships its own test suite. What is pinned here is the part this repo owns:
#   * the sensitive-path rules gitleaks cannot express, and
#   * the wiring around gitleaks: a real-looking credential in a staged file
#     fails the guard, a file listed in .gitleaks.toml does not, and a missing
#     gitleaks binary fails closed instead of silently passing.
#
# Runs in the CI validate job next to the other security-gate self-tests.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/check-secrets.sh"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PASS=0
FAIL=0

check() {
  local name="$1" expect_fail="$2" actual="$3"
  if { [[ "$expect_fail" == "yes" ]] && [[ "$actual" -ne 0 ]]; } || \
     { [[ "$expect_fail" == "no" ]] && [[ "$actual" -eq 0 ]]; }; then
    echo "  PASS  $name (exit=$actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name (exit=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git -C "$WORK" init -q
git -C "$WORK" config user.email test@example.invalid
git -C "$WORK" config user.name test
cp "$REPO/.gitleaks.toml" "$WORK/.gitleaks.toml"
printf 'hello\n' >"$WORK/README.md"
git -C "$WORK" add -A
git -C "$WORK" commit -qm init

# Gitleaks-shaped credential assembled at runtime so this test file is not
# itself a finding.
cred='AKIA'"$(printf '%s' 'Q7XK2M9P4RTB6WZ')"

stage() { # stage <path> <content>
  mkdir -p "$(dirname "$WORK/$1")"
  printf '%s\n' "$2" >"$WORK/$1"
  git -C "$WORK" add "$1"
}

reset_index() {
  git -C "$WORK" reset -q
  git -C "$WORK" restore -q . 2>/dev/null || true
  git -C "$WORK" clean -qfd -e .gitleaks.toml 2>/dev/null || true
}

cd "$WORK" || exit 1
export GITLEAKS_BIN="${GITLEAKS_BIN:-$(command -v gitleaks || true)}"
if [[ -z "$GITLEAKS_BIN" ]]; then
  echo "  FAIL  gitleaks not found; install it or set GITLEAKS_BIN" >&2
  exit 1
fi

check "clean change passes" no "$(bash "$SCRIPT" --staged >/dev/null 2>&1; echo $?)"

stage ".env" "AGENTHUB_JWT_SECRET=changeme"
check ".env is rejected by path" yes "$(bash "$SCRIPT" --staged >/dev/null 2>&1; echo $?)"
reset_index

stage ".env.example" "AGENTHUB_JWT_SECRET=<placeholder>"
check ".env.example is allowed" no "$(bash "$SCRIPT" --staged >/dev/null 2>&1; echo $?)"
reset_index

stage "deploy/certs/server.pem" "not a real cert"
check "certificate material is rejected by path" yes "$(bash "$SCRIPT" --staged >/dev/null 2>&1; echo $?)"
reset_index

stage "src/settings.txt" "key = \"$cred\""
check "credential-shaped value is rejected by gitleaks" yes "$(bash "$SCRIPT" --staged >/dev/null 2>&1; echo $?)"
reset_index

# ADR-028: an allowlist entry covers one exact literal in one exact file, so an
# unregistered credential in an allowlisted fixture file is still reported.
stage "edge-server/internal/api/handlers_runs_test.go" "key = \"$cred\""
check "unregistered literal in an allowlisted file is rejected" yes "$(bash "$SCRIPT" --staged >/dev/null 2>&1; echo $?)"
reset_index

# The flip side: the repository's own registered fixtures scan clean.
check "repo fixture files pass" no \
  "$( (cd "$REPO" && "$GITLEAKS_BIN" dir edge-server --no-banner --redact \
        -c "$REPO/.gitleaks.toml") >/dev/null 2>&1; echo $?)"

check "missing gitleaks fails closed" yes \
  "$(GITLEAKS_BIN=/nonexistent/gitleaks bash "$SCRIPT" --staged >/dev/null 2>&1; echo $?)"

echo ""
echo "test_check_secrets: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
