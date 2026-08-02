#!/bin/bash
# ──────────────────────────────────────────────
# AgentHub Hub Server — hk2 Deployment Script
# ──────────────────────────────────────────────
# Deploys AgentHub Hub Server to hk2 (核云 VPS, Hong Kong).
#
# Usage:
#   ./deploy-hk2.sh deploy     — Full deploy (check → backup → deploy → verify)
#   ./deploy-hk2.sh rollback   — Rollback to previous image
#   ./deploy-hk2.sh health     — Check health endpoint
#   ./deploy-hk2.sh logs       — Tail Hub Server logs
#   ./deploy-hk2.sh status     — Show container status
#
# Prerequisites:
#   - Docker image pre-built and loaded on hk2
#     (build on dev/CI, transfer via scp, docker load -i <image.tar>)
#   - .env.hk2 configured with production secrets
#   - nginx configured with nginx-hk2.conf
#
# Architecture:
#   Local dev machine → scp image.tar → hk2:docker load → docker compose up
#   SSH via hk1 jumpbox (or direct if configured in ~/.ssh/config)
#
# SSH config example (~/.ssh/config):
#   Host hk2
#     HostName <hk2-ip>
#     User <SSH_USER>
#     IdentityFile ~/.ssh/id_ed25519
#     ProxyJump hk1    # if hopping through hk1
# ──────────────────────────────────────────────
set -euo pipefail

# ── Configuration ─────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.hk2.yml"
ENV_FILE="$SCRIPT_DIR/.env.hk2"
BACKUP_DIR="/opt/agenthub-backups"
DEPLOY_BASE="/opt/agenthub-hub/hub-server/deployments/hk2"
TIMESTAMP=$(date +%Y%m%dT%H%M%S%Z)

# Remote target
REMOTE_HOST="${HK2_REMOTE:-hk2}"
REMOTE_USER="${HK2_USER:-}"

# Hub image
HUB_IMAGE="${AGENTHUB_HUB_IMAGE:-}"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Compose command selection ─────────────────
COMPOSE_CMD=()

select_compose_cmd() {
    command -v docker >/dev/null 2>&1 || err "Docker not installed"
    if docker compose version >/dev/null 2>&1; then
        COMPOSE_CMD=(docker compose)
        return
    fi
    if command -v docker-compose >/dev/null 2>&1; then
        COMPOSE_CMD=(docker-compose)
        return
    fi
    err "Docker Compose not found. Install docker compose plugin or docker-compose."
}

