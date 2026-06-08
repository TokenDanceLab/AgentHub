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

$gatePath = Join-Path $RepoRoot "scripts\verify-remote-control-fixture-e2e.ps1"
$exporterPath = Join-Path $RepoRoot "scripts\export-teamrun-demo-fixture-evidence.ps1"
$scenarioPath = Join-Path $RepoRoot "docs\competition\teamrun-demo-scenario.json"

Assert-True (Test-Path -LiteralPath $gatePath) "remote-control fixture E2E gate exists"
Assert-True (Test-Path -LiteralPath $exporterPath) "TeamRun fixture exporter exists"
Assert-True (Test-Path -LiteralPath $scenarioPath) "TeamRun fixture scenario exists"

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-remote-fixture-e2e-$PID"
Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null

if ((Test-Path -LiteralPath $gatePath) -and (Test-Path -LiteralPath $exporterPath) -and (Test-Path -LiteralPath $scenarioPath)) {
    $gateRun = Invoke-RepoScript @(
        $gatePath,
        "-ScenarioManifest", $scenarioPath,
        "-OutputRoot", $tmpRoot,
        "-Stamp", "strict-pass"
    )
    Assert-True ($gateRun.ExitCode -eq 0) "remote-control fixture E2E gate passes exported fixture" $gateRun.Output
    Assert-True ($gateRun.Output -match "Web starts TeamRun with target_id") "gate output names Web target_id stage" $gateRun.Output
    Assert-True ($gateRun.Output -match "Hub exact-routes to Desktop/Edge target") "gate output names Hub exact-route stage" $gateRun.Output
    Assert-True ($gateRun.Output -match "Desktop bridge starts Local Edge run fixture") "gate output names Desktop bridge stage" $gateRun.Output
    Assert-True ($gateRun.Output -match "Edge emits/callbacks fixture events") "gate output names Edge callback stage" $gateRun.Output
    Assert-True ($gateRun.Output -match "Adapter result/callback is emitted") "gate output names adapter result/callback stage" $gateRun.Output
    Assert-True ($gateRun.Output -match "Hub replay records completed fixture chain") "gate output names Hub replay stage" $gateRun.Output

    $evidencePath = Join-Path $tmpRoot "teamrun-demo-strict-pass\teamrun-evidence.json"
    Assert-True (Test-Path -LiteralPath $evidencePath) "gate writes exported fixture evidence"

    if (Test-Path -LiteralPath $evidencePath) {
        $evidence = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
        Assert-True ($null -ne $evidence.remote_control_manifest) "exported fixture includes remote-control manifest"
        Assert-True ($evidence.remote_control_manifest.mode -eq "FixtureRehearsal") "remote-control manifest is FixtureRehearsal mode"

        foreach ($field in @("hubTaskId", "targetId", "edgeDeviceId", "edgeRunId", "adapterId")) {
            $badPath = Join-Path $tmpRoot "missing-$field.json"
            $badEvidence = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
            $badEvidence.remote_control_manifest.$field = ""
            $badEvidence | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $badPath -Encoding UTF8

            $badRun = Invoke-RepoScript @(
                $gatePath,
                "-EvidencePath", $badPath
            )
            Assert-True ($badRun.ExitCode -ne 0) "remote-control fixture E2E gate fails when $field is missing" $badRun.Output
            Assert-True ($badRun.Output -match "remote-control manifest contains $field") "missing $field failure is explicit" $badRun.Output
        }

        $missingAdapterEventPath = Join-Path $tmpRoot "missing-adapter-result-event.json"
        $missingAdapterEvent = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
        $missingAdapterEvent.events = @($missingAdapterEvent.events | Where-Object { $_.id -ne "evt-remote-005" })
        $missingAdapterEvent | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $missingAdapterEventPath -Encoding UTF8
        $missingAdapterEventRun = Invoke-RepoScript @(
            $gatePath,
            "-EvidencePath", $missingAdapterEventPath
        )
        Assert-True ($missingAdapterEventRun.ExitCode -ne 0) "remote-control fixture E2E gate fails when adapter result/callback event is missing" $missingAdapterEventRun.Output
        Assert-True ($missingAdapterEventRun.Output -match "event evt-remote-005 exists") "missing adapter event failure is explicit" $missingAdapterEventRun.Output

        $placeholderRefsPath = Join-Path $tmpRoot "placeholder-eventrefs.json"
        $placeholderRefs = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
        $placeholderRefs.remote_control_manifest.eventRefs = @(
            "placeholder-ref-001",
            "placeholder-ref-002",
            "placeholder-ref-003",
            "placeholder-ref-004"
        )
        $placeholderRefs | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $placeholderRefsPath -Encoding UTF8
        $placeholderRefsRun = Invoke-RepoScript @(
            $gatePath,
            "-EvidencePath", $placeholderRefsPath
        )
        Assert-True ($placeholderRefsRun.ExitCode -ne 0) "remote-control fixture E2E gate fails placeholder eventRefs" $placeholderRefsRun.Output
        Assert-True ($placeholderRefsRun.Output -match "remote-control eventRef resolves to an evidence event") "placeholder eventRefs failure is explicit" $placeholderRefsRun.Output

        $missingRefsPath = Join-Path $tmpRoot "missing-eventrefs.json"
        $missingRefs = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
        $missingRefs.remote_control_manifest.eventRefs = @()
        $missingRefs | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $missingRefsPath -Encoding UTF8
        $missingRefsRun = Invoke-RepoScript @(
            $gatePath,
            "-EvidencePath", $missingRefsPath
        )
        Assert-True ($missingRefsRun.ExitCode -ne 0) "remote-control fixture E2E gate fails missing eventRefs" $missingRefsRun.Output
        Assert-True ($missingRefsRun.Output -match "remote-control manifest contains eventRefs for the chain") "missing eventRefs failure is explicit" $missingRefsRun.Output

        $blankChainRefPath = Join-Path $tmpRoot "blank-chain-eventref.json"
        $blankChainRef = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
        $blankChainRef.remote_control_manifest.chain[3].eventRef = ""
        $blankChainRef | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $blankChainRefPath -Encoding UTF8
        $blankChainRefRun = Invoke-RepoScript @(
            $gatePath,
            "-EvidencePath", $blankChainRefPath
        )
        Assert-True ($blankChainRefRun.ExitCode -ne 0) "remote-control fixture E2E gate fails blank chain eventRef" $blankChainRefRun.Output
        Assert-True ($blankChainRefRun.Output -match "chain stage edge_events_callback eventRef is not blank") "blank chain eventRef failure is explicit" $blankChainRefRun.Output
    }
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
