# Edge API Reality Check — 2026-06-10

> Server: `http://127.0.0.1:3210` (local dev, `AGENTHUB_DEV=1`, no auth)
> Binary: `edge-server/agenthub-edge.exe` (37 MB, built 2026-06-10)
> Seed data: 10 threads, 8 runs, 1 pin

---

## Summary

| Category | Total Endpoints | 200/201/202/204 | 400 | 404 | 405 | Notes |
|---|---|:---:|:---:|:---:|:---:|---|
| Health & Status | 3 | 3 | | | | All working |
| Projects | 3 | 3 | | | | All working |
| Threads (CRUD) | 7 | 6 | | | 1 | POST /threads/:id/items = 405; use /messages instead |
| Runs | 5 | 4 | | 1 | | GET /runs/:id/items not implemented (404) |
| Run Diff | 3 | 3 | | | | All working |
| Artifacts | 2 | 2 | | | | Flat endpoints, not nested under /runs/:id |
| Previews | 4 | 4 | | | | POST/GET/GET/:id/:stop all working |
| Pins | 3 | 2 | | | 1 | Thread-scoped only (/threads/:id/pins); no flat /v1/pins |
| Users | 2 | 2 | | | | Working |
| Agent Profiles | 4 | 4 | | | | Full CRUD working |
| Settings | 2 | 2 | | | | GET + PATCH working |
| Permissions | 1 | | | 1 | | 404 = correct (no pending requests); endpoint exists |
| Agents | 1 | 1 | | | | 6 agents listed |
| Model Catalog | 1 | 1 | | | | 37 models across 5 runtimes |
| Metrics | 1 | 1 | | | | Prometheus format |
| Events | 1 | 400 | | | | Correct — requires WebSocket upgrade |
| Not Implemented | 4 | | | 4 | | /memory, /model-config, /ccswitch/status, /pins (flat) |

---

## 1. Health & Status

### GET /health
- **Status**: 200
- **Body**: `{"checks":{"bus":"ok","store":"ok"},"status":"ok"}`
- **Verdict**: PASS

### GET /v1/health
- **Status**: 200
- **Body**: Full health with adapter checks, runner status, store status, edgeId, version
- **Data**: 1 runner online (Anthropic SDK Runner), all checks ok
- **Verdict**: PASS

### GET /v1/runners
- **Status**: 200
- **Body**: `{"code":"OK","data":{"items":[{"id":"runner_local_1","name":"Anthropic SDK Runner (local)","status":"online","capabilities":["anthropic-sdk","streaming","tool_calls","thinking_visible","multi_turn"]}],"page":{"hasMore":false}}}`
- **Verdict**: PASS

---

## 2. Projects

### GET /v1/projects
- **Status**: 200
- **Body**: 3 projects (proj_demo, proj_local, proj_sdk_e2e)
- **Verdict**: PASS

### POST /v1/projects
- **Status**: 201 (created)
- **Request**: `{"projectId":"proj_audit_test","name":"Audit Test Project"}`
- **Body**: Full project object with createdAt, status
- **Note**: Unknown fields cause 400 (`DisallowUnknownFields` in decoder). `path` is not a valid field.
- **Verdict**: PASS

### GET /v1/projects/:id
- **Status**: 200 (existing), 404 (nonexistent)
- **Body**: Full project object
- **Verdict**: PASS

---

## 3. Threads

### GET /v1/threads
- **Status**: 200
- **Body**: 11 threads (10 seed + 1 local), across proj_demo (10) and proj_local (1)
- **Verdict**: PASS

### POST /v1/threads
- **Status**: 201
- **Request**: `{"projectId":"proj_audit_test","title":"Audit Test Thread"}`
- **Body**: Full thread object with generated threadId
- **Verdict**: PASS

### GET /v1/threads/:id
- **Status**: 200 (existing), 404 (nonexistent)
- **Body**: Full thread object
- **Verdict**: PASS

### GET /v1/threads/:id/items
- **Status**: 200
- **Body**: 8 items for builder thread (user_message, agent_message, approval, artifact, diff types)
- **Verdict**: PASS

### POST /v1/threads/:id/items
- **Status**: **405 Method Not Allowed**
- **Body**: `{"error":{"code":"METHOD_NOT_ALLOWED","message":"method not allowed"}}`
- **Note**: This route only supports GET. To add messages, use `POST /v1/threads/:id/messages` instead.
- **Verdict**: BY DESIGN — route is read-only; write goes to `/messages`

