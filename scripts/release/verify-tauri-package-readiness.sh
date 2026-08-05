#!/usr/bin/env bash
# AgentHub Tauri package readiness verifier — bash wrapper.
#
# Kept for compatibility with older local workflows. It delegates to the
# maintained Python port (scripts/release/verify-tauri-package-readiness.py)
# and maps the bash option names onto the Python CLI.
#
# Usage:
#   ./scripts/release/verify-tauri-package-readiness.sh
#   ./scripts/release/verify-tauri-package-readiness.sh --require-built-artifacts --built-artifacts-root dist/
#   ./scripts/release/verify-tauri-package-readiness.sh --require-bundled-sidecar
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BUILT_ARTIFACTS_ROOT="${BUILT_ARTIFACTS_ROOT:-}"
REQUIRE_BUILT_ARTIFACTS=false
REQUIRE_BUNDLED_SIDECAR=false

# ── Parse args ───────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root) REPO_ROOT="$2"; shift 2 ;;
    --built-artifacts-root) BUILT_ARTIFACTS_ROOT="$2"; shift 2 ;;
    --require-built-artifacts) REQUIRE_BUILT_ARTIFACTS=true; shift ;;
    --require-bundled-sidecar) REQUIRE_BUNDLED_SIDECAR=true; shift ;;
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

ARGS=(-RepoRoot "$REPO_ROOT")
if [[ -n "$BUILT_ARTIFACTS_ROOT" ]]; then
  ARGS+=(-BuiltArtifactsRoot "$BUILT_ARTIFACTS_ROOT")
fi
if [[ "$REQUIRE_BUILT_ARTIFACTS" == "true" ]]; then
  ARGS+=(-RequireBuiltArtifacts)
fi
if [[ "$REQUIRE_BUNDLED_SIDECAR" == "true" ]]; then
  ARGS+=(-RequireBundledSidecar)
fi

exec "$PYTHON_BIN" "$REPO_ROOT/scripts/release/verify-tauri-package-readiness.py" "${ARGS[@]}"
