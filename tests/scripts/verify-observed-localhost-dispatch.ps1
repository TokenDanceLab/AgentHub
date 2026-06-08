[CmdletBinding()]
param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
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

function Join-NativeArguments {
    param([string[]]$Arguments)

    $quoted = foreach ($arg in $Arguments) {
        if ($null -eq $arg) {
            '""'
            continue
        }
        if ($arg -notmatch '[\s"]' -and $arg.Length -gt 0) {
            $arg
            continue
        }

        $builder = [System.Text.StringBuilder]::new()
        [void]$builder.Append('"')
        $slashes = 0
        foreach ($char in $arg.ToCharArray()) {
            if ($char -eq '\') {
                $slashes++
                continue
            }
            if ($char -eq '"') {
                [void]$builder.Append(('\' * (($slashes * 2) + 1)))
                [void]$builder.Append('"')
                $slashes = 0
                continue
            }
            if ($slashes -gt 0) {
                [void]$builder.Append(('\' * $slashes))
                $slashes = 0
            }
            [void]$builder.Append($char)
        }
        if ($slashes -gt 0) {
            [void]$builder.Append(('\' * ($slashes * 2)))
        }
        [void]$builder.Append('"')
        $builder.ToString()
    }

    return ($quoted -join " ")
}

function Invoke-RepoScript {
    param([string[]]$Arguments)

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "powershell"
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

function New-ObservedManifest {
    param(
        [switch]$CallerOnly,
        [switch]$MissingDispatch,
        [switch]$DirectLocalEdge,
        [switch]$ForgedReplay,
        [switch]$ClaimRealTested
    )

    $desktopUrl = "http://127.0.0.1:5173"
    $edgeUrl = "http://127.0.0.1:3210"
    $targetKind = "desktop_bridge"
    $dispatchTargetUrl = $desktopUrl
    if ($DirectLocalEdge) {
        $targetKind = "local_edge"
        $dispatchTargetUrl = $edgeUrl
    }

    if ($CallerOnly) {
        return [ordered]@{
            schema = "agenthub-localhost-real-services-v1"
            evidence_origin = "caller_params"
            real_tested = $false
            topology = [ordered]@{
                hub = [ordered]@{
                    registered_target_url = $desktopUrl
                    dispatch_target_url = $desktopUrl
                }
                desktop_bridge = [ordered]@{ url = $desktopUrl }
                local_edge = [ordered]@{ url = $edgeUrl }
            }
        }
    }

    $events = @(
        [ordered]@{ id = "evt-001"; type = "target.registered"; actor = "hub"; source = "hub.target_registry"; observed = $true },
        [ordered]@{ id = "evt-002"; type = "web.teamrun.start"; actor = "web"; source = "hub.web_intake"; observed = $true },
        [ordered]@{ id = "evt-003"; type = "hub.agent.dispatch"; actor = "hub"; source = "hub.dispatch_log"; observed = $true },
        [ordered]@{ id = "evt-004"; type = "desktop.dispatch.accepted"; actor = "desktop"; source = "desktop.bridge_log"; observed = $true },
        [ordered]@{ id = "evt-005"; type = "edge.run.started"; actor = "desktop-local-edge"; source = "edge.run_log"; observed = $true },
        [ordered]@{ id = "evt-006"; type = "hub.replay.recorded"; actor = "hub"; source = "hub.replay_store"; observed = $true }
    )
    if ($MissingDispatch) {
        $events = @($events | Where-Object { $_.type -ne "hub.agent.dispatch" })
    }

    $replayEventRef = if ($ForgedReplay) { "evt-forged" } else { "evt-006" }
    $replayEdgeRunId = if ($ForgedReplay) { "edge-run-forged" } else { "edge-run-observed-001" }

    return [ordered]@{
        schema = "agenthub-observed-localhost-dispatch-v1"
        evidence_origin = "observed_hub_manifest"
        real_tested = [bool]$ClaimRealTested
        approval_gate = if ($ClaimRealTested) { "missing-operator-approval" } else { "" }
        topology = [ordered]@{
            web = [ordered]@{ url = "http://127.0.0.1:5174" }
            hub = [ordered]@{ url = "http://127.0.0.1:8080" }
            desktop_bridge = [ordered]@{ url = $desktopUrl }
            local_edge = [ordered]@{ url = $edgeUrl }
        }
        target_registration = [ordered]@{
            target_id = "target-observed-001"
            edge_device_id = "desktop-device-001"
            target_kind = $targetKind
            desktop_bridge_url = $desktopUrl
            source = "hub.target_registry"
            event_ref = "evt-001"
        }
        dispatch = if ($MissingDispatch) {
            $null
        } else {
            [ordered]@{
                hub_task_id = "task-observed-001"
                target_id = "target-observed-001"
                edge_device_id = "desktop-device-001"
                dispatch_target_url = $dispatchTargetUrl
                source = "hub.dispatch_log"
                event_ref = "evt-003"
            }
        }
        desktop_accept = [ordered]@{
            hub_task_id = "task-observed-001"
            target_id = "target-observed-001"
            edge_device_id = "desktop-device-001"
            desktop_bridge_url = $desktopUrl
            local_edge_url = $edgeUrl
            source = "desktop.bridge_log"
            event_ref = "evt-004"
        }
        edge_run = [ordered]@{
            hub_task_id = "task-observed-001"
            target_id = "target-observed-001"
            edge_device_id = "desktop-device-001"
            edge_run_id = "edge-run-observed-001"
            adapter_id = "fixture-sdk-adapter"
            source = "edge.run_log"
            event_ref = "evt-005"
        }
        hub_replay = [ordered]@{
            team_run_id = "teamrun-observed-001"
            hub_task_id = "task-observed-001"
            target_id = "target-observed-001"
            edge_device_id = "desktop-device-001"
            edge_run_id = $replayEdgeRunId
            adapter_id = "fixture-sdk-adapter"
            replay_ref = $replayEventRef
            source = "hub.replay_store"
            event_ref = $replayEventRef
        }
        events = $events
    }
}

function Write-Manifest {
    param(
        [object]$Manifest,
        [string]$Path
    )

    $Manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Assert-Fails {
    param(
        [string]$Name,
        [object]$Manifest,
        [string]$ExpectedText
    )

    $manifestPath = Join-Path $tmpRoot "$Name-manifest.json"
    $reportPath = Join-Path $tmpRoot "$Name-report.json"
    Write-Manifest -Manifest $Manifest -Path $manifestPath
    $run = Invoke-RepoScript @(
        $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-ObservedEvidencePath", $manifestPath,
        "-EvidencePath", $reportPath
    )
    Assert-True ($run.ExitCode -ne 0) "$Name is rejected" $run.Output
    Assert-True ($run.Output -match [regex]::Escape($ExpectedText)) "$Name failure names $ExpectedText" $run.Output
    if (Test-Path -LiteralPath $reportPath) {
        $report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
        Assert-True ($report.real_tested -eq $false) "$Name report keeps RealTested false" ($report | ConvertTo-Json -Depth 8)
    }
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-observed-localhost-dispatch.ps1"
Assert-True (Test-Path -LiteralPath $scriptPath) "observed localhost dispatch verifier exists"

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-observed-localhost-dispatch-$PID"
Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null

try {
    if (Test-Path -LiteralPath $scriptPath) {
        Assert-Fails -Name "caller-only-url-proof" -Manifest (New-ObservedManifest -CallerOnly) -ExpectedText "caller-only URL proof is not accepted"
        Assert-Fails -Name "missing-dispatch-event" -Manifest (New-ObservedManifest -MissingDispatch) -ExpectedText "missing observed dispatch event"
        Assert-Fails -Name "direct-local-edge-target" -Manifest (New-ObservedManifest -DirectLocalEdge) -ExpectedText "direct Hub-to-LocalEdge target is not accepted"
        Assert-Fails -Name "forged-replay" -Manifest (New-ObservedManifest -ForgedReplay) -ExpectedText "forged Hub replay reference"

        $manifestPath = Join-Path $tmpRoot "valid-manifest.json"
        $reportPath = Join-Path $tmpRoot "valid-report.json"
        Write-Manifest -Manifest (New-ObservedManifest) -Path $manifestPath
        $run = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ObservedEvidencePath", $manifestPath,
            "-EvidencePath", $reportPath
        )
        Assert-True ($run.ExitCode -eq 0) "valid observed manifest passes" $run.Output
        Assert-True ($run.Output -match "OBSERVED_DISPATCH_PASSED") "valid observed manifest reports observed dispatch pass" $run.Output
        Assert-True ($run.Output -match "RealTested=false") "valid observed manifest preserves RealTested false by default" $run.Output
        $report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
        Assert-True ($report.schema -eq "agenthub-observed-localhost-dispatch-report-v1") "report schema records observed dispatch report"
        Assert-True ($report.real_tested -eq $false) "report keeps RealTested false without approval gate" ($report | ConvertTo-Json -Depth 8)
        Assert-True ($report.observed.dispatch_target_url -eq "http://127.0.0.1:5173") "report derives dispatch target from observed manifest" ($report | ConvertTo-Json -Depth 8)
        Assert-True ($report.observed.edge_run_id -eq "edge-run-observed-001") "report records observed Edge run id" ($report | ConvertTo-Json -Depth 8)
        Assert-True (@($report.observed.replay_refs) -contains "evt-006") "report records Hub replay refs" ($report | ConvertTo-Json -Depth 8)

        $overclaimManifestPath = Join-Path $tmpRoot "overclaim-manifest.json"
        $overclaimReportPath = Join-Path $tmpRoot "overclaim-report.json"
        Write-Manifest -Manifest (New-ObservedManifest -ClaimRealTested) -Path $overclaimManifestPath
        $overclaim = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ObservedEvidencePath", $overclaimManifestPath,
            "-EvidencePath", $overclaimReportPath
        )
        Assert-True ($overclaim.ExitCode -eq 0) "RealTested overclaim does not fail otherwise valid observed proof" $overclaim.Output
        $overclaimReport = Get-Content -Raw -LiteralPath $overclaimReportPath | ConvertFrom-Json
        Assert-True ($overclaimReport.real_tested -eq $false) "RealTested overclaim is downgraded without explicit approval gate" ($overclaimReport | ConvertTo-Json -Depth 8)
    }
}
finally {
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
