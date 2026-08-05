#!/usr/bin/env bash
# AgentHub runtime readiness wrapper.
#
# Kept for compatibility with older local workflows. It delegates to the
# maintained Python port (scripts/verify/verify-runtime-readiness.py) which
# remains proposal-only: no real CLI prompt, model/API call, production
# access, secret read, or package build.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

find_python() {
  if command -v python3 >/dev/null 2>&1; then
    echo "python3"
  elif command -v python >/dev/null 2>&1; then
    echo "python"
  else
    echo "Python not found; install python3 or run the gates directly" >&2
    return 1
  fi
}

PYTHON_BIN="$(find_python)"

"$PYTHON_BIN" ./scripts/verify/verify-runtime-readiness.py
