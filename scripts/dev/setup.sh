#!/usr/bin/env bash
# ───────────────────────────────────────────────
# AgentHub 本地环境配置（Python 实现，原 ps1 已迁移；本文件是兼容 launcher）
# 用法:
#   ./scripts/dev/setup.sh                    # 仅启用 git hooks
#   ./scripts/dev/setup.sh --reference-core   # 同步 core reference 仓库
#   ./scripts/dev/setup.sh --reference-all    # 同步全部 reference 仓库
# ───────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec python "$SCRIPT_DIR/setup.py" "$@"
