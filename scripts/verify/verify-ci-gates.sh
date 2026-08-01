#!/usr/bin/env bash
# AgentHub CI gate policy verifier — portable launcher.
#
# The policy implementation is intentionally single-sourced in the
# PowerShell verifier used by GitHub Actions. Keeping a second YAML parser in
# this file previously allowed the Bash copy to drift behind the live workflow.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_PATH="${1:-.github/workflows/checks.yml}"
SCRIPT_PATH="$SCRIPT_DIR/verify-ci-gates.ps1"

if command -v pwsh >/dev/null 2>&1; then
  POWERSHELL=pwsh
elif command -v pwsh.exe >/dev/null 2>&1; then
  POWERSHELL=pwsh.exe
elif command -v powershell.exe >/dev/null 2>&1; then
  POWERSHELL=powershell.exe
else
  printf 'verify-ci-gates.sh: PowerShell 7 or Windows PowerShell is required\n' >&2
  exit 127
fi

if [[ "$POWERSHELL" == *.exe ]]; then
  WORKFLOW_ABS="$(cd "$(dirname "$WORKFLOW_PATH")" && pwd)/$(basename "$WORKFLOW_PATH")"
  if command -v wslpath >/dev/null 2>&1; then
    SCRIPT_PATH="$(wslpath -w "$SCRIPT_PATH")"
    WORKFLOW_PATH="$(wslpath -w "$WORKFLOW_ABS")"
  elif command -v cygpath >/dev/null 2>&1; then
    SCRIPT_PATH="$(cygpath -w "$SCRIPT_PATH")"
    WORKFLOW_PATH="$(cygpath -w "$WORKFLOW_ABS")"
  fi
fi

exec "$POWERSHELL" -NoProfile -ExecutionPolicy Bypass \
  -File "$SCRIPT_PATH" \
  -WorkflowPath "$WORKFLOW_PATH"
