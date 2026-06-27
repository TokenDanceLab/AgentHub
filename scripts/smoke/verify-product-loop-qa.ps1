#!/usr/bin/env pwsh
<#
AgentHub product-loop QA umbrella gate.

This runner composes existing static, fixture, readiness, deploy-readiness,
observed-dispatch, and approved-real CLI evidence gates into one fail-closed
report. It never performs TokenDanceID login, real CLI/model execution, public
deploy, signing, release upload, push, merge, or tag work by itself.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [ValidateSet("FixtureOnly", "ReadinessOnly", "ApprovedReal")]
    [string]$Mode = "FixtureOnly",
    [string]$ArtifactRoot = "",
    [string]$EvidencePath = "",
    [string]$ObservedEvidencePath = "",
    [string]$ApprovedCliManifest = "",
    [string]$ApprovalMarker = "",
    [switch]$ApproveRealEvidence,
    [int]$TimeoutSec = 12
)

$ErrorActionPreference = "Stop"

if ($TimeoutSec -le 0) {
    Write-Host "FAIL: -TimeoutSec must be greater than zero." -ForegroundColor Red
    exit 2
}

$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
    $ArtifactRoot = Join-Path $RepoRoot ".tmp\product-loop-qa\run-$PID"
} elseif (-not [System.IO.Path]::IsPathRooted($ArtifactRoot)) {
    $ArtifactRoot = Join-Path $RepoRoot $ArtifactRoot
}
$ArtifactRoot = [System.IO.Path]::GetFullPath($ArtifactRoot)

if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path $ArtifactRoot "product-loop-qa.json"
} elseif (-not [System.IO.Path]::IsPathRooted($EvidencePath)) {
    $EvidencePath = Join-Path $RepoRoot $EvidencePath
}
$EvidencePath = [System.IO.Path]::GetFullPath($EvidencePath)

$Failures = @()
$Warnings = @()
$Segments = @()
$RealTested = $false

function Add-Failure([string]$Text) {
    $script:Failures += $Text
    Write-Host "FAIL: $Text" -ForegroundColor Red
}

function Add-Warning([string]$Text) {
    $script:Warnings += $Text
    Write-Host "WARN: $Text" -ForegroundColor Yellow
}

function Add-Segment {
    param(
        [string]$Name,
        [string]$ModeLabel,
        [int]$ExitCode,
        [string]$Evidence = "",
        [string]$Reason = ""
    )

    $script:Segments += [pscustomobject][ordered]@{
        name = $Name
        mode = $ModeLabel
        status = if ($ExitCode -eq 0) { "PASS" } else { "FAIL" }
        exit_code = $ExitCode
        evidence = $Evidence
        reason = $Reason
    }
    if ($ExitCode -ne 0) {
        Add-Failure "$Name failed: $Reason"
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

function Find-PowerShell {
    $pwsh = Get-Command "pwsh" -ErrorAction SilentlyContinue
    if ($pwsh) { return $pwsh.Source }
    $powershell = Get-Command "powershell" -ErrorAction SilentlyContinue
    if ($powershell) { return $powershell.Source }
    return $null
}

function Invoke-RepoScript {
    param(
        [string]$RelativePath,
        [string[]]$Arguments
    )

    $scriptPath = Join-Path $RepoRoot $RelativePath
    $powershellExe = Find-PowerShell
    if (-not $powershellExe) {
        return [pscustomobject]@{ ExitCode = -1; Output = "PowerShell executable is unavailable"; ScriptPath = $scriptPath }
    }
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        return [pscustomobject]@{ ExitCode = -1; Output = "missing $RelativePath"; ScriptPath = $scriptPath }
    }

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $powershellExe
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $RepoRoot
    $psi.Arguments = Join-NativeArguments (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath) + $Arguments)
    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    return [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
        ScriptPath = $scriptPath
    }
}

function Resolve-InputPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
    if ([System.IO.Path]::IsPathRooted($Path)) { return [System.IO.Path]::GetFullPath($Path) }
    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
}

function Write-Report {
    param([string]$Status)

    $report = [ordered]@{
        schema = "agenthub-product-loop-qa-v1"
        status = $Status
        mode = $Mode
        real_tested = $RealTested
        generated_at = (Get-Date).ToString("o")
        repo_root = $RepoRoot
        artifact_root = $ArtifactRoot
        segments = @($Segments)
        failures = @($Failures)
        warnings = @($Warnings)
        approvals = [ordered]@{
            real_tokendance_id_login_required = $true
            real_cli_or_model_required = $true
            public_deploy_signing_release_required = $true
            verifier_performed_real_login = $false
            verifier_performed_real_cli_or_model = $false
        }
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $EvidencePath) | Out-Null
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}

New-Item -ItemType Directory -Force -Path $ArtifactRoot | Out-Null

Write-Host "AgentHub product-loop QA umbrella" -ForegroundColor Magenta
Write-Host "No real login, real CLI/model, deploy, signing, release upload, push, merge, or tag will be performed." -ForegroundColor Magenta

if ($Mode -eq "ApprovedReal") {
    $ObservedEvidencePath = Resolve-InputPath $ObservedEvidencePath
    $ApprovedCliManifest = Resolve-InputPath $ApprovedCliManifest
    $ApprovalMarker = Resolve-InputPath $ApprovalMarker

    if (-not $ApproveRealEvidence) { Add-Failure "ApprovedReal requires -ApproveRealEvidence" }
    if ([string]::IsNullOrWhiteSpace($ObservedEvidencePath) -or -not (Test-Path -LiteralPath $ObservedEvidencePath -PathType Leaf)) {
        Add-Failure "ApprovedReal requires -ObservedEvidencePath"
    }
    if ([string]::IsNullOrWhiteSpace($ApprovedCliManifest) -or -not (Test-Path -LiteralPath $ApprovedCliManifest -PathType Leaf)) {
        Add-Failure "ApprovedReal requires -ApprovedCliManifest"
    }
    if ([string]::IsNullOrWhiteSpace($ApprovalMarker) -or -not (Test-Path -LiteralPath $ApprovalMarker -PathType Leaf)) {
        Add-Failure "ApprovedReal requires -ApprovalMarker"
    }
}

