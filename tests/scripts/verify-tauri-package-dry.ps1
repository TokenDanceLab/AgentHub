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

$scriptPath = Join-Path $RepoRoot "scripts\verify-tauri-package-dry.ps1"
Assert-True (Test-Path $scriptPath) "Tauri package dry gate exists"

$scriptText = Read-Text "scripts\verify-tauri-package-dry.ps1"
Assert-True ($scriptText -match "RunWindowsBundle" -and $scriptText -match "SkipExecutableCompile") "dry gate separates executable compile from full Windows bundle"
Assert-True ($scriptText -match "RequireUpdaterMetadata" -and $scriptText -match "not_produced_unsigned_build") "dry gate distinguishes updater metadata from unsigned package output"
Assert-True ($scriptText -match "macosUnsignedDry.*policy_only" -and $scriptText -match "signing.*out-of-scope") "dry gate keeps macOS/signing/release upload out of local proof"
Assert-True ($scriptText -match "agenthub-edge-x86_64-pc-windows-msvc\.exe" -and $scriptText -match "agenthub-edge-windows-amd64\.exe") "dry gate builds and places the bundled Local Edge sidecar"
Assert-True ($scriptText -match "agenthub-edge" -and $scriptText -match "<app-data>" -and $scriptText -match "--store-backend") "dry gate checks SQLite app-data sidecar policy"
Assert-True ($scriptText -match "AgentHub_\$\{desktopVersion\}_x64-setup\.exe" -and $scriptText -match "AgentHub_\$\{desktopVersion\}_x64-portable\.zip") "dry gate names NSIS and portable proof artifacts"
Assert-True ($scriptText -match "artifact-manifest\.json" -and $scriptText -match "package-dry-report\.json" -and $scriptText -match "Get-FileHash") "dry gate records report and artifact hashes"

$artifactRoot = Join-Path $RepoRoot ".tmp\test-tauri-package-dry"
if (Test-Path -LiteralPath $artifactRoot) {
    Remove-Item -LiteralPath $artifactRoot -Recurse -Force
}

$output = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -RepoRoot $RepoRoot -ArtifactsRoot $artifactRoot -SkipInstall -SkipExecutableCompile 2>&1 | Out-String
Assert-True ($LASTEXITCODE -eq 0) "dry gate lightweight mode passes" $output

$reportPath = Join-Path $artifactRoot "package-dry-report.json"
$manifestPath = Join-Path $artifactRoot "artifact-manifest.json"
Assert-True (Test-Path -LiteralPath $reportPath) "dry gate writes package-dry-report.json"
Assert-True (Test-Path -LiteralPath $manifestPath) "dry gate writes artifact-manifest.json"

$report = Get-Content $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-True ($report.stages.staticReadiness -eq "passed") "dry report records static readiness"
Assert-True ($report.stages.installerSmoke -eq "passed") "dry report records installer smoke preflight"
Assert-True ($report.stages.sqliteAppDataPolicy -eq "passed") "dry report records SQLite app-data policy"
Assert-True ($report.stages.sidecar -eq "passed") "dry report records bundled sidecar proof"
Assert-True ($report.stages.executableCompile -eq "skipped") "dry report can skip executable compile explicitly"
Assert-True ($report.stages.nsisPackage -eq "skipped") "dry report can skip NSIS proof explicitly"
Assert-True ($report.stages.updaterMetadata -eq "skipped") "dry report can skip updater metadata explicitly"
Assert-True ($report.stages.macosUnsignedDry -eq "policy_only") "dry report records macOS policy-only status"

$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$manifestEntries = @($manifest | ForEach-Object { $_ })
Assert-True (@($manifestEntries | Where-Object { $_.name -eq "agenthub-edge-windows-amd64.exe" }).Count -eq 1) "artifact manifest includes Windows sidecar"
Assert-True (@($manifestEntries | Where-Object { $_.sha256 -match "^[A-F0-9]{64}$" }).Count -gt 0) "artifact manifest records sha256 hashes"

Write-Host "`nTauri package dry script tests OK" -ForegroundColor Green
