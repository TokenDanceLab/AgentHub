#Requires -Version 7.0
<#
.SYNOPSIS
    AgentHub real API smoke test -- exercises Hub + Edge with real JWT-minted tokens.

.DESCRIPTION
    Verifies the full data path:
      1. Hub health (GET /health)
      2. Edge health (GET /v1/health) + runners online
      3. Hub auth-protected endpoints with a minted JWT:
         - List contacts  (GET  /client/contacts)
         - List sessions  (GET  /client/sessions)
         - List documents (GET  /web/documents)
         - Create document (POST /web/documents)
         - Delete document (DELETE /web/documents/:id) -- cleanup
      4. Edge run lifecycle:
         - Create thread (POST /v1/threads)
         - Create run    (POST /v1/runs)
         - Poll run until finished
         - Verify run in history

.NOTES
    Requires Node.js on PATH for JWT minting.
    Hub and Edge must already be running.
    Prerequisite: Hub DB seeded with test_dev_user (3ecadf58-012a-4fc5-9170-61976cdac5a7).
#>

[CmdletBinding()]
param(
    [string]$HubUrl = "http://127.0.0.1:8080",
    [string]$EdgeUrl = "http://127.0.0.1:3210",
    [string]$JwtSecret = "agenthub-local-dev-secret-key-32chars-min",
    [string]$TestUserId = "3ecadf58-012a-4fc5-9170-61976cdac5a7",
    [string]$EdgeProjectId = "proj_local",
    [int]$PollIntervalSec = 3,
    [int]$PollTimeoutSec = 120
)

$ErrorActionPreference = "Stop"
$Failed = 0

# ---------- helpers ----------

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message,
        [string]$Details = ""
    )
    if ($Condition) {
        Write-Host "  PASS: $Message" -ForegroundColor Green
        return
    }
    $script:Failed++
    Write-Host "  FAIL: $Message" -ForegroundColor Red
    if ($Details) { Write-Host "        $Details" }
}

function Invoke-Get {
    param([string]$Url, [string]$Token = "")
    $headers = @{ "Accept" = "application/json" }
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }
    try {
        $resp = Invoke-RestMethod -Uri $Url -Method Get -Headers $headers -TimeoutSec 10 -ErrorAction Stop
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
    param([string]$Url, [object]$Body, [string]$Token = "", [int]$TimeoutSec = 30)
    $headers = @{ "Accept" = "application/json"; "Content-Type" = "application/json" }
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }
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

