#!/usr/bin/env pwsh
<#
AgentHub P0 localhost smoke harness.

Default mode is a dry-run/plan harness: it runs repeatable FixtureOnly and
LocalOnly checks, records localhost service probes as blocked, and writes an
evidence matrix. Pass output never means RealTested. Use -RunLocalhost only
after local Hub/Web/Desktop/Edge fixture services are already running. The
localhost probes require /health JSON identity markers for each fixture
service; plain TCP reachability is not accepted as proof.

This script does not start real TokenDanceID, run real CLI/model adapters,
deploy public surfaces, sign packages, upload releases, or touch Mobile.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [switch]$RunLocalhost,
    [string]$EvidencePath = "",
    [int]$HubPort = 8080,
    [int]$WebPort = 5174,
    [int]$DesktopPort = 5173,
    [int]$EdgePort = 3210,
    [int]$TimeoutMs = 500
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$Mode = if ($RunLocalhost) { "RunLocalhost" } else { "Plan" }

if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-p0-local-smoke-$PID.json"
}

$Passed = 0
$Failed = 0
$Warned = 0
$Blocked = 0
$Skipped = 0
$EvidenceRows = @()

function Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Add-EvidenceRow {
    param(
        [string]$Claim,
        [string]$Check,
        [string]$Status,
        [string]$Evidence
    )

    $script:EvidenceRows += [pscustomobject]@{
        claim = $Claim
        check = $Check
        status = $Status
        real_tested = $false
        evidence = $Evidence
    }
}

function Pass([string]$Text, [string]$Claim = "LocalOnly", [string]$Evidence = "") {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
    Add-EvidenceRow $Claim $Text "PASS" $Evidence
}

function Fail([string]$Text, [string]$Detail = "", [string]$Claim = "LocalOnly") {
    $script:Failed++
    Write-Host "  FAIL  $Text" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($Detail)) {
        Write-Host "        $Detail" -ForegroundColor DarkRed
    }
    Add-EvidenceRow $Claim $Text "FAIL" $Detail
}

function Warn([string]$Text, [string]$Detail = "", [string]$Claim = "LocalOnly") {
    $script:Warned++
    Write-Host "  WARN  $Text" -ForegroundColor Yellow
    if (-not [string]::IsNullOrWhiteSpace($Detail)) {
        Write-Host "        $Detail" -ForegroundColor DarkYellow
    }
    Add-EvidenceRow $Claim $Text "WARN" $Detail
}

function Block([string]$Text, [string]$Detail = "", [string]$Claim = "LocalhostSmoke") {
    $script:Blocked++
    Write-Host "  BLOCKED  $Text" -ForegroundColor Yellow
    if (-not [string]::IsNullOrWhiteSpace($Detail)) {
        Write-Host "           $Detail" -ForegroundColor DarkYellow
    }
    Add-EvidenceRow $Claim $Text "BLOCKED" $Detail
}

function Skip([string]$Text, [string]$Detail = "", [string]$Claim = "RealApprovalRequired") {
    $script:Skipped++
    Write-Host "  SKIP  $Text" -ForegroundColor Yellow
    if (-not [string]::IsNullOrWhiteSpace($Detail)) {
        Write-Host "        $Detail" -ForegroundColor DarkYellow
    }
    Add-EvidenceRow $Claim $Text "SKIP" $Detail
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
    } catch {
        return [pscustomobject]@{
            ExitCode = -1
            Output = $_.Exception.Message
        }
    }
}

function Test-PrerequisiteFailure([string]$Output) {
    if ([string]::IsNullOrWhiteSpace($Output)) {
        return $false
    }

    return $Output -match (
        "not recognized as the name|" +
        "executable file not found|" +
        "No such file or directory|" +
        "Cannot find path|" +
        "command not found|" +
        "missing required environment|" +
        "prerequisite"
    )
}

function Invoke-RequiredScriptGate {
    param(
        [string]$Label,
        [string]$RelativePath,
        [string[]]$Arguments = @(),
        [string]$Claim = "LocalOnly"
    )

    $scriptPath = Join-Path $RepoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        Fail $Label "missing $RelativePath" $Claim
        return
    }

    $powershellExe = Find-PowerShell
    if (-not $powershellExe) {
        Block $Label "PowerShell executable is unavailable; gate was not run." $Claim
        return
    }

    $run = Invoke-CapturedProcess $powershellExe (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath) + $Arguments) $RepoRoot
    if ($run.ExitCode -eq 0) {
        Pass $Label $Claim "exit=0"
        return
    }

    if (Test-PrerequisiteFailure $run.Output) {
        Warn $Label $run.Output.Trim() $Claim
        return
    }

    Fail $Label $run.Output.Trim() $Claim
}

