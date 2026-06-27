#!/usr/bin/env pwsh
[CmdletBinding()]
param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$Failed = 0
$TempRoots = @()

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

function Join-NativeArguments {
    param([string[]]$Arguments)

    $quoted = foreach ($arg in $Arguments) {
        if ($null -eq $arg) { '""'; continue }
        if ($arg -notmatch '[\s"]' -and $arg.Length -gt 0) { $arg; continue }
        '"' + ($arg -replace '"', '\"') + '"'
    }
    return ($quoted -join " ")
}

function Invoke-RepoScript {
    param([string[]]$Arguments)

    $pwsh = Get-Command "pwsh" -ErrorAction SilentlyContinue
    $powershellExe = if ($pwsh) { $pwsh.Source } else { "" }
    if (-not $powershellExe) {
        $powershell = Get-Command "powershell" -ErrorAction SilentlyContinue
        $powershellExe = if ($powershell) { $powershell.Source } else { "" }
    }

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $powershellExe
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $RepoRoot
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + (Join-NativeArguments $Arguments)

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
}

function New-ObservedManifestWithoutWebRender {
    param([string]$Path)

    $manifest = [ordered]@{
        schema = "agenthub-observed-localhost-dispatch-v1"
        evidence_origin = "observed_hub_manifest"
        approval_gate = "observed-localhost-dispatch-approved"
        real_tested = $true
        target_registration = [ordered]@{
            event_ref = "evt-target"
            target_id = "target-local-edge"
            edge_device_id = "device-1"
            target_kind = "registered_desktop_bridge"
            desktop_bridge_url = "http://127.0.0.1:5173"
        }
        dispatch = [ordered]@{
            event_ref = "evt-dispatch"
            hub_task_id = "task-1"
            target_id = "target-local-edge"
            edge_device_id = "device-1"
            dispatch_target_url = "http://127.0.0.1:5173"
        }
        desktop_accept = [ordered]@{
            event_ref = "evt-desktop"
            hub_task_id = "task-1"
            target_id = "target-local-edge"
            edge_device_id = "device-1"
            desktop_bridge_url = "http://127.0.0.1:5173"
            local_edge_url = "http://127.0.0.1:3210"
        }
        edge_run = [ordered]@{
            event_ref = "evt-edge"
            hub_task_id = "task-1"
            target_id = "target-local-edge"
            edge_device_id = "device-1"
            edge_run_id = "run-1"
            adapter_id = "codex"
        }
        hub_replay = [ordered]@{
            event_ref = "evt-replay"
            replay_ref = "evt-replay"
            hub_task_id = "task-1"
            target_id = "target-local-edge"
            edge_device_id = "device-1"
            edge_run_id = "run-1"
            adapter_id = "codex"
            team_run_id = "team-run-1"
        }
        events = @(
            [ordered]@{ id = "evt-target"; type = "target.registered"; observed = $true },
            [ordered]@{ id = "evt-dispatch"; type = "hub.agent.dispatch"; observed = $true },
            [ordered]@{ id = "evt-desktop"; type = "desktop.dispatch.accepted"; observed = $true },
            [ordered]@{ id = "evt-edge"; type = "edge.run.started"; observed = $true },
            [ordered]@{ id = "evt-replay"; type = "hub.replay.recorded"; observed = $true }
        )
    }

    $manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}

