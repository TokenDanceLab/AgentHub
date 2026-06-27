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

function Find-PowerShell {
    $pwsh = Get-Command "pwsh" -ErrorAction SilentlyContinue
    if ($pwsh) {
        return $pwsh.Source
    }
    $powershell = Get-Command "powershell" -ErrorAction SilentlyContinue
    if ($powershell) {
        return $powershell.Source
    }
    return $null
}

function Invoke-CapturedProcess {
    param(
        [string]$FileName,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FileName
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.Arguments = ($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') {
            '"' + ($_ -replace '"', '\"') + '"'
        } else {
            $_
        }
    }) -join " "

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = ($stdout + "`n" + $stderr)
    }
}

$gatePath = Join-Path $RepoRoot "scripts\verify-edge-sqlite-durable-observed-smoke.ps1"
$gateImplementationPath = Join-Path $RepoRoot "scripts\smoke\verify-edge-sqlite-durable-observed-smoke.ps1"
$goTestPath = Join-Path $RepoRoot "edge-server\cmd\agenthub-edge\main_test.go"

Assert-True (Test-Path -LiteralPath $gatePath) "Edge SQLite durable observed smoke gate exists"
Assert-True (Test-Path -LiteralPath $gateImplementationPath) "Edge SQLite durable observed smoke gate implementation exists"
Assert-True (Test-Path -LiteralPath $goTestPath) "agenthub-edge Go tests exist"

if (Test-Path -LiteralPath $goTestPath) {
    $goTestText = Get-Content -Raw -LiteralPath $goTestPath -Encoding UTF8
    Assert-True ($goTestText -match "TestSQLiteDurableObservedFixtureSmoke") "Go smoke names SQLite durable observed fixture"
    Assert-True ($goTestText -match "--store-backend") "Go smoke uses agenthub-edge store backend flag path"
    Assert-True ($goTestText -match "--store-db") "Go smoke uses agenthub-edge store db flag path"
    Assert-True ($goTestText -match "agenthub_store_rows") "Go smoke verifies snapshot row persistence"
    Assert-True ($goTestText -match "edge_runs") "Go smoke verifies relational run projection"
}

if (Test-Path -LiteralPath $gateImplementationPath) {
    $gateText = Get-Content -Raw -LiteralPath $gateImplementationPath -Encoding UTF8
    Assert-True ($gateText -match "FixtureOnlyObserved") "gate declares FixtureOnlyObserved boundary"
    Assert-True ($gateText -match "alpha durability") "gate states SQLite alpha durability scope"
    Assert-True ($gateText -match [regex]::Escape("go test ./cmd/agenthub-edge ./internal/store -run SQLiteDurableObservedFixtureSmoke -count=1")) "gate runs focused Edge SQLite durable observed Go smoke"

    foreach ($forbidden in @(
        "&\s*(codex|claude|opencode|openai)\b",
        "\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|CODEX_|CLAUDE_)\b",
        "\b(docker|kubectl|systemctl|ssh|scp|rsync)\b",
        "\b(Invoke-WebRequest|Invoke-RestMethod|Start-Process)\b",
        "id\.vectorcontrol\.tech",
        "api\.vectorcontrol\.tech",
        "release upload",
        "self-hosted"
    )) {
        Assert-True ($gateText -notmatch $forbidden) "gate does not contain forbidden real invocation pattern: $forbidden"
    }

    $powershellExe = Find-PowerShell
    Assert-True ($null -ne $powershellExe) "PowerShell is available for gate execution"
    if ($powershellExe) {
        $gateRun = Invoke-CapturedProcess $powershellExe @(
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            $gatePath,
            "-RepoRoot",
            $RepoRoot
        ) $RepoRoot
        Assert-True ($gateRun.ExitCode -eq 0) "Edge SQLite durable observed smoke gate passes" $gateRun.Output
        Assert-True ($gateRun.Output -match "FixtureOnlyObserved") "gate output names fixture-only observed mode" $gateRun.Output
        Assert-True ($gateRun.Output -match "agenthub-edge --store-backend sqlite --store-db") "gate output names observed Edge SQLite invocation shape" $gateRun.Output
    }
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
