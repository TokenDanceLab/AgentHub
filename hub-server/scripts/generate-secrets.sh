#!/usr/bin/env bash
# generate-secrets.sh — Generate strong random secrets and write the production env file
# Usage: bash hub-server/scripts/generate-secrets.sh [output_path]
# Default output: deployments/production/.env (read by deployments/production/docker-compose.yml)
set -euo pipefail

OUTPUT="${1:-$(cd "$(dirname "$0")/../.." && pwd)/deployments/production/.env}"

# ── Generate secrets using OpenSSL ──────────────────────────────────────
JWT_SECRET="$(openssl rand -hex 32)"
PG_PASSWORD="$(openssl rand -hex 16)"

# ── Fixed configuration (non-secret) ────────────────────────────────────
PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="${PG_PORT:-5433}"
PG_USER="${PG_USER:-agenthub}"
PG_DB_NAME="${PG_DB_NAME:-agenthub}"
PG_SSLMODE="${PG_SSLMODE:-require}"

JWT_ACCESS_TTL="${AGENTHUB_JWT_ACCESS_TTL:-15m}"
JWT_REFRESH_TTL="${AGENTHUB_JWT_REFRESH_TTL:-720h}"
SERVER_LOG_LEVEL="${AGENTHUB_LOG_LEVEL:-${AGENTHUB_SERVER_LOG_LEVEL:-info}}"

# ── Write the production env file ───────────────────────────────────────
cat > "$OUTPUT" << EOF
# AgentHub — production deployment environment
# Consumed by deployments/production/docker-compose.yml.
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# WARNING: Keep this file secure. Do not commit to version control.

# ── Database (operator-managed PostgreSQL) ──────────────────────────────
PG_HOST=${PG_HOST}
PG_PORT=${PG_PORT}
PG_USER=${PG_USER}
PG_PASSWORD=${PG_PASSWORD}
PG_DB_NAME=${PG_DB_NAME}
PG_SSLMODE=${PG_SSLMODE}

# ── JWT Authentication ──────────────────────────────────────────────────
AGENTHUB_JWT_SECRET=${JWT_SECRET}
AGENTHUB_JWT_ACCESS_TTL=${JWT_ACCESS_TTL}
AGENTHUB_JWT_REFRESH_TTL=${JWT_REFRESH_TTL}

# ── Server Configuration ────────────────────────────────────────────────
# production enables validateProdGuard (AUTH_FAIL_CLOSED must be explicit,
# DB SSL mode must not be "disable"). Empty CORS origins resolve to the
# built-in production allowlist.
AGENTHUB_ENV=production
AGENTHUB_LOG_LEVEL=${SERVER_LOG_LEVEL}

# ── OIDC (fill in from the Account confidential-client registration) ───
AGENTHUB_ACCOUNT_OIDC_ISSUER_URL=
AGENTHUB_ACCOUNT_OIDC_CLIENT_ID=
AGENTHUB_ACCOUNT_OIDC_CLIENT_SECRET=
AGENTHUB_ACCOUNT_OIDC_REDIRECT_URI=
AGENTHUB_ACCOUNT_OIDC_ALLOWED_REDIRECT_URIS=
EOF

echo "Secrets generated and written to: $OUTPUT"
echo "  JWT secret:   ${JWT_SECRET:0:8}..."
echo "  DB password:  ${PG_PASSWORD:0:8}..."
