# AgentHub Integration Architecture

Date: 2026-05-24
Status: Current (M3a complete, M3b in progress)

## 1. System Topology

```
Desktop UI (React)                Web/Mobile UI (future)
  │  REST + WS                         │  REST + WS
  ▼                                    ▼
Edge Server (Go) ◄──────────────► Hub Server (Go)
  │  AgentAdapter                       │  JWT Auth
  ▼                                     │  IM / Sync / Relay
Agent CLI (Claude Code / Codex / OpenCode)
```

P0 boundary: Desktop connects only to local Edge. Hub Server is a skeleton (routable, stub responses), not a runtime dependency.

## 2. API Overlap

### 2.1 Edge Server REST API (`127.0.0.1:3210`)

P0 implemented routes:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/v1/health` | Health check |
| `GET` | `/v1/runners` | List local runners |
| `GET` | `/v1/agents` | List agent adapters (Claude Code, Codex, OpenCode) |
| `GET` | `/v1/projects` | List projects |
| `POST` | `/v1/projects` | Create project |
| `GET` | `/v1/projects/{id}` | Get project |
| `GET` | `/v1/threads` | List threads (filter by projectId) |
| `POST` | `/v1/threads` | Create thread |
| `GET` | `/v1/threads/{id}` | Get thread |
| `GET` | `/v1/threads/{id}/items` | List thread items |
| `POST` | `/v1/threads/{id}/messages` | Create user message |
| `GET` | `/v1/items/{id}` | Get item |
| `GET` | `/v1/runs` | List runs (filter by threadId) |
| `POST` | `/v1/runs` | Start agent run |
| `POST` | `/v1/runs/{id}:cancel` | Cancel run |
| `GET` | `/v1/runs/{id}` | Get run detail |
| `GET` | `/v1/events` | WebSocket event stream |
| `POST` | `/v1/permissions/decide` | Submit permission decision |

Key characteristics:
- **No authentication** — local-only, protected by CORS origin check (`localhost`, `127.0.0.1`, `::1`, `tauri.localhost`)
- All responses use `{ items: [...], page: { hasMore: false } }` list wrapper
- Errors use `{ error: { code, message, traceId } }` structure
- Request body limited to 1MB via `io.LimitReader`
- Timeouts: Read 15s, Write 0 (WebSocket is long-lived), Idle 60s

### 2.2 Hub Server REST API (`/client/*`, `/edge/*`, `/web/*`)

Built on Gin framework with middleware chain:

```
AccessLog → PrometheusMetrics → [AuthMiddleware] → [DeviceTypeCheck] → Handler
```

Key route groups:

| Group | Auth | Device Check | Purpose |
|-------|------|-------------|---------|
| `/health` | None | None | Health check |
| `/client/auth` | Partial | None | Register, Login, Refresh (no auth); Logout, Me, Profile, Password (auth required) |
| `/client/contacts` | JWT | None | Friend requests, contact list, block |
| `/client/sessions` | JWT | None | IM sessions (create, members, messages, agents, pins) |
| `/client/messages` | JWT | None | Recall, pin, forward, search |
| `/client/attachments` | JWT | None | Upload, download |
| `/client/notifications` | JWT | None | List, read |
| `/client/ws` | None | None | WebSocket (auth via first frame) |
| `/edge/*` | JWT | `desktop` | Device registration, agent task ack/stream/done/fail |
| `/web/*` | JWT | `web` | Trigger/cancel agent tasks, custom agent CRUD |

### 2.3 Overlap Analysis

| Domain | Edge (P0) | Hub (P2+) | Overlap |
|--------|-----------|-----------|---------|
| Projects | CRUD | — | Hub has no project concept yet |
| Threads | CRUD | Sessions (group/private chat) | Different models; Hub Sessions are IM rooms, Edge Threads are task branches |
| Messages | Thread messages | Session messages | Similar shape but different ID schemes and auth |
| Runs | Full lifecycle | Agent tasks (ack/stream/done/fail) | Hub delegates execution to Edge via agent tasks |
| Agents | List adapters | Custom agents CRUD | Different scope: Edge lists CLI adapters, Hub manages user-defined agents |
| Auth | None (CORS) | JWT Bearer | No conflict — Edge is local-only |
| Events | Typed event stream | Frame-based WS | Different protocols (details in Section 4) |

**Migration path**: When Hub becomes the cloud authority, Edge's REST API becomes an internal implementation detail behind Hub's relay layer. Desktop would connect to Hub (not Edge directly), and Hub would proxy or relay agent execution commands to Edge.

## 3. Data Model Alignment

### 3.1 Edge Store Models (Go, in-memory)

```go
Project  { projectId, name, status, createdAt, updatedAt }
Thread   { threadId, projectId, title, status, createdAt, updatedAt }
Run      { runId, projectId, threadId, status, createdAt, startedAt?, finishedAt? }
Item     { itemId, projectId, threadId, runId?, type, role?, status, content?, createdAt, updatedAt }
```

ID prefixes: `proj_`, `thread_`, `run_`, `item_`. All timestamps are RFC3339 strings. Status values are strings (`active`, `queued`, `started`, `running`, `finished`, `failed`, `cancelled`).

### 3.2 Hub Server Models (Go, GORM/DB)

Hub models are relational (GORM) with UUID primary keys and foreign key relationships:

```
User, Session, SessionMember, Message, MessagePin,
AgentInstance, CustomAgent, PendingAgentTask,
Device, Friendship, Notification, Attachment, RefreshToken
```

Key structural differences:
- Hub uses `uint` auto-increment IDs internally, prefixed strings externally
- Hub has user/contact/device concepts that Edge does not
- Hub `Message` is an IM message, Edge `Item` is a timeline event
- Hub `AgentInstance` represents an agent in a session, Edge `AgentInfo` is an adapter metadata card

### 3.3 Desktop Shared Types (TypeScript)

```typescript
// From @shared/types
HealthResponse   { status, version, edgeId }
Runner           { id, name, status, capabilities? }
RunInfo          { runId, projectId, threadId, status, createdAt?, startedAt?, finishedAt? }
ThreadInfo       { threadId, projectId, title, status, createdAt, updatedAt }
ItemInfo         { itemId, projectId, threadId, runId?, type, role?, status, content?, createdAt, updatedAt }
AgentInfo        { id, name, description?, version?, status, capabilities }
AgentCapabilities { streaming, toolCalls, fileChanges, thinkingVisible, multiTurn }
StartRunRequest  { projectId?, threadId?, prompt?, agentId?, model?, reasoningEffort? }
ListResponse<T>  { items: T[], page: { nextCursor?, hasMore } }
PageInfo         { nextCursor?, hasMore }
```

### 3.4 Alignment Issues

| Issue | Edge (Go) | Desktop (TS) | Status |
|-------|-----------|-------------|--------|
| Project ID key | `Project.ID` → json:`"projectId"` | `projectId` | Aligned via JSON tags |
| Agent capabilities | `AgentCapabilities` struct | `AgentCapabilities` interface | Aligned; Hub `AgentHandler` returns compatible shape |
| Item vs Message | `Item` (timeline event) | `ItemInfo` | Aligned; Desktop treats items generically |
| Run status | String enum | String | Aligned (both use same status strings) |
| Token usage naming | `inputTokens`/`outputTokens` (NDJSON), `input`/`output` (OpenCode) | `input`/`output` | Normalized in `useChatMessages.mapUsageToTokenUsage()` |
| Error shape | `{ error: { code, message, traceId } }` | `parseError()` from @shared/errors | Aligned via shared error parser |

## 4. WebSocket Protocol

### 4.1 Edge Event Stream (`/v1/events`)

**Connection**: Standard WebSocket upgrade with CORS origin check.

**Cursor replay**: `GET /v1/events?cursor={seq}` — replays all events with `seq > cursor` on connect.

**Event envelope** (Go):
```go
EventEnvelope {
    Version string         // "v1"
    ID      string         // "evt_<hex>"
    Seq     int64          // monotonic per Edge instance
    Type    string         // e.g. "run.agent.text_delta"
    Scope   map[string]any // { projectId, threadId, runId }
    TraceID string         // optional trace correlation
    SentAt  string         // RFC3339 UTC
    Payload any            // type-specific payload
}
```

**Key event types** (20+ defined):
- Lifecycle: `run.queued`, `run.started`, `run.finished`, `run.failed`, `run.cancelled`
- Agent output: `run.agent.text_delta`, `run.agent.text_block`, `run.agent.thinking`, `run.agent.tool_call`, `run.agent.tool_result`, `run.agent.file_change`, `run.agent.session_init`, `run.agent.result`
- Sub-agent: `run.agent.task_started`, `run.agent.task_dispatched`, `run.agent.task_progress`, `run.agent.task_notification`
- Permission: `run.agent.permission_requested`, `run.agent.permission_decided`, `run.agent.permission_decide`
- System: `run.agent.compact_boundary`, `run.agent.api_retry`, `run.agent.status_change`, `run.agent.auth_status`, `run.agent.rate_limit`
- Infrastructure: `runner.online`, `runner.offline`, `project.created`, `thread.created`, `message.created`, `item.created`, `error`

**Heartbeat**: Server sends WebSocket Ping every 30s. Client must respond with Pong. Read deadline 60s.

**Client sends**: None (server pushes only). Messages from client are discarded by design. Permission decisions go through REST `POST /v1/permissions/decide`.

**Bus internals** (`events/bus.go`):
- Ring buffer of 10,000 events
- Non-blocking fan-out to all subscribers
- Slow subscribers get events dropped

### 4.2 Hub WebSocket (`/client/ws`)

**Connection**: WebSocket upgrade via `github.com/coder/websocket`.

**Auth handshake**: First frame from client MUST be an auth frame:
```json
{ "type": "auth", "payload": { "access_token": "<JWT>" } }
```
Server responds with `{ "type": "auth.ok" }` or `{ "type": "auth.fail", "payload": { "reason": "..." } }`.

**Frame types** (defined in `ws/frame.go`):
- Client → Server: `auth`, `typing`
- Server → Client: `auth.ok`, `auth.fail`, `message.new`, `message.recall`, `message.pin`, `message.unpin`, `message.read`, `session.created`, `session.dissolved`, `session.member_joined`, `session.member_left`, `session.info_updated`, `device.online`, `device.offline`, `device.kicked`, `agent.dispatch`, `agent.stream`, `agent.done`, `agent.failed`, `agent.cancel`, `notification.new`, `friend.request`, `friend.accepted`

**Connection routing** (`ws/manager.go`):
- `Register` → assigns UUIDv7 conn ID
- `SetAuth` → binds conn to userID + deviceType; replaces old conn of same user+device
- `PushToUser` → fans out to all device connections of a user
- `PushToSession` → resolves session members, fans out to all

**Heartbeat**: Server pings all connections every 30s. 2 consecutive missed pongs → disconnect.

### 4.3 Protocol Comparison

| Aspect | Edge WS | Hub WS |
|--------|---------|--------|
| Auth model | None (CORS-only) | JWT in first frame |
| Event model | Typed envelope with `seq` | Typed frame with optional `seq_id` |
| Replay | Cursor-based from bus history | No replay (stateless) |
| Fan-out | All subscribers | Per-user, per-device, per-session |
| Heartbeat | WebSocket Ping/Pong | WebSocket Ping/Pong with miss counter |
| Client send | Discarded | Auth + typing indicators |
| Library | `gorilla/websocket` | `coder/websocket` |

## 5. Auth Flow

### 5.1 Edge: Local-Only (No Auth)

Edge is explicitly local-only in P0. Security is via:

1. **CORS origin check** (`security/origin.go`): Only allows origins matching `localhost`, `127.0.0.1`, `::1`, `tauri.localhost` (for Tauri desktop shell), or the `tauri://` scheme. Empty origin (non-browser clients) is also allowed.

2. **Bind address**: Default `127.0.0.1:3210` — not exposed to network interfaces.

3. **Trust boundary**: Edge trusts the local machine. If an attacker has local code execution, they already own the machine. This is a deliberate P0 tradeoff.

### 5.2 Hub: JWT Bearer Token

Hub uses JWT with HMAC signing:

1. **Registration** (`POST /client/auth/register`): Creates user, returns JWT access + refresh tokens.
2. **Login** (`POST /client/auth/login`): Validates credentials, returns JWT access + refresh tokens.
3. **Token structure** (`jwtutil`): Claims include `sub` (user ID), `name`, `device_type`, `device_id`, `exp`, `iat`.
4. **Auth middleware** (`middleware/auth.go`): Extracts `Bearer <token>` from `Authorization` header, parses and validates JWT, injects `user_id`, `device_type`, `device_id` into Gin context.
5. **Skip paths**: Auth middleware can be configured with skip paths (exact or prefix match) for public endpoints like `/health`, `/client/auth/login`, `/client/auth/register`.

**Two middleware implementations exist**:
- `hub-server/internal/middleware/auth.go` — Gin middleware for Hub HTTP routes
- `hub-server/internal/auth/middleware.go` — Standard `net/http` middleware with `User` context type and `UserFromContext()` helper

Both validate JWT with the same secret and extract the same claims. The Gin version is used in the router; the `net/http` version is available for non-Gin handlers.

### 5.3 Auth Gap Analysis

| Concern | Edge | Hub | Gap |
|---------|------|-----|-----|
| Local access | CORS origin check | N/A | Sufficient for P0 |
| Remote access | N/A | JWT Bearer | Hub auth in place, not yet integrated with Edge |
| Desktop → Hub | Not used in P0 | JWT via `/client/auth` | Desktop has no Hub auth code yet |
| Edge → Hub relay | Not implemented | `/edge/*` routes with JWT + device check | Requires Edge to hold and present JWT |
| Token refresh | N/A | `/client/auth/refresh` | Implemented in Hub, no Desktop consumer |

## 6. Message Flow

### 6.1 End-to-End: Prompt to UI Render

```
1. User types prompt in Desktop UI
   └─ PromptInput.tsx → onSend(prompt, agentId, opts)

2. Desktop calls Edge REST API
   └─ edgeClient.ts → POST /v1/runs { projectId, threadId, prompt, agentId, model }

3. Edge API handler (handlers.go:PostRuns)
   └─ Creates Run in store (status: "queued")
   └─ Publishes "run.queued" event
   └─ Calls ProcessExecutor.Start(run, runCtx)

4. ProcessExecutor (lifecycle/process_executor.go)
   └─ Sets run status to "started" → publishes "run.started"
   └─ Resolves agent adapter from registry (by agentId or default)
   └─ Calls adapter.BuildCommand(runCtx) → gets cmd path + args + env
   └─ Starts OS process with adapter-aware stdin pipe

5. Agent CLI runs (Claude Code / Codex / OpenCode)
   └─ Outputs structured JSON/NDJSON to stdout
   └─ Listens on stdin for control messages (permission, cancel, model switch)

6. Adapter.ParseStream reads stdout line by line
   └─ NDJSONStreamParser / inline scanner maps CLI protocol to BusEvent types
   └─ Emits via EventEmitter: Emit("run.agent.text_delta", scope, payload)
   └─ Events published to events.Bus

7. Event Bus (events/bus.go)
   └─ Assigns monotonic seq
   └─ Appends to ring buffer (10K capacity)
   └─ Fans out to all WebSocket subscribers (non-blocking)

8. WebSocket handler (handlers.go:GetEvents)
   └─ Reads from subscriber channel
   └─ Writes EventEnvelope as JSON to WebSocket conn

9. Desktop EventClient (eventClient.ts)
   └─ createEventStream() opens WebSocket to ws://127.0.0.1:3210/v1/events
   └─ On message: parses JSON, updates cursor, notifies handlers

10. useChatMessages hook (useChatMessages.ts)
    └─ Subscribes to event stream
    └─ Dispatch EVENT_RECEIVED → processEvent() reducer
    └─ Maps each event type to ChatMessage / MessageBlock:
        text_delta → merged text blocks (streaming)
        tool_call → ToolUseBlock (collapsible, with nested children)
        tool_result → nested under matching tool_use block
        file_change → FileChangeBlock
        session_init → SessionInitBlock
        result → ResultBlock (success + token usage)

11. ChatView renders (ChatView.tsx)
    └─ Maps ChatMessage[] to UI components:
        StreamingTextBlock → MarkdownRenderer (with typing animation)
        ThinkingBlock → collapsible accordion
        ToolUseBlock → expandable card with parameter viewer + result children
        DiffCard → inline diff with +/- line highlighting
        FileChangeBlock → details/summary with action badge
    └─ Auto-scrolls while streaming, shows scroll-to-bottom indicator when user scrolls up
```

### 6.2 Control Flow: Cancel

```
Desktop UI → POST /v1/runs/{runId}:cancel
  → Edge handler: h.Executor.Cancel(runID)
    → ProcessExecutor.Cancel:
      1. Writes "interrupt" control message to stdin (adapter-aware)
      2. Calls context.CancelFunc for the run's goroutine
      3. Sets run status to "cancelled"
      4. Publishes "run.cancelled" event
  → Agent CLI receives interrupt, stops
  → ParseStream returns (context cancelled)
  → Desktop UI receives "run.cancelled" → sets isStreaming=false
```

### 6.3 Permission Flow

```
1. Agent CLI requests permission (e.g., file write)
   → Adapter.ParseStream detects permission prompt
   → Publishes "run.agent.permission_requested" event

2. Desktop receives event
   → useChatMessages adds to permissionRequests[]
   → UI shows permission banner

3. User clicks Allow/Deny
   → Desktop calls POST /v1/permissions/decide { runId, requestId, decision }

4. Edge handler publishes "run.agent.permission_decided"
   → Permission handler in control_protocol.go sends decision to CLI via stdin

5. CLI acts on decision (proceed or abort)
```

### 6.4 Reconnection Flow

```
1. WebSocket drops
   → eventClient.ts onclose fires
   → notifyStatus(false) → connectionStore shows disconnected banner
   → scheduleReconnect() with exponential backoff (1s → 2s → 4s → ... → 30s max)

2. Reconnect succeeds
   → WebSocket opens with last cursor: ws://.../?cursor={lastSeq}
   → Edge replays events with seq > cursor from ring buffer
   → If cursor expired (history evicted): UI should pull REST snapshot
     (REST snapshot pull not yet implemented in Desktop)

3. Edge restart
   → All in-memory state lost
   → Desktop detects disconnect
   → On reconnect with expired cursor: Edge sends error event
   → Desktop should re-fetch threads/runs from REST (not yet implemented)
```

## 7. Key Integration Gaps

### 7.1 Implemented

- [x] Desktop → Edge REST API (typed client with `@shared/types`)
- [x] Desktop ↔ Edge WebSocket (event stream with reconnect)
- [x] Edge → Agent CLI (AgentAdapter interface, 3 implementations)
- [x] Agent CLI → Edge → Desktop (full event pipeline: 20+ event types)
- [x] Permission request → decision round-trip
- [x] Cancel run (REST → stdin interrupt → context cancel)
- [x] Hub Server skeleton (18 routes, health check, stub responses)
- [x] Hub JWT auth middleware
- [x] Hub WebSocket (frame-based, auth handshake, per-user routing)

### 7.2 Not Yet Integrated

- [ ] Desktop → Hub auth (Desktop has no login/registration UI)
- [ ] Edge → Hub sync (Edge does not register with Hub or upload events)
- [ ] Hub → Edge relay (remote control of Edge via Hub not implemented)
- [ ] REST snapshot recovery on WebSocket cursor expiry
- [ ] Conversation/Thread sync between Edge and Hub
- [ ] Cross-device message delivery
- [ ] Agent task dispatch from Hub Web UI to Edge

### 7.3 Data Shape Mismatches to Resolve

| Item | Edge Shape | Hub Shape | Resolution |
|------|-----------|-----------|------------|
| Run ID | `run_<hex>` (8 bytes) | UUID-based | Use Edge ID as canonical; Hub stores mapping |
| Thread vs Session | Thread is task branch | Session is IM room | Map Edge Thread → Hub Session on sync |
| Event format | EventEnvelope (typed) | Frame (typed) | Translate at Hub relay boundary |
| Agent representation | Adapter metadata | AgentInstance + CustomAgent | Adapter metadata → AgentInstance on register |

## 8. Shared Code Dependencies

```
@shared (app/shared/src/)
  ├── types.ts        → Edge REST types (HealthResponse, RunInfo, AgentInfo, etc.)
  ├── events.ts       → WebSocket event types (EventEnvelope, all agent event payloads)
  ├── errors.ts       → Error parser (parseError, isErrorResponse)
  ├── tree.ts         → Message tree utilities (buildTree, flattenTree)
  ├── diff.ts         → Old diff engine
  ├── diff/engine.ts  → New diff engine (ported from OpenCode)
  └── context/        → Token estimation, context budget breakdown

Used by:
  - app/desktop (full dependency)
  - app/web (partial, via webpack/tsconfig aliases)
  - Not yet used by Edge or Hub (Go code has independent type definitions)
```

**Note**: Edge and Hub define their own Go structs that mirror the shared TypeScript types. There is no code generation between them. The JSON field names are kept consistent manually (e.g., `json:"projectId"` in Go matches `projectId` in TypeScript).

## 9. Ports and Addresses

| Service | Default Address | Protocol | Notes |
|---------|----------------|----------|-------|
| Desktop UI | `http://127.0.0.1:5173` | HTTP (Vite dev) | Configurable via `vite.config.ts` |
| Edge Server | `http://127.0.0.1:3210` | HTTP + WS | Configurable via `--addr` flag |
| Hub Server | (configurable) | HTTP + WS | Gin framework, config in `configs/` |
| Agent CLI | Managed subprocess | stdio (stdin/stdout) | Launched by Edge ProcessExecutor |

Desktop config (`app/desktop/src/config.ts`):
```typescript
EDGE_URL = 'http://127.0.0.1:3210'
WS_URL   = 'ws://127.0.0.1:3210/v1/events'
```
