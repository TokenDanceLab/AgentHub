#!/usr/bin/env pwsh
<#
Verifies that a local TeamRun demo evidence pack is structurally ready.

This gate is intentionally offline and secret-free. It does not run agent CLIs,
call model APIs, start local services, or upload artifacts. Use -RequireVideo
only after the final 3-minute recording exists.
#>

[CmdletBinding()]
param(
    [string]$EvidencePath,
    [string]$ManifestPath,
    [string]$VideoPath,
    [switch]$RequireVideo
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$Passed = 0
$Failed = 0

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Fail([string]$Text) {
    $script:Failed++
    Write-Host "  FAIL  $Text" -ForegroundColor Red
}

function Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Resolve-RepoPath([string]$PathValue) {
    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }
    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return $PathValue
    }
    return Join-Path $RepoRoot $PathValue
}

function Find-LatestEvidence {
    foreach ($root in @(
        ".tmp/submission-evidence",
        ".tmp/teamrun-evidence"
    )) {
        $resolvedRoot = Join-Path $RepoRoot $root
        if (Test-Path -LiteralPath $resolvedRoot) {
            $candidates = Get-ChildItem -LiteralPath $resolvedRoot -Recurse -File -Filter "teamrun-evidence.json" -ErrorAction SilentlyContinue
            $latest = $candidates |
                Sort-Object LastWriteTimeUtc -Descending |
                Select-Object -First 1
            if ($latest) {
                return $latest
            }
        }
    }
    return $null
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

Step "Evidence file"
$resolvedEvidence = Resolve-RepoPath $EvidencePath
if (-not $resolvedEvidence) {
    $latest = Find-LatestEvidence
    if ($latest) {
        $resolvedEvidence = $latest.FullName
    }
}
if (-not $resolvedEvidence -or -not (Test-Path -LiteralPath $resolvedEvidence)) {
    Fail "teamrun evidence JSON exists"
} else {
    Pass "teamrun evidence JSON exists"
}

$evidence = $null
if ($resolvedEvidence -and (Test-Path -LiteralPath $resolvedEvidence)) {
    try {
        $evidence = Get-Content -Raw -LiteralPath $resolvedEvidence | ConvertFrom-Json
        Pass "teamrun evidence JSON parses"
    } catch {
        Fail "teamrun evidence JSON parses: $($_.Exception.Message)"
    }
}

if ($evidence) {
    Step "Evidence shape"
    foreach ($field in @("state", "tasks", "assignments", "events", "runtime_profiles")) {
        if ($null -ne $evidence.$field) {
            Pass "evidence contains $field"
        } else {
            Fail "evidence contains $field"
        }
    }

    $runtimeProfiles = Count-Items $evidence.runtime_profiles
    if ($runtimeProfiles -ge 2) {
        Pass "runtime_profiles contains at least two profiles"
    } else {
        Fail "runtime_profiles contains at least two profiles (actual: $runtimeProfiles)"
    }

    $runtimeTypes = 0
    if ($null -ne $evidence.counts -and $null -ne $evidence.counts.runtime_types) {
        $runtimeTypes = [int]$evidence.counts.runtime_types
    } elseif ($null -ne $evidence.runtime_profiles) {
        $runtimeTypes = @($evidence.runtime_profiles | ForEach-Object { $_.runtime_type } | Where-Object { $_ } | Sort-Object -Unique).Count
    }
    if ($runtimeTypes -ge 2) {
        Pass "evidence proves at least two runtime types"
    } else {
        Fail "evidence proves at least two runtime types (actual: $runtimeTypes)"
    }

    Step "Fixture boundary"
    if ($evidence.contract -eq "teamrun-demo-evidence-v1" -and $null -ne $evidence.source -and $evidence.source.fixture_only -eq $true) {
        Pass "fixture-only evidence contract"
    } else {
        Fail "fixture-only evidence contract"
    }

    if ($null -ne $evidence.claims -and $evidence.claims.real_runtime_executed -eq $false) {
        Pass "evidence does not claim real runtime execution"
    } else {
        Fail "evidence does not claim real runtime execution"
    }

    if ($null -ne $evidence.claims -and $evidence.claims.final_recording_complete -eq $false) {
        Pass "evidence does not claim final demo recording"
    } else {
        Fail "evidence does not claim final demo recording"
    }
}

Step "Manifest"
$resolvedManifest = Resolve-RepoPath $ManifestPath
$manifestRequired = $false
if (-not $resolvedManifest -and $resolvedEvidence) {
    $candidate = Join-Path (Split-Path -Parent $resolvedEvidence) "manifest.md"
    if (Test-Path -LiteralPath $candidate) {
        $resolvedManifest = $candidate
    }
}
$submissionRoot = Join-Path $RepoRoot ".tmp/submission-evidence"
if ($ManifestPath -or ($resolvedEvidence -and $resolvedEvidence.StartsWith($submissionRoot, [System.StringComparison]::OrdinalIgnoreCase))) {
    $manifestRequired = $true
}
if ($resolvedManifest -and (Test-Path -LiteralPath $resolvedManifest)) {
    Pass "submission manifest exists"
} elseif ($manifestRequired) {
    Fail "submission manifest exists"
} else {
    Pass "submission manifest not required for raw evidence readiness"
}

Step "Video"
$resolvedVideo = Resolve-RepoPath $VideoPath
if ($RequireVideo) {
    if ($resolvedVideo -and (Test-Path -LiteralPath $resolvedVideo)) {
        Pass "final demo video exists"
    } else {
        Fail "final demo video exists"
    }
} elseif ($resolvedVideo -and (Test-Path -LiteralPath $resolvedVideo)) {
    Pass "optional demo video exists"
} else {
    Pass "video not required for this offline readiness pass"
}

Write-Host "`nTeamRun demo readiness: $Passed passed, $Failed failed"
if ($Failed -gt 0) {
    exit 1
}
