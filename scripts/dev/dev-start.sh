#!/usr/bin/env bash
# ───────────────────────────────────────────────
# AgentHub — 一键启动 Edge、Hub 与 Desktop 开发服务
# （兼容 launcher；实现见同名 .py）
# ───────────────────────────────────────────────
# 用法: ./scripts/dev/dev-start.sh
# ───────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec python "$SCRIPT_DIR/dev-start.py" "$@"
