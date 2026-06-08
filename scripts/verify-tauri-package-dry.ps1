param(
    [string]$RepoRoot = ".",
    [string]$ArtifactsRoot = ".tmp\tauri-package-dry",
    [switch]$SkipInstall,
    [switch]$SkipExecutableCompile,
    [switch]$RunWindowsBundle,
    [switch]$RequireUpdaterMetadata,
    [switch]$StrictToolchain
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path
$ArtifactsRoot = if ([System.IO.Path]::IsPathRooted($ArtifactsRoot)) {
    $ArtifactsRoot
} else {
    Join-Path $RepoRoot $ArtifactsRoot
}

function Step([string]$Message) { Write-Host "`n>>> $Message" -ForegroundColor Cyan }
function Pass([string]$Message) { Write-Host "PASS: $Message" -ForegroundColor Green }
function Fail([string]$Message) {
    Write-Host "FAIL: $Message" -ForegroundColor Red
    exit 1
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Fail $Message }
    Pass $Message
}

function Read-Json([string]$RelativePath) {
    Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Read-Text([string]$RelativePath) {
    Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8
}

function Invoke-Checked {
    param(
        [string]$Label,
        [string]$WorkingDirectory,
        [string]$Command,
        [string[]]$Arguments = @(),
        [hashtable]$Environment = @{}
    )

    Step $Label
    $oldValues = @{}
    foreach ($key in $Environment.Keys) {
        $oldValues[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
        [Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], "Process")
    }

    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
        foreach ($key in $Environment.Keys) {
            [Environment]::SetEnvironmentVariable($key, $oldValues[$key], "Process")
        }
    }

    if ($exitCode -ne 0) { Fail "$Label failed with exit code $exitCode" }
    Pass "$Label completed"
}

