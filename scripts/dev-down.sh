#!/usr/bin/env bash
# ───────────────────────────────────────────────
# AgentHub Docker Compose — 停止开发环境
# ───────────────────────────────────────────────
# 用法:
#   ./scripts/dev-down.sh           # 停止服务，保留数据卷
#   ./scripts/dev-down.sh --clean   # 停止服务，删除数据卷（干净重置）
# ───────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { printf '  %s[+]%s %s\n' "$GREEN" "$NC" "$1"; }
warn() { printf '  %s[*]%s %s\n' "$YELLOW" "$NC" "$1"; }

DOCKER_COMPOSE="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
fi

cd "$REPO_ROOT"

CLEAN=false
if [ "${1:-}" = "--clean" ] || [ "${1:-}" = "-c" ]; then
    CLEAN=true
fi

if [ "$CLEAN" = true ]; then
    warn 'Stopping all services and removing volumes (clean reset)...'
    $DOCKER_COMPOSE down -v --remove-orphans
    info 'Volumes removed: agenthub_pg_data, agenthub_redis_data, agenthub_uploads'
else
    info 'Stopping all services...'
    $DOCKER_COMPOSE down --remove-orphans
    info 'Data volumes preserved. Use --clean to remove them.'
fi

info 'Done.'
