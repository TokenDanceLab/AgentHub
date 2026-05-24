<#
.SYNOPSIS
    Tear down the Hub Server Docker Compose dev environment.
.DESCRIPTION
    Stops and removes PostgreSQL and Redis containers started by dev-up.
#>
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Push-Location $RepoRoot
try {
    Write-Host "=== Tearing down Hub Server dev environment ===" -ForegroundColor Magenta
    docker compose down
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Containers stopped and removed." -ForegroundColor Green
    }
}
finally {
    Pop-Location
}
