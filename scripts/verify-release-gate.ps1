param(
    [string]$RepoRoot = ".",
    [string]$BaseRef = "origin/master",
    [string]$DevRef = "origin/dev/delicious233",
    [string]$ArtifactsRoot = "",
    [string]$ReportPath = ".tmp\release-gate-report.json",
    [switch]$AllowOpenHighRisks,
    [switch]$SkipRefCheck
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path

function Step([string]$Message) { Write-Host "`n>>> $Message" -ForegroundColor Cyan }
function Ready([string]$Message) { Write-Host "READY: $Message" -ForegroundColor Green }
function Blocker([string]$Message) {
    Write-Host "BLOCKER: $Message" -ForegroundColor Red
    $script:blockers += $Message
}
function Warn([string]$Message) {
    Write-Host "WARN: $Message" -ForegroundColor Yellow
    $script:warnings += $Message
}
function Add-Ready([string]$Message) {
    Ready $Message
    $script:ready += $Message
}

function Read-Text([string]$RelativePath) {
    $path = Join-Path $RepoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Blocker "required file is missing: $RelativePath"
        return ""
    }
    return Get-Content $path -Raw -Encoding UTF8
}

function Read-Json([string]$RelativePath) {
    return Get-Content (Join-Path $RepoRoot $RelativePath) -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Test-Pattern([string]$Text, [string]$Pattern, [string]$ReadyMessage, [string]$BlockerMessage) {
    if ($Text -match $Pattern) {
        Add-Ready $ReadyMessage
    } else {
        Blocker $BlockerMessage
    }
}

function Invoke-Git {
    param([string[]]$Arguments)

    $oldErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & git -C $RepoRoot @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldErrorActionPreference
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = @($output)
    }
}

function Assert-ReleaseRefs {
    if ($SkipRefCheck) {
        Warn "ref check skipped by caller"
        return
    }

    Step "dev to master refs"
    foreach ($ref in @($BaseRef, $DevRef)) {
        $probe = Invoke-Git @("rev-parse", "--verify", $ref)
        if ($probe.ExitCode -ne 0) {
            Blocker "required ref is unavailable: $ref"
            return
        }
        Add-Ready "$ref resolves to $($probe.Output[0])"
    }

    $behind = Invoke-Git @("rev-list", "--count", "$DevRef..$BaseRef")
    $ahead = Invoke-Git @("rev-list", "--count", "$BaseRef..$DevRef")
    if ($behind.ExitCode -ne 0 -or $ahead.ExitCode -ne 0) {
        Blocker "could not compute $DevRef divergence from $BaseRef"
        return
    }

    $behindCount = [int]$behind.Output[0]
    $aheadCount = [int]$ahead.Output[0]
    if ($behindCount -gt 0) {
        Blocker "$DevRef is behind $BaseRef by $behindCount commit(s); rebase/merge current master before dev->master"
    } else {
        Add-Ready "$DevRef is not behind $BaseRef"
    }

    Add-Ready "$DevRef is ahead of $BaseRef by $aheadCount commit(s)"
}

