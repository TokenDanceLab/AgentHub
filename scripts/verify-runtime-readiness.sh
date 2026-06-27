#!/usr/bin/env bash
# AgentHub runtime readiness wrapper.
#
# Kept for compatibility with older local workflows. It delegates to maintained
# gates and remains proposal-only: no real CLI prompt, model/API call,
# production access, secret read, or package build.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

find_powershell() {
  if command -v pwsh >/dev/null 2>&1; then
    echo "pwsh"
  elif command -v pwsh.exe >/dev/null 2>&1; then
    echo "pwsh.exe"
  elif command -v powershell.exe >/dev/null 2>&1; then
    echo "powershell.exe"
  else
    echo "PowerShell host not found; install pwsh or run scripts/verify-runtime-readiness.ps1 directly" >&2
    return 1
  fi
}

POWERSHELL_BIN="$(find_powershell)"

run_gate() {
  local name="$1"
  shift
  printf '\n=== %s ===\n' "$name"
  "$@"
}

echo "AgentHub runtime readiness wrapper"
echo "Evidence level: proposal-only / structural"
echo "No real CLI prompt, model/API call, production access, secret read, or package build is executed."

run_gate "Doc SSOT" "$POWERSHELL_BIN" -NoProfile -ExecutionPolicy Bypass -File ./scripts/verify-doc-ssot.ps1
run_gate "Web Hub-only boundary" bash ./scripts/verify-web-hub-boundary.sh
run_gate "Edge CLI real-readiness proposal" "$POWERSHELL_BIN" -NoProfile -ExecutionPolicy Bypass -File ./scripts/verify-edge-cli-real-readiness.ps1 -Mode ProposalOnly

echo ""
echo "runtime readiness wrapper ok"
