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
$readinessPath = Resolve-RepoPath "scripts\verify-teamrun-demo-readiness.ps1"

Assert-True (Test-Path -LiteralPath $scenarioPath) "TeamRun demo scenario manifest exists"
Assert-True (Test-Path -LiteralPath $exporterPath) "TeamRun fixture evidence exporter exists"
Assert-True (Test-Path -LiteralPath $readinessPath) "TeamRun readiness checker exists"

if (Test-Path -LiteralPath $scenarioPath) {
    $scenario = Get-Content -Raw -LiteralPath $scenarioPath | ConvertFrom-Json
    Assert-True ($scenario.contract -eq "teamrun-demo-evidence-v1") "scenario declares the frozen evidence contract"
    Assert-True ($scenario.fixture_only -eq $true) "scenario is explicitly fixture-only"
    Assert-True ($scenario.claims.real_runtime_executed -eq $false) "scenario does not claim real runtime execution"
    Assert-True ($scenario.claims.final_recording_complete -eq $false) "scenario does not claim the final demo recording"

    $runtimeTypes = @($scenario.agent_profiles | ForEach-Object { $_.runtime_type } | Where-Object { $_ } | Sort-Object -Unique).Count
    Assert-True ($runtimeTypes -ge 2) "scenario includes at least two runtime types" "runtime_types=$runtimeTypes"

    foreach ($field in @("state", "tasks", "assignments", "events", "runtime_profiles")) {
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
        Assert-True ([int]$evidence.counts.runtime_types -ge 2) "exported evidence proves at least two runtime types"
        Assert-True (@($evidence.events | ForEach-Object { $_.type }) -contains "team.route.decided") "exported evidence includes route decision event"
        Assert-True (@($evidence.tasks | ForEach-Object { $_.role }) -contains "worker") "exported evidence includes worker task"
    }

    $readiness = Invoke-RepoScript @(
        $readinessPath,
        "-EvidencePath", $evidencePath,
        "-ManifestPath", $manifestPath
    )
    Assert-True ($readiness.ExitCode -eq 0) "readiness checker accepts exported fixture evidence" $readiness.Output
    Assert-True ($readiness.Output -match "fixture-only evidence contract") "readiness checker reports fixture-only contract" $readiness.Output
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
