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
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
    $listener.Start()
    try {
        return $listener.LocalEndpoint.Port
    }
    finally {
        $listener.Stop()
    }
}

$scriptPath = Join-Path $RepoRoot "scripts\verify-local-stack-e2e-readiness.ps1"
$scriptImplementationPath = Join-Path $RepoRoot "scripts\smoke\verify-local-stack-e2e-readiness.ps1"
$docPath = Join-Path $RepoRoot "docs\audit\p1-local-stack-e2e-runner.md"

Assert-True (Test-Path -LiteralPath $scriptPath) "local stack E2E readiness script exists"
Assert-True (Test-Path -LiteralPath $scriptImplementationPath) "local stack E2E readiness script implementation exists"
Assert-True (Test-Path -LiteralPath $docPath) "local stack E2E readiness audit doc exists"

try {
    $tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-local-stack-e2e-test-$PID"
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
    $TempRoots += $tmpRoot
    $safeArtifactRoot = Join-Path $RepoRoot ".tmp\local-stack-e2e-readiness\script-test-$PID"
    Remove-Item -LiteralPath $safeArtifactRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $safeArtifactRoot | Out-Null
    $TempRoots += $safeArtifactRoot

    if (Test-Path -LiteralPath $scriptImplementationPath) {
        $scriptText = Get-Content -Raw -LiteralPath $scriptImplementationPath
        Assert-True ($scriptText -match '\[ValidateSet\("FixtureOnly", "ReadinessOnly", "ApprovedReal"\)\]') "script distinguishes FixtureOnly, ReadinessOnly, and ApprovedReal"
        Assert-True ($scriptText -match 'verify-localhost-product-loop\.ps1') "script composes localhost product-loop fixture gate"
        Assert-True ($scriptText -match 'verify-localhost-real-services\.ps1') "script composes localhost real-services readiness gate"
        Assert-True ($scriptText -match 'verify-login-e2e-readiness\.ps1') "script composes login readiness approval gate"
        Assert-True ($scriptText -match 'verify-edge-cli-real-readiness\.ps1') "script composes Edge CLI readiness gate"
        Assert-True ($scriptText -match 'verify-observed-localhost-dispatch\.ps1') "script composes observed dispatch gate for ApprovedReal"
        Assert-True ($scriptText -match 'real_tested = \$false') "script defaults RealTested to false"

        $implicitDefaultRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot
        )
        Assert-True ($implicitDefaultRun.ExitCode -ne 0) "omitted EvidencePath still fails closed on missing prerequisites" $implicitDefaultRun.Output
        Assert-True ($implicitDefaultRun.Output -match "default EvidencePath uses the process temp directory") "omitted EvidencePath uses default temp behavior" $implicitDefaultRun.Output
        Assert-True ($implicitDefaultRun.Output -match "agenthub-local-stack-e2e-readiness-") "omitted EvidencePath keeps default filename prefix" $implicitDefaultRun.Output
        $implicitDefaultPath = ""
        if ($implicitDefaultRun.Output -match "EvidencePath:\s*(.+)") {
            $implicitDefaultPath = $Matches[1].Trim()
            Remove-Item -LiteralPath $implicitDefaultPath -Force -ErrorAction SilentlyContinue
        }

        $defaultEvidence = Join-Path $safeArtifactRoot "default.json"
        $defaultRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $defaultEvidence,
            "-ArtifactRoot", $safeArtifactRoot
        )
        Assert-True ($defaultRun.ExitCode -ne 0) "default readiness run fails closed" $defaultRun.Output
        Assert-True ($defaultRun.Output -match "LOCAL_STACK_E2E_READINESS_FAILED") "default failure reports readiness failed" $defaultRun.Output
        $defaultJson = Get-Content -Raw -LiteralPath $defaultEvidence | ConvertFrom-Json
        Assert-True ($defaultJson.real_tested -eq $false) "default failure keeps RealTested false" ($defaultJson | ConvertTo-Json -Depth 8)
        Assert-True ($defaultJson.mode -eq "ReadinessOnly") "default mode is ReadinessOnly" ($defaultJson | ConvertTo-Json -Depth 8)

        $unsafeArtifactEvidence = Join-Path $safeArtifactRoot "unsafe-artifact.json"
        $unsafeArtifactRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $unsafeArtifactEvidence,
            "-ArtifactRoot", "docs\audit"
        )
        Assert-True ($unsafeArtifactRun.ExitCode -ne 0) "unsafe artifact root fails closed" $unsafeArtifactRun.Output
        Assert-True ($unsafeArtifactRun.Output -match "artifact root") "unsafe artifact root failure is explicit" $unsafeArtifactRun.Output
        $unsafeArtifactJson = Get-Content -Raw -LiteralPath $unsafeArtifactEvidence | ConvertFrom-Json
        Assert-True ($unsafeArtifactJson.real_tested -eq $false) "unsafe artifact evidence keeps RealTested false" ($unsafeArtifactJson | ConvertTo-Json -Depth 8)

        $missingEnvEvidence = Join-Path $safeArtifactRoot "missing-env.json"
        $missingEnvRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $missingEnvEvidence,
            "-ArtifactRoot", ".tmp\local-stack-e2e-readiness\missing-env"
        )
        Assert-True ($missingEnvRun.ExitCode -ne 0) "missing required environment names fail closed" $missingEnvRun.Output
        Assert-True ($missingEnvRun.Output -match "required environment name missing") "missing env failure is explicit" $missingEnvRun.Output
        $missingEnvJson = Get-Content -Raw -LiteralPath $missingEnvEvidence | ConvertFrom-Json
        Assert-True ($missingEnvJson.real_tested -eq $false) "missing env evidence keeps RealTested false" ($missingEnvJson | ConvertTo-Json -Depth 8)

        $missingPort = Get-FreePort
        $allEnvNames = @(
            "AGENTHUB_WEB_URL",
            "AGENTHUB_HUB_URL",
            "AGENTHUB_DESKTOP_BRIDGE_URL",
            "AGENTHUB_LOCAL_EDGE_URL",
            "AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT"
        )
        $outsideEvidencePath = Join-Path $tmpRoot "outside-evidence.json"
        $outsideEvidenceRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $outsideEvidencePath,
            "-ArtifactRoot", $safeArtifactRoot
        )
        Assert-True ($outsideEvidenceRun.ExitCode -ne 0) "EvidencePath outside allowed roots fails closed" $outsideEvidenceRun.Output
        Assert-True ($outsideEvidenceRun.Output -match "EvidencePath") "outside EvidencePath failure is explicit" $outsideEvidenceRun.Output
        Assert-True (-not (Test-Path -LiteralPath $outsideEvidencePath)) "outside EvidencePath is not written"

        $siblingEvidencePath = Join-Path $RepoRoot ".tmp\local-stack-e2e-readiness-sibling\report.json"
        Remove-Item -LiteralPath $siblingEvidencePath -Force -ErrorAction SilentlyContinue
        $siblingEvidenceRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $siblingEvidencePath,
            "-ArtifactRoot", $safeArtifactRoot
        )
        Assert-True ($siblingEvidenceRun.ExitCode -ne 0) "EvidencePath sibling-prefix path fails closed" $siblingEvidenceRun.Output
        Assert-True ($siblingEvidenceRun.Output -match "EvidencePath") "sibling EvidencePath failure is explicit" $siblingEvidenceRun.Output
        Assert-True (-not (Test-Path -LiteralPath $siblingEvidencePath)) "sibling EvidencePath is not written"

        $traversalEvidencePath = Join-Path $safeArtifactRoot "..\..\docs\audit\evidence-traversal.json"
        $traversalResolvedPath = [System.IO.Path]::GetFullPath($traversalEvidencePath)
        Remove-Item -LiteralPath $traversalResolvedPath -Force -ErrorAction SilentlyContinue
        $traversalEvidenceRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $traversalEvidencePath,
            "-ArtifactRoot", $safeArtifactRoot
        )
        Assert-True ($traversalEvidenceRun.ExitCode -ne 0) "EvidencePath traversal outside artifact root fails closed" $traversalEvidenceRun.Output
        Assert-True ($traversalEvidenceRun.Output -match "EvidencePath") "traversal EvidencePath failure is explicit" $traversalEvidenceRun.Output
        Assert-True (-not (Test-Path -LiteralPath $traversalResolvedPath)) "traversal EvidencePath is not written"

        $missingServiceEvidence = Join-Path $safeArtifactRoot "missing-service.json"
        $envNameList = $allEnvNames -join ","
        $missingServiceArgs = @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $missingServiceEvidence,
            "-ArtifactRoot", ".tmp\local-stack-e2e-readiness\missing-service",
            "-SuppliedEnvironmentNames", $envNameList,
            "-ProbeServices",
            "-WebUrl", "http://127.0.0.1:$missingPort",
            "-HubUrl", "http://127.0.0.1:$missingPort",
            "-DesktopBridgeUrl", "http://127.0.0.1:$missingPort",
            "-LocalEdgeUrl", "http://127.0.0.1:$missingPort",
            "-RegisteredTargetUrl", "http://127.0.0.1:$missingPort",
            "-HubDispatchTargetUrl", "http://127.0.0.1:$missingPort",
            "-ExpectedWebMarker", "agenthub-web-real-service-marker",
            "-ExpectedHubMarker", "agenthub-hub-real-service-marker",
            "-ExpectedDesktopMarker", "agenthub-desktop-bridge-real-service-marker",
            "-ExpectedEdgeMarker", "agenthub-local-edge-real-service-marker",
            "-TimeoutSec", "1"
        )
        $missingServiceRun = Invoke-RepoScript $missingServiceArgs
        Assert-True ($missingServiceRun.ExitCode -ne 0) "missing localhost services fail closed" $missingServiceRun.Output
        Assert-True ($missingServiceRun.Output -match "missing service") "missing service failure is explicit" $missingServiceRun.Output
        $missingServiceJson = Get-Content -Raw -LiteralPath $missingServiceEvidence | ConvertFrom-Json
        Assert-True ($missingServiceJson.real_tested -eq $false) "missing service evidence keeps RealTested false" ($missingServiceJson | ConvertTo-Json -Depth 8)

        $directEdgeEvidence = Join-Path $safeArtifactRoot "direct-edge.json"
        $directEdgeArgs = @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $directEdgeEvidence,
            "-ArtifactRoot", ".tmp\local-stack-e2e-readiness\direct-edge",
            "-SuppliedEnvironmentNames", $envNameList,
            "-WebUrl", "http://localhost:3210/v1/runs",
            "-HubUrl", "http://127.0.0.1:8080",
            "-DesktopBridgeUrl", "http://127.0.0.1:5173",
            "-LocalEdgeUrl", "http://127.0.0.1:3210"
        )
        $directEdgeRun = Invoke-RepoScript $directEdgeArgs
        Assert-True ($directEdgeRun.ExitCode -ne 0) "direct Web-to-LocalEdge topology fails closed" $directEdgeRun.Output
        Assert-True ($directEdgeRun.Output -match "Web URL must not point directly at Local Edge") "direct Web-to-LocalEdge failure is explicit" $directEdgeRun.Output
        $directEdgeJson = Get-Content -Raw -LiteralPath $directEdgeEvidence | ConvertFrom-Json
        Assert-True ($directEdgeJson.topology.web_to_local_edge_direct -eq $true) "direct topology is recorded in evidence" ($directEdgeJson | ConvertTo-Json -Depth 8)
        Assert-True ($directEdgeJson.real_tested -eq $false) "direct topology evidence keeps RealTested false" ($directEdgeJson | ConvertTo-Json -Depth 8)

        $fixtureEvidence = Join-Path $safeArtifactRoot "fixture-only.json"
        $fixtureRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-EvidencePath", $fixtureEvidence,
            "-Mode", "FixtureOnly",
            "-ArtifactRoot", ".tmp\local-stack-e2e-readiness\fixture"
        )
        Assert-True ($fixtureRun.ExitCode -eq 0) "FixtureOnly mode passes by running fixture product-loop harness" $fixtureRun.Output
        Assert-True ($fixtureRun.Output -match "FIXTURE_ONLY_PASSED") "FixtureOnly mode reports fixture-only status" $fixtureRun.Output
        $fixtureJson = Get-Content -Raw -LiteralPath $fixtureEvidence | ConvertFrom-Json
        Assert-True ($fixtureJson.mode -eq "FixtureOnly") "fixture evidence records FixtureOnly mode" ($fixtureJson | ConvertTo-Json -Depth 8)
        Assert-True ($fixtureJson.real_tested -eq $false) "fixture evidence keeps RealTested false" ($fixtureJson | ConvertTo-Json -Depth 8)
    }

    if (Test-Path -LiteralPath $docPath) {
        $docText = Get-Content -Raw -LiteralPath $docPath
        Assert-True ($docText -match "FixtureOnly") "audit doc explains FixtureOnly"
        Assert-True ($docText -match "ReadinessOnly") "audit doc explains ReadinessOnly"
        Assert-True ($docText -match "ApprovedReal") "audit doc explains ApprovedReal"
        Assert-True ($docText -match "does not prove real TokenDanceID login") "audit doc names real login non-proof"
        Assert-True ($docText -match "does not prove real CLI/model") "audit doc names real CLI/model non-proof"
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
