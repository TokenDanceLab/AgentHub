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
    Assert-True ($scriptText -match '\$CommandPlan') "script requires an explicit future command plan input"
    Assert-True ($scriptText -match '\$TimeoutPlan') "script requires an explicit timeout/kill policy input"
    Assert-True ($scriptText -match '\$ArtifactRetention') "script requires explicit artifact retention input"
    Assert-True ($scriptText -match '\$EnvVarOwnership') "script requires explicit env var ownership input"
    Assert-True ($scriptText -match '\$RequireApprovalInputs') "script can fail closed when approval inputs are required"
    Assert-True ($scriptText -match '\$ApproveRedactionPolicy') "script has an explicit redaction approval flag"
    Assert-True ($scriptText -match '\$ApproveArtifactRetention') "script has an explicit artifact retention approval flag"
    Assert-True ($scriptText -match '\$ApproveEnvVarOwnership') "script has an explicit env ownership approval flag"
    Assert-True ($scriptText -match '\$DiscoverCommands') "script exposes no-spend command discovery"
    Assert-True ($scriptText -match '\$OutputManifestPath') "script can write a per-runtime readiness manifest"
    Assert-True ($scriptText -match 'codex.*claude-code.*opencode') "script declares per-runtime manifest coverage"

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

    $unknownRuntimeRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-RuntimeId", "unknown-runtime"
    )
    Assert-True ($unknownRuntimeRun.ExitCode -ne 0) "unknown runtime id fails closed even in proposal mode" $unknownRuntimeRun.Output
    Assert-True ($unknownRuntimeRun.Output -match "unsupported adapter") "unknown runtime failure names unsupported adapter" $unknownRuntimeRun.Output

    $outsideArtifactRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-ArtifactRoot", "docs\audit"
    )
    Assert-True ($outsideArtifactRun.ExitCode -ne 0) "artifact root outside allowed temp dirs fails closed" $outsideArtifactRun.Output
    Assert-True ($outsideArtifactRun.Output -match "allowed temp") "artifact root failure names allowed temp boundary" $outsideArtifactRun.Output

    $secretValue = "sk-test-secret-value"
    $secretInputRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-RuntimeEnvManifest", "OPENAI_API_KEY=$secretValue"
    )
    Assert-True ($secretInputRun.ExitCode -ne 0) "secret-like approval input fails closed" $secretInputRun.Output
    Assert-True ($secretInputRun.Output -match "secret-like") "secret-like failure is reported generically" $secretInputRun.Output
    Assert-True ($secretInputRun.Output -notmatch [regex]::Escape($secretValue)) "secret-like input value is not printed" $secretInputRun.Output

    $manifestDir = Join-Path ([System.IO.Path]::GetTempPath()) ("agenthub-edge-cli-readiness-test-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
    $manifestPath = Join-Path $manifestDir "readiness-manifest.json"
    $manifestRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-DiscoverCommands",
        "-OutputManifestPath", $manifestPath
    )
    Assert-True ($manifestRun.ExitCode -eq 0) "discovery manifest run passes without model execution" $manifestRun.Output
    Assert-True ($manifestRun.Output -match "No prompt, model, or API command was executed") "discovery manifest output states no prompt/model/API execution" $manifestRun.Output
    Assert-True (Test-Path -LiteralPath $manifestPath) "discovery manifest is written"
    if (Test-Path -LiteralPath $manifestPath) {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Assert-True ($manifest.schema -eq "agenthub-edge-cli-approved-real-readiness-v1") "manifest schema is explicit"
        Assert-True ($manifest.real_tested -eq $false -and $manifest.model_api_consumed -eq $false) "manifest does not claim real execution or spend"
        foreach ($runtimeId in @("codex", "claude-code", "opencode")) {
            $runtime = @($manifest.runtimes | Where-Object { $_.runtime_id -eq $runtimeId }) | Select-Object -First 1
            Assert-True ($null -ne $runtime) "manifest includes $runtimeId runtime"
            if ($null -ne $runtime) {
                Assert-True (-not [string]::IsNullOrWhiteSpace([string]$runtime.command_discovery.command_name)) "$runtimeId records command discovery"
                Assert-True (-not [string]::IsNullOrWhiteSpace([string]$runtime.json_mode.expected_flag_or_mode)) "$runtimeId records JSON mode expectation"
                Assert-True (-not [string]::IsNullOrWhiteSpace([string]$runtime.permission_boundary.expected_mode)) "$runtimeId records permission/approval boundary"
                Assert-True (-not [string]::IsNullOrWhiteSpace([string]$runtime.budget.stop_policy)) "$runtimeId records budget stop policy"
                Assert-True (-not [string]::IsNullOrWhiteSpace([string]$runtime.timeouts.kill_policy)) "$runtimeId records timeout/kill policy"
                Assert-True (-not [string]::IsNullOrWhiteSpace([string]$runtime.artifacts.root_policy)) "$runtimeId records artifact root policy"
                Assert-True (-not [string]::IsNullOrWhiteSpace([string]$runtime.redaction_manifest.policy)) "$runtimeId records redaction manifest policy"
            }
        }
    }

    $approvalRequiredRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-RequireApprovalInputs",
        "-RuntimeId", "codex",
        "-RuntimePath", "operator-owned-codex-path",
        "-RuntimeEnvManifest", "OPENAI_API_KEY owned by operator secret store",
        "-BudgetPlan", "max 1 request, max 1000 output tokens, max 2 USD",
        "-CommandPlan", "codex exec --json --approval-mode manual",
        "-TimeoutPlan", "hard timeout 120 seconds, kill process tree",
        "-RedactionPlan", "redact env, stdout, stderr, prompts, and artifacts",
        "-ArtifactRoot", ".tmp\edge-cli-real-readiness\codex",
        "-ArtifactRetention", "retain redacted logs for 7 days, delete raw capture immediately",
        "-EnvVarOwnership", "OPENAI_API_KEY owned by operator secret store",
        "-EvidenceMode", "redacted-log",
        "-OperatorApprovalId", "approval-123"
    )
    Assert-True ($approvalRequiredRun.ExitCode -ne 0) "approval-required run fails when explicit approval flags are missing" $approvalRequiredRun.Output
    Assert-True ($approvalRequiredRun.Output -match "approval flag") "missing approval flags are reported" $approvalRequiredRun.Output

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
        "-CommandPlan", "codex exec --json --approval-mode manual",
        "-TimeoutPlan", "hard timeout 120 seconds",
        "-RedactionPlan", "approved-redaction",
        "-ArtifactRoot", ".tmp\edge-cli-real-readiness\codex",
        "-ArtifactRetention", "approved retention",
        "-EnvVarOwnership", "approved env owners",
        "-EvidenceMode", "approved-evidence-mode",
        "-OperatorApprovalId", "approval-123",
        "-ApproveNoRealExecution",
        "-ApproveRedactionPolicy",
        "-ApproveArtifactRetention",
        "-ApproveEnvVarOwnership"
    )
    Assert-True ($fakeRealTestedRun.ExitCode -ne 0) "RealTested forged metadata remains blocked without real execution evidence manifest" $fakeRealTestedRun.Output
    Assert-True ($fakeRealTestedRun.Output -match "real execution evidence manifest") "RealTested forged metadata names missing real execution evidence manifest" $fakeRealTestedRun.Output
    Assert-True ($fakeRealTestedRun.Output -notmatch "READY_FOR_OPERATOR_APPROVED_REAL_TEST") "RealTested forged metadata does not claim operator-approved real test readiness" $fakeRealTestedRun.Output
    Assert-True ($fakeRealTestedRun.Output -notmatch "READY_FOR_APPROVED_RUN") "RealTested forged metadata does not claim approved-run readiness" $fakeRealTestedRun.Output

    $fakeRealTestedMarkdownRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-Mode", "RealTested",
        "-RuntimeId", "codex",
        "-RuntimePath", "approved-runtime-owner",
        "-RuntimeEnvManifest", "approved-env-manifest",
        "-BudgetPlan", "approved-budget",
        "-CommandPlan", "codex exec --json --approval-mode manual",
        "-TimeoutPlan", "hard timeout 120 seconds",
        "-RedactionPlan", "approved-redaction",
        "-ArtifactRoot", ".tmp\edge-cli-real-readiness\codex",
        "-ArtifactRetention", "approved retention",
        "-EnvVarOwnership", "approved env owners",
        "-EvidenceMode", "approved-evidence-mode",
        "-OperatorApprovalId", "approval-123",
        "-RealExecutionEvidenceManifest", "docs\audit\p0-edge-cli-real-readiness.md",
        "-ApproveNoRealExecution",
        "-ApproveRedactionPolicy",
        "-ApproveArtifactRetention",
        "-ApproveEnvVarOwnership"
    )
    Assert-True ($fakeRealTestedMarkdownRun.ExitCode -ne 0) "RealTested forged existing markdown evidence remains blocked" $fakeRealTestedMarkdownRun.Output
    Assert-True ($fakeRealTestedMarkdownRun.Output -match "independent real-run verifier") "RealTested forged existing markdown points to independent real-run verifier" $fakeRealTestedMarkdownRun.Output
    Assert-True ($fakeRealTestedMarkdownRun.Output -notmatch "READY_FOR_APPROVED_RUN") "RealTested forged existing markdown does not claim approved-run readiness" $fakeRealTestedMarkdownRun.Output

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
        "-CommandPlan", "codex exec --json --approval-mode manual",
        "-TimeoutPlan", "hard timeout 120 seconds",
        "-RedactionPlan", "approved-redaction",
        "-ArtifactRoot", ".tmp\edge-cli-real-readiness\codex",
        "-ArtifactRetention", "approved retention",
        "-EnvVarOwnership", "approved env owners",
        "-EvidenceMode", "approved-evidence-mode",
        "-OperatorApprovalId", "approval-123",
        "-ApproveNoRealExecution",
        "-ApproveRedactionPolicy",
        "-ApproveArtifactRetention",
        "-ApproveEnvVarOwnership"
    )
    Assert-True ($fakeSubmissionRun.ExitCode -ne 0) "Submission forged metadata remains blocked without real execution evidence manifest" $fakeSubmissionRun.Output
    Assert-True ($fakeSubmissionRun.Output -match "real execution evidence manifest") "Submission forged metadata names missing real execution evidence manifest" $fakeSubmissionRun.Output
    Assert-True ($fakeSubmissionRun.Output -notmatch "READY_FOR_OPERATOR_APPROVED_REAL_TEST") "Submission forged metadata does not claim operator-approved real test readiness" $fakeSubmissionRun.Output
    Assert-True ($fakeSubmissionRun.Output -notmatch "READY_FOR_APPROVED_RUN") "Submission forged metadata does not claim approved-run readiness" $fakeSubmissionRun.Output

    $fakeSubmissionMarkdownRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-Mode", "Submission",
        "-RuntimeId", "codex",
        "-RuntimePath", "approved-runtime-owner",
        "-RuntimeEnvManifest", "approved-env-manifest",
        "-BudgetPlan", "approved-budget",
        "-CommandPlan", "codex exec --json --approval-mode manual",
        "-TimeoutPlan", "hard timeout 120 seconds",
        "-RedactionPlan", "approved-redaction",
        "-ArtifactRoot", ".tmp\edge-cli-real-readiness\codex",
        "-ArtifactRetention", "approved retention",
        "-EnvVarOwnership", "approved env owners",
        "-EvidenceMode", "approved-evidence-mode",
        "-OperatorApprovalId", "approval-123",
        "-RealExecutionEvidenceManifest", "docs\audit\p0-edge-cli-real-readiness.md",
        "-ApproveNoRealExecution",
        "-ApproveRedactionPolicy",
        "-ApproveArtifactRetention",
        "-ApproveEnvVarOwnership"
    )
    Assert-True ($fakeSubmissionMarkdownRun.ExitCode -ne 0) "Submission forged existing markdown evidence remains blocked" $fakeSubmissionMarkdownRun.Output
    Assert-True ($fakeSubmissionMarkdownRun.Output -match "independent real-run verifier") "Submission forged existing markdown points to independent real-run verifier" $fakeSubmissionMarkdownRun.Output
    Assert-True ($fakeSubmissionMarkdownRun.Output -notmatch "READY_FOR_APPROVED_RUN") "Submission forged existing markdown does not claim approved-run readiness" $fakeSubmissionMarkdownRun.Output
}

if (Test-Path -LiteralPath $docPath) {
    $docText = Get-Content -LiteralPath $docPath -Raw
    Assert-True ($docText -match "codex.*claude-code.*opencode") "audit doc records supported runtime ids"
    Assert-True ($docText -match "unknown-runtime") "audit doc records unknown runtime no-fallback evidence"
    Assert-True ($docText -match "operator approval") "audit doc records approval prerequisite"
    Assert-True ($docText -match "command") "audit doc records command approval prerequisite"
    Assert-True ($docText -match "timeout") "audit doc records timeout approval prerequisite"
    Assert-True ($docText -match "artifact retention") "audit doc records artifact retention prerequisite"
    Assert-True ($docText -match "env var ownership") "audit doc records env var ownership prerequisite"
    Assert-True ($docText -match "allowed temp") "audit doc records allowed artifact temp roots"
    Assert-True ($docText -match "secret-like") "audit doc records secret-like input rejection"
    Assert-True ($docText -match "No real CLI/model run") "audit doc records no real CLI/model execution"
    Assert-True ($docText -match "per-runtime readiness manifest") "audit doc records per-runtime readiness manifest"
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
