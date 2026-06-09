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

$WorkspaceDocCandidates = @(
    "docs\identity\relying-party.md",
    "docs\relying-party-readiness.md"
)

function Find-ExpectedWorkspaceDocs {
    $current = $RepoRoot
    while ($null -ne $current) {
        foreach ($relativePath in $WorkspaceDocCandidates) {
            $candidate = Join-Path $current $relativePath
            if (Test-Path -LiteralPath $candidate) {
                return $candidate
            }
        }
        $parent = Split-Path -Parent $current
        if ($parent -eq $current -or [string]::IsNullOrWhiteSpace($parent)) {
            return $null
        }
        $current = $parent
    }
    return $null
}

function New-FixtureFile {
    param(
        [string]$Root,
        [string]$RelativePath,
        [string]$Content
    )

    $path = Join-Path $Root $RelativePath
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    Set-Content -LiteralPath $path -Encoding utf8 -Value $Content
}

function New-LegacyOnlyWorkspaceFixture {
    param([string]$Root)

    $agentHubRoot = Join-Path $Root "AgentHub"
    New-Item -ItemType Directory -Force -Path (Join-Path $agentHubRoot "scripts") | Out-Null
    Copy-Item -LiteralPath $scriptPath -Destination (Join-Path $agentHubRoot "scripts\verify-oidc-readiness.ps1")

    New-FixtureFile $agentHubRoot "api\openapi.yaml" @"
/client/auth/oidc/authorize
/client/auth/oidc/callback
HubOIDCAuthorizeRequest
HubOIDCCallbackResponse
"@
    New-FixtureFile $agentHubRoot "hub-server\internal\config\config.go" @"
AGENTHUB_TOKENDANCE_ID_ISSUER_URL
AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS
tokendance_id.redirect_uri is required
"@
    New-FixtureFile $agentHubRoot "hub-server\internal\service\oidc.go" @"
ParseTokenDanceJWT
FindOrCreateByTokenDanceSub
UpsertRefreshToken
"@
    New-FixtureFile $agentHubRoot "hub-server\internal\middleware\auth.go" "func RequireHubSession"
    New-FixtureFile $agentHubRoot "hub-server\internal\router\router.go" @"
contacts.Use(middleware.RequireHubSession())
sessions.Use(middleware.RequireHubSession())
messages.Use(middleware.RequireHubSession())
web.Use(middleware.RequireHubSession())
edge.Use(middleware.RequireHubSession())
"@
    New-FixtureFile $agentHubRoot ".env.example" @"
AGENTHUB_TOKENDANCE_ID_ISSUER_URL
AGENTHUB_TOKENDANCE_ID_CLIENT_ID
AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET
AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS
"@
    New-FixtureFile $agentHubRoot "docker-compose.yml" @"
AGENTHUB_TOKENDANCE_ID_CLIENT_ID
AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET
"@
    New-FixtureFile $agentHubRoot "app\desktop\src\api\hubAuth.ts" @"
start_oidc_callback_server
redirect_uri
"@
    New-FixtureFile $agentHubRoot "app\desktop\src\api\hubTokenStorage.ts" "sessionStorage"
    New-FixtureFile $agentHubRoot "app\desktop\src\api\hubWS.ts" "access_token"
    New-FixtureFile $agentHubRoot "app\web\src\api\hubAuth.ts" "/auth/tokendance/callback"
    New-FixtureFile $agentHubRoot "app\web\src\api\hubTokenStorage.ts" "sessionStorage"
    New-FixtureFile $agentHubRoot "app\web\src\api\hubWS.ts" "access_token"
    New-FixtureFile $agentHubRoot "hub-server\internal\handler\ws_test.go" "TestWebSocketRouteAcceptsHubLocalQueryTokenBeforeUpgrade"
    New-FixtureFile $agentHubRoot "hub-server\internal\middleware\auth_test.go" "TestRequireHubSessionBlocksTokenDanceAuth"
    New-FixtureFile $agentHubRoot "app\web\README.md" "BFF/HttpOnly cookie"
    New-FixtureFile $Root "docs\relying-party-readiness.md" @"
| AgentHub Hub Server | Partial |
BFF/HttpOnly cookie
"@

    return $agentHubRoot
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-oidc-readiness.ps1"
$scriptText = Get-Content -LiteralPath $scriptPath -Raw

Assert-True ($scriptText -match '\[switch\]\$SkipWorkspaceDocs') "OIDC readiness exposes -SkipWorkspaceDocs"
Assert-True ($scriptText -match 'docs[\\/]+identity[\\/]+relying-party\.md') "workspace docs lookup supports current relying-party matrix"
Assert-True ($scriptText -match 'docs[\\/]+relying-party-readiness\.md') "workspace docs lookup keeps legacy readiness matrix compatibility"
Assert-True ($scriptText -match 'Searched workspace docs:') "workspace docs miss has explicit searched-path diagnostics"

$skipRun = Invoke-ReadinessScript @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $scriptPath,
    "-SkipWorkspaceDocs"
)
Assert-True ($skipRun.ExitCode -eq 0) "OIDC readiness passes AgentHub-only dry gate with -SkipWorkspaceDocs" $skipRun.Output

$defaultRun = Invoke-ReadinessScript @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $scriptPath
)

$workspaceDocs = Find-ExpectedWorkspaceDocs
if ($null -ne $workspaceDocs) {
    Assert-True ($defaultRun.ExitCode -eq 0) "OIDC readiness default mode finds TokenDance workspace identity docs" $defaultRun.Output
    Assert-True ($defaultRun.Output -match "root relying-party matrix still marks AgentHub Hub Server Partial") "default mode checks current relying-party matrix" $defaultRun.Output
} else {
    Assert-True ($defaultRun.ExitCode -ne 0) "OIDC readiness default mode fails closed without workspace docs" $defaultRun.Output
    Assert-True ($defaultRun.Output -match "Searched workspace docs:") "workspace docs failure lists searched paths" $defaultRun.Output
    Assert-True ($defaultRun.Output -match "-SkipWorkspaceDocs") "workspace docs failure tells AgentHub-only clones how to proceed" $defaultRun.Output
}

$legacyFixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-oidc-readiness-legacy-$PID"
Remove-Item -LiteralPath $legacyFixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
try {
    $legacyAgentHubRoot = New-LegacyOnlyWorkspaceFixture $legacyFixtureRoot
    $legacyRun = Invoke-ReadinessScript @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", (Join-Path $legacyAgentHubRoot "scripts\verify-oidc-readiness.ps1")
    )
    Assert-True ($legacyRun.ExitCode -eq 0) "OIDC readiness default mode accepts legacy-only workspace docs" $legacyRun.Output
    Assert-True ($legacyRun.Output -match 'workspace docs source: docs\\relying-party-readiness\.md') "legacy-only fixture reports legacy readiness matrix source" $legacyRun.Output
} finally {
    Remove-Item -LiteralPath $legacyFixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
