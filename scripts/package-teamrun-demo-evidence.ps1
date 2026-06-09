#!/usr/bin/env pwsh
<#
Creates a local, ignored TeamRun demo evidence package under .tmp/.

This script only copies caller-provided evidence files and writes a manifest.
It does not run agent CLIs, call model APIs, start services, or upload data.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EvidencePath,

    [string[]]$ScreenshotPath = @(),
    [string]$VideoPath,
    [string]$OutputRoot = ".tmp/submission-evidence",
    [string]$Stamp,
    [ValidateSet("FixtureRehearsal", "Submission")]
    [string]$PackageMode = "FixtureRehearsal"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$SensitiveValuePattern = '(?i)(Authorization\s*:\s*Bearer\s+(?!<redacted)[^\s,;]+|Cookie\s*:\s*[^\r\n]+|(?:password|passwd|client[_ -]?secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|auth[_ -]?token)\s*[:=]\s*(?!"?(?:false|true|null|none|not[_ -]?required|not[_ -]?available|blocked|redacted|<redacted|fixture|manifest|approved|redact)[^"]*"?)(?!"?\s*(?:false|true|null)"?\s*(?:,|$))["'']?[^"''\s,;}]{8,}|(?<![A-Za-z0-9_])(?:sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{12,})'
$TextScanExtensions = @(".json", ".md", ".txt", ".log", ".csv", ".yaml", ".yml")

function Resolve-RepoPath([string]$PathValue) {
    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }
    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return $PathValue
    }
    return Join-Path $RepoRoot $PathValue
}

function Copy-RequiredFile([string]$Source, [string]$DestinationDirectory, [string]$DestinationName) {
    $resolved = Resolve-RepoPath $Source
    if (-not $resolved -or -not (Test-Path -LiteralPath $resolved)) {
        throw "required file not found: $Source"
    }
    $destination = Join-Path $DestinationDirectory $DestinationName
    Copy-Item -LiteralPath $resolved -Destination $destination -Force
    return $destination
}

function Copy-OptionalFile([string]$Source, [string]$DestinationDirectory) {
    $resolved = Resolve-RepoPath $Source
    if (-not $resolved -or -not (Test-Path -LiteralPath $resolved)) {
        throw "optional file not found: $Source"
    }
    $destination = Join-Path $DestinationDirectory (Split-Path -Leaf $resolved)
    Copy-Item -LiteralPath $resolved -Destination $destination -Force
    return $destination
}

