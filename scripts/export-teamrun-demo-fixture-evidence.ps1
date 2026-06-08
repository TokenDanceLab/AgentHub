#!/usr/bin/env pwsh
<#
Exports a fixture-only TeamRun demo evidence pack from the scenario manifest.

This script is offline by design. It does not run agent CLIs, call model APIs,
start Hub/Edge services, upload artifacts, or claim the final recording.
#>

[CmdletBinding()]
param(
    [string]$ScenarioManifest = "docs/competition/teamrun-demo-scenario.json",
    [string]$OutputRoot = ".tmp/teamrun-evidence",
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

function Count-Items($Value) {
    if ($null -eq $Value) {
        return 0
    }
    if ($Value -is [System.Array]) {
        return $Value.Count
    }
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        return @($Value).Count
    }
    return 1
}

function Get-RuntimeProfiles($Scenario) {
    if ($null -ne $Scenario.runtime_profiles) {
        return @($Scenario.runtime_profiles)
    }
    return @($Scenario.agent_profiles)
}

function Test-RequiredString($Object, [string]$Field, [string]$Label) {
    if ($null -eq $Object -or [string]::IsNullOrWhiteSpace([string]$Object.$Field)) {
        throw "$Label must include $Field"
    }
}

if ([string]::IsNullOrWhiteSpace($Stamp)) {
    $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
}

$resolvedScenario = Resolve-RepoPath $ScenarioManifest
if (-not $resolvedScenario -or -not (Test-Path -LiteralPath $resolvedScenario)) {
    throw "scenario manifest not found: $ScenarioManifest"
}

$scenario = Get-Content -Raw -LiteralPath $resolvedScenario | ConvertFrom-Json
if ($scenario.contract -ne "teamrun-demo-evidence-v1") {
    throw "unsupported scenario contract: $($scenario.contract)"
}
if ($scenario.fixture_only -ne $true) {
    throw "scenario must be fixture_only=true"
}
if ($scenario.claims.real_runtime_executed -ne $false -or $scenario.claims.final_recording_complete -ne $false) {
    throw "fixture scenario must not claim real runtime execution or final recording completion"
}
if ($scenario.claims.submission_ready -ne $false) {
    throw "fixture scenario must not claim submission readiness"
}
if ($null -eq $scenario.screenshot_or_video_rehearsal) {
    throw "scenario must include screenshot_or_video_rehearsal metadata"
}
if ($scenario.screenshot_or_video_rehearsal.real_runtime_executed -ne $false -or
    $scenario.screenshot_or_video_rehearsal.final_recording_complete -ne $false -or
    $scenario.screenshot_or_video_rehearsal.submission_ready -ne $false) {
    throw "fixture rehearsal metadata must keep real_runtime_executed, final_recording_complete, and submission_ready false"
}

$runtimeProfiles = Get-RuntimeProfiles $scenario
$runtimeTypes = @($runtimeProfiles | ForEach-Object { $_.runtime_type } | Where-Object { $_ } | Sort-Object -Unique)
if ($runtimeTypes.Count -lt 2) {
    throw "scenario must include at least two runtime types"
}

$remoteManifest = $scenario.remote_control_manifest
if ($null -ne $remoteManifest) {
    foreach ($field in @("hubTaskId", "targetId", "edgeDeviceId", "edgeRunId", "adapterId", "mode", "startedAt")) {
        Test-RequiredString $remoteManifest $field "remote_control_manifest"
    }
    if ($remoteManifest.mode -ne "FixtureRehearsal") {
        throw "fixture remote_control_manifest mode must be FixtureRehearsal"
    }
    if (@($remoteManifest.eventRefs).Count -lt 4) {
        throw "remote_control_manifest must include at least four eventRefs"
    }
}
if ($null -eq $scenario.evidence_matrix -or @($scenario.evidence_matrix).Count -lt 1) {
    throw "scenario must include evidence_matrix"
}

$outputRootPath = Resolve-RepoPath $OutputRoot
$outputDir = Join-Path $outputRootPath "teamrun-demo-$Stamp"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$commit = "unknown"
try {
    $commit = (git -C $RepoRoot rev-parse --short HEAD).Trim()
} catch {
    $commit = "unknown"
}

$generatedAt = Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"
$evidence = [ordered]@{
    contract = $scenario.contract
    manifest_schema = $scenario.manifest_schema
    generated_at = $generatedAt
    source = [ordered]@{
        fixture_only = $true
        scenario_manifest = "docs/competition/teamrun-demo-scenario.json"
        commit = $commit
        real_runtime_executed = $false
        final_recording_complete = $false
        submission_ready = $false
    }
    claims = $scenario.claims
    scenario = [ordered]@{
        scenario_id = $scenario.scenario_id
        title = $scenario.title
        boundaries = $scenario.boundaries
    }
    remote_control_manifest = $remoteManifest
    state = $scenario.state
    tasks = @($scenario.tasks)
    assignments = @($scenario.assignments)
    events = @($scenario.events)
    runtime_profiles = @($runtimeProfiles)
    screenshot_or_video_rehearsal = $scenario.screenshot_or_video_rehearsal
    artifact_diff_preview = $scenario.artifact_diff_preview
    evidence_matrix = @($scenario.evidence_matrix)
    api_exports_required_for_real_demo = @($scenario.api_exports_required_for_real_demo)
    counts = [ordered]@{
        runtime_profiles = Count-Items $runtimeProfiles
        runtime_types = $runtimeTypes.Count
        tasks = Count-Items $scenario.tasks
        assignments = Count-Items $scenario.assignments
        events = Count-Items $scenario.events
        screenshot_or_video_assets = Count-Items $scenario.screenshot_or_video_rehearsal.current_assets
    }
}

$evidencePath = Join-Path $outputDir "teamrun-evidence.json"
$evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $evidencePath -Encoding UTF8

$manifestPath = Join-Path $outputDir "manifest.md"
@"
# TeamRun Fixture Evidence Package

Generated: $generatedAt
Commit: $commit
Scenario: $($scenario.scenario_id)
Contract: $($scenario.contract)

## Files

- teamrun-evidence.json

## Fixture Boundary

- fixture_only: true
- real_runtime_executed: false
- final_recording_complete: false
- submission_ready: false
- screenshot_or_video_rehearsal: $($scenario.screenshot_or_video_rehearsal.mode)

This package freezes the minimum evidence shape for the ByteDance/TeamRun demo.
It is not the final 3-minute recording and is not proof of a real runtime run.

## Evidence Summary

- runtime_profiles: $(Count-Items $scenario.agent_profiles)
- runtime_types: $($runtimeTypes.Count)
- tasks: $(Count-Items $scenario.tasks)
- assignments: $(Count-Items $scenario.assignments)
- events: $(Count-Items $scenario.events)
- screenshot_or_video_assets: $(Count-Items $scenario.screenshot_or_video_rehearsal.current_assets)
"@ | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "Created fixture-only TeamRun evidence:"
Write-Host "  $evidencePath"
Write-Host "Manifest:"
Write-Host "  $manifestPath"
