#!/usr/bin/env pwsh
<#
AgentHub P1 localhost real-services smoke verifier.

This is an explicit opt-in readiness probe for already-running or explicitly
started localhost services. It does not perform TokenDanceID login, observe
live Hub registration/dispatch, run a real CLI/model adapter, deploy, sign,
upload, or call public endpoints.

RealTested is always false. Health markers and caller-supplied topology hints
can prove readiness only; live Hub dispatch proof requires a separate observed
Hub/Desktop evidence source.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [string]$EvidencePath = "",
    [switch]$RealServices,
    [switch]$StartServices,
    [string]$StartServicePlanPath = "",
    [int]$TimeoutSec = 12,

    [string]$WebUrl = "http://127.0.0.1:5174",
    [string]$HubUrl = "http://127.0.0.1:8080",
    [string]$DesktopBridgeUrl = "http://127.0.0.1:5173",
    [string]$LocalEdgeUrl = "http://127.0.0.1:3210",

    [string]$WebHealthPath = "/",
    [string]$HubHealthPath = "/health/live",
    [string]$DesktopHealthPath = "/",
    [string]$EdgeHealthPath = "/v1/health",

    [string]$ExpectedWebMarker = "",
    [string]$ExpectedHubMarker = "",
    [string]$ExpectedDesktopMarker = "",
    [string]$ExpectedEdgeMarker = "",

    [string]$RegisteredTargetUrl = "",
    [string]$HubDispatchTargetUrl = "",
    [ValidateSet("hub", "local-edge", "unknown")]
    [string]$WebUpstreamMode = "hub",
    [ValidateSet("local-edge", "hub", "unknown")]
    [string]$DesktopUpstreamMode = "local-edge"
)

$ErrorActionPreference = "Stop"

if ($TimeoutSec -le 0) {
    Write-Host "FAIL: -TimeoutSec must be greater than zero." -ForegroundColor Red
    exit 2
}

$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-localhost-real-services-$PID.json"
}

$StartedProcesses = @()
$Failures = @()
$Warnings = @()
$StartedByHarness = $false
$StartedAt = Get-Date

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
        $uriHost = $uri.Host.ToLowerInvariant()
        return (@("127.0.0.1", "localhost", "::1", "[::1]") -contains $uriHost)
    }
    catch {
        return $false
    }
}

