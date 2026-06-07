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
    [string]$Stamp
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
$runtimeProfiles = 0
if ($null -ne $evidence.runtime_profiles) {
    $runtimeProfiles = @($evidence.runtime_profiles).Count
}
$runtimeTypes = 0
if ($null -ne $evidence.counts -and $null -ne $evidence.counts.runtime_types) {
    $runtimeTypes = [int]$evidence.counts.runtime_types
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

## Files

- teamrun-evidence.json
$screenshotLines

Video: $videoLine

## Evidence Summary

- runtime_profiles: $runtimeProfiles
- runtime_types: $runtimeTypes

## Notes

- This package is generated under `.tmp/` and is intentionally ignored by Git.
- The script only packages caller-provided files. It does not run real CLI/model gates or upload artifacts.
"@ | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "Created TeamRun demo evidence package:"
Write-Host "  $outputDir"
Write-Host "Manifest:"
Write-Host "  $manifestPath"
