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

function Join-NativeArguments {
    param([string[]]$Arguments)

    $quoted = foreach ($arg in $Arguments) {
        if ($null -eq $arg) {
            '""'
            continue
        }
        if ($arg -notmatch '[\s"\[\]]' -and $arg.Length -gt 0) {
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

function Invoke-RepoScript {
    param([string[]]$Arguments)

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "pwsh"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $RepoRoot
    foreach ($arg in @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File") + $Arguments) {
        [void]$psi.ArgumentList.Add($arg)
    }

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-login-e2e-readiness.ps1"
$specPath = Join-Path $RepoRoot "app\web\src\__e2e__\oidc-login.spec.ts"
$docPath = Join-Path $RepoRoot "docs\audit\p2-login-e2e-approval-harness.md"

Assert-True (Test-Path -LiteralPath $scriptPath) "login E2E readiness script exists"
Assert-True (Test-Path -LiteralPath $specPath) "web OIDC Playwright spec exists"
Assert-True (Test-Path -LiteralPath $docPath) "login E2E audit doc exists"

try {
    $tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-login-e2e-test-$PID"
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
    $TempRoots += $tmpRoot

    if (Test-Path -LiteralPath $scriptPath) {
        $scriptText = Get-Content -Raw -LiteralPath $scriptPath
        Assert-True ($scriptText -match '\[ValidateSet\("ProposalOnly", "RealApproved", "EvidenceReview"\)\]') "script exposes proposal, approved, and evidence review modes"
        Assert-True ($scriptText -match 'ApproveRealLogin') "script requires explicit real login approval"
        Assert-True ($scriptText -match 'ApproveRemoteDispatch') "script requires explicit remote dispatch approval"
        Assert-True ($scriptText -match 'remote_dispatch_executed_by_script = \$false') "script does not dispatch work"
        Assert-True ($scriptText -match 'real_login_executed_by_script = \$false') "script does not perform login"
        Assert-True ($scriptText -match 'Test-SecretLike') "script has secret-like input detection"
        Assert-True ($scriptText -match 'target_inventory') "script validates target inventory evidence"

        $proposal = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot
        )
        Assert-True ($proposal.ExitCode -eq 2) "default proposal mode fails closed" $proposal.Output
        Assert-True ($proposal.Output -match "BLOCKED_UNTIL_APPROVED") "default proposal reports blocked until approved" $proposal.Output
        Assert-True ($proposal.Output -match "RealLoginExecutedByScript=false") "default proposal does not perform login" $proposal.Output

        $missingEnv = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "RealApproved"
        )
        Assert-True ($missingEnv.ExitCode -ne 0) "RealApproved fails with missing env/prerequisites" $missingEnv.Output
        Assert-True ($missingEnv.Output -match "OAuth client id is required") "missing env names OAuth client id" $missingEnv.Output

        $unapproved = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "RealApproved",
            "-OAuthClientId", "agenthub-test-client",
            "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
            "-HubBaseUrl", "http://127.0.0.1:8080",
            "-WebUrl", "http://127.0.0.1:5174",
            "-TestAccountIndicator", "disposable-test-account",
            "-ArtifactRoot", ".tmp\login-e2e\approved",
            "-BrowserEvidenceBoundary", "metadata-only",
            "-OperatorApprovalId", "approval-123",
            "-HubSessionProof", "proof:hub-session",
            "-TargetInventoryProof", "proof:target-inventory",
            "-SelectedDesktopTargetProof", "proof:selected-target",
            "-DispatchRequestProof", "proof:dispatch",
            "-EventReplayProof", "proof:event-replay"
        )
        Assert-True ($unapproved.ExitCode -ne 0) "RealApproved fails without explicit approval flags" $unapproved.Output
        Assert-True ($unapproved.Output -match "ApproveRealLogin") "unapproved real mode names real login approval" $unapproved.Output
        Assert-True ($unapproved.Output -match "ApproveRemoteDispatch") "unapproved real mode names remote dispatch approval" $unapproved.Output

        $secretValue = "sk-test-secret-value-123456"
        $secretRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "RealApproved",
            "-OAuthClientId", $secretValue,
            "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
            "-HubBaseUrl", "http://127.0.0.1:8080",
            "-WebUrl", "http://127.0.0.1:5174",
            "-TestAccountIndicator", "disposable-test-account",
            "-ArtifactRoot", ".tmp\login-e2e\approved",
            "-BrowserEvidenceBoundary", "metadata-only",
            "-OperatorApprovalId", "approval-123",
            "-ApproveRealLogin",
            "-ApproveRemoteDispatch",
            "-HubSessionProof", "proof:hub-session",
            "-TargetInventoryProof", "proof:target-inventory",
            "-SelectedDesktopTargetProof", "proof:selected-target",
            "-DispatchRequestProof", "proof:dispatch",
            "-EventReplayProof", "proof:event-replay"
        )
        Assert-True ($secretRun.ExitCode -ne 0) "unsafe token-like input fails closed" $secretRun.Output
        Assert-True ($secretRun.Output -match "secret-like") "unsafe token output is generic" $secretRun.Output
        Assert-True ($secretRun.Output -notmatch [regex]::Escape($secretValue)) "unsafe token value is not printed" $secretRun.Output

        $directLocalEdge = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "RealApproved",
            "-OAuthClientId", "agenthub-test-client",
            "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
            "-HubBaseUrl", "http://127.0.0.1:8080",
            "-WebUrl", "http://127.0.0.1:3210",
            "-TestAccountIndicator", "disposable-test-account",
            "-ArtifactRoot", ".tmp\login-e2e\approved",
            "-BrowserEvidenceBoundary", "metadata-only",
            "-OperatorApprovalId", "approval-123",
            "-ApproveRealLogin",
            "-ApproveRemoteDispatch",
            "-HubSessionProof", "proof:hub-session",
            "-TargetInventoryProof", "proof:target-inventory",
            "-SelectedDesktopTargetProof", "proof:selected-target",
            "-DispatchRequestProof", "proof:dispatch",
            "-EventReplayProof", "proof:event-replay"
        )
        Assert-True ($directLocalEdge.ExitCode -ne 0) "direct Web-to-LocalEdge URL fails closed" $directLocalEdge.Output
        Assert-True ($directLocalEdge.Output -match "Web URL must not point directly at Local Edge") "direct LocalEdge failure is explicit" $directLocalEdge.Output

        $localhostLocalEdge = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "RealApproved",
            "-OAuthClientId", "agenthub-test-client",
            "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
            "-HubBaseUrl", "http://127.0.0.1:8080",
            "-WebUrl", "http://localhost:3210/v1/runs",
            "-TestAccountIndicator", "disposable-test-account",
            "-ArtifactRoot", ".tmp\login-e2e\approved",
            "-BrowserEvidenceBoundary", "metadata-only",
            "-OperatorApprovalId", "approval-123",
            "-ApproveRealLogin",
            "-ApproveRemoteDispatch",
            "-HubSessionProof", "proof:hub-session",
            "-TargetInventoryProof", "proof:target-inventory",
            "-SelectedDesktopTargetProof", "proof:selected-target",
            "-DispatchRequestProof", "proof:dispatch",
            "-EventReplayProof", "proof:event-replay"
        )
        Assert-True ($localhostLocalEdge.ExitCode -ne 0) "localhost Local Edge alias fails closed" $localhostLocalEdge.Output
        Assert-True ($localhostLocalEdge.Output -match "Web URL must not point directly at Local Edge") "localhost Local Edge alias failure is explicit" $localhostLocalEdge.Output

        $ipv6LocalEdge = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "RealApproved",
            "-OAuthClientId", "agenthub-test-client",
            "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
            "-HubBaseUrl", "http://127.0.0.1:8080",
            "-WebUrl", "http://[::1]:3210/v1/runs",
            "-TestAccountIndicator", "disposable-test-account",
            "-ArtifactRoot", ".tmp\login-e2e\approved",
            "-BrowserEvidenceBoundary", "metadata-only",
            "-OperatorApprovalId", "approval-123",
            "-ApproveRealLogin",
            "-ApproveRemoteDispatch",
            "-HubSessionProof", "proof:hub-session",
            "-TargetInventoryProof", "proof:target-inventory",
            "-SelectedDesktopTargetProof", "proof:selected-target",
            "-DispatchRequestProof", "proof:dispatch",
            "-EventReplayProof", "proof:event-replay"
        )
        Assert-True ($ipv6LocalEdge.ExitCode -ne 0) "IPv6 loopback Local Edge alias fails closed" $ipv6LocalEdge.Output
        Assert-True ($ipv6LocalEdge.Output -match "Web URL must not point directly at Local Edge") "IPv6 Local Edge alias failure is explicit" $ipv6LocalEdge.Output

        $traversalArtifactRoot = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "RealApproved",
            "-OAuthClientId", "agenthub-test-client",
            "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
            "-HubBaseUrl", "http://127.0.0.1:8080",
            "-WebUrl", "http://127.0.0.1:5174",
            "-TestAccountIndicator", "disposable-test-account",
            "-ArtifactRoot", ".tmp\..\docs\audit",
            "-BrowserEvidenceBoundary", "metadata-only",
            "-OperatorApprovalId", "approval-123",
            "-ApproveRealLogin",
            "-ApproveRemoteDispatch",
            "-HubSessionProof", "proof:hub-session",
            "-TargetInventoryProof", "proof:target-inventory",
            "-SelectedDesktopTargetProof", "proof:selected-target",
            "-DispatchRequestProof", "proof:dispatch",
            "-EventReplayProof", "proof:event-replay"
        )
        Assert-True ($traversalArtifactRoot.ExitCode -ne 0) "path traversal artifact root fails closed" $traversalArtifactRoot.Output
        Assert-True ($traversalArtifactRoot.Output -match "artifact root") "path traversal artifact root failure is explicit" $traversalArtifactRoot.Output

        foreach ($unsafeArtifactRoot in @(".tmpx\login-e2e", "tmp-old\login-e2e", (Join-Path $RepoRoot ".tmp-sibling\login-e2e"))) {
            $siblingArtifactRoot = Invoke-RepoScript @(
                $scriptPath,
                "-RepoRoot", $RepoRoot,
                "-Mode", "RealApproved",
                "-OAuthClientId", "agenthub-test-client",
                "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
                "-HubBaseUrl", "http://127.0.0.1:8080",
                "-WebUrl", "http://127.0.0.1:5174",
                "-TestAccountIndicator", "disposable-test-account",
                "-ArtifactRoot", $unsafeArtifactRoot,
                "-BrowserEvidenceBoundary", "metadata-only",
                "-OperatorApprovalId", "approval-123",
                "-ApproveRealLogin",
                "-ApproveRemoteDispatch",
                "-HubSessionProof", "proof:hub-session",
                "-TargetInventoryProof", "proof:target-inventory",
                "-SelectedDesktopTargetProof", "proof:selected-target",
                "-DispatchRequestProof", "proof:dispatch",
                "-EventReplayProof", "proof:event-replay"
            )
            Assert-True ($siblingArtifactRoot.ExitCode -ne 0) "artifact root sibling prefix fails closed: $unsafeArtifactRoot" $siblingArtifactRoot.Output
            Assert-True ($siblingArtifactRoot.Output -match "artifact root") "artifact root sibling prefix failure is explicit: $unsafeArtifactRoot" $siblingArtifactRoot.Output
        }

        $missingTargetProof = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "RealApproved",
            "-OAuthClientId", "agenthub-test-client",
            "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
            "-HubBaseUrl", "http://127.0.0.1:8080",
            "-WebUrl", "http://127.0.0.1:5174",
            "-TestAccountIndicator", "disposable-test-account",
            "-ArtifactRoot", ".tmp\login-e2e\approved",
            "-BrowserEvidenceBoundary", "metadata-only",
            "-OperatorApprovalId", "approval-123",
            "-ApproveRealLogin",
            "-ApproveRemoteDispatch",
            "-HubSessionProof", "proof:hub-session",
            "-SelectedDesktopTargetProof", "proof:selected-target",
            "-DispatchRequestProof", "proof:dispatch",
            "-EventReplayProof", "proof:event-replay"
        )
        Assert-True ($missingTargetProof.ExitCode -ne 0) "missing target inventory proof fails closed" $missingTargetProof.Output
        Assert-True ($missingTargetProof.Output -match "target inventory proof is required") "missing target inventory proof is explicit" $missingTargetProof.Output

        $approvedOut = Join-Path $tmpRoot "approved-readiness.json"
        $approved = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "RealApproved",
            "-OAuthClientId", "agenthub-test-client",
            "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
            "-HubBaseUrl", "http://127.0.0.1:8080",
            "-WebUrl", "http://127.0.0.1:5174",
            "-TestAccountIndicator", "disposable-test-account",
            "-ArtifactRoot", ".tmp\login-e2e\approved",
            "-BrowserEvidenceBoundary", "metadata-only",
            "-OperatorApprovalId", "approval-123",
            "-ApproveRealLogin",
            "-ApproveRemoteDispatch",
            "-HubSessionProof", "proof:hub-session",
            "-TargetInventoryProof", "proof:target-inventory",
            "-SelectedDesktopTargetProof", "proof:selected-target",
            "-DispatchRequestProof", "proof:dispatch",
            "-EventReplayProof", "proof:event-replay",
            "-OutputPath", $approvedOut
        )
        Assert-True ($approved.ExitCode -eq 0) "approved metadata reaches ready status" $approved.Output
        Assert-True ($approved.Output -match "READY_FOR_APPROVED_REAL_LOGIN_E2E") "approved metadata reports ready for approved real E2E" $approved.Output
        $approvedJson = Get-Content -Raw -LiteralPath $approvedOut | ConvertFrom-Json
        Assert-True ($approvedJson.real_login_executed_by_script -eq $false) "approved script output still does not claim login execution" ($approvedJson | ConvertTo-Json -Depth 8)
        Assert-True ($approvedJson.remote_dispatch_executed_by_script -eq $false) "approved script output still does not claim dispatch execution" ($approvedJson | ConvertTo-Json -Depth 8)

        $manifestMissingInventory = Join-Path $tmpRoot "missing-inventory-manifest.json"
        @{
            real_login_approved = $true
            remote_dispatch_approved = $true
            redaction_status = "redacted"
            web_to_local_edge_direct = $false
            hub_session = @{ ref = "proof:hub-session" }
            selected_desktop_target = @{ ref = "proof:selected-target" }
            dispatch_request = @{ ref = "proof:dispatch" }
            event_replay = @{ ref = "proof:event-replay" }
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestMissingInventory -Encoding UTF8

        $reviewMissingInventory = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "EvidenceReview",
            "-OAuthClientId", "agenthub-test-client",
            "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
            "-HubBaseUrl", "http://127.0.0.1:8080",
            "-WebUrl", "http://127.0.0.1:5174",
            "-TestAccountIndicator", "disposable-test-account",
            "-ArtifactRoot", ".tmp\login-e2e\approved",
            "-BrowserEvidenceBoundary", "metadata-only",
            "-OperatorApprovalId", "approval-123",
            "-ApproveRealLogin",
            "-ApproveRemoteDispatch",
            "-EvidenceManifest", $manifestMissingInventory
        )
        Assert-True ($reviewMissingInventory.ExitCode -ne 0) "evidence review rejects missing target inventory proof" $reviewMissingInventory.Output
        Assert-True ($reviewMissingInventory.Output -match "target_inventory") "evidence review names missing target inventory" $reviewMissingInventory.Output

        $manifestOpaqueToken = Join-Path $tmpRoot "opaque-token-manifest.json"
        @{
            real_login_approved = $true
            remote_dispatch_approved = $true
            redaction_status = "redacted"
            web_to_local_edge_direct = $false
            hub_session = @{ access_token = "opaque-session-token-value" }
            target_inventory = @{ ref = "proof:target-inventory" }
            selected_desktop_target = @{ ref = "proof:selected-target" }
            dispatch_request = @{ ref = "proof:dispatch" }
            event_replay = @{ ref = "proof:event-replay" }
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestOpaqueToken -Encoding UTF8

        $reviewOpaqueToken = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "EvidenceReview",
            "-OAuthClientId", "agenthub-test-client",
            "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
            "-HubBaseUrl", "http://127.0.0.1:8080",
            "-WebUrl", "http://127.0.0.1:5174",
            "-TestAccountIndicator", "disposable-test-account",
            "-ArtifactRoot", ".tmp\login-e2e\approved",
            "-BrowserEvidenceBoundary", "metadata-only",
            "-OperatorApprovalId", "approval-123",
            "-ApproveRealLogin",
            "-ApproveRemoteDispatch",
            "-EvidenceManifest", $manifestOpaqueToken
        )
        Assert-True ($reviewOpaqueToken.ExitCode -ne 0) "evidence review rejects opaque sensitive token fields" $reviewOpaqueToken.Output
        Assert-True ($reviewOpaqueToken.Output -match "sensitive field") "opaque sensitive token field failure is explicit" $reviewOpaqueToken.Output

        foreach ($variant in @(
            @{ Name = "accessToken"; Value = "opaque-session-token-value" },
            @{ Name = "refreshToken"; Value = "opaque-session-token-value" },
            @{ Name = "idToken"; Value = "opaque-session-token-value" },
            @{ Name = "clientSecret"; Value = "opaque-client-secret" },
            @{ Name = "authorizationHeader"; Value = "Bearer opaque-header-value" },
            @{ Name = "session_token"; Value = "opaque-session-token-value" },
            @{ Name = "auth-cookie"; Value = "opaque-cookie-value" }
        )) {
            $manifestSensitiveVariant = Join-Path $tmpRoot "sensitive-$($variant.Name)-manifest.json"
            $hubSession = @{}
            $hubSession[$variant.Name] = $variant.Value
            @{
                real_login_approved = $true
                remote_dispatch_approved = $true
                redaction_status = "redacted"
                web_to_local_edge_direct = $false
                hub_session = $hubSession
                target_inventory = @{ ref = "proof:target-inventory" }
                selected_desktop_target = @{ ref = "proof:selected-target" }
                dispatch_request = @{ ref = "proof:dispatch" }
                event_replay = @{ ref = "proof:event-replay" }
            } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestSensitiveVariant -Encoding UTF8

            $reviewSensitiveVariant = Invoke-RepoScript @(
                $scriptPath,
                "-RepoRoot", $RepoRoot,
                "-Mode", "EvidenceReview",
                "-OAuthClientId", "agenthub-test-client",
                "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
                "-HubBaseUrl", "http://127.0.0.1:8080",
                "-WebUrl", "http://127.0.0.1:5174",
                "-TestAccountIndicator", "disposable-test-account",
                "-ArtifactRoot", ".tmp\login-e2e\approved",
                "-BrowserEvidenceBoundary", "metadata-only",
                "-OperatorApprovalId", "approval-123",
                "-ApproveRealLogin",
                "-ApproveRemoteDispatch",
                "-EvidenceManifest", $manifestSensitiveVariant
            )
            Assert-True ($reviewSensitiveVariant.ExitCode -ne 0) "evidence review rejects opaque sensitive key variant: $($variant.Name)" $reviewSensitiveVariant.Output
            Assert-True ($reviewSensitiveVariant.Output -match "sensitive field") "opaque sensitive key variant failure is explicit: $($variant.Name)" $reviewSensitiveVariant.Output
        }

        $manifestDirectEdgeUrl = Join-Path $tmpRoot "direct-edge-url-manifest.json"
        @{
            real_login_approved = $true
            remote_dispatch_approved = $true
            redaction_status = "redacted"
            web_to_local_edge_direct = $false
            hub_session = @{ ref = "proof:hub-session" }
            target_inventory = @{ ref = "http://localhost:3210/v1/health" }
            selected_desktop_target = @{ ref = "proof:selected-target" }
            dispatch_request = @{ ref = "proof:dispatch" }
            event_replay = @{ ref = "proof:event-replay" }
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestDirectEdgeUrl -Encoding UTF8

        $reviewDirectEdgeUrl = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "EvidenceReview",
            "-OAuthClientId", "agenthub-test-client",
            "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
            "-HubBaseUrl", "http://127.0.0.1:8080",
            "-WebUrl", "http://127.0.0.1:5174",
            "-TestAccountIndicator", "disposable-test-account",
            "-ArtifactRoot", ".tmp\login-e2e\approved",
            "-BrowserEvidenceBoundary", "metadata-only",
            "-OperatorApprovalId", "approval-123",
            "-ApproveRealLogin",
            "-ApproveRemoteDispatch",
            "-EvidenceManifest", $manifestDirectEdgeUrl
        )
        Assert-True ($reviewDirectEdgeUrl.ExitCode -ne 0) "evidence review rejects direct Local Edge URLs in proof fields" $reviewDirectEdgeUrl.Output
        Assert-True ($reviewDirectEdgeUrl.Output -match "direct Local Edge URL") "direct Local Edge evidence URL failure is explicit" $reviewDirectEdgeUrl.Output

        $manifestGood = Join-Path $tmpRoot "good-manifest.json"
        @{
            real_login_approved = $true
            remote_dispatch_approved = $true
            redaction_status = "redacted"
            web_to_local_edge_direct = $false
            hub_session = @{ ref = "proof:hub-session" }
            target_inventory = @{ ref = "proof:target-inventory" }
            selected_desktop_target = @{ ref = "proof:selected-target" }
            dispatch_request = @{ ref = "proof:dispatch"; target_id = "target-local-edge-1" }
            event_replay = @{ ref = "proof:event-replay" }
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestGood -Encoding UTF8

        $reviewGood = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "EvidenceReview",
            "-OAuthClientId", "agenthub-test-client",
            "-CallbackUrl", "http://localhost:5174/auth/tokendance/callback",
            "-HubBaseUrl", "http://127.0.0.1:8080",
            "-WebUrl", "http://127.0.0.1:5174",
            "-TestAccountIndicator", "disposable-test-account",
            "-ArtifactRoot", ".tmp\login-e2e\approved",
            "-BrowserEvidenceBoundary", "metadata-only",
            "-OperatorApprovalId", "approval-123",
            "-ApproveRealLogin",
            "-ApproveRemoteDispatch",
            "-EvidenceManifest", $manifestGood
        )
        Assert-True ($reviewGood.ExitCode -eq 0) "evidence review accepts complete redacted manifest" $reviewGood.Output
    }

    if (Test-Path -LiteralPath $specPath) {
        $specText = Get-Content -Raw -LiteralPath $specPath
        Assert-True ($specText -match "AGENTHUB_LOGIN_E2E_APPROVE_REAL_LOGIN") "Playwright spec checks real login approval env"
        Assert-True ($specText -match "AGENTHUB_LOGIN_E2E_APPROVE_REMOTE_DISPATCH") "Playwright spec checks remote dispatch approval env"
        Assert-True ($specText -match "redactForEvidence") "Playwright spec redacts evidence before artifacts"
        Assert-True ($specText -match "Local Edge") "Playwright spec blocks direct Local Edge topology"
        Assert-True ($specText -match "target inventory") "Playwright spec requires target inventory proof"
    }

    if (Test-Path -LiteralPath $docPath) {
        $docText = Get-Content -Raw -LiteralPath $docPath
        Assert-True ($docText -match "approval") "audit doc records approval gate"
        Assert-True ($docText -match "Hub session") "audit doc records Hub session evidence"
        Assert-True ($docText -match "target inventory") "audit doc records target inventory evidence"
        Assert-True ($docText -match "event replay") "audit doc records event replay evidence"
        Assert-True ($docText -match "No real login") "audit doc records no real login by verifier"
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
