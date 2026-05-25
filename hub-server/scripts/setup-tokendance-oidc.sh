#!/usr/bin/env bash
# setup-tokendance-oidc.sh — Create or rotate OAuth client credentials for AgentHub Desktop
#
# Usage: bash scripts/setup-tokendance-oidc.sh [tokendance_url]
#
# Prerequisites:
#   - TokenDance ID is running (default: http://localhost:3000)
#   - jq is installed
#   - curl is installed
#
# Output: Exports AGENTHUB_TOKENDANCE_* env vars to stdout

set -euo pipefail

TOKENDANCE_URL="${1:-http://localhost:3000}"
CLIENT_NAME="AgentHub Desktop"
CLIENT_ID="agenthub-desktop"
REDIRECT_URIS='["http://127.0.0.1:PORT_IDX/callback","agenthub://callback"]'
GRANT_TYPES='["authorization_code"]'
SCOPES='["openid","profile","email"]'

echo "=== AgentHub Desktop — TokenDance ID OAuth Client Setup ==="
echo ""

# ── Step 1: Check TokenDance ID is reachable ──────────────────────────
echo "[1/3] Checking TokenDance ID at $TOKENDANCE_URL ..."
if ! curl -sf "$TOKENDANCE_URL/health" >/dev/null 2>&1; then
  echo "  ERROR: TokenDance ID is not reachable at $TOKENDANCE_URL"
  echo "  Start it with: cd ../tokendance-id && go run ./cmd/tokendance-id"
  echo "  Then retry this script."
  exit 1
fi
echo "  TokenDance ID is running."

# ── Step 2: Get admin credentials ─────────────────────────────────────
echo ""
echo "[2/3] You need an API key to create OAuth clients."
echo "  Open $TOKENDANCE_URL in your browser and log in."
echo "  Then go to API Keys and create a key with name 'setup-script'."
echo ""
read -r -p "  Paste your API key (starts with sk-): " API_KEY
if [ -z "$API_KEY" ]; then
  echo "  ERROR: No API key provided."
  exit 1
fi

# ── Step 3: Create or rotate client ──────────────────────────────────
echo ""
echo "[3/3] Setting up OAuth client '$CLIENT_NAME' ..."

# Try to find existing client
EXISTING=$(curl -sf -H "Authorization: Bearer $API_KEY" "$TOKENDANCE_URL/api/clients" 2>/dev/null || echo "")
EXISTING_ID=$(echo "$EXISTING" | jq -r '.clients[]? | select(.client_id=="'"$CLIENT_ID"'") | .id' 2>/dev/null || echo "")

if [ -n "$EXISTING_ID" ]; then
  echo "  Client '$CLIENT_ID' already exists. Rotating secret..."
  ROTATE_RESP=$(curl -sf -X POST "$TOKENDANCE_URL/api/clients/$EXISTING_ID/rotate-secret" \
    -H "Authorization: Bearer $API_KEY" 2>/dev/null || echo '{"error":"rotate failed"}')
  SECRET=$(echo "$ROTATE_RESP" | jq -r '.client_secret // empty')
  echo "  Secret rotated."
else
  echo "  Creating new client '$CLIENT_ID' ..."
  CREATE_RESP=$(curl -sf -X POST "$TOKENDANCE_URL/api/clients" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$CLIENT_NAME\",\"redirect_uris\":$REDIRECT_URIS,\"grant_types\":$GRANT_TYPES,\"scopes\":$SCOPES}" 2>/dev/null || echo '{"error":"create failed"}')
  SECRET=$(echo "$CREATE_RESP" | jq -r '.client_secret // empty')
fi

if [ -z "$SECRET" ] || [ "$SECRET" = "null" ]; then
  echo "  ERROR: Failed to create/rotate client. Check your API key permissions."
  echo "  As a fallback, use the seed SQL:"
  echo "    sqlite3 ../tokendance-id/data/tokendance.db < scripts/seed-tokendance-client.sql"
  exit 1
fi

# ── Output ────────────────────────────────────────────────────────────
echo ""
echo "=== Add these to your hub-server/.env ==="
echo ""
echo "AGENTHUB_TOKENDANCE_ISSUER_URL=$TOKENDANCE_URL"
echo "AGENTHUB_TOKENDANCE_CLIENT_ID=$CLIENT_ID"
echo "AGENTHUB_TOKENDANCE_CLIENT_SECRET=$SECRET"
echo "AGENTHUB_TOKENDANCE_REDIRECT_URI=http://127.0.0.1:PORT_IDX/callback"
echo ""
echo "Done. Keep the client_secret safe — it will never be shown again."
