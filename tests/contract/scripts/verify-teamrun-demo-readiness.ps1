param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path
$Failed = 0

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message,
        [string]$Details = ""
    )

    if ($Condition) {
        Write-Host "PASS: $Message" -ForegroundColor Green
        return
    }

    $script:Failed++
    Write-Host "FAIL: $Message" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($Details)) {
        Write-Host $Details
    }
}

function Invoke-Readiness {
    param([string[]]$Arguments)

    $scriptPath = Join-Path $RepoRoot "scripts\verify-teamrun-demo-readiness.ps1"
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath @Arguments 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output = $output
    }
}

function New-Evidence {
    param(
        [ValidateSet("FixtureRehearsal", "Mock", "RealTested", "Submission")]
        [string]$Mode,
        [bool]$FixtureOnly = $false,
        [bool]$MockOnly = $false,
        [bool]$WithRealProof = $false,
        [bool]$WithSubmissionClaims = $false
    )

    $claims = [ordered]@{
        real_runtime_executed = $WithRealProof
        final_recording_complete = $WithSubmissionClaims
        live_hub_runtime_verified = $WithRealProof
        submission_ready = $WithSubmissionClaims
    }

    $evidence = [ordered]@{
        contract = "teamrun-demo-evidence-v1"
        source = [ordered]@{
            fixture_only = $FixtureOnly
            mock_only = $MockOnly
        }
        claims = $claims
        remote_control_manifest = [ordered]@{
            hubTaskId = "hub-task-001"
            targetId = "target-desktop-edge-001"
            edgeDeviceId = "desktop-edge-device-001"
            edgeRunId = "edge-run-001"
            adapterId = "codex-cli-adapter"
            mode = $Mode
            startedAt = "2026-06-09T00:00:00+08:00"
            eventRefs = @(
                "hub:agent.dispatch:evt-001",
                "desktop-edge:task.accepted:evt-002",
                "local-edge:run.started:evt-003",
                "adapter:run.completed:evt-004"
            )
            redaction = [ordered]@{
                status = "redacted"
                checkedAt = "2026-06-09T00:05:00+08:00"
            }
        }
        state = [ordered]@{
            team_id = "team-p0"
            team_run_id = "teamrun-p0"
            status = "completed"
        }
        tasks = @(
            [ordered]@{ id = "hub-task-001"; role = "supervisor"; status = "completed" },
            [ordered]@{ id = "hub-task-002"; role = "worker"; status = "completed" }
        )
        assignments = @(
            [ordered]@{ id = "assign-001"; role = "supervisor"; status = "completed" },
            [ordered]@{ id = "assign-002"; role = "worker"; status = "completed" }
        )
        events = @(
            [ordered]@{ id = "evt-001"; type = "agent.dispatch" },
            [ordered]@{ id = "evt-002"; type = "desktop.edge.dispatch.accepted" },
            [ordered]@{ id = "evt-003"; type = "edge.run.started" },
            [ordered]@{ id = "evt-004"; type = "run.agent.result" }
        )
        runtime_profiles = @(
            [ordered]@{ id = "profile-supervisor"; runtime_type = "codex" },
            [ordered]@{ id = "profile-worker"; runtime_type = "opencode" }
        )
        screenshot_or_video_rehearsal = [ordered]@{
            mode = "remote_control_chain"
            real_runtime_executed = $WithRealProof
            final_recording_complete = $WithSubmissionClaims
            submission_ready = $WithSubmissionClaims
        }
    }

    if ($WithRealProof) {
        $evidence.real_proof = [ordered]@{
            webActionRef = "screenshot:web-start-teamrun.png"
            hubDispatchRef = "api:/web/agent-teams/team-p0/runs/teamrun-p0/events#evt-001"
            desktopEdgeRef = "desktop-edge-log:dispatch-accepted"
            localEdgeRunRef = "local-edge:/v1/runs/edge-run-001"
            cliAdapterRef = "adapter-log:codex-cli-adapter-run-001"
            hubStateExportRef = "api:/web/agent-teams/team-p0/runs/teamrun-p0/state"
        }
    }

    return $evidence
}

function Write-Evidence {
    param(
        [object]$Evidence,
        [string]$Path
    )
    $Evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-teamrun-readiness-$PID"
Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null

$mockPath = Join-Path $tmpRoot "mock-evidence.json"
Write-Evidence (New-Evidence -Mode "Mock" -MockOnly $true) $mockPath
$mockRun = Invoke-Readiness -Arguments @("-EvidencePath", $mockPath, "-Mode", "Mock")
Assert-True ($mockRun.ExitCode -eq 0) "mock evidence passes only Mock mode" $mockRun.Output

$mockSubmission = Invoke-Readiness -Arguments @("-EvidencePath", $mockPath, "-Mode", "Submission")
Assert-True ($mockSubmission.ExitCode -ne 0) "mock evidence is blocked from Submission mode" $mockSubmission.Output
Assert-True ($mockSubmission.Output -match "submission mode rejects mock-only evidence") "submission block names mock-only evidence" $mockSubmission.Output

$realMissingProofPath = Join-Path $tmpRoot "real-missing-proof.json"
Write-Evidence (New-Evidence -Mode "RealTested" -WithRealProof $false) $realMissingProofPath
$realMissingProofRun = Invoke-Readiness -Arguments @("-EvidencePath", $realMissingProofPath, "-Mode", "RealTested")
Assert-True ($realMissingProofRun.ExitCode -ne 0) "RealTested evidence fails without explicit proof refs" $realMissingProofRun.Output
Assert-True ($realMissingProofRun.Output -match "real evidence requires real_proof") "RealTested failure names missing real proof" $realMissingProofRun.Output

$realPath = Join-Path $tmpRoot "real-tested-evidence.json"
Write-Evidence (New-Evidence -Mode "RealTested" -WithRealProof $true) $realPath
$realRun = Invoke-Readiness -Arguments @("-EvidencePath", $realPath, "-Mode", "RealTested")
Assert-True ($realRun.ExitCode -eq 0) "RealTested evidence passes with explicit proof refs" $realRun.Output

$badManifest = New-Evidence -Mode "RealTested" -WithRealProof $true
$badManifest.remote_control_manifest.edgeRunId = ""
$badManifestPath = Join-Path $tmpRoot "bad-manifest.json"
Write-Evidence $badManifest $badManifestPath
$badManifestRun = Invoke-Readiness -Arguments @("-EvidencePath", $badManifestPath, "-Mode", "RealTested")
Assert-True ($badManifestRun.ExitCode -ne 0) "remote-control manifest requires edgeRunId" $badManifestRun.Output
Assert-True ($badManifestRun.Output -match "remote-control manifest contains edgeRunId") "manifest failure names missing edgeRunId" $badManifestRun.Output

$submissionPath = Join-Path $tmpRoot "submission-evidence.json"
Write-Evidence (New-Evidence -Mode "Submission" -WithRealProof $true -WithSubmissionClaims $true) $submissionPath
$videoPath = Join-Path $tmpRoot "demo.mp4"
Set-Content -LiteralPath $videoPath -Value "placeholder-video-bytes" -Encoding ASCII
$submissionRun = Invoke-Readiness -Arguments @("-EvidencePath", $submissionPath, "-Mode", "Submission", "-VideoPath", $videoPath)
Assert-True ($submissionRun.ExitCode -eq 0) "Submission evidence passes only with real proof and video" $submissionRun.Output

if ($Failed -gt 0) {
    exit 1
}
exit 0