### POST /v1/threads/:id/messages
- **Status**: 201
- **Request**: `{"role":"user","content":"..."}`
- **Body**: Full item object with generated itemId
- **Verdict**: PASS

### PATCH /v1/threads/:id
- **Status**: 200
- **Request**: `{"title":"Builder (audit updated)"}`
- **Body**: Updated thread with new title and updatedAt
- **Verdict**: PASS

### DELETE /v1/threads/:id
- **Status**: 204 (no content)
- **Verdict**: PASS

### POST /v1/threads/:id:archive
- **Status**: 202
- **Body**: Thread with status changed to "archived"
- **Verdict**: PASS

---

## 4. Runs

### GET /v1/runs
- **Status**: 200
- **Body**: 8 seed runs with statuses: 5 finished, 2 started, 1 finished
- **Verdict**: PASS

### POST /v1/runs
- **Status**: 202 (accepted)
- **Request**: `{"threadId":"builder","projectId":"proj_demo","agentId":"claude-code"}`
- **Body**: Run object with status "queued"
- **Note**: Run executes async; may succeed or fail depending on API availability
- **Verdict**: PASS

### GET /v1/runs/:id
- **Status**: 200 (existing), 404 (nonexistent)
- **Body**: Full run object with status, timestamps
- **Verdict**: PASS

### GET /v1/runs/:id/items
- **Status**: **404** — run not found
- **Body**: `{"error":{"code":"NOT_FOUND","message":"run not found"}}`
- **Root Cause**: Route `/v1/runs/:id/items` is not registered. The URL `runs/run-builder-1/items` falls through to the generic GET /v1/runs/:id handler, which treats the entire suffix as runId = "run-builder-1/items" (not found).
- **Verdict**: NOT IMPLEMENTED — run events are retrieved via `GET /v1/threads/:id/items` with runId filtering, or via WebSocket events

### POST /v1/runs/:id:cancel
- **Status**: 200
- **Body**: `{"code":"OK","data":{"runId":"run-builder-1","status":"finished"}}`
- **Note**: Returns 200 even if run is already finished (idempotent)
- **Verdict**: PASS

---

## 5. Run Diff

### GET /v1/runs/:id/diff
- **Status**: 200
- **Body**: 3 diff files for run-builder-1 (SQL migration, TS hook, risk doc)
- **Verdict**: PASS

### POST /v1/runs/:id/apply
- **Status**: 200
- **Request**: `{"file_path":"migrations/0007_chat_threads.sql"}`
- **Body**: Diff result with `applied: false` (no workspace configured to write to)
- **Note**: `path` field is invalid (causes 400); must use `file_path`. Empty file_path returns 400 with clear message.
- **Verdict**: PASS (applied=false is expected with no workspace)

### POST /v1/runs/:id/apply-all
- **Status**: 200
- **Request**: `{"decisions":[{"file_path":"migrations/0007_chat_threads.sql","action":"apply"}]}`
- **Body**: `{"applied":1,"results":[...]}` with applied=false per file
- **Note**: Each decision must have `file_path` (not `path`). `decisions` array must not be empty.
- **Verdict**: PASS

---

## 6. Run Evidence

### GET /v1/runs/:id/artifacts (audit checklist path)
- **Status**: **404** — not a registered route
- **Verdict**: NOT A ROUTE — artifacts are at flat `/v1/artifacts` with `?runId=` filter

### GET /v1/runs/:id/previews (audit checklist path)
- **Status**: **404** — not a registered route
- **Verdict**: NOT A ROUTE — previews are at flat `/v1/previews` with `?runId=` filter

### GET /v1/artifacts (flat)
- **Status**: 200
- **Body**: Large list of artifacts (14 seed artifacts + many surfaced workspace files)
- **Note**: Can filter by `?runId=` and `?threadId=` query parameters
- **Verdict**: PASS

### GET /v1/artifacts/:id
- **Status**: 200
- **Body**: Single artifact object
- **Verdict**: PASS

### GET /v1/previews (flat)
- **Status**: 200
- **Body**: 3 seed previews (builder, teamrun, deployer)
- **Verdict**: PASS

### GET /v1/previews/:id
- **Status**: 200
- **Body**: Single preview object
- **Verdict**: PASS

### POST /v1/previews
- **Status**: 202
- **Request**: `{"runId":"run-builder-1","threadId":"builder"}`
- **Body**: Preview with status "starting"
- **Verdict**: PASS

### POST /v1/previews/:id:stop
- **Status**: 202
- **Body**: Preview with status "stopped"
- **Verdict**: PASS

