#!/usr/bin/env bash
# AgentHub release gate verifier — bash wrapper.
#
# Kept for compatibility with older local workflows. It delegates to the
# maintained Python port (scripts/release/verify-release-gate.py) and maps
# the bash option names onto the Python CLI.
#
# Usage:
#   ./scripts/release/verify-release-gate.sh [--allow-open-high-risks] [--skip-ref-check]
#   ./scripts/release/verify-release-gate.sh --base-ref origin/master --dev-ref origin/dev/delicious233
#   ./scripts/release/verify-release-gate.sh --artifacts-root dist/unsigned-dry --report-path .tmp/release-gate-report.json
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BASE_REF="${BASE_REF:-origin/master}"
DEV_REF="${DEV_REF:-origin/dev/delicious233}"
ARTIFACTS_ROOT="${ARTIFACTS_ROOT:-}"
REPORT_PATH="${REPORT_PATH:-.tmp/release-gate-report.json}"
ALLOW_OPEN_HIGH_RISKS=false
SKIP_REF_CHECK=false

# ── Parse args ───────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow-open-high-risks) ALLOW_OPEN_HIGH_RISKS=true; shift ;;
    --skip-ref-check) SKIP_REF_CHECK=true; shift ;;
    --base-ref) BASE_REF="$2"; shift 2 ;;
    --dev-ref) DEV_REF="$2"; shift 2 ;;
    --artifacts-root) ARTIFACTS_ROOT="$2"; shift 2 ;;
    --report-path) REPORT_PATH="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done

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

ARGS=(-RepoRoot "$REPO_ROOT" -BaseRef "$BASE_REF" -DevRef "$DEV_REF")
if [[ -n "$ARTIFACTS_ROOT" ]]; then
  ARGS+=(-ArtifactsRoot "$ARTIFACTS_ROOT")
fi
ARGS+=(-ReportPath "$REPORT_PATH")
if [[ "$ALLOW_OPEN_HIGH_RISKS" == "true" ]]; then
  ARGS+=(-AllowOpenHighRisks)
fi
if [[ "$SKIP_REF_CHECK" == "true" ]]; then
  ARGS+=(-SkipRefCheck)
fi

exec "$PYTHON_BIN" "$REPO_ROOT/scripts/release/verify-release-gate.py" "${ARGS[@]}"
