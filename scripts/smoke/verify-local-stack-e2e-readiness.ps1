#!/usr/bin/env pwsh
<#
AgentHub local stack E2E readiness runner.

This runner composes the existing localhost fixture, localhost real-services,
login-readiness, Edge CLI-readiness, and observed-dispatch gates. It separates:

- FixtureOnly: runs the fixture product-loop harness only.
- ReadinessOnly: checks commands, ports, environment variable names, artifact
  roots, approval-gate blockers, and optionally probes already-running services.
- ApprovedReal: reviews a separate observed-dispatch evidence artifact. It does
  not perform TokenDanceID login or real CLI/model execution itself.

The script fails closed by default. It does not start services unless
-StartServices and -StartServicePlanPath are explicitly provided, and even then
startup is delegated to the bounded existing real-services readiness verifier.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [ValidateSet("FixtureOnly", "ReadinessOnly", "ApprovedReal")]
    [string]$Mode = "ReadinessOnly",
    [string]$EvidencePath = "",
    [string]$ArtifactRoot = "",

    [string[]]$RequiredCommandNames = @("node", "go", "powershell"),
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
    [ValidateSet("hub", "local-edge", "unknown")]
    [string]$WebUpstreamMode = "hub",
    [ValidateSet("local-edge", "hub", "unknown")]
    [string]$DesktopUpstreamMode = "local-edge",

    [string]$WebHealthPath = "/",
    [string]$HubHealthPath = "/health/live",
    [string]$DesktopHealthPath = "/",
    [string]$EdgeHealthPath = "/v1/health",
    [string]$ExpectedWebMarker = "",
    [string]$ExpectedHubMarker = "",
    [string]$ExpectedDesktopMarker = "",
    [string]$ExpectedEdgeMarker = "",
    [int]$TimeoutSec = 12,
    [switch]$ProbeServices,
    [switch]$StartServices,
    [string]$StartServicePlanPath = "",

    [string]$ObservedEvidencePath = "",
    [switch]$ApproveRealEvidence
)

$ErrorActionPreference = "Stop"

if ($TimeoutSec -le 0) {
    Write-Host "FAIL: -TimeoutSec must be greater than zero." -ForegroundColor Red
    exit 2
}

$EvidencePathWasSupplied = -not [string]::IsNullOrWhiteSpace($EvidencePath)
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-local-stack-e2e-readiness-$PID.json"
}

$Failures = @()
$Warnings = @()
$GateResults = @()
$GeneratedAt = Get-Date
$RealTested = $false
# Evidence output starts with real_tested = $false and can only change through ApprovedReal observed evidence.
$Status = "LOCAL_STACK_E2E_READINESS_FAILED"

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

function Add-GateResult {
    param(
        [string]$Name,
        [string]$ModeLabel,
        [int]$ExitCode,
        [string]$StatusLabel,
        [string]$Evidence = ""
    )

    $script:GateResults += [pscustomobject][ordered]@{
        name = $Name
        mode = $ModeLabel
        exit_code = $ExitCode
        status = $StatusLabel
        evidence = $Evidence
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
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        return [pscustomobject]@{
            ExitCode = -1
            Output = "missing $RelativePath"
            ScriptPath = $scriptPath
        }
    }

    $powershellExe = Find-PowerShell
    if (-not $powershellExe) {
        return [pscustomobject]@{
            ExitCode = -1
            Output = "PowerShell executable is unavailable"
            ScriptPath = $scriptPath
        }
    }

    $run = Invoke-CapturedProcess $powershellExe (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath) + $Arguments) $RepoRoot
    $run | Add-Member -NotePropertyName ScriptPath -NotePropertyValue $scriptPath
    return $run
}

function Resolve-RepoPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return $Path
    }
    return Join-Path $RepoRoot $Path
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

    $candidate = [System.IO.Path]::GetFullPath((Resolve-RepoPath $Path))
    $tempBase = if (-not [string]::IsNullOrWhiteSpace($env:TEMP)) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
    $allowedRoots = @(
        (Join-Path $RepoRoot ".tmp\local-stack-e2e-readiness"),
        (Join-Path $RepoRoot "tmp\local-stack-e2e-readiness"),
        (Join-Path $tempBase "AgentHub\local-stack-e2e-readiness")
    )

    foreach ($root in $allowedRoots) {
        if (Test-PathUnderRoot -Path $candidate -Root $root) {
            return $true
        }
    }
    return $false
}

