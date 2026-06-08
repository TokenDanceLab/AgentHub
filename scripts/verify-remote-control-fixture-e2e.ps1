#!/usr/bin/env pwsh
<#
Exports and verifies the offline Remote-Control Fixture E2E evidence gate.

This gate is fixture-only by design. It does not run TokenDanceID login,
start Hub/Desktop/Edge services, invoke a real CLI/model, deploy, or touch
mobile. It proves the local chain shape and required evidence identifiers.
#>

[CmdletBinding()]
param(
    [string]$ScenarioManifest = "docs/competition/teamrun-demo-scenario.json",
    [string]$EvidencePath,
    [string]$OutputRoot = ".tmp/teamrun-evidence",
    [string]$Stamp
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Passed = 0
$Failed = 0

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Fail([string]$Text, [string]$Detail = "") {
    $script:Failed++
    Write-Host "  FAIL  $Text" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($Detail)) {
        Write-Host "        $Detail" -ForegroundColor DarkRed
    }
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

function Test-RequiredString($Object, [string]$Field, [string]$Label) {
    if ($null -ne $Object -and -not [string]::IsNullOrWhiteSpace([string]$Object.$Field)) {
        Pass "$Label contains $Field"
        return $true
    }
    Fail "$Label contains $Field"
    return $false
}

function Invoke-Script([string]$Path, [string[]]$Arguments) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $Path @Arguments 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output = $output
    }
}

function Get-EventById($Events, [string]$Id) {
    return @($Events | Where-Object { $_.id -eq $Id } | Select-Object -First 1)[0]
}

function Get-EventIdFromRef([string]$EventRef) {
    if ([string]::IsNullOrWhiteSpace($EventRef)) {
        return $null
    }
    $parts = $EventRef.Split(":")
    if ($parts.Count -lt 1) {
        return $null
    }
    return $parts[$parts.Count - 1]
}

function Test-EventRefResolves($Events, [string]$EventRef, [string]$Label) {
    if ([string]::IsNullOrWhiteSpace($EventRef)) {
        Fail "$Label is not blank"
        return $false
    }
    Pass "$Label is not blank"

    $eventId = Get-EventIdFromRef $EventRef
    if ([string]::IsNullOrWhiteSpace($eventId)) {
        Fail "$Label resolves to an evidence event"
        return $false
    }
    if ($null -ne (Get-EventById $Events $eventId)) {
        Pass "$Label resolves to an evidence event"
        return $true
    }
    Fail "$Label resolves to an evidence event" "eventRef=$EventRef"
    return $false
}

function Test-EventField($Events, [string]$Id, [string]$Field, [string]$Expected) {
    $event = Get-EventById $Events $Id
    if ($null -eq $event) {
        Fail "event $Id exists"
        return $false
    }
    if ([string]$event.$Field -eq $Expected) {
        Pass "event $Id carries $Field"
        return $true
    }
    Fail "event $Id carries $Field" "expected=$Expected actual=$($event.$Field)"
    return $false
}

if ([string]::IsNullOrWhiteSpace($Stamp)) {
    $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
}

$exporterPath = Join-Path $RepoRoot "scripts\export-teamrun-demo-fixture-evidence.ps1"
$readinessPath = Join-Path $RepoRoot "scripts\verify-teamrun-demo-readiness.ps1"

Step "Fixture boundary"
Pass "FixtureRehearsal only: no TokenDanceID, real CLI/model, deployment, or mobile"

$resolvedEvidence = Resolve-RepoPath $EvidencePath
if (-not $resolvedEvidence) {
    Step "Export fixture evidence"
    $exportRun = Invoke-Script $exporterPath @(
        "-ScenarioManifest", (Resolve-RepoPath $ScenarioManifest),
        "-OutputRoot", (Resolve-RepoPath $OutputRoot),
        "-Stamp", $Stamp
    )
    if ($exportRun.ExitCode -eq 0) {
        Pass "fixture exporter exits successfully"
    } else {
        Fail "fixture exporter exits successfully" $exportRun.Output
    }
    $resolvedEvidence = Join-Path (Resolve-RepoPath $OutputRoot) "teamrun-demo-$Stamp\teamrun-evidence.json"
}

