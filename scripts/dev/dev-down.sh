#!/usr/bin/env bash
# ───────────────────────────────────────────────
# AgentHub Docker Compose — 停止开发环境
# （Python 实现，原 ps1 已迁移；本文件是兼容 launcher）
# ───────────────────────────────────────────────
# 用法:
#   ./scripts/dev/dev-down.sh           # 停止服务，保留数据卷
#   ./scripts/dev/dev-down.sh --clean   # 停止服务，删除数据卷（干净重置）
# ───────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec python "$SCRIPT_DIR/dev-down.py" "$@"