function Join-UrlPath {
    param(
        [string]$BaseUrl,
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $BaseUrl
    }
    if ($Path.StartsWith("/")) {
        return $BaseUrl.TrimEnd("/") + $Path
    }
    return $BaseUrl.TrimEnd("/") + "/" + $Path
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

function Write-Evidence {
    param(
        [object[]]$Services,
        [string]$Status
    )

    $evidence = [ordered]@{
        schema = "agenthub-localhost-real-services-v1"
        mode = if ($RealServices) { "ReadinessOnly" } else { "RealServicesOptInRequired" }
        status = $Status
        real_tested = $false
        generated_at = (Get-Date).ToString("o")
        repo_root = $RepoRoot
        started_by_harness = $StartedByHarness
        no_real_tokendance_id_login = $true
        no_real_cli_or_model_spend = if ($StartServices) { $null } else { $true }
        cli_or_model_spend_claim = if ($StartServices) { "operator_attested_start_plan_not_verified_by_harness" } else { "not_started_by_harness" }
        no_public_deploy_signing_or_release = $true
        services = $Services
        readiness_only = $true
        real_dispatch_proof_required = $true
        topology = [ordered]@{
            web = [ordered]@{
                url = $WebUrl
                upstream_mode = $WebUpstreamMode
                allowed_upstream = "hub"
            }
            hub = [ordered]@{
                url = $HubUrl
                registered_target_url = $RegisteredTargetUrl
                dispatch_target_url = $HubDispatchTargetUrl
                must_route_to_registered_desktop_bridge = $true
            }
            desktop_bridge = [ordered]@{
                url = $DesktopBridgeUrl
                upstream_mode = $DesktopUpstreamMode
                allowed_upstream = "local-edge"
            }
            local_edge = [ordered]@{
                url = $LocalEdgeUrl
                real_cli_or_model_invoked = $false
            }
        }
        failures = @($Failures)
        warnings = @($Warnings)
        blockers = @(
            "real TokenDanceID login is intentionally not performed",
            "live Hub registration/dispatch proof is not observed by this readiness-only verifier",
            "real CLI/model adapter invocation is not performed by this verifier",
            "public deploy/signing/release upload is intentionally not performed"
        )
    }
    if ($StartServices) {
        $evidence.blockers += "CLI/model spend cannot be asserted by this verifier when StartServices runs operator-supplied commands"
    }

    $dir = Split-Path -Parent $EvidencePath
    if (-not [string]::IsNullOrWhiteSpace($dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}

function Invoke-ServiceProbe {
    param(
        [string]$Name,
        [string]$BaseUrl,
        [string]$HealthPath,
        [string]$ExpectedMarker
    )

    $healthUrl = Join-UrlPath $BaseUrl $HealthPath
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $lastError = ""

    do {
        try {
            $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
            $body = [string]$response.Content
            $markerMatched = $body -match $ExpectedMarker
            $result = [ordered]@{
                service = $Name
                url = $BaseUrl
                health_url = $healthUrl
                status_code = [int]$response.StatusCode
                status = if ($markerMatched) { "healthy" } else { "wrong_marker" }
                expected_marker = $ExpectedMarker
                marker_matched = $markerMatched
                body_excerpt = if ($body.Length -gt 240) { $body.Substring(0, 240) } else { $body }
            }
            if ($markerMatched) {
                Pass "$Name service responded with expected identity marker"
            } else {
                Add-Failure "$Name identity marker mismatch"
            }
            return [pscustomobject]$result
        }
        catch {
            $lastError = $_.Exception.Message
            Start-Sleep -Milliseconds 250
        }
    } while ((Get-Date) -lt $deadline)

    Add-Failure "missing service: $Name at $healthUrl ($lastError)"
    return [pscustomobject][ordered]@{
        service = $Name
        url = $BaseUrl
        health_url = $healthUrl
        status_code = $null
        status = "missing"
        expected_marker = $ExpectedMarker
        marker_matched = $false
        error = $lastError
    }
}

function Assert-ExpectedMarkerSupplied {
    param(
        [string]$Name,
        [string]$ExpectedMarker
    )

    if ([string]::IsNullOrWhiteSpace($ExpectedMarker)) {
        Add-Failure "expected identity marker missing: $Name"
        return
    }

    Pass "$Name expected identity marker is explicit"
}

function Start-ServicesFromPlan {
    if ([string]::IsNullOrWhiteSpace($StartServicePlanPath)) {
        Add-Failure "StartServices requires -StartServicePlanPath; no hardcoded dev-start command is run implicitly"
        return
    }
    if (-not (Test-Path -LiteralPath $StartServicePlanPath)) {
        Add-Failure "start service plan is missing: $StartServicePlanPath"
        return
    }

    $plan = Get-Content -Raw -LiteralPath $StartServicePlanPath | ConvertFrom-Json
    foreach ($entry in @($plan.services)) {
        if ([string]::IsNullOrWhiteSpace([string]$entry.fileName)) {
            Add-Failure "start service plan entry is missing fileName"
            continue
        }

        $workingDirectory = [string]$entry.workingDirectory
        if ([string]::IsNullOrWhiteSpace($workingDirectory)) {
            $workingDirectory = $RepoRoot
        }
        if (-not [System.IO.Path]::IsPathRooted($workingDirectory)) {
            $workingDirectory = Join-Path $RepoRoot $workingDirectory
        }

        $psi = [System.Diagnostics.ProcessStartInfo]::new()
        $psi.FileName = [string]$entry.fileName
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.WorkingDirectory = $workingDirectory
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.Arguments = Join-NativeArguments ([string[]]@($entry.arguments))

        try {
            $proc = [System.Diagnostics.Process]::Start($psi)
            $script:StartedProcesses += $proc
            $script:StartedByHarness = $true
            Pass "started $($entry.name) process from explicit start plan"
        }
        catch {
            Add-Failure "failed to start $($entry.name): $($_.Exception.Message)"
        }
    }
}

Write-Host "AgentHub localhost real-services smoke verifier" -ForegroundColor Magenta
Write-Host "No TokenDanceID login, live Hub dispatch proof, deploy, signing, or release upload will be performed." -ForegroundColor Magenta
Write-Host "CLI/model spend is not asserted if -StartServices runs operator-supplied commands." -ForegroundColor Magenta

if (-not $RealServices) {
    Add-Warning "Real services opt-in required: rerun with -RealServices to probe local services."
    Write-Evidence -Services @() -Status "BLOCKED_OPT_IN_REQUIRED"
    Write-Host "Status: BLOCKED_OPT_IN_REQUIRED" -ForegroundColor Yellow
    Write-Host "RealTested=false" -ForegroundColor White
    exit 2
}

try {
    if ($StartServices) {
        Step "Explicit service start plan"
        Start-ServicesFromPlan
    }

    Step "Localhost service probes"
    Assert-ExpectedMarkerSupplied -Name "web" -ExpectedMarker $ExpectedWebMarker
    Assert-ExpectedMarkerSupplied -Name "hub" -ExpectedMarker $ExpectedHubMarker
    Assert-ExpectedMarkerSupplied -Name "desktop-bridge" -ExpectedMarker $ExpectedDesktopMarker
    Assert-ExpectedMarkerSupplied -Name "local-edge" -ExpectedMarker $ExpectedEdgeMarker

    $services = @(
        Invoke-ServiceProbe -Name "web" -BaseUrl $WebUrl -HealthPath $WebHealthPath -ExpectedMarker $ExpectedWebMarker
        Invoke-ServiceProbe -Name "hub" -BaseUrl $HubUrl -HealthPath $HubHealthPath -ExpectedMarker $ExpectedHubMarker
        Invoke-ServiceProbe -Name "desktop-bridge" -BaseUrl $DesktopBridgeUrl -HealthPath $DesktopHealthPath -ExpectedMarker $ExpectedDesktopMarker
        Invoke-ServiceProbe -Name "local-edge" -BaseUrl $LocalEdgeUrl -HealthPath $EdgeHealthPath -ExpectedMarker $ExpectedEdgeMarker
    )

    Step "Registered target topology"
    foreach ($pair in @(
        @{ Name = "WebUrl"; Value = $WebUrl },
        @{ Name = "HubUrl"; Value = $HubUrl },
        @{ Name = "DesktopBridgeUrl"; Value = $DesktopBridgeUrl },
        @{ Name = "LocalEdgeUrl"; Value = $LocalEdgeUrl }
    )) {
        if (Test-LoopbackHttpUrl $pair.Value) {
            Pass "$($pair.Name) is loopback HTTP"
        } else {
            Add-Failure "$($pair.Name) must be a loopback HTTP URL"
        }
    }

    if ([string]::IsNullOrWhiteSpace($RegisteredTargetUrl)) {
        Add-Failure "registered target URL evidence missing"
    } elseif (-not (Test-LoopbackHttpUrl $RegisteredTargetUrl)) {
        Add-Failure "registered target URL must be a loopback HTTP URL"
    }

    if ([string]::IsNullOrWhiteSpace($HubDispatchTargetUrl)) {
        Add-Failure "Hub dispatch target URL evidence missing"
    } elseif (-not (Test-LoopbackHttpUrl $HubDispatchTargetUrl)) {
        Add-Failure "Hub dispatch target URL must be a loopback HTTP URL"
    }

    $registeredOrigin = Get-Origin $RegisteredTargetUrl
    $hubDispatchOrigin = Get-Origin $HubDispatchTargetUrl
    $desktopOrigin = Get-Origin $DesktopBridgeUrl
    $edgeOrigin = Get-Origin $LocalEdgeUrl

    if (-not [string]::IsNullOrWhiteSpace($registeredOrigin) -and -not [string]::IsNullOrWhiteSpace($desktopOrigin)) {
        if ($registeredOrigin -eq $desktopOrigin) {
            Pass "registered target URL matches Desktop bridge URL"
        } else {
            Add-Failure "registered target URL mismatch: registered target must match Desktop bridge URL"
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($hubDispatchOrigin) -and -not [string]::IsNullOrWhiteSpace($registeredOrigin)) {
        if ($hubDispatchOrigin -eq $registeredOrigin) {
            Pass "Hub dispatch target URL matches registered target URL"
        } else {
            Add-Failure "target URL mismatch: Hub dispatch target URL does not match registered target URL"
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($registeredOrigin) -and $registeredOrigin -eq $edgeOrigin) {
        Add-Failure "registered target URL points directly to Local Edge instead of Desktop bridge"
    }
    if (-not [string]::IsNullOrWhiteSpace($hubDispatchOrigin) -and $hubDispatchOrigin -eq $edgeOrigin) {
        Add-Failure "Hub dispatch target URL points directly to Local Edge instead of registered Desktop bridge"
    }

    if ($WebUpstreamMode -eq "hub") {
        Pass "Web upstream mode is Hub"
    } else {
        Add-Failure "Web upstream mode must be Hub, not $WebUpstreamMode"
    }

    if ($DesktopUpstreamMode -eq "local-edge") {
        Pass "Desktop bridge upstream mode is Local Edge"
    } else {
        Add-Failure "Desktop bridge upstream mode must be Local Edge, not $DesktopUpstreamMode"
    }

    $readinessPassed = ($Failures.Count -eq 0)
    $status = if ($readinessPassed) { "READINESS_ONLY_PASSED" } else { "READINESS_ONLY_FAILED" }
    Write-Evidence -Services $services -Status $status

    Step "Boundary summary"
    Write-Host "  ReadinessOnly=true" -ForegroundColor White
    Write-Host "  RealTested=false" -ForegroundColor White
    Write-Host "  no real TokenDanceID login" -ForegroundColor White
    if ($StartServices) {
        Write-Host "  CLI/model spend not asserted; StartServices used operator-supplied commands" -ForegroundColor White
    } else {
        Write-Host "  no real CLI/model adapter invocation by this verifier" -ForegroundColor White
    }
    Write-Host "  live Hub registration/dispatch proof requires separate observed evidence" -ForegroundColor White
    Write-Host "  no public deploy/signing/release upload" -ForegroundColor White
    Write-Host "  EvidencePath: $EvidencePath" -ForegroundColor White

    if ($readinessPassed) {
        Write-Host "Status: READINESS_ONLY_PASSED" -ForegroundColor Green
        exit 0
    }

    Write-Host "Status: READINESS_ONLY_FAILED" -ForegroundColor Red
    Write-Host "RealTested=false" -ForegroundColor White
    exit 1
}
finally {
    foreach ($proc in $StartedProcesses) {
        if ($proc -and -not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
