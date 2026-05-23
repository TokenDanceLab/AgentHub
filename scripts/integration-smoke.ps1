# AgentHub integration smoke test (Windows / PowerShell)
#
# Starts Edge Server with a real agent CLI, sends a prompt, and
# verifies end-to-end event flow through the WebSocket event stream.
#
# Usage:
#   .\scripts\integration-smoke.ps1
#   .\scripts\integration-smoke.ps1 -SkipBuild
#   .\scripts\integration-smoke.ps1 -Agent claude-code
#   .\scripts\integration-smoke.ps1 -Agent opencode

[CmdletBinding()]
param(
    [switch]$SkipBuild,
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
function Resolve-AgentPath([string]$AgentId) {
    switch ($AgentId) {
        "claude-code" {
            $envPath = $env:CLAUDE_PATH
            if ($envPath) { return $envPath }
            $found = (Get-Command claude -ErrorAction SilentlyContinue)
            if ($found) { return $found.Source }
            return $null
        }
        "codex" {
            $envPath = $env:CODEX_PATH
            if ($envPath) { return $envPath }
            $found = (Get-Command codex -ErrorAction SilentlyContinue)
            if ($found) { return $found.Source }
            return $null
        }
        "opencode" {
            $envPath = $env:OPENCODE_PATH
            if ($envPath) { return $envPath }
            $found = (Get-Command opencode -ErrorAction SilentlyContinue)
            if ($found) { return $found.Source }
            return $null
        }
        default { return $null }
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
    $AgentPath = Resolve-AgentPath $Agent
    $UseRealAgent = ($null -ne $AgentPath)
    if ($UseRealAgent) {
        Assert $true "agent CLI found: $AgentPath"
        $TestStrategy = "real agent ($Agent via $AgentPath)"
    } else {
        Pass "agent CLI not found — falling back to mock executor"
        $TestStrategy = "mock executor (no $Agent binary available)"
    }
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

    $edgeArgs = @("--addr", $EdgeAddr, "--agent-default", $Agent)
    if ($UseRealAgent) {
        # Need a runner-command to force ProcessExecutor creation;
        # the adapter will override the actual command path.
        $edgeArgs += @("--runner-command", $AgentPath)
        $edgeArgs += @("--$Agent-path", $AgentPath)
    }

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
                threadId  = "thread_int"
                prompt    = $Prompt
            }
            if ($UseRealAgent) {
                $body.agentId = $Agent
            }
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

        if ($UseRealAgent) {
            # ── Verify real agent events ─────────────────

            Write-Step "Verify agent events"

            $hasTextDelta = $seenRunEvents -contains "run.agent.text_delta"
            $hasTextBlock = $seenRunEvents -contains "run.agent.text_block"
            $hasResult = $seenRunEvents -contains "run.agent.result"
            $hasSessionInit = $seenRunEvents -contains "run.agent.session_init"
            $hasStarted = $seenRunEvents -contains "run.started"
            $hasFinished = $seenRunEvents -contains "run.finished"

            Assert $hasSessionInit "run.agent.session_init present"
            Assert $hasStarted "run.started present"
            Assert ($hasTextDelta -or $hasTextBlock) "text output present (text_delta or text_block)"
            Assert $hasResult "run.agent.result present"
            Assert $hasFinished "run.finished present"

            # Check result success
            # (Re-read via GET if we need to verify the result event payload)
            Write-Host "    agent events verified: session_init=$hasSessionInit text=$($hasTextDelta -or $hasTextBlock) result=$hasResult" -ForegroundColor Green

        } else {
            # ── Verify mock executor events ──────────────

            Write-Step "Verify mock executor events"

            $hasStarted = $seenRunEvents -contains "run.started"
            $hasOutput = $seenRunEvents -contains "run.output.batch"
            $hasFinished = $seenRunEvents -contains "run.finished"

            Assert $hasStarted "run.started present"
            Assert $hasOutput "run.output.batch present"
            Assert $hasFinished "run.finished present"

            Write-Host "    mock events verified: started=$hasStarted output=$hasOutput finished=$hasFinished" -ForegroundColor Green
        }

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
