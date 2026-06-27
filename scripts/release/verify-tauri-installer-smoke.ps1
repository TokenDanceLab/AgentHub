param(
    [string]$RepoRoot = ".",
    [switch]$StrictToolchain
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

function Assert-Path {
    param(
        [string]$RelativePath,
        [string]$Label
    )

    $path = Join-Path $RepoRoot $RelativePath
    Assert-True (Test-Path -LiteralPath $path) "$Label exists ($RelativePath)"
}

function Assert-GitIgnored {
    param(
        [string]$RelativePath,
        [string]$Label
    )

    & git -C $RepoRoot check-ignore -q -- $RelativePath
    if ($LASTEXITCODE -ne 0) {
        Fail "$Label is not ignored by Git: $RelativePath"
    }
    Pass "$Label is ignored by Git ($RelativePath)"
}

function Assert-Command {
    param(
        [string]$Command,
        [string]$Label
    )

    $resolved = Get-Command $Command -ErrorAction SilentlyContinue
    Assert-True ($null -ne $resolved) "$Label command is available ($Command)"
}

function Read-Json([string]$RelativePath) {
    return Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Assert-PackageScript {
    param(
        [pscustomobject]$Package,
        [string]$Name,
        [string]$ExpectedPattern
    )

    $value = [string]$Package.scripts.$Name
    Assert-True (-not [string]::IsNullOrWhiteSpace($value)) "desktop package defines '$Name' script"
    Assert-True ($value -match $ExpectedPattern) "desktop '$Name' script matches installer preflight expectation"
}

Step "Baseline package readiness policy"
& (Join-Path $RepoRoot "scripts\verify-tauri-package-readiness.ps1") -RepoRoot $RepoRoot
if ($LASTEXITCODE -ne 0) {
    Fail "baseline Tauri package readiness policy failed"
}

Step "Windows installer dry preflight inputs"
$rootPackage = Read-Json "app\package.json"
$desktopPackage = Read-Json "app\desktop\package.json"
$tauri = Read-Json "app\desktop\src-tauri\tauri.conf.json"

Assert-True ([string]$rootPackage.packageManager -match "^pnpm@10\.") "workspace pins pnpm 10 for release-readiness parity"
Assert-Path "app\pnpm-lock.yaml" "workspace pnpm lockfile"
Assert-Path "app\pnpm-workspace.yaml" "workspace pnpm workspace file"
Assert-PackageScript $desktopPackage "build" "vite build"
Assert-PackageScript $desktopPackage "tauri" "\btauri\b"
Assert-True ([string]$tauri.build.beforeBuildCommand -match "pnpm build") "Tauri beforeBuildCommand runs the desktop frontend build"
Assert-True ([string]$tauri.build.frontendDist -eq "../dist") "Tauri frontendDist points at desktop dist"

Step "Windows sidecar dry preflight"
Assert-Path "edge-server\cmd\agenthub-edge\main.go" "Edge sidecar entrypoint"
Assert-True (@($tauri.bundle.externalBin) -contains "binaries/agenthub-edge") "Tauri externalBin keeps the sidecar basename"
Assert-GitIgnored "dist/agenthub-edge-windows-amd64.exe" "Windows sidecar dry intermediate"
Assert-GitIgnored "app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe" "Windows Tauri sidecar target"

Step "Installer asset and output preflight"
foreach ($iconPath in @($tauri.bundle.icon)) {
    Assert-Path (Join-Path "app\desktop\src-tauri" ([string]$iconPath)) "Tauri bundle icon asset"
}
Assert-Path "app\desktop\src-tauri\icons\installer-header.bmp" "NSIS header bitmap"
Assert-Path "app\desktop\src-tauri\icons\installer-sidebar.bmp" "NSIS sidebar bitmap"

$desktopVersion = [string]$desktopPackage.version
Assert-GitIgnored "dist/AgentHub_${desktopVersion}_x64-setup.exe" "Windows NSIS setup output"
Assert-GitIgnored "dist/AgentHub_${desktopVersion}_x64-portable.zip" "Windows portable zip output"
Assert-GitIgnored "dist/AgentHub-portable/AgentHub.exe" "Windows portable staging app"
Assert-GitIgnored "dist/AgentHub-portable/agenthub-edge.exe" "Windows portable staging sidecar"
Assert-GitIgnored "app/desktop/src-tauri/target/release/bundle/nsis/AgentHub_${desktopVersion}_x64-setup.exe" "Tauri NSIS target output"

Step "Toolchain availability"
if ($StrictToolchain) {
    foreach ($tool in @(
        @{ Command = "git"; Label = "Git" },
        @{ Command = "node"; Label = "Node.js" },
        @{ Command = "pnpm"; Label = "pnpm" },
        @{ Command = "go"; Label = "Go" },
        @{ Command = "cargo"; Label = "Cargo" },
        @{ Command = "rustc"; Label = "Rust compiler" }
    )) {
        Assert-Command $tool.Command $tool.Label
    }
} else {
    Write-Host "SKIP: strict toolchain command checks not requested" -ForegroundColor Yellow
}

Step "Build boundary"
if ($env:TAURI_SIGNING_PRIVATE_KEY) {
    Write-Host "INFO: TAURI_SIGNING_PRIVATE_KEY is present in the environment but is not read by this smoke preflight."
} else {
    Write-Host "INFO: TAURI_SIGNING_PRIVATE_KEY is not set and is not required by this smoke preflight."
}
Write-Host "INFO: Windows sidecar command remains GOOS=windows GOARCH=amd64 go build ./cmd/agenthub-edge/."
Write-Host "INFO: This smoke does not run dependency installation, the full Tauri bundle build, Authenticode signing, GitHub Release creation, macOS codesign, notarization, or stapling."
Write-Host "INFO: macOS compatibility remains a policy note only: future unsigned arm64 dry validation should check agenthub-edge-aarch64-apple-darwin on macos-latest."

Write-Host "`nTauri installer smoke preflight OK" -ForegroundColor Green