Step "Evidence file"
if ($resolvedEvidence -and (Test-Path -LiteralPath $resolvedEvidence)) {
    Pass "remote-control fixture evidence exists"
} else {
    Fail "remote-control fixture evidence exists" "path=$resolvedEvidence"
}

$evidence = $null
if ($resolvedEvidence -and (Test-Path -LiteralPath $resolvedEvidence)) {
    try {
        $evidence = Get-Content -Raw -LiteralPath $resolvedEvidence | ConvertFrom-Json
        Pass "remote-control fixture evidence parses"
    } catch {
        Fail "remote-control fixture evidence parses" $_.Exception.Message
    }
}

if ($evidence) {
    Step "Readiness mode"
    $readinessRun = Invoke-Script $readinessPath @(
        "-EvidencePath", $resolvedEvidence,
        "-Mode", "FixtureRehearsal"
    )
    if ($readinessRun.ExitCode -eq 0) {
        Pass "TeamRun readiness accepts FixtureRehearsal evidence"
    } else {
        Fail "TeamRun readiness accepts FixtureRehearsal evidence" $readinessRun.Output
    }

    if ($evidence.source.fixture_only -eq $true) {
        Pass "evidence is marked fixture_only"
    } else {
        Fail "evidence is marked fixture_only"
    }
    if ($evidence.claims.real_runtime_executed -eq $false -and
        $evidence.claims.live_hub_runtime_verified -eq $false -and
        $evidence.claims.final_recording_complete -eq $false -and
        $evidence.claims.submission_ready -eq $false) {
        Pass "FixtureRehearsal keeps RealTested and Submission claims false"
    } else {
        Fail "FixtureRehearsal keeps RealTested and Submission claims false"
    }

    Step "Remote-control manifest"
    $manifest = $evidence.remote_control_manifest
    if ($null -eq $manifest) {
        Fail "remote-control manifest is present"
    } else {
        Pass "remote-control manifest is present"
        foreach ($field in @("hubTaskId", "targetId", "edgeDeviceId", "edgeRunId", "adapterId", "mode", "startedAt")) {
            [void](Test-RequiredString $manifest $field "remote-control manifest")
        }
        if ($manifest.mode -eq "FixtureRehearsal") {
            Pass "remote-control manifest mode is FixtureRehearsal"
        } else {
            Fail "remote-control manifest mode is FixtureRehearsal" "actual=$($manifest.mode)"
        }
        if (Count-Items $manifest.eventRefs -ge 4) {
            Pass "remote-control manifest contains eventRefs for the chain"
        } else {
            Fail "remote-control manifest contains eventRefs for the chain"
        }
        foreach ($eventRef in @($manifest.eventRefs)) {
            [void](Test-EventRefResolves $evidence.events ([string]$eventRef) "remote-control eventRef")
        }
    }

    if ($manifest) {
        Step "Local chain shape"
        $requiredStages = @(
            @{ Stage = "web_start"; Label = "Web starts TeamRun with target_id" },
            @{ Stage = "hub_exact_route"; Label = "Hub exact-routes to Desktop/Edge target" },
            @{ Stage = "desktop_bridge_start"; Label = "Desktop bridge starts Local Edge run fixture" },
            @{ Stage = "edge_events_callback"; Label = "Edge emits/callbacks fixture events" },
            @{ Stage = "adapter_callback_result"; Label = "Adapter result/callback is emitted" },
            @{ Stage = "hub_replay"; Label = "Hub replay records completed fixture chain" },
            @{ Stage = "manifest_validated"; Label = "FixtureRehearsal manifest validates" }
        )
        $chain = @($manifest.chain)
        $lastIndex = -1
        foreach ($required in $requiredStages) {
            $index = -1
            for ($i = 0; $i -lt $chain.Count; $i++) {
                if ($chain[$i].stage -eq $required.Stage) {
                    $index = $i
                    break
                }
            }
            if ($index -gt $lastIndex) {
                Pass $required.Label
                $lastIndex = $index
            } else {
                Fail $required.Label
            }
        }
        foreach ($stage in $chain) {
            $eventRef = [string]$stage.eventRef
            [void](Test-EventRefResolves $evidence.events $eventRef "chain stage $($stage.stage) eventRef")
            if (@($manifest.eventRefs) -contains $eventRef) {
                Pass "chain stage $($stage.stage) eventRef is listed in manifest eventRefs"
            } else {
                Fail "chain stage $($stage.stage) eventRef is listed in manifest eventRefs"
            }
        }

        if ($evidence.state.target_id -eq $manifest.targetId) {
            Pass "TeamRun state carries the same target_id"
        } else {
            Fail "TeamRun state carries the same target_id"
        }
        if ($evidence.state.edge_device_id -eq $manifest.edgeDeviceId) {
            Pass "TeamRun state carries the exact Desktop/Edge device"
        } else {
            Fail "TeamRun state carries the exact Desktop/Edge device"
        }

        $task = @($evidence.tasks | Where-Object { $_.id -eq $manifest.hubTaskId } | Select-Object -First 1)[0]
        if ($null -ne $task) {
            Pass "Hub task named by manifest exists"
            foreach ($pair in @(
                @{ Field = "target_id"; Expected = $manifest.targetId },
                @{ Field = "edge_device_id"; Expected = $manifest.edgeDeviceId },
                @{ Field = "edge_run_id"; Expected = $manifest.edgeRunId },
                @{ Field = "adapter_id"; Expected = $manifest.adapterId }
            )) {
                if ([string]$task.($pair.Field) -eq [string]$pair.Expected) {
                    Pass "Hub task carries $($pair.Field)"
                } else {
                    Fail "Hub task carries $($pair.Field)" "expected=$($pair.Expected) actual=$($task.($pair.Field))"
                }
            }
        } else {
            Fail "Hub task named by manifest exists"
        }

        [void](Test-EventField $evidence.events "evt-remote-001" "target_id" $manifest.targetId)
        [void](Test-EventField $evidence.events "evt-remote-002" "edge_device_id" $manifest.edgeDeviceId)
        [void](Test-EventField $evidence.events "evt-remote-004" "edge_run_id" $manifest.edgeRunId)
        [void](Test-EventField $evidence.events "evt-remote-004" "adapter_id" $manifest.adapterId)
        [void](Test-EventField $evidence.events "evt-remote-005" "edge_run_id" $manifest.edgeRunId)
        [void](Test-EventField $evidence.events "evt-remote-005" "adapter_id" $manifest.adapterId)
        [void](Test-EventField $evidence.events "evt-remote-006" "edge_run_id" $manifest.edgeRunId)
    }

    Step "Requirement/evidence matrix"
    $matrix = @($evidence.evidence_matrix)
    $requiredMatrixItems = @(
        "im_or_teamrun_start",
        "target_id",
        "exact_desktop_edge_device",
        "edge_run_id",
        "adapter_id",
        "route_task_event_replay",
        "transcript_render_evidence",
        "artifact_diff_preview",
        "mode_labels"
    )
    foreach ($item in $requiredMatrixItems) {
        $row = @($matrix | Where-Object { $_.requirement_id -eq $item } | Select-Object -First 1)[0]
        if ($null -eq $row) {
            Fail "matrix includes $item"
            continue
        }
        Pass "matrix includes $item"
        if (-not [string]::IsNullOrWhiteSpace([string]$row.fixture_evidence)) {
            Pass "matrix $item has fixture evidence"
        } else {
            Fail "matrix $item has fixture evidence"
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$row.real_tested_requirement)) {
            Pass "matrix $item has RealTested requirement"
        } else {
            Fail "matrix $item has RealTested requirement"
        }
        if ($row.mode_label -eq "FixtureRehearsal") {
            Pass "matrix $item labels FixtureRehearsal"
        } else {
            Fail "matrix $item labels FixtureRehearsal"
        }
    }
}

Write-Host "`nRemote-control fixture E2E gate: $Passed passed, $Failed failed"
if ($Failed -gt 0) {
    exit 1
}
