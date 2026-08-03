#!/usr/bin/env pwsh
<#
Deployment shape SSOT verifier (#1527 PR1).

Enforces that `deployments/production/docker-compose.yml` is the single
in-repo production compose shape:

1. The authoritative template must exist, parse as YAML, and declare the
   expected services (hub-server + redis).
2. The hub-server image must stay on the product image SSOT
   (`ghcr.io/tokendancelab/agenthub-hub-server`); `agenthub-hub` is a
   rejected second image name.
3. No second hand-maintained production compose may appear under
   `deployments/production/` (adding one must FAIL - machine proof).
4. The legacy compose inventory under `hub-server/deployments/**` is CLOSED
   since #1527 PR2: any compose file under that tree (the directory now holds
   build inputs only: Dockerfile, docker-entrypoint.sh, README.md) must FAIL.

This verifier never reads secrets; it only inspects file shapes.
#>
[CmdletBinding()]
param(
    [string]$RepoRootPath = (Resolve-Path (Join-Path $PSScriptRoot "..\.."))
)

$ErrorActionPreference = "Stop"

$script:Failed = 0
function Fail-Verifier([string]$Message) {
    $script:Failed++
    Write-Host "  FAIL  $Message" -ForegroundColor Red
}

function Pass-Verifier([string]$Message) {
    Write-Host "  PASS  $Message" -ForegroundColor Green
}

Write-Host "Deployment shape SSOT verifier (repo: $RepoRootPath)"

$AuthoritativeRelative = "deployments/production/docker-compose.yml"
$AuthoritativePath = Join-Path $RepoRootPath $AuthoritativeRelative
$ProductionDir = Split-Path -Parent $AuthoritativePath
$LegacyDeployDir = Join-Path $RepoRootPath "hub-server/deployments"

# ── YAML shape extraction via python (PyYAML; same pattern as
#    verify-openapi-contract.ps1) ──────────────────────────────────────────
$pyScript = @'
import json, pathlib, sys
import yaml

path = pathlib.Path(sys.argv[1])
compose = yaml.safe_load(path.read_text(encoding="utf-8"))
services = compose.get("services", {}) or {}
out = {
    "services": sorted(services.keys()),
    "images": {name: (svc.get("image") or "") for name, svc in services.items()},
    "has_build": {name: bool(svc.get("build")) for name, svc in services.items()},
}
print(json.dumps(out))
'@

$tempDir = $env:TEMP
if ([string]::IsNullOrWhiteSpace($tempDir)) { $tempDir = $env:TMPDIR }
if ([string]::IsNullOrWhiteSpace($tempDir)) { $tempDir = [System.IO.Path]::GetTempPath() }

$pyCheck = & python -c "import yaml; print('ok')" 2>$null
if ($LASTEXITCODE -ne 0 -or $pyCheck -ne 'ok') {
    & python -m pip install --quiet --disable-pip-version-check PyYAML 2>$null
    if ($LASTEXITCODE -ne 0) {
        & python3 -m pip install --quiet --disable-pip-version-check PyYAML 2>$null
    }
}

$tmp = New-Item -ItemType File -Path (Join-Path $tempDir "agenthub-deploy-shape-$([guid]::NewGuid()).py") -Force
$shape = $null
try {
    Set-Content -LiteralPath $tmp.FullName -Value $pyScript -Encoding utf8
    $json = & python $tmp.FullName $AuthoritativePath
    if ($LASTEXITCODE -ne 0) {
        $json = & python3 $tmp.FullName $AuthoritativePath
    }
    if ($LASTEXITCODE -ne 0) {
        Fail-Verifier "authoritative template is not valid YAML or python extraction failed: $AuthoritativeRelative"
        exit 1
    }
    $shape = $json | ConvertFrom-Json
} finally {
    Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
}

if ($null -eq $shape) {
    exit 1
}

# ── 1. Expected services ───────────────────────────────────────────────────
$expectedServices = @("hub-server", "redis")
foreach ($expected in $expectedServices) {
    if ($shape.services -notcontains $expected) {
        Fail-Verifier "authoritative template missing service '$expected'"
    }
}
if ($script:Failed -eq 0) {
    Pass-Verifier "authoritative template declares expected services ($($expectedServices -join ', '))"
}

# ── 2. hub-server image SSOT ───────────────────────────────────────────────
$image = [string]$shape.images.'hub-server'
if ($image -match "agenthub-hub\b" -and $image -notmatch "agenthub-hub-server") {
    Fail-Verifier "hub-server image reintroduces rejected name 'agenthub-hub': $image"
}
if ($image -ne "" -and -not $image.StartsWith("ghcr.io/tokendancelab/agenthub-hub-server", [StringComparison]::OrdinalIgnoreCase)) {
    Fail-Verifier "hub-server image is off SSOT: '$image' (want prefix 'ghcr.io/tokendancelab/agenthub-hub-server')"
}
if ($script:Failed -eq 0) {
    Pass-Verifier "hub-server image on SSOT: $image"
}

# ── 3. No second hand-maintained production compose ────────────────────────
$productionComposes = @(Get-ChildItem -LiteralPath $ProductionDir -Filter "docker-compose*.yml" -File -ErrorAction SilentlyContinue)
if ($productionComposes.Count -gt 1) {
    $extra = ($productionComposes | Where-Object { $_.Name -ne "docker-compose.yml" } | ForEach-Object { $_.Name }) -join ", "
    Fail-Verifier "second hand-maintained production compose detected under deployments/production/: $extra (adding one must FAIL)"
} else {
    Pass-Verifier "no second production compose under deployments/production/"
}

# ── 4. Legacy compose inventory closed (PR2) ──────────────────────────────
# hub-server/deployments/ now holds build inputs only (Dockerfile,
# docker-entrypoint.sh, README.md). Any compose file there is a legacy
# resurrection and must FAIL.
$legacyComposes = @(Get-ChildItem -LiteralPath $LegacyDeployDir -Recurse -Filter "docker-compose*.yml" -File -ErrorAction SilentlyContinue)
if ($legacyComposes.Count -gt 0) {
    $found = ($legacyComposes | ForEach-Object { [IO.Path]::GetRelativePath($RepoRootPath, $_.FullName).Replace("\", "/") }) -join ", "
    Fail-Verifier "legacy compose inventory closed: compose files must not appear under hub-server/deployments/ (found: $found)"
} else {
    Pass-Verifier "legacy compose inventory closed (no compose files under hub-server/deployments/)"
}

if ($script:Failed -gt 0) {
    Write-Host "Deployment shape verifier FAILED ($($script:Failed) issue(s))." -ForegroundColor Red
    exit 1
}
Write-Host "Deployment shape verifier PASS." -ForegroundColor Green
exit 0
