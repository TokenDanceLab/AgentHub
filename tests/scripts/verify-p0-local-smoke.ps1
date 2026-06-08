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

$gatePath = Join-Path $RepoRoot "scripts\verify-p0-local-smoke.ps1"

Assert-True (Test-Path -LiteralPath $gatePath) "P0 localhost smoke harness exists"

if (Test-Path -LiteralPath $gatePath) {
    $scriptText = Get-Content -Raw -LiteralPath $gatePath -Encoding UTF8

    foreach ($required in @(
        "RunLocalhost",
        "EvidencePath",
        "FixtureOnly",
        "LocalOnly",
        "LocalhostSmoke",
        "RealApprovalRequired",
        "RealTested=false",
        "Test-TcpPort",
        "verify-p0-remote-control-fixture.ps1",
        "verify-oidc-flow.ps1",
        "go test ./tests/oidc -run TestOIDCSmoke -short -count=1",
        "go test ./internal/service -run TestExecutionTargetPingRequiresLiveProofForRemoteTargets -short -count=1",
        "go test ./internal/adapters -run SDKFixture -short -count=1",
        "go test ./internal/security ./internal/httpserver -run RemoteMode -short -count=1",
        "8080",
        "5174",
        "5173",
        "3210"
    )) {
        Assert-True ($scriptText.Contains($required)) "localhost smoke harness references $required"
    }

    foreach ($forbidden in @(
        "&\s*(pnpm|npm|yarn|bun)\b",
        "&\s*(codex|claude|opencode|openai)\b",
        "\b(go\s+run|docker|kubectl|systemctl|ssh|scp|rsync)\b",
        "\b(Invoke-WebRequest|Invoke-RestMethod|Start-Process)\b",
        "id\.vectorcontrol\.tech",
        "api\.vectorcontrol\.tech",
        "docker compose",
        "model api",
        "RealTested=true",
        'real_tested\s*=\s*\$true'
    )) {
        Assert-True ($scriptText -notmatch $forbidden) "localhost smoke harness does not contain forbidden real invocation/claim pattern: $forbidden"
    }

    $tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-p0-local-smoke-test-$PID"
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null

    $planEvidencePath = Join-Path $tmpRoot "plan-evidence.json"
    $planRun = Invoke-RepoScript @(
        $gatePath,
        "-RepoRoot", $RepoRoot,
        "-EvidencePath", $planEvidencePath
    )
    Assert-True ($planRun.ExitCode -eq 0) "P0 localhost smoke harness Plan mode passes current fixture/local stack" $planRun.Output

    foreach ($stage in @(
        "Mode: Plan",
        "FixtureOnly gates",
        "LocalOnly gates",
        "Localhost service probes",
        "Evidence matrix",
        "RealApprovalRequired gates",
        "Hub OIDC mock smoke",
        "Hub remote target live-proof boundary",
        "Edge fixture adapter boundary",
        "Edge remote origin boundary"
    )) {
        Assert-True ($planRun.Output -match [regex]::Escape($stage)) "Plan output includes stage: $stage" $planRun.Output
    }

    foreach ($boundary in @(
        "FixtureOnly: fixture evidence and static/source gates only",
        "LocalOnly: local fake/static or httptest gates only",
        "LocalhostSmoke: localhost probes only; fake/local session and fixture adapter required",
        "RealApprovalRequired: real TokenDanceID login was not run",
        "RealApprovalRequired: real CLI/model adapter execution was not run",
        "RealApprovalRequired: public deploy/signing/release upload was not run",
        "RealTested=false"
    )) {
        Assert-True ($planRun.Output -match [regex]::Escape($boundary)) "Plan output states boundary: $boundary" $planRun.Output
    }

    foreach ($blocked in @(
        "BLOCKED  localhost Hub service probe",
        "BLOCKED  localhost Web service probe",
        "BLOCKED  localhost Desktop service probe",
        "BLOCKED  localhost Local Edge service probe",
        "BLOCKED  localhost fake/local session chain proof"
    )) {
        Assert-True ($planRun.Output -match [regex]::Escape($blocked)) "Plan output records blocked check: $blocked" $planRun.Output
    }

    Assert-True (Test-Path -LiteralPath $planEvidencePath) "Plan mode writes evidence matrix JSON"
    if (Test-Path -LiteralPath $planEvidencePath) {
        $matrix = Get-Content -Raw -LiteralPath $planEvidencePath | ConvertFrom-Json
        Assert-True ($matrix.schema -eq "agenthub-p0-local-smoke-evidence-v1") "evidence matrix schema is v1"
        Assert-True ($matrix.mode -eq "Plan") "evidence matrix records Plan mode"
        Assert-True ($matrix.real_tested -eq $false) "evidence matrix keeps real_tested false"
        Assert-True ($matrix.ports.hub -eq 8080) "evidence matrix records Hub port"
        Assert-True ($matrix.ports.web -eq 5174) "evidence matrix records Web port"
        Assert-True ($matrix.ports.desktop -eq 5173) "evidence matrix records Desktop port"
        Assert-True ($matrix.ports.edge -eq 3210) "evidence matrix records Edge port"
        Assert-True (@($matrix.rows | Where-Object { $_.status -eq "BLOCKED" }).Count -ge 5) "evidence matrix includes blocked localhost checks"
        Assert-True (@($matrix.rows | Where-Object { $_.real_tested -ne $false }).Count -eq 0) "all evidence rows keep real_tested false"
    }

    $localhostEvidencePath = Join-Path $tmpRoot "localhost-evidence.json"
    $localhostRun = Invoke-RepoScript @(
        $gatePath,
        "-RepoRoot", $RepoRoot,
        "-RunLocalhost",
        "-HubPort", "1",
        "-WebPort", "1",
        "-DesktopPort", "1",
        "-EdgePort", "1",
        "-EvidencePath", $localhostEvidencePath,
        "-TimeoutMs", "25"
    )
    Assert-True ($localhostRun.ExitCode -eq 2) "RunLocalhost mode exits incomplete when localhost services are unreachable" $localhostRun.Output
    Assert-True ($localhostRun.Output -match "Mode: RunLocalhost") "RunLocalhost output labels mode" $localhostRun.Output
    Assert-True ($localhostRun.Output -match "127\.0\.0\.1:1 is not reachable") "RunLocalhost output names unreachable localhost services" $localhostRun.Output
    Assert-True ($localhostRun.Output -match "RealTested=false") "RunLocalhost blocked output still avoids RealTested claim" $localhostRun.Output
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
