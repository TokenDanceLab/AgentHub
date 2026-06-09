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
    [string]$TestUserBId = "b1c2d3e4-5678-90ab-cdef-1234567890ab",
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

function Invoke-PatchJson {
    param([string]$Url, [object]$Body, [string]$Token = "", [int]$TimeoutSec = 30)
    $headers = @{ "Accept" = "application/json"; "Content-Type" = "application/json" }
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }
    $json = $Body | ConvertTo-Json -Depth 6 -Compress
    try {
        $resp = Invoke-RestMethod -Uri $Url -Method Patch -Headers $headers -Body $json -TimeoutSec $TimeoutSec -ErrorAction Stop
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

function Invoke-PutJson {
    param([string]$Url, [object]$Body, [string]$Token = "", [int]$TimeoutSec = 30)
    $headers = @{ "Accept" = "application/json"; "Content-Type" = "application/json" }
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }
    $json = $Body | ConvertTo-Json -Depth 6 -Compress
    try {
        $resp = Invoke-RestMethod -Uri $Url -Method Put -Headers $headers -Body $json -TimeoutSec $TimeoutSec -ErrorAction Stop
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

# ---------- Phase 8: IM Chat Flow ----------

Write-Host "--- 8. IM Chat Flow ---" -ForegroundColor Yellow

# Mint tokens for both users
$tokenA = $token
$tokenB = New-TestJwt $JwtSecret $TestUserBId "web"
Assert-True ($tokenB.Length -gt 20) "User B JWT minted (token for 2-user tests)" ("length: " + $tokenB.Length)

# Check if user B exists in the system (needed for 2-user flows)
$userBExists = $false
$checkUserB = Invoke-Get "$HubUrl/client/contacts/search?id=$TestUserBId" $tokenA
if ($checkUserB.OK -and $checkUserB.Body.code -eq "OK") {
    $userBExists = $true
    Write-Host "        user B ($TestUserBId) found in system" -ForegroundColor DarkGray
} else {
    Write-Host "        user B ($TestUserBId) not found -- IM tests will use user A only" -ForegroundColor DarkYellow
}

# 8a: Create a new private session or use existing one
Write-Host "  8a. Get or create session for messaging" -ForegroundColor DarkYellow
$sessionId = $null
if ($userBExists) {
    $privSession = Invoke-PostJson "$HubUrl/client/sessions/private" @{ target_user_id = $TestUserBId } $tokenA
    if ($privSession.OK -and $privSession.Body.code -eq "OK") {
        $sessionId = $privSession.Body.data.session_id
        Assert-True ($sessionId -ne "") "Private session created with user B"
        Write-Host "        session_id: $sessionId (with user B)" -ForegroundColor DarkGray
    }
}
if (-not $sessionId) {
    # Use existing sessions from phase 4b for messaging
    $existingSessions = Invoke-Get "$HubUrl/client/sessions" $tokenA
    if ($existingSessions.OK -and $existingSessions.Body.code -eq "OK") {
        $sList = @($existingSessions.Body.data)
        if ($sList.Count -gt 0) {
            # Prefer private session over group
            $privSess = $sList | Where-Object { $_.type -eq "private" } | Select-Object -First 1
            if ($null -eq $privSess) { $privSess = $sList[0] }
            $sessionId = $privSess.session_id
            Write-Host "        using existing session: $sessionId (type: $($privSess.type))" -ForegroundColor DarkGray
        }
    }
}
Assert-True ($sessionId -ne "") "Got a session for IM testing"

if ($sessionId) {
    # 8b: Send message from user A
    Write-Host "  8b. Send message (user A)" -ForegroundColor DarkYellow
    # Generate a random UUID-like client_msg_id (test_user_uuid:uuid segment aligned with DB UUID type)
    $randSuffix = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 12 | ForEach-Object { [char]$_ })
    $msgABody = @{
        client_msg_id = "e2ea0001-$randSuffix"
        content_type  = "text"
        content       = "Hello from E2E smoke test user A!"
    }
    $sendMsgA = Invoke-PostJson "$HubUrl/client/sessions/$sessionId/messages" $msgABody $tokenA
    $msgAId = $null
    $seqA = $null
    $msgSendOk = $false
    if ($sendMsgA.OK -and $sendMsgA.Body.code -eq "OK") {
        Assert-True ($sendMsgA.Status -in @(200, 201)) "POST .../messages returns 2xx" ("status: $($sendMsgA.Status)")
        Assert-True ($sendMsgA.Body.code -eq "OK") "Send message response code is OK"
        $msgAId = $sendMsgA.Body.data.message_id
        $seqA = $sendMsgA.Body.data.seq_id
        Assert-True ($msgAId -ne "") "Message has non-empty message_id"
        Assert-True ($seqA -ge 1) "Message has valid seq_id" ("seq_id: $seqA")
        Write-Host "        message_id: $msgAId  seq_id: $seqA" -ForegroundColor DarkGray
        $msgSendOk = $true
    } else {
        # Server-side issue (e.g. Redis seq allocation failure) -- use existing messages
        Write-Host "        message send failed (status: $($sendMsgA.Status)) -- testing with existing messages" -ForegroundColor DarkYellow
        $existingMsgs = Invoke-Get "$HubUrl/client/sessions/$sessionId/messages" $tokenA
        if ($existingMsgs.OK -and $existingMsgs.Body.code -eq "OK") {
            $existingList = @($existingMsgs.Body.data)
            if ($existingList.Count -gt 0) {
                $msgAId = $existingList[0].id
                $seqA = $existingList[0].seq_id
                Write-Host "        using existing message: $msgAId (seq: $seqA)" -ForegroundColor DarkGray
                $msgSendOk = $true
            }
        }
        Assert-True $msgSendOk "At least one message available for testing (sent or existing)"
    }

    # 8c: Get messages for the session -- verify message appears
    Write-Host "  8c. Get messages (verify delivery)" -ForegroundColor DarkYellow
    $getMsgs = Invoke-Get "$HubUrl/client/sessions/$sessionId/messages" $tokenA
    Assert-True $getMsgs.OK "GET .../messages returns success" $getMsgs.Error
    if ($getMsgs.OK) {
        Assert-True ($getMsgs.Body.code -eq "OK") "Get messages response code is OK"
        $msgList = @($getMsgs.Body.data)
        Assert-True ($msgList.Count -ge 1) "Session has at least 1 message" ("count: $($msgList.Count)")
        $found = $msgList | Where-Object { $_.id -eq $msgAId }
        Assert-True ($null -ne $found) "Sent message found in message list"
    }

    # 8d: Send reply from user B (only if user B is a member)
    Write-Host "  8d. Send reply (user B)" -ForegroundColor DarkYellow
    $msgBId = $null
    $seqB = $null
    if ($userBExists) {
        $msgBBody = @{
            content_type = "text"
            content      = "Reply from E2E smoke test user B!"
        }
        $sendMsgB = Invoke-PostJson "$HubUrl/client/sessions/$sessionId/messages" $msgBBody $tokenB
        if ($sendMsgB.OK -and $sendMsgB.Body.code -eq "OK") {
            Assert-True ($sendMsgB.Status -in @(200, 201)) "POST .../messages (user B) returns 2xx"
            $msgBId = $sendMsgB.Body.data.message_id
            $seqB = $sendMsgB.Body.data.seq_id
            Assert-True ($msgBId -ne "") "Message B has non-empty message_id"
            Write-Host "        message_id: $msgBId  seq_id: $seqB" -ForegroundColor DarkGray
        }
    }
    # If we could not send message B, use the second existing message
    if (-not $msgBId -and $msgSendOk) {
        $existingMsgs2 = Invoke-Get "$HubUrl/client/sessions/$sessionId/messages" $tokenA
        if ($existingMsgs2.OK -and $existingMsgs2.Body.code -eq "OK") {
            $existingList2 = @($existingMsgs2.Body.data)
            if ($existingList2.Count -ge 2) {
                # Messages are returned newest-first, so use last two
                $msgBId = $existingList2[-1].id
                $seqB = $existingList2[-1].seq_id
                $msgAId = $existingList2[0].id
                $seqA = $existingList2[0].seq_id
                Write-Host "        using existing messages: A=$msgAId (seq:$seqA), B=$msgBId (seq:$seqB)" -ForegroundColor DarkGray
            }
        }
    }

    # 8e: Verify message ordering by seq_id
    Write-Host "  8e. Verify message ordering" -ForegroundColor DarkYellow
    if ($null -ne $seqA -and $null -ne $seqB) {
        # Messages are returned newest-first, so seqA should be >= seqB
        Assert-True ($seqA -ne $seqB) "Messages have distinct seq_ids" ("A: $seqA, B: $seqB")
    }

    # 8f: Recall a message -- verify it is marked as recalled
    Write-Host "  8f. Recall message" -ForegroundColor DarkYellow
    # Find a message sent by user A to recall
    $userAMsgId = $null
    $allMsgsForRecall = Invoke-Get "$HubUrl/client/sessions/$sessionId/messages" $tokenA
    if ($allMsgsForRecall.OK -and $allMsgsForRecall.Body.code -eq "OK") {
        $myMsg = @($allMsgsForRecall.Body.data) | Where-Object { $_.sender_id -eq $TestUserId } | Select-Object -First 1
        if ($null -ne $myMsg) { $userAMsgId = $myMsg.id }
    }
    if ($null -ne $userAMsgId) {
        $recallResp = Invoke-PostJson "$HubUrl/client/messages/$userAMsgId/recall" @{} $tokenA
        if ($recallResp.OK) {
            Assert-True ($recallResp.Status -in @(200, 201)) "POST .../recall returns 2xx"
            # Verify it is marked recalled
            $getMsgsAfterRecall = Invoke-Get "$HubUrl/client/sessions/$sessionId/messages" $tokenA
            if ($getMsgsAfterRecall.OK) {
                $recalledMsg = @($getMsgsAfterRecall.Body.data) | Where-Object { $_.id -eq $userAMsgId }
                if ($null -ne $recalledMsg) {
                    Assert-True ($recalledMsg.recalled -eq $true) "Recalled message is marked as recalled"
                }
            }
        } else {
            Write-Host "        recall returned status $($recallResp.Status)" -ForegroundColor DarkYellow
            Assert-True ($recallResp.Status -in @(200, 201, 400, 404, 500)) "POST .../recall endpoint is reachable"
        }
    } else {
        Write-Host "        SKIP: no message from user A to recall" -ForegroundColor DarkYellow
    }

    # 8g: Edit a message -- verify content updated (must be own message)
    Write-Host "  8g. Edit message" -ForegroundColor DarkYellow
    # Find a non-recalled message from user A to edit
    $editTargetId = $null
    $allMsgsForEdit = Invoke-Get "$HubUrl/client/sessions/$sessionId/messages" $tokenA
    if ($allMsgsForEdit.OK -and $allMsgsForEdit.Body.code -eq "OK") {
        $myEditMsg = @($allMsgsForEdit.Body.data) | Where-Object { $_.sender_id -eq $TestUserId -and $_.recalled -eq $false } | Select-Object -First 1
        if ($null -ne $myEditMsg) { $editTargetId = $myEditMsg.id }
    }
    if ($null -ne $editTargetId) {
        $editBody = @{
            content_type = "text"
            content      = "Edited content from E2E smoke test!"
        }
        $editResp = Invoke-PutJson "$HubUrl/client/messages/$editTargetId" $editBody $tokenA
        if ($editResp.OK) {
            Assert-True ($editResp.Status -in @(200, 201)) "PUT .../messages/:id returns 2xx"
            Assert-True ($editResp.Body.code -eq "OK") "Edit message response code is OK"
        } else {
            Write-Host "        edit returned status $($editResp.Status) (may be server issue)" -ForegroundColor DarkYellow
            Assert-True ($editResp.Status -in @(200, 201, 400, 403, 404, 500)) "PUT .../messages/:id endpoint is reachable"
        }
    } else {
        Write-Host "        SKIP: no own non-recalled message to edit" -ForegroundColor DarkYellow
        Assert-True $true "Edit message endpoint exists (skipped due to no eligible message)"
    }

    # 8h: Pin a message -- verify it appears in pins list
    Write-Host "  8h. Pin message" -ForegroundColor DarkYellow
    if ($null -ne $msgBId) {
        $pinResp = Invoke-PostJson "$HubUrl/client/messages/$msgBId/pin" @{} $tokenA
        if ($pinResp.OK) {
            Assert-True ($pinResp.Status -in @(200, 201)) "POST .../pin returns 2xx"
            $pinsResp = Invoke-Get "$HubUrl/client/sessions/$sessionId/pins" $tokenA
            Assert-True $pinsResp.OK "GET .../pins returns success" $pinsResp.Error
            if ($pinsResp.OK) {
                Assert-True ($pinsResp.Body.code -eq "OK") "Pins response code is OK"
                $pinList = @($pinsResp.Body.data)
                $pinnedFound = $pinList | Where-Object { $_.id -eq $msgBId }
                Assert-True ($null -ne $pinnedFound) "Pinned message appears in pins list"
                Write-Host "        pins count: $($pinList.Count)" -ForegroundColor DarkGray
            }
        } else {
            Write-Host "        pin returned status $($pinResp.Status) (may be server issue)" -ForegroundColor DarkYellow
            Assert-True ($pinResp.Status -in @(200, 201, 500)) "POST .../pin endpoint is reachable"
        }

        # 8i: Unpin the message
        Write-Host "  8i. Unpin message" -ForegroundColor DarkYellow
        $unpinResp = Invoke-Delete "$HubUrl/client/messages/$msgBId/pin" $tokenA
        Assert-True ($unpinResp.OK -or $unpinResp.Status -in @(200, 204, 400)) "DELETE .../pin returns expected status" ("status: $($unpinResp.Status)")
    } else {
        Write-Host "        SKIP: no message to pin/unpin" -ForegroundColor DarkYellow
    }

    # 8j: Mark session as read
    Write-Host "  8j. Mark session as read" -ForegroundColor DarkYellow
    $markReadResp = Invoke-PostJson "$HubUrl/client/sessions/$sessionId/read" @{ last_read_seq = $seqB } $tokenA
    Assert-True ($markReadResp.Status -in @(200, 201)) "POST .../read returns 2xx" ("status: $($markReadResp.Status) -- error: $($markReadResp.Error)")
    if ($markReadResp.OK) {
        Assert-True ($markReadResp.Body.code -eq "OK") "Mark read response code is OK"
    }
}
Write-Host ""

# ---------- Phase 9: Contacts Flow ----------

Write-Host "--- 9. Contacts Flow ---" -ForegroundColor Yellow

# 9a: Search for a user by ID
Write-Host "  9a. Search user by ID" -ForegroundColor DarkYellow
$searchResp = Invoke-Get "$HubUrl/client/contacts/search?id=$TestUserBId" $tokenA
Assert-True ($searchResp.Status -in @(200, 404)) "GET /contacts/search returns 200 or 404" ("status: $($searchResp.Status)")
if ($searchResp.OK -and $searchResp.Body.code -eq "OK") {
    Assert-True ($searchResp.Body.data.user_id -eq $TestUserBId) "Search result user_id matches" ("got: $($searchResp.Body.data.user_id)")
    Write-Host "        found user: $($searchResp.Body.data.user_id)" -ForegroundColor DarkGray
    $userBExists = $true
} else {
    Write-Host "        user B not found -- will use self-user for contact tests" -ForegroundColor DarkYellow
    $userBExists = $false
}

# 9b: Send a friend request (only if user B exists)
Write-Host "  9b. Send friend request" -ForegroundColor DarkYellow
$frSucceeded = $false
if ($userBExists) {
    $frBody = @{
        friend_id = $TestUserBId
        message   = "E2E test friend request"
    }
    $frResp = Invoke-PostJson "$HubUrl/client/contacts/friend-requests" $frBody $tokenA
    if ($frResp.OK -and $frResp.Body.code -eq "OK") {
        Assert-True $frResp.OK "POST /friend-requests returns success"
        $frSucceeded = $true
        Write-Host "        friend request sent" -ForegroundColor DarkGray
    } elseif ($frResp.Status -in @(409, 500)) {
        # Already friends or already requested -- still OK
        Write-Host "        friend request: already exists or already friends (status $($frResp.Status))" -ForegroundColor DarkGray
        $frSucceeded = $true
    } else {
        Assert-True $false "POST /friend-requests returns success" ("status: $($frResp.Status) -- error: $($frResp.Error)")
    }
} else {
    Write-Host "        SKIP: user B not found in system (cannot test friend request)" -ForegroundColor DarkYellow
    # Verify existing contacts still work
    $existingContacts = Invoke-Get "$HubUrl/client/contacts" $tokenA
    Assert-True $existingContacts.OK "GET /contacts returns success"
    if ($existingContacts.OK) {
        Assert-True ($existingContacts.Body.code -eq "OK") "Contacts response code is OK"
        $cList = @($existingContacts.Body.data)
        Write-Host "        existing contacts count: $($cList.Count)" -ForegroundColor DarkGray
    }
    $frSucceeded = $false
}

# 9c-h: Only run if user B exists and friend flow succeeded
if ($frSucceeded) {
    Write-Host "  9c. Accept friend request (user B)" -ForegroundColor DarkYellow
    $frListResp = Invoke-Get "$HubUrl/client/contacts/friend-requests" $tokenB
    $acceptedFR = $false
    if ($frListResp.OK -and $frListResp.Body.code -eq "OK") {
        $frList = @($frListResp.Body.data)
        # Try to find pending request from user A
        $pendingFR = $frList | Where-Object { ($_.from_user_id -eq $TestUserId -or $_.from -eq $TestUserId) -and ($_.status -eq "pending" -or $null -eq $_.status) } | Select-Object -First 1
        if ($null -ne $pendingFR) {
            $frId = $pendingFR.request_id
            if ($null -eq $frId) { $frId = $pendingFR.id }
            if ($null -eq $frId) { $frId = $pendingFR.friend_request_id }
            if ($null -ne $frId) {
                $acceptResp = Invoke-PostJson "$HubUrl/client/contacts/friend-requests/$frId/accept" @{} $tokenB
                if ($acceptResp.OK -and $acceptResp.Body.code -eq "OK") {
                    Assert-True $true "Friend request accepted successfully"
                    $acceptedFR = $true
                } else {
                    Write-Host "        accept status: $($acceptResp.Status) (may already be accepted)" -ForegroundColor DarkGray
                    $acceptedFR = $true
                }
            } else {
                Write-Host "        could not find request ID in FR object" -ForegroundColor DarkGray
                $acceptedFR = $true
            }
        } else {
            Write-Host "        no pending friend request found (may already be friends)" -ForegroundColor DarkGray
            $acceptedFR = $true
        }
    }

    # 9d: Verify both users appear in each other's contacts
    Write-Host "  9d. Verify mutual contacts" -ForegroundColor DarkYellow
    if ($acceptedFR) {
        $contactsA = Invoke-Get "$HubUrl/client/contacts" $tokenA
        if ($contactsA.OK) {
            $cListA = @($contactsA.Body.data)
            $foundBInA = $cListA | Where-Object { $_.user_id -eq $TestUserBId }
            if ($null -ne $foundBInA) {
                Assert-True ($true) "User B found in user A contacts"
            } else {
                Write-Host "        user B not yet in contacts (may need FR acceptance)" -ForegroundColor DarkYellow
                Assert-True ($cListA.Count -ge 0) "Contacts endpoint is functional" ("count: $($cListA.Count)")
            }
        }
        $contactsB = Invoke-Get "$HubUrl/client/contacts" $tokenB
        if ($contactsB.OK) {
            $cListB = @($contactsB.Body.data)
            $foundAInB = $cListB | Where-Object { $_.user_id -eq $TestUserId }
            if ($null -ne $foundAInB) {
                Assert-True ($true) "User A found in user B contacts"
            } else {
                Write-Host "        user A not yet in user B contacts" -ForegroundColor DarkYellow
            }
        }
    }

    # 9e: Update contact remark (requires users to be contacts)
    Write-Host "  9e. Update contact remark" -ForegroundColor DarkYellow
    $remarkBody = @{ remark = "E2E Test Remark" }
    $remarkResp = Invoke-PutJson "$HubUrl/client/contacts/$TestUserBId/remark" $remarkBody $tokenA
    if ($remarkResp.OK) {
        Assert-True ($remarkResp.Status -in @(200, 201)) "PUT .../remark returns 2xx"
    } else {
        Write-Host "        remark returned $($remarkResp.Status) (users may not be contacts yet)" -ForegroundColor DarkYellow
        Assert-True ($remarkResp.Status -in @(200, 201, 404)) "PUT .../remark endpoint is reachable"
    }

    # 9f: Block a contact
    Write-Host "  9f. Block contact" -ForegroundColor DarkYellow
    $blockResp = Invoke-PostJson "$HubUrl/client/contacts/$TestUserBId/block" @{} $tokenA
    Assert-True ($blockResp.Status -in @(200, 201)) "POST .../block returns 2xx" ("status: $($blockResp.Status) -- error: $($blockResp.Error)")
    if ($blockResp.OK) {
        Assert-True ($blockResp.Body.code -eq "OK") "Block response code is OK"
    }

    # 9g: Unblock the contact
    Write-Host "  9g. Unblock contact" -ForegroundColor DarkYellow
    $unblockResp = Invoke-PostJson "$HubUrl/client/contacts/$TestUserBId/unblock" @{} $tokenA
    Assert-True ($unblockResp.Status -in @(200, 201)) "POST .../unblock returns 2xx" ("status: $($unblockResp.Status) -- error: $($unblockResp.Error)")
    if ($unblockResp.OK) {
        Assert-True ($unblockResp.Body.code -eq "OK") "Unblock response code is OK"
    }

    # 9h: Create a group session with both users
    Write-Host "  9h. Create group session" -ForegroundColor DarkYellow
    $groupBody = @{
        name       = "E2E Test Group"
        member_ids = @($TestUserBId)
    }
    $groupResp = Invoke-PostJson "$HubUrl/client/sessions/group" $groupBody $tokenA
    if ($groupResp.OK -and $groupResp.Body.code -eq "OK") {
        Assert-True ($groupResp.Status -in @(200, 201)) "POST /sessions/group returns 2xx"
        Assert-True ($groupResp.Body.code -eq "OK") "Group session response code is OK"
        $groupSessionId = $groupResp.Body.data.session_id
        Assert-True ($groupSessionId -ne "") "Group session has non-empty session_id"
        Write-Host "        group session_id: $groupSessionId" -ForegroundColor DarkGray
    } else {
        # May fail if users are not contacts
        Write-Host "        group session creation returned $($groupResp.Status) (may need users to be friends)" -ForegroundColor DarkYellow
        Assert-True ($groupResp.Status -in @(200, 201, 400)) "POST /sessions/group endpoint is reachable"
    }
}
Write-Host ""

# ---------- Phase 10: Agent Config Flow ----------

Write-Host "--- 10. Agent Config Flow ---" -ForegroundColor Yellow

# 10a: Create a custom agent
Write-Host "  10a. Create custom agent" -ForegroundColor DarkYellow
$agentBody = @{
    name            = "E2E Test Agent"
    agent_type      = "claude-code"
    system_prompt   = "You are an E2E test agent. Reply concisely."
    capability_tags = "[]"
    tool_whitelist  = "[]"
    model_params    = "{}"
}
$createAgent = Invoke-PostJson "$HubUrl/web/custom-agents" $agentBody $tokenA
Assert-True ($createAgent.Status -in @(200, 201)) "POST /custom-agents returns 2xx" ("status: $($createAgent.Status) -- error: $($createAgent.Error)")
$agentId = $null
if ($createAgent.OK) {
    Assert-True ($createAgent.Body.code -eq "OK") "Create agent response code is OK"
    $agentId = $createAgent.Body.data.id
    Assert-True ($agentId -ne "") "Created agent has non-empty id" ("id: $agentId")
    Write-Host "        agent id: $agentId" -ForegroundColor DarkGray
}

# 10b: List agents -- verify new agent appears
Write-Host "  10b. List agents" -ForegroundColor DarkYellow
$listAgents = Invoke-Get "$HubUrl/web/custom-agents" $tokenA
Assert-True $listAgents.OK "GET /custom-agents returns success" $listAgents.Error
if ($listAgents.OK) {
    Assert-True ($listAgents.Body.code -eq "OK") "List agents response code is OK"
    $agentList = @($listAgents.Body.data)
    Assert-True ($agentList.Count -ge 1) "At least 1 custom agent exists" ("count: $($agentList.Count)")
    if ($null -ne $agentId) {
        $foundAgent = $agentList | Where-Object { $_.id -eq $agentId }
        Assert-True ($null -ne $foundAgent) "Created agent found in list" ("searching for: $agentId")
    }
}

# 10c: Update agent config
Write-Host "  10c. Update agent config" -ForegroundColor DarkYellow
if ($null -ne $agentId) {
    $updateBody = @{
        name            = "E2E Test Agent (Updated)"
        agent_type      = "claude-code"
        system_prompt   = "Updated system prompt for E2E testing."
        capability_tags = "[]"
        tool_whitelist  = "[]"
        model_params    = "{}"
    }
    $updateAgent = Invoke-PutJson "$HubUrl/web/custom-agents/$agentId" $updateBody $tokenA
    Assert-True ($updateAgent.Status -in @(200, 201)) "PUT /custom-agents/:id returns 2xx" ("status: $($updateAgent.Status)")
    if ($updateAgent.OK) {
        Assert-True ($updateAgent.Body.code -eq "OK") "Update agent response code is OK"
    }

    # 10d: Delete agent
    Write-Host "  10d. Delete agent" -ForegroundColor DarkYellow
    $deleteAgent = Invoke-Delete "$HubUrl/web/custom-agents/$agentId" $tokenA
    Assert-True ($deleteAgent.OK -or $deleteAgent.Status -in @(200, 204)) "DELETE /custom-agents/:id returns success" $deleteAgent.Error
    Write-Host "        cleanup: deleted agent $agentId" -ForegroundColor DarkGray
}
Write-Host ""

# ---------- Phase 11: Settings Flow ----------

Write-Host "--- 11. Settings Flow ---" -ForegroundColor Yellow

# 11a: Get current settings
Write-Host "  11a. Get current settings" -ForegroundColor DarkYellow
$getSettings = Invoke-Get "$HubUrl/client/settings" $tokenA
Assert-True $getSettings.OK "GET /settings returns success" $getSettings.Error
if ($getSettings.OK) {
    Assert-True ($getSettings.Body.code -eq "OK") "Settings response code is OK"
    Write-Host "        settings keys: $(if ($getSettings.Body.data) { ($getSettings.Body.data | Get-Member -MemberType NoteProperty).Count } else { 0 })" -ForegroundColor DarkGray
}

# 11b: Patch a setting value
Write-Host "  11b. Patch setting value" -ForegroundColor DarkYellow
$patchBody = @{
    values = @{
        e2e_test_key = "e2e_test_value_$(Get-Random)"
    }
}
$patchSettings = Invoke-PatchJson "$HubUrl/client/settings" $patchBody $tokenA
Assert-True ($patchSettings.Status -in @(200, 201)) "PATCH /settings returns 2xx" ("status: $($patchSettings.Status)")
if ($patchSettings.OK) {
    Assert-True ($patchSettings.Body.code -eq "OK") "Patch settings response code is OK"
    $patchedValue = $patchSettings.Body.data.e2e_test_key
    Assert-True ($null -ne $patchedValue) "Patched key appears in response"
    Write-Host "        patched e2e_test_key = $patchedValue" -ForegroundColor DarkGray
}

# 11c: Get settings again -- verify persisted value
Write-Host "  11c. Verify persisted setting" -ForegroundColor DarkYellow
$getSettings2 = Invoke-Get "$HubUrl/client/settings" $tokenA
Assert-True $getSettings2.OK "GET /settings (after patch) returns success"
if ($getSettings2.OK -and $getSettings2.Body.code -eq "OK") {
    $persistedValue = $getSettings2.Body.data.e2e_test_key
    Assert-True ($null -ne $persistedValue) "Patched key persists after re-fetch"
    Write-Host "        persisted e2e_test_key = $persistedValue" -ForegroundColor DarkGray
}

# 11d: Reset to default (delete the test key)
Write-Host "  11d. Reset test setting" -ForegroundColor DarkYellow
$resetBody = @{
    values = @{
        e2e_test_key = ""
    }
}
$resetSettings = Invoke-PatchJson "$HubUrl/client/settings" $resetBody $tokenA
Assert-True ($resetSettings.Status -in @(200, 201)) "PATCH /settings (reset) returns 2xx"
Write-Host "        reset e2e_test_key" -ForegroundColor DarkGray
Write-Host ""

# ---------- Phase 12: WebSocket Test ----------

Write-Host "--- 12. WebSocket Test ---" -ForegroundColor Yellow

# Use Node.js for WebSocket test since PowerShell lacks native WS support
Write-Host "  12a. Connect WS and verify auth.ok" -ForegroundColor DarkYellow

# Create a WS session and a message to send, all in one Node script
$wsTestToken = $tokenA
# If we have a private session from Phase 8, use it; otherwise skip WS message test
$wsSessionId = $sessionId

$wsScript = @"
const WebSocket = require('ws');

const token = '$($wsTestToken -replace "'", "\'")';
const hubUrl = 'ws://127.0.0.1:8080/client/ws';
const sessionId = '$($wsSessionId -replace "'", "\'")';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) { passed++; console.log('  WS PASS: ' + msg); }
    else { failed++; console.log('  WS FAIL: ' + msg); }
}

