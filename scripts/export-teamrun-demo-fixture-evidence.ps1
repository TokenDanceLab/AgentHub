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

$runtimeTypes = @($scenario.agent_profiles | ForEach-Object { $_.runtime_type } | Where-Object { $_ } | Sort-Object -Unique)
if ($runtimeTypes.Count -lt 2) {
    throw "scenario must include at least two runtime types"
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
    generated_at = $generatedAt
    source = [ordered]@{
        fixture_only = $true
        scenario_manifest = "docs/competition/teamrun-demo-scenario.json"
        commit = $commit
    }
    claims = $scenario.claims
    scenario = [ordered]@{
        scenario_id = $scenario.scenario_id
        title = $scenario.title
        boundaries = $scenario.boundaries
    }
    state = $scenario.state
    tasks = @($scenario.tasks)
    assignments = @($scenario.assignments)
    events = @($scenario.events)
    runtime_profiles = @($scenario.agent_profiles)
    api_exports_required_for_real_demo = @($scenario.api_exports_required_for_real_demo)
    counts = [ordered]@{
        runtime_profiles = Count-Items $scenario.agent_profiles
        runtime_types = $runtimeTypes.Count
        tasks = Count-Items $scenario.tasks
        assignments = Count-Items $scenario.assignments
        events = Count-Items $scenario.events
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

This package freezes the minimum evidence shape for the ByteDance/TeamRun demo.
It is not the final 3-minute recording and is not proof of a real runtime run.

## Evidence Summary

- runtime_profiles: $(Count-Items $scenario.agent_profiles)
- runtime_types: $($runtimeTypes.Count)
- tasks: $(Count-Items $scenario.tasks)
- assignments: $(Count-Items $scenario.assignments)
- events: $(Count-Items $scenario.events)
"@ | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "Created fixture-only TeamRun evidence:"
Write-Host "  $evidencePath"
Write-Host "Manifest:"
Write-Host "  $manifestPath"
