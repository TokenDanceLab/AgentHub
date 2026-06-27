#!/usr/bin/env pwsh
<#
AgentHub P0 remote-control fixture readiness gate.

This is a FixtureRehearsal-only umbrella gate. It orchestrates existing
offline/source-focused fixture checks and the Edge SDK fixture test. It does
not start real Hub, Desktop, or Edge services; does not run real CLI/model
adapters; does not log in to TokenDanceID; and does not deploy.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [string]$Mode = "FixtureRehearsal",
    [string]$Claim = "FixtureOnly"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath

$Passed = 0
$Failed = 0
$Warned = 0
$Skipped = 0

function Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Fail([string]$Text, [string]$Detail = "") {
    $script:Failed++
    Write-Host "  FAIL  $Text" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($Detail)) {
        Write-Host "        $Detail" -ForegroundColor DarkRed
    }
}

function Warn([string]$Text, [string]$Detail = "") {
    $script:Warned++
    Write-Host "  WARN  $Text" -ForegroundColor Yellow
    if (-not [string]::IsNullOrWhiteSpace($Detail)) {
        Write-Host "        $Detail" -ForegroundColor DarkYellow
    }
}

function Skip([string]$Text, [string]$Detail = "") {
    $script:Skipped++
    Write-Host "  SKIP  $Text" -ForegroundColor Yellow
    if (-not [string]::IsNullOrWhiteSpace($Detail)) {
        Write-Host "        $Detail" -ForegroundColor DarkYellow
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
        [string[]]$Arguments = @()
    )

    $scriptPath = Join-Path $RepoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        Fail $Label "missing $RelativePath"
        return
    }

    $powershellExe = Find-PowerShell
    if (-not $powershellExe) {
        Skip $Label "PowerShell executable is unavailable; gate was not run."
        return
    }

    $run = Invoke-CapturedProcess $powershellExe (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath) + $Arguments) $RepoRoot
    if ($run.ExitCode -eq 0) {
        Pass $Label
        return
    }

    if (Test-PrerequisiteFailure $run.Output) {
        Warn $Label $run.Output.Trim()
        return
    }

    Fail $Label $run.Output.Trim()
}

function Invoke-RequiredNativeGate {
    param(
        [string]$Label,
        [string]$FileName,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    if (-not (Test-Path -LiteralPath $WorkingDirectory)) {
        Fail $Label "missing working directory: $WorkingDirectory"
        return
    }

    $run = Invoke-CapturedProcess $FileName $Arguments $WorkingDirectory
    if ($run.ExitCode -eq 0) {
        Pass $Label
        return
    }

    if (Test-PrerequisiteFailure $run.Output) {
        Warn $Label $run.Output.Trim()
        return
    }

    Fail $Label $run.Output.Trim()
}

function New-TempOutputRoot([string]$Name) {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) $Name
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    return $root
}

Write-Host "AgentHub P0 remote-control fixture readiness gate" -ForegroundColor Magenta

Step "Fixture boundary"
if ($Mode -ne "FixtureRehearsal") {
    Fail "mode is FixtureRehearsal" "actual=$Mode"
} else {
    Pass "mode is FixtureRehearsal"
}
if ($Claim -ne "FixtureOnly") {
    Fail "claim is FixtureOnly" "actual=$Claim"
} else {
    Pass "claim is FixtureOnly"
}

Write-Host "  Boundary: FixtureRehearsal only." -ForegroundColor White
Write-Host "  Boundary: does not start real Hub, Desktop, or Edge services." -ForegroundColor White
Write-Host "  Boundary: does not run real CLI/model adapters." -ForegroundColor White
Write-Host "  Boundary: does not log in to TokenDanceID." -ForegroundColor White
Write-Host "  Boundary: does not deploy." -ForegroundColor White

if ($Failed -eq 0) {
    Step "Login fixture topology"
    Invoke-RequiredScriptGate "verify-login-fixture-topology.ps1" "scripts\verify-login-fixture-topology.ps1" @("-RepoRoot", $RepoRoot)

    Step "Web Hub boundary"
    Invoke-RequiredScriptGate "verify-web-hub-boundary.ps1" "scripts\verify-web-hub-boundary.ps1"

    Step "Remote-control fixture E2E"
    $remoteOutputRoot = New-TempOutputRoot "agenthub-p0-remote-control-fixture-$PID"
    Invoke-RequiredScriptGate "verify-remote-control-fixture-e2e.ps1" "scripts\verify-remote-control-fixture-e2e.ps1" @(
        "-OutputRoot", $remoteOutputRoot,
        "-Stamp", "p0-fixture-readiness"
    )

    Step "Remote-control fixture E2E script tests"
    Invoke-RequiredScriptGate "tests/scripts/verify-remote-control-fixture-e2e.ps1" "tests\scripts\verify-remote-control-fixture-e2e.ps1" @("-RepoRoot", $RepoRoot)

    Step "TeamRun demo contract tests"
    Invoke-RequiredScriptGate "tests/scripts/verify-teamrun-demo-contract.ps1" "tests\scripts\verify-teamrun-demo-contract.ps1" @("-RepoRoot", $RepoRoot)

    Step "Edge SDK fixture focused gate"
    Invoke-RequiredNativeGate "go test ./internal/adapters -run SDKFixture -short -count=1" "go" @(
        "test",
        "./internal/adapters",
        "-run",
        "SDKFixture",
        "-short",
        "-count=1"
    ) (Join-Path $RepoRoot "edge-server")
} else {
    Skip "downstream fixture gates" "Mode/claim boundary failed before running child gates."
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed  |  Warned: $Warned  |  Skipped: $Skipped" -ForegroundColor $(if ($Failed -eq 0 -and $Warned -eq 0 -and $Skipped -eq 0) { "Green" } elseif ($Failed -eq 0) { "Yellow" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -gt 0) {
    Write-Host "`nP0 remote-control fixture readiness failed. Real services, login, adapter execution, and deployment remain out of scope.`n" -ForegroundColor Red
    exit 1
}
if ($Warned -gt 0 -or $Skipped -gt 0) {
    Write-Host "`nP0 remote-control fixture readiness is incomplete because at least one child gate was WARN/SKIP, not PASS.`n" -ForegroundColor Yellow
    exit 2
}

Write-Host "`nP0 remote-control fixture readiness passed for FixtureRehearsal only.`n" -ForegroundColor Green
exit 0