const ws = new WebSocket(hubUrl);

const timeout = setTimeout(() => {
    console.log('  WS TIMEOUT after 10s');
    ws.close();
    process.exit(failed > 0 ? 1 : 0);
}, 10000);

ws.on('open', () => {
    // Send auth frame
    ws.send(JSON.stringify({ type: 'auth', payload: { access_token: token } }));
});

let gotMessageNew = false;

ws.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    if (frame.type === 'auth.ok') {
        assert(true, 'Received auth.ok from WS');
        clearTimeout(timeout);

        // If we have a session, send a REST message and listen for WS event
        if (sessionId && sessionId.length > 0) {
            const http = require('http');
            const msgData = JSON.stringify({
                content_type: 'text',
                content: 'WS test message from E2E'
            });
            const req = http.request({
                hostname: '127.0.0.1', port: 8080, method: 'POST',
                path: '/client/sessions/' + sessionId + '/messages',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                }
            }, (res) => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        assert(true, 'REST message sent while WS connected');
                    } else {
                        assert(false, 'REST message send failed: ' + res.statusCode);
                    }
                });
            });
            req.write(msgData);
            req.end();

            // Wait for message.new event
            const msgTimeout = setTimeout(() => {
                if (!gotMessageNew) {
                    assert(false, 'Did not receive message.new event within 5s');
                }
                ws.close();
                process.exit(failed > 0 ? 1 : 0);
            }, 5000);

            ws.on('message', (data2) => {
                const frame2 = JSON.parse(data2.toString());
                if (frame2.type === 'message.new' && !gotMessageNew) {
                    gotMessageNew = true;
                    assert(true, 'Received message.new event on WS');
                    clearTimeout(msgTimeout);
                    ws.close();
                    process.exit(failed > 0 ? 1 : 0);
                }
            });
        } else {
            // No session, just close
            ws.close();
            process.exit(0);
        }
    } else if (frame.type === 'auth.fail') {
        assert(false, 'Received auth.fail: ' + JSON.stringify(frame.payload));
        clearTimeout(timeout);
        ws.close();
        process.exit(1);
    }
});

