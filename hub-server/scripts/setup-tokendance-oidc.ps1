# setup-tokendance-oidc.ps1 — Create or rotate OAuth client credentials for AgentHub Desktop (PowerShell)
#
# Usage: .\scripts\setup-tokendance-oidc.ps1 [-TokenDanceUrl <url>]
#
# Prerequisites:
#   - TokenDance ID is running (default: http://localhost:3000)
#
# Output: Exports AGENTHUB_TOKENDANCE_* env vars and writes to stdout

param([string]$TokenDanceUrl = "http://localhost:3000")

$ErrorActionPreference = "Stop"

$ClientName = "AgentHub Desktop"
$ClientId = "agenthub-desktop"

Write-Host "=== AgentHub Desktop — TokenDance ID OAuth Client Setup ===" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check TokenDance ID is reachable ──────────────────────────
Write-Host "[1/3] Checking TokenDance ID at $TokenDanceUrl ..."
try {
    $null = Invoke-RestMethod -Uri "$TokenDanceUrl/health" -TimeoutSec 5
    Write-Host "  TokenDance ID is running." -ForegroundColor Green
} catch {
    Write-Host "  ERROR: TokenDance ID is not reachable at $TokenDanceUrl" -ForegroundColor Red
    Write-Host "  Start it with: cd ..\tokendance-id; go run .\cmd\tokendance-id"
    Write-Host "  Then retry this script."
    exit 1
}

# ── Step 2: Get admin credentials ─────────────────────────────────────
Write-Host ""
Write-Host "[2/3] You need an API key to create OAuth clients."
Write-Host "  Open $TokenDanceUrl in your browser and log in."
Write-Host "  Then go to API Keys and create a key with name 'setup-script'."
Write-Host ""
$ApiKey = Read-Host -Prompt "  Paste your API key (starts with sk-)"

if (-not $ApiKey) {
    Write-Host "  ERROR: No API key provided." -ForegroundColor Red
    exit 1
}

if (-not $ApiKey.StartsWith("sk-")) {
    Write-Host "  WARNING: API key does not start with 'sk-'. Continuing anyway..." -ForegroundColor Yellow
}

# ── Step 3: Create or rotate client ──────────────────────────────────
Write-Host ""
Write-Host "[3/3] Setting up OAuth client '$ClientName' ..."

$headers = @{
    "Authorization" = "Bearer $ApiKey"
    "Content-Type"  = "application/json"
}

# Try to find existing client
try {
    $listResp = Invoke-RestMethod -Uri "$TokenDanceUrl/api/clients" -Headers @{ Authorization = "Bearer $ApiKey" } -TimeoutSec 10
    $existing = ($listResp.clients | Where-Object { $_.client_id -eq $ClientId } | Select-Object -First 1)
} catch {
    $existing = $null
}

$Secret = $null
if ($existing) {
    Write-Host "  Client '$ClientId' already exists. Rotating secret..."
    try {
        $rotateResp = Invoke-RestMethod -Uri "$TokenDanceUrl/api/clients/$($existing.id)/rotate-secret" `
            -Method Post -Headers @{ Authorization = "Bearer $ApiKey" } -TimeoutSec 10
        $Secret = $rotateResp.client_secret
        Write-Host "  Secret rotated." -ForegroundColor Green
    } catch {
        Write-Host "  WARNING: Rotate failed: $_" -ForegroundColor Yellow
    }
}

if (-not $Secret) {
    Write-Host "  Creating new client '$ClientId' ..."
    try {
        $body = @{
            name          = $ClientName
            redirect_uris = @("http://127.0.0.1:PORT_IDX/callback", "agenthub://callback")
            grant_types   = @("authorization_code")
            scopes        = @("openid", "profile", "email")
        } | ConvertTo-Json

        $createResp = Invoke-RestMethod -Uri "$TokenDanceUrl/api/clients" `
            -Method Post -Headers $headers -Body $body -TimeoutSec 10
        $Secret = $createResp.client_secret
        Write-Host "  Client created." -ForegroundColor Green
    } catch {
        Write-Host "  ERROR: Failed to create client: $_" -ForegroundColor Red
        Write-Host "  Fallback: run the seed SQL:"
        Write-Host "    sqlite3 ..\tokendance-id\data\tokendance.db < scripts\seed-tokendance-client.sql"
        exit 1
    }
}

if (-not $Secret) {
    Write-Host "  ERROR: Could not obtain client_secret." -ForegroundColor Red
    exit 1
}

# ── Output ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Add these to your hub-server\.env ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "AGENTHUB_TOKENDANCE_ISSUER_URL=$TokenDanceUrl"
Write-Host "AGENTHUB_TOKENDANCE_CLIENT_ID=$ClientId"
Write-Host "AGENTHUB_TOKENDANCE_CLIENT_SECRET=$Secret"
Write-Host "AGENTHUB_TOKENDANCE_REDIRECT_URI=http://127.0.0.1:PORT_IDX/callback"
Write-Host ""
Write-Host "Done. Keep the client_secret safe — it will never be shown again." -ForegroundColor Yellow