function Invoke-RequiredNativeGate {
    param(
        [string]$Label,
        [string]$FileName,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [string]$Claim = "LocalOnly"
    )

    if (-not (Test-Path -LiteralPath $WorkingDirectory)) {
        Fail $Label "missing working directory: $WorkingDirectory" $Claim
        return
    }

    $run = Invoke-CapturedProcess $FileName $Arguments $WorkingDirectory
    if ($run.ExitCode -eq 0) {
        Pass $Label $Claim "exit=0"
        return
    }

    if (Test-PrerequisiteFailure $run.Output) {
        Warn $Label $run.Output.Trim() $Claim
        return
    }

    Fail $Label $run.Output.Trim() $Claim
}

$ExpectedHealthMarkers = @{
    hub = @{
        service = "hub"
        identity = "agenthub-hub-localhost-fixture"
        upstream = "registered-desktop-target-router"
    }
    web = @{
        service = "web"
        identity = "agenthub-web-localhost-fixture"
        upstream = "hub-only"
    }
    desktop = @{
        service = "desktop"
        identity = "agenthub-desktop-bridge-localhost-fixture"
        bridge = "tauri-sidecar-fixture"
    }
    "local-edge" = @{
        service = "local-edge"
        identity = "agenthub-local-edge-localhost-fixture"
        adapter = "fixture-sdk"
        runner = "fixture-local-edge-runner"
    }
}

function Invoke-HealthProbe {
    param(
        [string]$Url,
        [int]$Timeout
    )

    try {
        Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
        $client = [System.Net.Http.HttpClient]::new()
        $client.Timeout = [TimeSpan]::FromMilliseconds($Timeout)
        try {
            $response = $client.GetAsync($Url).GetAwaiter().GetResult()
            $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if (-not $response.IsSuccessStatusCode) {
                return [pscustomobject]@{
                    Ok = $false
                    Detail = "GET $Url returned HTTP $([int]$response.StatusCode): $body"
                    Health = $null
                }
            }
            $health = $body | ConvertFrom-Json
            return [pscustomobject]@{
                Ok = $true
                Detail = $body
                Health = $health
            }
        } finally {
            $client.Dispose()
        }
    } catch {
        return [pscustomobject]@{
            Ok = $false
            Detail = "GET $Url failed: $($_.Exception.Message)"
            Health = $null
        }
    }
}

function Test-LocalhostService {
    param(
        [string]$Label,
        [int]$Port,
        [string]$Service
    )

    if (-not $RunLocalhost) {
        Block $Label "Plan mode only. Start/check localhost fixture services separately, then rerun with -RunLocalhost. Expected 127.0.0.1:$Port."
        return
    }

    $expected = $ExpectedHealthMarkers[$Service]
    if (-not $expected) {
        Fail $Label "missing expected health marker definition for service $Service"
        return
    }

    $url = "http://127.0.0.1:$Port/health"
    $probe = Invoke-HealthProbe $url $TimeoutMs
    if (-not $probe.Ok) {
        Block $Label "$($probe.Detail). Start the local fixture service or keep this as a blocked smoke check."
        return
    }

    foreach ($key in $expected.Keys) {
        $actual = [string]$probe.Health.$key
        if ($actual -ne [string]$expected[$key]) {
            Block $Label "missing identity marker for $Service.$key. Expected '$($expected[$key])', got '$actual'. Raw health: $($probe.Detail)"
            return
        }
    }

    $detail = "GET $url returned expected $Service identity marker. RealTested=false"
    Pass "$Label health identity marker" "LocalhostSmoke" $detail
    Write-Host "        $detail" -ForegroundColor DarkGray
}

function Write-EvidenceMatrix {
    $matrix = [pscustomobject]@{
        schema = "agenthub-p0-local-smoke-evidence-v1"
        mode = $Mode
        real_tested = $false
        repo_root = $RepoRoot
        generated_at = (Get-Date).ToString("o")
        claims = @{
            FixtureOnly = "offline fixture/source gates only"
            LocalOnly = "local fake/static or httptest gates only"
            LocalhostSmoke = "localhost service probes only; fake/local session and fixture adapter required"
            RealApprovalRequired = "not run without explicit approval"
        }
        ports = @{
            hub = $HubPort
            web = $WebPort
            desktop = $DesktopPort
            edge = $EdgePort
        }
        rows = $script:EvidenceRows
    }

    $parent = Split-Path -Parent $EvidencePath
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    $matrix | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8

    Step "Evidence matrix"
    Write-Host "  EvidencePath: $EvidencePath" -ForegroundColor White
    Write-Host "  RealTested=false" -ForegroundColor White
    Write-Host "  Rows: $($script:EvidenceRows.Count)" -ForegroundColor White
}

Write-Host "AgentHub P0 localhost smoke harness" -ForegroundColor Magenta
Write-Host "Mode: $Mode" -ForegroundColor Magenta

