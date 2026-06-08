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

$gatePath = Join-Path $RepoRoot "scripts\verify-p0-remote-control-fixture.ps1"

Assert-True (Test-Path -LiteralPath $gatePath) "P0 remote-control fixture total gate exists"

if (Test-Path -LiteralPath $gatePath) {
    $scriptText = Get-Content -Raw -LiteralPath $gatePath -Encoding UTF8

    foreach ($required in @(
        "FixtureRehearsal",
        "verify-login-fixture-topology.ps1",
        "verify-web-hub-boundary.ps1",
        "verify-remote-control-fixture-e2e.ps1",
        "tests\scripts\verify-remote-control-fixture-e2e.ps1",
        "tests\scripts\verify-teamrun-demo-contract.ps1",
        "go test ./internal/adapters -run SDKFixture -short -count=1"
    )) {
        Assert-True ($scriptText.Contains($required)) "total gate references $required"
    }

    foreach ($forbidden in @(
        "&\s*(pnpm|npm|yarn|bun)\b",
        "&\s*(codex|claude|opencode|openai)\b",
        "\b(docker|kubectl|systemctl|ssh|scp|rsync)\b",
        "\b(Invoke-WebRequest|Invoke-RestMethod|Start-Process)\b",
        "id\.vectorcontrol\.tech",
        "api\.vectorcontrol\.tech",
        "docker compose",
        "model api"
    )) {
        Assert-True ($scriptText -notmatch $forbidden) "total gate does not contain forbidden real invocation pattern: $forbidden"
    }

    $gateRun = Invoke-RepoScript @(
        $gatePath,
        "-RepoRoot", $RepoRoot
    )
    Assert-True ($gateRun.ExitCode -eq 0) "P0 remote-control fixture total gate passes current fixture stack" $gateRun.Output

    foreach ($stage in @(
        "Fixture boundary",
        "Login fixture topology",
        "Web Hub boundary",
        "Remote-control fixture E2E",
        "Remote-control fixture E2E script tests",
        "TeamRun demo contract tests",
        "Edge SDK fixture focused gate"
    )) {
        Assert-True ($gateRun.Output -match [regex]::Escape($stage)) "total gate output includes stage: $stage" $gateRun.Output
    }

    foreach ($boundary in @(
        "does not start real Hub, Desktop, or Edge services",
        "does not run real CLI/model adapters",
        "does not log in to TokenDanceID",
        "does not deploy"
    )) {
        Assert-True ($gateRun.Output -match [regex]::Escape($boundary)) "total gate output states boundary: $boundary" $gateRun.Output
    }

    Assert-True ($gateRun.Output -match "PASS\s+verify-login-fixture-topology\.ps1") "total gate records login topology gate pass" $gateRun.Output
    Assert-True ($gateRun.Output -match "PASS\s+verify-web-hub-boundary\.ps1") "total gate records Web Hub boundary pass" $gateRun.Output
    Assert-True ($gateRun.Output -match "PASS\s+verify-remote-control-fixture-e2e\.ps1") "total gate records remote fixture E2E pass" $gateRun.Output
    Assert-True ($gateRun.Output -match "PASS\s+tests/scripts/verify-remote-control-fixture-e2e\.ps1") "total gate records remote fixture E2E test pass" $gateRun.Output
    Assert-True ($gateRun.Output -match "PASS\s+tests/scripts/verify-teamrun-demo-contract\.ps1") "total gate records TeamRun contract pass" $gateRun.Output
    Assert-True ($gateRun.Output -match "PASS\s+go test ./internal/adapters -run SDKFixture -short -count=1") "total gate records Edge SDK fixture pass" $gateRun.Output

    $badMode = Invoke-RepoScript @(
        $gatePath,
        "-RepoRoot", $RepoRoot,
        "-Mode", "RealTested"
    )
    Assert-True ($badMode.ExitCode -ne 0) "total gate rejects non-FixtureRehearsal mode" $badMode.Output
    Assert-True ($badMode.Output -match "FixtureRehearsal") "bad mode failure names FixtureRehearsal requirement" $badMode.Output

    $badClaim = Invoke-RepoScript @(
        $gatePath,
        "-RepoRoot", $RepoRoot,
        "-Claim", "SubmissionReady"
    )
    Assert-True ($badClaim.ExitCode -ne 0) "total gate rejects non-fixture claim" $badClaim.Output
    Assert-True ($badClaim.Output -match "FixtureOnly") "bad claim failure names FixtureOnly requirement" $badClaim.Output
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
