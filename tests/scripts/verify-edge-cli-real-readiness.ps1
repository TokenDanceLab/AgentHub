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

function Invoke-ReadinessScript {
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

$scriptPath = Join-Path $RepoRoot "scripts\verify-edge-cli-real-readiness.ps1"
$docPath = Join-Path $RepoRoot "docs\audit\p0-edge-cli-real-readiness.md"

Assert-True (Test-Path -LiteralPath $scriptPath) "Edge CLI real readiness script exists"
Assert-True (Test-Path -LiteralPath $docPath) "Edge CLI real readiness audit doc exists"

if (Test-Path -LiteralPath $scriptPath) {
    $scriptText = Get-Content -LiteralPath $scriptPath -Raw

    Assert-True ($scriptText -match '\[ValidateSet\("ProposalOnly", "RealTested", "Submission"\)\]') "script exposes proposal, real-tested, and submission modes"
    Assert-True ($scriptText -notmatch 'Start-Process|Invoke-Expression|Invoke-Command|System\.Diagnostics\.Process|ProcessStartInfo') "script has no process execution primitive"
    Assert-True ($scriptText -notmatch '(?m)^\s*(?:&\s*)?(?:codex|claude|opencode)\b') "script has no direct Codex/Claude/OpenCode command pattern"
    Assert-True ($scriptText -match 'ValidateCLIAdapterID') "script checks supported CLI adapter id evidence"
    Assert-True ($scriptText -match 'TestProcessExecutorFailsUnknownExplicitAdapterWithoutDefaultFallback') "script checks explicit unknown runtime no-fallback evidence"

    $defaultRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot
    )
    Assert-True ($defaultRun.ExitCode -eq 0) "default proposal-only readiness passes" $defaultRun.Output
    Assert-True ($defaultRun.Output -match "Status: PROPOSAL_ONLY") "default mode reports proposal-only status" $defaultRun.Output
    Assert-True ($defaultRun.Output -match "No Codex, Claude Code, or OpenCode command was executed") "script reports no real CLI/model execution" $defaultRun.Output
    Assert-True ($defaultRun.Output -match "BLOCK real execution") "default mode blocks real execution while prerequisites are missing" $defaultRun.Output

    $badModeRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-Mode", "BadMode"
    )
    Assert-True ($badModeRun.ExitCode -ne 0) "BadMode is rejected by parameter validation" $badModeRun.Output

    $realTestedRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-Mode", "RealTested"
    )
    Assert-True ($realTestedRun.ExitCode -ne 0) "RealTested mode fails without operator approval" $realTestedRun.Output
    Assert-True ($realTestedRun.Output -match "operator approval") "RealTested failure names missing operator approval" $realTestedRun.Output

    $fakeRealTestedRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-Mode", "RealTested",
        "-RuntimeId", "codex",
        "-RuntimePath", "approved-runtime-owner",
        "-RuntimeEnvManifest", "approved-env-manifest",
        "-BudgetPlan", "approved-budget",
        "-RedactionPlan", "approved-redaction",
        "-ArtifactRoot", "approved-artifacts",
        "-EvidenceMode", "approved-evidence-mode",
        "-OperatorApprovalId", "approval-123"
    )
    Assert-True ($fakeRealTestedRun.ExitCode -ne 0) "RealTested forged metadata remains blocked without real execution evidence manifest" $fakeRealTestedRun.Output
    Assert-True ($fakeRealTestedRun.Output -match "real execution evidence manifest") "RealTested forged metadata names missing real execution evidence manifest" $fakeRealTestedRun.Output
    Assert-True ($fakeRealTestedRun.Output -notmatch "READY_FOR_OPERATOR_APPROVED_REAL_TEST") "RealTested forged metadata does not claim operator-approved real test readiness" $fakeRealTestedRun.Output

    $submissionRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-Mode", "Submission"
    )
    Assert-True ($submissionRun.ExitCode -ne 0) "Submission mode fails without operator approval" $submissionRun.Output
    Assert-True ($submissionRun.Output -match "operator approval") "Submission failure names missing operator approval" $submissionRun.Output

    $fakeSubmissionRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-Mode", "Submission",
        "-RuntimeId", "codex",
        "-RuntimePath", "approved-runtime-owner",
        "-RuntimeEnvManifest", "approved-env-manifest",
        "-BudgetPlan", "approved-budget",
        "-RedactionPlan", "approved-redaction",
        "-ArtifactRoot", "approved-artifacts",
        "-EvidenceMode", "approved-evidence-mode",
        "-OperatorApprovalId", "approval-123"
    )
    Assert-True ($fakeSubmissionRun.ExitCode -ne 0) "Submission forged metadata remains blocked without real execution evidence manifest" $fakeSubmissionRun.Output
    Assert-True ($fakeSubmissionRun.Output -match "real execution evidence manifest") "Submission forged metadata names missing real execution evidence manifest" $fakeSubmissionRun.Output
    Assert-True ($fakeSubmissionRun.Output -notmatch "READY_FOR_OPERATOR_APPROVED_REAL_TEST") "Submission forged metadata does not claim operator-approved real test readiness" $fakeSubmissionRun.Output
}

if (Test-Path -LiteralPath $docPath) {
    $docText = Get-Content -LiteralPath $docPath -Raw
    Assert-True ($docText -match "codex.*claude-code.*opencode") "audit doc records supported runtime ids"
    Assert-True ($docText -match "unknown-runtime") "audit doc records unknown runtime no-fallback evidence"
    Assert-True ($docText -match "operator approval") "audit doc records approval prerequisite"
    Assert-True ($docText -match "No real CLI/model run") "audit doc records no real CLI/model execution"
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
