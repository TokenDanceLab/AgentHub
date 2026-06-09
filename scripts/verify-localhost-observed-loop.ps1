#!/usr/bin/env pwsh
<#
AgentHub localhost observed loop gate.

This is no-spend glue for the localhost product loop:
Web 5174 -> Hub 8080 -> Desktop/Tauri evidence bridge 5173 -> Local Edge 3210
-> fixture adapter -> Hub replay -> Web transcript/approval/artifact render.

It defaults to a readiness-only manifest and does not perform real login,
real CLI/model/API invocation, deploy, signing, release upload, or mobile work.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [ValidateSet("ReadinessOnly", "FixtureManifest", "ApprovedReal")]
    [string]$Mode = "ReadinessOnly",
    [string]$ArtifactRoot = "",
    [string]$ManifestPath = "",
    [string]$ObservedEvidencePath = "",
    [string]$ObservedDispatchReportPath = "",
    [switch]$ApproveRealEvidence,
    [switch]$CleanArtifactRoot,

    [string[]]$RequiredEnvironmentNames = @(
        "AGENTHUB_WEB_URL",
        "AGENTHUB_HUB_URL",
        "AGENTHUB_DESKTOP_BRIDGE_URL",
        "AGENTHUB_LOCAL_EDGE_URL",
        "AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT"
    ),
    [string[]]$SuppliedEnvironmentNames = @(),
    [switch]$UseEnvironment,

    [string]$WebUrl = "http://127.0.0.1:5174",
    [string]$HubUrl = "http://127.0.0.1:8080",
    [string]$DesktopBridgeUrl = "http://127.0.0.1:5173",
    [string]$LocalEdgeUrl = "http://127.0.0.1:3210",
    [string]$RegisteredTargetUrl = "",
    [string]$HubDispatchTargetUrl = "",
    [string]$RunNote = "",
    [int]$TimeoutSec = 12,
    [switch]$ProbeServices,
    [switch]$StartServices,
    [string]$StartServicePlanPath = ""
)

$ErrorActionPreference = "Stop"

if ($TimeoutSec -le 0) {
    Write-Host "FAIL: -TimeoutSec must be greater than zero." -ForegroundColor Red
    exit 2
}

$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
    $ArtifactRoot = Join-Path $RepoRoot ".tmp\localhost-observed-loop\run-$PID"
}
if ([System.IO.Path]::IsPathRooted($ArtifactRoot)) {
    $ArtifactRoot = [System.IO.Path]::GetFullPath($ArtifactRoot)
} else {
    $ArtifactRoot = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $ArtifactRoot))
}

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    if ($Mode -eq "FixtureManifest") {
        $ManifestPath = Join-Path $ArtifactRoot "observed-dispatch-manifest.json"
    } else {
        $ManifestPath = Join-Path $ArtifactRoot "localhost-observed-loop-readiness.json"
    }
}
if ([System.IO.Path]::IsPathRooted($ManifestPath)) {
    $ManifestPath = [System.IO.Path]::GetFullPath($ManifestPath)
} else {
    $ManifestPath = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $ManifestPath))
}

if ([string]::IsNullOrWhiteSpace($ObservedDispatchReportPath)) {
    $ObservedDispatchReportPath = Join-Path $ArtifactRoot "observed-dispatch-report.json"
}
if ([System.IO.Path]::IsPathRooted($ObservedDispatchReportPath)) {
    $ObservedDispatchReportPath = [System.IO.Path]::GetFullPath($ObservedDispatchReportPath)
} else {
    $ObservedDispatchReportPath = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $ObservedDispatchReportPath))
}

$Failures = @()
$Warnings = @()
$GeneratedAt = Get-Date
$StartupLog = Join-Path $ArtifactRoot "logs\startup.log"
$CleanupLog = Join-Path $ArtifactRoot "logs\cleanup.log"
$ReadinessGatePath = Join-Path $ArtifactRoot "local-stack-readiness.json"

function Add-Failure([string]$Text) {
    $script:Failures += $Text
    Write-Host "FAIL: $Text" -ForegroundColor Red
}

function Add-Warning([string]$Text) {
    $script:Warnings += $Text
    Write-Host "WARN: $Text" -ForegroundColor Yellow
}

function Pass([string]$Text) {
    Write-Host "PASS: $Text" -ForegroundColor Green
}

