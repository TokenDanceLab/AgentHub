#!/usr/bin/env pwsh
<#
AgentHub observed localhost dispatch verifier.

This is a fail-closed validation gate for an observed Hub/Desktop evidence
artifact or local endpoint export. It does not start services, perform
TokenDanceID login, invoke a real CLI/model adapter, deploy, sign, upload, or
trust caller-supplied URL topology hints as dispatch proof.

RealTested remains false unless validation succeeds and a future
approval-gated manifest is explicitly accepted with -AllowRealTestedApproval.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [string]$ObservedEvidencePath = "",
    [string]$ObservedEvidenceUrl = "",
    [string]$EvidencePath = "",
    [int]$TimeoutSec = 8,
    [switch]$AllowRealTestedApproval
)

$ErrorActionPreference = "Stop"

if ($TimeoutSec -le 0) {
    Write-Host "FAIL: -TimeoutSec must be greater than zero." -ForegroundColor Red
    exit 2
}

$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-observed-localhost-dispatch-$PID.json"
}

$Failures = @()
$Warnings = @()
$Manifest = $null
$Source = ""

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

function Get-Origin([string]$Url) {
    try {
        $uri = [System.Uri]::new($Url)
        $port = if ($uri.IsDefaultPort) {
            if ($uri.Scheme -eq "https") { 443 } else { 80 }
        } else {
            $uri.Port
        }
        return ("{0}://{1}:{2}" -f $uri.Scheme.ToLowerInvariant(), $uri.Host.ToLowerInvariant(), $port)
    }
    catch {
        return ""
    }
}

function Test-LoopbackHttpUrl([string]$Url) {
    try {
        $uri = [System.Uri]::new($Url)
        if ($uri.Scheme -ne "http") {
            return $false
        }
        $hostName = $uri.Host.ToLowerInvariant()
        return (@("127.0.0.1", "localhost", "::1", "[::1]") -contains $hostName)
    }
    catch {
        return $false
    }
}

function Get-Field {
    param(
        [object]$Object,
        [string]$Name
    )

    if ($null -eq $Object) {
        return $null
    }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) {
        return $null
    }
    return $prop.Value
}

function Require-Text {
    param(
        [object]$Object,
        [string]$Name,
        [string]$Label
    )

    $value = [string](Get-Field -Object $Object -Name $Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        Add-Failure "$Label missing $Name"
    }
    return $value
}

function Get-EventByRef([string]$EventRef) {
    if ([string]::IsNullOrWhiteSpace($EventRef)) {
        return $null
    }
    foreach ($event in @($Manifest.events)) {
        if ([string]$event.id -eq $EventRef) {
            return $event
        }
    }
    return $null
}

function Require-ObservedEvent {
    param(
        [string]$EventRef,
        [string]$ExpectedType,
        [string]$Label
    )

    $event = Get-EventByRef $EventRef
    if ($null -eq $event) {
        Add-Failure "$Label references missing event $EventRef"
        return
    }
    if ([string]$event.type -ne $ExpectedType) {
        Add-Failure "$Label event type mismatch: expected $ExpectedType"
        return
    }
    if ($event.observed -ne $true) {
        Add-Failure "$Label event is not marked observed"
        return
    }
    Pass "$Label references observed $ExpectedType event"
}

function Get-EventIndex([string]$Type) {
    $events = @($Manifest.events)
    for ($i = 0; $i -lt $events.Count; $i++) {
        if ([string]$events[$i].type -eq $Type) {
            return $i
        }
    }
    return -1
}

function Assert-Same {
    param(
        [string]$Left,
        [string]$Right,
        [string]$Message
    )

    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) {
        return
    }
    if ($Left -ne $Right) {
        Add-Failure $Message
    }
}

