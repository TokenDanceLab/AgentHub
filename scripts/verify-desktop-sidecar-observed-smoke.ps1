param(
    [string]$RepoRoot = ".",
    [switch]$SkipCargoTest
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path

function Step([string]$Message) {
    Write-Host "`n>>> $Message" -ForegroundColor Cyan
}

function Pass([string]$Message) {
    Write-Host "PASS: $Message" -ForegroundColor Green
}

function Fail([string]$Message) {
    Write-Host "FAIL: $Message" -ForegroundColor Red
    exit 1
}

function Assert-Contains {
    param(
        [string]$Text,
        [string]$Pattern,
        [string]$Message
    )

    if ($Text -notmatch $Pattern) {
        Fail $Message
    }
    Pass $Message
}

function Assert-NotContains {
    param(
        [string]$Text,
        [string]$Pattern,
        [string]$Message
    )

    if ($Text -match $Pattern) {
        Fail $Message
    }
    Pass $Message
}

$edgeManagerPath = Join-Path $RepoRoot "app\desktop\src-tauri\src\edge_manager.rs"
$edgeManager = Get-Content $edgeManagerPath -Raw -Encoding UTF8

Step "Observed Desktop sidecar fixture smoke source gate"
Assert-Contains $edgeManager "EdgeObservedSidecarSmoke" "Observed smoke evidence struct exists"
Assert-Contains $edgeManager "observe_fixture_sidecar_smoke" "Observed smoke fixture helper exists"
Assert-Contains $edgeManager "mode:\s*`"fixture`"" "Observed smoke is explicitly fixture scoped"
Assert-Contains $edgeManager "edge_store_db_path\(app_data_dir\.clone\(\)\)" "Observed smoke reads SQLite app-data path"
Assert-Contains $edgeManager "edge_log_paths\(app_data_dir\.clone\(\)\)" "Observed smoke reads stdout/stderr log paths"
Assert-Contains $edgeManager "edge_health_url\(port\)" "Observed smoke reads Local Edge health URL"
Assert-Contains $edgeManager "edge_preflight\(true,\s*false,\s*true,\s*None\)" "Observed smoke reports fixture preflight readiness"
Assert-Contains $edgeManager "direct_cli_spawn:\s*false" "Observed smoke preserves no direct CLI spawn"
Assert-Contains $edgeManager "TcpListener::bind\(`"127\.0\.0\.1:0`"\)" "Observed smoke uses loopback mock health server"
Assert-NotContains $edgeManager "(?m)^\s*(?:codex|claude|opencode)\b" "Observed smoke source does not invoke real CLI commands"

if (-not $SkipCargoTest) {
    Step "Focused Rust observed sidecar fixture smoke"
    Push-Location (Join-Path $RepoRoot "app\desktop\src-tauri")
    try {
        cargo test observed_fixture_smoke --lib
        if ($LASTEXITCODE -ne 0) {
            Fail "cargo test observed_fixture_smoke --lib failed"
        }
    }
    finally {
        Pop-Location
    }
    Pass "cargo test observed_fixture_smoke --lib passed"
}

Write-Host "`nDesktop sidecar observed fixture smoke OK" -ForegroundColor Green