function Get-FileSha256([string]$PathValue) {
    return (Get-FileHash -LiteralPath $PathValue -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-PackageRelativePath([string]$PathValue, [string]$RootPath) {
    $root = [System.IO.Path]::GetFullPath($RootPath)
    if (-not $root.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $root = $root + [System.IO.Path]::DirectorySeparatorChar
    }
    $full = [System.IO.Path]::GetFullPath($PathValue)
    if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "packaged file escapes output boundary: $PathValue"
    }
    return $full.Substring($root.Length).Replace("\", "/")
}

function Test-RedactedTextFile([string]$PathValue) {
    $extension = [System.IO.Path]::GetExtension($PathValue)
    if ($TextScanExtensions -notcontains $extension.ToLowerInvariant()) {
        return
    }
    $content = Get-Content -Raw -LiteralPath $PathValue
    if ($content -match $SensitiveValuePattern) {
        throw "sensitive value detected in packaged evidence: $(Split-Path -Leaf $PathValue)"
    }
}

function New-FileEntry([string]$PathValue, [string]$RootPath, [string]$Role) {
    Test-RedactedTextFile $PathValue
    return [ordered]@{
        path = Get-PackageRelativePath $PathValue $RootPath
        role = $Role
        sha256 = Get-FileSha256 $PathValue
        bytes = (Get-Item -LiteralPath $PathValue).Length
        redacted = $true
    }
}

function Get-BoundaryLabel($Evidence, [string]$Mode, [bool]$FixtureOnly, [bool]$RealRuntimeExecuted) {
    if ($FixtureOnly) {
        return "fixture"
    }
    if ($Mode -eq "Submission") {
        return "approved-real"
    }
    if ($RealRuntimeExecuted) {
        return "RealTested"
    }
    return "observed"
}

if ([string]::IsNullOrWhiteSpace($Stamp)) {
    $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
}

$outputRootPath = Resolve-RepoPath $OutputRoot
$outputDir = Join-Path $outputRootPath "teamrun-demo-$Stamp"
$screenshotsDir = Join-Path $outputDir "screenshots"
New-Item -ItemType Directory -Force -Path $outputDir, $screenshotsDir | Out-Null

$copiedEvidence = Copy-RequiredFile $EvidencePath $outputDir "teamrun-evidence.json"
$copiedScreenshots = @()
foreach ($screenshot in $ScreenshotPath) {
    $copiedScreenshots += Copy-OptionalFile $screenshot $screenshotsDir
}

$copiedVideo = $null
if (-not [string]::IsNullOrWhiteSpace($VideoPath)) {
    $copiedVideo = Copy-OptionalFile $VideoPath $outputDir
}

$commit = "unknown"
try {
    $commit = (git -C $RepoRoot rev-parse --short HEAD).Trim()
} catch {
    $commit = "unknown"
}

$evidence = Get-Content -Raw -LiteralPath $copiedEvidence | ConvertFrom-Json
if ($null -eq $evidence.claims) {
    throw "evidence claims are required"
}
if ($null -eq $evidence.runtime_profiles -or @($evidence.runtime_profiles).Count -lt 2) {
    throw "evidence must include at least two runtime_profiles"
}
if ($null -eq $evidence.screenshot_or_video_rehearsal) {
    throw "evidence must include screenshot_or_video_rehearsal metadata"
}
if ($evidence.source.fixture_only -eq $true -and (
        $evidence.claims.real_runtime_executed -ne $false -or
        $evidence.claims.final_recording_complete -ne $false -or
        $evidence.claims.submission_ready -ne $false)) {
    throw "fixture evidence cannot claim real runtime execution, final recording completion, or submission readiness"
}
if ($PackageMode -eq "Submission") {
    if ($evidence.source.fixture_only -eq $true) {
        throw "fixture evidence cannot be packaged in Submission mode"
    }
    if ($evidence.claims.real_runtime_executed -ne $true -or
        $evidence.claims.final_recording_complete -ne $true -or
        $evidence.claims.submission_ready -ne $true) {
        throw "Submission mode requires real_runtime_executed=true, final_recording_complete=true, and submission_ready=true"
    }
    if ([string]::IsNullOrWhiteSpace($VideoPath) -or -not $copiedVideo) {
        throw "Submission mode requires a final video path"
    }
}
$runtimeProfiles = 0
if ($null -ne $evidence.runtime_profiles) {
    $runtimeProfiles = @($evidence.runtime_profiles).Count
}
$runtimeTypes = 0
if ($null -ne $evidence.counts -and $null -ne $evidence.counts.runtime_types) {
    $runtimeTypes = [int]$evidence.counts.runtime_types
}
$fixtureOnly = $false
if ($null -ne $evidence.source -and $evidence.source.fixture_only -eq $true) {
    $fixtureOnly = $true
}
$realRuntimeExecuted = $false
if ($evidence.claims.real_runtime_executed -eq $true) {
    $realRuntimeExecuted = $true
}
$finalRecordingComplete = $false
if ($evidence.claims.final_recording_complete -eq $true) {
    $finalRecordingComplete = $true
}
$submissionReady = $false
if ($evidence.claims.submission_ready -eq $true) {
    $submissionReady = $true
}
$rehearsalMode = "missing"
if ($null -ne $evidence.screenshot_or_video_rehearsal -and $null -ne $evidence.screenshot_or_video_rehearsal.mode) {
    $rehearsalMode = $evidence.screenshot_or_video_rehearsal.mode
}

$manifestPath = Join-Path $outputDir "manifest.md"
$redactedManifestPath = Join-Path $outputDir "redacted-manifest.json"
$screenshotLines = if ($copiedScreenshots.Count -gt 0) {
    ($copiedScreenshots | ForEach-Object { "- screenshots/$([System.IO.Path]::GetFileName($_))" }) -join "`n"
} else {
    "- none"
}
$videoLine = if ($copiedVideo) {
    [System.IO.Path]::GetFileName($copiedVideo)
} else {
    "not included"
}

$boundaryLabel = Get-BoundaryLabel $evidence $PackageMode $fixtureOnly $realRuntimeExecuted
$fileEntries = @()
$fileEntries += New-FileEntry $copiedEvidence $outputDir "evidence-json"
foreach ($screenshot in $copiedScreenshots) {
    $fileEntries += New-FileEntry $screenshot $outputDir "screenshot"
}
if ($copiedVideo) {
    $fileEntries += New-FileEntry $copiedVideo $outputDir "video"
}

$redactedManifest = [ordered]@{
    schema = "agenthub-redacted-evidence-manifest-v1"
    generated_at = Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"
    commit = $commit
    package_mode = $PackageMode
    evidence_boundary = [ordered]@{
        label = $boundaryLabel
        fixture = ($boundaryLabel -eq "fixture")
        observed = ($boundaryLabel -eq "observed")
        real_tested = ($boundaryLabel -eq "RealTested")
        approved_real = ($boundaryLabel -eq "approved-real")
        source_claims = [ordered]@{
            fixture_only = $fixtureOnly
            real_runtime_executed = $realRuntimeExecuted
            final_recording_complete = $finalRecordingComplete
            submission_ready = $submissionReady
        }
    }
    path_boundary = [ordered]@{
        package_root = ".tmp/submission-evidence/teamrun-demo-$Stamp"
        file_paths = "package-relative only"
        source_paths = "not recorded"
    }
    redaction = [ordered]@{
        status = "passed"
        policy = "no sensitive credential values in text evidence"
        checked_files = $fileEntries.Count
    }
    files = @($fileEntries)
    notes = @(
        "This manifest is a redacted package index, not a competition submission bundle.",
        "The packager copies caller-provided files only and never runs real CLI/model/API flows."
    )
}
$redactedManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $redactedManifestPath -Encoding UTF8

$hashLines = ($fileEntries | ForEach-Object { "- $($_.path) sha256=$($_.sha256)" }) -join "`n"

@"
# TeamRun Demo Evidence Package

Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
Commit: $commit
Package mode: $PackageMode

## Files

- teamrun-evidence.json
- redacted-manifest.json
$screenshotLines

Video: $videoLine

## Redacted Manifest

- boundary_label: $boundaryLabel
- path_boundary: package-relative files under `.tmp/submission-evidence/teamrun-demo-$Stamp`
- sensitive_value_scan: passed

## Artifact Hashes

$hashLines

## Evidence Summary

- fixture_only: $fixtureOnly
- real_runtime_executed: $realRuntimeExecuted
- final_recording_complete: $finalRecordingComplete
- submission_ready: $submissionReady
- runtime_profiles: $runtimeProfiles
- runtime_types: $runtimeTypes
- screenshot_or_video_rehearsal: $rehearsalMode

## Notes

- This package is generated under `.tmp/` and is intentionally ignored by Git.
- The script only packages caller-provided files. It does not run real CLI/model gates or upload artifacts.
- Fixture rehearsal packages are blocked from Submission mode until real runtime execution and the final recording are present.
"@ | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "Created TeamRun demo evidence package:"
Write-Host "  $outputDir"
Write-Host "Manifest:"
Write-Host "  $manifestPath"