function Redact-SecretLike {
    param([string]$Value)

    if ([string]::IsNullOrEmpty($Value)) {
        return $Value
    }

    $safe = $Value
    $safe = $safe -replace '(?i)(Authorization:\s*Bearer\s+)[^"''\s,}]+', '${1}<redacted-token>'
    $safe = $safe -replace '(?i)(bearer\s+)[a-z0-9._-]{12,}', '${1}<redacted-token>'
    $safe = $safe -replace '(?i)(sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{8,}', '<redacted-token>'
    $safe = $safe -replace '(?i)((?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)\s*[=:]\s*)[^"''\s,}]+', '${1}<redacted-secret>'
    $safe = $safe -replace '(?i)("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)"?\s*:\s*")[^"]+', '${1}<redacted-secret>'
    return $safe
}

function Test-SecretLike([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }
    return $Value -match '(?i)(Authorization:\s*Bearer\s+[^"''\s,}]+|bearer\s+[a-z0-9._-]{12,}|(?:sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{8,}|access[_-]?token\s*[=:]|refresh[_-]?token\s*[=:]|id[_-]?token\s*[=:]|client_secret\s*[=:]|password\s*[=:])'
}

function Get-FullPath {
    param([string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
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
    $prefix = $normalizedRoot + [System.IO.Path]::DirectorySeparatorChar
    return $normalized.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-AllowedArtifactRoot([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $false
    }

    $candidate = Get-FullPath $Path
    $tempBase = if (-not [string]::IsNullOrWhiteSpace($env:TEMP)) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
    $allowedRoots = @(
        (Join-Path $RepoRoot ".tmp\localhost-observed-loop"),
        (Join-Path $RepoRoot "tmp\localhost-observed-loop"),
        (Join-Path $tempBase "AgentHub\localhost-observed-loop")
    )

    foreach ($root in $allowedRoots) {
        if (Test-PathUnderRoot -Path $candidate -Root $root) {
            return $true
        }
    }
    return $false
}

function Test-AllowedManifestPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $false
    }
    $candidate = Get-FullPath $Path
    if (Test-AllowedArtifactRoot $candidate) {
        return $true
    }
    if ((Test-AllowedArtifactRoot $ArtifactRoot) -and (Test-PathUnderRoot -Path $candidate -Root $ArtifactRoot)) {
        return $true
    }
    return $false
}

function Test-LoopbackHttpUrl([string]$Url) {
    try {
        $uri = [System.Uri]::new($Url)
        if ($uri.Scheme -ne "http") {
            return $false
        }
        return @("127.0.0.1", "localhost", "::1", "[::1]") -contains $uri.Host.ToLowerInvariant()
    }
    catch {
        return $false
    }
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

function Get-UrlPort([string]$Url) {
    try {
        return [System.Uri]::new($Url).Port
    }
    catch {
        return $null
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

function Find-PowerShell {
    $pwsh = Get-Command "pwsh" -ErrorAction SilentlyContinue
    if ($pwsh) {
        return $pwsh.Source
    }
    $powershell = Get-Command "powershell" -ErrorAction SilentlyContinue
    if ($powershell) {
        return $powershell.Source
    }
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
            Output = (Redact-SecretLike ($stdout + "`n" + $stderr))
        }
    }
    catch {
        return [pscustomobject]@{
            ExitCode = -1
            Output = (Redact-SecretLike $_.Exception.Message)
        }
    }
}

function Invoke-RepoScript {
    param(
        [string]$RelativePath,
        [string[]]$Arguments
    )

    $scriptPath = Join-Path $RepoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        return [pscustomobject]@{ ExitCode = -1; Output = "missing $RelativePath" }
    }

    $powershellExe = Find-PowerShell
    if (-not $powershellExe) {
        return [pscustomobject]@{ ExitCode = -1; Output = "PowerShell executable is unavailable" }
    }

    return Invoke-CapturedProcess $powershellExe (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath) + $Arguments) $RepoRoot
}

