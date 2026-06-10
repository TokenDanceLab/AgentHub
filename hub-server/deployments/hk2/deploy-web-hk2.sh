#!/bin/bash
# ──────────────────────────────────────────────
# AgentHub Web App — hk2 Deployment Script
# ──────────────────────────────────────────────
# Deploys the AgentHub Web App (SPA) static files to hk2.
#
# Usage:
#   ./deploy-web-hk2.sh           — Full deploy (rsync → nginx reload → verify)
#   ./deploy-web-hk2.sh verify    — Verify public URL only
#
# Prerequisites:
#   - Web app built with production VITE_HUB_URL
#   - SSH access to hk2 (via hk1 jumpbox or direct)
#
# Architecture:
#   Web App dist → rsync → hk2:/opt/vectorcontrol-hk2-stack/agenthub-web/dist/
#   nginx serves static files + proxies Hub API
# ──────────────────────────────────────────────
set -euo pipefail

# ── Configuration ─────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WEB_DIST="$REPO_ROOT/app/web/dist"
NGINX_CONF="$SCRIPT_DIR/nginx-hk2-v2.conf"

REMOTE_HOST="${HK2_REMOTE:-hk2}"
REMOTE_WEB_DIR="/opt/vectorcontrol-hk2-stack/agenthub-web/dist"
REMOTE_NGINX_CONF="/etc/nginx/sites-available/agenthub"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Pre-flight ────────────────────────────────
preflight() {
    log "Running pre-flight checks..."

    # Check dist exists
    if [ ! -f "$WEB_DIST/index.html" ]; then
        err "Web app dist not found at $WEB_DIST. Run: cd app/web && VITE_HUB_URL=https://hub.vectorcontrol.tech VITE_HUB_WS_URL=wss://hub.vectorcontrol.tech/client/ws npx vite build"
    fi
    log "Dist: $WEB_DIST (index.html found)"

    # Check production URL is baked in
    if ! grep -q "hub.vectorcontrol.tech" "$WEB_DIST/assets/"*.js 2>/dev/null; then
        err "Production URL not found in dist. Rebuild with VITE_HUB_URL=https://hub.vectorcontrol.tech"
    fi
    log "Production URL: baked in"

    # Check nginx config exists
    if [ ! -f "$NGINX_CONF" ]; then
        err "nginx config not found at $NGINX_CONF"
    fi
    log "nginx config: $NGINX_CONF"

    log "Pre-flight PASSED"
}

# ── Deploy ────────────────────────────────────
deploy() {
    log "Deploying AgentHub Web App to hk2..."

    # 1. Create remote directory
    log "Creating remote directory..."
    ssh "$REMOTE_HOST" "mkdir -p $REMOTE_WEB_DIR"

    # 2. Rsync dist files (delete old, preserve permissions)
    log "Syncing dist files..."
    rsync -avz --delete \
        "$WEB_DIST/" \
        "${REMOTE_HOST}:${REMOTE_WEB_DIR}/"

    log "Files synced"

    # 3. Update nginx config (if changed)
    log "Updating nginx config..."
    scp "$NGINX_CONF" "${REMOTE_HOST}:/tmp/agenthub-nginx.conf"
    ssh "$REMOTE_HOST" bash -s <<'REMOTE_SCRIPT'
set -e
# Backup current config
if [ -f /etc/nginx/sites-available/agenthub ]; then
    cp /etc/nginx/sites-available/agenthub /etc/nginx/sites-available/agenthub.bak.$(date +%Y%m%d%H%M%S)
fi
# Install new config
cp /tmp/agenthub-nginx.conf /etc/nginx/sites-available/agenthub
# Test nginx config
nginx -t
# Reload
systemctl reload nginx
rm /tmp/agenthub-nginx.conf
echo "nginx reloaded successfully"
REMOTE_SCRIPT

    log "nginx updated and reloaded"
}

# ── Verify ────────────────────────────────────
verify() {
    log "Verifying deployment..."

    # Check public URL
    local http_code
    http_code=$(curl -sf -o /dev/null -w '%{http_code}' https://hub.vectorcontrol.tech/ 2>/dev/null || echo "000")

    if [ "$http_code" = "200" ]; then
        log "Public URL: OK (HTTP $http_code)"
    else
        warn "Public URL: HTTP $http_code"
    fi

    # Check health
    local health
    health=$(curl -sf https://hub.vectorcontrol.tech/health 2>/dev/null || echo "FAILED")
    log "Health: $health"

    # Check SPA loads (index.html contains React app)
    local has_react
    has_react=$(curl -sf https://hub.vectorcontrol.tech/ 2>/dev/null | grep -c "script" || echo "0")
    if [ "$has_react" -gt 0 ]; then
        log "SPA: loads (has script tags)"
    else
        warn "SPA: may not be loading correctly"
    fi

    log "Verification complete"
}

# ── Main ──────────────────────────────────────
case "${1:-deploy}" in
    deploy)
        preflight
        deploy
        verify
        log "Web App deployment complete! https://hub.vectorcontrol.tech is live."
        ;;
    verify)
        verify
        ;;
    *)
        echo "Usage: $0 {deploy|verify}"
        exit 1
        ;;
esac
