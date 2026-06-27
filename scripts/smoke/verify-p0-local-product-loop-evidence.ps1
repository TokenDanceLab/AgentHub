#!/usr/bin/env pwsh
<#
AgentHub P0 local product-loop sanitized evidence runner.

This one-key runner turns the localhost fixture chain into a compact,
machine-readable report for:

Web -> Hub -> Desktop Local Edge sidecar -> fixture/CLI adapter -> Hub replay -> Web render

It can also review a separately captured observed-dispatch manifest in
ApprovedRealReview mode, but it does not perform real TokenDanceID login,
real CLI/model execution, public deploy, signing, push, merge, or tag work.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [ValidateSet("FixtureOnly", "ApprovedRealReview")]
    [string]$Mode = "FixtureOnly",
    [string]$EvidencePath = "",
    [string]$ArtifactRoot = "",
    [string]$ObservedEvidencePath = "",
    [switch]$ApproveRealEvidence,
    [string]$NodePath = "node",
    [int]$TimeoutSec = 8
)

$ErrorActionPreference = "Stop"

if ($TimeoutSec -le 0) {
    Write-Host "FAIL: -TimeoutSec must be greater than zero." -ForegroundColor Red
    exit 2
}

$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
    $ArtifactRoot = Join-Path $RepoRoot ".tmp\p0-local-product-loop-evidence\run-$PID"
}
$ArtifactRoot = if ([System.IO.Path]::IsPathRooted($ArtifactRoot)) {
    $ArtifactRoot
} else {
    Join-Path $RepoRoot $ArtifactRoot
}
$ArtifactRoot = [System.IO.Path]::GetFullPath($ArtifactRoot)

if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path $ArtifactRoot "sanitized-evidence.json"
} elseif (-not [System.IO.Path]::IsPathRooted($EvidencePath)) {
    $EvidencePath = Join-Path $RepoRoot $EvidencePath
}
$EvidencePath = [System.IO.Path]::GetFullPath($EvidencePath)

$Failures = @()
$Warnings = @()
$Segments = @()
$GateResults = @()
$Blockers = @(
    "real TokenDanceID login requires explicit operator approval and a running TokenDanceID plus Hub callback configuration",
    "real CLI/model adapter invocation requires explicit operator approval and a no-secret observed-dispatch manifest",
    "public deploy, signing, push, merge, and tag remain out of scope for this runner"
)
$ObservedReportPath = ""
$FixtureEvidencePath = Join-Path $ArtifactRoot "fixture-product-loop.json"
$RealTested = $false

function Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Add-Failure([string]$Text) {
    $script:Failures += $Text
    Write-Host "  FAIL  $Text" -ForegroundColor Red
}

function Add-Warning([string]$Text) {
    $script:Warnings += $Text
    Write-Host "  WARN  $Text" -ForegroundColor Yellow
}

