<#
.SYNOPSIS
    One-command local dev environment for Hub Server.
.DESCRIPTION
    Starts PostgreSQL 16 + Redis 7 via Docker Compose, waits for them to be
    healthy, then runs the Hub Server via go run.
#>
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$HubDir = Join-Path $RepoRoot 'hub-server'

Push-Location $HubDir
try {
    Write-Host "=== Starting PostgreSQL + Redis ===" -ForegroundColor Magenta
    docker compose up -d postgres redis
    if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

    Write-Host "`nWaiting for PostgreSQL..." -ForegroundColor Cyan
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        $out = docker compose exec -T postgres pg_isready -U agenthub -d agenthub 2>&1
        if ($LASTEXITCODE -eq 0 -and $out -match 'accepting connections') {
            $ready = $true
            break
        }
        Start-Sleep 1
    }
    if (-not $ready) {
        Write-Host "  TIMEOUT: PostgreSQL did not become ready in 60s" -ForegroundColor Red
        exit 1
    }
    Write-Host "  PostgreSQL is ready." -ForegroundColor Green

    Write-Host "Waiting for Redis..." -ForegroundColor Cyan
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        $out = docker compose exec -T redis redis-cli ping 2>&1
        if ($LASTEXITCODE -eq 0 -and $out -match 'PONG') {
            $ready = $true
            break
        }
        Start-Sleep 1
    }
    if (-not $ready) {
        Write-Host "  TIMEOUT: Redis did not become ready in 60s" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Redis is ready." -ForegroundColor Green

    Write-Host "`n=== Running database migrations ===" -ForegroundColor Magenta
    go run ./cmd/server-hub migrate 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  (migrate command not available; if the schema is already current, this is fine)" -ForegroundColor DarkGray
    }

    Write-Host "`n=== Starting Hub Server ===" -ForegroundColor Magenta
    Write-Host "  API:    http://localhost:8080" -ForegroundColor Cyan
    Write-Host "  Admin:  http://localhost:6060/debug/pprof/" -ForegroundColor Cyan
    Write-Host "  Press Ctrl+C to stop.`n" -ForegroundColor Yellow

    go run ./cmd/server-hub/
}
finally {
    Pop-Location
}