function Assert-WorkflowPolicy {
    Step "release workflow and dry gates"
    $readiness = Read-Text ".github\workflows\release-readiness.yml"
    $release = Read-Text ".github\workflows\release.yml"

    Test-Pattern $readiness 'workflow_dispatch' "release readiness workflow is manually dispatchable" "release readiness workflow lacks workflow_dispatch"
    Test-Pattern $readiness 'run_windows_package_dry' "Windows package dry gate has an explicit manual input" "Windows package dry gate input is missing"
    Test-Pattern $readiness 'verify-tauri-package-dry\.ps1[^\r\n]+-RunWindowsBundle[^\r\n]+-StrictToolchain' "Windows dry gate delegates to verify-tauri-package-dry.ps1 with bundle and strict toolchain checks" "Windows dry gate does not call verify-tauri-package-dry.ps1 with -RunWindowsBundle -StrictToolchain"
    Test-Pattern $readiness 'actions/upload-artifact@v4' "release readiness dry outputs are workflow artifacts only" "release readiness workflow does not upload dry evidence artifacts"
    Test-Pattern $readiness 'run_macos_unsigned_dry_policy' "macOS future dry policy is manual and policy-only" "macOS unsigned dry policy input is missing"

    if ($readiness -match 'softprops/action-gh-release|(?m)^\s*(gh\s+release|xcrun\s+notarytool|notarytool\s+submit|xcrun\s+stapler|stapler\s+staple|codesign\s|TAURI_SIGNING_PRIVATE_KEY|APPLE_)') {
        Blocker "release-readiness workflow contains release upload/signing/notarization execution surface"
    } else {
        Add-Ready "release-readiness workflow does not sign, notarize, staple, tag, or upload a GitHub Release"
    }

    Test-Pattern $release "tags:\s*\['v\*'\]" "release workflow is tag-triggered on v* only" "release workflow tag trigger is missing or not constrained to v*"
    Test-Pattern $release 'softprops/action-gh-release@v2' "release workflow has the real GitHub Release uploader isolated in the tag workflow" "release workflow GitHub Release uploader is missing"
    Test-Pattern $release 'prerelease:\s*\$\{\{\s*contains\(github\.ref_name,\s*''-''\)\s*\}\}' "RC tags become GitHub prereleases via contains(github.ref_name, '-')" "release workflow prerelease policy is not tied to hyphenated semver tags"
}

function Get-DesktopVersion {
    $packageJson = Read-Json "app\desktop\package.json"
    $tauriConf = Read-Json "app\desktop\src-tauri\tauri.conf.json"
    $packageVersion = [string]$packageJson.version
    $tauriVersion = [string]$tauriConf.version
    if ($packageVersion -ne $tauriVersion) {
        Blocker "desktop package.json version ($packageVersion) does not match tauri.conf.json version ($tauriVersion)"
    } else {
        Add-Ready "desktop package metadata version is aligned at $packageVersion"
    }
    return $packageVersion
}

function Assert-RcTagPolicy([string]$Version) {
    Step "RC and tag policy"
    if ($Version -match '^\d+\.\d+\.\d+-rc\.\d+$') {
        Add-Ready "current desktop version is an RC semver: $Version"
        Add-Ready "next RC tag convention: v$Version"
    } elseif ($Version -match '^\d+\.\d+\.\d+$') {
        Warn "current desktop version is stable semver: $Version; use only after release blockers are closed"
    } else {
        Blocker "desktop version is not an accepted stable or rc semver: $Version"
    }
}

function Get-OpenHighRisks {
    $riskPath = Join-Path $RepoRoot "docs\governance\security-risk-register.md"
    if (-not (Test-Path -LiteralPath $riskPath -PathType Leaf)) {
        Blocker "security risk register is missing"
        return @()
    }

    $risks = @()
    foreach ($line in (Get-Content $riskPath -Encoding UTF8)) {
        if ($line -match '^\|\s*(?<id>AH-SR-\d+)\s*\|\s*(?<severity>Critical|High)\s*\|\s*Open\s*\|\s*(?<risk>[^|]+)\|') {
            $risks += [pscustomobject]@{
                Id = $Matches["id"]
                Severity = $Matches["severity"]
                Risk = ($Matches["risk"].Trim())
            }
        }
    }
    return $risks
}

function Assert-SecurityReleaseGate {
    Step "security release gate"
    $openRisks = @(Get-OpenHighRisks)
    if ($openRisks.Count -eq 0) {
        Add-Ready "no Open Critical/High risks in security register"
        return $openRisks
    }

    $ids = ($openRisks | ForEach-Object { "$($_.Id)($($_.Severity))" }) -join ", "
    if ($AllowOpenHighRisks) {
        Warn "Open Critical/High risks are being reported but not failing because -AllowOpenHighRisks was set: $ids"
    } else {
        Blocker "Open Critical/High risks block public release: $ids"
    }
    return $openRisks
}

