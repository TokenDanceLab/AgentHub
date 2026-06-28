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

function New-FakePsql {
    param(
        [string]$Directory,
        [string]$Mode,
        [string]$SecretUrl,
        [string]$CapturePath
    )

    $shimPath = Join-Path $Directory "psql-$Mode.ps1"
    Set-Content -LiteralPath $shimPath -Encoding utf8 -Value @"
param([Parameter(ValueFromRemainingArguments = `$true)][string[]]`$PsqlArgs)

`$payload = [pscustomobject]@{
    argv = `$PsqlArgs
    databaseUrl = `$env:DATABASE_URL
    agentHubDatabaseUrl = `$env:AGENTHUB_DATABASE_URL
    pgConnectTimeout = `$env:PGCONNECT_TIMEOUT
}
`$payload | ConvertTo-Json -Compress | Set-Content -LiteralPath '$CapturePath' -Encoding utf8

if ((`$PsqlArgs -contains '$SecretUrl') -or (`$PsqlArgs -join ' ') -match [regex]::Escape('$SecretUrl')) {
    Write-Error 'database URL leaked into argv'
    exit 88
}
if (`$env:DATABASE_URL -ne '$SecretUrl') {
    Write-Error 'DATABASE_URL was not provided to psql environment'
    exit 89
}
if ([string]::IsNullOrWhiteSpace(`$env:PGCONNECT_TIMEOUT)) {
    Write-Error 'PGCONNECT_TIMEOUT was not provided'
    exit 90
}

switch ('$Mode') {
    'clean' {
        exit 0
    }
    'duplicate' {
        Write-Output 'owner-1 | device-1 | target-a,target-b | 2'
        exit 0
    }
    'error' {
        Write-Error 'simulated psql query error'
        exit 7
    }
    default {
        Write-Error 'unknown fake psql mode'
        exit 99
    }
}
"@
    return $shimPath
}

$scriptPath = Join-Path $RepoRoot "hub-server\scripts\check-local-edge-target-duplicates.ps1"
$secretUrl = "postgres://agenthub_user:secret-password-$PID@127.0.0.1:5432/agenthub"
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-local-edge-preflight-tests-$PID"
Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

try {
    Assert-True (Test-Path -LiteralPath $scriptPath) "local_edge duplicate preflight script exists"

    $missingRun = Invoke-PreflightScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-DatabaseUrl", $secretUrl,
        "-Psql", "agenthub-missing-psql-$PID"
    )
    Assert-True ($missingRun.ExitCode -eq 127) "missing psql exits 127" $missingRun.Output
    Assert-True ($missingRun.Output -notmatch "No duplicate active local_edge targets found") "missing psql does not report clean success" $missingRun.Output
    Assert-True ($missingRun.Output -notmatch [regex]::Escape($secretUrl)) "missing psql output does not print database URL" $missingRun.Output

    $cleanCapture = Join-Path $tmpDir "clean-capture.json"
    $cleanPsql = New-FakePsql -Directory $tmpDir -Mode "clean" -SecretUrl $secretUrl -CapturePath $cleanCapture
    $cleanRun = Invoke-PreflightScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-DatabaseUrl", $secretUrl,
        "-Psql", $cleanPsql
    )
    Assert-True ($cleanRun.ExitCode -eq 0) "clean psql result exits 0" $cleanRun.Output
    Assert-True ($cleanRun.Output -match "No duplicate active local_edge targets found") "clean psql result reports success" $cleanRun.Output
    Assert-True ($cleanRun.Output -notmatch [regex]::Escape($secretUrl)) "clean psql output does not print database URL" $cleanRun.Output

    $cleanCaptureJson = Get-Content -LiteralPath $cleanCapture -Raw | ConvertFrom-Json
    Assert-True (-not (@($cleanCaptureJson.argv) -contains $secretUrl)) "database URL is not passed as psql argv" ($cleanCaptureJson | ConvertTo-Json -Compress)
    Assert-True ($cleanCaptureJson.databaseUrl -eq $secretUrl) "database URL is provided to psql through environment" ($cleanCaptureJson | ConvertTo-Json -Compress)

    $duplicateCapture = Join-Path $tmpDir "duplicate-capture.json"
    $duplicatePsql = New-FakePsql -Directory $tmpDir -Mode "duplicate" -SecretUrl $secretUrl -CapturePath $duplicateCapture
    $duplicateRun = Invoke-PreflightScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-DatabaseUrl", $secretUrl,
        "-Psql", $duplicatePsql
    )
    Assert-True ($duplicateRun.ExitCode -eq 2) "duplicate psql result exits 2" $duplicateRun.Output
    Assert-True ($duplicateRun.Output -match "Duplicate active local_edge targets found") "duplicate psql result reports duplicates" $duplicateRun.Output
    Assert-True ($duplicateRun.Output -match "owner-1 \| device-1 \| target-a,target-b \| 2") "duplicate psql result prints duplicate row" $duplicateRun.Output
    Assert-True ($duplicateRun.Output -notmatch [regex]::Escape($secretUrl)) "duplicate psql output does not print database URL" $duplicateRun.Output

    $errorCapture = Join-Path $tmpDir "error-capture.json"
    $errorPsql = New-FakePsql -Directory $tmpDir -Mode "error" -SecretUrl $secretUrl -CapturePath $errorCapture
    $errorRun = Invoke-PreflightScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-DatabaseUrl", $secretUrl,
        "-Psql", $errorPsql
    )
    Assert-True ($errorRun.ExitCode -eq 7) "query error preserves psql exit code" $errorRun.Output
    Assert-True ($errorRun.Output -match "local_edge target duplicate preflight query failed") "query error reports preflight failure" $errorRun.Output
    Assert-True ($errorRun.Output -notmatch "No duplicate active local_edge targets found") "query error does not report clean success" $errorRun.Output
    Assert-True ($errorRun.Output -notmatch [regex]::Escape($secretUrl)) "query error output does not print database URL" $errorRun.Output
}
finally {
    Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
