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
        if ($Details) {
            Write-Host $Details
        }
        exit 1
    }

    Write-Host "PASS: $Message" -ForegroundColor Green
}

function Read-Text([string]$RelativePath) {
    return Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8
}

function Invoke-Script {
    param([string[]]$Arguments)

    $scriptPath = Join-Path $RepoRoot "scripts\verify-tauri-package-readiness.ps1"
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath @Arguments 2>&1 | Out-String
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = $output
    }
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-tauri-package-readiness.ps1"
$workflowPath = Join-Path $RepoRoot ".github\workflows\release.yml"
$readinessWorkflowPath = Join-Path $RepoRoot ".github\workflows\release-readiness.yml"

Assert-True (Test-Path $scriptPath) "Tauri package readiness checker exists"
Assert-True (Test-Path $workflowPath) "release workflow exists"
Assert-True (Test-Path $readinessWorkflowPath) "release readiness workflow exists"

$scriptText = Read-Text "scripts\verify-tauri-package-readiness.ps1"
$workflowText = Read-Text ".github\workflows\release.yml"
$readinessWorkflowText = Read-Text ".github\workflows\release-readiness.yml"

Assert-True ($scriptText -match "package\.json" -and $scriptText -match "Cargo\.toml" -and $scriptText -match "Cargo\.lock" -and $scriptText -match "tauri\.conf\.json") "checker compares desktop package, Cargo, Cargo.lock, and Tauri versions"
Assert-True ($scriptText -match "agenthub-edge-x86_64-pc-windows-msvc\.exe") "checker enforces Windows sidecar binary name"
Assert-True ($scriptText -match "latest\.json" -and $scriptText -match "\.sig") "checker requires updater metadata and signature"
Assert-True ($scriptText -match "portable\.zip" -and $scriptText -match "setup\.exe") "checker requires installer and portable artifacts"
Assert-True ($scriptText -match "check-ignore" -and $scriptText -match "Assert-GitIgnored") "checker verifies generated package artifacts stay ignored before dry builds"
foreach ($artifactPattern in @(
    'dist/AgentHub_${desktopVersion}_x64-setup.exe',
    'dist/AgentHub_${desktopVersion}_x64-portable.zip',
    "dist/latest.json",
    'dist/AgentHub_${desktopVersion}_x64-setup.exe.sig',
    'app/desktop/src-tauri/target/release/bundle/nsis/AgentHub_${desktopVersion}_x64-setup.exe',
    "app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe",
    "app/desktop/src-tauri/binaries/agenthub-edge-aarch64-apple-darwin"
)) {
    Assert-True ($scriptText -match [regex]::Escape($artifactPattern)) "checker covers ignored generated artifact path $artifactPattern"
}
Assert-True ($scriptText -match "unsigned" -and $scriptText -match "aarch64-apple-darwin" -and $scriptText -match "policy note") "checker records macOS arm64 unsigned policy note without formal signing claims"

Assert-True ($workflowText -match "(?ms)on:\s*\r?\n\s*push:\s*\r?\n\s*tags:" -and $workflowText -match "softprops/action-gh-release") "release workflow keeps tag release semantics"
Assert-True ($workflowText -match "TAURI_SIGNING_PRIVATE_KEY") "release workflow keeps production signing secret boundary"
Assert-True ($readinessWorkflowText -match "workflow_dispatch") "release readiness workflow is manual/dry policy gated"
Assert-True ($readinessWorkflowText -match "\.github/workflows/release\.yml") "release readiness workflow watches release.yml"
Assert-True ($readinessWorkflowText -match "app/desktop/src-tauri/Cargo\.lock") "release readiness workflow watches Cargo.lock"
Assert-True ($readinessWorkflowText -match "verify-tauri-package-readiness\.ps1") "release readiness workflow runs readiness checker"
Assert-True ($readinessWorkflowText -notmatch "softprops/action-gh-release") "release readiness workflow does not create a GitHub Release"
Assert-True ($readinessWorkflowText -notmatch "TAURI_SIGNING_PRIVATE_KEY") "release readiness workflow does not require production signing secrets"

$ok = Invoke-Script @("-RepoRoot", $RepoRoot)
Assert-True ($ok.ExitCode -eq 0) "readiness checker passes current repository policy" $ok.Output

$missingUpdater = Invoke-Script @("-RepoRoot", $RepoRoot, "-BuiltArtifactsRoot", (Join-Path $RepoRoot "does-not-exist"), "-RequireBuiltArtifacts")
Assert-True ($missingUpdater.ExitCode -ne 0) "built artifact gate fails when updater metadata is missing" $missingUpdater.Output
Assert-True ($missingUpdater.Output -match "latest\.json") "missing updater metadata failure names latest.json" $missingUpdater.Output
