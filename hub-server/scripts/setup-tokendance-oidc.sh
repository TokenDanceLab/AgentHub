#!/usr/bin/env bash
# ───────────────────────────────────────────────
# TokenDance ID OIDC Client Setup for AgentHub
# ───────────────────────────────────────────────
# Sets up the "AgentHub Desktop" OAuth client in TokenDance ID
# so Hub Server can use OIDC PKCE login.
#
# Prerequisites:
#   docker compose up -d postgres redis    (or local PG/Redis)
#
# Two modes:
#   1. TokenDance ID running → uses API (preferred)
#   2. TokenDance ID offline  → uses SQLite seed (fallback)
#
# Usage:
#   bash scripts/setup-tokendance-oidc.sh
#
# After running, copy the output client_secret to:
#   AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET in .env
# ───────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TD_ROOT="$REPO_ROOT/../tokendance-id"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

banner()  { printf '\n%s=== %s ===%s\n' "$GREEN" "$1" "$NC"; }
info()    { printf '  %s[+]%s %s\n' "$GREEN" "$NC" "$1"; }
warn()    { printf '  %s[*]%s %s\n' "$YELLOW" "$NC" "$1"; }
detail()  { printf '  %s    %s%s\n' "$CYAN" "$NC" "$1"; }
code()    { printf '  %s      %s%s\n' "$CYAN" "$NC" "$1"; }

CLIENT_ID="agenthub-desktop"
CLIENT_NAME="AgentHub Desktop"
CLIENT_SECRET="agenthub-dev-secret-change-me"
# Pre-computed bcrypt hash for the above secret.
# To regenerate for a different secret, use the same recipe the real-e2e
# provisioning script uses (python3 + bcrypt, already a CI prereq):
#   python3 -c "import bcrypt,sys;print(bcrypt.hashpw(sys.argv[1].encode(),bcrypt.gensalt(rounds=10)).decode())" "your-secret"
# See scripts/e2e/provision-real-e2e-stack.sh. (This comment used to point at
# scripts/bcrypt-hash.go, a file that has never existed in the repo.)
BCRYPT_HASH='$2a$10$CFRzH1R6MEUVU88nLzRSo.1qX7DtG6sPTqOrZ5HNfp1awu0ei0XpS'
REDIRECT_URIS='["http://127.0.0.1/callback","http://localhost:5174/auth/tokendance/callback","http://127.0.0.1:5174/auth/tokendance/callback"]'
GRANT_TYPES='["authorization_code","refresh_token"]'
SCOPES='["openid","profile","email"]'

banner "TokenDance ID OIDC Client Setup"

# ── Check prerequisites ──────────────────────────
if ! command -v go &>/dev/null; then
    echo -e "${RED}[!] Go is not installed.${NC}"
    echo '    Install Go 1.26+ from https://go.dev/dl/'
    exit 1
fi

# ── Step 1: Check if TokenDance ID is running ────
info "Checking TokenDance ID..."
TD_RUNNING=false
if curl -s --max-time 2 "http://localhost:3000/.well-known/openid-configuration" >/dev/null 2>&1; then
    TD_RUNNING=true
    info "TokenDance ID is running at http://localhost:3000"
else
    warn "TokenDance ID is NOT running — will use SQLite seed mode"
    warn "(Start TokenDance ID for API-based setup: cd ../tokendance-id && go run ./cmd/tokendance-id)"
fi

