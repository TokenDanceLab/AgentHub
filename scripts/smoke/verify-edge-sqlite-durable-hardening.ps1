param(
    [string]$RepoRoot = ".",
    [string]$Mode = "FixtureOnlyDurable"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath

if ($Mode -ne "FixtureOnlyDurable") {
    Write-Host "FAIL: mode must be FixtureOnlyDurable, got $Mode" -ForegroundColor Red
    exit 1
}

Write-Host "Edge SQLite durable hardening gate" -ForegroundColor Magenta
Write-Host "Mode: FixtureOnlyDurable"
Write-Host "Boundary: local temporary SQLite DB only; no real CLI, model API, login, deploy, release, or external service."
Write-Host "Scope: runs, thread replay items, approval events, file-change evidence, artifacts, pins, row-first restore, relational read projection, and agenthub-edge store-readiness JSON output."
Write-Host "Non-goal: complete relational CRUD or production DB readiness."

$edgeRoot = Join-Path $RepoRoot "edge-server"
$goTestCommand = 'go test ./internal/store -run "SQLite|Durable|Approval|Artifact|Replay|Pins" -count=1'
Write-Host "Running: $goTestCommand"

Push-Location $edgeRoot
try {
    go test ./internal/store -run "SQLite|Durable|Approval|Artifact|Replay|Pins" -count=1
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    $cmdTestCommand = 'go test ./cmd/agenthub-edge -run "StoreReadiness|SQLite" -count=1'
    Write-Host "Running: $cmdTestCommand"
    go test ./cmd/agenthub-edge -run "StoreReadiness|SQLite" -count=1
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}

Write-Host "PASS: Edge SQLite durable hardening fixture gate"
