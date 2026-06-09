[CmdletBinding()]
param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$Failed = 0
$TempRoots = @()

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message,
        [string]$Details = ""
    )

    if ($Condition) {
        Write-Host "PASS: $Message" -ForegroundColor Green
        return
    }

    $script:Failed++
    Write-Host "FAIL: $Message" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($Details)) {
        Write-Host $Details
    }
}

function Invoke-RepoScript {
    param([string[]]$Arguments)

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "pwsh"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $RepoRoot
    $allArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File") + $Arguments
    $psi.Arguments = ($allArgs | ForEach-Object {
        '"' + ([string]$_).Replace('"', '\"') + '"'
    }) -join " "

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
}

function New-DiscoveryFixture {
    param(
        [string]$Root,
        [string]$Name,
        [string]$Json
    )

    $path = Join-Path $Root $Name
    Set-Content -LiteralPath $path -Encoding utf8 -Value $Json
    return $path
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-token-dance-id-login-readiness.ps1"
$statePath = Join-Path $RepoRoot "STATE.md"
$readinessDocPath = Join-Path $RepoRoot "docs\audit\token-dance-id-login-readiness.md"
$envExamplePath = Join-Path $RepoRoot ".env.example"

Assert-True (Test-Path -LiteralPath $scriptPath) "TokenDanceID login readiness script exists"
Assert-True (Test-Path -LiteralPath $statePath) "STATE.md exists"
Assert-True (Test-Path -LiteralPath $readinessDocPath) "TokenDanceID login readiness doc exists"

try {
    $tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-token-dance-id-login-readiness-$PID"
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
    $TempRoots += $tmpRoot

    if (Test-Path -LiteralPath $scriptPath) {
        $scriptText = Get-Content -Raw -LiteralPath $scriptPath
        Assert-True ($scriptText -match 'agenthub-token-dance-id-login-readiness-v1') "script emits stable schema"
        Assert-True ($scriptText -match 'READY_FOR_OPERATOR') "script has ready-for-operator status"
        Assert-True ($scriptText -match 'BLOCKED') "script has blocked status"
        Assert-True ($scriptText -match 'AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF') "script requires approved test account reference env"
        Assert-True ($scriptText -match 'AGENTHUB_TDID_LOGIN_CLIENT_ID') "script requires approved client id env"
        Assert-True ($scriptText -match 'DiscoveryDocumentPath') "script supports offline discovery fixture for tests"
        Assert-True ($scriptText -match 'real_login_executed_by_script = \$false') "script never claims real login execution"
        Assert-True ($scriptText -match 'fixture_login_accepted_as_real = \$false') "script does not accept fixtures as real login"
        Assert-True ($scriptText -match 'Test-SecretLike') "script detects secret-like input"

        $blocked = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-DiscoveryDocumentPath", (New-DiscoveryFixture $tmpRoot "blocked-discovery.json" '{"issuer":"https://id.vectorcontrol.tech","authorization_endpoint":"https://id.vectorcontrol.tech/oidc/authorize","token_endpoint":"https://id.vectorcontrol.tech/oidc/token","jwks_uri":"https://id.vectorcontrol.tech/oidc/jwks"}')
        )
        Assert-True ($blocked.ExitCode -ne 0) "default run blocks when approved env is absent" $blocked.Output
        Assert-True ($blocked.Output -match "Status: BLOCKED") "blocked run reports BLOCKED" $blocked.Output
        Assert-True ($blocked.Output -match "AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF") "blocked run names missing test account env" $blocked.Output
        Assert-True ($blocked.Output -match "RealLoginExecutedByScript=false") "blocked run does not perform login" $blocked.Output

        $badDiscovery = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-IssuerUrl", "https://id.vectorcontrol.tech",
            "-ClientId", "agenthub-approved-client",
            "-TestAccountRef", "approved-test-account:agenthub-login-smoke",
            "-DiscoveryDocumentPath", (New-DiscoveryFixture $tmpRoot "bad-discovery.json" '{"issuer":"https://wrong.example","authorization_endpoint":"https://id.vectorcontrol.tech/oidc/authorize","token_endpoint":"https://id.vectorcontrol.tech/oidc/token","jwks_uri":"https://id.vectorcontrol.tech/oidc/jwks"}')
        )
        Assert-True ($badDiscovery.ExitCode -ne 0) "issuer mismatch blocks readiness" $badDiscovery.Output
        Assert-True ($badDiscovery.Output -match "discovery issuer") "issuer mismatch is explicit" $badDiscovery.Output
        Assert-True ($badDiscovery.Output -notmatch "READY_FOR_OPERATOR") "issuer mismatch does not report ready" $badDiscovery.Output

        $secretLike = "sk-test-secret-value-123456"
        $secretRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-IssuerUrl", "https://id.vectorcontrol.tech",
            "-ClientId", $secretLike,
            "-TestAccountRef", "approved-test-account:agenthub-login-smoke",
            "-DiscoveryDocumentPath", (New-DiscoveryFixture $tmpRoot "secret-discovery.json" '{"issuer":"https://id.vectorcontrol.tech","authorization_endpoint":"https://id.vectorcontrol.tech/oidc/authorize","token_endpoint":"https://id.vectorcontrol.tech/oidc/token","jwks_uri":"https://id.vectorcontrol.tech/oidc/jwks"}')
        )
        Assert-True ($secretRun.ExitCode -ne 0) "secret-like client input fails closed" $secretRun.Output
        Assert-True ($secretRun.Output -match "secret-like") "secret-like failure is generic" $secretRun.Output
        Assert-True ($secretRun.Output -notmatch [regex]::Escape($secretLike)) "secret-like value is not printed" $secretRun.Output

        $outputPath = Join-Path $tmpRoot "ready.json"
        $ready = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-IssuerUrl", "https://id.vectorcontrol.tech",
            "-ClientId", "agenthub-approved-client",
            "-TestAccountRef", "approved-test-account:agenthub-login-smoke",
            "-DiscoveryDocumentPath", (New-DiscoveryFixture $tmpRoot "ready-discovery.json" '{"issuer":"https://id.vectorcontrol.tech","authorization_endpoint":"https://id.vectorcontrol.tech/oidc/authorize","token_endpoint":"https://id.vectorcontrol.tech/oidc/token","jwks_uri":"https://id.vectorcontrol.tech/oidc/jwks","response_types_supported":["code"],"code_challenge_methods_supported":["S256"]}'),
            "-OutputPath", $outputPath
        )
        Assert-True ($ready.ExitCode -eq 0) "approved metadata and discovery report READY_FOR_OPERATOR" $ready.Output
        Assert-True ($ready.Output -match "Status: READY_FOR_OPERATOR") "ready run prints READY_FOR_OPERATOR" $ready.Output
        Assert-True ($ready.Output -match "FixtureLoginAcceptedAsReal=false") "ready run keeps fixture boundary explicit" $ready.Output

        $readyJson = Get-Content -Raw -LiteralPath $outputPath | ConvertFrom-Json
        Assert-True ($readyJson.status -eq "READY_FOR_OPERATOR") "JSON output records ready status" ($readyJson | ConvertTo-Json -Depth 8)
        Assert-True ($readyJson.real_login_executed_by_script -eq $false) "JSON output records no real login" ($readyJson | ConvertTo-Json -Depth 8)
        Assert-True ($readyJson.fixture_login_accepted_as_real -eq $false) "JSON output records fixture boundary" ($readyJson | ConvertTo-Json -Depth 8)
        Assert-True ($readyJson.secret_values_logged -eq $false) "JSON output records no secret logging" ($readyJson | ConvertTo-Json -Depth 8)
    }

    if (Test-Path -LiteralPath $statePath) {
        $stateText = Get-Content -Raw -LiteralPath $statePath
        Assert-True ($stateText -match "verify-token-dance-id-login-readiness\.ps1") "STATE references the no-secret login readiness gate"
        Assert-True ($stateText -match "READY_FOR_OPERATOR") "STATE records ready-for-operator status contract"
        Assert-True ($stateText -match "fixture") "STATE states fixture evidence is not real login"
    }

    if (Test-Path -LiteralPath $readinessDocPath) {
        $docText = Get-Content -Raw -LiteralPath $readinessDocPath
        Assert-True ($docText -match "AGENTHUB_TDID_LOGIN_ISSUER_URL") "readiness doc names issuer URL env"
        Assert-True ($docText -match "AGENTHUB_TDID_LOGIN_CLIENT_ID") "readiness doc names client id env"
        Assert-True ($docText -match "AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF") "readiness doc names test account ref env"
        Assert-True ($docText -match "AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET") "readiness doc distinguishes runtime client secret"
        Assert-True ($docText -match "verify-p0-approved-real-gold-path\.ps1") "readiness doc includes gold-path command"
        Assert-True ($docText -match "BLOCKED_WITH_EVIDENCE") "readiness doc preserves blocked-with-evidence boundary"
    }

    if (Test-Path -LiteralPath $envExamplePath) {
        $envText = Get-Content -Raw -LiteralPath $envExamplePath
        Assert-True ($envText -match "AGENTHUB_TDID_LOGIN_ISSUER_URL") ".env.example lists issuer readiness env"
        Assert-True ($envText -match "AGENTHUB_TDID_LOGIN_CLIENT_ID") ".env.example lists client id readiness env"
        Assert-True ($envText -match "AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF") ".env.example lists test account ref readiness env"
        Assert-True ($envText -match "not Hub runtime secrets") ".env.example labels readiness env as non-runtime metadata"
    }
}
finally {
    foreach ($path in $TempRoots) {
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