Step "Smoke boundary"
Write-Host "  FixtureOnly: fixture evidence and static/source gates only" -ForegroundColor White
Write-Host "  LocalOnly: local fake/static or httptest gates only" -ForegroundColor White
Write-Host "  LocalhostSmoke: localhost probes only; fake/local session and fixture adapter required" -ForegroundColor White
Write-Host "  RealApprovalRequired: real TokenDanceID login was not run" -ForegroundColor White
Write-Host "  RealApprovalRequired: real CLI/model adapter execution was not run" -ForegroundColor White
Write-Host "  RealApprovalRequired: public deploy/signing/release upload was not run" -ForegroundColor White
Write-Host "  Boundary: Mobile is out of scope for this smoke gate." -ForegroundColor White
Write-Host "  RealTested=false" -ForegroundColor White
Pass "smoke claim labels are explicit" "LocalOnly" "Dry-run/plan output cannot claim real execution."

Step "FixtureOnly gates"
Invoke-RequiredScriptGate "verify-p0-remote-control-fixture.ps1" "scripts\verify-p0-remote-control-fixture.ps1" @(
    "-RepoRoot", $RepoRoot
) "FixtureOnly"

Step "LocalOnly gates"
Invoke-RequiredScriptGate "verify-oidc-flow.ps1 -LocalOnly -SkipTD" "scripts\verify-oidc-flow.ps1" @(
    "-LocalOnly",
    "-SkipTD",
    "-RepoRoot", $RepoRoot
) "LocalOnly"

$hubRoot = Join-Path $RepoRoot "hub-server"
$edgeRoot = Join-Path $RepoRoot "edge-server"

Invoke-RequiredNativeGate "go test ./tests/oidc -run TestOIDCSmoke -short -count=1" "go" @(
    "test",
    "./tests/oidc",
    "-run",
    "TestOIDCSmoke",
    "-short",
    "-count=1"
) $hubRoot "LocalOnly"
Write-Host "        Hub OIDC mock smoke" -ForegroundColor DarkGray

Invoke-RequiredNativeGate "go test ./internal/service -run TestExecutionTargetPingRequiresLiveProofForRemoteTargets -short -count=1" "go" @(
    "test",
    "./internal/service",
    "-run",
    "TestExecutionTargetPingRequiresLiveProofForRemoteTargets",
    "-short",
    "-count=1"
) $hubRoot "LocalOnly"
Write-Host "        Hub remote target live-proof boundary" -ForegroundColor DarkGray

Invoke-RequiredNativeGate "go test ./internal/adapters -run SDKFixture -short -count=1" "go" @(
    "test",
    "./internal/adapters",
    "-run",
    "SDKFixture",
    "-short",
    "-count=1"
) $edgeRoot "LocalOnly"
Write-Host "        Edge fixture adapter boundary" -ForegroundColor DarkGray

Invoke-RequiredNativeGate "go test ./internal/security ./internal/httpserver -run RemoteMode -short -count=1" "go" @(
    "test",
    "./internal/security",
    "./internal/httpserver",
    "-run",
    "RemoteMode",
    "-short",
    "-count=1"
) $edgeRoot "LocalOnly"
Write-Host "        Edge remote origin boundary" -ForegroundColor DarkGray

Step "Localhost service probes"
Test-LocalhostService "localhost Hub service probe" $HubPort "hub"
Test-LocalhostService "localhost Web service probe" $WebPort "web"
Test-LocalhostService "localhost Desktop service probe" $DesktopPort "desktop"
Test-LocalhostService "localhost Local Edge service probe" $EdgePort "local-edge"
Block "localhost fake/local session chain proof" "Requires pre-started Hub/Web/Desktop/Local Edge fixture services plus a fake/local session path and fixture adapter run evidence; this script only records the blocked check until those services are available."

Step "RealApprovalRequired gates"
Skip "real TokenDanceID browser login" "Requires approved OAuth client, disposable/test account, live Hub environment, browser evidence boundary, and no token disclosure."
Skip "real CLI/model adapter execution" "Requires runtime choice, budget approval, redaction policy, and artifact upload policy."
Skip "public deploy/signing/release upload" "Requires target environment, signing/notarization/release approval, and no-secret deploy logs."

Write-EvidenceMatrix

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed  |  Warned: $Warned  |  Blocked: $Blocked  |  Skipped: $Skipped" -ForegroundColor $(if ($Failed -eq 0 -and $Warned -eq 0) { "Green" } elseif ($Failed -eq 0) { "Yellow" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -gt 0) {
    Write-Host "`nP0 localhost smoke harness failed. RealApprovalRequired gates were not run.`n" -ForegroundColor Red
    exit 1
}
if ($Warned -gt 0) {
    Write-Host "`nP0 localhost smoke harness is incomplete because at least one fixture/local gate was WARN, not PASS.`n" -ForegroundColor Yellow
    exit 2
}
if ($RunLocalhost -and $Blocked -gt 0) {
    Write-Host "`nP0 localhost smoke harness is blocked because one or more localhost service checks are unavailable. RealTested=false.`n" -ForegroundColor Yellow
    exit 2
}

Write-Host "`nP0 localhost smoke harness completed in $Mode mode. FixtureOnly/LocalOnly gates ran; localhost chain checks are blocked unless -RunLocalhost services are available. RealTested=false.`n" -ForegroundColor Green
exit 0
