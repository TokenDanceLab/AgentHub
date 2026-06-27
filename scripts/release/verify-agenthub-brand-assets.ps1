$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$requiredFiles = @(
  "app/desktop/src/assets/agenthub-icon-rounded.svg",
  "app/web/public/agenthub-icon-rounded-32.png",
  "app/web/public/agenthub-icon-rounded-192.png",
  "app/web/public/agenthub-icon-rounded-512.png",
  "app/desktop/src-tauri/icons/agenthub-icon-rounded-32.png",
  "app/desktop/src-tauri/icons/agenthub-icon-rounded-128.png",
  "app/desktop/src-tauri/icons/agenthub-icon-rounded-256.png",
  "app/desktop/src-tauri/icons/agenthub-icon-rounded-512.png",
  "app/desktop/src-tauri/icons/agenthub-icon-rounded.ico"
)

$missing = @()
foreach ($relativePath in $requiredFiles) {
  $path = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $path)) {
    $missing += $relativePath
  }
}

if ($missing.Count -gt 0) {
  throw "Missing AgentHub brand asset files: $($missing -join ', ')"
}

$webManifestPath = Join-Path $repoRoot "app/web/public/manifest.json"
$webManifest = Get-Content -Raw -LiteralPath $webManifestPath | ConvertFrom-Json
$manifestIconSources = @($webManifest.icons | ForEach-Object { $_.src })
$expectedManifestIcons = @("/agenthub-icon-rounded-192.png", "/agenthub-icon-rounded-512.png")
$manifestMissing = @($expectedManifestIcons | Where-Object { $manifestIconSources -notcontains $_ })
if ($manifestMissing.Count -gt 0) {
  throw "Web manifest is missing AgentHub icons: $($manifestMissing -join ', ')"
}

$webIndex = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "app/web/index.html")
if ($webIndex -notmatch 'href="/agenthub-icon-rounded-32\.png"') {
  throw "Web index is missing AgentHub favicon"
}
if ($webIndex -notmatch 'href="/agenthub-icon-rounded-192\.png"') {
  throw "Web index is missing AgentHub apple-touch-icon"
}

$tauriConfigPath = Join-Path $repoRoot "app/desktop/src-tauri/tauri.conf.json"
$tauriConfig = Get-Content -Raw -LiteralPath $tauriConfigPath | ConvertFrom-Json
$tauriIcons = @($tauriConfig.bundle.icon)
$expectedTauriIcons = @(
  "icons/agenthub-icon-rounded-32.png",
  "icons/agenthub-icon-rounded-128.png",
  "icons/agenthub-icon-rounded-256.png",
  "icons/agenthub-icon-rounded.ico"
)
$tauriMissing = @($expectedTauriIcons | Where-Object { $tauriIcons -notcontains $_ })
if ($tauriMissing.Count -gt 0) {
  throw "Desktop bundle config is missing AgentHub icons: $($tauriMissing -join ', ')"
}
if ($tauriConfig.bundle.windows.nsis.installerIcon -ne "icons/agenthub-icon-rounded.ico") {
  throw "Desktop NSIS installer icon is not the AgentHub icon"
}

$checkedFiles = @(
  "app/web/index.html",
  "app/web/public/manifest.json",
  "app/desktop/src/components/DesktopChrome.tsx",
  "app/desktop/src-tauri/tauri.conf.json"
)
$legacyPattern = "tokendance-icon-rounded|TokenDance-icon-rounded|token-dance-icon|token-dance-mark"
$legacyHits = @()
foreach ($relativePath in $checkedFiles) {
  $content = Get-Content -Raw -LiteralPath (Join-Path $repoRoot $relativePath)
  if ($content -match $legacyPattern) {
    $legacyHits += $relativePath
  }
}
if ($legacyHits.Count -gt 0) {
  throw "Legacy TokenDance icon references remain in AgentHub Web/Desktop surfaces: $($legacyHits -join ', ')"
}

Write-Host "AgentHub brand assets verified."
