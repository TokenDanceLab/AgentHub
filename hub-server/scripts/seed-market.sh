#!/usr/bin/env bash
# seed-market.sh — Seed Hub marketplace with pre-built Skills and MCP Servers
# ===========================================================================
# Modes:
#   1. SQL mode (--sql): Applies the SQL migration directly (recommended).
#      Uses psql if available, falls back to Docker exec.
#
#   2. API mode (default): Uses the Hub REST API with a generated JWT token.
#      Requires: curl, openssl, and AGENTHUB_JWT_SECRET in .env or environment.
#
#   3. Check mode (--check): Queries the API to verify existing entries.
#
#   4. Dry run (--dry): Shows what would be inserted via API without making changes.
#
# Usage:
#   cd hub-server
#   bash scripts/seed-market.sh --sql    # Direct SQL (recommended)
#   bash scripts/seed-market.sh          # API mode
#   bash scripts/seed-market.sh --check  # Verify
#   bash scripts/seed-market.sh --dry    # Dry run

set -euo pipefail

cd "$(dirname "$0")/.."

HUB_URL="${HUB_URL:-http://127.0.0.1:8080}"
ENV_FILE=".env"
DRY_RUN=false
SQL_MODE=false
CHECK_MODE=false
HAVE_JQ=false

for arg in "$@"; do
    case "$arg" in
        --sql|-s)   SQL_MODE=true ;;
        --dry)      DRY_RUN=true ;;
        --check)    CHECK_MODE=true ;;
        --help|-h)
            echo "Usage: $0 [--sql|--dry|--check]"
            echo "  --sql   Use direct SQL (recommended, uses Docker if psql not found)"
            echo "  --dry   Show what would be inserted without making changes (API mode)"
            echo "  --check Query API to verify existing entries"
            exit 0
            ;;
    esac
done

# ── Colors ──────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERR]${NC} $*"; }

# ── Load .env ───────────────────────────────────────────────
load_env() {
    if [ -f "$ENV_FILE" ]; then
        # shellcheck disable=SC2046
        export $(grep -v '^#' "$ENV_FILE" | grep -v '^\s*$' | xargs)
    fi
}

