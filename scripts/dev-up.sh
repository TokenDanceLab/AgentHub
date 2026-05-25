#!/usr/bin/env bash
# ───────────────────────────────────────────────
# AgentHub Docker Compose — 一键启动开发环境
# ───────────────────────────────────────────────
# 启动 PostgreSQL 16 + Redis 7，然后可选择运行 Hub Server。
#
# 用法:
#   ./scripts/dev-up.sh          # 启动 postgres + redis（自己 go run hub-server）
#   ./scripts/dev-up.sh --full   # 启动全部服务（包含 hub-server Docker 镜像）
# ───────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

banner()  { printf '\n%s=== %s ===%s\n' "$GREEN" "$1" "$NC"; }
info()    { printf '  %s[+]%s %s\n' "$GREEN" "$NC" "$1"; }
warn()    { printf '  %s[*]%s %s\n' "$YELLOW" "$NC" "$1"; }
err()     { printf '  %s[!]%s %s\n' "$RED" "$NC" "$1"; }

# ── Prerequisites ──────────────────────────────
if ! command -v docker &>/dev/null; then
    err 'Docker is not installed. Install from https://docs.docker.com/get-docker/'
    exit 1
fi

DOCKER_COMPOSE="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
    if command -v docker-compose &>/dev/null 2>&1; then
        DOCKER_COMPOSE="docker-compose"
    else
        err 'Docker Compose is not available.'
        exit 1
    fi
fi

cd "$REPO_ROOT"

# ── Env file ────────────────────────────────────
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        info 'Created .env from .env.example'
    fi
fi

FULL_MODE=false
if [ "${1:-}" = "--full" ]; then
    FULL_MODE=true
fi

banner 'AgentHub Dev Environment'

if [ "$FULL_MODE" = true ]; then
    info 'Building and starting all services (postgres + redis + hub-server)...'
    $DOCKER_COMPOSE up -d --build postgres redis hub-server
else
    info 'Starting infrastructure (postgres + redis)...'
    $DOCKER_COMPOSE up -d postgres redis
fi

# ── Wait for health checks ──────────────────────
echo ''
info 'Waiting for PostgreSQL...'
for _ in $(seq 1 30); do
    if $DOCKER_COMPOSE exec -T postgres pg_isready -U agenthub -d agenthub 2>/dev/null; then
        info 'PostgreSQL is ready.'
        break
    fi
    sleep 1
done

info 'Waiting for Redis...'
for _ in $(seq 1 30); do
    if $DOCKER_COMPOSE exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
        info 'Redis is ready.'
        break
    fi
    sleep 1
done

if [ "$FULL_MODE" = true ]; then
    info 'Waiting for Hub Server...'
    for _ in $(seq 1 30); do
        if curl -s --max-time 1 http://localhost:8080/health >/dev/null 2>&1; then
            info 'Hub Server is ready.'
            break
        fi
        sleep 2
    done
fi

# ── Status ──────────────────────────────────────
echo ''
echo '  Services:'
printf '    %-20s %s\n' 'PostgreSQL' 'localhost:5432'
printf '    %-20s %s\n' 'Redis' 'localhost:6379'
if [ "$FULL_MODE" = true ]; then
    printf '    %-20s %s\n' 'Hub API' 'http://localhost:8080'
    printf '    %-20s %s\n' 'Hub Admin' 'http://localhost:6060'
else
    echo ''
    info 'Infrastructure is ready. Start Hub Server:'
    echo '    cd hub-server && go run ./cmd/server-hub'
fi

echo ''
echo '  Quick commands:'
echo '    docker compose logs -f              # 查看所有日志'
printf '    %-37s %s\n' './scripts/dev-down.sh' '# 停止所有服务'
echo ''
