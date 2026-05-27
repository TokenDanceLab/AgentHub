# AgentHub live Agent Runtime smoke test (Windows / PowerShell)
#
# Starts Edge Server with a real agent CLI, sends a prompt, and
# verifies end-to-end event flow through the WebSocket event stream.
# This script intentionally does not fall back to the mock executor. Use
# scripts/client-smoke.ps1 for CI-safe mock coverage.
#
# Usage:
#   .\scripts\integration-smoke.ps1 -Agent codex -EdgeAddr 127.0.0.1:3231
#   .\scripts\integration-smoke.ps1 -Agent claude-code -EdgeAddr 127.0.0.1:3232
#   .\scripts\integration-smoke.ps1 -Agent opencode -EdgeAddr 127.0.0.1:3233
#   .\scripts\integration-smoke.ps1 -SkipBuild -Agent codex

[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [ValidateSet("claude-code", "codex", "opencode")]
    [string]$Agent = "claude-code",
    [string]$Prompt = "reply with just the word ok",
    [int]$RunTimeoutSec = 60,
    [string]$EdgeAddr = "127.0.0.1:3210"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")

$EdgeUrl = "http://$EdgeAddr"
$EdgeBinary = Join-Path $Root "edge-server/agenthub-edge-tmp.exe"

$Passed = 0
$Failed = 0
$EdgeProc = $null
$StartedEdge = $false

# Resolve agent CLI path from environment or PATH
function Resolve-PathExecutable([string]$CommandName) {
    $candidates = @(where.exe $CommandName 2>$null)
    foreach ($candidate in $candidates) {
        $value = [string]$candidate
        if ($value -match '\.(exe|cmd|bat|com)$') {
            return $value
        }
    }
    foreach ($candidate in $candidates) {
        $value = [string]$candidate
        if ($value -and $value -notmatch '\.ps1$') {
            return $value
        }
    }

    $found = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($found -and $found.Source -and $found.Source -notmatch '\.ps1$') {
        return $found.Source
    }
    return $null
}

function Resolve-AgentPath([string]$AgentId) {
    switch ($AgentId) {
        "claude-code" {
            $envPath = $env:AGENTHUB_CLAUDE_CODE_PATH
            if ($envPath) { return $envPath }
            $envPath = $env:CLAUDE_PATH
            if ($envPath) { return $envPath }
            return Resolve-PathExecutable "claude"
        }
        "codex" {
            $envPath = $env:AGENTHUB_CODEX_PATH
            if ($envPath) { return $envPath }
            $envPath = $env:CODEX_PATH
            if ($envPath) { return $envPath }
            return Resolve-PathExecutable "codex"
        }
        "opencode" {
            $envPath = $env:AGENTHUB_OPENCODE_PATH
            if ($envPath) { return $envPath }
            $envPath = $env:OPENCODE_PATH
            if ($envPath) { return $envPath }
            return Resolve-PathExecutable "opencode"
        }
        default { return $null }
    }
}

function Get-AgentPathFlag([string]$AgentId) {
    switch ($AgentId) {
        "claude-code" { return "--claude-code-path" }
        "codex" { return "--codex-path" }
        "opencode" { return "--opencode-path" }
        default { throw "unsupported agent: $AgentId" }
    }
}

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
    if ($null -eq $Value) { return '""' }
    if ($Value -notmatch '[\s"]') { return $Value }
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
        if ($stream.Length -eq 0) { return $null }
        return [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
    } catch [System.OperationCanceledException] {
        return $null
    } finally {
        $stream.Dispose()
        $cts.Dispose()
    }
}

function Read-EventErrorSummary($event) {
    if ($null -eq $event -or $null -eq $event.payload -or $null -eq $event.payload.error) {
        return ""
    }
    $errorValue = $event.payload.error
    if ($errorValue -is [string]) {
        return $errorValue
    }
    try {
        return ($errorValue | ConvertTo-Json -Compress -Depth 8)
    } catch {
        return [string]$errorValue
    }
}