---

## 7. Pins

### GET /v1/pins (flat)
- **Status**: **404** — not a registered route
- **Verdict**: NOT A ROUTE — pins are thread-scoped at `/v1/threads/:id/pins`

### GET /v1/threads/:id/pins
- **Status**: 200
- **Body**: 1 pin for builder thread (builder-msg-1)
- **Verdict**: PASS

### POST /v1/threads/:id/pins
- **Status**: 201
- **Request**: `{"itemId":"builder-msg-5","pinnedBy":"audit-tester"}`
- **Body**: Full pin object with pinnedAt timestamp
- **Verdict**: PASS

### DELETE /v1/threads/:id/pins?itemId=...
- **Status**: 204 (no content)
- **Note**: itemId query parameter is required; returns 400 if missing
- **Verdict**: PASS

---

## 8. Memory (NOT IMPLEMENTED)

### GET /v1/memory
- **Status**: 404
- **Verdict**: NOT IMPLEMENTED

### POST /v1/memory
- **Status**: 404
- **Verdict**: NOT IMPLEMENTED

---

## 9. Model Config

### GET /v1/model-config
- **Status**: **404**
- **Verdict**: NOT A ROUTE — use `/v1/model-catalog` instead

### GET /v1/model-catalog
- **Status**: 200
- **Body**: 37 model entries across 5 runtimes (anthropic-sdk, claude-code, codex, openai-sdk, opencode, orchestrator)
- **Data**: Sources include edge-adapter mappings, claude-provider-map, claude-settings, codex-config, cc-switch
- **Verdict**: PASS

---

## 10. cc-switch Integration (NOT IMPLEMENTED as endpoint)

### GET /v1/ccswitch/status
- **Status**: 404
- **Verdict**: NOT A ROUTE — cc-switch data is exposed through model-catalog sources, not a standalone endpoint

---

## 11. Seed Data Verification

### Threads (expected: 10 demo threads)
- **Actual**: 11 threads (10 from seed demo + 1 local thread)
- **Thread IDs**: builder, agent-collab, bytedance-teamrun, deployer, orchestrator, reviewer, johnny, trump, project-ai, project-docs, thread_local
- **Projects**: proj_demo (10 threads), proj_local (1 thread)
- **Verdict**: PASS (10 demo + 1 extra local = matches seed log "threads=10")

### Builder Thread Items (expected: demo messages)
- **Actual**: 8 items
- **Types**: user_message (1), agent_message (4), approval (1), artifact (1), diff (1)
- **Content**: Realistic SQLite migration scenario with Chinese content
- **Verdict**: PASS

### Runs (expected: 8 demo runs)
- **Actual**: 8 runs
- **Statuses**: finished (6), started (2)
- **Verdict**: PASS

---

## Additional Endpoints Discovered (not in original audit list)

### GET /v1/agents
- **Status**: 200
- **Body**: 6 agents — codex, opencode, anthropic-sdk, openai-sdk, orchestrator, claude-code
- **Data**: Each with capabilities map (Streaming, ToolCalls, FileChanges, etc.)
- **Verdict**: PASS

### GET /v1/agent-instances
- **Status**: 200
- **Body**: Empty items array (no live instances)
- **Verdict**: PASS

### GET /v1/agent-instances/:id
- **Status**: 200 (valid ID)
- **Verdict**: PASS

### GET /v1/users
- **Status**: 200
- **Body**: 8 users (3 human + 5 agent users)
- **Verdict**: PASS

### GET /v1/users/current
- **Status**: 200
- **Body**: Delicious233 with GitHub avatar
- **Verdict**: PASS

### GET /v1/agent-profiles
- **Status**: 200
- **Body**: Empty items array (seed has no profiles)
- **Verdict**: PASS

### POST /v1/agent-profiles
- **Status**: 201
- **Verdict**: PASS

### GET /v1/agent-profiles/:id
- **Status**: 200 (existing), 404 (nonexistent)
- **Verdict**: PASS

### PATCH /v1/agent-profiles/:id
- **Status**: 200
- **Verdict**: PASS

### DELETE /v1/agent-profiles/:id
- **Status**: 204
- **Verdict**: PASS

### GET /v1/settings
- **Status**: 200
- **Body**: `{"values":{},"updatedAt":""}`
- **Verdict**: PASS

### PATCH /v1/settings
- **Status**: 200
- **Request**: `{"audit-test-key":"audit-test-value"}`
- **Body**: Updated values with timestamp
- **Verdict**: PASS

