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

$scriptPath = Join-Path $RepoRoot "scripts\verify-packaged-login-real-readiness.ps1"
Assert-True (Test-Path -LiteralPath $scriptPath) "packaged real login readiness script exists"

if (Test-Path -LiteralPath $scriptPath) {
    $scriptText = Get-Content -LiteralPath $scriptPath -Raw

    Assert-True ($scriptText -notmatch 'Invoke-RestMethod|Invoke-WebRequest|Start-Process|ProcessStartInfo|shell\.open|window\.open|window\.location\.assign') "readiness script does not contact services or open browsers"
    Assert-True ($scriptText -match 'fake/local') "readiness script labels fake/local gate"
    Assert-True ($scriptText -match 'packaged readiness') "readiness script labels packaged readiness gate"
    Assert-True ($scriptText -match 'future real E2E') "readiness script labels future real E2E gate"
    Assert-True ($scriptText -match 'TokenDance ID') "readiness script names TokenDance ID boundary"

    $run = Invoke-ReadinessScript @(
        "-NoProfile",
        "-File", $scriptPath,
        "-RepoRoot", $RepoRoot
    )

    Assert-True ($run.ExitCode -eq 0) "packaged real login readiness script passes on current repo" $run.Output
    Assert-True ($run.Output -match "No live Hub, TokenDance ID, browser, secret, or CLI/model calls were made") "script reports dry-run safety boundary" $run.Output
    Assert-True ($run.Output -match "fake/local") "script output separates fake/local gate" $run.Output
    Assert-True ($run.Output -match "packaged readiness") "script output separates packaged readiness gate" $run.Output
    Assert-True ($run.Output -match "future real E2E") "script output separates future real E2E gate" $run.Output
    Assert-True ($run.Output -match "proposal-only") "script preserves proposal-only real E2E status" $run.Output
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