function Read-ObservedManifest {
    if (-not [string]::IsNullOrWhiteSpace($ObservedEvidencePath) -and -not [string]::IsNullOrWhiteSpace($ObservedEvidenceUrl)) {
        Add-Failure "provide only one observed evidence source"
        return $null
    }

    if (-not [string]::IsNullOrWhiteSpace($ObservedEvidencePath)) {
        if (-not (Test-Path -LiteralPath $ObservedEvidencePath)) {
            Add-Failure "observed evidence artifact missing: $ObservedEvidencePath"
            return $null
        }
        $script:Source = (Resolve-Path -LiteralPath $ObservedEvidencePath).ProviderPath
        return Get-Content -Raw -LiteralPath $ObservedEvidencePath | ConvertFrom-Json
    }

    if (-not [string]::IsNullOrWhiteSpace($ObservedEvidenceUrl)) {
        if (-not (Test-LoopbackHttpUrl $ObservedEvidenceUrl)) {
            Add-Failure "observed evidence endpoint must be a loopback HTTP URL"
            return $null
        }
        $script:Source = $ObservedEvidenceUrl
        $response = Invoke-WebRequest -Uri $ObservedEvidenceUrl -UseBasicParsing -TimeoutSec $TimeoutSec
        return [string]$response.Content | ConvertFrom-Json
    }

    Add-Failure "observed evidence artifact or endpoint is required"
    return $null
}