function Test-AllowedEvidencePath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $false
    }

    if (-not $EvidencePathWasSupplied) {
        return $true
    }

    $candidate = [System.IO.Path]::GetFullPath((Resolve-RepoPath $Path))
    if (Test-AllowedArtifactRoot $candidate) {
        return $true
    }

    if ((-not [string]::IsNullOrWhiteSpace($ArtifactRoot)) -and (Test-AllowedArtifactRoot $ArtifactRoot)) {
        $artifactRootFull = [System.IO.Path]::GetFullPath((Resolve-RepoPath $ArtifactRoot))
        if (Test-PathUnderRoot -Path $candidate -Root $artifactRootFull) {
            return $true
        }
    }

    return $false
}

function Test-SecretLike([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }
    return $Value -match '(?i)(sk-[a-z0-9_-]{8,}|eyJ[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}|refresh[_-]?token\s*=|access[_-]?token\s*=|id[_-]?token\s*=|password\s*=|client_secret\s*=)'
}

function Test-LoopbackHost([string]$HostName) {
    if ([string]::IsNullOrWhiteSpace($HostName)) {
        return $false
    }
    $normalized = $HostName.ToLowerInvariant().Trim("[", "]")
    if ($normalized -eq "localhost" -or $normalized -eq "::1") {
        return $true
    }
    return $normalized -match '^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$'
}

function Test-LoopbackHttpUrl([string]$Url) {
    try {
        $uri = [System.Uri]::new($Url)
        return $uri.Scheme -eq "http" -and (Test-LoopbackHost $uri.Host)
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

function Test-DirectLocalEdgeUrl([string]$Url, [string]$ConfiguredLocalEdgeUrl) {
    try {
        $uri = [System.Uri]::new($Url)
        $edge = [System.Uri]::new($ConfiguredLocalEdgeUrl)
        if ($uri.Scheme -ne "http" -and $uri.Scheme -ne "https") {
            return $false
        }
        if (-not (Test-LoopbackHost $uri.Host)) {
            return $false
        }
        return $uri.Port -eq $edge.Port
    }
    catch {
        return $false
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

function Assert-ArtifactRoot {
    if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
        Add-Failure "artifact root is required; use .tmp\local-stack-e2e-readiness\<run>"
        return
    }
    if (Test-SecretLike $ArtifactRoot) {
        Add-Failure "artifact root contains secret-like material"
        return
    }
    if (Test-AllowedArtifactRoot $ArtifactRoot) {
        Pass "artifact root is inside allowed temp/readiness roots"
    } else {
        Add-Failure "artifact root must stay under .tmp\local-stack-e2e-readiness, tmp\local-stack-e2e-readiness, or `$env:TEMP\AgentHub\local-stack-e2e-readiness"
    }
}

function Assert-EvidencePath {
    if (Test-SecretLike $EvidencePath) {
        Add-Failure "EvidencePath contains secret-like material"
        return $false
    }
    if (Test-AllowedEvidencePath $EvidencePath) {
        if ($EvidencePathWasSupplied) {
            Pass "EvidencePath is inside an allowed readiness root or validated ArtifactRoot"
        } else {
            Pass "default EvidencePath uses the process temp directory"
        }
        return $true
    }

    Add-Failure "EvidencePath must stay under an allowed readiness temp root or the validated ArtifactRoot"
    return $false
}

function Assert-Commands {
    foreach ($name in $RequiredCommandNames) {
        if ([string]::IsNullOrWhiteSpace($name)) {
            Add-Failure "required command name is blank"
            continue
        }
        if (Test-SecretLike $name) {
            Add-Failure "required command name contains secret-like material"
            continue
        }
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) {
            Pass "required command available: $name"
        } else {
            Add-Failure "required command missing: $name"
        }
    }
}

function Assert-EnvironmentNames {
    $available = @{}
    foreach ($rawName in $SuppliedEnvironmentNames) {
        foreach ($name in ([string]$rawName -split ",")) {
            $trimmed = $name.Trim()
            if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
                $available[$trimmed] = $true
            }
        }
    }
    if ($UseEnvironment) {
        foreach ($name in $RequiredEnvironmentNames) {
            if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
                $available[$name] = $true
            }
        }
    }

    foreach ($name in $RequiredEnvironmentNames) {
        if (Test-SecretLike $name) {
            Add-Failure "required environment name contains secret-like material"
            continue
        }
        if ($available.ContainsKey($name)) {
            Pass "required environment name supplied: $name"
        } else {
            Add-Failure "required environment name missing: $name"
        }
    }
}

