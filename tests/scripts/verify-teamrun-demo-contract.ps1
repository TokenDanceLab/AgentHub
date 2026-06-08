param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path
$Failed = 0

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

function Resolve-RepoPath([string]$RelativePath) {
    return Join-Path $RepoRoot $RelativePath
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

$scenarioPath = Resolve-RepoPath "docs\competition\teamrun-demo-scenario.json"
$exporterPath = Resolve-RepoPath "scripts\export-teamrun-demo-fixture-evidence.ps1"
$packagePath = Resolve-RepoPath "scripts\package-teamrun-demo-evidence.ps1"
$readinessPath = Resolve-RepoPath "scripts\verify-teamrun-demo-readiness.ps1"

Assert-True (Test-Path -LiteralPath $scenarioPath) "TeamRun demo scenario manifest exists"
Assert-True (Test-Path -LiteralPath $exporterPath) "TeamRun fixture evidence exporter exists"
Assert-True (Test-Path -LiteralPath $packagePath) "TeamRun evidence package script exists"
Assert-True (Test-Path -LiteralPath $readinessPath) "TeamRun readiness checker exists"

if (Test-Path -LiteralPath $scenarioPath) {
    $scenario = Get-Content -Raw -LiteralPath $scenarioPath | ConvertFrom-Json
    Assert-True ($scenario.contract -eq "teamrun-demo-evidence-v1") "scenario declares the frozen evidence contract"
    Assert-True ($scenario.fixture_only -eq $true) "scenario is explicitly fixture-only"
    Assert-True ($scenario.claims.real_runtime_executed -eq $false) "scenario does not claim real runtime execution"
    Assert-True ($scenario.claims.final_recording_complete -eq $false) "scenario does not claim the final demo recording"
    Assert-True ($scenario.claims.submission_ready -eq $false) "scenario does not claim submission readiness"
    Assert-True ($null -ne $scenario.manifest_schema) "scenario declares manifest schema metadata"
    Assert-True ($null -ne $scenario.screenshot_or_video_rehearsal) "scenario declares screenshot/video rehearsal metadata"
    Assert-True ($scenario.screenshot_or_video_rehearsal.real_runtime_executed -eq $false) "rehearsal metadata does not claim real runtime execution"
    Assert-True ($scenario.screenshot_or_video_rehearsal.final_recording_complete -eq $false) "rehearsal metadata does not claim final recording completion"
    Assert-True ($scenario.screenshot_or_video_rehearsal.submission_ready -eq $false) "rehearsal metadata does not claim submission readiness"

    $runtimeTypes = @($scenario.runtime_profiles | ForEach-Object { $_.runtime_type } | Where-Object { $_ } | Sort-Object -Unique).Count
    Assert-True ($runtimeTypes -ge 2) "scenario includes at least two runtime types" "runtime_types=$runtimeTypes"

    foreach ($field in @("state", "tasks", "assignments", "events", "runtime_profiles", "screenshot_or_video_rehearsal")) {
        Assert-True (@($scenario.required_evidence_fields) -contains $field) "scenario requires evidence field $field"
    }
}

if ((Test-Path -LiteralPath $scenarioPath) -and (Test-Path -LiteralPath $exporterPath)) {
    $tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-teamrun-contract-$PID"
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null

    $export = Invoke-RepoScript @(
        $exporterPath,
        "-ScenarioManifest", $scenarioPath,
        "-OutputRoot", $tmpRoot,
        "-Stamp", "contract-test"
    )
    Assert-True ($export.ExitCode -eq 0) "fixture exporter exits successfully" $export.Output

    $exportDir = Join-Path $tmpRoot "teamrun-demo-contract-test"
    $evidencePath = Join-Path $exportDir "teamrun-evidence.json"
    $manifestPath = Join-Path $exportDir "manifest.md"
    Assert-True (Test-Path -LiteralPath $evidencePath) "fixture exporter writes teamrun-evidence.json"
    Assert-True (Test-Path -LiteralPath $manifestPath) "fixture exporter writes package manifest"

    if (Test-Path -LiteralPath $evidencePath) {
        $evidence = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
        Assert-True ($evidence.source.fixture_only -eq $true) "exported evidence is marked fixture-only"
        Assert-True ($evidence.claims.real_runtime_executed -eq $false) "exported evidence does not claim real runtime execution"
        Assert-True ($evidence.claims.final_recording_complete -eq $false) "exported evidence does not claim final recording completion"
        Assert-True ($evidence.claims.submission_ready -eq $false) "exported evidence does not claim submission readiness"
        Assert-True ([int]$evidence.counts.runtime_types -ge 2) "exported evidence proves at least two runtime types"
        Assert-True (@($evidence.events | ForEach-Object { $_.type }) -contains "team.route.decided") "exported evidence includes route decision event"
        Assert-True (@($evidence.tasks | ForEach-Object { $_.role }) -contains "worker") "exported evidence includes worker task"
        Assert-True ($null -ne $evidence.screenshot_or_video_rehearsal) "exported evidence includes screenshot/video rehearsal metadata"
    }

    $submissionReadiness = Invoke-RepoScript @(
        $readinessPath,
        "-EvidencePath", $evidencePath,
        "-ManifestPath", $manifestPath
    )
    Assert-True ($submissionReadiness.ExitCode -ne 0) "readiness checker rejects fixture evidence in default submission mode" $submissionReadiness.Output
    Assert-True ($submissionReadiness.Output -match "submission mode rejects fixture-only evidence") "readiness checker names the submission fixture block" $submissionReadiness.Output

    $rehearsalReadiness = Invoke-RepoScript @(
        $readinessPath,
        "-EvidencePath", $evidencePath,
        "-ManifestPath", $manifestPath,
        "-Mode", "FixtureRehearsal"
    )
    Assert-True ($rehearsalReadiness.ExitCode -eq 0) "readiness checker accepts honest fixture evidence in rehearsal mode" $rehearsalReadiness.Output
    Assert-True ($rehearsalReadiness.Output -match "fixture rehearsal mode accepts honest fixture claims") "readiness checker reports rehearsal-only contract" $rehearsalReadiness.Output

    if (Test-Path -LiteralPath $evidencePath) {
        $badEvidencePath = Join-Path $exportDir "teamrun-evidence-mislabelled.json"
        $badEvidence = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
        $badEvidence.claims.real_runtime_executed = $true
        $badEvidence.claims.final_recording_complete = $true
        $badEvidence.claims.submission_ready = $true
        $badEvidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $badEvidencePath -Encoding UTF8

        $badReadiness = Invoke-RepoScript @(
            $readinessPath,
            "-EvidencePath", $badEvidencePath,
            "-Mode", "FixtureRehearsal"
        )
        Assert-True ($badReadiness.ExitCode -ne 0) "readiness checker rejects mislabelled fixture claims" $badReadiness.Output
        Assert-True ($badReadiness.Output -match "fixture evidence cannot claim real runtime") "readiness checker reports mislabelled fixture claims" $badReadiness.Output
    }

    if (Test-Path -LiteralPath $packagePath) {
        $packageRoot = Join-Path $tmpRoot "package"
        $packageRun = Invoke-RepoScript @(
            $packagePath,
            "-EvidencePath", $evidencePath,
            "-OutputRoot", $packageRoot,
            "-Stamp", "contract-test-package"
        )
        Assert-True ($packageRun.ExitCode -eq 0) "package script writes fixture rehearsal package" $packageRun.Output
        $packageManifest = Join-Path $packageRoot "teamrun-demo-contract-test-package\manifest.md"
        Assert-True (Test-Path -LiteralPath $packageManifest) "package script writes fixture rehearsal manifest"
        if (Test-Path -LiteralPath $packageManifest) {
            $packageManifestText = Get-Content -Raw -LiteralPath $packageManifest
            Assert-True ($packageManifestText -match "Package mode: FixtureRehearsal") "package manifest labels fixture rehearsal mode"
            Assert-True ($packageManifestText -match "submission_ready: False") "package manifest keeps submission_ready false"
        }

        $packageSubmissionRun = Invoke-RepoScript @(
            $packagePath,
            "-EvidencePath", $evidencePath,
            "-OutputRoot", (Join-Path $tmpRoot "package-submission"),
            "-Stamp", "contract-test-submission",
            "-PackageMode", "Submission"
        )
        Assert-True ($packageSubmissionRun.ExitCode -ne 0) "package script rejects fixture evidence in Submission mode" $packageSubmissionRun.Output
        Assert-True ($packageSubmissionRun.Output -match "fixture evidence cannot be packaged in Submission mode") "package script reports submission fixture block" $packageSubmissionRun.Output
    }
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
