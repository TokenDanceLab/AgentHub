#!/usr/bin/env bash
# ───────────────────────────────────────────────
# AgentHub Docker Compose — 一键启动开发环境
# （兼容 launcher；实现见同名 .py）
# ───────────────────────────────────────────────
# 启动 PostgreSQL 18.6 + Redis 7，然后在前台运行 Hub Server（--full 改为构建并启动 Hub 容器后返回）。
#
# 用法:
#   ./scripts/dev/dev-up.sh          # 启动 postgres + redis，然后前台 go run hub-server
#   ./scripts/dev/dev-up.sh --full   # 启动全部服务（包含 hub-server Docker 镜像）并返回
# ───────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec python "$SCRIPT_DIR/dev-up.py" "$@"