function Write-Report {
    param([string]$Status)

    $registration = Get-Field -Object $Manifest -Name "target_registration"
    $dispatch = Get-Field -Object $Manifest -Name "dispatch"
    $desktopAccept = Get-Field -Object $Manifest -Name "desktop_accept"
    $edgeRun = Get-Field -Object $Manifest -Name "edge_run"
    $hubReplay = Get-Field -Object $Manifest -Name "hub_replay"
    $webRender = Get-Field -Object $Manifest -Name "web_render"

    $validationPassed = ($Status -eq "OBSERVED_DISPATCH_PASSED" -and $Failures.Count -eq 0)
    $realTested = $false
    if ((Get-Field -Object $Manifest -Name "real_tested") -eq $true) {
        if ($validationPassed -and $AllowRealTestedApproval -and [string](Get-Field -Object $Manifest -Name "approval_gate") -eq "observed-localhost-dispatch-approved") {
            $realTested = $true
        } elseif (-not $validationPassed) {
            Add-Warning "input RealTested claim was downgraded because observed dispatch validation failed"
        } else {
            Add-Warning "input RealTested claim was downgraded because explicit approval gate is absent"
        }
    }

    $report = [ordered]@{
        schema = "agenthub-observed-localhost-dispatch-report-v1"
        status = $Status
        real_tested = $realTested
        generated_at = (Get-Date).ToString("o")
        repo_root = $RepoRoot
        source = $Source
        no_real_tokendance_id_login = $true
        no_real_cli_or_model_spend_by_verifier = $true
        no_public_deploy_signing_or_release = $true
        observed = [ordered]@{
            target_id = Get-Field -Object $registration -Name "target_id"
            edge_device_id = Get-Field -Object $registration -Name "edge_device_id"
            hub_task_id = Get-Field -Object $dispatch -Name "hub_task_id"
            dispatch_target_url = Get-Field -Object $dispatch -Name "dispatch_target_url"
            desktop_bridge_url = Get-Field -Object $registration -Name "desktop_bridge_url"
            local_edge_url = Get-Field -Object $desktopAccept -Name "local_edge_url"
            edge_run_id = Get-Field -Object $edgeRun -Name "edge_run_id"
            adapter_id = Get-Field -Object $edgeRun -Name "adapter_id"
            web_render_event_ref = Get-Field -Object $webRender -Name "event_ref"
            web_render_source = Get-Field -Object $webRender -Name "render_source"
            replay_refs = @(
                Get-Field -Object $hubReplay -Name "event_ref"
                Get-Field -Object $hubReplay -Name "replay_ref"
                Get-Field -Object $webRender -Name "replay_ref"
            ) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique
        }
        readiness_only_sources_rejected = $true
        failures = @($Failures)
        warnings = @($Warnings)
        blockers = @(
            "caller-supplied URL topology is not accepted as dispatch proof",
            "real TokenDanceID login is intentionally not performed",
            "real CLI/model adapter invocation is not performed by this verifier",
            "public deploy/signing/release upload is intentionally not performed"
        )
    }

    $dir = Split-Path -Parent $EvidencePath
    if (-not [string]::IsNullOrWhiteSpace($dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}

Write-Host "AgentHub observed localhost dispatch verifier" -ForegroundColor Magenta
Write-Host "No TokenDanceID login, real CLI/model spend, deploy, signing, or release upload will be performed." -ForegroundColor Magenta

Step "Load observed evidence"
$Manifest = Read-ObservedManifest
if ($null -eq $Manifest) {
    Write-Report -Status "OBSERVED_DISPATCH_FAILED"
    Write-Host "Status: OBSERVED_DISPATCH_FAILED" -ForegroundColor Red
    Write-Host "RealTested=false" -ForegroundColor White
    exit 1
}
Pass "observed evidence source loaded"

Step "Reject readiness-only proof"
$schema = [string](Get-Field -Object $Manifest -Name "schema")
$origin = [string](Get-Field -Object $Manifest -Name "evidence_origin")
if ($schema -ne "agenthub-observed-localhost-dispatch-v1") {
    Add-Failure "caller-only URL proof is not accepted"
}
if ($origin -in @("caller_params", "readiness_only", "self_supplied")) {
    Add-Failure "caller-only URL proof is not accepted"
}
if ($origin -ne "observed_hub_manifest" -and $origin -ne "observed_desktop_path") {
    Add-Failure "observed evidence origin must be observed_hub_manifest or observed_desktop_path"
}

Step "Required observed chain"
$registration = Get-Field -Object $Manifest -Name "target_registration"
$dispatch = Get-Field -Object $Manifest -Name "dispatch"
$desktopAccept = Get-Field -Object $Manifest -Name "desktop_accept"
$edgeRun = Get-Field -Object $Manifest -Name "edge_run"
$hubReplay = Get-Field -Object $Manifest -Name "hub_replay"
$webRender = Get-Field -Object $Manifest -Name "web_render"

if ($null -eq $registration) { Add-Failure "missing observed target registration" }
if ($null -eq $dispatch) { Add-Failure "missing observed dispatch event" }
if ($null -eq $desktopAccept) { Add-Failure "missing observed Desktop bridge accept event" }
if ($null -eq $edgeRun) { Add-Failure "missing observed Edge run id" }
if ($null -eq $hubReplay) { Add-Failure "missing observed Hub replay refs" }
if ($null -eq $webRender) { Add-Failure "missing observed Web render proof" }

$targetId = Require-Text -Object $registration -Name "target_id" -Label "target registration"
$edgeDeviceId = Require-Text -Object $registration -Name "edge_device_id" -Label "target registration"
$targetKind = Require-Text -Object $registration -Name "target_kind" -Label "target registration"
$registeredDesktopUrl = Require-Text -Object $registration -Name "desktop_bridge_url" -Label "target registration"
$hubTaskId = Require-Text -Object $dispatch -Name "hub_task_id" -Label "dispatch"
$dispatchTargetUrl = Require-Text -Object $dispatch -Name "dispatch_target_url" -Label "dispatch"
$desktopAcceptUrl = Require-Text -Object $desktopAccept -Name "desktop_bridge_url" -Label "Desktop accept"
$localEdgeUrl = Require-Text -Object $desktopAccept -Name "local_edge_url" -Label "Desktop accept"
$edgeRunId = Require-Text -Object $edgeRun -Name "edge_run_id" -Label "Edge run"
$adapterId = Require-Text -Object $edgeRun -Name "adapter_id" -Label "Edge run"
$replayRef = Require-Text -Object $hubReplay -Name "replay_ref" -Label "Hub replay"
$replayEventRef = Require-Text -Object $hubReplay -Name "event_ref" -Label "Hub replay"
$webRenderEventRef = Require-Text -Object $webRender -Name "event_ref" -Label "Web render"
$webRenderReplayRef = Require-Text -Object $webRender -Name "replay_ref" -Label "Web render"
$webRenderSource = Require-Text -Object $webRender -Name "render_source" -Label "Web render"

foreach ($urlPair in @(
    @{ Name = "target registration desktop_bridge_url"; Value = $registeredDesktopUrl },
    @{ Name = "dispatch dispatch_target_url"; Value = $dispatchTargetUrl },
    @{ Name = "Desktop accept desktop_bridge_url"; Value = $desktopAcceptUrl },
    @{ Name = "Desktop accept local_edge_url"; Value = $localEdgeUrl }
)) {
    if (-not [string]::IsNullOrWhiteSpace($urlPair.Value)) {
        if (Test-LoopbackHttpUrl $urlPair.Value) {
            Pass "$($urlPair.Name) is loopback HTTP"
        } else {
            Add-Failure "$($urlPair.Name) must be loopback HTTP"
        }
    }
}

Assert-Same -Left ([string](Get-Field -Object $dispatch -Name "target_id")) -Right $targetId -Message "dispatch target_id does not match registration"
Assert-Same -Left ([string](Get-Field -Object $desktopAccept -Name "target_id")) -Right $targetId -Message "Desktop accept target_id does not match registration"
Assert-Same -Left ([string](Get-Field -Object $edgeRun -Name "target_id")) -Right $targetId -Message "Edge run target_id does not match registration"
Assert-Same -Left ([string](Get-Field -Object $hubReplay -Name "target_id")) -Right $targetId -Message "Hub replay target_id does not match registration"
Assert-Same -Left ([string](Get-Field -Object $dispatch -Name "edge_device_id")) -Right $edgeDeviceId -Message "dispatch edge_device_id does not match registration"
Assert-Same -Left ([string](Get-Field -Object $desktopAccept -Name "edge_device_id")) -Right $edgeDeviceId -Message "Desktop accept edge_device_id does not match registration"
Assert-Same -Left ([string](Get-Field -Object $edgeRun -Name "edge_device_id")) -Right $edgeDeviceId -Message "Edge run edge_device_id does not match registration"
Assert-Same -Left ([string](Get-Field -Object $hubReplay -Name "edge_device_id")) -Right $edgeDeviceId -Message "Hub replay edge_device_id does not match registration"
Assert-Same -Left ([string](Get-Field -Object $desktopAccept -Name "hub_task_id")) -Right $hubTaskId -Message "Desktop accept hub_task_id does not match dispatch"
Assert-Same -Left ([string](Get-Field -Object $edgeRun -Name "hub_task_id")) -Right $hubTaskId -Message "Edge run hub_task_id does not match dispatch"
Assert-Same -Left ([string](Get-Field -Object $hubReplay -Name "hub_task_id")) -Right $hubTaskId -Message "Hub replay hub_task_id does not match dispatch"
Assert-Same -Left ([string](Get-Field -Object $webRender -Name "hub_task_id")) -Right $hubTaskId -Message "Web render hub_task_id does not match dispatch"
Assert-Same -Left ([string](Get-Field -Object $webRender -Name "team_run_id")) -Right ([string](Get-Field -Object $hubReplay -Name "team_run_id")) -Message "Web render team_run_id does not match Hub replay"
Assert-Same -Left ([string](Get-Field -Object $hubReplay -Name "edge_run_id")) -Right $edgeRunId -Message "forged Hub replay reference"
Assert-Same -Left ([string](Get-Field -Object $webRender -Name "edge_run_id")) -Right $edgeRunId -Message "Web render edge_run_id does not match Edge run"
Assert-Same -Left ([string](Get-Field -Object $hubReplay -Name "adapter_id")) -Right $adapterId -Message "Hub replay adapter_id does not match Edge run"
Assert-Same -Left ([string](Get-Field -Object $webRender -Name "adapter_id")) -Right $adapterId -Message "Web render adapter_id does not match Edge run"

$registeredOrigin = Get-Origin $registeredDesktopUrl
$dispatchOrigin = Get-Origin $dispatchTargetUrl
$desktopAcceptOrigin = Get-Origin $desktopAcceptUrl
$localEdgeOrigin = Get-Origin $localEdgeUrl

if ($targetKind -ne "desktop_bridge" -and $targetKind -ne "registered_desktop_bridge") {
    Add-Failure "direct Hub-to-LocalEdge target is not accepted"
}
if (-not [string]::IsNullOrWhiteSpace($dispatchOrigin) -and $dispatchOrigin -eq $localEdgeOrigin) {
    Add-Failure "direct Hub-to-LocalEdge target is not accepted"
}
if (-not [string]::IsNullOrWhiteSpace($dispatchOrigin) -and -not [string]::IsNullOrWhiteSpace($registeredOrigin) -and $dispatchOrigin -ne $registeredOrigin) {
    Add-Failure "observed Hub dispatch target does not match registered Desktop bridge"
}
if (-not [string]::IsNullOrWhiteSpace($desktopAcceptOrigin) -and -not [string]::IsNullOrWhiteSpace($registeredOrigin) -and $desktopAcceptOrigin -ne $registeredOrigin) {
    Add-Failure "observed Desktop accept URL does not match registered Desktop bridge"
}

Require-ObservedEvent -EventRef ([string](Get-Field -Object $registration -Name "event_ref")) -ExpectedType "target.registered" -Label "target registration"
Require-ObservedEvent -EventRef ([string](Get-Field -Object $dispatch -Name "event_ref")) -ExpectedType "hub.agent.dispatch" -Label "dispatch"
Require-ObservedEvent -EventRef ([string](Get-Field -Object $desktopAccept -Name "event_ref")) -ExpectedType "desktop.dispatch.accepted" -Label "Desktop accept"
Require-ObservedEvent -EventRef ([string](Get-Field -Object $edgeRun -Name "event_ref")) -ExpectedType "edge.run.started" -Label "Edge run"
Require-ObservedEvent -EventRef $replayEventRef -ExpectedType "hub.replay.recorded" -Label "Hub replay"
Require-ObservedEvent -EventRef $webRenderEventRef -ExpectedType "web.replay.rendered" -Label "Web render"

if ($replayRef -ne $replayEventRef) {
    Add-Failure "forged Hub replay reference"
}
if ($null -eq (Get-EventByRef $replayRef)) {
    Add-Failure "forged Hub replay reference"
}
if ($webRenderReplayRef -ne $replayRef) {
    Add-Failure "Web render replay_ref does not match Hub replay"
}
if ($webRenderSource -ne "hub-replay") {
    Add-Failure "Web render source must be hub-replay"
}
if ((Get-Field -Object $webRender -Name "observed") -ne $true) {
    Add-Failure "Web render proof is not marked observed"
}

$requiredTypes = @(
    "target.registered",
    "hub.agent.dispatch",
    "desktop.dispatch.accepted",
    "edge.run.started",
    "hub.replay.recorded",
    "web.replay.rendered"
)
$lastIndex = -1
foreach ($type in $requiredTypes) {
    $index = Get-EventIndex $type
    if ($index -lt 0) {
        if ($type -eq "hub.agent.dispatch") {
            Add-Failure "missing observed dispatch event"
        } else {
            Add-Failure "missing observed event: $type"
        }
        continue
    }
    if ($index -le $lastIndex) {
        Add-Failure "observed event order is invalid at $type"
    }
    $lastIndex = $index
}

$status = if ($Failures.Count -eq 0) { "OBSERVED_DISPATCH_PASSED" } else { "OBSERVED_DISPATCH_FAILED" }
Write-Report -Status $status

Step "Boundary summary"
Write-Host "  caller URL hints are not accepted as dispatch proof" -ForegroundColor White
Write-Host "  no real TokenDanceID login" -ForegroundColor White
Write-Host "  no real CLI/model adapter invocation by this verifier" -ForegroundColor White
Write-Host "  no public deploy/signing/release upload" -ForegroundColor White
Write-Host "  EvidencePath: $EvidencePath" -ForegroundColor White

if ($Failures.Count -eq 0) {
    Write-Host "Status: OBSERVED_DISPATCH_PASSED" -ForegroundColor Green
    if ((Get-Content -Raw -LiteralPath $EvidencePath | ConvertFrom-Json).real_tested -eq $true) {
        Write-Host "RealTested=true" -ForegroundColor White
    } else {
        Write-Host "RealTested=false" -ForegroundColor White
    }
    exit 0
}

Write-Host "Status: OBSERVED_DISPATCH_FAILED" -ForegroundColor Red
Write-Host "RealTested=false" -ForegroundColor White
exit 1
