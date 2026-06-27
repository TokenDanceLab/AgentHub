[CmdletBinding()]
param(
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"
$Failed = 0

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $scriptDir = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $RepoRoot = (Resolve-Path (Join-Path $scriptDir "..\..\..")).ProviderPath
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

function Invoke-PreflightScript {
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

$scriptPath = Join-Path $RepoRoot "scripts\verify\verify-approved-real-preflight.ps1"
$scriptImplementationPath = Join-Path $RepoRoot "scripts\verify\verify-approved-real-preflight.ps1"
$validManifest = Join-Path $RepoRoot "tests\contract\scripts\approved-real-preflight.valid.json"
$invalidMode = Join-Path $RepoRoot "tests\contract\scripts\approved-real-preflight.invalid-mode.json"
$invalidMissingApproval = Join-Path $RepoRoot "tests\contract\scripts\approved-real-preflight.invalid-missing-approval.json"
$invalidMissingBudgetTimeoutArtifact = Join-Path $RepoRoot "tests\contract\scripts\approved-real-preflight.invalid-missing-budget-timeout-artifact.json"
$invalidProduction = Join-Path $RepoRoot "tests\contract\scripts\approved-real-preflight.invalid-production-unapproved.json"
$invalidSecret = Join-Path $RepoRoot "tests\contract\scripts\approved-real-preflight.invalid-secret.json"

Assert-True (Test-Path -LiteralPath $scriptPath) "approved-real preflight manifest script exists"
Assert-True (Test-Path -LiteralPath $scriptImplementationPath) "approved-real preflight manifest script implementation exists"
Assert-True (Test-Path -LiteralPath $validManifest) "valid approved-real preflight fixture exists"
foreach ($fixture in @($invalidMode, $invalidMissingApproval, $invalidMissingBudgetTimeoutArtifact, $invalidProduction, $invalidSecret)) {
    Assert-True (Test-Path -LiteralPath $fixture) "invalid fixture exists: $(Split-Path -Leaf $fixture)"
}

if (Test-Path -LiteralPath $scriptImplementationPath) {
    $scriptText = Get-Content -LiteralPath $scriptImplementationPath -Raw
    Assert-True ($scriptText -match '\$ManifestPath') "script requires explicit ManifestPath parameter"
    Assert-True ($scriptText -notmatch 'Start-Process|Invoke-Expression|Invoke-Command|Invoke-WebRequest|Invoke-RestMethod|System\.Diagnostics\.Process|ProcessStartInfo') "script has no process or network execution primitive"
    Assert-True ($scriptText -notmatch '(?m)^\s*(?:&\s*)?(?:codex|claude|opencode|npm|pnpm|git|gh)\b') "script has no direct CLI/deploy command pattern"
    Assert-True ($scriptText -match 'RealCliTested=false' -and $scriptText -match 'RealModelTested=false' -and $scriptText -match 'TokenDanceIDLogin=false') "script always declares split readiness claims false"
    Assert-True ($scriptText -match 'fixture=not-run' -and $scriptText -match 'observed=not-run' -and $scriptText -match 'approved-real=manifest-validated-only' -and $scriptText -match 'production=blocked') "script distinguishes fixture, observed, approved-real, and production"
    Assert-True ($scriptText -match 'runtime_readiness') "script validates per-runtime readiness entries"
    Assert-True ($scriptText -match 'command_discovery' -and $scriptText -match 'json_mode' -and $scriptText -match 'permission_boundary') "script validates runtime command, JSON, and approval boundaries"
}

$missingManifestRun = Invoke-PreflightScript @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $scriptPath,
    "-RepoRoot", $RepoRoot
)
Assert-True ($missingManifestRun.ExitCode -ne 0) "missing -ManifestPath fails closed" $missingManifestRun.Output
Assert-True ($missingManifestRun.Output -match "ManifestPath") "missing manifest failure names ManifestPath" $missingManifestRun.Output

$validRun = Invoke-PreflightScript @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $scriptPath,
    "-RepoRoot", $RepoRoot,
    "-ManifestPath", $validManifest
)
Assert-True ($validRun.ExitCode -eq 0) "valid manifest passes" $validRun.Output
Assert-True ($validRun.Output -match "Status: APPROVED_REAL_PREFLIGHT_MANIFEST_OK") "valid manifest reports OK status" $validRun.Output
Assert-True ($validRun.Output -match "RealCliTested=false" -and $validRun.Output -match "RealModelTested=false" -and $validRun.Output -match "TokenDanceIDLogin=false") "valid manifest does not claim real execution" $validRun.Output
Assert-True ($validRun.Output -match "No login, CLI/model/API, deploy, sign") "valid output states no real action executed" $validRun.Output
Assert-True ($validRun.Output -match "fixture=not-run" -and $validRun.Output -match "observed=not-run" -and $validRun.Output -match "production=blocked") "valid output distinguishes evidence modes" $validRun.Output
Assert-True ($validRun.Output -match "runtime_readiness") "valid output reports per-runtime readiness validation" $validRun.Output

