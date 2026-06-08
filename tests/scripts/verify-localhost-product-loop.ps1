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

function Get-EventIndex {
    param($Events, [string]$Type)

    for ($i = 0; $i -lt @($Events).Count; $i++) {
        if ($Events[$i].type -eq $Type) {
            return $i
        }
    }
    return -1
}

$gatePath = Join-Path $RepoRoot "scripts\verify-localhost-product-loop.ps1"
Assert-True (Test-Path -LiteralPath $gatePath) "localhost product-loop harness exists"

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-localhost-product-loop-$PID"
Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
$evidencePath = Join-Path $tmpRoot "localhost-product-loop-evidence.json"

if (Test-Path -LiteralPath $gatePath) {
    $run = Invoke-RepoScript @(
        $gatePath,
        "-RepoRoot", $RepoRoot,
        "-EvidencePath", $evidencePath
    )

    Assert-True ($run.ExitCode -eq 0) "localhost product-loop harness exits successfully" $run.Output
    foreach ($text in @(
        "Web -> Hub -> registered Desktop/Edge -> Local Edge -> fixture/SDK adapter -> Hub replay",
        "Web starts TeamRun through Hub-only boundary",
        "Hub routes to the registered Desktop/Edge target",
        "Desktop bridge dispatches only to Local Edge",
        "Local Edge runs fixture/SDK adapter without CLI/model spend",
        "Hub replay records completed localhost fixture chain",
        "RealTested=false"
    )) {
        Assert-True ($run.Output -match [regex]::Escape($text)) "harness output includes: $text" $run.Output
    }

    Assert-True (Test-Path -LiteralPath $evidencePath) "localhost product-loop evidence file is written"
    if (Test-Path -LiteralPath $evidencePath) {
        $evidence = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json

        Assert-True ($evidence.schema -eq "agenthub-localhost-product-loop-v1") "evidence schema is agenthub-localhost-product-loop-v1"
        Assert-True ($evidence.mode -eq "LocalhostFixture") "evidence mode is LocalhostFixture"
        Assert-True ($evidence.real_tested -eq $false) "evidence keeps RealTested false"
        Assert-True ($evidence.claims.real_tokendance_id_login -eq $false) "evidence does not claim real TokenDanceID login"
        Assert-True ($evidence.claims.real_cli_or_model_invoked -eq $false) "evidence does not claim real CLI/model invocation"
        Assert-True ($evidence.claims.public_deploy_used -eq $false) "evidence does not claim public deploy"

        $services = @($evidence.services)
        Assert-True ($services.Count -eq 4) "evidence records four localhost fixture services"
        foreach ($service in @("web", "hub", "desktop", "local-edge")) {
            $row = @($services | Where-Object { $_.service -eq $service } | Select-Object -First 1)[0]
            Assert-True ($null -ne $row) "service $service is recorded"
            if ($row) {
                Assert-True ($row.url -match "^http://127\.0\.0\.1:\d+$") "service $service uses localhost URL" ($row | ConvertTo-Json -Depth 5)
                Assert-True ($row.status -eq "started") "service $service is started" ($row | ConvertTo-Json -Depth 5)
            }
        }

        Assert-True (@($evidence.topology.web.allowed_upstreams) -contains "hub") "Web boundary allows Hub upstream"
        Assert-True (@($evidence.topology.web.allowed_upstreams).Count -eq 1) "Web boundary is Hub-only"
        Assert-True (@($evidence.topology.desktop.allowed_upstreams) -contains "local-edge") "Desktop boundary allows Local Edge upstream"
        Assert-True (@($evidence.topology.desktop.allowed_upstreams).Count -eq 1) "Desktop boundary does not call Hub directly"
        Assert-True ($evidence.topology.local_edge.adapter -eq "fixture-sdk") "Local Edge uses fixture/SDK adapter"

        $manifest = $evidence.remote_control_manifest
        Assert-True ($manifest.mode -eq "LocalhostFixture") "remote-control manifest mode is LocalhostFixture"
        foreach ($field in @("hubTaskId", "targetId", "edgeDeviceId", "edgeRunId", "adapterId")) {
            Assert-True (-not [string]::IsNullOrWhiteSpace([string]$manifest.$field)) "remote-control manifest contains $field"
        }

        $requiredTypes = @(
            "target.registered",
            "web.teamrun.start",
            "hub.agent.dispatch",
            "desktop.dispatch.accepted",
            "edge.run.started",
            "adapter.run.completed",
            "hub.replay.recorded"
        )
        $lastIndex = -1
        foreach ($type in $requiredTypes) {
            $index = Get-EventIndex $evidence.events $type
            Assert-True ($index -gt $lastIndex) "event $type appears in product-loop order" ($evidence.events | ConvertTo-Json -Depth 8)
            $lastIndex = $index
        }

        $task = @($evidence.tasks | Where-Object { $_.id -eq $manifest.hubTaskId } | Select-Object -First 1)[0]
        Assert-True ($null -ne $task) "Hub task named by manifest exists"
        if ($task) {
            Assert-True ($task.target_id -eq $manifest.targetId) "Hub task carries target_id"
            Assert-True ($task.edge_device_id -eq $manifest.edgeDeviceId) "Hub task carries edge_device_id"
            Assert-True ($task.edge_run_id -eq $manifest.edgeRunId) "Hub task carries edge_run_id"
            Assert-True ($task.adapter_id -eq $manifest.adapterId) "Hub task carries adapter_id"
        }

        foreach ($blocker in @(
            "real TokenDanceID login remains blocked",
            "real CLI/model adapter invocation remains blocked",
            "public deploy remains blocked"
        )) {
            Assert-True (@($evidence.blockers) -contains $blocker) "evidence records blocker: $blocker"
        }
    }
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