if ($Failures.Count -eq 0) {
    $topology = Invoke-RepoScript "scripts\verify\verify-live-chain-topology.ps1" @("-RepoRoot", $RepoRoot)
    Add-Segment "live_chain_topology" "static" $topology.ExitCode "" $topology.Output
}

if ($Failures.Count -eq 0) {
    $boundary = Invoke-RepoScript "scripts\verify\verify-web-hub-boundary.ps1" @()
    Add-Segment "web_hub_boundary" "static" $boundary.ExitCode "" $boundary.Output
}

if ($Failures.Count -eq 0 -and $Mode -ne "ApprovedReal") {
    $p0ArtifactRoot = Join-Path $RepoRoot ".tmp\p0-local-product-loop-evidence\product-loop-qa-$PID"
    $p0EvidencePath = Join-Path $p0ArtifactRoot "p0-local-product-loop.json"
    $p0 = Invoke-RepoScript "scripts\smoke\verify-p0-local-product-loop-evidence.ps1" @(
        "-RepoRoot", $RepoRoot,
        "-Mode", "FixtureOnly",
        "-ArtifactRoot", $p0ArtifactRoot,
        "-EvidencePath", $p0EvidencePath,
        "-TimeoutSec", ([string]$TimeoutSec)
    )
    Add-Segment "p0_local_product_loop" "fixture" $p0.ExitCode $p0EvidencePath $p0.Output
}

if ($Failures.Count -eq 0) {
    $localStackMode = if ($Mode -eq "ReadinessOnly") { "ReadinessOnly" } else { "FixtureOnly" }
    $localStackArtifactRoot = Join-Path $RepoRoot ".tmp\local-stack-e2e-readiness\product-loop-qa-$PID"
    $localStackEvidencePath = Join-Path $localStackArtifactRoot "local-stack-e2e-readiness.json"
    $localStack = Invoke-RepoScript "scripts\smoke\verify-local-stack-e2e-readiness.ps1" @(
        "-RepoRoot", $RepoRoot,
        "-Mode", $localStackMode,
        "-ArtifactRoot", $localStackArtifactRoot,
        "-EvidencePath", $localStackEvidencePath,
        "-TimeoutSec", ([string]$TimeoutSec)
    )
    Add-Segment "local_stack_e2e_readiness" ($localStackMode.ToLowerInvariant()) $localStack.ExitCode $localStackEvidencePath $localStack.Output
}

if ($Failures.Count -eq 0) {
    $webDist = Join-Path $RepoRoot "app\web\dist"
    if ($Mode -eq "FixtureOnly" -and -not (Test-Path -LiteralPath $webDist -PathType Container)) {
        Add-Warning "web_deploy_readiness skipped in FixtureOnly because app/web/dist is missing; run the Web production build before ReadinessOnly or ApprovedReal."
        Add-Segment "web_deploy_readiness" "fixture-skipped" 0 "" "skipped: app/web/dist missing"
    } else {
        $webDeploy = Invoke-RepoScript "scripts\release\verify-web-deploy-readiness.ps1" @("-RepoRoot", $RepoRoot)
        Add-Segment "web_deploy_readiness" "readiness" $webDeploy.ExitCode "" $webDeploy.Output
    }
}

if ($Failures.Count -eq 0 -and $Mode -eq "ApprovedReal") {
    $observedReport = Join-Path $ArtifactRoot "observed-localhost-dispatch-report.json"
    $observed = Invoke-RepoScript "scripts\smoke\verify-observed-localhost-dispatch.ps1" @(
        "-RepoRoot", $RepoRoot,
        "-ObservedEvidencePath", $ObservedEvidencePath,
        "-EvidencePath", $observedReport,
        "-AllowRealTestedApproval",
        "-TimeoutSec", ([string]$TimeoutSec)
    )
    Add-Segment "observed_localhost_dispatch" "observed" $observed.ExitCode $observedReport $observed.Output
}

if ($Failures.Count -eq 0 -and $Mode -eq "ApprovedReal") {
    $cliRoot = Split-Path -Parent $ApprovedCliManifest
    $cli = Invoke-RepoScript "scripts\verify\verify-approved-real-edge-cli-evidence.ps1" @(
        "-RepoRoot", $RepoRoot,
        "-ObservedManifest", $ApprovedCliManifest,
        "-EvidenceRoot", $cliRoot,
        "-ApprovalMarker", $ApprovalMarker,
        "-ApproveRealEvidence"
    )
    Add-Segment "approved_real_edge_cli_evidence" "approved-real" $cli.ExitCode $ApprovedCliManifest $cli.Output
}

if ($Failures.Count -eq 0 -and $Mode -eq "ApprovedReal") {
    $RealTested = $true
}

$status = if ($Failures.Count -eq 0) { "PRODUCT_LOOP_QA_PASSED" } else { "PRODUCT_LOOP_QA_FAILED" }
Write-Report $status
Write-Host "EvidencePath: $EvidencePath" -ForegroundColor White
Write-Host "RealTested=$RealTested" -ForegroundColor White
Write-Host "Status: $status" -ForegroundColor $(if ($Failures.Count -eq 0) { "Green" } else { "Red" })

if ($Failures.Count -eq 0) { exit 0 }
exit 1
