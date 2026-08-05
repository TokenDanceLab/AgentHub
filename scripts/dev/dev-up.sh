#!/usr/bin/env bash
# ───────────────────────────────────────────────
# AgentHub Docker Compose — 一键启动开发环境
# （Python 实现，原 ps1 已迁移；本文件是兼容 launcher）
# ───────────────────────────────────────────────
# 启动 PostgreSQL 16 + Redis 7，然后可选择运行 Hub Server。
#
# 用法:
#   ./scripts/dev/dev-up.sh          # 启动 postgres + redis（自己 go run hub-server）
#   ./scripts/dev/dev-up.sh --full   # 启动全部服务（包含 hub-server Docker 镜像）
# ───────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec python "$SCRIPT_DIR/dev-up.py" "$@"