### POST /v1/permissions/decide
- **Status**: 404 (no pending permission request)
- **Request**: `{"runId":"run-builder-1","requestId":"req-test-1","decision":"allow"}`
- **Body**: `{"error":{"code":"PERMISSION_REQUEST_NOT_FOUND"}}`
- **Verdict**: PASS — endpoint works, 404 is correct when no pending request exists

### GET /v1/metrics
- **Status**: 200
- **Body**: Prometheus text format metrics
- **Verdict**: PASS

### GET /v1/events
- **Status**: 400 (Bad Request)
- **Body**: "Bad Request"
- **Note**: Requires WebSocket upgrade header; plain HTTP GET correctly returns 400
- **Verdict**: PASS

### GET /v1/items/:id
- **Status**: 200 (existing), 404 (nonexistent)
- **Body**: Full item object
- **Verdict**: PASS

### /mcp (MCP server endpoint)
- **Registered**: Yes (per startup log "mcp server endpoint registered at /mcp")
- **Not tested**: MCP uses different protocol (not REST)

---

## Issues Found

### Issue 1: `DisallowUnknownFields` causes confusing 400 errors
- **Affected**: All POST/PATCH endpoints using `decodeOptionalJSON`
- **Impact**: Sending extra fields like `path` in POST /projects causes `{"code":"INVALID_JSON","message":"invalid json body"}` instead of a descriptive error
- **Severity**: Low — API clients that send correct fields work fine

### Issue 2: Audit list references non-existent routes
The original audit checklist referenced routes that are not implemented:

| Expected Route | Actual Route | Status |
|---|---|---|
| `GET /v1/runs/:id/artifacts` | `GET /v1/artifacts?runId=...` | Different path |
| `GET /v1/runs/:id/previews` | `GET /v1/previews?runId=...` | Different path |
| `GET /v1/runs/:id/items` | Not implemented (use thread items) | Missing |
| `POST /v1/threads/:id/items` | `POST /v1/threads/:id/messages` | Different suffix |
| `GET /v1/pins` | `GET /v1/threads/:id/pins` | Thread-scoped |
| `POST /v1/pins` | `POST /v1/threads/:id/pins` | Thread-scoped |
| `DELETE /v1/pins/:id` | `DELETE /v1/threads/:id/pins?itemId=...` | Thread-scoped |
| `GET /v1/model-config` | `GET /v1/model-catalog` | Different name |
| `GET /v1/memory` | Not implemented | 404 |
| `POST /v1/memory` | Not implemented | 404 |
| `GET /v1/ccswitch/status` | Data in `/v1/model-catalog` sources | 404 |

---

## Complete Route Map (actual)

```
# Health & Debug
GET    /health
GET    /v1/health
GET    /v1/metrics

# Core Resources
GET    /v1/runners
GET    /v1/agents
GET    /v1/model-catalog
GET    /v1/events              (WebSocket upgrade)

# Projects
GET    /v1/projects
POST   /v1/projects
GET    /v1/projects/:id

# Threads
GET    /v1/threads
POST   /v1/threads
GET    /v1/threads/:id
PATCH  /v1/threads/:id
DELETE /v1/threads/:id
POST   /v1/threads/:id:archive
GET    /v1/threads/:id/items
POST   /v1/threads/:id/messages
GET    /v1/threads/:id/pins
POST   /v1/threads/:id/pins
DELETE /v1/threads/:id/pins?itemId=...

# Items
GET    /v1/items/:id

# Runs
GET    /v1/runs
POST   /v1/runs
GET    /v1/runs/:id
POST   /v1/runs/:id:cancel
GET    /v1/runs/:id/diff
POST   /v1/runs/:id/apply
POST   /v1/runs/:id/apply-all

# Artifacts (flat, filter by runId/threadId)
GET    /v1/artifacts
GET    /v1/artifacts/:id

# Previews (flat)
GET    /v1/previews
POST   /v1/previews
GET    /v1/previews/:id
POST   /v1/previews/:id:stop

# Users
GET    /v1/users
GET    /v1/users/current

# Agent Profiles
GET    /v1/agent-profiles
POST   /v1/agent-profiles
GET    /v1/agent-profiles/:id
PATCH  /v1/agent-profiles/:id
DELETE /v1/agent-profiles/:id

# Agent Instances
GET    /v1/agent-instances
GET    /v1/agent-instances/:id

# Permissions
POST   /v1/permissions/decide

# Settings
GET    /v1/settings
PATCH  /v1/settings

# MCP
/mcp   (MCP protocol, not REST)
```
