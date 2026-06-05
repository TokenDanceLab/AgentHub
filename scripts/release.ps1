<#
.SYNOPSIS
    AgentHub release builder — builds all binaries, packages, uploads to GitHub Release.
.DESCRIPTION
    One-command release pipeline:
      .\scripts\release.ps1 v0.1.1
    Creates clean worktree, builds Go + Tauri, uploads assets, cleans up.
.PARAMETER Version
    Release version tag (e.g. v0.1.1). Must be an existing git tag.
.PARAMETER SkipUpload
    Build but do not upload to GitHub.
.PARAMETER KeepWorktree
    Keep the build worktree for debugging.
#>
param(
    [Parameter(Mandatory=$true)]
    [string]$Version,
    [switch]$SkipUpload,
    [switch]$KeepWorktree
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$WorktreePath = "$RepoRoot\.worktrees\release-$Version"
$DistPath = "$WorktreePath\dist"
$DesktopDir = "$WorktreePath\app\desktop"

function Write-Step($Text) {
    Write-Host "`n>>> $Text" -ForegroundColor Cyan
}

# ── Validate ──
Write-Step "Validate tag $Version"
Push-Location $RepoRoot
$tagExists = git tag -l $Version
if (-not $tagExists) {
    Write-Host "ERROR: Tag $Version not found. Create it first: git tag -a $Version -m '...'; git push origin $Version" -ForegroundColor Red
    exit 1
}

# ── Worktree ──
Write-Step "Create build worktree"
if (Test-Path $WorktreePath) { Remove-Item -Recurse -Force $WorktreePath }
git worktree add $WorktreePath $Version *>$null
New-Item -ItemType Directory $DistPath -Force *>$null

# ── Go: Edge Server ──
Write-Step "Build Edge Server (Linux)"
Push-Location "$WorktreePath\edge-server"
$env:GOOS='linux'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'
go build -ldflags="-s -w" -o "$DistPath\agenthub-edge-linux-amd64" .\cmd\agenthub-edge\
if ($LASTEXITCODE -ne 0) { throw "Edge Linux build failed" }

Write-Step "Build Edge Server (Windows)"
$env:GOOS='windows'; $env:GOARCH='amd64'
go build -ldflags="-s -w" -o "$DistPath\agenthub-edge-windows-amd64.exe" .\cmd\agenthub-edge\
if ($LASTEXITCODE -ne 0) { throw "Edge Windows build failed" }
Pop-Location

# ── Go: Hub Server ──
Write-Step "Build Hub Server (Linux)"
Push-Location "$WorktreePath\hub-server"
$env:GOOS='linux'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'
go build -ldflags="-s -w" -o "$DistPath\agenthub-hub-linux-amd64" .\cmd\server-hub\
if ($LASTEXITCODE -ne 0) { throw "Hub build failed" }
Pop-Location

# ── Prepare edge-server sidecar for Tauri bundling ──
Write-Step "Prepare edge-server sidecar"
$BinariesDir = Join-Path $DesktopDir "src-tauri\binaries"
New-Item -ItemType Directory -Path $BinariesDir -Force | Out-Null
$EdgeExe = Get-ChildItem "$DistPath\agenthub-edge-windows-amd64.exe" -ErrorAction SilentlyContinue
if ($EdgeExe) {
    Copy-Item $EdgeExe.FullName (Join-Path $BinariesDir "agenthub-edge-x86_64-pc-windows-msvc.exe")
    Write-Host "Sidecar binary prepared: agenthub-edge-x86_64-pc-windows-msvc.exe"
} else {
    Write-Warning "edge-server binary not found in dist/, sidecar will not be bundled"
}

# ── Tauri Desktop ──
Write-Step "Install Desktop dependencies"
Push-Location $DesktopDir
corepack.cmd pnpm install --frozen-lockfile *>$null
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

Write-Step "Build Desktop (NSIS + portable)"
# TAURI_SIGNING_PRIVATE_KEY env is picked up automatically by tauri build
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    Write-Warning "TAURI_SIGNING_PRIVATE_KEY not set — updater artifacts will not be signed"
}
corepack.cmd pnpm tauri build *>$null
if ($LASTEXITCODE -ne 0) { throw "Tauri build failed" }
Pop-Location

# ── Collect assets ──
$ver = $Version -replace '^v',''
$nsis = Get-ChildItem "$WorktreePath\app\desktop\src-tauri\target\release\bundle\nsis" -Filter "*setup.exe" | Select-Object -First 1
$exe  = Get-ChildItem "$WorktreePath\app\desktop\src-tauri\target\release" -Filter "agenthub-desktop.exe" | Select-Object -First 1

Copy-Item $nsis.FullName "$DistPath\AgentHub_${ver}_x64-setup.exe"

# Collect updater metadata
$latestJson = Get-ChildItem "$WorktreePath\app\desktop\src-tauri\target\release\bundle" -Filter "latest.json" -Recurse | Select-Object -First 1
if ($latestJson) {
    Copy-Item $latestJson.FullName "$DistPath\latest.json"
    Write-Host "  updater: latest.json collected" -ForegroundColor Green
}
$setupSig = Get-ChildItem "$WorktreePath\app\desktop\src-tauri\target\release\bundle" -Filter "*.sig" -Recurse | Select-Object -First 1
if ($setupSig) {
    Copy-Item $setupSig.FullName "$DistPath\AgentHub_${ver}_x64-setup.exe.sig"
    Write-Host "  updater: signature collected" -ForegroundColor Green
}

$portableDir = "$DistPath\AgentHub-portable"
New-Item -ItemType Directory $portableDir -Force *>$null
Copy-Item $exe.FullName "$portableDir\AgentHub.exe"
$edgeExe = Get-ChildItem "$DistPath\agenthub-edge-windows-amd64.exe" -ErrorAction SilentlyContinue
if ($edgeExe) { Copy-Item $edgeExe.FullName "$portableDir\agenthub-edge.exe" }
"AgentHub $Version`n`nNo installation required. Double-click AgentHub.exe to run.`nRequires: Windows 10/11 (WebView2 built-in).`n`nhttps://github.com/TokenDanceLab/AgentHub" | Out-File "$portableDir\README.txt" -Encoding UTF8
Compress-Archive -Path "$portableDir\*" -DestinationPath "$DistPath\AgentHub_${ver}_x64-portable.zip" -Force

# ── Report ──
Write-Step "Build complete"
Get-ChildItem $DistPath | ForEach-Object {
    $size = [math]::Round($_.Length/1MB, 2)
    Write-Host "  $($_.Name) — $size MB" -ForegroundColor Green
}

# ── Upload ──
if (-not $SkipUpload) {
    Write-Step "Upload to GitHub Release $Version"
    $assets = Get-ChildItem $DistPath -File | ForEach-Object { $_.FullName }
    gh release upload $Version $assets --clobber
    if ($LASTEXITCODE -ne 0) { throw "Upload failed" }
    Write-Host "  Release: https://github.com/TokenDanceLab/AgentHub/releases/tag/$Version" -ForegroundColor Green
}
else {
    Write-Host "  SkipUpload set — assets at: $DistPath" -ForegroundColor Yellow
}

# ── Cleanup ──
Pop-Location
Push-Location $RepoRoot
if (-not $KeepWorktree) {
    Write-Step "Clean up worktree"
    Remove-Item -Recurse -Force $WorktreePath
    git worktree prune *>$null
}
else {
    Write-Host "  Worktree kept at: $WorktreePath" -ForegroundColor Yellow
}

Write-Step "Done"
