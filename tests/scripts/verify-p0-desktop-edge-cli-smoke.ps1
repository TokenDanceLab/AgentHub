param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message,
        [string]$Details = ""
    )

    if (-not $Condition) {
        Write-Host "FAIL: $Message" -ForegroundColor Red
        if ($Details) { Write-Host $Details }
        exit 1
    }

    Write-Host "PASS: $Message" -ForegroundColor Green
}

function Read-Text([string]$RelativePath) {
    Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-p0-desktop-edge-cli-smoke.ps1"
$scriptImplementationPath = Join-Path $RepoRoot "scripts\smoke\verify-p0-desktop-edge-cli-smoke.ps1"
Assert-True (Test-Path -LiteralPath $scriptPath -PathType Leaf) "P0 Desktop/Edge/CLI smoke gate exists"
Assert-True (Test-Path -LiteralPath $scriptImplementationPath -PathType Leaf) "P0 Desktop/Edge/CLI smoke gate implementation exists"

$scriptText = Read-Text "scripts\smoke\verify-p0-desktop-edge-cli-smoke.ps1"
Assert-True ($scriptText -match "prepare-tauri-sidecar-local\.ps1" -and $scriptText -match "verify-tauri-sidecar-binary-smoke\.ps1") "smoke prepares and verifies the Tauri Local Edge sidecar"
Assert-True ($scriptText -match "/v1/health" -and $scriptText -match "agenthub-edge-x86_64-pc-windows-msvc\.exe") "smoke starts the bundled Local Edge sidecar and probes health"
Assert-True ($scriptText -match "--version" -and $scriptText -match "no-spend version probe only") "smoke limits real CLI discovery to a no-spend version probe"
Assert-True ($scriptText -match 'model_run_submitted\s*=\s*\$false' -and $scriptText -match 'real_model_tested\s*=\s*\$false') "smoke records that no model run is submitted"
Assert-True ($scriptText -match 'tokendance_id_login\s*=\s*\$false' -and $scriptText -match "no TokenDanceID login") "smoke records that no TokenDanceID login is attempted"
Assert-True ($scriptText -match "SecretLikePattern" -and $scriptText -match "Redact") "smoke includes secret-like input checks and output redaction"
Assert-True ($scriptText -match "smoke-result\.json" -and $scriptText -match "agenthub-p0-desktop-edge-cli-smoke-v1") "smoke writes a readiness evidence manifest"
Assert-True ($scriptText -match "Join-NativeArguments" -and $scriptText -match '\$psi\.Arguments') "smoke uses explicit native argument quoting for managed processes"

$repoParent = Split-Path $RepoRoot -Parent
$repoLeaf = Split-Path $RepoRoot -Leaf
$siblingRoot = Join-Path $repoParent "$repoLeaf-sibling-$([Guid]::NewGuid().ToString('N'))"
$siblingArtifactRoot = Join-Path $siblingRoot "delete-me"
$siblingSentinel = Join-Path $siblingArtifactRoot "sentinel.txt"
New-Item -ItemType Directory $siblingArtifactRoot -Force | Out-Null
"must-not-delete" | Out-File $siblingSentinel -Encoding UTF8
try {
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -RepoRoot $RepoRoot -ArtifactRoot $siblingArtifactRoot -SkipSidecarBuild -SkipDesktopDev 2>&1 | Out-String
    Assert-True ($LASTEXITCODE -ne 0) "smoke rejects sibling absolute artifact root" $output
    Assert-True (Test-Path -LiteralPath $siblingSentinel) "smoke does not delete sibling artifact root contents"
    Assert-True ($output -match "ArtifactRoot must stay under") "sibling rejection names artifact containment boundary" $output
}
finally {
    if (Test-Path -LiteralPath $siblingRoot) {
        Remove-Item -LiteralPath $siblingRoot -Recurse -Force
    }
}

Write-Host "`nP0 Desktop/Edge/CLI smoke script tests OK" -ForegroundColor Green