compose() {
    if [ ${#COMPOSE_CMD[@]} -eq 0 ]; then
        select_compose_cmd
    fi
    if [ -n "${AGENTHUB_HUB_IMAGE:-}" ]; then
        export AGENTHUB_HUB_IMAGE
    fi
    "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" "$@"
}

# ── Remote SSH helper ─────────────────────────
remote_exec() {
    ssh "${REMOTE_HOST}" "$@"
}

# ── Pre-flight Checks ─────────────────────────
check_prereqs() {
    log "Running pre-flight checks..."

    # Check compose
    select_compose_cmd
    log "Compose: ${COMPOSE_CMD[*]}"

    # Check env file
    if [ ! -f "$ENV_FILE" ]; then
        err ".env.hk2 not found at $ENV_FILE. Copy from .env.hk2.example and fill in secrets."
    fi
    log "Env file: $ENV_FILE"

    # Source env for validation
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a

    # Validate required variables
    local missing=()
    for var in AGENTHUB_DB_PASSWORD AGENTHUB_REDIS_PASSWORD AGENTHUB_JWT_SECRET AGENTHUB_PPROF_PASS; do
        if [ -z "${!var:-}" ]; then
            missing+=("$var")
        fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
        err "Missing required env vars: ${missing[*]}"
    fi
    log "Required env vars: OK"

    # Check hub image is loaded
    if [ -n "${AGENTHUB_HUB_IMAGE:-}" ]; then
        HUB_IMAGE="$AGENTHUB_HUB_IMAGE"
    fi
    if [ -n "$HUB_IMAGE" ]; then
        docker image inspect "$HUB_IMAGE" >/dev/null 2>&1 || err "Hub image $HUB_IMAGE not loaded. Build on dev machine and run: docker load -i <image.tar>"
        log "Hub image: $HUB_IMAGE"
    else
        warn "AGENTHUB_HUB_IMAGE not set. Using default from compose file."
    fi

    # Check ports not in use by other processes
    local port_check
    for port in 8090 6060; do
        port_check=$(ss -tlnp 2>/dev/null | grep ":${port}" || true)
        if [ -n "$port_check" ]; then
            warn "Port $port is already in use: $port_check"
        fi
    done

    # Check Docker network exists
    if ! docker network inspect agenthub-net >/dev/null 2>&1; then
        warn "Docker network agenthub-net does not exist yet. It will be created by compose."
    else
        log "Docker network agenthub-net: exists"
    fi

    # Check disk space (hk2 constraint: root disk ~29G, >=80% = P1)
    local disk_usage
    disk_usage=$(df -h / | awk 'NR==2{print $5}' | tr -d '%')
    if [ "$disk_usage" -ge 80 ]; then
        err "Root disk usage ${disk_usage}% >= 80%. hk2 P1 capacity governance required before deploy."
    elif [ "$disk_usage" -ge 70 ]; then
        warn "Root disk usage ${disk_usage}%. Monitor closely."
    fi
    log "Disk usage: ${disk_usage}%"

    log "Pre-flight checks PASSED"
}

# ── Backup ────────────────────────────────────
backup_current() {
    if compose ps --format '{{.Name}}' 2>/dev/null | grep -q agenthub; then
        log "Backing up current state..."
        mkdir -p "$BACKUP_DIR"

        # Record running state
        compose ps > "$BACKUP_DIR/ps_${TIMESTAMP}.txt" 2>/dev/null || true

        # Backup PostgreSQL
        if docker ps --format '{{.Names}}' | grep -q agenthub-postgres; then
            local db_backup="$BACKUP_DIR/agenthub-db-${TIMESTAMP}.dump"
            docker exec agenthub-postgres pg_dump -U agenthub -Fc agenthub > "$db_backup"
            local db_size
            db_size=$(du -h "$db_backup" | cut -f1)
            log "PostgreSQL backup: $db_backup ($db_size)"
        fi

        # Trigger Redis BGSAVE
        if docker ps --format '{{.Names}}' | grep -q agenthub-redis; then
            docker exec agenthub-redis redis-cli -a "${AGENTHUB_REDIS_PASSWORD}" BGSAVE 2>/dev/null || true
            log "Redis BGSAVE triggered"
        fi

        # Tag current image for rollback
        local current_image
        current_image=$(docker inspect --format='{{.Config.Image}}' agenthub-hub 2>/dev/null || echo "unknown")
        if [ "$current_image" != "unknown" ]; then
            docker tag "$current_image" "agenthub-hub:rollback-${TIMESTAMP}" 2>/dev/null || true
            log "Rollback image tagged: agenthub-hub:rollback-${TIMESTAMP}"
        fi
    else
        log "No running AgentHub containers found. Skipping backup."
    fi
}

# ── Deploy ────────────────────────────────────
deploy() {
    log "Deploying AgentHub Hub Server to hk2..."

    # Start/update services
    if [ -n "${HUB_IMAGE:-}" ]; then
        export AGENTHUB_HUB_IMAGE="$HUB_IMAGE"
    fi
    compose --env-file "$ENV_FILE" up -d --no-build --no-deps --force-recreate --remove-orphans hub-server

    log "Hub Server container recreated"
}

# ── Full stack deploy (infra + hub) ───────────
deploy_full() {
    log "Deploying full AgentHub stack..."

    if [ -n "${HUB_IMAGE:-}" ]; then
        export AGENTHUB_HUB_IMAGE="$HUB_IMAGE"
    fi
    compose --env-file "$ENV_FILE" up -d --no-build --force-recreate --remove-orphans

    log "Full stack deployed"
}

# ── Health Check ──────────────────────────────
health_check() {
    log "Running health checks..."
    local health_url="http://localhost:8090/health"
    local max_retries=30
    local retry=0
    local response http_code health_json

    while [ $retry -lt $max_retries ]; do
        response=$(curl -sS -w '\n%{http_code}' "$health_url" 2>/dev/null || true)
        http_code=$(printf '%s' "$response" | tail -n 1)
        health_json=$(printf '%s' "$response" | sed '$d')

        if [ "$http_code" = "200" ] && \
            printf '%s' "$health_json" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
            log "Health check PASSED: $health_json"
            return 0
        fi

        [ -n "$health_json" ] && warn "Not ready (HTTP ${http_code:-N/A}): $health_json"
        retry=$((retry + 1))
        [ $retry -lt $max_retries ] && sleep 2
    done

    err "Health check FAILED after ${max_retries} retries"
}

# ── Post-deploy Verification ──────────────────
verify_deployment() {
    log "Running post-deployment verification..."

    # Container check
    log "Container status:"
    compose ps

    # Public health (via nginx)
    local public_health
    public_health=$(curl -sf https://hub.vectorcontrol.tech/health 2>/dev/null || echo "FAILED")
    log "Public health: $public_health"

    # Verify containers are healthy
    local unhealthy
    unhealthy=$(compose ps --format '{{.Name}} {{.Health}}' 2>/dev/null | grep -v "healthy" | grep -v "^$" || true)
    if [ -n "$unhealthy" ]; then
        warn "Unhealthy containers: $unhealthy"
    fi

    log "Post-deployment verification complete"
}

# ── Rollback ──────────────────────────────────
# Rollback requires:
#   1. Identify the rollback image tag (from backup step)
#   2. Set AGENTHUB_HUB_IMAGE to the rollback tag
#   3. Run: ./deploy-hk2.sh rollback
rollback() {
    log "Starting rollback..."

    # Find most recent rollback tag
    local rollback_image
    rollback_image=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep "agenthub-hub-server:rollback-" | sort -r | head -1 || true)

    if [ -z "$rollback_image" ]; then
        err "No rollback image found. Manual rollback required: load previous image and tag as ghcr.io/tokendancelab/agenthub-hub-server:rollback"
    fi

    log "Rolling back to: $rollback_image"
    AGENTHUB_HUB_IMAGE="$rollback_image"
    export AGENTHUB_HUB_IMAGE

    compose --env-file "$ENV_FILE" up -d --no-build --no-deps --force-recreate --remove-orphans hub-server
    health_check
    log "Rollback complete"
}

# ── Cleanup old images ────────────────────────
cleanup() {
    log "Cleaning up old Docker images (keeping rollback tags)..."
    # Only prune dangling images; never prune -af
    docker image prune -f --filter "until=48h" 2>/dev/null || true
    log "Cleanup done"
}

# ── Show Status ───────────────────────────────
show_status() {
    log "AgentHub hk2 Status:"
    echo ""
    compose ps 2>/dev/null || echo "  No containers running"
    echo ""
    log "Health endpoint:"
    curl -sf http://localhost:8090/health 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  Unreachable"
    echo ""
    log "Public endpoint:"
    curl -sf https://hub.vectorcontrol.tech/health 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  Unreachable"
}

# ── Remote deploy (from local dev machine) ────
remote_deploy() {
    local image_tar="${1:-}"
    if [ -z "$image_tar" ]; then
        err "Usage: $0 remote-deploy <image.tar>"
    fi
    if [ ! -f "$image_tar" ]; then
        err "Image tar not found: $image_tar"
    fi

    log "Deploying AgentHub to hk2 via SSH..."

    # 1. Transfer image
    log "Transferring image to ${REMOTE_HOST}..."
    scp "$image_tar" "${REMOTE_HOST}:/tmp/agenthub-hub-image.tar"

    # 2. Load image on remote
    log "Loading image on remote..."
    remote_exec "docker load -i /tmp/agenthub-hub-image.tar && rm /tmp/agenthub-hub-image.tar"

    # 3. Deploy on remote
    log "Running remote deploy..."
    remote_exec "cd ${DEPLOY_BASE} && bash deploy-hk2.sh deploy"

    # 4. Verify
    log "Verifying remote health..."
    remote_exec "curl -sf http://localhost:8090/health"

    log "Remote deployment complete!"
}

# ── Main ──────────────────────────────────────
case "${1:-deploy}" in
    deploy)
        check_prereqs
        backup_current
        deploy
        health_check
        verify_deployment
        cleanup
        log "Deployment complete! https://hub.vectorcontrol.tech is live."
        ;;
    deploy-full)
        check_prereqs
        backup_current
        deploy_full
        health_check
        verify_deployment
        cleanup
        log "Full stack deployment complete!"
        ;;
    rollback)
        check_prereqs
        rollback
        ;;
    health)
        health_check
        ;;
    logs)
        compose logs -f --tail=100 hub-server
        ;;
    status)
        show_status
        ;;
    backup)
        check_prereqs
        backup_current
        log "Backup complete"
        ;;
    remote-deploy)
        remote_deploy "${2:-}"
        ;;
    *)
        echo "Usage: $0 {deploy|deploy-full|rollback|health|logs|status|backup|remote-deploy <image.tar>}"
        echo ""
        echo "Commands:"
        echo "  deploy           Deploy Hub Server (pre-flight → backup → deploy → verify)"
        echo "  deploy-full      Deploy full stack (PG + Redis + Hub)"
        echo "  rollback         Rollback to previous image"
        echo "  health           Check health endpoint"
        echo "  logs             Tail Hub Server logs"
        echo "  status           Show container status and health"
        echo "  backup           Backup current state only"
        echo "  remote-deploy    Deploy from local machine via SSH"
        exit 1
        ;;
esac
