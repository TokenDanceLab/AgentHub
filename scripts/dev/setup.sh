#!/usr/bin/env bash
# ───────────────────────────────────────────────
# AgentHub 本地环境配置（兼容 launcher；实现见同名 .py）
# 用法:
#   ./scripts/dev/setup.sh                    # 启用 git hooks
# ───────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec python "$SCRIPT_DIR/setup.py" "$@"