function Assert-UrlsAndPorts {
    foreach ($pair in @(
        @{ Name = "WebUrl"; Value = $WebUrl; Port = 5174 },
        @{ Name = "HubUrl"; Value = $HubUrl; Port = 8080 },
        @{ Name = "DesktopBridgeUrl"; Value = $DesktopBridgeUrl; Port = 5173 },
        @{ Name = "LocalEdgeUrl"; Value = $LocalEdgeUrl; Port = 3210 }
    )) {
        if (Test-LoopbackHttpUrl $pair.Value) {
            Pass "$($pair.Name) is loopback HTTP"
        } else {
            Add-Failure "$($pair.Name) must be loopback HTTP"
        }

        $port = Get-UrlPort $pair.Value
        if ($port -eq $pair.Port) {
            Pass "$($pair.Name) uses expected local stack port $($pair.Port)"
        } else {
            Add-Warning "$($pair.Name) uses port $port instead of expected $($pair.Port); dynamic test ports are readiness-only"
        }
    }

    if (Test-DirectLocalEdgeUrl $WebUrl $LocalEdgeUrl) {
        Add-Failure "Web URL must not point directly at Local Edge"
    }
    if ($WebUpstreamMode -ne "hub") {
        Add-Failure "Web upstream mode must be Hub, not $WebUpstreamMode"
    }
    if ($DesktopUpstreamMode -ne "local-edge") {
        Add-Failure "Desktop bridge upstream mode must be Local Edge, not $DesktopUpstreamMode"
    }

    if ((-not [string]::IsNullOrWhiteSpace($RegisteredTargetUrl)) -and (Test-DirectLocalEdgeUrl $RegisteredTargetUrl $LocalEdgeUrl)) {
        Add-Failure "registered target URL must point to Desktop bridge, not Local Edge"
    }
    if ((-not [string]::IsNullOrWhiteSpace($HubDispatchTargetUrl)) -and (Test-DirectLocalEdgeUrl $HubDispatchTargetUrl $LocalEdgeUrl)) {
        Add-Failure "Hub dispatch target URL must point to Desktop bridge, not Local Edge"
    }
}