# ── Main test logic ─────────────────────────────────────

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

    node --version 2>&1 | Out-Null
    Assert ($LASTEXITCODE -eq 0) "node available"

    $ExistingEdge = Test-EdgeHealth
    if ($ExistingEdge) {
        Fail "Edge already running on $EdgeAddr; stop it first"
        throw "edge already running on $EdgeAddr"
    }

    # ── Resolve agent CLI ──────────────────────────────

    Write-Step "Resolve agent CLI: $Agent"
    $AgentPath = [string](Resolve-AgentPath $Agent)
    if ([string]::IsNullOrWhiteSpace($AgentPath)) {
        Fail "agent CLI not found for $Agent"
        throw "agent CLI not found for $Agent; install it or set AGENTHUB_CLAUDE_CODE_PATH / AGENTHUB_CODEX_PATH / AGENTHUB_OPENCODE_PATH"
    }
    Assert $true "agent CLI found: $AgentPath"
    $TestStrategy = "live runtime ($Agent via $AgentPath)"
    Write-Host "  Strategy: $TestStrategy" -ForegroundColor DarkGray

    # ── Build ──────────────────────────────────────────

    if (-not $SkipBuild) {
        Write-Step "Build Edge Server"
        Push-Location "$Root/edge-server"
        try {
            go build -o $EdgeBinary ./cmd/agenthub-edge/
            Assert (Test-Path $EdgeBinary) "edge-server binary"
        } finally { Pop-Location }
    }

    # ── Start Edge Server ──────────────────────────────

    Write-Step "Start Edge Server"
    if (-not (Test-Path $EdgeBinary)) {
        Fail "edge binary missing: $EdgeBinary"
        throw "edge binary missing"
    }

    $edgeArgs = @("--addr", $EdgeAddr, "--agent-default", $Agent, (Get-AgentPathFlag $Agent), $AgentPath)

    $EdgeProc = Start-EdgeProcess $edgeArgs
    $StartedEdge = $true

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 250
        if ($EdgeProc.HasExited) { break }
        if (Test-EdgeHealth) {
            $ready = $true
            break
        }
    }
    Assert ($ready) "Edge process ready (PID $($EdgeProc.Id))"

    try {
        Assert (-not $EdgeProc.HasExited) "Edge process alive (PID $($EdgeProc.Id))"

        # Health
        Write-Step "GET /v1/health"
        try {
            $health = Invoke-RestMethod -Uri "$EdgeUrl/v1/health" -TimeoutSec 5
            Assert ($health.status -eq "ok") "status=ok"
            Assert ($health.version -eq "v1") "version=v1"
        } catch {
            Fail "health: $_"
        }

        # POST /v1/runs
        Write-Step "POST /v1/runs"
        $run = $null
        try {
            $body = @{
                projectId = "proj_local"
                threadId  = "thread_local"
                prompt    = $Prompt
            }
            $body.agentId = $Agent
            $run = Invoke-RestMethod -Uri "$EdgeUrl/v1/runs" -Method Post -Body ($body | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 10
            Assert ($run.runId -match '^run_') "runId prefix ($($run.runId))"
            Assert ($run.status -eq "queued") "status=queued"
            Write-Host "    runId=$($run.runId)" -ForegroundColor DarkGray
        } catch {
            Fail "POST runs: $_"
        }

        # ── WebSocket event verification ─────────────────

        Write-Step "WebSocket /v1/events — verify event stream"

        $deadline = [DateTime]::UtcNow.AddSeconds($RunTimeoutSec)
        $cursor = 0
        $receivedFrames = 0
        $seenRunEvents = @()
        $firstFramePreview = ""
        $terminalError = ""

        while ([DateTime]::UtcNow -lt $deadline) {
            $ws = New-Object System.Net.WebSockets.ClientWebSocket
            $connectCts = [System.Threading.CancellationTokenSource]::new()
            $connectCts.CancelAfter(5000)
            try {
                $uri = "ws://$EdgeAddr/v1/events?cursor=$cursor"
                $ws.Options.SetRequestHeader("Origin", "http://localhost")
                $null = $ws.ConnectAsync([Uri]$uri, $connectCts.Token).GetAwaiter().GetResult()
                Assert ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) "WS connected"

                while ([DateTime]::UtcNow -lt $deadline -and $ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
                    $raw = Receive-WebSocketText $ws 5000
                    if ([string]::IsNullOrWhiteSpace($raw)) { break }

                    $receivedFrames++
                    if ($firstFramePreview -eq "") {
                        $firstFramePreview = $raw.Substring(0, [Math]::Min(150, $raw.Length))
                        Write-Host "    first frame: $firstFramePreview" -ForegroundColor DarkGray
                    }

                    $event = $raw | ConvertFrom-Json
                    if ($null -ne $event.seq) {
                        $cursor = [int64]$event.seq
                    }

                    # Extract runId from scope or payload
                    $eventRunId = $null
                    if ($null -ne $event.scope -and $null -ne $event.scope.runId) {
                        $eventRunId = [string]$event.scope.runId
                    } elseif ($null -ne $event.payload -and $null -ne $event.payload.runId) {
                        $eventRunId = [string]$event.payload.runId
                    }

                    if ($eventRunId -eq $run.runId) {
                        $seenRunEvents += [string]$event.type
                    }

                    # Stop when we see a terminal lifecycle event for our run
                    if ($eventRunId -eq $run.runId -and $event.type -match '^run\.(finished|failed|cancelled)$') {
                        Write-Host "    terminal event: $($event.type)" -ForegroundColor DarkGray
                        if ($event.type -eq "run.failed") {
                            $terminalError = Read-EventErrorSummary $event
                        }
                        break
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
                    } catch { } finally { $closeCts.Dispose() }
                }
                $ws.Dispose()
            }
            # If we've seen the terminal event, stop looping
            if ($seenRunEvents -match 'run\.(finished|failed|cancelled)') { break }
        }

        Assert ($receivedFrames -gt 0) "received WS frames ($receivedFrames)"
        Write-Host "    run events: $($seenRunEvents -join ', ')" -ForegroundColor DarkGray
        if (-not [string]::IsNullOrWhiteSpace($terminalError)) {
            Write-Host "    terminal error: $terminalError" -ForegroundColor DarkGray
        }

        # ── Verify live runtime events ─────────────────

        Write-Step "Verify live runtime events"

        $hasTextDelta = $seenRunEvents -contains "run.agent.text_delta"
        $hasTextBlock = $seenRunEvents -contains "run.agent.text_block"
        $hasResult = $seenRunEvents -contains "run.agent.result"
        $hasSessionInit = $seenRunEvents -contains "run.agent.session_init"
        $hasThinking = $seenRunEvents -contains "run.agent.thinking"
        $hasToolCall = $seenRunEvents -contains "run.agent.tool_call"
        $hasStarted = $seenRunEvents -contains "run.started"
        $hasFinished = $seenRunEvents -contains "run.finished"
        $hasRuntimeEvent = $hasSessionInit -or $hasTextDelta -or $hasTextBlock -or $hasResult -or $hasThinking -or $hasToolCall

        Assert $hasStarted "run.started present"
        Assert $hasRuntimeEvent "runtime structured event present"
        Assert ($hasTextDelta -or $hasTextBlock -or $hasResult) "runtime output/result present"
        Assert $hasFinished "run.finished present"

        Write-Host "    live runtime events verified: session_init=$hasSessionInit text=$($hasTextDelta -or $hasTextBlock) result=$hasResult thinking=$hasThinking tool_call=$hasToolCall" -ForegroundColor Green

        # ── Verify run completed successfully ───────────

        Write-Step "GET /v1/runs — verify run status"
        try {
            $finalRun = Invoke-RestMethod -Uri "$EdgeUrl/v1/runs/$($run.runId)" -TimeoutSec 5
            $finalStatuses = @("finished", "completed")
            Assert ($finalRun.status -in $finalStatuses) "final run status=$($finalRun.status)"
        } catch {
            Fail "GET run: $_"
        }

    } finally {
        if ($StartedEdge -and $EdgeProc -and -not $EdgeProc.HasExited) {
            Write-Step "Stop Edge Server (PID $($EdgeProc.Id))"
            Stop-Process -Id $EdgeProc.Id -Force -ErrorAction SilentlyContinue
        }
    }

} finally {
    Pop-Location
}

# ── Summary ────────────────────────────────────────────

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Integration smoke: $TestStrategy" -ForegroundColor DarkGray
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

exit $(if ($Failed -eq 0) { 0 } else { 1 })
