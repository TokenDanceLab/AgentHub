param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
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

$gatePath = Join-Path $RepoRoot "scripts\verify-edge-sqlite-durable-hardening.ps1"
$testPath = Join-Path $RepoRoot "edge-server\internal\store\sqlite_durable_hardening_test.go"

Assert-True (Test-Path -LiteralPath $gatePath) "Edge SQLite durable hardening gate exists"
Assert-True (Test-Path -LiteralPath $testPath) "SQLite durable hardening test exists"

if (Test-Path -LiteralPath $testPath) {
    $testText = Get-Content -Raw -LiteralPath $testPath -Encoding UTF8
    Assert-True ($testText -match "TestSQLiteDurableHardeningRestoresApprovalArtifactReplayAndPins") "test names approval/artifact/replay/pins durable slice"
    Assert-True ($testText -match "agenthub_store_snapshots") "test deletes snapshot to force row-first recovery"
    Assert-True ($testText -match "run\.agent\.permission_requested") "test stores approval requested replay item"
    Assert-True ($testText -match "run\.agent\.permission_decided") "test stores approval decided replay item"
    Assert-True ($testText -match "run\.agent\.file_change") "test stores file_change replay item"
    Assert-True ($testText -match "artifact\.created") "test stores artifact.created replay item"
    Assert-True ($testText -match "edge_runs") "test checks relational run projection"
    Assert-True ($testText -match "edge_artifacts") "test checks relational artifact projection"
    Assert-True ($testText -match "edge_diffs") "test checks relational diff projection"
}

if (Test-Path -LiteralPath $gatePath) {
    $gateText = Get-Content -Raw -LiteralPath $gatePath -Encoding UTF8
    Assert-True ($gateText -match "FixtureOnlyDurable") "gate declares fixture-only durable mode"
    Assert-True ($gateText -match "Non-goal: complete relational CRUD or production DB readiness") "gate preserves non-goal boundary"
    Assert-True ($gateText -match [regex]::Escape('go test ./internal/store -run "SQLite|Durable|Approval|Artifact|Replay|Pins" -count=1')) "gate runs focused durable store regex"
    foreach ($forbidden in @(
        "(?m)^\s*&\s*(codex|claude|opencode|openai)\b",
        "\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|CODEX_|CLAUDE_)\b",
        "\b(docker|kubectl|systemctl|ssh|scp|rsync)\b",
        "\b(Invoke-WebRequest|Invoke-RestMethod|Start-Process)\b",
        "id\.vectorcontrol\.tech",
        "api\.vectorcontrol\.tech",
        "release upload"
    )) {
        Assert-True ($gateText -notmatch $forbidden) "gate does not contain forbidden real invocation pattern: $forbidden"
    }

    $output = & pwsh -NoProfile -ExecutionPolicy Bypass -File $gatePath -RepoRoot $RepoRoot 2>&1
    $exitCode = $LASTEXITCODE
    $outputText = ($output | Out-String)
    Assert-True ($exitCode -eq 0) "Edge SQLite durable hardening gate passes" $outputText
    Assert-True ($outputText -match "FixtureOnlyDurable") "gate output names fixture-only durable mode" $outputText
    Assert-True ($outputText -match "no real CLI, model API, login, deploy") "gate output reports no real execution boundary" $outputText
}

if ($Failed -gt 0) {
    exit 1
}
exit 0
