#!/usr/bin/env bash
# One-click dev start for AgentHub — starts Edge, Hub, and Desktop.
#
# Starts edge-server (go run), hub-server (go run), and Desktop dev server (pnpm dev).
# Each service runs in the background; press Ctrl+C to stop all.
# URLs: Edge=http://127.0.0.1:3210, Hub=http://127.0.0.1:4210, Desktop=http://localhost:5199
#
# Usage: ./scripts/dev-start.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Track background PIDs for cleanup
PIDS=()

banner() {
    printf '\n=== %s ===\n' "$1"
}

starting() {
    printf '  [%s] Starting...\n' "$1"
}

ready() {
    printf '  [%s] Ready on port %s\n' "$1" "$2"
}

timeout_msg() {
    printf '  [%s] TIMEOUT \342\200\224 port %s did not become available in %ss\n' "$1" "$2" "$3"
}

cleanup() {
    printf '\nShutting down...\n'
    # Try graceful kill first
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            printf '  Stopping PID %s...\n' "$pid"
            kill "$pid" 2>/dev/null || true
        fi
    done
    # Give them a moment to exit, then force-kill stragglers
    sleep 1
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
    done
    wait "${PIDS[@]}" 2>/dev/null || true
    printf 'All services stopped.\n'
}

trap cleanup EXIT INT TERM

# --- Health check helper ---
wait_for_port() {
    local name="$1"
    local port="$2"
    local host="${3:-127.0.0.1}"
    local timeout="${4:-30}"
    local elapsed=0

    while [ "$elapsed" -lt "$timeout" ]; do
        if curl -s --max-time 1 "$host:$port" >/dev/null 2>&1; then
            ready "$name" "$port"
            return 0
        fi
        sleep 0.5
        elapsed=$((elapsed + 1))
    done
    timeout_msg "$name" "$port" "$timeout"
    return 1
}

# --- Check prerequisites ---
MISSING=()
command -v go    >/dev/null 2>&1 || MISSING+=('go')
command -v node  >/dev/null 2>&1 || MISSING+=('node')
command -v pnpm  >/dev/null 2>&1 || MISSING+=('pnpm')
if [ ${#MISSING[@]} -gt 0 ]; then
    printf 'ERROR: Missing required tools: %s\n' "${MISSING[*]}"
    printf 'Developers should have Go and Node installed. See https://go.dev/dl/ and https://nodejs.org/\n'
    exit 1
fi

# --- Install desktop dependencies if needed ---
if [ ! -d "$REPO_ROOT/app/desktop/node_modules" ]; then
    printf '  [Desktop] Installing dependencies (pnpm install)...\n'
    (cd "$REPO_ROOT/app/desktop" && pnpm install --frozen-lockfile)
fi

banner 'AgentHub Dev Start'
printf 'Repo: %s\n' "$REPO_ROOT"

# Start all services
starting 'edge-server'
(cd "$REPO_ROOT/edge-server" && go run ./cmd/agenthub-edge --addr 127.0.0.1:3210) &
PIDS+=($!)

starting 'hub-server'
(cd "$REPO_ROOT/hub-server" && go run ./cmd/agenthub-hub --addr 127.0.0.1:4210) &
PIDS+=($!)

starting 'desktop'
(cd "$REPO_ROOT/app/desktop" && pnpm dev --port 5199) &
PIDS+=($!)

# Wait for health checks
printf '\nWaiting for services to be ready...\n\n'
ALL_READY=0
wait_for_port 'Edge'    3210 || ALL_READY=1
wait_for_port 'Hub'     4210 || ALL_READY=1
wait_for_port 'Desktop' 5199 'localhost' || ALL_READY=1

banner 'All services started'
printf '  Edge:    http://127.0.0.1:3210\n'
printf '  Hub:     http://127.0.0.1:4210\n'
printf '  Desktop: http://localhost:5199\n'
printf '\nPress Ctrl+C to stop all services.\n\n'

# Keep running until Ctrl+C or any child exits
wait "${PIDS[@]}" 2>/dev/null || true
