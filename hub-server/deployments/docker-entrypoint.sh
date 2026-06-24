#!/bin/sh
# ──────────────────────────────────────────────
# AgentHub Hub Server — Docker entrypoint
# ──────────────────────────────────────────────
# Validates that required secrets are provided via
# environment variables at container start before
# handing execution to server-hub.
# ──────────────────────────────────────────────
set -e

# ── Required secrets ────────────────────────
# AGENTHUB_DB_PASSWORD must be set and non-empty.
# The config YAML ships with password: "" (blank);
# Viper AutomaticEnv resolves AGENTHUB_DB_PASSWORD
# at runtime from the container environment.
if [ -z "${AGENTHUB_DB_PASSWORD:-}" ]; then
    echo "ERROR: AGENTHUB_DB_PASSWORD is required but not set." >&2
    echo "       Set it via docker-compose .env or --env flag." >&2
    exit 1
fi

# AGENTHUB_JWT_SECRET is validated by the Go validate()
# function at startup and also required here as a defense-
# in-depth check.
if [ -z "${AGENTHUB_JWT_SECRET:-}" ]; then
    echo "ERROR: AGENTHUB_JWT_SECRET is required but not set." >&2
    echo "       Must be at least 32 characters." >&2
    exit 1
fi

echo "[entrypoint] Required secrets: OK"

# ── Runtime ─────────────────────────────────
exec "$@"