function Assert-StaticBoundary {
    if (-not (Test-AllowedArtifactRoot $ArtifactRoot)) {
        Add-Failure "artifact root must stay under .tmp\localhost-observed-loop, tmp\localhost-observed-loop, or `$env:TEMP\AgentHub\localhost-observed-loop"
    }
    if (-not (Test-AllowedManifestPath $ManifestPath)) {
        Add-Failure "ManifestPath must stay under the artifact root or allowed localhost-observed-loop temp roots"
    }
    if (-not (Test-AllowedManifestPath $ObservedDispatchReportPath)) {
        Add-Failure "ObservedDispatchReportPath must stay under the artifact root or allowed localhost-observed-loop temp roots"
    }

    foreach ($pair in @(
        @{ Name = "WebUrl"; Value = $WebUrl; Port = 5174 },
        @{ Name = "HubUrl"; Value = $HubUrl; Port = 8080 },
        @{ Name = "DesktopBridgeUrl"; Value = $DesktopBridgeUrl; Port = 5173 },
        @{ Name = "LocalEdgeUrl"; Value = $LocalEdgeUrl; Port = 3210 }
    )) {
        if (-not (Test-LoopbackHttpUrl $pair.Value)) {
            Add-Failure "$($pair.Name) must be loopback HTTP"
        }
        $port = Get-UrlPort $pair.Value
        if ($port -ne $pair.Port) {
            Add-Warning "$($pair.Name) uses port $port instead of expected $($pair.Port); this remains readiness-only"
        }
    }

    $desktopOrigin = Get-Origin $DesktopBridgeUrl
    $edgeOrigin = Get-Origin $LocalEdgeUrl
    foreach ($pair in @(
        @{ Name = "registered target URL"; Value = $RegisteredTargetUrl },
        @{ Name = "Hub dispatch target URL"; Value = $HubDispatchTargetUrl }
    )) {
        if ([string]::IsNullOrWhiteSpace($pair.Value)) {
            continue
        }
        if (-not (Test-LoopbackHttpUrl $pair.Value)) {
            Add-Failure "$($pair.Name) must be loopback HTTP"
            continue
        }
        $origin = Get-Origin $pair.Value
        if ($origin -eq $edgeOrigin) {
            Add-Failure "$($pair.Name) must point to Desktop bridge, not Local Edge"
        } elseif ($origin -ne $desktopOrigin) {
            Add-Failure "$($pair.Name) must point to Desktop bridge"
        }
    }

    foreach ($name in $RequiredEnvironmentNames) {
        if (Test-SecretLike $name) {
            Add-Failure "required environment name contains secret-like material"
        }
    }
}

function Get-SuppliedEnvironmentNameList {
    $available = @()
    foreach ($rawName in $SuppliedEnvironmentNames) {
        foreach ($name in ([string]$rawName -split ",")) {
            $trimmed = $name.Trim()
            if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
                $available += $trimmed
            }
        }
    }
    if ($UseEnvironment) {
        foreach ($name in $RequiredEnvironmentNames) {
            if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
                $available += $name
            }
        }
    }
    return @($available | Select-Object -Unique)
}

function Initialize-ArtifactRoot {
    if (-not (Test-AllowedArtifactRoot $ArtifactRoot)) {
        return
    }

    if ($CleanArtifactRoot -and (Test-Path -LiteralPath $ArtifactRoot)) {
        Remove-Item -LiteralPath $ArtifactRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StartupLog) | Out-Null
    "started=$(Get-Date -Format o)" | Set-Content -LiteralPath $StartupLog -Encoding UTF8
    "clean_artifact_root=$([bool]$CleanArtifactRoot)" | Set-Content -LiteralPath $CleanupLog -Encoding UTF8
}

function Write-JsonFile {
    param(
        [object]$Value,
        [string]$Path
    )

    $dir = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $json = $Value | ConvertTo-Json -Depth 14
    $json = Redact-SecretLike $json
    $json | Set-Content -LiteralPath $Path -Encoding UTF8
}

