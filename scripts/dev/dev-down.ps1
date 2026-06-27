<#
.SYNOPSIS
    Tear down the Hub Server Docker Compose dev environment.
.DESCRIPTION
    Stops and removes PostgreSQL and Redis containers started by dev-up.
#>
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

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