function Pass([string]$Text) {
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Test-PathUnderRoot {
    param(
        [string]$Path,
        [string]$Root
    )

    $normalized = [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    if ($normalized.Equals($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    return $normalized.StartsWith($normalizedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-SafeArtifactRoot {
    $tempAllowed = Join-Path ([System.IO.Path]::GetTempPath()) "AgentHub\p0-local-product-loop-evidence"
    $allowedRoots = @(
        (Join-Path $RepoRoot ".tmp\p0-local-product-loop-evidence"),
        (Join-Path $RepoRoot "tmp\p0-local-product-loop-evidence"),
        $tempAllowed
    ) | ForEach-Object { [System.IO.Path]::GetFullPath($_) }

    foreach ($root in $allowedRoots) {
        if (Test-PathUnderRoot -Path $ArtifactRoot -Root $root) {
            Pass "artifact root is inside allowed sanitized evidence area"
            return
        }
    }
    Add-Failure "artifact root must stay under .tmp\p0-local-product-loop-evidence, tmp\p0-local-product-loop-evidence, or `$env:TEMP\AgentHub\p0-local-product-loop-evidence"
}

function Assert-EvidencePath {
    if (Test-PathUnderRoot -Path $EvidencePath -Root $ArtifactRoot) {
        Pass "EvidencePath is inside ArtifactRoot"
        return
    }
    Add-Failure "EvidencePath must stay inside ArtifactRoot"
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

function Find-PowerShell {
    $pwsh = Get-Command "pwsh" -ErrorAction SilentlyContinue
    if ($pwsh) { return $pwsh.Source }
    $powershell = Get-Command "powershell" -ErrorAction SilentlyContinue
    if ($powershell) { return $powershell.Source }
    return $null
}

function Invoke-CapturedProcess {
    param(
        [string]$FileName,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    try {
        $psi = [System.Diagnostics.ProcessStartInfo]::new()
        $psi.FileName = $FileName
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.WorkingDirectory = $WorkingDirectory
        $psi.Arguments = Join-NativeArguments $Arguments

        $proc = [System.Diagnostics.Process]::Start($psi)
        $stdout = $proc.StandardOutput.ReadToEnd()
        $stderr = $proc.StandardError.ReadToEnd()
        $proc.WaitForExit()

        return [pscustomobject]@{
            ExitCode = $proc.ExitCode
            Output = ($stdout + "`n" + $stderr)
        }
    }
    catch {
        return [pscustomobject]@{
            ExitCode = -1
            Output = $_.Exception.Message
        }
    }
}

function Invoke-RepoScript {
    param(
        [string]$RelativePath,
        [string[]]$Arguments
    )

    $scriptPath = Join-Path $RepoRoot $RelativePath
    $powershellExe = Find-PowerShell
    if (-not $powershellExe) {
        return [pscustomobject]@{
            ExitCode = -1
            Output = "PowerShell executable is unavailable"
            ScriptPath = $scriptPath
        }
    }
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        return [pscustomobject]@{
            ExitCode = -1
            Output = "missing $RelativePath"
            ScriptPath = $scriptPath
        }
    }

    $run = Invoke-CapturedProcess $powershellExe (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath) + $Arguments) $RepoRoot
    $run | Add-Member -NotePropertyName ScriptPath -NotePropertyValue $scriptPath
    return $run
}

function Get-Event {
    param($Evidence, [string]$Type)
    return @($Evidence.events | Where-Object { [string]$_.type -eq $Type } | Select-Object -First 1)[0]
}

function Get-EventIndex {
    param($Evidence, [string]$Type)
    $events = @($Evidence.events)
    for ($i = 0; $i -lt $events.Count; $i++) {
        if ([string]$events[$i].type -eq $Type) {
            return $i
        }
    }
    return -1
}

function Add-Segment {
    param(
        [string]$Name,
        [string]$Label,
        [bool]$Passed,
        [string[]]$EventTypes,
        [hashtable]$Details
    )

    $status = if ($Passed) { "PASS" } else { "FAIL" }
    if (-not $Passed) {
        Add-Failure "segment failed: $Name"
    } else {
        Pass "segment passed: $Name"
    }

    $script:Segments += [pscustomobject][ordered]@{
        name = $Name
        label = $Label
        status = $status
        event_types = @($EventTypes)
        details = $Details
    }
}

function Test-SameOrigin {
    param([string]$Left, [string]$Right)
    try {
        $leftUri = [System.Uri]::new($Left)
        $rightUri = [System.Uri]::new($Right)
        return (
            $leftUri.Scheme -eq $rightUri.Scheme -and
            $leftUri.Host -eq $rightUri.Host -and
            $leftUri.Port -eq $rightUri.Port
        )
    }
    catch {
        return $false
    }
}

function Validate-FixtureEvidence {
    param($Evidence)

    if ([string]$Evidence.schema -ne "agenthub-localhost-product-loop-v1") {
        Add-Failure "fixture evidence schema mismatch"
    }
    if ($Evidence.real_tested -ne $false) {
        Add-Failure "fixture evidence must keep real_tested=false"
    }
    if ($Evidence.claims.real_tokendance_id_login -ne $false) {
        Add-Failure "fixture evidence must not claim real TokenDanceID login"
    }
    if ($Evidence.claims.real_cli_or_model_invoked -ne $false) {
        Add-Failure "fixture evidence must not claim real CLI/model invocation"
    }
    if ($Evidence.claims.public_deploy_used -ne $false) {
        Add-Failure "fixture evidence must not claim public deploy"
    }

    $services = @($Evidence.services)
    $web = @($services | Where-Object { $_.service -eq "web" } | Select-Object -First 1)[0]
    $hub = @($services | Where-Object { $_.service -eq "hub" } | Select-Object -First 1)[0]
    $desktop = @($services | Where-Object { $_.service -eq "desktop" } | Select-Object -First 1)[0]
    $edge = @($services | Where-Object { $_.service -eq "local-edge" } | Select-Object -First 1)[0]

    foreach ($entry in @(
        @{ Name = "web"; Value = $web },
        @{ Name = "hub"; Value = $hub },
        @{ Name = "desktop"; Value = $desktop },
        @{ Name = "local-edge"; Value = $edge }
    )) {
        if ($null -eq $entry.Value) {
            Add-Failure "fixture service missing: $($entry.Name)"
        }
    }

    $requiredOrder = @(
        "target.registered",
        "web.teamrun.start",
        "hub.agent.dispatch",
        "desktop.dispatch.accepted",
        "edge.run.started",
        "adapter.run.completed",
        "hub.replay.recorded",
        "web.replay.rendered"
    )
    $lastIndex = -1
    foreach ($type in $requiredOrder) {
        $index = Get-EventIndex $Evidence $type
        if ($index -le $lastIndex) {
            Add-Failure "fixture event order invalid at $type"
        }
        $lastIndex = $index
    }

    $dispatch = Get-Event $Evidence "hub.agent.dispatch"
    $desktopAccept = Get-Event $Evidence "desktop.dispatch.accepted"
    $edgeStart = Get-Event $Evidence "edge.run.started"
    $adapterDone = Get-Event $Evidence "adapter.run.completed"
    $replay = Get-Event $Evidence "hub.replay.recorded"
    $render = Get-Event $Evidence "web.replay.rendered"

    $webOnly = (@($Evidence.topology.web.allowed_upstreams).Count -eq 1 -and @($Evidence.topology.web.allowed_upstreams) -contains "hub")
    Add-Segment `
        -Name "web_to_hub" `
        -Label "Web starts TeamRun through Hub-only boundary" `
        -Passed ($webOnly -and $null -ne (Get-Event $Evidence "web.teamrun.start") -and $null -ne $dispatch) `
        -EventTypes @("web.teamrun.start", "hub.agent.dispatch") `
        -Details @{
            allowed_upstreams = @($Evidence.topology.web.allowed_upstreams)
            web_health_identity = [string]$web.health.identity
        }

    $hubRoutesDesktop = ($null -ne $desktop -and $null -ne $edge -and $null -ne $dispatch -and [string]$dispatch.desktop_url -eq [string]$desktop.url -and -not (Test-SameOrigin -Left ([string]$dispatch.desktop_url) -Right ([string]$edge.url)))
    Add-Segment `
        -Name "hub_to_registered_desktop_bridge" `
        -Label "Hub dispatch targets the registered Desktop bridge, not Local Edge directly" `
        -Passed $hubRoutesDesktop `
        -EventTypes @("target.registered", "hub.agent.dispatch") `
        -Details @{
            dispatch_desktop_url = [string]$dispatch.desktop_url
            registered_desktop_url = [string]$desktop.url
            local_edge_url = [string]$edge.url
        }

    $desktopSidecar = (
        @($Evidence.topology.desktop.allowed_upstreams).Count -eq 1 -and
        @($Evidence.topology.desktop.allowed_upstreams) -contains "local-edge" -and
        [string]$Evidence.topology.desktop.bridge -eq "tauri-sidecar-fixture" -and
        [string]$desktop.health.bridge -eq "tauri-sidecar-fixture" -and
        $null -ne $desktopAccept -and
        $null -ne $edgeStart
    )
    Add-Segment `
        -Name "desktop_local_edge_sidecar" `
        -Label "Desktop bridge dispatches only to Local Edge sidecar" `
        -Passed $desktopSidecar `
        -EventTypes @("desktop.dispatch.accepted", "edge.run.started") `
        -Details @{
            desktop_bridge = [string]$Evidence.topology.desktop.bridge
            allowed_upstreams = @($Evidence.topology.desktop.allowed_upstreams)
        }

    $fixtureAdapter = (
        [string]$Evidence.topology.local_edge.adapter -eq "fixture-sdk" -and
        $Evidence.topology.local_edge.real_cli_or_model_invoked -eq $false -and
        $null -ne $adapterDone -and
        $adapterDone.real_cli_or_model_invoked -eq $false
    )
    Add-Segment `
        -Name "local_edge_fixture_adapter" `
        -Label "Local Edge runs fixture adapter without real CLI/model spend" `
        -Passed $fixtureAdapter `
        -EventTypes @("edge.run.started", "adapter.run.completed") `
        -Details @{
            adapter = [string]$Evidence.topology.local_edge.adapter
            real_cli_or_model_invoked = $false
        }

    $task = @($Evidence.tasks | Where-Object { $_.id -eq $Evidence.remote_control_manifest.hubTaskId } | Select-Object -First 1)[0]
    $hubReplay = ($null -ne $replay -and $null -ne $task -and [string]$task.status -eq "completed")
    Add-Segment `
        -Name "hub_replay" `
        -Label "Hub replay records completed localhost fixture chain" `
        -Passed $hubReplay `
        -EventTypes @("adapter.run.completed", "hub.replay.recorded") `
        -Details @{
            hub_task_id = [string]$Evidence.remote_control_manifest.hubTaskId
            task_status = [string]$task.status
        }

    $webRender = (
        $null -ne $render -and
        [string]$render.source -eq "hub-replay" -and
        @($render.rendered_event_types) -contains "hub.replay.recorded" -and
        (Get-EventIndex $Evidence "web.replay.rendered") -gt (Get-EventIndex $Evidence "hub.replay.recorded")
    )
    Add-Segment `
        -Name "web_render" `
        -Label "Web renders Hub replay into localhost fixture view" `
        -Passed $webRender `
        -EventTypes @("hub.replay.recorded", "web.replay.rendered") `
        -Details @{
            source = [string]$render.source
            rendered_event_types = @($render.rendered_event_types)
        }
}

function Write-Report {
    param([string]$Status)

    $report = [ordered]@{
        schema = "agenthub-p0-local-product-loop-evidence-v1"
        mode = $Mode
        status = $Status
        real_tested = $RealTested
        generated_at = (Get-Date).ToString("o")
        repo_root = $RepoRoot
        artifact_root = $ArtifactRoot
        sanitized = $true
        sequence = "Web -> Hub -> Desktop Local Edge sidecar -> fixture/CLI adapter -> Hub replay -> Web render"
        sources = [ordered]@{
            fixture_product_loop = [ordered]@{
                script = "scripts/smoke/verify-localhost-product-loop.ps1"
                evidence_path = $FixtureEvidencePath
            }
            observed_dispatch_report = $ObservedReportPath
        }
        gate_results = @($GateResults)
        segments = @($Segments)
        boundaries = [ordered]@{
            web = [ordered]@{
                upstream = "hub-only"
                direct_local_edge = "rejected"
            }
            desktop = [ordered]@{
                bridge = "tauri-sidecar-fixture"
                upstream = "local-edge-sidecar"
            }
            local_edge = [ordered]@{
                adapter = "fixture-sdk"
                real_cli_or_model_invoked = $false
            }
            hub = [ordered]@{
                dispatch_target = "registered-desktop-bridge"
                replay_owner = $true
            }
        }
        claims = [ordered]@{
            real_tokendance_id_login = $false
            real_cli_or_model_invoked_by_this_runner = $false
            public_deploy_signing_push_merge_or_tag = $false
            production_code_touched = $false
        }
        approved_real_requirements = [ordered]@{
            environment_names = @(
                "AGENTHUB_WEB_URL",
                "AGENTHUB_HUB_URL",
                "AGENTHUB_DESKTOP_BRIDGE_URL",
                "AGENTHUB_LOCAL_EDGE_URL",
                "AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT"
            )
            observed_manifest_schema = "agenthub-observed-localhost-dispatch-v1"
            command = "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke\verify-p0-local-product-loop-evidence.ps1 -RepoRoot . -Mode ApprovedRealReview -ArtifactRoot .tmp\p0-local-product-loop-evidence\approved -ObservedEvidencePath <observed-dispatch.json> -ApproveRealEvidence"
            local_stack_probe_command = "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke\verify-local-stack-e2e-readiness.ps1 -RepoRoot . -Mode ApprovedReal -ArtifactRoot .tmp\local-stack-e2e-readiness\approved -SuppliedEnvironmentNames AGENTHUB_WEB_URL,AGENTHUB_HUB_URL,AGENTHUB_DESKTOP_BRIDGE_URL,AGENTHUB_LOCAL_EDGE_URL,AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT -ProbeServices -ApproveRealEvidence -ObservedEvidencePath <observed-dispatch.json>"
        }
        blockers = @($Blockers)
        failures = @($Failures)
        warnings = @($Warnings)
    }

    $dir = Split-Path -Parent $EvidencePath
    if (-not [string]::IsNullOrWhiteSpace($dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $report | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}

Write-Host "AgentHub P0 local product-loop sanitized evidence runner" -ForegroundColor Magenta
Write-Host "Mode: $Mode" -ForegroundColor White
Write-Host "No real TokenDanceID login, real CLI/model spend, deploy, signing, push, merge, or tag will be performed." -ForegroundColor White

Step "Output safety"
Assert-SafeArtifactRoot
Assert-EvidencePath
if ($Failures.Count -gt 0) {
    Write-Host "Status: P0_LOCAL_PRODUCT_LOOP_EVIDENCE_FAILED" -ForegroundColor Red
    Write-Host "RealTested=false" -ForegroundColor White
    exit 1
}
New-Item -ItemType Directory -Force -Path $ArtifactRoot | Out-Null

Step "Fixture product loop"
$fixtureRun = Invoke-RepoScript "scripts\smoke\verify-localhost-product-loop.ps1" @(
    "-RepoRoot", $RepoRoot,
    "-EvidencePath", $FixtureEvidencePath,
    "-NodePath", $NodePath
)
Write-Host $fixtureRun.Output
$GateResults += [pscustomobject][ordered]@{
    name = "verify-localhost-product-loop.ps1"
    mode = "FixtureOnly"
    exit_code = $fixtureRun.ExitCode
    status = if ($fixtureRun.ExitCode -eq 0) { "PASS" } else { "FAIL" }
    evidence = $FixtureEvidencePath
}
if ($fixtureRun.ExitCode -ne 0) {
    Add-Failure "fixture product-loop harness failed"
} elseif (-not (Test-Path -LiteralPath $FixtureEvidencePath)) {
    Add-Failure "fixture product-loop evidence was not written"
} else {
    $fixtureEvidence = Get-Content -Raw -LiteralPath $FixtureEvidencePath | ConvertFrom-Json
    Validate-FixtureEvidence $fixtureEvidence
}

if ($Mode -eq "ApprovedRealReview") {
    Step "Approved real observed-dispatch review"
    if (-not $ApproveRealEvidence) {
        Add-Failure "ApprovedRealReview requires -ApproveRealEvidence"
    }
    if ([string]::IsNullOrWhiteSpace($ObservedEvidencePath)) {
        Add-Failure "ApprovedRealReview requires -ObservedEvidencePath"
    } else {
        $ObservedReportPath = Join-Path $ArtifactRoot "observed-dispatch-report.json"
        $observedArgs = @(
            "-RepoRoot", $RepoRoot,
            "-ObservedEvidencePath", $ObservedEvidencePath,
            "-EvidencePath", $ObservedReportPath,
            "-TimeoutSec", ([string]$TimeoutSec)
        )
        if ($ApproveRealEvidence) {
            $observedArgs += "-AllowRealTestedApproval"
        }
        $observedRun = Invoke-RepoScript "scripts\smoke\verify-observed-localhost-dispatch.ps1" $observedArgs
        Write-Host $observedRun.Output
        $GateResults += [pscustomobject][ordered]@{
            name = "verify-observed-localhost-dispatch.ps1"
            mode = "ApprovedRealReview"
            exit_code = $observedRun.ExitCode
            status = if ($observedRun.ExitCode -eq 0) { "PASS" } else { "FAIL" }
            evidence = $ObservedReportPath
        }
        if ($observedRun.ExitCode -ne 0) {
            Add-Failure "observed localhost dispatch review failed"
        } elseif (Test-Path -LiteralPath $ObservedReportPath) {
            $observedJson = Get-Content -Raw -LiteralPath $ObservedReportPath | ConvertFrom-Json
            if ($observedJson.real_tested -eq $true -and $ApproveRealEvidence) {
                $RealTested = $true
                Pass "ApprovedRealReview accepted approval-gated real_tested evidence"
            } else {
                Add-Warning "ApprovedRealReview passed without promoting real_tested=true"
            }
        }
    }
}

$status = if ($Failures.Count -eq 0) {
    if ($Mode -eq "ApprovedRealReview" -and $RealTested) {
        "P0_LOCAL_PRODUCT_LOOP_APPROVED_REAL_PASSED"
    } elseif ($Mode -eq "ApprovedRealReview") {
        "P0_LOCAL_PRODUCT_LOOP_APPROVED_REVIEW_PASSED"
    } else {
        "P0_LOCAL_PRODUCT_LOOP_FIXTURE_PASSED"
    }
} else {
    "P0_LOCAL_PRODUCT_LOOP_EVIDENCE_FAILED"
}

Write-Report $status

Step "Boundary summary"
Write-Host "  Fixture chain includes Web -> Hub -> Desktop sidecar -> Local Edge -> fixture adapter -> Hub replay -> Web render." -ForegroundColor White
Write-Host "  Web boundary is Hub-only; direct Local Edge proof remains rejected." -ForegroundColor White
Write-Host "  Desktop boundary uses Local Edge sidecar fixture; no UI/direct CLI spawn is certified here." -ForegroundColor White
Write-Host "  EvidencePath: $EvidencePath" -ForegroundColor White
Write-Host "  RealTested=$([string]$RealTested)" -ForegroundColor White
Write-Host "Status: $status" -ForegroundColor $(if ($Failures.Count -eq 0) { "Green" } else { "Red" })

exit $(if ($Failures.Count -eq 0) { 0 } else { 1 })
