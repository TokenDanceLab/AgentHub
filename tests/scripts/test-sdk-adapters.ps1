#Requires -Version 7.0
<#
.SYNOPSIS
    AgentHub Edge SDK adapter E2E test -- exercises all Edge adapters with real API keys.

.DESCRIPTION
    Verifies each Edge adapter can complete a run against real LLM APIs:
      1. anthropic-sdk  (HTTP direct -- Anthropic Messages API)
      2. openai-sdk     (HTTP direct -- OpenAI Chat Completions API)
      3. codex          (CLI -- Codex CLI via OPENAI_API_KEY)
      4. claude-code    (CLI -- Claude Code CLI)
      5. opencode       (CLI -- OpenCode CLI)
      6. orchestrator   (meta-adapter -- dispatches to sub-agents)

    Each test:
      - Creates a dedicated thread
      - POSTs a run via Edge /v1/runs with the target adapter
      - Polls until finished (or timeout)
      - Reads thread items (agent output)
      - Verifies the response is non-empty

.NOTES
    Edge server must be running at http://127.0.0.1:3210 with all adapters registered.
    API keys must be configured in the edge-server environment.
#>

[CmdletBinding()]
param(
    [string]$EdgeUrl = "http://127.0.0.1:3210",
    [string]$ProjectId = "proj_sdk_e2e",
    [int]$PollIntervalSec = 5,
    [int]$PollTimeoutSec = 180
)

$ErrorActionPreference = "Stop"
$Failed = 0
$Passed = 0
$Skipped = 0

# ---------- helpers ----------

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message,
        [string]$Details = ""
    )
    if ($Condition) {
        $script:Passed++
        Write-Host "  PASS: $Message" -ForegroundColor Green
        return
    }
    $script:Failed++
    Write-Host "  FAIL: $Message" -ForegroundColor Red
    if ($Details) { Write-Host "        $Details" -ForegroundColor DarkGray }
}

function Invoke-Get {
    param([string]$Url, [int]$TimeoutSec = 15)
    $headers = @{ "Accept" = "application/json" }
    try {
        $resp = Invoke-RestMethod -Uri $Url -Method Get -Headers $headers -TimeoutSec $TimeoutSec -ErrorAction Stop
        return [pscustomobject]@{ OK = $true; Status = 200; Body = $resp }
    }
    catch {
        $status = 0
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        return [pscustomobject]@{ OK = $false; Status = $status; Body = $null; Error = $_.Exception.Message }
    }
}

function Invoke-PostJson {
    param([string]$Url, [object]$Body, [int]$TimeoutSec = 30)
    $headers = @{ "Accept" = "application/json"; "Content-Type" = "application/json" }
    $json = $Body | ConvertTo-Json -Depth 6 -Compress
    try {
        $resp = Invoke-RestMethod -Uri $Url -Method Post -Headers $headers -Body $json -TimeoutSec $TimeoutSec -ErrorAction Stop
        return [pscustomobject]@{ OK = $true; Status = 200; Body = $resp }
    }
    catch {
        $status = 0
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        return [pscustomobject]@{ OK = $false; Status = $status; Body = $null; Error = $_.Exception.Message }
    }
}

function Ensure-ProjectAndThread {
    param(
        [string]$ThreadSuffix
    )
    # Ensure project exists (200 = already exists, 201 = created)
    $projBody = @{
        projectId = $ProjectId
        name      = "SDK E2E Test Project"
    }
    $projResp = Invoke-PostJson "$EdgeUrl/v1/projects" $projBody
    # Both OK (exists) and Created are fine; non-success is logged but non-fatal.

    # Create thread
    $threadId = "thread_sdk_${ThreadSuffix}_$(Get-Random)"
    $threadBody = @{
        projectId = $ProjectId
        threadId  = $threadId
        title     = "SDK E2E: $ThreadSuffix"
    }
    $threadResp = Invoke-PostJson "$EdgeUrl/v1/threads" $threadBody
    if (-not $threadResp.OK) {
        Write-Host "  WARN: thread creation status $($threadResp.Status) -- $($threadResp.Error)" -ForegroundColor DarkYellow
    }
    return $threadId
}

