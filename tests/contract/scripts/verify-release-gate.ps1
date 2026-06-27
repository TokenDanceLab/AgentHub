param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path
$scriptPath = Join-Path $RepoRoot "scripts\release\verify-release-gate.ps1"

function Pass([string]$Message) { Write-Host "PASS: $Message" -ForegroundColor Green }
function Fail([string]$Message, [string]$Details = "") {
    Write-Host "FAIL: $Message" -ForegroundColor Red
    if ($Details) { Write-Host $Details }
    exit 1
}

function Invoke-ReleaseGate {
    param([string[]]$Arguments)

    $oldErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath @Arguments 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldErrorActionPreference
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = $output
    }
}

function Copy-FixtureFile([string]$RelativePath, [string]$TempRoot) {
    $source = Join-Path $RepoRoot $RelativePath
    $target = Join-Path $TempRoot $RelativePath
    New-Item -ItemType Directory (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item $source $target
}

function New-ReleaseGateFixture {
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-release-gate-$(New-Guid)"
    New-Item -ItemType Directory $tempRoot -Force | Out-Null

    foreach ($relativePath in @(
        ".github\workflows\release.yml",
        ".github\workflows\release-readiness.yml",
        "app\desktop\package.json",
        "app\desktop\src-tauri\tauri.conf.json",
        "docs\governance\security-risk-register.md",
        "scripts\release\verify-release-gate.ps1"
    )) {
        Copy-FixtureFile $relativePath $tempRoot
    }

    & git -C $tempRoot init -q
    return $tempRoot
}

function New-ArtifactRoot([string]$TempRoot) {
    $artifactRoot = Join-Path $TempRoot "artifacts"
    New-Item -ItemType Directory $artifactRoot -Force | Out-Null
    $manifest = @(
        [pscustomobject]@{ name = "AgentHub_0.3.0-rc.7_x64-portable.zip"; bytes = 100; sha256 = "A" * 64 },
        [pscustomobject]@{ name = "AgentHub_0.3.0-rc.7_x64-setup.exe"; bytes = 100; sha256 = "B" * 64 },
        [pscustomobject]@{ name = "agenthub-desktop.exe"; bytes = 100; sha256 = "C" * 64 },
        [pscustomobject]@{ name = "agenthub-edge-windows-amd64.exe"; bytes = 100; sha256 = "D" * 64 },
        [pscustomobject]@{ name = "package-dry-report.json"; bytes = 100; sha256 = "E" * 64 }
    )
    $manifest | ConvertTo-Json -Depth 4 | Out-File (Join-Path $artifactRoot "artifact-manifest.json") -Encoding UTF8
    [ordered]@{
        signing = "out-of-scope"
        releaseUpload = "out-of-scope"
        stages = [ordered]@{
            updaterMetadata = "not_produced_unsigned_build"
        }
    } | ConvertTo-Json -Depth 4 | Out-File (Join-Path $artifactRoot "package-dry-report.json") -Encoding UTF8
    return $artifactRoot
}

$fixture = New-ReleaseGateFixture
$artifacts = New-ArtifactRoot $fixture

$allowed = Invoke-ReleaseGate @("-RepoRoot", $fixture, "-SkipRefCheck", "-AllowOpenHighRisks", "-ArtifactsRoot", $artifacts, "-ReportPath", (Join-Path $fixture ".tmp\release-gate-report.json"))
if ($allowed.ExitCode -eq 0) {
    Fail "release gate should still block signing/updater approval slices" $allowed.Output
}
if ($allowed.Output -notmatch "signing/notarization" -or $allowed.Output -notmatch "updater publication") {
    Fail "release gate did not report mandatory signing/updater blockers" $allowed.Output
}
Pass "release gate reports signing and updater blockers even when open high risks are allowed"

$blocked = Invoke-ReleaseGate @("-RepoRoot", $fixture, "-SkipRefCheck", "-ArtifactsRoot", $artifacts, "-ReportPath", (Join-Path $fixture ".tmp\release-gate-report-blocked.json"))
if ($blocked.ExitCode -eq 0) {
    Fail "release gate should fail when Open Critical/High risks are not allowed" $blocked.Output
}
if ($blocked.Output -notmatch "Open Critical/High risks block public release") {
    Fail "release gate did not identify Open Critical/High release blockers" $blocked.Output
}
Pass "release gate fails on Open Critical/High risks by default"

$manifestPath = Join-Path $artifacts "artifact-manifest.json"
$manifest = @(Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json | Where-Object { $_.name -notmatch "portable" })
$manifest | ConvertTo-Json -Depth 4 | Out-File $manifestPath -Encoding UTF8

$artifactBlocked = Invoke-ReleaseGate @("-RepoRoot", $fixture, "-SkipRefCheck", "-AllowOpenHighRisks", "-ArtifactsRoot", $artifacts, "-ReportPath", (Join-Path $fixture ".tmp\release-gate-report-artifact-blocked.json"))
if ($artifactBlocked.Output -notmatch "artifact manifest lacks required artifact pattern") {
    Fail "release gate did not catch missing portable artifact manifest entry" $artifactBlocked.Output
}
Pass "release gate catches missing Windows portable artifact manifest entry"

Write-Host "`nverify-release-gate tests passed" -ForegroundColor Green
