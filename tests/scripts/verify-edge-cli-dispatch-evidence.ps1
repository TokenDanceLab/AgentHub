[CmdletBinding()]
param(
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"
$Failed = 0

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $scriptDir = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $RepoRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).ProviderPath
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message,
        [string]$Details = ""
    )

    if ($Condition) {
        Write-Host "PASS $Message" -ForegroundColor Green
        return
    }

    $script:Failed++
    Write-Host "FAIL $Message" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($Details)) {
        Write-Host $Details -ForegroundColor DarkGray
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

function Invoke-DispatchScript {
    param([string[]]$Arguments)

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "pwsh"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.Arguments = Join-NativeArguments $Arguments

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-edge-cli-dispatch-evidence.ps1"
$docPath = Join-Path $RepoRoot "docs\audit\p1-edge-real-cli-evidence.md"

Assert-True (Test-Path -LiteralPath $scriptPath) "Edge CLI dispatch evidence verifier exists"
Assert-True (Test-Path -LiteralPath $docPath) "P1 Edge real CLI evidence audit doc exists"

if (Test-Path -LiteralPath $scriptPath) {
    $scriptText = Get-Content -LiteralPath $scriptPath -Raw
    Assert-True ($scriptText -notmatch '(?m)^\s*(?:&\s*)?(?:codex|claude|opencode)\b') "verifier has no direct real CLI command pattern"
    Assert-True ($scriptText -match 'TestProcessExecutorPublishesCLIInvocationPlanAndReplaysFixtureStatus') "verifier runs lifecycle fixture replay test"
    Assert-True ($scriptText -match 'real_tested=false') "verifier can report real_tested=false"

    $fixtureRun = Invoke-DispatchScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot
    )
    Assert-True ($fixtureRun.ExitCode -eq 0) "default fixture dispatch evidence passes" $fixtureRun.Output
    Assert-True ($fixtureRun.Output -match "Status: FIXTURE_DISPATCH_VERIFIED") "default fixture reports fixture status" $fixtureRun.Output
    Assert-True ($fixtureRun.Output -match "real_tested=false") "default fixture does not claim real tested" $fixtureRun.Output
    Assert-True ($fixtureRun.Output -match "No real CLI/model command was executed") "default fixture reports no real CLI/model command" $fixtureRun.Output

    $observedNoApproval = Invoke-DispatchScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-Mode", "Observed"
    )
    Assert-True ($observedNoApproval.ExitCode -ne 0) "observed mode fails without approval marker" $observedNoApproval.Output
    Assert-True ($observedNoApproval.Output -match "approval marker") "observed no-approval failure names approval marker" $observedNoApproval.Output
    Assert-True ($observedNoApproval.Output -match "real_tested=false") "observed no-approval reports real_tested=false" $observedNoApproval.Output

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("agenthub-edge-dispatch-test-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    $approvalMarker = Join-Path $tempDir "approval.marker"
    Set-Content -LiteralPath $approvalMarker -Value "approved fixture manifest validation only" -Encoding UTF8
    $failedManifest = Join-Path $tempDir "failed-observed.json"
    @'
{
  "adapterId": "codex",
  "approvalId": "approval-123",
  "requestMapped": true,
  "invocationPlanObserved": true,
  "eventReplayObserved": true,
  "realCliObserved": true,
  "redacted": true,
  "noSecrets": true,
  "terminalStatus": "failed",
  "exitCode": 1
}
'@ | Set-Content -LiteralPath $failedManifest -Encoding UTF8

    $failedObserved = Invoke-DispatchScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-Mode", "RealTested",
        "-ObservedManifest", $failedManifest,
        "-ApprovalMarker", $approvalMarker,
        "-ApproveObservedCLI"
    )
    Assert-True ($failedObserved.ExitCode -ne 0) "failed observed chain does not pass real-tested mode" $failedObserved.Output
    Assert-True ($failedObserved.Output -match "real_tested=false") "failed observed chain reports real_tested=false" $failedObserved.Output
    Assert-True ($failedObserved.Output -match "terminalStatus") "failed observed chain names terminal status blocker" $failedObserved.Output

    $passingManifest = Join-Path $tempDir "passing-observed.json"
    @'
{
  "adapterId": "codex",
  "approvalId": "approval-123",
  "requestMapped": true,
  "invocationPlanObserved": true,
  "eventReplayObserved": true,
  "realCliObserved": true,
  "redacted": true,
  "noSecrets": true,
  "terminalStatus": "finished",
  "exitCode": 0
}
'@ | Set-Content -LiteralPath $passingManifest -Encoding UTF8

    $passingObserved = Invoke-DispatchScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-Mode", "RealTested",
        "-ObservedManifest", $passingManifest,
        "-ApprovalMarker", $approvalMarker,
        "-ApproveObservedCLI"
    )
    Assert-True ($passingObserved.ExitCode -eq 0) "approved passing observed chain can report real tested" $passingObserved.Output
    Assert-True ($passingObserved.Output -match "real_tested=true") "approved passing observed chain reports real_tested=true" $passingObserved.Output
    Assert-True ($passingObserved.Output -match "Status: OBSERVED_DISPATCH_VERIFIED") "approved passing observed chain reports observed status" $passingObserved.Output
}

if (Test-Path -LiteralPath $docPath) {
    $docText = Get-Content -LiteralPath $docPath -Raw
    Assert-True ($docText -match "request -> CLI invocation plan -> event replay/status") "audit doc records dispatch evidence chain"
    Assert-True ($docText -match "real_tested=false") "audit doc records false-by-default real-tested semantics"
    Assert-True ($docText -match "approval marker") "audit doc records observed approval marker gate"
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
