param(
    [string]$RepoRoot = ".",
    [string]$Mode = "FixtureOnlyObserved"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath

if ($Mode -ne "FixtureOnlyObserved") {
    Write-Host "FAIL: mode must be FixtureOnlyObserved, got $Mode" -ForegroundColor Red
    exit 1
}

Write-Host "Edge SQLite durable observed fixture smoke" -ForegroundColor Magenta
Write-Host "Mode: FixtureOnlyObserved"
Write-Host "Observed shape: agenthub-edge --store-backend sqlite --store-db <temp.db>"
Write-Host "Boundary: local temporary SQLite DB only; no real CLI/model/API key/login/deploy or release artifacts."
Write-Host "Scope: alpha durability via in-memory Store snapshot rows plus SQLite relational projection; not complete relational CRUD."

$edgeRoot = Join-Path $RepoRoot "edge-server"
$goTestCommand = "go test ./cmd/agenthub-edge ./internal/store -run SQLiteDurableObservedFixtureSmoke -count=1"
Write-Host "Running: $goTestCommand"

Push-Location $edgeRoot
try {
    go test ./cmd/agenthub-edge ./internal/store -run SQLiteDurableObservedFixtureSmoke -count=1
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}

Write-Host "PASS: FixtureOnlyObserved Edge SQLite alpha durability smoke"
