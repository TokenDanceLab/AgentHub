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

function Get-Segment {
    param($Report, [string]$Name)
    return @($Report.segments | Where-Object { $_.name -eq $Name } | Select-Object -First 1)[0]
}

function Get-EventIndex {
    param($Evidence, [string]$Type)
    $events = @($Evidence.events)
    for ($i = 0; $i -lt $events.Count; $i++) {
        if ($events[$i].type -eq $Type) {
            return $i
        }
    }
    return -1
}

$scriptPath = Join-Path $RepoRoot "scripts\smoke\verify-p0-local-product-loop-evidence.ps1"
$scriptImplementationPath = Join-Path $RepoRoot "scripts\smoke\verify-p0-local-product-loop-evidence.ps1"
$docPath = Join-Path $RepoRoot "docs\audit\p0-local-product-loop-evidence.md"

Assert-True (Test-Path -LiteralPath $scriptPath) "P0 local product-loop evidence runner exists"
Assert-True (Test-Path -LiteralPath $scriptImplementationPath) "P0 local product-loop evidence runner implementation exists"
Assert-True (Test-Path -LiteralPath $docPath) "P0 local product-loop audit doc exists"

try {
    $safeArtifactRoot = Join-Path $RepoRoot ".tmp\p0-local-product-loop-evidence\script-test-$PID"
    Remove-Item -LiteralPath $safeArtifactRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $safeArtifactRoot | Out-Null
    $TempRoots += $safeArtifactRoot

    if (Test-Path -LiteralPath $scriptImplementationPath) {
        $scriptText = Get-Content -Raw -LiteralPath $scriptImplementationPath
        Assert-True ($scriptText -match '\[ValidateSet\("FixtureOnly", "ApprovedRealReview"\)\]') "runner distinguishes FixtureOnly and ApprovedRealReview"
        Assert-True ($scriptText -match 'verify-localhost-product-loop\.ps1') "runner composes localhost product-loop fixture harness"
        Assert-True ($scriptText -match 'verify-observed-localhost-dispatch\.ps1') "runner can review observed dispatch manifest"
        Assert-True ($scriptText -match 'public_deploy_signing_push_merge_or_tag = \$false') "runner records deploy/signing/push/merge/tag non-goal"

        $evidencePath = Join-Path $safeArtifactRoot "sanitized-evidence.json"
        $fixtureRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ArtifactRoot", $safeArtifactRoot,
            "-EvidencePath", $evidencePath
        )
        Assert-True ($fixtureRun.ExitCode -eq 0) "P0 local product-loop runner passes in FixtureOnly mode" $fixtureRun.Output
        Assert-True ($fixtureRun.Output -match "P0_LOCAL_PRODUCT_LOOP_FIXTURE_PASSED") "FixtureOnly status is explicit" $fixtureRun.Output
        Assert-True ($fixtureRun.Output -match "Web renders Hub replay") "FixtureOnly output names Web render" $fixtureRun.Output
        Assert-True (Test-Path -LiteralPath $evidencePath) "sanitized evidence report is written"

        $report = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
        Assert-True ($report.schema -eq "agenthub-p0-local-product-loop-evidence-v1") "report schema is P0 local product-loop evidence v1"
        Assert-True ($report.status -eq "P0_LOCAL_PRODUCT_LOOP_FIXTURE_PASSED") "report status records fixture pass"
        Assert-True ($report.real_tested -eq $false) "report keeps RealTested false"
        Assert-True ($report.sanitized -eq $true) "report marks sanitized evidence"
        Assert-True ($report.claims.real_tokendance_id_login -eq $false) "report does not claim real TokenDanceID login"
        Assert-True ($report.claims.real_cli_or_model_invoked_by_this_runner -eq $false) "report does not claim real CLI/model invocation"
        Assert-True ($report.claims.public_deploy_signing_push_merge_or_tag -eq $false) "report keeps deploy/signing/push/merge/tag out of scope"
        Assert-True ($report.boundaries.web.upstream -eq "hub-only") "report records Web Hub-only boundary"
        Assert-True ($report.boundaries.web.direct_local_edge -eq "rejected") "report records direct Local Edge rejection boundary"
        Assert-True ($report.boundaries.desktop.bridge -eq "tauri-sidecar-fixture") "report records Desktop sidecar fixture"
        Assert-True ($report.boundaries.local_edge.adapter -eq "fixture-sdk") "report records fixture adapter"

        foreach ($segmentName in @(
            "web_to_hub",
            "hub_to_registered_desktop_bridge",
            "desktop_local_edge_sidecar",
            "local_edge_fixture_adapter",
            "hub_replay",
            "web_render"
        )) {
            $segment = Get-Segment $report $segmentName
            Assert-True ($null -ne $segment) "report includes segment $segmentName" ($report | ConvertTo-Json -Depth 12)
            if ($segment) {
                Assert-True ($segment.status -eq "PASS") "segment $segmentName passes" ($segment | ConvertTo-Json -Depth 8)
            }
        }

        $fixtureEvidencePath = $report.sources.fixture_product_loop.evidence_path
        Assert-True (Test-Path -LiteralPath $fixtureEvidencePath) "fixture source evidence remains available"
        if (Test-Path -LiteralPath $fixtureEvidencePath) {
            $fixtureEvidence = Get-Content -Raw -LiteralPath $fixtureEvidencePath | ConvertFrom-Json
            Assert-True ($fixtureEvidence.sequence -match "Web render") "fixture source evidence sequence includes Web render" ($fixtureEvidence | ConvertTo-Json -Depth 8)
            Assert-True ((Get-EventIndex $fixtureEvidence "web.replay.rendered") -gt (Get-EventIndex $fixtureEvidence "hub.replay.recorded")) "fixture source renders after Hub replay" ($fixtureEvidence.events | ConvertTo-Json -Depth 8)
        }

        $unsafeEvidence = Join-Path $safeArtifactRoot "unsafe-root.json"
        $unsafeRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ArtifactRoot", "docs\audit",
            "-EvidencePath", $unsafeEvidence
        )
        Assert-True ($unsafeRun.ExitCode -ne 0) "unsafe ArtifactRoot fails closed" $unsafeRun.Output
        Assert-True ($unsafeRun.Output -match "artifact root must stay under") "unsafe ArtifactRoot failure is explicit" $unsafeRun.Output

        $outsideEvidence = Join-Path $RepoRoot ".tmp\p0-local-product-loop-evidence-sibling\report.json"
        Remove-Item -LiteralPath $outsideEvidence -Force -ErrorAction SilentlyContinue
        $outsideRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-ArtifactRoot", $safeArtifactRoot,
            "-EvidencePath", $outsideEvidence
        )
        Assert-True ($outsideRun.ExitCode -ne 0) "EvidencePath outside ArtifactRoot fails closed" $outsideRun.Output
        Assert-True ($outsideRun.Output -match "EvidencePath must stay inside ArtifactRoot") "outside EvidencePath failure is explicit" $outsideRun.Output
        Assert-True (-not (Test-Path -LiteralPath $outsideEvidence)) "outside EvidencePath is not written"

        $approvedEvidence = Join-Path $safeArtifactRoot "approved-missing.json"
        $approvedRun = Invoke-RepoScript @(
            $scriptPath,
            "-RepoRoot", $RepoRoot,
            "-Mode", "ApprovedRealReview",
            "-ArtifactRoot", $safeArtifactRoot,
            "-EvidencePath", $approvedEvidence
        )
        Assert-True ($approvedRun.ExitCode -ne 0) "ApprovedRealReview without approval/manifest fails closed" $approvedRun.Output
        Assert-True ($approvedRun.Output -match "ApprovedRealReview requires -ApproveRealEvidence") "missing approval failure is explicit" $approvedRun.Output
        Assert-True ($approvedRun.Output -match "ApprovedRealReview requires -ObservedEvidencePath") "missing observed manifest failure is explicit" $approvedRun.Output
        $approvedReport = Get-Content -Raw -LiteralPath $approvedEvidence | ConvertFrom-Json
        Assert-True ($approvedReport.real_tested -eq $false) "failed ApprovedRealReview keeps RealTested false" ($approvedReport | ConvertTo-Json -Depth 8)
        Assert-True ($approvedReport.approved_real_requirements.observed_manifest_schema -eq "agenthub-observed-localhost-dispatch-v1") "report names observed manifest schema requirement" ($approvedReport | ConvertTo-Json -Depth 8)
    }

    if (Test-Path -LiteralPath $docPath) {
        $docText = Get-Content -Raw -LiteralPath $docPath
        Assert-True ($docText -match "Web -> Hub -> Desktop Local Edge sidecar -> fixture/CLI adapter -> Hub replay -> Web render") "audit doc states complete local product-loop sequence"
        Assert-True ($docText -match "ApprovedRealReview") "audit doc documents ApprovedRealReview"
        Assert-True ($docText -match "does not perform real TokenDanceID login") "audit doc names real-login non-goal"
        Assert-True ($docText -match "does not invoke a real CLI/model") "audit doc names real CLI/model non-goal"
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