function Write-Report {
    param([string]$StatusLabel)

    $report = [ordered]@{
        schema = "agenthub-local-stack-e2e-readiness-v1"
        mode = $Mode
        status = $StatusLabel
        real_tested = $RealTested
        generated_at = $GeneratedAt.ToString("o")
        repo_root = $RepoRoot
        artifact_root = $ArtifactRoot
        required_commands = @($RequiredCommandNames)
        required_environment_names = @($RequiredEnvironmentNames)
        supplied_environment_names = @($SuppliedEnvironmentNames)
        topology = [ordered]@{
            web_url = $WebUrl
            hub_url = $HubUrl
            desktop_bridge_url = $DesktopBridgeUrl
            local_edge_url = $LocalEdgeUrl
            registered_target_url = $RegisteredTargetUrl
            hub_dispatch_target_url = $HubDispatchTargetUrl
            web_upstream_mode = $WebUpstreamMode
            desktop_upstream_mode = $DesktopUpstreamMode
            web_to_local_edge_direct = (Test-DirectLocalEdgeUrl $WebUrl $LocalEdgeUrl)
        }
        gates = @($GateResults)
        failures = @($Failures)
        warnings = @($Warnings)
        claims = [ordered]@{
            fixture_only = ($Mode -eq "FixtureOnly")
            readiness_only = ($Mode -eq "ReadinessOnly")
            approved_real = ($Mode -eq "ApprovedReal")
            real_tokendance_id_login = $false
            real_cli_or_model_invoked_by_this_script = $false
            public_deploy_signing_or_release = $false
        }
        blockers = @(
            "real TokenDanceID login is not performed by this runner",
            "real CLI/model adapter invocation is not performed by this runner",
            "ApprovedReal requires an observed-dispatch manifest plus explicit approval",
            "caller-supplied URL topology is never accepted as real dispatch proof"
        )
    }

    $dir = Split-Path -Parent $EvidencePath
    if (-not [string]::IsNullOrWhiteSpace($dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}

Write-Host "AgentHub local stack E2E readiness runner" -ForegroundColor Magenta
Write-Host "Mode: $Mode" -ForegroundColor White
Write-Host "RealTested=false unless ApprovedReal validates approval-gated observed evidence." -ForegroundColor White

Step "Evidence output path"
if (-not (Assert-EvidencePath)) {
    Write-Host "Status: LOCAL_STACK_E2E_READINESS_FAILED" -ForegroundColor Red
    Write-Host "RealTested=false" -ForegroundColor White
    exit 1
}

Step "Static safety checks"
Assert-ArtifactRoot
Assert-Commands

if ($Mode -ne "FixtureOnly") {
    Assert-EnvironmentNames
    Assert-UrlsAndPorts
}

if ($Mode -eq "FixtureOnly") {
    Step "FixtureOnly product-loop gate"
    $fixtureEvidence = if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
        Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-local-stack-fixture-$PID.json"
    } else {
        Join-Path (Resolve-RepoPath $ArtifactRoot) "localhost-product-loop.json"
    }
    $fixtureRun = Invoke-RepoScript "scripts\smoke\verify-localhost-product-loop.ps1" @(
        "-RepoRoot", $RepoRoot,
        "-EvidencePath", $fixtureEvidence
    )
    Write-Host $fixtureRun.Output
    Add-GateResult "verify-localhost-product-loop.ps1" "FixtureOnly" $fixtureRun.ExitCode $(if ($fixtureRun.ExitCode -eq 0) { "PASS" } else { "FAIL" }) $fixtureEvidence
    if ($fixtureRun.ExitCode -ne 0) {
        Add-Failure "fixture product-loop gate failed"
    }

    $Status = if ($Failures.Count -eq 0) { "FIXTURE_ONLY_PASSED" } else { "LOCAL_STACK_E2E_READINESS_FAILED" }
    Write-Report $Status
    Write-Host "Status: $Status" -ForegroundColor $(if ($Failures.Count -eq 0) { "Green" } else { "Red" })
    Write-Host "RealTested=false" -ForegroundColor White
    exit $(if ($Failures.Count -eq 0) { 0 } else { 1 })
}

Step "Approval-boundary gates"
$loginRun = Invoke-RepoScript "scripts\verify\verify-login-e2e-readiness.ps1" @(
    "-RepoRoot", $RepoRoot
)
Write-Host $loginRun.Output
if ($loginRun.ExitCode -eq 2 -and $loginRun.Output -match "BLOCKED_UNTIL_APPROVED") {
    Pass "login E2E gate is blocked until explicit approval"
    Add-GateResult "verify-login-e2e-readiness.ps1" "ProposalOnly" $loginRun.ExitCode "EXPECTED_BLOCKED" ""
} else {
    Add-Failure "login E2E readiness gate did not fail closed as expected"
    Add-GateResult "verify-login-e2e-readiness.ps1" "ProposalOnly" $loginRun.ExitCode "UNEXPECTED" ""
}

$edgeRun = Invoke-RepoScript "scripts\verify\verify-edge-cli-real-readiness.ps1" @(
    "-RepoRoot", $RepoRoot
)
Write-Host $edgeRun.Output
if ($edgeRun.ExitCode -eq 0 -and $edgeRun.Output -match "Status: PROPOSAL_ONLY") {
    Pass "Edge CLI real-readiness gate remains proposal-only"
    Add-GateResult "verify-edge-cli-real-readiness.ps1" "ProposalOnly" $edgeRun.ExitCode "PASS" ""
} else {
    Add-Failure "Edge CLI real-readiness proposal gate failed"
    Add-GateResult "verify-edge-cli-real-readiness.ps1" "ProposalOnly" $edgeRun.ExitCode "FAIL" ""
}

if ($ProbeServices -or $StartServices) {
    Step "ReadinessOnly service probes"
    $realServicesEvidence = if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
        Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-local-stack-real-services-$PID.json"
    } else {
        Join-Path (Resolve-RepoPath $ArtifactRoot) "localhost-real-services.json"
    }
    $serviceArgs = @(
        "-RepoRoot", $RepoRoot,
        "-EvidencePath", $realServicesEvidence,
        "-RealServices",
        "-WebUrl", $WebUrl,
        "-HubUrl", $HubUrl,
        "-DesktopBridgeUrl", $DesktopBridgeUrl,
        "-LocalEdgeUrl", $LocalEdgeUrl,
        "-WebHealthPath", $WebHealthPath,
        "-HubHealthPath", $HubHealthPath,
        "-DesktopHealthPath", $DesktopHealthPath,
        "-EdgeHealthPath", $EdgeHealthPath,
        "-ExpectedWebMarker", $ExpectedWebMarker,
        "-ExpectedHubMarker", $ExpectedHubMarker,
        "-ExpectedDesktopMarker", $ExpectedDesktopMarker,
        "-ExpectedEdgeMarker", $ExpectedEdgeMarker,
        "-RegisteredTargetUrl", $RegisteredTargetUrl,
        "-HubDispatchTargetUrl", $HubDispatchTargetUrl,
        "-WebUpstreamMode", $WebUpstreamMode,
        "-DesktopUpstreamMode", $DesktopUpstreamMode,
        "-TimeoutSec", ([string]$TimeoutSec)
    )
    if ($StartServices) {
        $serviceArgs += "-StartServices"
        $serviceArgs += "-StartServicePlanPath"
        $serviceArgs += $StartServicePlanPath
    }
    $servicesRun = Invoke-RepoScript "scripts\smoke\verify-localhost-real-services.ps1" $serviceArgs
    Write-Host $servicesRun.Output
    Add-GateResult "verify-localhost-real-services.ps1" "ReadinessOnly" $servicesRun.ExitCode $(if ($servicesRun.ExitCode -eq 0) { "PASS" } else { "FAIL" }) $realServicesEvidence
    if ($servicesRun.ExitCode -ne 0) {
        Add-Failure "localhost real-services readiness gate failed"
    }
} else {
    Add-Failure "service probe not requested; pass -ProbeServices for already-running services or -StartServices with -StartServicePlanPath"
    Add-GateResult "verify-localhost-real-services.ps1" "ReadinessOnly" 2 "NOT_RUN" ""
}

