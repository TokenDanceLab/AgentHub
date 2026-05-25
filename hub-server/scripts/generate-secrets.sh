#!/usr/bin/env bash
# generate-secrets.sh — Generate strong random secrets and write a .env.production file
# Usage: bash scripts/generate-secrets.sh [output_path]
# Default output: hub-server/.env.production
set -euo pipefail

OUTPUT="${1:-$(cd "$(dirname "$0")/.." && pwd)/deployments/.env.production}"

# ── Generate secrets using OpenSSL ──────────────────────────────────────
JWT_SECRET="$(openssl rand -hex 32)"
DB_PASSWORD="$(openssl rand -hex 16)"
REDIS_PASSWORD="$(openssl rand -hex 16)"
PPROF_PASS="$(openssl rand -hex 12)"

# ── Fixed configuration (non-secret) ────────────────────────────────────
DB_HOST="${AGENTHUB_DB_HOST:-postgres}"
DB_PORT="${AGENTHUB_DB_PORT:-5432}"
DB_USER="${AGENTHUB_DB_USER:-agenthub}"
DB_NAME="${AGENTHUB_DB_NAME:-agenthub}"

REDIS_HOST="${AGENTHUB_REDIS_HOST:-redis}"
REDIS_PORT="${AGENTHUB_REDIS_PORT:-6379}"
REDIS_DB="${AGENTHUB_REDIS_DB:-0}"
REDIS_POOL_SIZE="${AGENTHUB_REDIS_POOL_SIZE:-100}"
REDIS_MIN_IDLE_CONNS="${AGENTHUB_REDIS_MIN_IDLE_CONNS:-10}"

JWT_ACCESS_TTL="${AGENTHUB_JWT_ACCESS_TTL:-15m}"
JWT_REFRESH_TTL="${AGENTHUB_JWT_REFRESH_TTL:-720h}"

AGENTHUB_ENV="${AGENTHUB_ENV:-production}"
SERVER_PORT="${AGENTHUB_SERVER_PORT:-8080}"
SERVER_LOG_LEVEL="${AGENTHUB_SERVER_LOG_LEVEL:-info}"
SERVER_ADMIN_PORT="${AGENTHUB_SERVER_ADMIN_PORT:-6060}"

UPLOAD_DIR="${AGENTHUB_UPLOAD_DIR:-./uploads}"
UPLOAD_MAX_SIZE="${AGENTHUB_UPLOAD_MAX_SIZE:-10485760}"

PPROF_USER="${AGENTHUB_PPROF_USER:-admin}"
CORS_ORIGINS="${AGENTHUB_CORS_ORIGINS:-https://hub.vectorcontrol.tech}"

# ── Write .env.production ───────────────────────────────────────────────
cat > "$OUTPUT" << EOF
# AgentHub Hub Server — Production environment variables
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# WARNING: Keep this file secure. Do not commit to version control.

# ── Database (independent PostgreSQL instance) ──────────────────────────
AGENTHUB_DB_HOST=${DB_HOST}
AGENTHUB_DB_PORT=${DB_PORT}
AGENTHUB_DB_USER=${DB_USER}
AGENTHUB_DB_PASSWORD=${DB_PASSWORD}
AGENTHUB_DB_NAME=${DB_NAME}

# ── Redis (independent Redis instance) ──────────────────────────────────
AGENTHUB_REDIS_HOST=${REDIS_HOST}
AGENTHUB_REDIS_PORT=${REDIS_PORT}
AGENTHUB_REDIS_PASSWORD=${REDIS_PASSWORD}
AGENTHUB_REDIS_DB=${REDIS_DB}
AGENTHUB_REDIS_POOL_SIZE=${REDIS_POOL_SIZE}
AGENTHUB_REDIS_MIN_IDLE_CONNS=${REDIS_MIN_IDLE_CONNS}

# ── JWT Authentication ──────────────────────────────────────────────────
AGENTHUB_JWT_SECRET=${JWT_SECRET}
AGENTHUB_JWT_ACCESS_TTL=${JWT_ACCESS_TTL}
AGENTHUB_JWT_REFRESH_TTL=${JWT_REFRESH_TTL}

# ── Server Configuration ────────────────────────────────────────────────
AGENTHUB_ENV=${AGENTHUB_ENV}
AGENTHUB_SERVER_PORT=${SERVER_PORT}
AGENTHUB_SERVER_LOG_LEVEL=${SERVER_LOG_LEVEL}
AGENTHUB_SERVER_ADMIN_PORT=${SERVER_ADMIN_PORT}
AGENTHUB_UPLOAD_DIR=${UPLOAD_DIR}
AGENTHUB_UPLOAD_MAX_SIZE=${UPLOAD_MAX_SIZE}

# ── PPROF Admin Auth ────────────────────────────────────────────────────
AGENTHUB_PPROF_USER=${PPROF_USER}
AGENTHUB_PPROF_PASS=${PPROF_PASS}

# ── CORS ────────────────────────────────────────────────────────────────
AGENTHUB_CORS_ORIGINS=${CORS_ORIGINS}
EOF

echo "Secrets generated and written to: $OUTPUT"
echo "  JWT secret:   ${JWT_SECRET:0:8}..."
echo "  DB password:  ${DB_PASSWORD:0:8}..."
echo "  Redis pass:   ${REDIS_PASSWORD:0:8}..."
echo "  PPROF pass:   ${PPROF_PASS:0:8}..."