function Assert-ArtifactManifest {
    if (-not $ArtifactsRoot) {
        Warn "artifact manifest check skipped because -ArtifactsRoot was not provided"
        return @()
    }

    Step "Windows unsigned artifact manifest"
    $artifactRootFull = if ([System.IO.Path]::IsPathRooted($ArtifactsRoot)) {
        $ArtifactsRoot
    } else {
        Join-Path $RepoRoot $ArtifactsRoot
    }
    if (-not (Test-Path -LiteralPath $artifactRootFull -PathType Container)) {
        Blocker "artifact root does not exist: $artifactRootFull"
        return @()
    }

    $manifestPath = Join-Path $artifactRootFull "artifact-manifest.json"
    $packageReportPath = Join-Path $artifactRootFull "package-dry-report.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        Blocker "artifact-manifest.json is missing from $artifactRootFull"
        return @()
    }
    if (-not (Test-Path -LiteralPath $packageReportPath -PathType Leaf)) {
        Blocker "package-dry-report.json is missing from $artifactRootFull"
    }

    $manifestJson = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $manifest = @()
    foreach ($entry in $manifestJson) {
        $manifest += $entry
    }
    $requiredPatterns = @(
        '^AgentHub_\d+\.\d+\.\d+-rc\.\d+_x64-setup\.exe$',
        '^AgentHub_\d+\.\d+\.\d+-rc\.\d+_x64-portable\.zip$',
        '^agenthub-edge-windows-amd64\.exe$',
        '^agenthub-desktop\.exe$',
        '^package-dry-report\.json$'
    )
    foreach ($pattern in $requiredPatterns) {
        $entry = $manifest | Where-Object { [string]$_.name -match $pattern } | Select-Object -First 1
        if ($null -eq $entry) {
            Blocker "artifact manifest lacks required artifact pattern: $pattern"
            continue
        }
        if ([int64]$entry.bytes -le 0 -or -not ([string]$entry.sha256 -match '^[A-Fa-f0-9]{64}$')) {
            Blocker "artifact manifest entry is invalid for $($entry.name)"
        } else {
            Add-Ready "artifact manifest includes $($entry.name) ($($entry.bytes) bytes, sha256 $($entry.sha256))"
        }
    }

    if (Test-Path -LiteralPath $packageReportPath -PathType Leaf) {
        $dryReport = Get-Content $packageReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ([string]$dryReport.signing -eq "out-of-scope" -and [string]$dryReport.releaseUpload -eq "out-of-scope") {
            Add-Ready "package dry report keeps signing and release upload out of scope"
        } else {
            Blocker "package dry report does not preserve signing/release upload boundaries"
        }
        if ([string]$dryReport.stages.updaterMetadata -eq "not_produced_unsigned_build") {
            Warn "unsigned dry build did not produce latest.json/.sig; updater metadata remains a signing/release blocker"
        }
    }

    return $manifest
}

$script:ready = @()
$script:warnings = @()
$script:blockers = @()

Assert-ReleaseRefs
Assert-WorkflowPolicy
$version = Get-DesktopVersion
Assert-RcTagPolicy $version
$openHighRisks = @(Assert-SecurityReleaseGate)
$manifest = @(Assert-ArtifactManifest)

Step "blocking external approval slices"
Blocker "public release remains blocked until signing/notarization approval is explicit; this gate does not sign, notarize, staple, tag, push, or upload releases"
Blocker "production updater publication remains blocked until signed latest.json and installer signature are produced and approved"

$reportFullPath = if ([System.IO.Path]::IsPathRooted($ReportPath)) {
    $ReportPath
} else {
    Join-Path $RepoRoot $ReportPath
}
New-Item -ItemType Directory (Split-Path $reportFullPath -Parent) -Force | Out-Null
[ordered]@{
    mode = "agenthub-release-gate"
    baseRef = $BaseRef
    devRef = $DevRef
    desktopVersion = $version
    ready = $script:ready
    warnings = $script:warnings
    blockers = $script:blockers
    openCriticalHighRisks = $openHighRisks
    artifactsRoot = $ArtifactsRoot
    manifest = $manifest
} | ConvertTo-Json -Depth 8 | Out-File $reportFullPath -Encoding UTF8

Write-Host "`nRelease gate report: $reportFullPath"
if ($script:blockers.Count -gt 0) {
    Write-Host "Release gate BLOCKED with $($script:blockers.Count) blocker(s)." -ForegroundColor Red
    exit 1
}

Write-Host "Release gate READY." -ForegroundColor Green
