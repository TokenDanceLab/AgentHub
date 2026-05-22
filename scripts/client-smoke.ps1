# AgentHub client local smoke test (Windows / PowerShell)
#
# Chains Edge, Runner, Desktop end-to-end verification.
# Run .\scripts\setup.ps1 first, then this script.
#
# Usage:
#   .\scripts\client-smoke.ps1
#   .\scripts\client-smoke.ps1 -SkipBuild
#   .\scripts\client-smoke.ps1 -ReuseExistingEdge

[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$ReuseExistingEdge
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")

$EdgeAddr = "127.0.0.1:3210"
$EdgeUrl = "http://$EdgeAddr"
$EdgeBinary = Join-Path $Root "edge-server/agenthub-edge-tmp.exe"
$RunnerBinary = Join-Path $Root "runner/agenthub-runner-tmp.exe"

$Passed = 0
$Failed = 0
$EdgeProc = $null
$StartedEdge = $false

function Write-Step([string]$text) {
    Write-Host "`n=== $text ===" -ForegroundColor Cyan
}

function Pass([string]$text) {
    $script:Passed++
    Write-Host "  PASS  $text" -ForegroundColor Green
}

function Fail([string]$text) {
    $script:Failed++
    Write-Host "  FAIL  $text" -ForegroundColor Red
}

function Assert($condition, [string]$label) {
    if ($condition) { Pass $label } else { Fail $label }
}

function Test-EdgeHealth() {
    try {
        $health = Invoke-RestMethod -Uri "$EdgeUrl/v1/health" -TimeoutSec 2
        return ($health.status -eq "ok" -and $health.version -eq "v1")
    } catch {
        return $false
    }
}

Push-Location $Root
try {
    # ── Prerequisites ──────────────────────────────────

    Write-Step "Environment check"

    $goOut = go version 2>&1
    $goMatch = $goOut -match 'go(\d+\.\d+)'
    if ($goMatch) {
        $goVer = [version]$Matches[1]
        Assert ($goVer -ge [version]"1.24") "Go 1.24+ (go$($Matches[1]))"
    } else {
        Fail "Go not found or unexpected version output"
    }

    $pnpmOut = pnpm --version 2>&1
    Assert ($LASTEXITCODE -eq 0) "pnpm ($pnpmOut)"

    node --version 2>&1 | Out-Null
    Assert ($LASTEXITCODE -eq 0) "node available"

    $ExistingEdge = Test-EdgeHealth
    if ($ExistingEdge -and -not $ReuseExistingEdge) {
        Fail "Edge already running on $EdgeAddr; stop it or pass -ReuseExistingEdge"
        throw "edge already running on $EdgeAddr"
    }

    # ── Build ──────────────────────────────────────────

    if (-not $SkipBuild) {
        Write-Step "Build Edge Server"
        Push-Location "$Root/edge-server"
        try {
            go build -o $EdgeBinary ./cmd/agenthub-edge/
            Assert (Test-Path $EdgeBinary) "edge-server binary"
        } finally { Pop-Location }

        Write-Step "Build Runner"
        Push-Location "$Root/runner"
        try {
            go build -o $RunnerBinary ./cmd/agenthub-runner/
            Assert (Test-Path $RunnerBinary) "runner binary"
        } finally { Pop-Location }

        Write-Step "Build Desktop (web only)"
        Push-Location "$Root/app/desktop"
        try {
            pnpm install --frozen-lockfile 2>&1 | Out-Null
            Assert ($LASTEXITCODE -eq 0) "pnpm install"
            pnpm build 2>&1 | Out-Null
            Assert ($LASTEXITCODE -eq 0 -and (Test-Path "dist/index.html")) "pnpm build OK"
        } finally { Pop-Location }
    }

    # ── Edge Server ────────────────────────────────────

    Write-Step "Start Edge Server"
    if (Test-EdgeHealth) {
        if ($ReuseExistingEdge) {
            Pass "reuse existing Edge on $EdgeAddr"
        } else {
            Fail "Edge already running on $EdgeAddr; stop it or pass -ReuseExistingEdge"
            throw "edge already running on $EdgeAddr"
        }
    } else {
        if (-not (Test-Path $EdgeBinary)) {
            Fail "edge binary missing: $EdgeBinary"
            throw "edge binary missing"
        }

        $EdgeProc = Start-Process -FilePath $EdgeBinary -ArgumentList "--addr", $EdgeAddr -PassThru -WindowStyle Hidden
        $StartedEdge = $true

        $ready = $false
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 250
            if ($EdgeProc.HasExited) { break }
            if (Test-EdgeHealth) {
                $ready = $true
                break
            }
        }
        Assert ($ready) "Edge process ready (PID $($EdgeProc.Id))"
    }

    try {
        if ($StartedEdge) {
            Assert (-not $EdgeProc.HasExited) "Edge process alive (PID $($EdgeProc.Id))"
        }

        # Health
        Write-Step "GET /v1/health"
        try {
            $health = Invoke-RestMethod -Uri "$EdgeUrl/v1/health" -TimeoutSec 5
            Assert ($health.status -eq "ok") "status=ok"
            Assert ($health.version -eq "v1") "version=v1"
            Assert ($health.edgeId -eq "local") "edgeId=local"
        } catch {
            Fail "health: $_"
        }

        # Runners
        Write-Step "GET /v1/runners"
        try {
            $runners = Invoke-RestMethod -Uri "$EdgeUrl/v1/runners" -TimeoutSec 5
            $count = @($runners.items).Count
            Assert ($count -gt 0) "runners count=$count"
            if ($count -gt 0) {
                Assert ($runners.items[0].status -eq "online") "mock runner online"
            }
            Assert ($runners.page.hasMore -eq $false) "hasMore=false"
        } catch {
            Fail "runners: $_"
        }

        # POST /v1/runs
        Write-Step "POST /v1/runs"
        try {
            $run = Invoke-RestMethod -Uri "$EdgeUrl/v1/runs" -Method Post -TimeoutSec 5
            Assert ($run.runId -match '^run_') "runId prefix ($($run.runId))"
            Assert ($run.status -eq "queued") "status=queued"
            Assert ($null -ne $run.createdAt) "createdAt non-null"
        } catch {
            Fail "POST runs: $_"
        }

        # POST /v1/runs/{runId}:cancel
        Write-Step "POST /v1/runs/{runId}:cancel"
        try {
            $cancel = Invoke-RestMethod -Uri "$EdgeUrl/v1/runs/run_test:cancel" -Method Post -TimeoutSec 5
            Assert ($cancel.runId -eq "run_test") "runId=run_test"
            Assert ($cancel.status -eq "cancelling") "status=cancelling"
        } catch {
            Fail "cancel: $_"
        }

        # WebSocket
        Write-Step "WebSocket /v1/events"
        try {
            $ws = New-Object System.Net.WebSockets.ClientWebSocket
            $ct = (New-Object System.Threading.CancellationTokenSource).Token
            $connectedFrame = $ws.ConnectAsync([Uri]"ws://$EdgeAddr/v1/events", $ct).Wait(5000)
            Assert ($connectedFrame) "WS connect completed"
            Assert ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) "WS connected"

            if ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
                $buf = New-Object byte[] 4096
                $seg = [System.ArraySegment[byte]]::new($buf)
                $receiveTask = $ws.ReceiveAsync($seg, $ct)
                $receivedFrame = $receiveTask.Wait(5000)
                Assert ($receivedFrame) "received WS frame"
                if ($receivedFrame) {
                    $result = $receiveTask.Result
                    $received = [System.Text.Encoding]::UTF8.GetString($buf, 0, $result.Count)
                    Assert ($received.Length -gt 0) "received event data ($($received.Length) bytes)"
                    $preview = $received.Substring(0, [Math]::Min(120, $received.Length))
                    Write-Host "    first event: $preview" -ForegroundColor DarkGray
                }
            }

            $null = $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", $ct).Wait(2000)
        } catch {
            Fail "WebSocket: $_"
        }

        # ── Mock Runner ──────────────────────────────────

        Write-Step "Mock Runner"
        Push-Location "$Root/runner"
        try {
            $out = & $RunnerBinary --mock 2>&1
            Assert ($LASTEXITCODE -eq 0) "runner exit 0"
            Assert ($out -match "Installing") "output chunk: Installing"
            Assert ($out -match "All tests passed") "output chunk: All tests passed"
        } finally { Pop-Location }

        # ── Go tests ────────────────────────────────────

        Write-Step "Go unit tests"
        Push-Location "$Root/edge-server"
        try {
            go test ./... 2>&1 | Out-Null
            Assert ($LASTEXITCODE -eq 0) "edge-server tests pass"
        } finally { Pop-Location }

        Push-Location "$Root/runner"
        try {
            go test ./... 2>&1 | Out-Null
            Assert ($LASTEXITCODE -eq 0) "runner tests pass"
        } finally { Pop-Location }

    } finally {
        if ($StartedEdge -and $EdgeProc -and -not $EdgeProc.HasExited) {
            Write-Step "Stop Edge Server"
            Stop-Process -Id $EdgeProc.Id -Force -ErrorAction SilentlyContinue
        }
    }

    # ── Summary ───────────────────────────────────────

    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
    Write-Host "========================================" -ForegroundColor Cyan

    Write-Host "`nManual UI verification steps:" -ForegroundColor Yellow
    Write-Host "  1. Start Edge:   cd edge-server; go run ./cmd/agenthub-edge" -ForegroundColor White
    Write-Host "  2. Start Desktop: cd app/desktop; pnpm tauri dev" -ForegroundColor White
    Write-Host "  3. Verify status bar shows green Online dot" -ForegroundColor White
    Write-Host "  4. Verify Runner list shows Mock Runner (local) online" -ForegroundColor White
    Write-Host "  5. Trigger POST /v1/runs and check event log panel updates" -ForegroundColor White
    Write-Host "  6. Stop Edge and verify UI shows red Offline without crash" -ForegroundColor White

    exit $(if ($Failed -eq 0) { 0 } else { 1 })

} finally {
    Pop-Location
}
