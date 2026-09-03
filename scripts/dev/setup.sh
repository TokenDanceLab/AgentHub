#!/usr/bin/env bash
# ───────────────────────────────────────────────
# AgentHub 本地环境配置（Python 实现，原 ps1 已迁移；本文件是兼容 launcher）
# 用法:
#   ./scripts/dev/setup.sh                    # 启用 git hooks
# ───────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec python "$SCRIPT_DIR/setup.py" "$@"