# ── Step 2: Register the OAuth client ─────────────
if [ "$TD_RUNNING" = true ]; then
    banner "API-based Client Registration"

    EXISTING=$(curl -s --max-time 5 "http://localhost:3000/api/clients" 2>/dev/null | grep -c "$CLIENT_ID" || true)
    if [ "$EXISTING" -gt 0 ] 2>/dev/null; then
        warn "Client '$CLIENT_ID' already exists. Skipping registration."
    else
        info "Creating OAuth client '$CLIENT_ID'..."
        RESP=$(curl -s --max-time 10 -X POST "http://localhost:3000/api/clients" \
            -H "Content-Type: application/json" \
            -d "{
                \"client_id\": \"$CLIENT_ID\",
                \"name\": \"$CLIENT_NAME\",
                \"redirect_uris\": $REDIRECT_URIS,
                \"grant_types\": $GRANT_TYPES,
                \"scopes\": $SCOPES
            }" 2>/dev/null)

        if echo "$RESP" | grep -q "client_id"; then
            info "Client registered successfully."
            detail "Response: $RESP"
        else
            warn "API registration returned unexpected response:"
            detail "$RESP"
            warn "Falling back to SQLite seed mode..."
            TD_RUNNING=false
        fi
    fi
fi

# ── Step 3: SQLite seed mode ─────────────────────
if [ "$TD_RUNNING" = false ]; then
    banner "SQLite Seed Mode"

    TD_DB="$TD_ROOT/data/tokendance.db"
    if [ ! -f "$TD_DB" ]; then
        echo -e "${RED}[!] TokenDance ID database not found at:${NC}"
        echo "    $TD_DB"
        echo ''
        echo '  Start TokenDance ID first to create the database:'
        echo "    cd $TD_ROOT && go run ./cmd/tokendance-id"
        exit 1
    fi

    info "TokenDance ID database found: $TD_DB"

    # Create a test user if none exist
    info "Ensuring at least one user exists..."
    USER_COUNT=$(sqlite3 "$TD_DB" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "0")
    if [ "$USER_COUNT" -eq 0 ]; then
        TD_USER_ID=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || echo "00000000-0000-0000-0000-000000000001")
        sqlite3 "$TD_DB" "INSERT INTO users (id, username, email, display_name, email_verified, created_at, updated_at) VALUES ('$TD_USER_ID', 'dev-test', 'dev@test.local', 'Dev Test User', 1, datetime('now'), datetime('now'));"
        info "Created test user: dev-test (id=$TD_USER_ID)"
    else
        TD_USER_ID=$(sqlite3 "$TD_DB" "SELECT id FROM users LIMIT 1;")
    fi

    # Delete existing client if present
    sqlite3 "$TD_DB" "DELETE FROM oauth_clients WHERE client_id='$CLIENT_ID';" 2>/dev/null || true

    # Generate a stable UUID for the client row
    CLIENT_ROW_ID="11111111-1111-1111-1111-111111111111"

    info "Inserting OAuth client into database..."
    sqlite3 "$TD_DB" "INSERT INTO oauth_clients (id, client_id, secret_hash, name, redirect_uris, grant_types, scopes, user_id, enabled, is_trusted, created_at, updated_at) VALUES ('$CLIENT_ROW_ID', '$CLIENT_ID', '$BCRYPT_HASH', '$CLIENT_NAME', '$REDIRECT_URIS', '$GRANT_TYPES', '$SCOPES', '$TD_USER_ID', 1, 0, datetime('now'), datetime('now'));"

    info "Client inserted successfully."
fi

# ── Step 4: Verify ────────────────────────────────
banner "Configuration Summary"
echo ''
echo "  Add to hub-server/.env:"
echo ''
code "AGENTHUB_TOKENDANCE_ID_ISSUER_URL=http://localhost:3000"
code "AGENTHUB_TOKENDANCE_ID_CLIENT_ID=$CLIENT_ID"
code "AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET=$CLIENT_SECRET"
code "AGENTHUB_TOKENDANCE_ID_REDIRECT_URI=http://127.0.0.1/callback"
code "AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS=http://127.0.0.1/callback,http://localhost:5174/auth/tokendance/callback,http://127.0.0.1:5174/auth/tokendance/callback"
echo ''
info "Add to TokenDance ID config (configs/config.yaml):"
echo ''
code "security:"
code "  allowed_origins:"
code "    - http://localhost:5174"
code "    - http://127.0.0.1:5174"
code "    - http://localhost:3000"
echo ''
info "Done. Restart Hub Server to apply changes:"
echo '    cd hub-server && go run ./cmd/server-hub'
echo ''
