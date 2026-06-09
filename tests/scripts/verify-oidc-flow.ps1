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

function Invoke-OidcScript {
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

$scriptPath = Join-Path $RepoRoot "scripts\verify-oidc-flow.ps1"
$scriptText = Get-Content -LiteralPath $scriptPath -Raw

Assert-True ($scriptText -match 'function\s+Redact-OidcConfigValue') "verify-oidc-flow has OIDC config value redactor"
Assert-True ($scriptText -match 'function\s+Redact-UrlQuery') "verify-oidc-flow has authorization URL query redactor"
Assert-True ($scriptText -notmatch 'Pass\s+"[^"]*\$\(\$var\.Name\)\s+is configured\s+\(\$value\)"') "OIDC env diagnostics do not print raw values through Pass"
Assert-True ($scriptText -notmatch 'Write-Host\s+"[^"]*\$\(\$global:VerifyAuthUrl\)"') "authorization URL is not printed raw"
Assert-True ($scriptText -notmatch 'Assert-Field\s+\$authData\s+"authorization_url"') "authorization_url field is not printed through raw Assert-Field"
Assert-True ($scriptText -match '\[string\]\$RepoRoot\s*=\s*""') "RepoRoot param default is side-effect free"
Assert-True ($scriptText -match '\[switch\]\$LocalOnly') "verify-oidc-flow exposes a local-only fake/static gate"
Assert-True ($scriptText -match 'function\s+Test-PackagedDesktopReadiness') "verify-oidc-flow has packaged Desktop readiness gate"
Assert-True ($scriptText -match 'get_packaged_login_readiness') "packaged Desktop readiness command is part of the local gate"

$defaultRoot = Invoke-OidcScript @(
    "-NoProfile",
    "-File", $scriptPath,
    "-SkipHub",
    "-SkipTD"
)
Assert-True ($defaultRoot.ExitCode -eq 0) "verify-oidc-flow initializes default RepoRoot" $defaultRoot.Output
Assert-True ($defaultRoot.Output -notmatch "Join-Path") "default RepoRoot init does not fail before assertions" $defaultRoot.Output

$localOnly = Invoke-OidcScript @(
    "-NoProfile",
    "-File", $scriptPath,
    "-LocalOnly",
    "-HubUrl", "http://127.0.0.1:1",
    "-TdUrl", "http://127.0.0.1:2"
)
Assert-True ($localOnly.ExitCode -eq 0) "verify-oidc-flow local-only mode does not require live Hub or TokenDance ID" $localOnly.Output
Assert-True ($localOnly.Output -match "Local-only fake/static gate") "verify-oidc-flow labels local-only mode" $localOnly.Output
Assert-True ($localOnly.Output -match "Packaged Desktop loopback/keyring readiness") "local-only mode includes packaged Desktop readiness" $localOnly.Output
Assert-True ($localOnly.Output -match "Desktop loopback readiness source is wired") "local-only mode checks Desktop loopback readiness wiring" $localOnly.Output
Assert-True ($localOnly.Output -match "Desktop keyring readiness source is wired") "local-only mode checks Desktop keyring readiness wiring" $localOnly.Output
Assert-True ($localOnly.Output -notmatch "Phase 1") "local-only mode skips live TokenDance ID phase" $localOnly.Output
Assert-True ($localOnly.Output -notmatch "Phase 2") "local-only mode skips live Hub phase" $localOnly.Output

$tmpRepo = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-oidc-flow-redaction-$PID"
Remove-Item -LiteralPath $tmpRepo -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $tmpRepo "hub-server") | Out-Null
$clientSecret = "oidc-client-secret-should-not-print-$PID"
Set-Content -Path (Join-Path $tmpRepo "hub-server\.env") -Encoding utf8 -Value @"
AGENTHUB_TOKENDANCE_ID_ISSUER_URL=http://localhost:3000
AGENTHUB_TOKENDANCE_ID_CLIENT_ID=agenthub-desktop
AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET=$clientSecret
AGENTHUB_TOKENDANCE_ID_REDIRECT_URI=http://localhost:8080/client/auth/oidc/callback
"@

$envCheck = Invoke-OidcScript @(
    "-NoProfile",
    "-File", $scriptPath,
    "-SkipHub",
    "-SkipTD",
    "-RepoRoot", $tmpRepo
)
Assert-True ($envCheck.ExitCode -eq 0) "verify-oidc-flow can run env diagnostics against a test repo root" $envCheck.Output
Assert-True ($envCheck.Output -notmatch [regex]::Escape($clientSecret)) "verify-oidc-flow does not print raw OIDC client secret" $envCheck.Output
Assert-True ($envCheck.Output -match 'AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET is configured \(<redacted len=\d+ sha256_prefix=[0-9a-f]{12}>\)') "verify-oidc-flow prints redacted client secret metadata" $envCheck.Output

if ($Failed -gt 0) {
    exit 1
}
exit 0