# ── JWT Generation ──────────────────────────────────────────
# Generates an HS256 JWT for the marketplace-system user.
generate_jwt() {
    local secret="$1"
    local user_id="${2:-c0000000-0000-0000-0000-000000000001}"
    local now=$(date +%s)
    local exp=$((now + 300))

    local header=$(printf '{"alg":"HS256","typ":"JWT"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
    local payload=$(printf '{"user_id":"%s","device_type":"web","device_id":"seed-script","iss":"agenthub-hub","aud":"agenthub-api","sub":"%s","exp":%d,"iat":%d}' "$user_id" "$user_id" "$exp" "$now" | base64 -w0 | tr '+/' '-_' | tr -d '=')
    local signature=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$secret" -binary | base64 -w0 | tr '+/' '-_' | tr -d '=')

    echo "${header}.${payload}.${signature}"
}

# ── SQL Mode ────────────────────────────────────────────────
if $SQL_MODE; then
    info "Running SQL seed migration..."
    load_env

    DB_HOST="${AGENTHUB_DB_HOST:-127.0.0.1}"
    DB_PORT="${AGENTHUB_DB_PORT:-5432}"
    DB_USER="${AGENTHUB_DB_USER:-agenthub}"
    DB_NAME="${AGENTHUB_DB_NAME:-agenthub}"

    MIGRATION_FILE="migrations/0050_seed_market_skills_mcp.up.sql"

    if command -v psql &>/dev/null; then
        PGPASSWORD="${AGENTHUB_DB_PASSWORD:-}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
            -f "$MIGRATION_FILE"
    else
        # Try Docker
        DOCKER_CONTAINER="${AGENTHUB_PG_CONTAINER:-agenthub-postgres}"
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${DOCKER_CONTAINER}$"; then
            info "psql not in PATH, using Docker container: $DOCKER_CONTAINER"
            docker exec -i "$DOCKER_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$MIGRATION_FILE"
        else
            error "Neither psql nor Docker postgres container ($DOCKER_CONTAINER) found."
            echo "Install psql or start the postgres Docker container."
            exit 1
        fi
    fi
    info "SQL seed applied successfully."
    exit 0
fi

# ── Shared: load env and generate JWT for API modes ────────
load_env

if command -v jq &>/dev/null; then
    HAVE_JQ=true
fi

JWT_SECRET="${AGENTHUB_JWT_SECRET:-}"
if [ -z "$JWT_SECRET" ] && [ -f "$ENV_FILE" ]; then
    JWT_SECRET=$(grep -E '^AGENTHUB_JWT_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2-)
fi

if [ -z "$JWT_SECRET" ]; then
    error "AGENTHUB_JWT_SECRET not found. Set it in .env or environment."
    exit 1
fi

TOKEN=$(generate_jwt "$JWT_SECRET")
if [ -z "$TOKEN" ]; then
    error "Failed to generate JWT token."
    exit 1
fi

AUTH_HEADER="Authorization: Bearer $TOKEN"

# ── Check Mode ──────────────────────────────────────────────
if $CHECK_MODE; then
    info "Checking existing marketplace entries..."

    if ! $HAVE_JQ; then
        warn "jq not found — raw JSON output."
    fi

    echo ""
    echo "=== Skills ==="
    if $HAVE_JQ; then
        curl -sf -H "$AUTH_HEADER" "$HUB_URL/web/skills?pageSize=50" | jq '.data.items[] | {name, is_public, version}'
    else
        curl -sf -H "$AUTH_HEADER" "$HUB_URL/web/skills?pageSize=50"
    fi

    echo ""
    echo "=== MCP Servers ==="
    if $HAVE_JQ; then
        curl -sf -H "$AUTH_HEADER" "$HUB_URL/web/mcp-servers?pageSize=50" | jq '.data.items[] | {name, is_public, transport}'
    else
        curl -sf -H "$AUTH_HEADER" "$HUB_URL/web/mcp-servers?pageSize=50"
    fi
    exit 0
fi

# ── API Mode ────────────────────────────────────────────────
info "Seeding marketplace via REST API at $HUB_URL"

if ! command -v curl &>/dev/null; then
    error "curl is required for API mode."
    exit 1
fi

# ── Helper: create a skill ──────────────────────────────────
create_skill() {
    local name="$1" description="$2"
    local body=$(printf '{"name":"%s","description":"%s","skill_type":"agent_skill","runtime_ids":"[\\\"claude-code\\\",\\\"codex\\\"]"}' "$name" "$description")

    if $DRY_RUN; then
        info "[DRY] Would create skill: $name"
        return
    fi

    local resp
    resp=$(curl -sf -X POST "$HUB_URL/web/skills" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d "$body" 2>/dev/null) || {
        warn "Failed to create skill: $name"
        return
    }

    local skill_id=""
    if $HAVE_JQ; then
        skill_id=$(echo "$resp" | jq -r '.data.id // empty')
    fi

    if [ -n "$skill_id" ]; then
        curl -sf -X POST "$HUB_URL/web/skills/$skill_id/publish" \
            -H "$AUTH_HEADER" 2>/dev/null || warn "Failed to publish skill: $name"
        info "Created + published skill: $name ($skill_id)"
    else
        info "Created skill: $name (publish requires admin via API)"
    fi
}

# ── Helper: create an MCP server ────────────────────────────
create_mcp() {
    local name="$1" args="$2" env_vars="${3:-\{\}}"
    local body=$(printf '{"name":"%s","transport":"stdio","command":"npx","args":"%s","env_vars":"%s","auth_type":"none"}' "$name" "$args" "$env_vars")

    if $DRY_RUN; then
        info "[DRY] Would create MCP server: $name"
        return
    fi

    local resp
    resp=$(curl -sf -X POST "$HUB_URL/web/mcp-servers" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d "$body" 2>/dev/null) || {
        warn "Failed to create MCP server: $name"
        return
    }

    local mcp_id=""
    if $HAVE_JQ; then
        mcp_id=$(echo "$resp" | jq -r '.data.id // empty')
    fi

    if [ -n "$mcp_id" ]; then
        curl -sf -X POST "$HUB_URL/web/mcp-servers/$mcp_id/publish" \
            -H "$AUTH_HEADER" 2>/dev/null || warn "Failed to publish MCP server: $name"
        info "Created + published MCP server: $name ($mcp_id)"
    else
        info "Created MCP server: $name (publish requires admin via API)"
    fi
}

# ── Seed Skills ─────────────────────────────────────────────
info "Seeding Skills..."

create_skill "PPTX Generator" \
    "Create professional .pptx presentations with slides, layouts, charts, and speaker notes using python-pptx"

create_skill "DOCX Report Generator" \
    "Create .docx reports, proposals, and documentation with python-docx -- headings, tables, images, TOC"

create_skill "Excel Data Analyzer" \
    "Analyze .xlsx/.csv data with pandas/openpyxl -- pivot tables, charts, data cleaning, statistical analysis"

create_skill "PDF Toolkit" \
    "Merge, split, extract text, fill forms, and convert PDFs with PyPDF2/pikepdf"

create_skill "Diagram Generator" \
    "Generate Mermaid/PlantUML diagrams -- flowcharts, sequence diagrams, ERDs, architecture diagrams"

create_skill "Code Documentation Generator" \
    "Generate comprehensive code documentation, API docs, README files from source code analysis"

create_skill "Image Processor" \
    "Resize, crop, convert, compress, watermark images with Pillow -- batch processing supported"

create_skill "Markdown to HTML/Slides" \
    "Convert Markdown to reveal.js slides, static HTML sites, or PDF via markdown-to-presentation pipeline"

# ── Seed MCP Servers ────────────────────────────────────────
info "Seeding MCP Servers..."

create_mcp "Filesystem MCP" \
    "[\"-y\",\"@anthropic-ai/mcp-server-filesystem\",\".\"]"

create_mcp "GitHub MCP" \
    "[\"-y\",\"@anthropic-ai/mcp-server-github\"]" \
    "{\"GITHUB_PERSONAL_ACCESS_TOKEN\":\"***\"}"

create_mcp "Postgres MCP" \
    "[\"-y\",\"@anthropic-ai/mcp-server-postgres\"]" \
    "{\"DATABASE_URL\":\"***\"}"

create_mcp "Brave Search MCP" \
    "[\"-y\",\"@anthropic-ai/mcp-server-brave-search\"]" \
    "{\"BRAVE_API_KEY\":\"***\"}"

create_mcp "Puppeteer MCP" \
    "[\"-y\",\"@anthropic-ai/mcp-server-puppeteer\"]"

create_mcp "Memory MCP" \
    "[\"-y\",\"@anthropic-ai/mcp-server-memory\"]"

info "Seed complete. Run 'bash scripts/seed-market.sh --check' to verify."