try {
    $scriptPath = Join-Path $RepoRoot "scripts\smoke\verify-product-loop-qa.ps1"
    $observedPath = Join-Path $RepoRoot "scripts\smoke\verify-observed-localhost-dispatch.ps1"
    $scriptImplementationPath = Join-Path $RepoRoot "scripts\smoke\verify-product-loop-qa.ps1"
    $observedImplementationPath = Join-Path $RepoRoot "scripts\smoke\verify-observed-localhost-dispatch.ps1"
    Assert-True (Test-Path -LiteralPath $scriptPath) "product-loop QA umbrella exists"
    Assert-True (Test-Path -LiteralPath $observedPath) "observed dispatch verifier exists"
    Assert-True (Test-Path -LiteralPath $scriptImplementationPath) "product-loop QA umbrella implementation exists"
    Assert-True (Test-Path -LiteralPath $observedImplementationPath) "observed dispatch verifier implementation exists"

    $scriptText = Get-Content -Raw -LiteralPath $scriptImplementationPath
    Assert-True ($scriptText -match 'agenthub-product-loop-qa-v1') "umbrella writes product-loop QA schema"
    Assert-True ($scriptText -match 'ApprovedReal requires -ApproveRealEvidence') "ApprovedReal fails closed without approval"
    Assert-True ($scriptText -match 'verify-approved-real-edge-cli-evidence\.ps1') "umbrella composes approved-real CLI evidence verifier"

    $observedText = Get-Content -Raw -LiteralPath $observedImplementationPath
    Assert-True ($observedText -match 'web_render') "observed verifier requires Web render section"
    Assert-True ($observedText -match 'web\.replay\.rendered') "observed verifier requires rendered replay event"
    Assert-True ($observedText -match 'Web render source must be hub-replay') "observed verifier requires Hub replay render source"

    $artifactRoot = Join-Path $RepoRoot ".tmp\product-loop-qa\script-test-$PID"
    Remove-Item -LiteralPath $artifactRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
    $TempRoots += $artifactRoot

    $fixtureRun = Invoke-RepoScript @(
        $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-Mode", "FixtureOnly",
        "-ArtifactRoot", $artifactRoot
    )
    Assert-True ($fixtureRun.ExitCode -eq 0) "FixtureOnly product-loop QA passes" $fixtureRun.Output
    Assert-True ($fixtureRun.Output -match "PRODUCT_LOOP_QA_PASSED") "FixtureOnly output has pass status" $fixtureRun.Output

    $reportPath = Join-Path $artifactRoot "product-loop-qa.json"
    Assert-True (Test-Path -LiteralPath $reportPath) "FixtureOnly report is written"
    if (Test-Path -LiteralPath $reportPath) {
        $report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
        Assert-True ($report.schema -eq "agenthub-product-loop-qa-v1") "FixtureOnly report schema is product-loop QA v1"
        Assert-True ($report.real_tested -eq $false) "FixtureOnly keeps RealTested false"
    }

    $approvedMissing = Invoke-RepoScript @(
        $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-Mode", "ApprovedReal",
        "-ArtifactRoot", (Join-Path $RepoRoot ".tmp\product-loop-qa\approved-missing-$PID")
    )
    Assert-True ($approvedMissing.ExitCode -ne 0) "ApprovedReal without evidence fails closed" $approvedMissing.Output
    Assert-True ($approvedMissing.Output -match "ApprovedReal requires -ApproveRealEvidence") "ApprovedReal missing approval is explicit" $approvedMissing.Output
    Assert-True ($approvedMissing.Output -match "ApprovedReal requires -ObservedEvidencePath") "ApprovedReal missing observed manifest is explicit" $approvedMissing.Output
    Assert-True ($approvedMissing.Output -match "ApprovedReal requires -ApprovedCliManifest") "ApprovedReal missing CLI manifest is explicit" $approvedMissing.Output

    $observedRoot = Join-Path $RepoRoot ".tmp\product-loop-qa\observed-missing-web-$PID"
    New-Item -ItemType Directory -Force -Path $observedRoot | Out-Null
    $TempRoots += $observedRoot
    $manifestWithoutWeb = Join-Path $observedRoot "observed-without-web-render.json"
    $observedReport = Join-Path $observedRoot "observed-report.json"
    New-ObservedManifestWithoutWebRender $manifestWithoutWeb

    $observedRun = Invoke-RepoScript @(
        $observedPath,
        "-RepoRoot", $RepoRoot,
        "-ObservedEvidencePath", $manifestWithoutWeb,
        "-EvidencePath", $observedReport,
        "-AllowRealTestedApproval"
    )
    Assert-True ($observedRun.ExitCode -ne 0) "observed dispatch without Web render fails closed" $observedRun.Output
    Assert-True ($observedRun.Output -match "missing observed Web render proof") "missing Web render failure is explicit" $observedRun.Output
}
finally {
    foreach ($path in $TempRoots) {
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