if ($Mode -eq "ApprovedReal") {
    Step "ApprovedReal observed dispatch gate"
    if (-not $ApproveRealEvidence) {
        Add-Failure "ApprovedReal requires -ApproveRealEvidence"
    }
    if ([string]::IsNullOrWhiteSpace($ObservedEvidencePath)) {
        Add-Failure "ApprovedReal requires -ObservedEvidencePath"
    } else {
        $observedReport = if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
            Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-local-stack-observed-$PID.json"
        } else {
            Join-Path (Resolve-RepoPath $ArtifactRoot) "observed-localhost-dispatch-report.json"
        }
        $observedArgs = @(
            "-RepoRoot", $RepoRoot,
            "-ObservedEvidencePath", $ObservedEvidencePath,
            "-EvidencePath", $observedReport,
            "-TimeoutSec", ([string]$TimeoutSec)
        )
        if ($ApproveRealEvidence) {
            $observedArgs += "-AllowRealTestedApproval"
        }
        $observedRun = Invoke-RepoScript "scripts\smoke\verify-observed-localhost-dispatch.ps1" $observedArgs
        Write-Host $observedRun.Output
        Add-GateResult "verify-observed-localhost-dispatch.ps1" "ApprovedReal" $observedRun.ExitCode $(if ($observedRun.ExitCode -eq 0) { "PASS" } else { "FAIL" }) $observedReport
        if ($observedRun.ExitCode -ne 0) {
            Add-Failure "observed localhost dispatch gate failed"
        } elseif (Test-Path -LiteralPath $observedReport) {
            $observedJson = Get-Content -Raw -LiteralPath $observedReport | ConvertFrom-Json
            if ($observedJson.real_tested -eq $true -and $ApproveRealEvidence) {
                $script:RealTested = $true
                Pass "ApprovedReal accepted observed dispatch RealTested evidence"
            } else {
                Add-Warning "observed dispatch passed but did not promote RealTested=true"
            }
        }
    }
}

$Status = if ($Failures.Count -eq 0) {
    if ($Mode -eq "ApprovedReal") {
        if ($RealTested) { "APPROVED_REAL_PASSED" } else { "APPROVED_REAL_READINESS_ONLY_PASSED" }
    } else {
        "READINESS_ONLY_PASSED"
    }
} else {
    "LOCAL_STACK_E2E_READINESS_FAILED"
}

Write-Report $Status

Step "Boundary summary"
Write-Host "  Mode=$Mode" -ForegroundColor White
Write-Host "  RealTested=$([string]$RealTested)" -ForegroundColor White
Write-Host "  FixtureOnly proves only fixture product-loop ordering." -ForegroundColor White
Write-Host "  ReadinessOnly proves only local prerequisites and optional localhost health/topology probes." -ForegroundColor White
Write-Host "  ApprovedReal requires separate observed dispatch evidence and explicit approval." -ForegroundColor White
Write-Host "  No real TokenDanceID login or real CLI/model execution is performed by this runner." -ForegroundColor White
Write-Host "  EvidencePath: $EvidencePath" -ForegroundColor White

Write-Host "Status: $Status" -ForegroundColor $(if ($Failures.Count -eq 0) { "Green" } else { "Red" })
exit $(if ($Failures.Count -eq 0) { 0 } else { 1 })
