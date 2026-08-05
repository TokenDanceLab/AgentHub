#!/usr/bin/env bash
# ───────────────────────────────────────────────
# AgentHub — 一键启动 Edge、Hub 与 Desktop 开发服务
# （Python 实现，原 ps1 已迁移；本文件是兼容 launcher）
# ───────────────────────────────────────────────
# 用法: ./scripts/dev/dev-start.sh
# ───────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec python "$SCRIPT_DIR/dev-start.py" "$@"
