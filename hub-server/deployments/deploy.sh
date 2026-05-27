#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"
ENV_FILE="$SCRIPT_DIR/.env.production"
BACKUP_DIR="$SCRIPT_DIR/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
HUB_IMAGE="${AGENTHUB_HUB_IMAGE:-ghcr.io/tokendancelab/agenthub-hub:latest}"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Pre-flight checks
check_prereqs() {
    log "Running pre-flight checks..."
    command -v docker >/dev/null 2>&1 || err "Docker not installed"
    command -v docker compose >/dev/null 2>&1 || err "Docker Compose not installed"
    [ -f "$ENV_FILE" ] || err ".env.production not found at $ENV_FILE. Run: bash $PROJECT_DIR/scripts/generate-secrets.sh"
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    HUB_IMAGE="${AGENTHUB_HUB_IMAGE:-$HUB_IMAGE}"
    docker image inspect "$HUB_IMAGE" >/dev/null 2>&1 || err "Hub image $HUB_IMAGE not loaded. Build on a dev/CI machine, transfer it, then run: docker load -i <image.tar>"
    log "Pre-flight checks passed"
}

# Backup current state
backup_current() {
    if docker compose -f "$COMPOSE_FILE" ps --format '{{.Name}}' 2>/dev/null | grep -q agenthub; then
        log "Backing up current state..."
        mkdir -p "$BACKUP_DIR"
        docker compose -f "$COMPOSE_FILE" ps > "$BACKUP_DIR/ps_$TIMESTAMP.txt" 2>/dev/null || true
        log "Backup saved to $BACKUP_DIR/ps_$TIMESTAMP.txt"
    fi
}

# Deploy
deploy() {
    log "Deploying preloaded image $HUB_IMAGE..."
    cd "$PROJECT_DIR"

    # Start/update services
    AGENTHUB_HUB_IMAGE="$HUB_IMAGE" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-build --no-deps --remove-orphans hub-server

    log "Deploy completed"
}

# Health check
health_check() {
    log "Running health checks..."
    local max_retries=30
    local retry=0

    while [ $retry -lt $max_retries ]; do
        if curl -sf http://localhost:8090/health > /dev/null 2>&1; then
            local health_json=$(curl -s http://localhost:8090/health)
            log "Health check PASSED: $health_json"
            return 0
        fi
        retry=$((retry + 1))
        [ $retry -lt $max_retries ] && sleep 2
    done

    err "Health check FAILED after ${max_retries} retries"
}

# Verify public API
verify_public_api() {
    log "Verifying public API..."
    curl -sf http://localhost:8090/api/public/stats > /dev/null 2>&1 && \
        log "Public API OK" || \
        warn "Public API not responding (may need DB migration)"
}

# Cleanup old images
cleanup() {
    log "Cleaning up old Docker images..."
    docker image prune -f --filter "until=24h"
}

# Rollback
rollback() {
    log "Rolling back to previous version..."
    cd "$PROJECT_DIR"
    AGENTHUB_HUB_IMAGE="$HUB_IMAGE" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down
    AGENTHUB_HUB_IMAGE="$HUB_IMAGE" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-build --no-deps --remove-orphans hub-server
    health_check
}

# Main
case "${1:-deploy}" in
    deploy)
        check_prereqs
        backup_current
        deploy
        health_check
        verify_public_api
        cleanup
        log "Deployment complete! api.hub.vectorcontrol.tech is live."
        ;;
    rollback)
        rollback
        log "Rollback complete"
        ;;
    health)
        health_check
        ;;
    logs)
        docker compose -f "$COMPOSE_FILE" logs -f --tail=100
        ;;
    *)
        echo "Usage: $0 {deploy|rollback|health|logs}"
        exit 1
        ;;
esac
