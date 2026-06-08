param(
    [string]$RepoRoot = ".",
    [string]$BuiltArtifactsRoot = "",
    [switch]$RequireBuiltArtifacts
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path

function Step([string]$Message) {
    Write-Host "`n>>> $Message" -ForegroundColor Cyan
}

function Pass([string]$Message) {
    Write-Host "PASS: $Message" -ForegroundColor Green
}

function Fail([string]$Message) {
    Write-Host "FAIL: $Message" -ForegroundColor Red
    exit 1
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        Fail $Message
    }
    Pass $Message
}

function Read-Json([string]$RelativePath) {
    $path = Join-Path $RepoRoot $RelativePath
    return Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Read-Text([string]$RelativePath) {
    return Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8
}

function Get-CargoVersion([string]$RelativePath) {
    $text = Read-Text $RelativePath
    $match = [regex]::Match($text, '(?m)^version\s*=\s*"(?<version>[^"]+)"')
    if (-not $match.Success) {
        Fail "Cargo.toml package version is missing"
    }
    return $match.Groups["version"].Value
}

function Get-CargoLockPackageVersion([string]$RelativePath, [string]$PackageName) {
    $text = Read-Text $RelativePath
    $escapedName = [regex]::Escape($PackageName)
    $pattern = "(?ms)^\[\[package\]\]\s*\r?\nname\s*=\s*`"$escapedName`"\s*\r?\nversion\s*=\s*`"(?<version>[^`"]+)`""
    $match = [regex]::Match($text, $pattern)
    if (-not $match.Success) {
        Fail "Cargo.lock package version is missing for $PackageName"
    }
    return $match.Groups["version"].Value
}

function Has-Target($Targets, [string]$Expected) {
    if ($Targets -is [string]) {
        return $Targets -eq $Expected
    }

    foreach ($target in @($Targets)) {
        if ([string]$target -eq $Expected) {
            return $true
        }
    }

    return $false
}

function Assert-Artifact([string]$Root, [string]$Pattern, [string]$Label) {
    $item = Get-ChildItem $Root -Filter $Pattern -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
    Assert-True ($null -ne $item) "$Label artifact exists ($Pattern)"
}

Step "Desktop version metadata"
$package = Read-Json "app\desktop\package.json"
$tauri = Read-Json "app\desktop\src-tauri\tauri.conf.json"
$cargoVersion = Get-CargoVersion "app\desktop\src-tauri\Cargo.toml"
$cargoLockVersion = Get-CargoLockPackageVersion "app\desktop\src-tauri\Cargo.lock" "agenthub-desktop"

Assert-True ($package.version -eq $tauri.version) "package.json and tauri.conf.json versions match ($($package.version))"
Assert-True ($cargoVersion -eq $tauri.version) "Cargo.toml and tauri.conf.json versions match ($cargoVersion)"
Assert-True ($cargoLockVersion -eq $tauri.version) "Cargo.lock and tauri.conf.json versions match ($cargoLockVersion)"
Assert-True ($tauri.identifier -eq "com.agenthub.desktop") "Desktop Tauri identifier is stable"
Assert-True ($tauri.productName -eq "AgentHub") "Desktop product name is stable"

Step "Windows package policy"
Assert-True ($tauri.bundle.active -eq $true) "Tauri bundle is active"
Assert-True (Has-Target $tauri.bundle.targets "nsis") "Tauri bundle targets Windows NSIS"
Assert-True (-not (Has-Target $tauri.bundle.targets "all")) "Tauri bundle does not use broad all targets for internal package readiness"
Assert-True (@($tauri.bundle.externalBin) -contains "binaries/agenthub-edge") "Tauri config declares edge-server sidecar basename"
Assert-True ($tauri.bundle.windows.nsis.installMode -eq "currentUser") "NSIS installer uses currentUser install mode"

$releaseWorkflowText = Read-Text ".github\workflows\release.yml"
$readinessWorkflowText = Read-Text ".github\workflows\release-readiness.yml"
Assert-True ($readinessWorkflowText -match "agenthub-edge-x86_64-pc-windows-msvc\.exe") "release readiness workflow prepares Windows sidecar agenthub-edge-x86_64-pc-windows-msvc.exe"
Assert-True ($readinessWorkflowText -match "AgentHub_\$\{ver\}_x64-portable\.zip" -or $readinessWorkflowText -match "portable\.zip") "release readiness workflow names portable.zip artifact"
Assert-True ($readinessWorkflowText -match "setup\.exe") "release readiness workflow collects NSIS setup.exe"

Step "Updater metadata policy"
Assert-True ($tauri.plugins.updater.active -eq $true) "Tauri updater plugin is active"
$updaterLatestEndpoints = @($tauri.plugins.updater.endpoints) -match "latest\.json"
Assert-True ($updaterLatestEndpoints.Count -gt 0) "Updater endpoint points at latest.json metadata"
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$tauri.plugins.updater.pubkey)) "Updater public key is configured"
Assert-True ($readinessWorkflowText -match "latest\.json") "release readiness workflow checks latest.json"
Assert-True ($readinessWorkflowText -match "\.sig") "release readiness workflow checks updater signature .sig"

Step "Tag release policy"
Assert-True ($releaseWorkflowText -match "(?ms)on:\s*\r?\n\s*push:\s*\r?\n\s*tags:") "release workflow keeps tag push trigger"
Assert-True ($releaseWorkflowText -match "softprops/action-gh-release") "release workflow keeps GitHub Release creation"
Assert-True ($releaseWorkflowText -match "TAURI_SIGNING_PRIVATE_KEY") "release workflow keeps production Tauri signing secret boundary"

Step "Dry release policy"
Assert-True ($readinessWorkflowText -match "workflow_dispatch") "release readiness workflow is manually runnable"
Assert-True ($readinessWorkflowText -match "\.github/workflows/release\.yml") "release readiness workflow watches release.yml"
Assert-True ($readinessWorkflowText -match "app/desktop/src-tauri/Cargo\.lock") "release readiness workflow watches Cargo.lock"
Assert-True ($readinessWorkflowText -notmatch "softprops/action-gh-release") "release readiness workflow does not create GitHub releases"
Assert-True ($readinessWorkflowText -notmatch "gh release upload") "release readiness workflow does not upload release assets"
Assert-True ($readinessWorkflowText -notmatch "TAURI_SIGNING_PRIVATE_KEY") "release readiness workflow does not require production signing secrets"
Assert-True ($readinessWorkflowText -match "verify-tauri-package-readiness\.ps1") "release readiness workflow runs this checker"

Step "macOS policy note boundary"
Assert-True ($readinessWorkflowText -match "macOS unsigned package policy note") "release readiness workflow names macOS step as a policy note"
Assert-True ($readinessWorkflowText -match "aarch64-apple-darwin") "release readiness workflow documents the future macOS arm64 validation path"
Assert-True ($readinessWorkflowText -match "unsigned") "release readiness workflow labels macOS policy as unsigned"
Assert-True ($readinessWorkflowText -notmatch "xcrun\s+notarytool|codesign\s+--sign|stapler\s+staple") "release readiness workflow does not run macOS signing, notarization, or stapling commands"

if ($RequireBuiltArtifacts) {
    Step "Built artifact gate"
    if ([string]::IsNullOrWhiteSpace($BuiltArtifactsRoot)) {
        Fail "BuiltArtifactsRoot is required when -RequireBuiltArtifacts is set"
    }
    if (-not (Test-Path $BuiltArtifactsRoot)) {
        Fail "Built artifacts root not found: $BuiltArtifactsRoot; expected latest.json, setup.exe, portable.zip, and .sig"
    }

    $artifactRoot = (Resolve-Path $BuiltArtifactsRoot).Path
    Assert-Artifact $artifactRoot "*setup.exe" "NSIS setup.exe"
    Assert-Artifact $artifactRoot "*portable.zip" "Windows portable.zip"
    Assert-Artifact $artifactRoot "latest.json" "Updater latest.json"
    Assert-Artifact $artifactRoot "*.sig" "Updater signature .sig"
}

Write-Host "`nTauri package readiness policy OK" -ForegroundColor Green