function New-ReadinessManifest {
    param([string]$Status)

    $safeNote = Redact-SecretLike $RunNote
    return [ordered]@{
        schema = "agenthub-localhost-observed-loop-readiness-v1"
        status = $Status
        mode = $Mode
        evidence_origin = "readiness_only"
        real_tested = $false
        generated_at = $GeneratedAt.ToString("o")
        repo_root = $RepoRoot
        artifact_root = $ArtifactRoot
        topology = [ordered]@{
            web_url = $WebUrl
            hub_url = $HubUrl
            desktop_bridge_url = $DesktopBridgeUrl
            local_edge_url = $LocalEdgeUrl
            registered_target_url = $RegisteredTargetUrl
            hub_dispatch_target_url = $HubDispatchTargetUrl
            web_port = 5174
            hub_port = 8080
            desktop_tauri_evidence_port = 5173
            local_edge_port = 3210
            web_upstream = "hub"
            hub_dispatch_target = "registered-desktop-bridge"
            desktop_handoff = "local-edge"
            direct_hub_to_local_edge = ((Get-Origin $HubDispatchTargetUrl) -eq (Get-Origin $LocalEdgeUrl) -and -not [string]::IsNullOrWhiteSpace($HubDispatchTargetUrl))
        }
        chain = [ordered]@{
            web = "5174"
            hub = "8080"
            desktop_tauri_evidence = "5173"
            local_edge = "3210"
            fixture_adapter = "fixture-sdk-adapter"
            hub_replay = "required"
            web_render = "transcript_approval_artifact"
        }
        paths = [ordered]@{
            manifest = $ManifestPath
            startup_log = $StartupLog
            cleanup_log = $CleanupLog
            readiness_gate = $ReadinessGatePath
            observed_dispatch_report = $ObservedDispatchReportPath
        }
        required_environment_names = @($RequiredEnvironmentNames)
        supplied_environment_names = @(Get-SuppliedEnvironmentNameList)
        observed_manifest_contract = [ordered]@{
            required_schema = "agenthub-observed-localhost-dispatch-v1"
            accepted_origins = @("observed_hub_manifest", "observed_desktop_path")
        }
        gates = @(
            [ordered]@{
                name = "verify-local-stack-e2e-readiness.ps1"
                mode = if ($Mode -eq "ApprovedReal") { "ApprovedReal" } else { "ReadinessOnly" }
                status = if ($Mode -eq "ApprovedReal") { "SEE_READINESS_GATE" } else { "NOT_RUN_BY_DEFAULT" }
                evidence = $ReadinessGatePath
                probe_services = [bool]$ProbeServices
                start_services = [bool]$StartServices
            },
            [ordered]@{
                name = "verify-observed-localhost-dispatch.ps1"
                mode = "FixtureManifestOrApprovedReal"
                status = if ($Mode -eq "ReadinessOnly") { "NOT_RUN_READINESS_ONLY" } else { "SEE_OBSERVED_REPORT" }
                evidence = $ObservedDispatchReportPath
            }
        )
        claims = [ordered]@{
            real_tokendance_id_login = $false
            real_cli_or_model_invoked_by_this_runner = $false
            public_deploy_signing_release = $false
            mobile = $false
        }
        boundaries = [ordered]@{
            no_real_login = $true
            no_real_cli_model_api_spend = $true
            no_deploy_signing_release = $true
            direct_hub_to_local_edge_rejected = $true
            readiness_only_until_observed_manifest = $true
        }
        run_note = $safeNote
        failures = @($Failures)
        warnings = @($Warnings)
        blockers = @(
            "real TokenDanceID login is intentionally not performed",
            "real CLI/model/API invocation is intentionally not performed",
            "ApprovedReal requires an observed dispatch manifest and explicit approval",
            "direct Hub-to-LocalEdge dispatch is rejected"
        )
    }
}

