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
    [ValidateSet("Submission", "FixtureRehearsal", "Mock", "RealTested")]
    [string]$Mode = "Submission",
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

function Test-RequiredString($Object, [string]$Field, [string]$Label) {
    if ($null -ne $Object -and -not [string]::IsNullOrWhiteSpace([string]$Object.$Field)) {
        Pass "$Label contains $Field"
        return $true
    }
    Fail "$Label contains $Field"
    return $false
}

function Test-RealProof($Evidence, [bool]$SubmissionMode) {
    $ok = $true
    $requiredProofFields = @(
        "webActionRef",
        "hubDispatchRef",
        "desktopEdgeRef",
        "localEdgeRunRef",
        "cliAdapterRef",
        "hubStateExportRef"
    )

    if ($null -eq $Evidence.real_proof) {
        Fail "real evidence requires real_proof"
        $ok = $false
    } else {
        Pass "real evidence requires real_proof"
        foreach ($field in $requiredProofFields) {
            if (-not (Test-RequiredString $Evidence.real_proof $field "real_proof")) {
                $ok = $false
            }
        }
    }

    if ($Evidence.claims.real_runtime_executed -eq $true) {
        Pass "real evidence has real_runtime_executed=true"
    } else {
        Fail "real evidence requires real_runtime_executed=true"
        $ok = $false
    }
    if ($Evidence.claims.live_hub_runtime_verified -eq $true) {
        Pass "real evidence has live_hub_runtime_verified=true"
    } else {
        Fail "real evidence requires live_hub_runtime_verified=true"
        $ok = $false
    }

    if ($SubmissionMode) {
        if ($Evidence.claims.final_recording_complete -eq $true) {
            Pass "submission mode has final recording claim"
        } else {
            Fail "submission mode requires final_recording_complete=true"
            $ok = $false
        }
        if ($Evidence.claims.submission_ready -eq $true) {
            Pass "submission mode has submission-ready claim"
        } else {
            Fail "submission mode requires submission_ready=true"
            $ok = $false
        }
    }

    return $ok
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
    $fixtureOnly = $false
    if ($null -ne $evidence.source -and $evidence.source.fixture_only -eq $true) {
        $fixtureOnly = $true
    }
    $mockOnly = $false
    if ($null -ne $evidence.source -and $evidence.source.mock_only -eq $true) {
        $mockOnly = $true
    }
    if ($null -ne $evidence.remote_control_manifest -and $evidence.remote_control_manifest.mode -eq "Mock") {
        $mockOnly = $true
    }

    Step "Evidence shape"
    foreach ($field in @("state", "tasks", "assignments", "events", "runtime_profiles", "screenshot_or_video_rehearsal")) {
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

    Step "Remote-control evidence manifest"
    $remoteManifestRequired = ($Mode -ne "FixtureRehearsal" -or $null -ne $evidence.remote_control_manifest)
    if (-not $remoteManifestRequired) {
        Pass "remote-control manifest not required for legacy fixture rehearsal"
    } elseif ($null -eq $evidence.remote_control_manifest) {
        Fail "remote-control manifest is present"
    } else {
        Pass "remote-control manifest is present"
        $manifest = $evidence.remote_control_manifest
        foreach ($field in @("hubTaskId", "targetId", "edgeDeviceId", "edgeRunId", "adapterId", "mode", "startedAt")) {
            [void](Test-RequiredString $manifest $field "remote-control manifest")
        }
        $eventRefCount = Count-Items $manifest.eventRefs
        if ($eventRefCount -ge 4) {
            Pass "remote-control manifest contains eventRefs for the chain"
        } else {
            Fail "remote-control manifest contains eventRefs for the chain (actual: $eventRefCount)"
        }
        if ($null -ne $manifest.redaction -and -not [string]::IsNullOrWhiteSpace([string]$manifest.redaction.status)) {
            Pass "remote-control manifest contains redaction status"
            if (@("redacted", "not_required") -contains [string]$manifest.redaction.status) {
                Pass "remote-control manifest redaction status is acceptable"
            } else {
                Fail "remote-control manifest redaction status is acceptable"
            }
        } else {
            Fail "remote-control manifest contains redaction status"
        }
        if ($manifest.mode -eq $Mode) {
            Pass "remote-control manifest mode matches readiness mode"
        } else {
            Fail "remote-control manifest mode matches readiness mode"
        }
    }

    Step "Evidence taxonomy"
    if ($evidence.contract -eq "teamrun-demo-evidence-v1") {
        Pass "teamrun evidence contract"
    } else {
        Fail "teamrun evidence contract"
    }

    if ($fixtureOnly) {
        Pass "fixture-only source is declared"
    } else {
        Pass "source is not marked fixture-only"
    }

    if ($null -eq $evidence.claims) {
        Fail "evidence claims are present"
    } else {
        Pass "evidence claims are present"

        if ($fixtureOnly -and (
                $evidence.claims.real_runtime_executed -ne $false -or
                $evidence.claims.final_recording_complete -ne $false -or
                $evidence.claims.submission_ready -ne $false)) {
            Fail "fixture evidence cannot claim real runtime, final recording, or submission readiness"
        } elseif ($fixtureOnly) {
            Pass "fixture evidence keeps runtime, recording, and submission claims false"
        }

        if ($Mode -eq "FixtureRehearsal") {
            if ($fixtureOnly -and
                $evidence.claims.real_runtime_executed -eq $false -and
                $evidence.claims.final_recording_complete -eq $false -and
                $evidence.claims.submission_ready -eq $false) {
                Pass "fixture rehearsal mode accepts honest fixture claims"
            } else {
                Fail "fixture rehearsal mode requires honest fixture claims"
            }
        } elseif ($Mode -eq "Mock") {
            if ($mockOnly -and
                $evidence.claims.real_runtime_executed -eq $false -and
                $evidence.claims.final_recording_complete -eq $false -and
                $evidence.claims.submission_ready -eq $false) {
                Pass "mock mode accepts honest mock claims"
            } else {
                Fail "mock mode requires mock-only evidence with real, recording, and submission claims false"
            }
        } elseif ($Mode -eq "RealTested") {
            if ($fixtureOnly) {
                Fail "real-tested mode rejects fixture-only evidence"
            } else {
                Pass "real-tested mode evidence is not fixture-only"
            }
            if ($mockOnly) {
                Fail "real-tested mode rejects mock-only evidence"
            } else {
                Pass "real-tested mode evidence is not mock-only"
            }
            [void](Test-RealProof $evidence $false)
        } else {
            if ($fixtureOnly) {
                Fail "submission mode rejects fixture-only evidence"
            } else {
                Pass "submission mode evidence is not fixture-only"
            }
            if ($mockOnly) {
                Fail "submission mode rejects mock-only evidence"
            } else {
                Pass "submission mode evidence is not mock-only"
            }
            [void](Test-RealProof $evidence $true)
        }
    }

    if ($null -ne $evidence.screenshot_or_video_rehearsal) {
        if ($fixtureOnly -and (
                $evidence.screenshot_or_video_rehearsal.real_runtime_executed -ne $false -or
                $evidence.screenshot_or_video_rehearsal.final_recording_complete -ne $false -or
                $evidence.screenshot_or_video_rehearsal.submission_ready -ne $false)) {
            Fail "fixture screenshot/video rehearsal metadata keeps readiness claims false"
        } else {
            Pass "screenshot/video rehearsal metadata is honest"
        }
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
$videoRequired = $false
if ($RequireVideo -or $Mode -eq "Submission") {
    $videoRequired = $true
}
if ($videoRequired) {
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
