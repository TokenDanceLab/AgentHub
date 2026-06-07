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

function Invoke-SmokeScript {
    param([string[]]$Arguments)

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "pwsh"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.Arguments = Join-NativeArguments $Arguments

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()
    if (-not $proc.WaitForExit(30000)) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        $proc.WaitForExit(5000) | Out-Null
    }
    $stdout = if ($stdoutTask.Wait(5000)) { $stdoutTask.Result } else { "<stdout read timed out>" }
    $stderr = if ($stderrTask.Wait(5000)) { $stderrTask.Result } else { "<stderr read timed out>" }

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
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

$scriptPath = Join-Path $RepoRoot "scripts\integration-e2e.ps1"

$help = Invoke-SmokeScript @("-NoProfile", "-File", $scriptPath, "-Help")
Assert-True ($help.ExitCode -eq 0) "integration-e2e help exits 0" $help.Output
Assert-True ($help.Output -match "edge-runtime-smoke") "help identifies Edge runtime smoke semantics" $help.Output
Assert-True ($help.Output -match "RealCli") "help documents explicit real CLI opt-in" $help.Output
Assert-True ($help.Output -match "AllowMissingCli") "help documents explicit missing CLI opt-out" $help.Output

$missingCli = "agenthub-missing-cli-$PID"
$missingEdgeBinary = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-missing-edge-$PID.exe"
$defaultFake = Invoke-SmokeScript @(
    "-NoProfile",
    "-File", $scriptPath,
    "-Runtime", "claude-code",
    "-CliPath", $missingCli,
    "-SkipBuild",
    "-EdgeBinary", $missingEdgeBinary,
    "-Port", "34991",
    "-TimeoutSec", "1"
)
Assert-True ($defaultFake.ExitCode -ne 0) "default smoke advances past CLI resolution without real CLI" $defaultFake.Output
Assert-True ($defaultFake.Output -match "fake process fixture") "default smoke identifies fake fixture mode" $defaultFake.Output
Assert-True ($defaultFake.Output -match "edge binary missing") "default smoke fails at missing edge binary, not missing CLI" $defaultFake.Output
Assert-True ($defaultFake.Output -notmatch "missing CLI") "default smoke does not resolve real CLI" $defaultFake.Output

$missing = Invoke-SmokeScript @(
    "-NoProfile",
    "-File", $scriptPath,
    "-RealCli",
    "-Runtime", "claude-code",
    "-CliPath", $missingCli,
    "-SkipBuild",
    "-Port", "34991",
    "-TimeoutSec", "1"
)
Assert-True ($missing.ExitCode -ne 0) "missing CLI fails when -RealCli is explicit" $missing.Output
Assert-True ($missing.Output -match "missing" -and $missing.Output -match "AllowMissingCli" -and $missing.Output -match "RealCli") "missing CLI output names explicit controls" $missing.Output

$secretPrompt = "OPENAI_API_KEY=sk-agenthubscriptsecret123456 Authorization: Bearer secret.jwt.value access_token=secret-query-token"
$jsonPath = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-smoke-script-redaction-$PID.json"
Remove-Item -LiteralPath $jsonPath -Force -ErrorAction SilentlyContinue
$redactedMissing = Invoke-SmokeScript @(
    "-NoProfile",
    "-File", $scriptPath,
    "-RealCli",
    "-Runtime", "codex",
    "-CliPath", "agenthub-missing-redaction-cli-$PID",
    "-Prompt", $secretPrompt,
    "-SkipBuild",
    "-Port", "34994",
    "-TimeoutSec", "1",
    "-OutputJson", $jsonPath
)
$redactedOutputJson = ""
if (Test-Path -LiteralPath $jsonPath) {
    $redactedOutputJson = Get-Content -LiteralPath $jsonPath -Raw
}
Assert-True ($redactedMissing.ExitCode -ne 0) "missing CLI redaction path fails the smoke" $redactedMissing.Output
foreach ($secret in @("sk-agenthubscriptsecret123456", "secret.jwt.value", "secret-query-token")) {
    Assert-True ($redactedMissing.Output -notmatch [regex]::Escape($secret)) "stdout/stderr redacts $secret" $redactedMissing.Output
    Assert-True ($redactedOutputJson -notmatch [regex]::Escape($secret)) "OutputJson redacts $secret" $redactedOutputJson
}
Assert-True ($redactedOutputJson -match "<redacted") "OutputJson keeps explicit redaction markers" $redactedOutputJson

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-smoke-script-test-$PID"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$ps1Cli = Join-Path $tmpDir "codex-test-wrapper.ps1"
Set-Content -Path $ps1Cli -Encoding utf8 -Value "param([Parameter(ValueFromRemainingArguments=`$true)]`$Args) exit 0"
$cmdCli = Join-Path $tmpDir "codex-test-wrapper.cmd"
Set-Content -Path $cmdCli -Encoding ascii -Value "@echo off`r`nexit /b 0`r`n"
$missingEdgeBinary = Join-Path $tmpDir "missing-edge.exe"
$scriptCli = Invoke-SmokeScript @(
    "-NoProfile",
    "-File", $scriptPath,
    "-RealCli",
    "-Runtime", "codex",
    "-CliPath", $ps1Cli,
    "-SkipBuild",
    "-EdgeBinary", $missingEdgeBinary,
    "-Port", "34992",
    "-TimeoutSec", "1"
)
Assert-True ($scriptCli.ExitCode -ne 0) "explicit ps1 CLI path advances past CLI resolution" $scriptCli.Output
Assert-True ($scriptCli.Output -match "edge binary missing") "explicit ps1 CLI path is treated as a resolved CLI" $scriptCli.Output
Assert-True ($scriptCli.Output -notmatch "missing CLI") "explicit ps1 CLI path is not reported as missing CLI" $scriptCli.Output
Assert-True ($scriptCli.Output -match "codex-test-wrapper\.cmd") "explicit ps1 CLI path normalizes to sibling cmd wrapper name" $scriptCli.Output
Assert-True ($scriptCli.Output -notmatch [regex]::Escape($tmpDir)) "structured result does not leak temp directory by default" $scriptCli.Output

$ps1Only = Join-Path $tmpDir "ps1-only-wrapper.ps1"
Set-Content -Path $ps1Only -Encoding utf8 -Value "param([Parameter(ValueFromRemainingArguments=`$true)]`$Args) exit 0"
$scriptOnly = Invoke-SmokeScript @(
    "-NoProfile",
    "-File", $scriptPath,
    "-RealCli",
    "-Runtime", "codex",
    "-CliPath", $ps1Only,
    "-SkipBuild",
    "-EdgeBinary", $missingEdgeBinary,
    "-Port", "34993",
    "-TimeoutSec", "1"
)
Assert-True ($scriptOnly.ExitCode -ne 0) "ps1 CLI without native wrapper fails" $scriptOnly.Output
Assert-True ($scriptOnly.Output -match "PowerShell script CLI path requires") "ps1 CLI without native wrapper reports wrapper requirement" $scriptOnly.Output

if ($Failed -gt 0) {
    exit 1
}
exit 0
