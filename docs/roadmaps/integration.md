# Hub Server + Edge Server + Desktop Integration Analysis

> Generated 2026-05-24 from full source review of all three codebases.
> Branch: `dev/delicious233` target: `master`

---

## 1. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          AgentHub System                            │
│                                                                     │
│  ┌──────────────┐     JWT/REST+WS      ┌──────────────────────┐    │
│  │  Web Client  │ ──────────────────►  │    Hub Server        │    │
│  │  (browser)   │                      │  (Gin, :8080)        │    │
│  │              │  /web/agent-tasks    │                      │    │
│  │              │  /web/custom-agents  │  ┌────────────────┐  │    │
│  └──────────────┘                      │  │ Auth (JWT)     │  │    │
│                                        │  │ IM (Session/   │  │    │
│  ┌──────────────┐    /edge/* callbacks  │  │   Message)     │  │    │
│  │  Desktop App │ ◄──────────────────► │  │ Contacts       │  │    │
│  │  (React)     │                      │  │ Notifications  │  │    │
│  │              │  agent.dispatch (WS)  │  │ Agent Orch.    │  │    │
│  │  ┌────────┐  │                      │  │ EventBus       │  │    │
│  │  │Hub     │  │  /client/ws           │  │ WS Manager     │  │    │
│  │  │Client  │  │  (auth frame proto)   │  └────────────────┘  │    │
│  │  │(NEW!)  │  │                      │                      │    │
│  │  ├────────┤  │                      │  DB: PostgreSQL      │    │
│  │  │Edge    │  │                      │  Cache: Redis        │    │
│  │  │Client  │  │                      └──────────────────────┘    │
│  │  │(exists)│  │                                                 │
│  │  └────────┘  │  /v1/events (WS)                                 │
│  │       │      │  /v1/runs (REST)                                 │
│  │       │      │  /v1/permissions/decide                          │
│  │       ▼      │                      ┌──────────────────────┐    │
│  │  @shared/    │  gorilla/websocket   │   Edge Server        │    │
│  │  events.ts   │  EventEnvelope       │  (net/http, :3210)   │    │
│  │  types.ts    │  cursor replay        │                      │    │
│  └──────────────┘                      │  Runner Registry     │    │
│                                        │  Agent Adapters      │    │
│  ┌──────────────┐                      │  Process Executor    │    │
│  │  CLI Tools   │  local exec          │  EventBus (seq)      │    │
│  │  (Claude     │ ◄──────────────────► │  In-Memory Store     │    │
│  │   Code, etc) │  stdin/stdout        │                      │    │
│  └──────────────┘                      │  CORS: Trusted Local │    │
│                                        └──────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

**Key double-connection pattern**: The Desktop connects to BOTH:
1. **Edge Server** (local, `127.0.0.1:3210`): for agent execution lifecycle events via
   WebSocket (`/v1/events`), plus REST for runs/threads. No auth.
2. **Hub Server** (remote, `:8080`): for IM (sessions, messages, contacts), auth,
   receiving `agent.dispatch` tasks, and reporting task progress callbacks. JWT auth.

---

## 2. API Surface Comparison

### Hub Server Routes (from `hub-server/internal/router/router.go`)

| Group | Method | Path | Auth | Device | Purpose |
|-------|--------|------|------|--------|---------|
| **Health** | GET | `/health` | No | Any | Liveness |
| **Auth** | POST | `/client/auth/register` | No | Any | Register |
| **Auth** | POST | `/client/auth/login` | No | Any | Login (returns JWT) |
| **Auth** | POST | `/client/auth/refresh` | No | Any | Refresh token |
| **Auth** | POST | `/client/auth/logout` | JWT | Any | Logout |
| **Auth** | GET | `/client/auth/me` | JWT | Any | Current user |
| **Auth** | PUT | `/client/auth/profile` | JWT | Any | Update profile |
| **Auth** | PUT | `/client/auth/password` | JWT | Any | Change pwd |
| **WS** | GET | `/client/ws` | Frame | Any | IM + dispatch |
| **Contacts** | GET/POST/DELETE | `/client/contacts/*` | JWT | Any | Friend mgmt |
| **Sessions** | GET/POST/PUT/DELETE | `/client/sessions/*` | JWT | Any | IM sessions |
| **Messages** | POST/GET | `/client/sessions/:id/messages*` | JWT | Any | Chat messages |
| **Messages** | POST/DELETE | `/client/messages/:id/*` | JWT | Any | Recall/pin/fwd |
| **Attachments** | POST/GET | `/client/attachments/*` | JWT | Any | File up/down |
| **Notifications** | GET/POST | `/client/notifications/*` | JWT | Any | Notif mgmt |
| **Edge** | POST | `/edge/devices/register` | JWT | desktop | Register device |
| **Edge** | POST | `/edge/agent-tasks/:id/ack` | JWT | desktop | Task ack |
| **Edge** | POST | `/edge/agent-tasks/:id/stream` | JWT | desktop | Stream output |
| **Edge** | POST | `/edge/agent-tasks/:id/done` | JWT | desktop | Task done |
| **Edge** | POST | `/edge/agent-tasks/:id/fail` | JWT | desktop | Task fail |
| **Web** | POST | `/web/agent-tasks` | JWT | web | Trigger task |
| **Web** | POST | `/web/agent-tasks/:id/cancel` | JWT | web | Cancel task |
| **Web** | GET/POST/PUT/DELETE | `/web/custom-agents*` | JWT | web | Custom agent CRUD |

### Edge Server Routes (from `edge-server/internal/api/handlers.go`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/health` | Liveness |
| GET | `/v1/runners` | List runners |
| GET | `/v1/agents` | List agent adapters |
| GET/POST | `/v1/projects` | Project list/create |
| GET | `/v1/projects/:id` | Get project |
| GET/POST | `/v1/threads` | Thread list/create |
| GET | `/v1/threads/:id` | Get thread |
| GET | `/v1/threads/:id/items` | Thread items |
| POST | `/v1/threads/:id/messages` | Post message |
| GET | `/v1/items/:id` | Get item |
| GET/POST | `/v1/runs` | Run list/start |
| POST | `/v1/runs/:id:cancel` | Cancel run |
| GET | `/v1/runs/:id` | Get run |
| GET (WS) | `/v1/events` | Event stream |
| POST | `/v1/permissions/decide` | Permission gate |

### Relationship: Complement, NOT Duplicate

Hub and Edge serve completely different domains with one connection point:

- **Hub**: Remote cloud service for IM, auth, multi-user coordination, agent task dispatch
- **Edge**: Local machine service for agent execution, process management, event streaming
- **Connection**: Hub dispatches agent tasks to Desktop, Desktop delegates execution to Edge,
  Desktop reports results back to Hub

The only API shape similarity is both have WebSocket + REST. Their endpoint paths,
data models, and event schemas are entirely disjoint.

---

## 3. WebSocket Protocol Comparison

| Feature | Hub WS (`/client/ws`) | Edge WS (`/v1/events`) |
|---------|----------------------|------------------------|
| **Library** | `coder/websocket` (via Gin) | `gorilla/websocket` (raw) |
| **Auth** | JWT auth frame within 5 seconds | None (trusted local origin) |
| **Event Format** | `{ "type": "message.new", "payload": {...} }` | `{ "version": "v1", "id": "...", "seq": 123, "type": "...", "scope": {...}, "payload": {...} }` |
| **C2S Messages** | `auth`, `typing` | `permission_decide` |
| **S2C Events** | `message.{new,recall,pin,unpin,read}`, `agent.{dispatch,done,failed,cancel,timeout}`, `device.{online,offline,kicked}`, `notification.new`, `session.*`, `friend.*` | `runner.{online,offline}`, `run.{queued,started,finished,failed,cancelled}`, `run.agent.{text_delta,text_block,thinking,tool_call,tool_result,file_change,session_init,result,task_dispatched,permission_requested,permission_decided}`, `run.output{,.batch}`, `error` |
| **Replay** | None (needs REST sync for missed) | Cursor-based (`?cursor=<seq>`) with full history replay |
| **Heartbeat** | Server ping every 30s, 2 misses → disconnect | Server ping every 30s |
| **Connection lifecycle** | Gin handler goroutine per conn | Dedicated write goroutine + read goroutine |

**Key difference**: Hub WS is a **firehose** (all events pushed, no replay). Edge WS is a **replayable event log** (monotonic seq, cursor-based catch-up). A Desktop connecting to Hub will need a separate mechanism (REST sync API `/client/sessions/:id/messages/sync`) to catch up on missed messages.

---

## 4. Data Model Mapping

### Hub Models (PostgreSQL/GORM)

Located at `hub-server/internal/model/`:

| Model | Table | Key Fields |
|-------|-------|------------|
| `User` | users | `id`, `username`, `password_hash`, `nickname`, `avatar_url` |
| `Session` | sessions | `id`, `type` (private/group), `name`, `owner_user_id`, `next_seq`, `dissolved` |
| `SessionMember` | session_members | `id`, `session_id`, `member_type` (user/agent_instance), `member_id`, `role`, `pinned`, `archived`, `muted`, `last_read_seq`, `left_at` |
| `Message` | messages | `id`, `session_id`, `seq_id`, `client_msg_id`, `sender_type` (user/agent), `sender_id`, `content_type`, `content` (JSONB), `reply_to_message_id`, `recalled` |
| `AgentInstance` | agent_instances | `id`, `agent_type`, `custom_agent_id`, `session_id`, `inviter_user_id`, `display_name` |
| `PendingAgentTask` | pending_agent_tasks | `id`, `agent_instance_id`, `triggered_by_user_id`, `trigger_message_id`, `status` (queued/dispatched/running/done/failed/timeout/cancelled), `expire_at` |
| `CustomAgent` | custom_agents | `id`, `owner_user_id`, `name`, `agent_type`, `system_prompt`, `capability_tags`, `tool_whitelist`, `model_params` |
| `Device` | devices | `id`, `user_id`, `device_type`, `app_version`, `capabilities` (JSONB) |
| `Friendship` | friendships | `id`, `user_id`, `friend_id`, `status` (pending/accepted/rejected/blocked), `remark` |
| `MessagePin` | message_pins | `id`, `session_id`, `message_id`, `pinned_by_user_id` |

### Edge Models (In-Memory)

Located at `edge-server/internal/store/`. No database -- in-memory maps:

| Concept | Key Fields |
|---------|------------|
| `Project` | `ID`, `Name`, `CreatedAt` |
| `Thread` | `ID`, `ProjectID`, `Title`, `Status`, `CreatedAt`, `UpdatedAt` |
| `Item` | `ID`, `ProjectID`, `ThreadID`, `RunID`, `Type`, `Role`, `Status`, `Content` |
| `Run` | `ID`, `ProjectID`, `ThreadID`, `Status`, `Prompt`, `AgentID`, `Model`, `SessionID`, `CreatedAt`, `StartedAt`, `FinishedAt` |
| `Runner` | `ID`, `Name`, `Status`, `Capabilities` |

### Mapping Table

| Hub Concept | Edge Concept | Desktop Type | Alignment |
|-------------|-------------|--------------|-----------|
| `Session` (chat room) | `Project` + `Thread` (work context) | `ThreadInfo` | Different: Hub organizes around conversations; Edge organizes around projects. Can be **bridged**: Hub Session maps to Edge Project+Thread via SessionID. |
| `Message` (chat msg with seq) | `Item` (thread item) | `ChatMessage` (blocks) | Different shape but compatible direction. Hub Message.content is JSONB text; Edge Item is typed (run/output/message). Hub `sender_type=agent` messages correspond to Edge `run.agent.*` events. |
| `AgentInstance` | Agent adapter (`adapters.AgentAdapter`) | `AgentInfo` | Hub has instance-per-session (invited into group). Edge has adapter-per-agent-type (all runs share). Hub: "which agent in this chat?", Edge: "which binary to execute?" |
| `PendingAgentTask` (queued→dispatched→running→done/failed) | `Run` (queued→started→finished/failed) | `RunInfo` (status) | **Direct parallel**. Hub task status tracks the external lifecycle; Edge run status tracks the internal execution. Desktop bridges them. |
| `CustomAgent` (system_prompt, tool_whitelist, model_params) | N/A (Edge uses static adapter config) | N/A | Hub has customizable agents; Edge agents are fixed adapters. Hub custom agents configure WHAT Edge should run. |
| `Device` (user device registration) | N/A (single-machine) | N/A | Hub tracks multi-device; Edge is single-instance. Hub Device tells Hub WHICH desktop connection to dispatch to. |
| `Friendship` (social) | N/A | N/A | Hub-only social feature. |
| `User` (account) | N/A (no auth) | N/A | Hub-only account system. |

### Event Type Mapping (Key Bridges)

| Hub WS Frame Type | Edge EventEnvelope Type | Desktop Handler | Bridge Needed? |
|-------------------|------------------------|-----------------|----------------|
| `agent.dispatch` (→ desktop) | → triggers `POST /v1/runs` | → `startRun()` in `edgeClient.ts` | **Yes** -- Desktop must translate dispatch payload → Edge run request |
| Agent runs → generates | `run.agent.text_delta` | `useChatMessages.ts` renders | Already works (Edge→Desktop) |
| Agent runs → generates | `run.agent.result` | `useChatMessages.ts` renders | Already works |
| Desktop calls → | `POST /edge/agent-tasks/:id/stream` (→ Hub) | → broadcasts `message.new` on Hub | **Yes** -- Desktop must forward Edge output to Hub |
| Desktop calls → | `POST /edge/agent-tasks/:id/done` (→ Hub) | → broadcasts `agent.done` on Hub | **Yes** -- Desktop must signal completion to Hub |
| Hub `message.new` | N/A (Edge has no IM) | Must render IM messages | **Yes** -- New UI for IM messages |
| Hub `notification.new` | N/A | Must render notifications | **Yes** -- New UI for notifications |
| Hub `device.online`/`device.offline` | N/A | Must show presence | **Yes** -- New UI for presence |
| Edge `run.agent.permission_requested` | Desktop renders permission dialog | Desktop sends `permission_decide` to Edge | Already works (Edge→Desktop→Edge loop) |

---

## 5. Auth Integration Plan

### Current State
- **Hub**: JWT auth with claims `{user_id, device_type, device_id, exp}`. Device type gates access (`web` → `/web/*`, `desktop` → `/edge/*`).
- **Edge**: No auth. CORS restricts to trusted local origins (`http://localhost:*`, `http://127.0.0.1:*`, `tauri://*`).
- **Desktop**: No auth. Talks directly to local Edge.

### Integration Path

The Desktop needs to become an authenticated Hub client while remaining a direct Edge client:

```
Desktop Auth Flow:
1. User logs in → POST /client/auth/login with device_type="desktop"
2. Store JWT access_token + refresh_token
3. All Hub REST calls: Authorization: Bearer <access_token>
4. Hub WS: send auth frame {type: "auth", payload: {access_token: "..."}}
5. Token refresh: POST /client/auth/refresh before expiry (900s)
6. Edge calls: unchanged (no auth needed for local)
```

**New Desktop module needed**: `app/desktop/src/api/hubAuth.ts`
- `login(username, password, deviceId) → tokens`
- `getStoredToken() → string | null`
- `refreshToken() → void` (called on 401 or timer)
- `logout() → void`

---

## 6. Desktop Integration Changes

### New Files Needed

1. **`app/desktop/src/api/hubClient.ts`** -- REST client for Hub Server
   - `login()`, `register()`, `refreshToken()`, `logout()`, `getMe()`
   - `listSessions()`, `createPrivateSession()`, `createGroupSession()`
   - `getMessages(sessionId, beforeSeq)`, `sendMessage(sessionId, content)`
   - `listContacts()`, `searchUser()`, `sendFriendRequest()`
   - `registerDevice(deviceId, capabilities)`
   - `ackTask(taskId)`, `streamTask(taskId, content)`, `doneTask(taskId, finalContent)`, `failTask(taskId, error)`

2. **`app/desktop/src/api/hubWS.ts`** -- WebSocket client for Hub
   - Different protocol: auth frame, no cursor replay, different event types
   - `connect(token)` → sends auth frame, receives `auth.ok`/`auth.fail`
   - `subscribe(handler)` → receives Hub WS Frame events
   - Reconnect logic (similar to `eventClient.ts` but with auth re-handshake)

3. **`app/desktop/src/hooks/useHubIntegration.ts`** -- Bridge between Hub and Edge
   - Listens for Hub `agent.dispatch` events
   - Translates `dispatchPayload` → `StartRunRequest` for Edge
   - Calls `startRun()` via `edgeClient.ts`
   - Subscribes to Edge events for this run
   - Forwards `run.agent.text_delta` → `streamTask()` to Hub
   - On `run.agent.result` → `doneTask()` or `failTask()` to Hub
   - Maps `runId` ↔ `taskId` for bidirectional tracking

### Files to Modify

1. **`app/desktop/src/config.ts`** -- Add Hub URL
   ```
   export const HUB_URL = 'http://<hub-host>:8080';
   export const HUB_WS_URL = 'ws://<hub-host>:8080/client/ws';
   ```

2. **`app/desktop/src/api/edgeClient.ts`** -- Add `StartRunRequest.sessionId` mapping
   - The `sessionId` field in `StartRunRequest` already exists (`PostRuns` handler line 311: `SessionID`).
   - When bridging Hub→Edge, set `sessionId` to Hub's `SessionID` so Edge runs are associated with Hub sessions.

3. **`app/shared/src/events.ts`** -- No changes needed (Edge events stay the same)

4. **`app/shared/src/types.ts`** -- Add Hub-specific types
   - `HubSession`, `HubMessage`, `HubContact`, `HubUser`, `HubDispatchPayload`

---

## 7. Integration Plan -- Staged Approach

### Stage 1: Desktop Auth + Hub REST Client (effort: 3 days)
**Goal**: Desktop can authenticate with Hub and call REST APIs.

**Files**:
- NEW `app/desktop/src/api/hubClient.ts` -- typed REST wrappers
- NEW `app/desktop/src/api/hubAuth.ts` -- token management
- MODIFY `app/desktop/src/config.ts` -- add `HUB_URL`

**Tasks**:
1. Implement `hubAuth.ts`: login, token storage (localStorage), refresh timer
2. Implement `hubClient.ts`: auth endpoints (login, refresh, me)
3. Add Hub connection status to StatusBar

**Validation**: Desktop can log in, see user info, maintain session.

---

### Stage 2: Hub WebSocket Client (effort: 2 days)
**Goal**: Desktop establishes authenticated Hub WS, receives events.

**Files**:
- NEW `app/desktop/src/api/hubWS.ts` -- Hub WS client with auth frame protocol
- NEW `app/shared/src/hubEvents.ts` -- Hub WS event types

**Tasks**:
1. Implement `hubWS.ts`: connect with auth frame, parse Frame messages
2. Define Hub event types: `message.new`, `agent.dispatch`, `notification.new`, etc.
3. Create `useHubEventStream` hook
4. Add Hub connection indicator to StatusBar

**Validation**: Desktop receives Hub events (login from Web, see events in console).

---

### Stage 3: Agent Task Bridge (effort: 4 days)
**Goal**: Desktop receives agent.dispatch from Hub, executes via Edge, reports back.

**Files**:
- NEW `app/desktop/src/hooks/useHubIntegration.ts` -- Hub↔Edge bridge
- MODIFY `edge-server/internal/api/handlers.go` -- No changes needed (existing APIs suffice)

**Tasks**:
1. Listen for Hub `agent.dispatch` events
2. Parse `dispatchPayload` → extract agent_type, session_id, system_prompt, etc.
3. Create Edge Project+Thread for the Hub session (or use existing)
4. Call `startRun()` with appropriate prompt and agent config
5. Map Edge `run.agent.*` events → Hub `streamTask()` calls
6. Map Edge `run.agent.result` → Hub `doneTask()` or `failTask()`
7. Handle task cancellation (Hub `agent.cancel` → Edge `cancelRun()`)
8. Register device with Hub on startup (`POST /edge/devices/register`)

**Validation**: Web triggers agent → Desktop receives dispatch → Edge runs → Web sees agent messages in chat.

---

### Stage 4: IM UI in Desktop (effort: 5 days)
**Goal**: Desktop renders chat sessions, messages, contacts like a full IM client.

**Files**:
- NEW `app/desktop/src/components/ChatView/*` -- IM UI components
- NEW `app/desktop/src/hooks/useHubSessions.ts`
- NEW `app/desktop/src/hooks/useHubMessages.ts`

**Tasks**:
1. Session list sidebar (list sessions, create private/group, search)
2. Message view (chat bubble UI with agent vs user distinction)
3. Message input (text, code, file upload via Hub attachments API)
4. Contact management (search, add friend, block)
5. Notification overlay (friend requests, agent done, mentions)
6. Presence indicators (online/offline from device events)
7. Incremental message sync (REST `/sync` + WS `message.new`)

**Validation**: Desktop can fully participate in IM conversations, see agent outputs, manage contacts.

---

### Stage 5: Device and Sync Hardening (effort: 3 days)
**Goal**: Robust multi-device experience, offline resilience.

**Tasks**:
1. Message sync reconciliation (seq-based, handle gaps)
2. Offline task queue (if Desktop starts offline, pull pending tasks on connect)
3. Graceful disconnect/reconnect (clear auth state, re-handshake)
4. Device capabilities reporting (tell Hub which agent types Desktop supports)
5. Permission gating integration (Hub agent.dispatch includes permission requirements)
6. Token refresh robustness (handle 401 on WS, re-auth)

**Validation**: Kill Desktop, send messages from Web, reconnect Desktop -- all messages and tasks sync correctly.

---

### Stage 6: Edge Server Hardening (effort: 2 days)
**Goal**: Edge server can run as a system service, handle concurrent runs.

**Files**:
- MODIFY `edge-server/internal/store/` -- optional persistent store
- MODIFY `edge-server/internal/lifecycle/` -- concurrent run support

**Tasks**:
1. Ensure multiple concurrent runs work (one per thread)
2. Add run cleanup (stale runs, resource limits)
3. Optional: persist run history across restarts
4. Health check includes runner status

---

## 8. Estimated Effort Summary

| Stage | Description | Effort | Dependencies |
|-------|-------------|--------|-------------|
| 1 | Hub Auth + REST Client | 3 days | None |
| 2 | Hub WebSocket Client | 2 days | Stage 1 |
| 3 | Agent Task Bridge | 4 days | Stage 1, 2 |
| 4 | IM UI in Desktop | 5 days | Stage 1, 2, 3 |
| 5 | Device & Sync Hardening | 3 days | Stage 1-4 |
| 6 | Edge Server Hardening | 2 days | Stage 3 |
| **Total** | | **~19 days** | |

---

## 9. Key Architectural Decisions / Risks

### A. Dual WS Connection
The Desktop will maintain TWO WebSocket connections concurrently: one to Hub (IM + dispatch) and one to Edge (agent events). This is intentional -- Hub and Edge serve different roles. However, connection lifecycle management becomes critical. If either connection drops, the bridge between them breaks.

**Mitigation**: HubIntegration hook tracks both connection states. On Hub disconnect, Edge runs continue locally but cannot report back. On Edge disconnect, Hub dispatch tasks queue in Redis (already implemented) and retry on reconnect.

### B. Event Translation Overhead
The Desktop must translate between two event schemas:
- Hub `agent.dispatch` payload → Edge `StartRunRequest`
- Edge `run.agent.text_delta` → Hub `streamTask(taskId, content)`
- Edge `run.agent.result` → Hub `doneTask(taskId, finalContent)`

This translation is straightforward (field remapping) but must be correct and complete.

### C. Session/Thread Mapping
Hub's Session (chat room) and Edge's Project+Thread (work context) are different abstractions. The bridge needs to decide: one Edge Thread per Hub Session, or one per agent task?

**Recommendation**: One Edge Project per Hub Session (use `sessionId` in `StartRunRequest`), one Edge Thread per Hub task invocation. This gives clean isolation of agent runs within a chat context.

### D. No Auth on Edge
Edge currently has no authentication because it was designed for local-only use. If in the future Edge needs to be accessible from other machines on the network, auth must be added (JWT validation with Hub-issued tokens, or an API key).

---

## 10. Files Referenced

### Hub Server
- `D:\Code\AgentHub\hub-server\internal\router\router.go` -- All routes
- `D:\Code\AgentHub\hub-server\internal\handler\auth.go` -- Auth handler
- `D:\Code\AgentHub\hub-server\internal\handler\agent.go` -- Agent handler + edge callbacks
- `D:\Code\AgentHub\hub-server\internal\handler\device.go` -- Device registration
- `D:\Code\AgentHub\hub-server\internal\handler\session.go` -- Session handler
- `D:\Code\AgentHub\hub-server\internal\handler\message.go` -- Message handler
- `D:\Code\AgentHub\hub-server\internal\handler\response.go` -- Response helpers
- `D:\Code\AgentHub\hub-server\internal\handler\ws.go` -- WebSocket handler
- `D:\Code\AgentHub\hub-server\internal\service\agent.go` -- Agent service + dispatch
- `D:\Code\AgentHub\hub-server\internal\service\eventbus.go` -- Internal event bus
- `D:\Code\AgentHub\hub-server\internal\service\message.go` -- Message service
- `D:\Code\AgentHub\hub-server\internal\service\session.go` -- Session service
- `D:\Code\AgentHub\hub-server\internal\model\*.go` -- All data models
- `D:\Code\AgentHub\hub-server\internal\ws\frame.go` -- WS frame types
- `D:\Code\AgentHub\hub-server\internal\ws\manager.go` -- WS connection manager
- `D:\Code\AgentHub\hub-server\internal\middleware\auth.go` -- JWT auth middleware
- `D:\Code\AgentHub\hub-server\internal\middleware\device_type.go` -- Device type gate
- `D:\Code\AgentHub\hub-server\cmd\server-hub\main.go` -- Server wiring
- `D:\Code\AgentHub\hub-server\docs\Server-Hub API接口文档.md` -- API docs

### Edge Server
- `D:\Code\AgentHub\edge-server\internal\api\handlers.go` -- REST + WS handlers
- `D:\Code\AgentHub\edge-server\internal\events\bus.go` -- Event bus with cursor replay
- `D:\Code\AgentHub\edge-server\internal\httpserver\server.go` -- Server wiring

### Desktop
- `D:\Code\AgentHub\app\desktop\src\config.ts` -- URLs config
- `D:\Code\AgentHub\app\desktop\src\api\eventClient.ts` -- Edge WS client
- `D:\Code\AgentHub\app\desktop\src\api\edgeClient.ts` -- Edge REST client
- `D:\Code\AgentHub\app\desktop\src\hooks\useEventStream.ts` -- Event log hook
- `D:\Code\AgentHub\app\desktop\src\hooks\useChatMessages.ts` -- Agent event → UI
- `D:\Code\AgentHub\app\shared\src\events.ts` -- Event type definitions
- `D:\Code\AgentHub\app\shared\src\types.ts` -- REST type definitions