$modeRun = Invoke-PreflightScript @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $scriptPath,
    "-RepoRoot", $RepoRoot,
    "-ManifestPath", $invalidMode
)
Assert-True ($modeRun.ExitCode -ne 0) "mode other than approved-real fails closed" $modeRun.Output
Assert-True ($modeRun.Output -match "mode must be approved-real") "invalid mode failure names approved-real" $modeRun.Output

$missingApprovalRun = Invoke-PreflightScript @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $scriptPath,
    "-RepoRoot", $RepoRoot,
    "-ManifestPath", $invalidMissingApproval
)
Assert-True ($missingApprovalRun.ExitCode -ne 0) "missing approval fields fail closed" $missingApprovalRun.Output
Assert-True ($missingApprovalRun.Output -match "approved_by" -and $missingApprovalRun.Output -match "approval_id") "missing approval failure names approval fields" $missingApprovalRun.Output

$missingBudgetRun = Invoke-PreflightScript @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $scriptPath,
    "-RepoRoot", $RepoRoot,
    "-ManifestPath", $invalidMissingBudgetTimeoutArtifact
)
Assert-True ($missingBudgetRun.ExitCode -ne 0) "missing artifact root, budget, and timeout fail closed" $missingBudgetRun.Output
Assert-True ($missingBudgetRun.Output -match "artifact_root" -and $missingBudgetRun.Output -match "timeouts" -and $missingBudgetRun.Output -match "budget") "missing prerequisite failure names artifact, timeout, and budget" $missingBudgetRun.Output

$productionRun = Invoke-PreflightScript @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $scriptPath,
    "-RepoRoot", $RepoRoot,
    "-ManifestPath", $invalidProduction
)
Assert-True ($productionRun.ExitCode -ne 0) "unapproved production/deploy/sign/release fields fail closed" $productionRun.Output
Assert-True ($productionRun.Output -match "production/deploy/sign/release/updater") "production failure names scoped action boundary" $productionRun.Output

$secretRun = Invoke-PreflightScript @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $scriptPath,
    "-RepoRoot", $RepoRoot,
    "-ManifestPath", $invalidSecret
)
Assert-True ($secretRun.ExitCode -ne 0) "secret-like manifest fails closed" $secretRun.Output
Assert-True ($secretRun.Output -match "secret-like|sensitive value") "secret-like failure is reported generically" $secretRun.Output
Assert-True ($secretRun.Output -notmatch "actual-value-present") "secret value is not printed" $secretRun.Output

if ($Failed -gt 0) {
    Write-Host "`nverify-approved-real-preflight tests failed: $Failed" -ForegroundColor Red
    exit 1
}

Write-Host "`nverify-approved-real-preflight tests passed" -ForegroundColor Green
exit 0
