#!/usr/bin/env bash
# AgentHub CI gate policy verifier — portable launcher (ps1 迁移后委托 py).
#
# The policy implementation is intentionally single-sourced in the Python
# verifier used by GitHub Actions. Keeping a second YAML parser in this file
# previously allowed the Bash copy to drift behind the live workflow.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_PATH="${1:-.github/workflows/checks.yml}"
SCRIPT_PATH="$SCRIPT_DIR/verify-ci-gates.py"

exec python3 "$SCRIPT_PATH" --WorkflowPath "$WORKFLOW_PATH"
