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

function Write-Json {
    param(
        [string]$Path,
        [object]$Value
    )
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}

$scriptPath = Join-Path $RepoRoot "scripts\verify\verify-p0-approved-real-gold-path.ps1"
$scriptImplementationPath = Join-Path $RepoRoot "scripts\verify\verify-p0-approved-real-gold-path.ps1"
$realE2eSkillPath = Join-Path $RepoRoot ".agents\skills\real-e2e-acceptance\SKILL.md"
$agentsPath = Join-Path $RepoRoot "AGENTS.md"

try {
    Assert-True (Test-Path -LiteralPath $scriptPath -PathType Leaf) "P0 approved-real gold-path harness exists"
    Assert-True (Test-Path -LiteralPath $scriptImplementationPath -PathType Leaf) "P0 approved-real gold-path harness implementation exists"
    Assert-True (Test-Path -LiteralPath $realE2eSkillPath -PathType Leaf) "real E2E acceptance skill exists"
    Assert-True (Test-Path -LiteralPath $agentsPath -PathType Leaf) "AGENTS.md exists"

    if (Test-Path -LiteralPath $scriptImplementationPath -PathType Leaf) {
        $scriptText = Get-Content -Raw -LiteralPath $scriptImplementationPath
        Assert-True ($scriptText -match "verify-token-dance-id-login-readiness\.ps1") "harness composes TokenDanceID readiness"
        Assert-True ($scriptText -match "verify-p0-desktop-edge-cli-smoke\.ps1") "harness composes Desktop/Edge/CLI no-spend smoke"
        Assert-True ($scriptText -match "verify-approved-real-demo-readiness\.ps1") "harness composes Hub replay/Web redacted manifest"
        Assert-True ($scriptText -match "BLOCKED_WITH_EVIDENCE") "harness emits BLOCKED_WITH_EVIDENCE"
        Assert-True ($scriptText -match "agenthub-redacted-evidence-manifest-v1") "harness emits redacted manifest schema"
        Assert-True ($scriptText -notmatch '(?m)^\s*(?:&\s*)?(?:codex|claude|opencode)\b') "harness has no direct real CLI command pattern"
        Assert-True ($scriptText -notmatch 'api\.vectorcontrol\.tech|Invoke-RestMethod\s+-Uri\s+https?://') "harness has no model/API spend primitive"
    }

    $tmp = Join-Path $RepoRoot ".tmp\p0-approved-real-gold-path\script-test-$PID"
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $TempRoots += $tmp

    $tokenReady = Join-Path $tmp "token-ready.json"
    Write-Json $tokenReady ([ordered]@{
        schema = "agenthub-token-dance-id-login-readiness-v1"
        status = "READY_FOR_OPERATOR"
        real_login_executed_by_script = $false
        fixture_login_accepted_as_real = $false
        secret_values_logged = $false
    })

    $edgeReady = Join-Path $tmp "edge-ready.json"
    Write-Json $edgeReady ([ordered]@{
        schema = "agenthub-p0-desktop-edge-cli-smoke-v1"
        status = "P0_DESKTOP_EDGE_CLI_SMOKE_PASSED"
        claims = [ordered]@{
            sidecar_edge_started = $true
            mock_adapter_used = $true
            real_cli_tested = $false
            real_model_tested = $false
            tokendance_id_login = $false
            real_api_budget_spend = $false
        }
    })

    $demoReady = Join-Path $tmp "demo-ready.json"
    Write-Json $demoReady ([ordered]@{
        schema = "agenthub-redacted-evidence-manifest-v1"
        status = "READY_FOR_APPROVAL"
        evidence_boundary = [ordered]@{ label = "approved-real"; real_tested = $false; readiness_only = $true; no_secret = $true }
        redaction = [ordered]@{ status = "passed" }
        RealLoginTested = $false
        RealCliTested = $false
        MockAdapterUsed = $true
        HubSessionSource = "fixture-observed-hub-replay"
        WebReplayObserved = $true
        files = @([ordered]@{ path = "evidence/placeholder.json"; sha256 = "0"; bytes = 0 })
    })

    $manifestPath = Join-Path $tmp "redacted-manifest.json"
    $ready = Invoke-RepoScript @(
        $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-ArtifactRoot", $tmp,
        "-ManifestPath", $manifestPath,
        "-TokenDanceIDReadinessPath", $tokenReady,
        "-DesktopEdgeCliSmokePath", $edgeReady,
        "-DemoReadinessManifestPath", $demoReady
    )
    Assert-True ($ready.ExitCode -eq 0) "provided ready evidence reaches READY_FOR_APPROVAL" $ready.Output
    Assert-True ($ready.Output -match "Status: READY_FOR_APPROVAL") "ready run prints READY_FOR_APPROVAL" $ready.Output
    Assert-True (Test-Path -LiteralPath $manifestPath -PathType Leaf) "ready run writes redacted manifest"

    $readyManifestText = Get-Content -Raw -LiteralPath $manifestPath
    $readyManifest = $readyManifestText | ConvertFrom-Json
    Assert-True ($readyManifest.status -eq "READY_FOR_APPROVAL") "manifest status READY_FOR_APPROVAL"
    Assert-True ($readyManifest.gates.tokendance_id_readiness -eq "READY_FOR_OPERATOR") "manifest records TokenDanceID readiness"
    Assert-True ($readyManifest.gates.desktop_edge_cli_no_spend -eq "PASS") "manifest records Desktop/Edge/CLI pass"
    Assert-True ($readyManifest.gates.hub_replay_web_manifest -eq "READY_FOR_APPROVAL") "manifest records Hub replay/Web manifest pass"
    Assert-True ($readyManifest.claims.real_tokendance_id_login -eq $false) "manifest records no real TokenDanceID login"
    Assert-True ($readyManifest.claims.real_cli_or_model_invoked -eq $false) "manifest records no real CLI/model invocation"
    Assert-True (@($readyManifest.files).Count -ge 3) "manifest lists copied evidence files"
    Assert-True ($readyManifestText -notmatch '(?i)(sk-[a-z0-9_-]{8,}|Authorization:\s*Bearer\s+(?!<redacted)[^\s,;}]+)') "manifest has no unredacted secret-like values"

    $verify = Invoke-RepoScript @(
        (Join-Path $RepoRoot "scripts\lib\evidence\verify-redacted-manifest.ps1"),
        "-ManifestPath", $manifestPath
    )
    Assert-True ($verify.ExitCode -eq 0) "redacted manifest verifier accepts gold-path output" $verify.Output

    $blockedRoot = Join-Path $RepoRoot ".tmp\p0-approved-real-gold-path\script-blocked-test-$PID"
    Remove-Item -LiteralPath $blockedRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $blockedRoot | Out-Null
    $TempRoots += $blockedRoot
    $blockedManifest = Join-Path $blockedRoot "redacted-manifest.json"
    $blocked = Invoke-RepoScript @(
        $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-ArtifactRoot", $blockedRoot,
        "-ManifestPath", $blockedManifest,
        "-TokenDanceIDReadinessPath", $tokenReady,
        "-DemoReadinessManifestPath", $demoReady
    )
    Assert-True ($blocked.ExitCode -ne 0) "missing Desktop/Edge/CLI evidence blocks" $blocked.Output
    Assert-True ($blocked.Output -match "Status: BLOCKED_WITH_EVIDENCE") "blocked run prints BLOCKED_WITH_EVIDENCE" $blocked.Output
    $blockedJson = Get-Content -Raw -LiteralPath $blockedManifest | ConvertFrom-Json
    Assert-True ($blockedJson.status -eq "BLOCKED_WITH_EVIDENCE") "blocked manifest status is BLOCKED_WITH_EVIDENCE"
    Assert-True ((@($blockedJson.blockers) -match "Desktop target").Count -gt 0) "blocked manifest names Desktop/Edge/CLI evidence gap"

    $defaultRoot = Join-Path $RepoRoot ".tmp\p0-approved-real-gold-path\script-default-test-$PID"
    Remove-Item -LiteralPath $defaultRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $defaultRoot | Out-Null
    $TempRoots += $defaultRoot
    $defaultManifest = Join-Path $defaultRoot "redacted-manifest.json"
    $defaultBlocked = Invoke-RepoScript @(
        $scriptPath,
        "-RepoRoot", $RepoRoot,
        "-ArtifactRoot", $defaultRoot,
        "-ManifestPath", $defaultManifest
    )
    Assert-True ($defaultBlocked.ExitCode -ne 0) "default no-secret run blocks without operator metadata/evidence" $defaultBlocked.Output
    Assert-True ($defaultBlocked.Output -match "Status: BLOCKED_WITH_EVIDENCE") "default no-secret run prints BLOCKED_WITH_EVIDENCE" $defaultBlocked.Output
    Assert-True ($defaultBlocked.Output -notmatch "ArtifactRoot must stay under") "default no-secret run does not trip child artifact-root policy" $defaultBlocked.Output
    Assert-True (Test-Path -LiteralPath $defaultManifest -PathType Leaf) "default no-secret run writes manifest"
    $defaultManifestText = Get-Content -Raw -LiteralPath $defaultManifest
    Assert-True ($defaultManifestText -notmatch [regex]::Escape($RepoRoot)) "default manifest redacts raw repo path"
    Assert-True ($defaultManifestText -notmatch [regex]::Escape($RepoRoot.Replace("\", "\\"))) "default manifest redacts JSON-escaped repo path"
}
finally {
    foreach ($path in $TempRoots) {
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if (Test-Path -LiteralPath $realE2eSkillPath) {
    $skillText = Get-Content -Raw -LiteralPath $realE2eSkillPath
    Assert-True ($skillText -match "approved-real") "real E2E skill owns approved-real evidence boundary"
    Assert-True ($skillText -match "real_tested=false") "real E2E skill preserves readiness/fixture false boundary"
}

if (Test-Path -LiteralPath $agentsPath) {
    $agentsText = Get-Content -Raw -LiteralPath $agentsPath
    Assert-True ($agentsText -match "real-e2e-acceptance") "AGENTS references real E2E acceptance skill"
    Assert-True ($agentsText -match "STATE\.md" -eq $false) "AGENTS no longer uses root STATE.md as fact owner"
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