function Wait-RunFinished {
    param(
        [string]$RunId,
        [string]$Label
    )
    $pollStart = Get-Date
    $finalStatus = ""
    $pollCount = 0
    do {
        Start-Sleep -Seconds $PollIntervalSec
        $pollCount++
        $pollResp = Invoke-Get "$EdgeUrl/v1/runs/$RunId"
        if ($pollResp.OK) {
            $finalStatus = $pollResp.Body.data.status
            $elapsed = ((Get-Date) - $pollStart).TotalSeconds
            Write-Host "        [$Label] poll #$pollCount : $finalStatus ($([math]::Round($elapsed))s)" -ForegroundColor DarkGray
        } else {
            $elapsed = ((Get-Date) - $pollStart).TotalSeconds
            Write-Host "        [$Label] poll #$pollCount : HTTP $($pollResp.Status) ($([math]::Round($elapsed))s)" -ForegroundColor DarkGray
        }
        if ($elapsed -gt $PollTimeoutSec) {
            Write-Host "        [$Label] poll timeout after ${PollTimeoutSec}s" -ForegroundColor Red
            break
        }
    } while ($finalStatus -in @("queued", "started", "cancelling"))

    return $finalStatus
}

function Get-RunOutput {
    param(
        [string]$ThreadId,
        [string]$RunId
    )
    $itemsResp = Invoke-Get "$EdgeUrl/v1/threads/$ThreadId/items"
    if (-not $itemsResp.OK) {
        return $null
    }
    $items = @($itemsResp.Body.data.items)
    # Filter to agent_message items from this run
    $agentItems = $items | Where-Object {
        $_.runId -eq $RunId -and $_.type -eq "agent_message"
    }
    if ($agentItems.Count -gt 0) {
        $text = ($agentItems | ForEach-Object { $_.content }) -join "`n"
        return $text
    }
    # Fallback: any non-user_message/run/permission_request item from this run
    $fallback = $items | Where-Object {
        $_.runId -eq $RunId -and $_.type -notin @("user_message", "run", "permission_request")
    }
    if ($fallback.Count -gt 0) {
        $text = ($fallback | ForEach-Object { $_.content }) -join "`n"
        return $text
    }
    return $null
}

function Test-Adapter {
    param(
        [string]$AdapterId,
        [string]$Model,
        [string]$Prompt,
        [string]$Label,
        [string]$PermissionMode = "default",
        [hashtable]$ExtraParams = @{}
    )

    Write-Host ""
    Write-Host "--- Testing: $Label ($AdapterId) ---" -ForegroundColor Yellow
    Write-Host "  Adapter: $AdapterId  Model: $Model" -ForegroundColor DarkGray

    # Create isolated thread
    $threadId = Ensure-ProjectAndThread $AdapterId
    Write-Host "  Thread: $threadId" -ForegroundColor DarkGray

    # Create run
    $runBody = @{
        projectId = $ProjectId
        threadId  = $threadId
        agentId   = $AdapterId
        model     = $Model
        prompt    = $Prompt
        permissionMode = $PermissionMode
        ephemeral = $true
    }
    foreach ($key in $ExtraParams.Keys) {
        $runBody[$key] = $ExtraParams[$key]
    }

    $createRun = Invoke-PostJson "$EdgeUrl/v1/runs" $runBody 120
    if (-not $createRun.OK) {
        Assert-True $false "POST /v1/runs returns success for $AdapterId" "status: $($createRun.Status) -- $($createRun.Error)"
        return
    }

    $runData = $createRun.Body.data
    $runId = $runData.runId
    Assert-True ($runId -ne "") "Run created with non-empty runId" "runId: $runId"
    Assert-True ($runData.status -in @("queued", "started")) "Run initial status is queued or started" "status: $($runData.status)"

    # Poll until finished
    $finalStatus = Wait-RunFinished $runId $Label
    Assert-True ($finalStatus -eq "finished") "Run finished successfully" "final: $finalStatus"

    # Read output
    $output = Get-RunOutput $threadId $runId
    if ($null -ne $output -and $output.Trim() -ne "") {
        # Truncate for display
        $preview = if ($output.Length -gt 200) { $output.Substring(0, 200) + "..." } else { $output }
        Write-Host "  Output preview: $preview" -ForegroundColor DarkGray
        Assert-True $true "$Label produced non-empty response ($($output.Length) chars)"
    } else {
        # Even a failed run may have error output as agent_message
        Assert-True $false "$Label produced non-empty response" "output was null or empty"
    }
}

