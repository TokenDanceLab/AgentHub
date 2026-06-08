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

@"
# TeamRun Demo Evidence Package

Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
Commit: $commit
Package mode: $PackageMode

## Files

- teamrun-evidence.json
$screenshotLines

Video: $videoLine

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