function Invoke-Delete {
    param([string]$Url, [string]$Token = "")
    $headers = @{ "Accept" = "application/json" }
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }
    try {
        $resp = Invoke-RestMethod -Uri $Url -Method Delete -Headers $headers -TimeoutSec 10 -ErrorAction Stop
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

function New-TestJwt {
    param([string]$Secret, [string]$UserId, [string]$DeviceType = "web")
    # Use Node.js to mint a JWT compatible with hub-server/internal/jwtutil
    $escapedSecret = $Secret -replace "'", "\'"
    $escapedUserId = $UserId -replace "'", "\'"
    $script = @"
const crypto = require('crypto');

function base64url(buf) {
    return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

const header = { alg: 'HS256', typ: 'JWT' };
const now = Math.floor(Date.now() / 1000);
const payload = {
    user_id: '$escapedUserId',
    device_type: '$DeviceType',
    device_id: 'e2e-device-001',
    iss: 'agenthub-hub',
    aud: ['agenthub-api'],
    sub: '$escapedUserId',
    iat: now,
    exp: now + 3600
};

const h = base64url(Buffer.from(JSON.stringify(header)));
const p = base64url(Buffer.from(JSON.stringify(payload)));
const sig = crypto.createHmac('sha256', '$escapedSecret').update(h + '.' + p).digest();
const s = base64url(sig);
process.stdout.write(h + '.' + p + '.' + s);
"@
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-e2e-jwt-$PID.cjs"
    Set-Content -LiteralPath $tmp -Value $script -Encoding UTF8
    try {
        $token = & node $tmp 2>&1
        if ($LASTEXITCODE -ne 0) { throw "node failed: $token" }
        return $token.Trim()
    }
    finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

# ---------- run ----------

Write-Host ""
Write-Host "=== AgentHub Real API Smoke Test ===" -ForegroundColor Cyan
Write-Host "  Hub:    $HubUrl" -ForegroundColor DarkGray
Write-Host "  Edge:   $EdgeUrl" -ForegroundColor DarkGray
Write-Host "  User:   $TestUserId" -ForegroundColor DarkGray
Write-Host ""

# Step 1: Hub health
Write-Host "--- 1. Hub Health ---" -ForegroundColor Yellow
$hub = Invoke-Get "$HubUrl/health"
Assert-True $hub.OK "Hub GET /health returns success" $hub.Error
if ($hub.OK) {
    $d = $hub.Body.data
    Assert-True ($d.status -eq "ok") "Hub status is 'ok'" ("got: " + $d.status)
    Assert-True ($d.live -eq $true) "Hub reports live=true"
    Assert-True ($d.ready -eq $true) "Hub reports ready=true"
    Assert-True ($d.checks.database -eq "ok") "Hub database is 'ok'" ("got: " + $d.checks.database)
    Assert-True ($d.checks.redis -eq "ok") "Hub Redis is 'ok'" ("got: " + $d.checks.redis)
    Write-Host "        uptime: $($d.uptime)  migrations: $($d.checks.migrations)" -ForegroundColor DarkGray
}
Write-Host ""

# Step 2: Edge health
Write-Host "--- 2. Edge Health ---" -ForegroundColor Yellow
$edge = Invoke-Get "$EdgeUrl/v1/health"
Assert-True $edge.OK "Edge GET /v1/health returns success" $edge.Error
if ($edge.OK) {
    $d = $edge.Body.data
    Assert-True ($d.status -eq "ok") "Edge status is 'ok'" ("got: " + $d.status)
    $rs = $d.checks.runners
    Assert-True ($rs.status -eq "ok") "Edge runners status is 'ok'" ("got: " + $rs.status)
    Assert-True ($rs.available -ge 1) "At least 1 runner available" ("available: " + $rs.available)
    Write-Host "        edgeId: $($d.edgeId)  version: $($d.version)" -ForegroundColor DarkGray
}
Write-Host ""

# Step 3: Edge runners list
Write-Host "--- 3. Edge Runners ---" -ForegroundColor Yellow
$runners = Invoke-Get "$EdgeUrl/v1/runners"
Assert-True $runners.OK "Edge GET /v1/runners returns success" $runners.Error
if ($runners.OK) {
    $items = @($runners.Body.data.items)
    Assert-True ($items.Count -ge 1) "Runners list is non-empty" ("count: " + $items.Count)
    if ($items.Count -gt 0) {
        $r = $items[0]
        Assert-True ($r.status -eq "online") "First runner is online" ("status: " + $r.status)
        Assert-True ($r.id -ne "") "Runner has non-empty id"
        Write-Host "        runner: $($r.id) [$($r.name)] -- $($r.status)" -ForegroundColor DarkGray
        Write-Host "        capabilities: $($r.capabilities -join ', ')" -ForegroundColor DarkGray
    }
}
Write-Host ""

# Step 4: Mint JWT and test Hub authenticated endpoints
Write-Host "--- 4. Hub Auth-Protected Endpoints ---" -ForegroundColor Yellow
$token = New-TestJwt $JwtSecret $TestUserId "web"
Assert-True ($token.Length -gt 20) "JWT token minted successfully" ("length: " + $token.Length)
Write-Host ""

# 4a: List contacts
Write-Host "  4a. Contacts" -ForegroundColor DarkYellow
$contacts = Invoke-Get "$HubUrl/client/contacts" $token
Assert-True $contacts.OK "GET /client/contacts returns success" $contacts.Error
if ($contacts.OK) {
    $body = $contacts.Body
    Assert-True ($body.code -eq "OK") "Contacts response code is OK" ("got: " + $body.code)
    $cList = @($body.data)
    Write-Host "        contacts count: $($cList.Count)" -ForegroundColor DarkGray
}
Write-Host ""

# 4b: List sessions
Write-Host "  4b. Sessions" -ForegroundColor DarkYellow
$sessions = Invoke-Get "$HubUrl/client/sessions" $token
Assert-True $sessions.OK "GET /client/sessions returns success" $sessions.Error
if ($sessions.OK) {
    $body = $sessions.Body
    Assert-True ($body.code -eq "OK") "Sessions response code is OK" ("got: " + $body.code)
    $sList = @($body.data)
    Write-Host "        sessions count: $($sList.Count)" -ForegroundColor DarkGray
}
Write-Host ""

# 4c: List documents
Write-Host "  4c. Documents (list)" -ForegroundColor DarkYellow
$docs = Invoke-Get "$HubUrl/web/documents" $token
Assert-True $docs.OK "GET /web/documents returns success" $docs.Error
if ($docs.OK) {
    $body = $docs.Body
    Assert-True ($body.code -eq "OK") "Documents response code is OK" ("got: " + $body.code)
    $dItems = @($body.data.items)
    Write-Host "        documents count: $($dItems.Count)" -ForegroundColor DarkGray
}
Write-Host ""

# 4d: Create document
Write-Host "  4d. Document (create)" -ForegroundColor DarkYellow
$docBody = @{
    title   = "E2E Smoke Test Document"
    content = "# Smoke Test`n`nCreated by verify-real-api-smoke.ps1 at $(Get-Date -Format 'o')"
    tags    = @("e2e", "smoke-test")
}
$createDoc = Invoke-PostJson "$HubUrl/web/documents" $docBody $token
Assert-True ($createDoc.Status -in @(200, 201)) "POST /web/documents returns 2xx" ("status: $($createDoc.Status)")
if ($createDoc.OK) {
    $body = $createDoc.Body
    Assert-True ($body.code -eq "OK") "Create document response code is OK" ("got: " + $body.code)
    $docId = $body.data.id
    Assert-True ($docId -ne "") "Created document has non-empty id" ("id: $docId")
    Write-Host "        document id: $docId" -ForegroundColor DarkGray

    # 4e: Get the created document back
    Write-Host "  4e. Document (get)" -ForegroundColor DarkYellow
    $getDoc = Invoke-Get "$HubUrl/web/documents/$docId" $token
    Assert-True $getDoc.OK "GET /web/documents/$docId returns success" $getDoc.Error
    if ($getDoc.OK -and $getDoc.Body.code -eq "OK") {
        Assert-True ($getDoc.Body.data.title -eq "E2E Smoke Test Document") "Document title matches"
        Assert-True ($getDoc.Body.data.owner_id -eq $TestUserId) "Document owner matches test user"
    }

    # 4f: Delete the document (cleanup)
    Write-Host "  4f. Document (delete)" -ForegroundColor DarkYellow
    $delDoc = Invoke-Delete "$HubUrl/web/documents/$docId" $token
    Assert-True ($delDoc.OK -or $delDoc.Status -in @(200, 204)) "DELETE /web/documents/$docId returns success" $delDoc.Error
    Write-Host "        cleanup: deleted document $docId" -ForegroundColor DarkGray
}
Write-Host ""

# Step 5: Edge run lifecycle
Write-Host "--- 5. Edge Run Lifecycle ---" -ForegroundColor Yellow

# 5a: Create a unique thread for this test run
$threadId = "thread_e2e_smoke_$(Get-Random)"
Write-Host "  5a. Create thread ($threadId)" -ForegroundColor DarkYellow
$threadBody = @{
    projectId = $EdgeProjectId
    threadId  = $threadId
    title     = "E2E Smoke Test Thread"
}
$createThread = Invoke-PostJson "$EdgeUrl/v1/threads" $threadBody
Assert-True ($createThread.Status -in @(200, 201, 409)) "POST /v1/threads returns 2xx or 409 (exists)" ("status: $($createThread.Status)")
if ($createThread.OK) {
    Assert-True ($createThread.Body.code -eq "OK") "Thread creation code is OK"
    Write-Host "        thread: $threadId in $EdgeProjectId" -ForegroundColor DarkGray
}
Write-Host ""

# 5b: Create a run
Write-Host "  5b. Create run" -ForegroundColor DarkYellow
$runBody = @{
    projectId = $EdgeProjectId
    threadId  = $threadId
    prompt    = "Reply with exactly: E2E_SMOKE_OK"
    agentId   = "claude-code"
    ephemeral = $true
}
$createRun = Invoke-PostJson "$EdgeUrl/v1/runs" $runBody "" 120
Assert-True ($createRun.Status -in @(200, 201, 202)) "POST /v1/runs returns 2xx" ("status: $($createRun.Status) -- error: $($createRun.Error)")
if ($createRun.OK) {
    $runData = $createRun.Body.data
    $runId = $runData.runId
    Assert-True ($runId -ne "") "Run has non-empty runId" ("runId: $runId")
    Assert-True ($runData.status -in @("queued", "started")) "Run initial status is queued or started" ("status: " + $runData.status)
    Write-Host "        runId: $runId  initial status: $($runData.status)" -ForegroundColor DarkGray

    # 5c: Poll until finished
    Write-Host "  5c. Poll run status (interval: ${PollIntervalSec}s, timeout: ${PollTimeoutSec}s)" -ForegroundColor DarkYellow
    $pollStart = Get-Date
    $finalStatus = ""
    $pollCount = 0
    do {
        Start-Sleep -Seconds $PollIntervalSec
        $pollCount++
        $pollResp = Invoke-Get "$EdgeUrl/v1/runs/$runId"
        if ($pollResp.OK) {
            $finalStatus = $pollResp.Body.data.status
            $elapsed = ((Get-Date) - $pollStart).TotalSeconds
            Write-Host "        poll #$pollCount : $finalStatus (${elapsed:N0}s)" -ForegroundColor DarkGray
        } else {
            $elapsed = ((Get-Date) - $pollStart).TotalSeconds
            Write-Host "        poll #$pollCount : HTTP $($pollResp.Status) (${elapsed:N0}s)" -ForegroundColor DarkGray
        }
        if ($elapsed -gt $PollTimeoutSec) {
            Write-Host "        poll timeout after ${PollTimeoutSec}s" -ForegroundColor Red
            break
        }
    } while ($finalStatus -in @("queued", "started", "cancelling"))

    $terminalStates = @("finished", "failed", "cancelled")
    Assert-True ($finalStatus -in $terminalStates) "Run reached terminal state" ("final: $finalStatus")
    Assert-True ($finalStatus -eq "finished") "Run finished successfully" ("final: $finalStatus")
    Write-Host ""

    # 5d: Verify run is in the list
    Write-Host "  5d. Run appears in history" -ForegroundColor DarkYellow
    $listRuns = Invoke-Get "$EdgeUrl/v1/runs?projectId=$EdgeProjectId"
    Assert-True $listRuns.OK "GET /v1/runs?projectId=$EdgeProjectId returns success"
    if ($listRuns.OK) {
        $items = @($listRuns.Body.data.items)
        $found = $items | Where-Object { $_.runId -eq $runId }
        Assert-True ($null -ne $found) "Created runId found in runs list" ("searching for: $runId in $($items.Count) items")
    }
} else {
    Write-Host "        Skipping run lifecycle test (run creation failed)" -ForegroundColor Red
}
Write-Host ""

# Step 6: Edge existing runs summary
Write-Host "--- 6. Edge Runs History ---" -ForegroundColor Yellow
$allRuns = Invoke-Get "$EdgeUrl/v1/runs"
Assert-True $allRuns.OK "GET /v1/runs returns success"
if ($allRuns.OK) {
    $items = @($allRuns.Body.data.items)
    Assert-True ($items.Count -ge 1) "Edge has at least 1 historical run" ("count: " + $items.Count)
    $finished = @($items | Where-Object { $_.status -eq "finished" })
    Write-Host "        total runs: $($items.Count)  finished: $($finished.Count)" -ForegroundColor DarkGray
}
Write-Host ""

# Step 7: Edge threads and projects
Write-Host "--- 7. Edge Projects & Threads ---" -ForegroundColor Yellow
$projects = Invoke-Get "$EdgeUrl/v1/projects"
Assert-True $projects.OK "GET /v1/projects returns success"
if ($projects.OK) {
    $pItems = @($projects.Body.data.items)
    Assert-True ($pItems.Count -ge 1) "At least 1 project exists" ("count: " + $pItems.Count)
    Write-Host "        projects: $($pItems | ForEach-Object { $_.projectId } | Join-String -Separator ', ')" -ForegroundColor DarkGray
}

$threads = Invoke-Get "$EdgeUrl/v1/threads"
Assert-True $threads.OK "GET /v1/threads returns success"
if ($threads.OK) {
    $tItems = @($threads.Body.data.items)
    Assert-True ($tItems.Count -ge 1) "At least 1 thread exists" ("count: " + $tItems.Count)
    Write-Host "        threads: $($tItems.Count)" -ForegroundColor DarkGray
}
Write-Host ""

# ---------- summary ----------

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
if ($Failed -eq 0) {
    Write-Host "  ALL PASSED (0 failures)" -ForegroundColor Green
} else {
    Write-Host "  $Failed FAILURE(S)" -ForegroundColor Red
}
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

if ($Failed -gt 0) { exit 1 }
exit 0