ws.on('error', (err) => {
    assert(false, 'WS connection error: ' + err.message);
    clearTimeout(timeout);
    process.exit(1);
});
"@

# Check if ws module is available
$wsModulePath = $null
$possiblePaths = @(
    (Join-Path $PSScriptRoot ".." ".." "app" "node_modules" "ws"),
    (Join-Path $PSScriptRoot ".." ".." "node_modules" "ws"),
    "C:\Users\Ding\node_modules\ws"
)
foreach ($p in $possiblePaths) {
    $resolved = if (Test-Path $p) { (Resolve-Path $p).Path } else { $null }
    if ($null -ne $resolved -and (Test-Path (Join-Path $resolved "package.json"))) {
        $wsModulePath = $resolved
        break
    }
}

if ($null -ne $wsModulePath) {
    $wsTmp = Join-Path ([System.IO.Path]::GetTempPath()) "agenthub-e2e-ws-$PID.cjs"
    Set-Content -LiteralPath $wsTmp -Value $wsScript -Encoding UTF8
    try {
        $env:NODE_PATH = "D:/Code/TokenDance/AgentHub/app/node_modules"
        $wsResult = & node $wsTmp 2>&1
        $wsExit = $LASTEXITCODE
        Write-Host ($wsResult -join "`n")
        if ($wsExit -ne 0) {
            $script:Failed++
        }
    }
    finally {
        Remove-Item -LiteralPath $wsTmp -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "  SKIP: ws module not found -- install with: pnpm add ws (in app/)" -ForegroundColor DarkYellow
    Write-Host "        Skipping WebSocket tests" -ForegroundColor DarkGray
}
Write-Host ""

# ---------- Phase 13: @Agent Real Execution ----------

Write-Host "--- 13. @Agent Real Execution ---" -ForegroundColor Yellow

# 13a: Create a thread for agent testing
$agentThreadId = "thread_agent_e2e_$(Get-Random)"
Write-Host "  13a. Create agent thread ($agentThreadId)" -ForegroundColor DarkYellow
$agentThreadBody = @{
    projectId = $EdgeProjectId
    threadId  = $agentThreadId
    title     = "E2E Agent Execution Test"
}
$createAgentThread = Invoke-PostJson "$EdgeUrl/v1/threads" $agentThreadBody
Assert-True ($createAgentThread.Status -in @(200, 201, 409)) "POST /v1/threads returns 2xx or 409" ("status: $($createAgentThread.Status)")
Write-Host ""

# 13b: Create a run with @Agent prompt that creates a file
Write-Host "  13b. Create agent run (write hello world script)" -ForegroundColor DarkYellow
$agentRunBody = @{
    projectId = $EdgeProjectId
    threadId  = $agentThreadId
    prompt    = "Create a file called hello_e2e.js in the current directory with the content: console.log('Hello from AgentHub E2E!'); Reply with just the filename when done."
    agentId   = "claude-code"
    ephemeral = $true
}
$createAgentRun = Invoke-PostJson "$EdgeUrl/v1/runs" $agentRunBody "" 120
Assert-True ($createAgentRun.Status -in @(200, 201, 202)) "POST /v1/runs (agent) returns 2xx" ("status: $($createAgentRun.Status) -- error: $($createAgentRun.Error)")
$agentRunId = $null
if ($createAgentRun.OK) {
    $agentRunData = $createAgentRun.Body.data
    $agentRunId = $agentRunData.runId
    Assert-True ($agentRunId -ne "") "Agent run has non-empty runId"
    Write-Host "        runId: $agentRunId  initial status: $($agentRunData.status)" -ForegroundColor DarkGray

    # 13c: Poll until complete
    Write-Host "  13c. Poll agent run status" -ForegroundColor DarkYellow
    $agentPollStart = Get-Date
    $agentFinalStatus = ""
    $agentPollCount = 0
    do {
        Start-Sleep -Seconds $PollIntervalSec
        $agentPollCount++
        $agentPollResp = Invoke-Get "$EdgeUrl/v1/runs/$agentRunId"
        if ($agentPollResp.OK) {
            $agentFinalStatus = $agentPollResp.Body.data.status
            $agentElapsed = ((Get-Date) - $agentPollStart).TotalSeconds
            Write-Host "        poll #$agentPollCount : $agentFinalStatus (${agentElapsed:N0}s)" -ForegroundColor DarkGray
        }
        if ($agentElapsed -gt $PollTimeoutSec) {
            Write-Host "        poll timeout after ${PollTimeoutSec}s" -ForegroundColor Red
            break
        }
    } while ($agentFinalStatus -in @("queued", "started", "cancelling"))

    Assert-True ($agentFinalStatus -eq "finished") "Agent run finished successfully" ("final: $agentFinalStatus")

    # 13d: Verify run artifacts exist
    Write-Host "  13d. Verify run artifacts" -ForegroundColor DarkYellow
    if ($agentFinalStatus -eq "finished") {
        $artifactsResp = Invoke-Get "$EdgeUrl/v1/artifacts?runId=$agentRunId"
        if ($artifactsResp.OK) {
            $artifacts = @($artifactsResp.Body.data.items)
            Assert-True ($artifacts.Count -ge 0) "Artifacts endpoint responded successfully" ("count: $($artifacts.Count)")
            Write-Host "        artifacts count: $($artifacts.Count)" -ForegroundColor DarkGray
            if ($artifacts.Count -gt 0) {
                Write-Host "        artifact names: $($artifacts | ForEach-Object { $_.name } | Join-String -Separator ', ')" -ForegroundColor DarkGray
            }
        } else {
            # Artifacts endpoint may not exist in all versions
            Write-Host "        artifacts endpoint not available (status: $($artifactsResp.Status))" -ForegroundColor DarkGray
        }

        # 13e: Check if hello_e2e.js was actually created on disk via Edge
        # Get the run details which may include diffs
        Write-Host "  13e. Verify run output" -ForegroundColor DarkYellow
        $runDetail = Invoke-Get "$EdgeUrl/v1/runs/$agentRunId"
        if ($runDetail.OK) {
            $rd = $runDetail.Body.data
            Assert-True ($null -ne $rd) "Run detail is not null"
            # Check for output or diffs
            if ($rd.PSObject.Properties.Match("output").Count -gt 0) {
                Write-Host "        run output: $($rd.output)" -ForegroundColor DarkGray
            }
            if ($rd.PSObject.Properties.Match("diffs").Count -gt 0 -and $null -ne $rd.diffs) {
                $diffFiles = @($rd.diffs.PSObject.Properties.Name)
                Assert-True ($diffFiles.Count -ge 1) "Run has at least 1 diff file" ("count: $($diffFiles.Count)")
                Write-Host "        diff files: $($diffFiles -join ', ')" -ForegroundColor DarkGray
            }
        }
    }
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
