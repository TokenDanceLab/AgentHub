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
        [string]$Message,
        [string]$Details = ""
    )

    if (-not $Condition) {
        Fail $Message
        if ($Details) {
            Write-Host $Details
        }
    }

    Pass $Message
}

function Read-Text([string]$RelativePath) {
    Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8
}

function Read-Json([string]$RelativePath) {
    Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8 | ConvertFrom-Json
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

function Assert-Artifact {
    param(
        [string]$Root,
        [string]$Pattern,
        [string]$Label
    )

    $item = Get-ChildItem $Root -Filter $Pattern -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
    Assert-True ($null -ne $item) "$Label exists ($Pattern)"
    return $item
}

function Assert-ZipContains {
    param(
        [System.IO.FileInfo]$ZipItem,
        [string]$EntryName,
        [string]$Label
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipItem.FullName)
    try {
        $entry = $zip.Entries | Where-Object {
            $_.FullName.Replace("\", "/").EndsWith($EntryName, [System.StringComparison]::OrdinalIgnoreCase)
        } | Select-Object -First 1
        Assert-True ($null -ne $entry) "$Label contains $EntryName"
    }
    finally {
        $zip.Dispose()
    }
}

function Assert-ArtifactManifestEntry {
    param(
        [object[]]$Manifest,
        [System.IO.FileInfo]$Artifact
    )

    $entry = $Manifest | Where-Object { [string]$_.name -eq $Artifact.Name } | Select-Object -First 1
    Assert-True ($null -ne $entry) "artifact-manifest.json includes $($Artifact.Name)"
    Assert-True ([int64]$entry.bytes -eq $Artifact.Length) "artifact-manifest.json bytes match $($Artifact.Name)"

    $hash = (Get-FileHash $Artifact.FullName -Algorithm SHA256).Hash
    Assert-True ([string]$entry.sha256 -eq $hash) "artifact-manifest.json sha256 matches $($Artifact.Name)"
}

Step "Desktop package metadata and installer boundary"
$package = Read-Json "app\desktop\package.json"
$tauri = Read-Json "app\desktop\src-tauri\tauri.conf.json"
$desktopVersion = [string]$package.version

Assert-True ($package.version -eq $tauri.version) "Desktop package.json and Tauri versions match ($desktopVersion)"
Assert-True ($tauri.identifier -eq "com.agenthub.desktop") "Desktop identifier remains com.agenthub.desktop"
Assert-True ($tauri.bundle.active -eq $true) "Tauri bundling is active"
Assert-True (@($tauri.bundle.targets) -contains "nsis") "Windows NSIS remains the unsigned package target"
Assert-True (-not (@($tauri.bundle.targets) -contains "all")) "Package target is not broad all"
Assert-True (@($tauri.bundle.externalBin) -contains "binaries/agenthub-edge") "Tauri externalBin declares the Local Edge sidecar basename"
Assert-True ($tauri.bundle.windows.nsis.installMode -eq "currentUser") "Windows installer is current-user scoped"

Assert-GitIgnored "app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe" "Windows bundled Local Edge sidecar"
Assert-GitIgnored "app/desktop/src-tauri/binaries/agenthub-edge-aarch64-apple-darwin" "macOS bundled Local Edge sidecar"
Assert-GitIgnored "app/desktop/src-tauri/target/release/bundle/nsis/AgentHub_${desktopVersion}_x64-setup.exe" "Windows NSIS setup output"
Assert-GitIgnored "dist/AgentHub_${desktopVersion}_x64-portable.zip" "Windows portable package output"

Step "Installed Local Edge sidecar runtime evidence"
$edgeManager = Read-Text "app\desktop\src-tauri\src\edge_manager.rs"
$commands = Read-Text "app\desktop\src-tauri\src\commands.rs"
$lib = Read-Text "app\desktop\src-tauri\src\lib.rs"
$desktopPlatform = Read-Text "app\desktop\src\platform\desktopPlatform.ts"
$desktopPlatformTest = Read-Text "app\desktop\src\platform\desktopPlatform.test.ts"

Assert-True ($edgeManager -match 'EDGE_SIDECAR_NAME:\s*&str\s*=\s*"agenthub-edge"') "Runtime uses the Tauri sidecar name agenthub-edge"
Assert-True ($edgeManager -match 'app_data_dir\(\)' -and $edgeManager -match 'edge_store_db_path') "Runtime resolves packaged Local Edge state under Tauri app data"
Assert-True ($edgeManager -match 'EDGE_STORE_DB_FILE_NAME:\s*&str\s*=\s*"agenthub-edge\.sqlite"') "Runtime pins the Local Edge SQLite filename"
Assert-True ($edgeManager -match '--store-backend' -and $edgeManager -match '"sqlite"' -and $edgeManager -match '--store-db') "Runtime launches Local Edge with explicit SQLite args"
Assert-True ($edgeManager -match 'edge-logs' -and $edgeManager -match 'local-edge\.stdout\.log' -and $edgeManager -match 'local-edge\.stderr\.log') "Runtime publishes Local Edge stdout/stderr log paths"
Assert-True ($edgeManager -match 'CommandEvent::Stdout' -and $edgeManager -match 'CommandEvent::Stderr' -and $edgeManager -match 'append_edge_log_line') "Sidecar stdout/stderr are captured to diagnostic logs"
Assert-True ($edgeManager -match 'edge_health_url' -and $edgeManager -match '/v1/health') "Runtime exposes the Local Edge health URL"
Assert-True ($edgeManager -match 'preflight' -and $edgeManager -match 'sidecar_available' -and $edgeManager -match 'fallback_executable_available') "Runtime readiness reports sidecar and fallback availability"
Assert-True ($edgeManager -match 'auth_token_ready' -and $edgeManager -match 'Local Edge auth token is unavailable; refusing to start Local Edge') "Runtime fails closed when Local Edge auth token generation fails"
Assert-True ($edgeManager -match 'direct_cli_spawn:\s*false') "Runtime readiness does not expose direct CLI spawn"
Assert-True ($commands -match 'get_edge_host_readiness' -and $commands -match 'get_edge_auth_token' -and $commands -match 'start_edge') "Tauri commands expose readiness, auth token, and start gate"
Assert-True ($lib -match 'manager\.start' -and $lib -match 'edge-start-error') "Desktop setup starts Local Edge and emits startup errors"
Assert-True ($desktopPlatform -match 'DesktopEdgeHostReadiness' -and $desktopPlatform -match 'direct_cli_spawn:\s*false') "Desktop host API models sidecar readiness without UI spawn inputs"
Assert-True ($desktopPlatformTest -match '<app-data>/agenthub-edge\.sqlite' -and $desktopPlatformTest -match 'local-edge\.stderr\.log' -and $desktopPlatformTest -match 'direct_cli_spawn:\s*false') "Desktop tests preserve app-data, log, and no-direct-spawn evidence"

Step "Workspace permission boundary"
Assert-True ($commands -match 'No allowed workspace directories configured') "Host file access fails closed before a workspace is authorized"
Assert-True ($commands -match 'choose_workspace_root' -and $commands -match 'authorize_workspace_root_from_host_path') "Workspace authority is granted through the native host picker"
Assert-True ($commands -match 'validate_path' -and $commands -match 'outside allowed directories') "Workspace file operations validate allowed roots"
Assert-True ($commands -match 'Refusing to copy symbolic link') "Workspace recursive copy rejects symlink escapes"

Step "macOS unsigned package gate boundary"
$readiness = Read-Text "scripts\verify-tauri-package-readiness.ps1"
$dry = Read-Text "scripts\verify-tauri-package-dry.ps1"
$audit = Read-Text "docs\audit\p1-tauri-build-package-evidence.md"
$runtimeAudit = Read-Text "docs\audit\p1-tauri-package-runtime-evidence.md"

Assert-True ($readiness -match 'run_macos_unsigned_dry_policy' -and $readiness -match 'macos-unsigned-dry-policy') "Readiness checker has an explicit macOS unsigned dry policy gate"
Assert-True ($readiness -match 'agenthub-edge-aarch64-apple-darwin' -and $readiness -match 'AgentHub' -and $readiness -match 'app' -and $readiness -match 'AgentHub_' -and $readiness -match 'aarch64' -and $readiness -match 'dmg') "macOS sidecar, app, and DMG boundaries are recorded"
Assert-True ($readiness -match 'Assert-NoMacOSUnsignedDryCommands' -and $readiness -match 'codesign|notarytool|stapler') "macOS unsigned gate rejects signing, notarization, and stapling commands"
Assert-True ($readiness -match 'Assert-NoMacOSUnsignedDryReleaseActions' -and $readiness -match 'softprops/action-gh-release') "macOS unsigned gate rejects release/updater publication actions"
Assert-True ($dry -match 'macosUnsignedDry.*policy_only') "Dry package report keeps macOS as policy-only unless a macOS runner proves artifacts"
Assert-True (($audit + $runtimeAudit) -match 'Developer ID' -and ($audit + $runtimeAudit) -match 'notarytool' -and ($audit + $runtimeAudit) -match 'stapling') "Audit names executable macOS approval gates"

if ($RequireBuiltArtifacts) {
    Step "Unsigned Windows package artifact inspection"
    if ([string]::IsNullOrWhiteSpace($BuiltArtifactsRoot)) {
        Fail "BuiltArtifactsRoot is required when -RequireBuiltArtifacts is set"
    }
    if (-not (Test-Path -LiteralPath $BuiltArtifactsRoot)) {
        Fail "Built artifacts root not found: $BuiltArtifactsRoot"
    }

    $artifactRoot = (Resolve-Path $BuiltArtifactsRoot).Path
    $setup = Assert-Artifact $artifactRoot "*setup.exe" "Unsigned Windows NSIS setup"
    $portable = Assert-Artifact $artifactRoot "*portable.zip" "Unsigned Windows portable package"
    $sidecar = Assert-Artifact $artifactRoot "agenthub-edge-windows-amd64.exe" "Windows Local Edge sidecar dry artifact"
    $report = Assert-Artifact $artifactRoot "package*.json" "Package dry report"
    $manifest = Assert-Artifact $artifactRoot "artifact-manifest.json" "Artifact manifest"

    Assert-True ($setup.Length -gt 0) "Unsigned Windows NSIS setup is non-empty"
    Assert-True ($portable.Length -gt 0) "Unsigned Windows portable package is non-empty"
    Assert-True ($sidecar.Length -gt 0) "Windows Local Edge sidecar artifact is non-empty"
    Assert-ZipContains $portable "AgentHub.exe" "Portable package"
    Assert-ZipContains $portable "agenthub-edge.exe" "Portable package"
    Assert-ZipContains $portable "README.txt" "Portable package"

    $reportJson = Get-Content $report.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ([string]$reportJson.signing -eq "out-of-scope") "Package dry report keeps signing out of scope"
    Assert-True ([string]$reportJson.notarization -eq "out-of-scope") "Package dry report keeps notarization out of scope"
    Assert-True ([string]$reportJson.releaseUpload -eq "out-of-scope") "Package dry report keeps release upload out of scope"
    Assert-True ([string]$reportJson.stages.sidecar -eq "passed") "Package dry report records sidecar stage passed"
    Assert-True ([string]$reportJson.stages.macosUnsignedDry -eq "policy_only") "Package dry report records macOS unsigned dry as policy-only"

    $manifestJson = @()
    foreach ($entry in (Get-Content $manifest.FullName -Raw -Encoding UTF8 | ConvertFrom-Json)) {
        $manifestJson += $entry
    }
    Assert-ArtifactManifestEntry $manifestJson $setup
    Assert-ArtifactManifestEntry $manifestJson $portable
    Assert-ArtifactManifestEntry $manifestJson $sidecar
}

Write-Host "`nTauri sidecar runtime evidence gate OK" -ForegroundColor Green
