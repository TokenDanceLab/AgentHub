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

function Invoke-RepoScript {
    param([string[]]$Arguments)

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "powershell"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $RepoRoot
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + (Join-NativeArguments $Arguments)

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
}

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try {
        return $listener.LocalEndpoint.Port
    }
    finally {
        $listener.Stop()
    }
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-localhost-observed-loop.ps1"
$scriptImplementationPath = Join-Path $RepoRoot "scripts\smoke\verify-localhost-observed-loop.ps1"
$docPath = Join-Path $RepoRoot "docs\audit\p1-localhost-observed-loop.md"
$webConfigPath = Join-Path $RepoRoot "app\web\playwright.config.ts"

Assert-True (Test-Path -LiteralPath $scriptPath) "localhost observed loop runner exists"
Assert-True (Test-Path -LiteralPath $scriptImplementationPath) "localhost observed loop runner implementation exists"
Assert-True (Test-Path -LiteralPath $docPath) "localhost observed loop audit doc exists"
Assert-True (Test-Path -LiteralPath $webConfigPath) "Web Playwright config exists"

try {
    $safeArtifactRoot = Join-Path $RepoRoot ".tmp\localhost-observed-loop\script-test-$PID"
    Remove-Item -LiteralPath $safeArtifactRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $safeArtifactRoot | Out-Null
    $TempRoots += $safeArtifactRoot

    if (Test-Path -LiteralPath $scriptImplementationPath) {
        $scriptText = Get-Content -Raw -LiteralPath $scriptImplementationPath
        Assert-True ($scriptText -match '\[ValidateSet\("ReadinessOnly", "FixtureManifest", "ApprovedReal"\)\]') "runner exposes ReadinessOnly, FixtureManifest, and ApprovedReal modes"
        Assert-True ($scriptText -match '5174' -and $scriptText -match '8080' -and $scriptText -match '5173' -and $scriptText -match '3210') "runner defines Web 5174, Hub 8080, Desktop 5173, and Local Edge 3210"
        Assert-True ($scriptText -match 'verify-observed-localhost-dispatch\.ps1') "runner delegates observed manifest validation"
        Assert-True ($scriptText -match 'verify-local-stack-e2e-readiness\.ps1') "runner composes local-stack readiness"
        Assert-True ($scriptText -match 'real_tested = \$false') "runner defaults RealTested to false"
        Assert-True ($scriptText -match 'Redact-SecretLike') "runner has a secret redaction boundary"
        Assert-True ($scriptText -match 'service_probe_manifest' -and $scriptText -match 'pid_manifest' -and $scriptText -match 'health_manifest') "runner records unified service probe, pid, and health manifests"
        Assert-True ($scriptText -match 'ExpectedHubMarker' -and $scriptText -match 'ExpectedEdgeMarker') "runner exposes service health identity markers"

        $staleFile = Join-Path $safeArtifactRoot "stale.txt"
        "stale" | Set-Content -LiteralPath $staleFile -Encoding UTF8
        $readinessEvidence = Join-Path $safeArtifactRoot "readiness.json"
        $secretNote = "Authorization: Bearer sk-testsecret1234567890"
        $readinessRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ArtifactRoot", $safeArtifactRoot,
            "-ManifestPath", $readinessEvidence,
            "-SuppliedEnvironmentNames", "AGENTHUB_WEB_URL,AGENTHUB_HUB_URL,AGENTHUB_DESKTOP_BRIDGE_URL,AGENTHUB_LOCAL_EDGE_URL,AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT",
            "-RunNote", $secretNote,
            "-CleanArtifactRoot"
        )
        Assert-True ($readinessRun.ExitCode -eq 0) "ReadinessOnly writes a no-spend manifest without live services" $readinessRun.Output
        Assert-True ($readinessRun.Output -match "READINESS_ONLY_MANIFEST_WRITTEN") "ReadinessOnly status is explicit" $readinessRun.Output
        Assert-True ($readinessRun.Output -match "RealTested=false") "ReadinessOnly output keeps RealTested false" $readinessRun.Output
        Assert-True ($readinessRun.Output -notmatch [regex]::Escape("sk-testsecret1234567890")) "stdout redacts secret-like input" $readinessRun.Output
        Assert-True (-not (Test-Path -LiteralPath $staleFile)) "CleanArtifactRoot removes stale files inside safe artifact root"

        $readinessJsonText = Get-Content -Raw -LiteralPath $readinessEvidence
        $readinessJson = $readinessJsonText | ConvertFrom-Json
        Assert-True ($readinessJson.schema -eq "agenthub-localhost-observed-loop-readiness-v1") "readiness manifest schema is explicit"
        Assert-True ($readinessJson.real_tested -eq $false) "readiness manifest keeps RealTested false"
        Assert-True ($readinessJson.topology.web_url -eq "http://127.0.0.1:5174") "readiness manifest records Web 5174"
        Assert-True ($readinessJson.topology.hub_url -eq "http://127.0.0.1:8080") "readiness manifest records Hub 8080"
        Assert-True ($readinessJson.topology.desktop_bridge_url -eq "http://127.0.0.1:5173") "readiness manifest records Desktop/Tauri bridge 5173"
        Assert-True ($readinessJson.topology.local_edge_url -eq "http://127.0.0.1:3210") "readiness manifest records Local Edge 3210"
        Assert-True ($readinessJson.chain.fixture_adapter -eq "fixture-sdk-adapter") "readiness manifest records fixture adapter"
        Assert-True ($readinessJson.chain.hub_replay -eq "required") "readiness manifest records Hub replay requirement"
        Assert-True ($readinessJson.chain.web_render -eq "transcript_approval_artifact") "readiness manifest records Web transcript/approval/artifact render"
        Assert-True ($readinessJson.paths.startup_log -and (Test-Path -LiteralPath $readinessJson.paths.startup_log)) "startup log path is recorded and exists"
        Assert-True ($readinessJson.paths.cleanup_log -and (Test-Path -LiteralPath $readinessJson.paths.cleanup_log)) "cleanup log path is recorded and exists"
        Assert-True ($readinessJson.paths.log_root -and (Test-Path -LiteralPath $readinessJson.paths.log_root)) "unified log root is recorded and exists"
        Assert-True ($readinessJson.paths.service_probe_manifest -and (Test-Path -LiteralPath $readinessJson.paths.service_probe_manifest)) "service probe manifest path is recorded and exists"
        Assert-True ($readinessJson.paths.pid_manifest -and (Test-Path -LiteralPath $readinessJson.paths.pid_manifest)) "pid manifest path is recorded and exists"
        Assert-True ($readinessJson.paths.health_manifest -and (Test-Path -LiteralPath $readinessJson.paths.health_manifest)) "health manifest path is recorded and exists"
        Assert-True ($readinessJson.service_probes.status -eq "NOT_REQUESTED") "default readiness does not probe services"
        Assert-True ($readinessJson.service_probes.start_services -eq $false) "default readiness does not start services"
        Assert-True ($readinessJson.service_probes.start_plan_path -eq "") "default readiness has no implicit start plan"
        Assert-True ($readinessJson.service_probes.cleanup.strategy -match "Remove-Item") "cleanup strategy is explicit"
        Assert-True ($readinessJsonText -notmatch [regex]::Escape("sk-testsecret1234567890")) "manifest redacts secret-like input"
        Assert-True ($readinessJsonText -match "<redacted") "manifest keeps explicit redaction marker"

        $defaultServiceProbe = Get-Content -Raw -LiteralPath $readinessJson.paths.service_probe_manifest | ConvertFrom-Json
        Assert-True ($defaultServiceProbe.status -eq "NOT_REQUESTED") "default service probe manifest records not-requested status"
        Assert-True ($defaultServiceProbe.real_tested -eq $false) "default service probe manifest keeps RealTested false"
        $defaultPidManifest = Get-Content -Raw -LiteralPath $readinessJson.paths.pid_manifest | ConvertFrom-Json
        Assert-True (@($defaultPidManifest.started_processes).Count -eq 0) "default pid manifest has no started processes"
        $defaultHealthManifest = Get-Content -Raw -LiteralPath $readinessJson.paths.health_manifest | ConvertFrom-Json
        Assert-True ($defaultHealthManifest.status -eq "NOT_REQUESTED") "default health manifest records not-requested status"

        $unsafeEvidence = Join-Path $safeArtifactRoot "unsafe.json"
        $unsafeRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ArtifactRoot", "docs\audit",
            "-ManifestPath", $unsafeEvidence
        )
        Assert-True ($unsafeRun.ExitCode -ne 0) "unsafe artifact root fails closed" $unsafeRun.Output
        Assert-True ($unsafeRun.Output -match "artifact root") "unsafe artifact root failure is explicit" $unsafeRun.Output

        $directEvidence = Join-Path $safeArtifactRoot "direct-edge.json"
        $directRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ArtifactRoot", $safeArtifactRoot,
            "-ManifestPath", $directEvidence,
            "-SuppliedEnvironmentNames", "AGENTHUB_WEB_URL,AGENTHUB_HUB_URL,AGENTHUB_DESKTOP_BRIDGE_URL,AGENTHUB_LOCAL_EDGE_URL,AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT",
            "-HubDispatchTargetUrl", "http://127.0.0.1:3210"
        )
        Assert-True ($directRun.ExitCode -ne 0) "direct Hub-to-LocalEdge dispatch target fails closed" $directRun.Output
        Assert-True ($directRun.Output -match "Hub dispatch target URL must point to Desktop bridge") "direct Hub-to-LocalEdge failure is explicit" $directRun.Output
        $directJson = Get-Content -Raw -LiteralPath $directEvidence | ConvertFrom-Json
        Assert-True ($directJson.real_tested -eq $false) "direct rejection manifest keeps RealTested false" ($directJson | ConvertTo-Json -Depth 8)

        $probeRoot = Join-Path $RepoRoot ".tmp\localhost-observed-loop\script-probe-test-$PID"
        Remove-Item -LiteralPath $probeRoot -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $probeRoot | Out-Null
        $TempRoots += $probeRoot
        $probeEvidence = Join-Path $probeRoot "probe-readiness.json"
        $probeWebPort = Get-FreePort
        $probeHubPort = Get-FreePort
        $probeDesktopPort = Get-FreePort
        $probeEdgePort = Get-FreePort
        $probeRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ArtifactRoot", $probeRoot,
            "-ManifestPath", $probeEvidence,
            "-SuppliedEnvironmentNames", "AGENTHUB_WEB_URL,AGENTHUB_HUB_URL,AGENTHUB_DESKTOP_BRIDGE_URL,AGENTHUB_LOCAL_EDGE_URL,AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT",
            "-ProbeServices",
            "-WebUrl", "http://127.0.0.1:$probeWebPort",
            "-HubUrl", "http://127.0.0.1:$probeHubPort",
            "-DesktopBridgeUrl", "http://127.0.0.1:$probeDesktopPort",
            "-LocalEdgeUrl", "http://127.0.0.1:$probeEdgePort",
            "-RegisteredTargetUrl", "http://127.0.0.1:$probeDesktopPort",
            "-HubDispatchTargetUrl", "http://127.0.0.1:$probeDesktopPort",
            "-ExpectedWebMarker", "agenthub-web-real-service-marker",
            "-ExpectedHubMarker", "agenthub-hub-real-service-marker",
            "-ExpectedDesktopMarker", "agenthub-desktop-bridge-real-service-marker",
            "-ExpectedEdgeMarker", "agenthub-local-edge-real-service-marker",
            "-TimeoutSec", "1"
        )
        Assert-True ($probeRun.ExitCode -ne 0) "ProbeServices fails closed when localhost services are missing" $probeRun.Output
        Assert-True ($probeRun.Output -match "missing service|localhost real-services readiness gate failed") "ProbeServices missing-service failure is explicit" $probeRun.Output
        $probeJsonText = Get-Content -Raw -LiteralPath $probeEvidence
        $probeJson = $probeJsonText | ConvertFrom-Json
        Assert-True ($probeJson.real_tested -eq $false) "ProbeServices manifest keeps RealTested false" ($probeJson | ConvertTo-Json -Depth 10)
        Assert-True ($probeJson.service_probes.status -eq "READINESS_ONLY_FAILED") "ProbeServices records readiness-only service failure" ($probeJson | ConvertTo-Json -Depth 10)
        Assert-True ($probeJson.service_probes.probe_services -eq $true) "ProbeServices manifest records probe opt-in"
        Assert-True ($probeJson.service_probes.start_services -eq $false) "ProbeServices manifest records no service startup"
        Assert-True ($probeJson.service_probes.expected_markers.hub -eq "agenthub-hub-real-service-marker") "ProbeServices manifest records Hub marker"
        Assert-True ($probeJson.service_probes.expected_markers.local_edge -eq "agenthub-local-edge-real-service-marker") "ProbeServices manifest records Local Edge marker"
        Assert-True ($probeJson.claims.real_tokendance_id_login -eq $false) "ProbeServices does not claim real TokenDanceID login"
        Assert-True ($probeJson.claims.real_cli_or_model_invoked_by_this_runner -eq $false) "ProbeServices does not claim real CLI/model execution"
        Assert-True ($probeJson.claims.real_api_budget_spend_by_this_runner -eq $false) "ProbeServices does not claim API-budget spend"
        Assert-True (Test-Path -LiteralPath $probeJson.paths.service_probe_manifest) "ProbeServices writes service probe manifest"
        Assert-True (Test-Path -LiteralPath $probeJson.paths.health_manifest) "ProbeServices writes health manifest"
        Assert-True (Test-Path -LiteralPath $probeJson.paths.pid_manifest) "ProbeServices writes pid manifest"
        $probeServiceManifest = Get-Content -Raw -LiteralPath $probeJson.paths.service_probe_manifest | ConvertFrom-Json
        Assert-True ($probeServiceManifest.real_tested -eq $false) "service probe manifest keeps RealTested false"
        Assert-True ($probeServiceManifest.no_real_tokendance_id_login -eq $true) "service probe manifest records no real login"
        $probeHealthManifest = Get-Content -Raw -LiteralPath $probeJson.paths.health_manifest | ConvertFrom-Json
        Assert-True (@($probeHealthManifest.services).Count -eq 4) "health manifest records Web, Hub, Desktop bridge, and Local Edge probes"
        $probePidManifest = Get-Content -Raw -LiteralPath $probeJson.paths.pid_manifest | ConvertFrom-Json
        Assert-True (@($probePidManifest.started_processes).Count -eq 0) "ProbeServices pid manifest has no started processes"

        $fixtureManifestPath = Join-Path $safeArtifactRoot "observed-dispatch-fixture.json"
        $fixtureReportPath = Join-Path $safeArtifactRoot "observed-dispatch-report.json"
        $fixtureRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "FixtureManifest",
            "-ArtifactRoot", $safeArtifactRoot,
            "-ManifestPath", $fixtureManifestPath,
            "-ObservedDispatchReportPath", $fixtureReportPath
        )
        Assert-True ($fixtureRun.ExitCode -eq 0) "FixtureManifest writes and validates agenthub-observed-localhost-dispatch-v1" $fixtureRun.Output
        $fixtureJson = Get-Content -Raw -LiteralPath $fixtureManifestPath | ConvertFrom-Json
        Assert-True ($fixtureJson.schema -eq "agenthub-observed-localhost-dispatch-v1") "fixture manifest uses observed localhost dispatch schema"
        Assert-True ($fixtureJson.real_tested -eq $false) "fixture observed manifest keeps RealTested false"
        Assert-True ($fixtureJson.target_registration.desktop_bridge_url -eq "http://127.0.0.1:5173") "fixture observed manifest dispatches through Desktop bridge"
        Assert-True ($fixtureJson.desktop_accept.local_edge_url -eq "http://127.0.0.1:3210") "fixture observed manifest hands off to Local Edge"
        Assert-True ($fixtureJson.edge_run.adapter_id -eq "fixture-sdk-adapter") "fixture observed manifest uses fixture adapter"
        Assert-True ($fixtureJson.web_render.render_source -eq "hub-replay") "fixture observed manifest records Web render from Hub replay"
        $fixtureReport = Get-Content -Raw -LiteralPath $fixtureReportPath | ConvertFrom-Json
        Assert-True ($fixtureReport.status -eq "OBSERVED_DISPATCH_PASSED") "observed dispatch verifier accepts fixture manifest"
        Assert-True ($fixtureReport.real_tested -eq $false) "observed dispatch report keeps RealTested false"
    }

    if (Test-Path -LiteralPath $docPath) {
        $docText = Get-Content -Raw -LiteralPath $docPath
        Assert-True ($docText -match "verify-localhost-observed-loop\.ps1") "audit doc names the runner command"
        Assert-True ($docText -match "agenthub-observed-localhost-dispatch-v1") "audit doc names observed manifest schema"
        Assert-True ($docText -match "readiness-only") "audit doc explains readiness-only mode"
        Assert-True ($docText -match "approved-real") "audit doc explains approved-real prerequisites"
        Assert-True ($docText -match "does not perform real TokenDanceID login") "audit doc names real-login non-goal"
        Assert-True ($docText -match "does not invoke real CLI/model") "audit doc names real CLI/model non-goal"
        Assert-True ($docText -match "service probe manifest" -and $docText -match "pid manifest" -and $docText -match "health manifest") "audit doc records unified service manifests"
        Assert-True ($docText -match "ProbeServices" -and $docText -match "StartServices") "audit doc explains service probe and explicit start modes"
        Assert-True ($docText -match "\.tmp\\localhost-observed-loop") "audit doc records evidence path"
    }

    if (Test-Path -LiteralPath $webConfigPath) {
        $webConfig = Get-Content -Raw -LiteralPath $webConfigPath
        Assert-True ($webConfig -match "5174") "Web Playwright config uses Web port 5174"
        Assert-True ($webConfig -notmatch "5173") "Web Playwright config no longer uses Desktop port 5173"
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