function New-ObservedFixtureManifest {
    $events = @(
        [ordered]@{ id = "evt-localhost-001"; type = "target.registered"; actor = "hub"; source = "hub.target_registry"; observed = $true },
        [ordered]@{ id = "evt-localhost-002"; type = "web.teamrun.start"; actor = "web"; source = "web.5174"; observed = $true },
        [ordered]@{ id = "evt-localhost-003"; type = "hub.agent.dispatch"; actor = "hub"; source = "hub.dispatch_log"; observed = $true },
        [ordered]@{ id = "evt-localhost-004"; type = "desktop.dispatch.accepted"; actor = "desktop"; source = "desktop.tauri_evidence"; observed = $true },
        [ordered]@{ id = "evt-localhost-005"; type = "edge.run.started"; actor = "desktop-local-edge"; source = "edge.run_log"; observed = $true },
        [ordered]@{ id = "evt-localhost-006"; type = "hub.replay.recorded"; actor = "hub"; source = "hub.replay_store"; observed = $true },
        [ordered]@{ id = "evt-localhost-007"; type = "web.replay.rendered"; actor = "web"; source = "web.transcript_approval_artifact_render"; observed = $true }
    )

    return [ordered]@{
        schema = "agenthub-observed-localhost-dispatch-v1"
        evidence_origin = "observed_desktop_path"
        real_tested = $false
        approval_gate = ""
        topology = [ordered]@{
            web = [ordered]@{ url = $WebUrl; port = 5174; upstream = "hub" }
            hub = [ordered]@{ url = $HubUrl; port = 8080 }
            desktop_bridge = [ordered]@{ url = $DesktopBridgeUrl; port = 5173; evidence = "tauri-sidecar-fixture" }
            local_edge = [ordered]@{ url = $LocalEdgeUrl; port = 3210 }
        }
        target_registration = [ordered]@{
            target_id = "target-localhost-observed-loop-001"
            edge_device_id = "desktop-device-localhost-001"
            target_kind = "desktop_bridge"
            desktop_bridge_url = $DesktopBridgeUrl
            source = "hub.target_registry"
            event_ref = "evt-localhost-001"
        }
        dispatch = [ordered]@{
            hub_task_id = "task-localhost-observed-loop-001"
            target_id = "target-localhost-observed-loop-001"
            edge_device_id = "desktop-device-localhost-001"
            dispatch_target_url = $DesktopBridgeUrl
            source = "hub.dispatch_log"
            event_ref = "evt-localhost-003"
        }
        desktop_accept = [ordered]@{
            hub_task_id = "task-localhost-observed-loop-001"
            target_id = "target-localhost-observed-loop-001"
            edge_device_id = "desktop-device-localhost-001"
            desktop_bridge_url = $DesktopBridgeUrl
            local_edge_url = $LocalEdgeUrl
            source = "desktop.tauri_evidence"
            event_ref = "evt-localhost-004"
        }
        edge_run = [ordered]@{
            hub_task_id = "task-localhost-observed-loop-001"
            target_id = "target-localhost-observed-loop-001"
            edge_device_id = "desktop-device-localhost-001"
            edge_run_id = "edge-run-localhost-observed-loop-001"
            adapter_id = "fixture-sdk-adapter"
            source = "edge.run_log"
            event_ref = "evt-localhost-005"
        }
        hub_replay = [ordered]@{
            team_run_id = "teamrun-localhost-observed-loop-001"
            hub_task_id = "task-localhost-observed-loop-001"
            target_id = "target-localhost-observed-loop-001"
            edge_device_id = "desktop-device-localhost-001"
            edge_run_id = "edge-run-localhost-observed-loop-001"
            adapter_id = "fixture-sdk-adapter"
            replay_ref = "evt-localhost-006"
            source = "hub.replay_store"
            event_ref = "evt-localhost-006"
        }
        web_render = [ordered]@{
            team_run_id = "teamrun-localhost-observed-loop-001"
            hub_task_id = "task-localhost-observed-loop-001"
            target_id = "target-localhost-observed-loop-001"
            edge_device_id = "desktop-device-localhost-001"
            edge_run_id = "edge-run-localhost-observed-loop-001"
            adapter_id = "fixture-sdk-adapter"
            replay_ref = "evt-localhost-006"
            render_source = "hub-replay"
            rendered_blocks = @("transcript", "approval", "artifact")
            observed = $true
            source = "web.transcript_approval_artifact_render"
            event_ref = "evt-localhost-007"
        }
        events = $events
        claims = [ordered]@{
            real_tokendance_id_login = $false
            real_cli_or_model_invoked = $false
            public_deploy_signing_release = $false
        }
    }
}

Write-Host "AgentHub localhost observed loop gate" -ForegroundColor Magenta
Write-Host "Mode: $Mode" -ForegroundColor White
Write-Host "No real TokenDanceID login, real CLI/model/API spend, deploy, signing, or release upload will be performed." -ForegroundColor White

Assert-StaticBoundary
if ($Failures.Count -eq 0) {
    Initialize-ArtifactRoot
}

if ($Mode -eq "ReadinessOnly") {
    $status = if ($Failures.Count -eq 0) { "READINESS_ONLY_MANIFEST_WRITTEN" } else { "LOCALHOST_OBSERVED_LOOP_FAILED" }
    if (Test-AllowedManifestPath $ManifestPath) {
        Write-JsonFile (New-ReadinessManifest -Status $status) $ManifestPath
    }
    Write-Host "ManifestPath: $ManifestPath" -ForegroundColor White
    Write-Host "StartupLog: $StartupLog" -ForegroundColor White
    Write-Host "CleanupLog: $CleanupLog" -ForegroundColor White
    Write-Host "Status: $status" -ForegroundColor $(if ($Failures.Count -eq 0) { "Green" } else { "Red" })
    Write-Host "RealTested=false" -ForegroundColor White
    if ($Failures.Count -eq 0) { exit 0 } else { exit 1 }
}