function Assert-UnderRepo {
    param([string]$Path, [string]$Label)
    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
    $repoFull = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd([char[]]@('\', '/'))
    $repoChildPrefix = $repoFull + [System.IO.Path]::DirectorySeparatorChar
    Assert-True ($full.StartsWith($repoChildPrefix, [System.StringComparison]::OrdinalIgnoreCase)) "$Label stays inside repo worktree"
    return $full
}

function Reset-ArtifactRoot {
    $full = Assert-UnderRepo $ArtifactsRoot "dry artifact root"
    if (Test-Path -LiteralPath $full) {
        Remove-Item -LiteralPath $full -Recurse -Force
    }
    New-Item -ItemType Directory $full -Force | Out-Null
    return $full
}

function Add-ArtifactManifest {
    param([string]$Root)
    $entries = @(Get-ChildItem $Root -File |
        Sort-Object Name |
        ForEach-Object {
            [pscustomobject]@{
                name = $_.Name
                bytes = $_.Length
                sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
            }
        })

    $entries | ConvertTo-Json -Depth 4 | Out-File (Join-Path $Root "artifact-manifest.json") -Encoding UTF8
}

function Assert-SidecarSqlitePolicy {
    Step "Packaged Local Edge SQLite app-data policy"
    $edgeManager = Read-Text "app\desktop\src-tauri\src\edge_manager.rs"
    $commands = Read-Text "app\desktop\src-tauri\src\commands.rs"
    $desktopPlatformTest = Read-Text "app\desktop\src\platform\desktopPlatform.test.ts"

    Assert-True ($edgeManager -match 'EDGE_STORE_DB_FILE_NAME:\s*&str\s*=\s*"agenthub-edge\.sqlite"') "Edge manager pins the SQLite db filename"
    Assert-True ($edgeManager -match '<app-data>/agenthub-edge\.sqlite') "Readiness exposes only the app-data SQLite placeholder"
    Assert-True ($edgeManager -match '--store-backend' -and $edgeManager -match '"sqlite"' -and $edgeManager -match '--store-db') "Sidecar launch args use explicit sqlite store backend and db path"
    Assert-True ($edgeManager -match 'app_data_dir\(\)' -and $edgeManager -match 'edge_store_db_path') "Packaged sidecar resolves store db under Tauri app data"
    Assert-True ($commands -match 'get_edge_host_readiness' -and $commands -match 'edge_host_readiness_snapshot') "Tauri command exposes readiness without process-spawn inputs"
    Assert-True ($desktopPlatformTest -match 'direct_cli_spawn:\s*false' -and $desktopPlatformTest -match '<app-data>/agenthub-edge\.sqlite') "Desktop platform test preserves no direct CLI spawn and app-data SQLite policy"
}

$artifactRoot = Reset-ArtifactRoot
$desktopPackage = Read-Json "app\desktop\package.json"
$desktopVersion = [string]$desktopPackage.version
$report = [ordered]@{
    mode = "windows-desktop-package-dry"
    version = $desktopVersion
    repoRoot = $RepoRoot
    artifactRoot = $artifactRoot
    signing = "out-of-scope"
    notarization = "out-of-scope"
    stapling = "out-of-scope"
    releaseUpload = "out-of-scope"
    realTokenDanceId = "out-of-scope"
    realCliOrModelExecution = "out-of-scope"
    stages = [ordered]@{}
}

Step "Static package readiness gates"
& (Join-Path $RepoRoot "scripts\verify-tauri-package-readiness.ps1") -RepoRoot $RepoRoot
if ($LASTEXITCODE -ne 0) { Fail "static package readiness failed" }
$report.stages.staticReadiness = "passed"

& (Join-Path $RepoRoot "scripts\verify-tauri-installer-smoke.ps1") -RepoRoot $RepoRoot -StrictToolchain:$StrictToolchain
if ($LASTEXITCODE -ne 0) { Fail "installer smoke preflight failed" }
$report.stages.installerSmoke = "passed"

Assert-SidecarSqlitePolicy
$report.stages.sqliteAppDataPolicy = "passed"

if (-not $SkipInstall) {
    Invoke-Checked "Install app dependencies from lockfile" (Join-Path $RepoRoot "app") "corepack.cmd" @("pnpm", "install", "--frozen-lockfile") @{ CI = "true" }
    $report.stages.dependencyInstall = "passed"
} else {
    $report.stages.dependencyInstall = "skipped"
}

Invoke-Checked "Build Windows Local Edge sidecar" (Join-Path $RepoRoot "edge-server") "go" @("build", "-ldflags=-s -w", "-o", "..\dist\agenthub-edge-windows-amd64.exe", ".\cmd\agenthub-edge\") @{
    GOOS = "windows"
    GOARCH = "amd64"
    CGO_ENABLED = "0"
}
$sidecarIntermediate = Join-Path $RepoRoot "dist\agenthub-edge-windows-amd64.exe"
Assert-True (Test-Path -LiteralPath $sidecarIntermediate) "Windows Local Edge sidecar intermediate exists"
Copy-Item -LiteralPath $sidecarIntermediate -Destination (Join-Path $artifactRoot "agenthub-edge-windows-amd64.exe") -Force

Step "Prepare Tauri external sidecar"
$tauriSidecarDir = Join-Path $RepoRoot "app\desktop\src-tauri\binaries"
New-Item -ItemType Directory $tauriSidecarDir -Force | Out-Null
$tauriSidecar = Join-Path $tauriSidecarDir "agenthub-edge-x86_64-pc-windows-msvc.exe"
Copy-Item -LiteralPath $sidecarIntermediate -Destination $tauriSidecar -Force
Assert-True (Test-Path -LiteralPath $tauriSidecar) "Tauri external sidecar exists at Windows target triple path"
$report.stages.sidecar = "passed"

if (-not $SkipExecutableCompile) {
    Invoke-Checked "Build Tauri executable without bundling" (Join-Path $RepoRoot "app\desktop") "corepack.cmd" @("pnpm", "tauri", "build", "--no-bundle")
    $desktopExe = Join-Path $RepoRoot "app\desktop\src-tauri\target\release\agenthub-desktop.exe"
    Assert-True (Test-Path -LiteralPath $desktopExe) "Tauri executable compile artifact exists"
    Copy-Item -LiteralPath $desktopExe -Destination (Join-Path $artifactRoot "agenthub-desktop.exe") -Force
    $report.stages.executableCompile = "passed"
} else {
    $report.stages.executableCompile = "skipped"
}

if ($RunWindowsBundle) {
    Invoke-Checked "Build unsigned Tauri Windows NSIS package" (Join-Path $RepoRoot "app\desktop") "corepack.cmd" @("pnpm", "tauri", "build")

    $nsis = Get-ChildItem (Join-Path $RepoRoot "app\desktop\src-tauri\target\release\bundle\nsis") -Filter "*setup.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    Assert-True ($null -ne $nsis) "NSIS setup.exe artifact exists"
    Copy-Item $nsis.FullName (Join-Path $artifactRoot "AgentHub_${desktopVersion}_x64-setup.exe") -Force
    $report.stages.nsisPackage = "passed"

    $portableDir = Join-Path $artifactRoot "AgentHub-portable"
    New-Item -ItemType Directory $portableDir -Force | Out-Null
    Copy-Item (Join-Path $RepoRoot "app\desktop\src-tauri\target\release\agenthub-desktop.exe") (Join-Path $portableDir "AgentHub.exe") -Force
    Copy-Item $sidecarIntermediate (Join-Path $portableDir "agenthub-edge.exe") -Force
    @"
AgentHub v$desktopVersion portable dry package.

Internal dry-run artifact only. This is not a signed public release.
"@ | Out-File (Join-Path $portableDir "README.txt") -Encoding UTF8
    Compress-Archive -Path (Join-Path $portableDir "*") -DestinationPath (Join-Path $artifactRoot "AgentHub_${desktopVersion}_x64-portable.zip") -Force
    $report.stages.portablePackage = "passed"

    $latestJson = Get-ChildItem (Join-Path $RepoRoot "app\desktop\src-tauri\target\release\bundle") -Filter "latest.json" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
    $signature = Get-ChildItem (Join-Path $RepoRoot "app\desktop\src-tauri\target\release\bundle") -Filter "*.sig" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1

    if ($latestJson -and $signature) {
        Copy-Item $latestJson.FullName (Join-Path $artifactRoot "latest.json") -Force
        Copy-Item $signature.FullName (Join-Path $artifactRoot "AgentHub_${desktopVersion}_x64-setup.exe.sig") -Force
        & (Join-Path $RepoRoot "scripts\verify-tauri-package-readiness.ps1") -RepoRoot $RepoRoot -BuiltArtifactsRoot $artifactRoot -RequireBuiltArtifacts
        if ($LASTEXITCODE -ne 0) { Fail "built artifact updater metadata gate failed" }
        $report.stages.updaterMetadata = "passed"
    } else {
        $report.stages.updaterMetadata = "not_produced_unsigned_build"
        if ($RequireUpdaterMetadata) {
            Fail "updater metadata was required but latest.json/.sig were not produced by the unsigned local build"
        }
        Write-Host "INFO: unsigned local Tauri bundle did not produce latest.json/.sig; updater metadata remains a signing/release gate." -ForegroundColor Yellow
    }
} else {
    $report.stages.nsisPackage = "skipped"
    $report.stages.portablePackage = "skipped"
    $report.stages.updaterMetadata = "skipped"
}

$report.stages.macosUnsignedDry = "policy_only"
$report | ConvertTo-Json -Depth 8 | Out-File (Join-Path $artifactRoot "package-dry-report.json") -Encoding UTF8
Add-ArtifactManifest $artifactRoot

Write-Host "`nTauri package dry gate OK" -ForegroundColor Green
Write-Host "Artifacts: $artifactRoot"