# ---------- preflight ----------

Write-Host ""
Write-Host "=== AgentHub Edge SDK Adapter E2E Tests ===" -ForegroundColor Cyan
Write-Host "  Edge:   $EdgeUrl" -ForegroundColor DarkGray
Write-Host "  Poll:   interval=${PollIntervalSec}s timeout=${PollTimeoutSec}s" -ForegroundColor DarkGray
Write-Host ""

# Preflight: Edge health
Write-Host "--- Preflight: Edge Health ---" -ForegroundColor Yellow
$health = Invoke-Get "$EdgeUrl/v1/health"
Assert-True $health.OK "Edge GET /v1/health returns success" $health.Error
if ($health.OK) {
    $d = $health.Body.data
    Assert-True ($d.status -eq "ok") "Edge status is ok" "got: $($d.status)"
    Assert-True ($d.checks.adapters.status -eq "ok") "Adapters check is ok"
    Assert-True ($d.checks.executor.status -eq "ok") "Executor check is ok"
}
Write-Host ""

# Preflight: List adapters
Write-Host "--- Preflight: Adapter Inventory ---" -ForegroundColor Yellow
$agentsResp = Invoke-Get "$EdgeUrl/v1/agents"
Assert-True $agentsResp.OK "GET /v1/agents returns success"
if ($agentsResp.OK) {
    $agents = @($agentsResp.Body.data.items)
    Assert-True ($agents.Count -ge 6) "At least 6 adapters registered" "count: $($agents.Count)"
    foreach ($a in $agents) {
        $icon = if ($a.status -eq "available") { "+" } else { "-" }
        Write-Host "        [$icon] $($a.id): $($a.name) ($($a.status))" -ForegroundColor DarkGray
    }
}
Write-Host ""

# ---------- 1. Anthropic SDK E2E ----------

Test-Adapter `
    -AdapterId "anthropic-sdk" `
    -Model "claude-sonnet-4-6" `
    -Prompt "Say hello and tell me what model you are. Be brief, one sentence." `
    -Label "Anthropic SDK"

# ---------- 2. OpenAI SDK E2E ----------

Test-Adapter `
    -AdapterId "openai-sdk" `
    -Model "gpt-5.5" `
    -Prompt "Say hello and tell me what model you are. Be brief, one sentence." `
    -Label "OpenAI SDK"

# ---------- 3. Codex CLI E2E ----------

Test-Adapter `
    -AdapterId "codex" `
    -Model "gpt-5.5" `
    -Prompt "Say hello and tell me what model you are. Be brief, one sentence." `
    -Label "Codex CLI"

# ---------- 4. Claude Code CLI E2E ----------

Test-Adapter `
    -AdapterId "claude-code" `
    -Model "claude-sonnet-4-6" `
    -Prompt "Say hello and tell me what model you are. Be brief, one sentence." `
    -Label "Claude Code CLI"

# ---------- 5. OpenCode CLI E2E ----------

Test-Adapter `
    -AdapterId "opencode" `
    -Model "newapi/deepseek-v4-pro" `
    -Prompt "Say hello and tell me what model you are. Be brief, one sentence." `
    -Label "OpenCode CLI"

# ---------- 6. Orchestrator E2E ----------

Test-Adapter `
    -AdapterId "orchestrator" `
    -Model "claude-sonnet-4-6" `
    -Prompt "Say hello and tell me what model you are. Be brief, one sentence. Do not spawn sub-agents for this simple task." `
    -Label "Orchestrator"

# ---------- summary ----------

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "  Adapter E2E Results" -ForegroundColor Cyan
Write-Host "  Passed:  $Passed" -ForegroundColor Green
Write-Host "  Failed:  $Failed" -ForegroundColor $(if ($Failed -gt 0) { "Red" } else { "Green" })
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

if ($Failed -gt 0) { exit 1 }
exit 0