if ($Mode -eq "FixtureManifest") {
    if ($Failures.Count -eq 0) {
        Write-JsonFile (New-ObservedFixtureManifest) $ManifestPath
        Pass "fixture observed-dispatch manifest written"
        $observedRun = Invoke-RepoScript "scripts\verify-observed-localhost-dispatch.ps1" @(
            "-RepoRoot", $RepoRoot,
            "-ObservedEvidencePath", $ManifestPath,
            "-EvidencePath", $ObservedDispatchReportPath,
            "-TimeoutSec", ([string]$TimeoutSec)
        )
        Write-Host $observedRun.Output
        if ($observedRun.ExitCode -ne 0) {
            Add-Failure "observed localhost dispatch verifier rejected fixture manifest"
        }
    }
    if ($Failures.Count -ne 0 -and (Test-AllowedManifestPath $ManifestPath) -and -not (Test-Path -LiteralPath $ManifestPath)) {
        Write-JsonFile (New-ReadinessManifest -Status "LOCALHOST_OBSERVED_LOOP_FAILED") $ManifestPath
    }
    $status = if ($Failures.Count -eq 0) { "FIXTURE_OBSERVED_MANIFEST_PASSED" } else { "LOCALHOST_OBSERVED_LOOP_FAILED" }
    Write-Host "Status: $status" -ForegroundColor $(if ($Failures.Count -eq 0) { "Green" } else { "Red" })
    Write-Host "RealTested=false" -ForegroundColor White
    if ($Failures.Count -eq 0) { exit 0 } else { exit 1 }
}

if ($Mode -eq "ApprovedReal") {
    if (-not $ApproveRealEvidence) {
        Add-Failure "ApprovedReal requires -ApproveRealEvidence"
    }
    if ([string]::IsNullOrWhiteSpace($ObservedEvidencePath)) {
        Add-Failure "ApprovedReal requires -ObservedEvidencePath"
    }
    if ($Failures.Count -eq 0) {
        $readinessArgs = @(
            "-RepoRoot", $RepoRoot,
            "-Mode", "ApprovedReal",
            "-EvidencePath", $ReadinessGatePath,
            "-ArtifactRoot", $ArtifactRoot,
            "-SuppliedEnvironmentNames", (($RequiredEnvironmentNames -join ",")),
            "-ObservedEvidencePath", $ObservedEvidencePath,
            "-ApproveRealEvidence"
        )
        if ($ProbeServices) {
            $readinessArgs += "-ProbeServices"
        }
        if ($StartServices) {
            $readinessArgs += "-StartServices"
            $readinessArgs += "-StartServicePlanPath"
            $readinessArgs += $StartServicePlanPath
        }
        $readinessRun = Invoke-RepoScript "scripts\verify-local-stack-e2e-readiness.ps1" $readinessArgs
        Write-Host $readinessRun.Output
        if ($readinessRun.ExitCode -ne 0) {
            Add-Failure "local-stack ApprovedReal readiness gate failed"
        }

        $observedRun = Invoke-RepoScript "scripts\verify-observed-localhost-dispatch.ps1" @(
            "-RepoRoot", $RepoRoot,
            "-ObservedEvidencePath", $ObservedEvidencePath,
            "-EvidencePath", $ObservedDispatchReportPath,
            "-AllowRealTestedApproval",
            "-TimeoutSec", ([string]$TimeoutSec)
        )
        Write-Host $observedRun.Output
        if ($observedRun.ExitCode -ne 0) {
            Add-Failure "observed localhost dispatch gate failed"
        }
    }

    $realTested = $false
    if (($Failures.Count -eq 0) -and (Test-Path -LiteralPath $ObservedDispatchReportPath)) {
        $observedReport = Get-Content -Raw -LiteralPath $ObservedDispatchReportPath | ConvertFrom-Json
        $realTested = ($observedReport.real_tested -eq $true)
    }

    $status = if ($Failures.Count -eq 0) {
        if ($realTested) { "APPROVED_REAL_PASSED" } else { "APPROVED_REAL_READINESS_ONLY_PASSED" }
    } else {
        "LOCALHOST_OBSERVED_LOOP_FAILED"
    }
    Write-JsonFile (New-ReadinessManifest -Status $status) $ManifestPath
    Write-Host "Status: $status" -ForegroundColor $(if ($Failures.Count -eq 0) { "Green" } else { "Red" })
    Write-Host "RealTested=$([string]$realTested)" -ForegroundColor White
    if ($Failures.Count -eq 0) { exit 0 } else { exit 1 }
}
