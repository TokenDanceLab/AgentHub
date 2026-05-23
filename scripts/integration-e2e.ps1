# AgentHub E2E Integration Test
# Runs a real Claude Code prompt through edge-server and validates the event stream.
# Usage: .\scripts\integration-e2e.ps1 [-SkipBuild] [-Agent claude-code|opencode]
param(
  [switch]$SkipBuild,
  [string]$Agent = "claude-code"
)

$ErrorActionPreference = "Stop"
$Port = 3299
$BaseUrl = "http://127.0.0.1:$Port"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path "$ScriptDir\.."

Write-Host "=== AgentHub Integration E2E ===" -ForegroundColor Cyan
Write-Host "Agent: $Agent | Port: $Port"

# ── Build ──────────────────────
if (-not $SkipBuild) {
  Write-Host "[1/5] Building edge-server..." -ForegroundColor Yellow
  Push-Location "$RepoRoot\edge-server"
  try {
    go build -o "$env:TEMP\agenthub-edge-e2e.exe" .\cmd\agenthub-edge\
    Write-Host "  Build OK" -ForegroundColor Green
  } finally { Pop-Location }
} else {
  Write-Host "[1/5] Skipping build (-SkipBuild)" -ForegroundColor Yellow
}

# ── Start Server ───────────────
Write-Host "[2/5] Starting edge-server..." -ForegroundColor Yellow
$env:AGENTHUB_STORE = "$env:TEMP\agenthub-e2e-store.json"
$ServerArgs = @(
  "--addr", "127.0.0.1:$Port"
)
if ($Agent -eq "claude-code") {
  $ServerArgs += "--claude-code-path", (Get-Command claude -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
  $ServerArgs += "--agent-default", "claude-code"
  if (-not $ServerArgs[-2]) {
    Write-Host "  SKIP: claude not found in PATH" -ForegroundColor DarkYellow
    exit 0
  }
} elseif ($Agent -eq "opencode") {
  $openCodePath = $env:OPENCODE_PATH ?? "opencode"
  $ServerArgs += "--opencode-path", $openCodePath
  $ServerArgs += "--agent-default", "opencode"
}

$Server = Start-Process -FilePath "$env:TEMP\agenthub-edge-e2e.exe" `
  -ArgumentList $ServerArgs -PassThru -NoNewWindow

# ── Health Check ───────────────
Write-Host "[3/5] Waiting for health check..." -ForegroundColor Yellow
$Timeout = 30
$Start = Get-Date
do {
  Start-Sleep -Milliseconds 500
  try { $Health = Invoke-RestMethod "$BaseUrl/v1/health" -TimeoutSec 2; break }
  catch {}
} while (((Get-Date) - $Start).TotalSeconds -lt $Timeout)

if (-not $Health) {
  Write-Host "  FAIL: Server did not become healthy within ${Timeout}s" -ForegroundColor Red
  Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "  Health OK: $($Health.status)" -ForegroundColor Green

# ── Create Run ─────────────────
Write-Host "[4/6] Setting up project/thread..." -ForegroundColor Yellow
try {
  $null = Invoke-RestMethod "$BaseUrl/v1/projects" -Method Post -Body (@{projectId="proj_e2e"; name="E2E Test"} | ConvertTo-Json) `
    -ContentType "application/json; charset=utf-8" -TimeoutSec 5
  $null = Invoke-RestMethod "$BaseUrl/v1/threads" -Method Post -Body (@{threadId="thread_e2e"; projectId="proj_e2e"; title="E2E Thread"} | ConvertTo-Json) `
    -ContentType "application/json; charset=utf-8" -TimeoutSec 5
  Write-Host "  Project/Thread OK" -ForegroundColor Green
} catch {
  Write-Host "  Project/Thread may already exist: $_" -ForegroundColor DarkYellow
}

Write-Host "[5/6] Creating run..." -ForegroundColor Yellow
$Body = @{
  projectId = "proj_e2e"
  threadId  = "thread_e2e"
  prompt    = "reply with just the word ok and nothing else"
  model     = "claude-haiku-4-5"
} | ConvertTo-Json

try {
  $Run = Invoke-RestMethod "$BaseUrl/v1/runs" -Method Post -Body $Body `
    -ContentType "application/json; charset=utf-8" -TimeoutSec 10
  Write-Host "  Run created: $($Run.runId)" -ForegroundColor Green
} catch {
  Write-Host "  FAIL: $_" -ForegroundColor Red
  Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

# ── Verify Events via WebSocket ─
Write-Host "[6/6] Listening for events..." -ForegroundColor Yellow

$Events = [System.Collections.ArrayList]::new()
$Done = $false
$WS = [System.Net.WebSockets.ClientWebSocket]::new()
$CT = (New-Object System.Threading.CancellationToken)

try {
  $WS.ConnectAsync("ws://127.0.0.1:$Port/v1/events", $CT).Wait(10000)
  $Buffer = [byte[]]::new(65536)

  while (-not $Done -and $WS.State -eq "Open") {
    $Segment = [ArraySegment[byte]]::new($Buffer)
    $Result = $WS.ReceiveAsync($Segment, $CT).Wait(30000)
    if (-not $Result) { break }

    $json = [Text.Encoding]::UTF8.GetString($Buffer, 0, $Segment.Count)
    $json -split "`n" | Where-Object { $_ -match '\S' } | ForEach-Object {
      try {
        $evt = $_ | ConvertFrom-Json
        [void]$Events.Add($evt)
        if ($evt.type -eq "run.finished") { $Done = $true }
        if ($evt.type -eq "run.failed")  { $Done = $true }
      } catch {}
    }
  }
} finally {
  $WS.Dispose()
  Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
  Remove-Item $env:AGENTHUB_STORE -Force -ErrorAction SilentlyContinue
}

# ── Assertions ─────────────────
$Passed = 0
$Failed = 0

function Assert($Name, $Condition) {
  if ($Condition) {
    Write-Host "  ✓ $Name" -ForegroundColor Green
    $script:Passed++
  } else {
    Write-Host "  ✗ $Name" -ForegroundColor Red
    $script:Failed++
  }
}

Write-Host "`n=== Results ===" -ForegroundColor Cyan

$TextDeltas = $Events | Where-Object { $_.type -eq "run.agent.text_delta" }
$TextBlocks = $Events | Where-Object { $_.type -eq "run.agent.text_block" }
$TextOutput = $TextDeltas.Count -gt 0 -or $TextBlocks.Count -gt 0
$Result = $Events | Where-Object { $_.type -eq "run.agent.result" }
$Finished = $Events | Where-Object { $_.type -eq "run.finished" }
$FailedEvt = $Events | Where-Object { $_.type -eq "run.failed" }

Assert "Server accepted run" ($Run.runId -ne $null)
Assert "Received text events" ($TextOutput)
Assert "Received result event" ($Result.Count -gt 0)
Assert "Run finished successfully" ($Finished.Count -gt 0 -and $FailedEvt.Count -eq 0)
Assert "Total events received" ($Events.Count -gt 5)

Write-Host "`nEvents: text=$($TextDeltas.Count + $TextBlocks.Count) result=$($Result.Count) total=$($Events.Count)"
Write-Host "Passed: $Passed, Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })

exit $Failed
