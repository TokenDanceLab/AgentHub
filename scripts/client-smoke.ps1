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
$RunnerContextCheckRequired = -not $ReuseExistingEdge

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

function Format-ProcessArgument([string]$Value) {
    if ($null -eq $Value) {
        return '""'
    }
    if ($Value -notmatch '[\s"]') {
        return $Value
    }
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Start-EdgeProcess([string[]]$Arguments) {
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $EdgeBinary
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.Arguments = (($Arguments | ForEach-Object { Format-ProcessArgument $_ }) -join " ")
    return [System.Diagnostics.Process]::Start($psi)
}

function Invoke-RunnerMock() {
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $RunnerBinary
    $psi.Arguments = "--mock"
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    return [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Output = "$stdout`n$stderr"
    }
}

function Receive-WebSocketText([System.Net.WebSockets.ClientWebSocket]$ws, [int]$TimeoutMs) {
    $cts = [System.Threading.CancellationTokenSource]::new()
    $cts.CancelAfter($TimeoutMs)
    $buffer = New-Object byte[] 65536
    $segment = [System.ArraySegment[byte]]::new($buffer)
    $stream = [System.IO.MemoryStream]::new()
    try {
        do {
            $result = $ws.ReceiveAsync($segment, $cts.Token).GetAwaiter().GetResult()
            if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                return $null
            }
            if ($result.Count -gt 0) {
                $stream.Write($buffer, 0, $result.Count)
            }
        } while (-not $result.EndOfMessage)

        if ($stream.Length -eq 0) {
            return $null
        }
        return [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
    } catch [System.OperationCanceledException] {
        return $null
    } finally {
        $stream.Dispose()
        $cts.Dispose()
    }
}

function Read-RunOutputText($event) {
    if ($event.type -ne "run.output.batch") {
        return ""
    }
    if ($event.payload.runId -ne $script:CurrentRunId) {
        return ""
    }
    if ($event.payload.stream -ne "stdout") {
        return ""
    }

    $text = ""
    foreach ($chunk in @($event.payload.chunks)) {
        if ($null -ne $chunk.text) {
            $text += [string]$chunk.text
        }
    }
    return $text
}

function Test-WebSocketRunOutput([string]$RunId, [bool]$AssertRunnerContext) {
    $script:CurrentRunId = $RunId
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    $cursor = 0
    $receivedAny = $false
    $seenCurrentRunEvent = $false
    $seenCurrentRunTypes = @()
    $stdout = ""
    $preview = ""

    while ([DateTime]::UtcNow -lt $deadline) {
        $ws = New-Object System.Net.WebSockets.ClientWebSocket
        $connectCts = [System.Threading.CancellationTokenSource]::new()
        $connectCts.CancelAfter(5000)
        try {
            $uri = "ws://$EdgeAddr/v1/events?cursor=$cursor"
            $null = $ws.ConnectAsync([Uri]$uri, $connectCts.Token).GetAwaiter().GetResult()
            Assert ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) "WS connected"

            while ([DateTime]::UtcNow -lt $deadline -and $ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
                $raw = Receive-WebSocketText $ws 5000
                if ([string]::IsNullOrWhiteSpace($raw)) {
                    break
                }

                $receivedAny = $true
                if ($preview -eq "") {
                    $preview = $raw.Substring(0, [Math]::Min(120, $raw.Length))
                }

                $event = $raw | ConvertFrom-Json
                if ($null -ne $event.seq) {
                    $cursor = [int64]$event.seq
                }

                $eventRunId = $null
                if ($null -ne $event.scope -and $null -ne $event.scope.runId) {
                    $eventRunId = [string]$event.scope.runId
                } elseif ($null -ne $event.payload -and $null -ne $event.payload.runId) {
                    $eventRunId = [string]$event.payload.runId
                }
                if ($eventRunId -eq $RunId) {
                    $seenCurrentRunEvent = $true
                    $seenCurrentRunTypes += [string]$event.type
                }

                $stdout += Read-RunOutputText $event
                if ($AssertRunnerContext) {
                    if ($stdout.Contains("run=$RunId") -and
                        $stdout.Contains("project=proj_local") -and
                        $stdout.Contains("thread=thread_local")) {
                        Assert $true "Runner stdout context includes run/project/thread"
                        Write-Host "    matched run.output.batch for $RunId" -ForegroundColor DarkGray
                        return
                    }
                } else {
                    if ($seenCurrentRunEvent) {
                        Assert $true "received WS frame for current run"
                        if ($preview -ne "") {
                            Write-Host "    first event: $preview" -ForegroundColor DarkGray
                        }
                        Write-Host "    current run events: $($seenCurrentRunTypes -join ', ')" -ForegroundColor DarkGray
                        Write-Host "    skipped Runner context assertion: -ReuseExistingEdge runner configuration is unknown" -ForegroundColor DarkGray
                        return
                    }
                }
            }
        } finally {
            $connectCts.Dispose()
            if ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open -or
                $ws.State -eq [System.Net.WebSockets.WebSocketState]::CloseReceived) {
                $closeCts = [System.Threading.CancellationTokenSource]::new()
                $closeCts.CancelAfter(2000)
                try {
                    $null = $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", $closeCts.Token).GetAwaiter().GetResult()
                } catch {
                } finally {
                    $closeCts.Dispose()
                }
            }
            $ws.Dispose()
        }
    }

    Assert $receivedAny "received WS frame"
    Assert $seenCurrentRunEvent "received WS frame for current run"
    if ($seenCurrentRunTypes.Count -gt 0) {
        Write-Host "    current run events: $($seenCurrentRunTypes -join ', ')" -ForegroundColor DarkGray
    }
    if ($AssertRunnerContext) {
        Assert $false "Runner stdout context includes run/project/thread"
        if ($stdout -ne "") {
            $seen = $stdout.Substring(0, [Math]::Min(200, $stdout.Length))
            Write-Host "    stdout seen: $seen" -ForegroundColor DarkGray
        } else {
            Write-Host "    stdout seen: <empty>" -ForegroundColor DarkGray
        }
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
        if (-not (Test-Path $RunnerBinary)) {
            Fail "runner binary missing: $RunnerBinary; run .\scripts\client-smoke.ps1 without -SkipBuild first or build runner/cmd/agenthub-runner"
            throw "runner binary missing"
        }

        $EdgeProc = Start-EdgeProcess @("--addr", $EdgeAddr, "--runner-command", $RunnerBinary, "--runner-arg", "--mock")
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
        $run = $null
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
            if ($null -eq $run -or [string]::IsNullOrWhiteSpace($run.runId)) {
                Fail "WebSocket: POST /v1/runs did not return a runId"
            } else {
                Test-WebSocketRunOutput $run.runId $RunnerContextCheckRequired
            }
        } catch {
            Fail "WebSocket: $_"
        }

        # ── Mock Runner ──────────────────────────────────

        Write-Step "Mock Runner"
        Push-Location "$Root/runner"
        try {
            if (-not (Test-Path $RunnerBinary)) {
                Fail "runner binary missing: $RunnerBinary"
                throw "runner binary missing"
            }
            $runnerResult = Invoke-RunnerMock
            Assert ($runnerResult.ExitCode -eq 0) "runner exit 0"
            Assert ($runnerResult.Output -match "Installing") "output chunk: Installing"
            Assert ($runnerResult.Output -match "All tests passed") "output chunk: All tests passed"
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
