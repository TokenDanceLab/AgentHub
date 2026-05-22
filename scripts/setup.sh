#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git config core.hooksPath scripts/git-hooks
echo "Git hooks enabled: scripts/git-hooks"

if [[ "${1:-}" == "--reference-core" ]]; then
  if ! command -v pwsh >/dev/null 2>&1; then
    echo "PowerShell is required for reference sync. Install pwsh or run scripts/sync-reference.ps1 on Windows."
    exit 1
  fi
  pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/sync-reference.ps1 -Tier core
elif [[ "${1:-}" == "--reference-all" ]]; then
  if ! command -v pwsh >/dev/null 2>&1; then
    echo "PowerShell is required for reference sync. Install pwsh or run scripts/sync-reference.ps1 on Windows."
    exit 1
  fi
  pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/sync-reference.ps1 -Tier all
fi

echo "Setup complete."
