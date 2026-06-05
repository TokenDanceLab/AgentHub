# Multica → AgentHub Source Adoption Map

> Generated: 2026-05-24 | Scope: Product model, task lifecycle, frontend architecture

## 1. Task/Run Lifecycle

### 1.1 Status Machine

**Multica** (`server/internal/service/task.go:80-86`, `server/internal/handler/task_lifecycle.go:24-56`):
Status flow: `∅ → queued → dispatched → running → completed|failed|cancelled`
- `task_lifecycle.go:24-56` `RecoverOrphanedTasks`: daemon startup reaps dispatched/running rows atomically, feeds them through `HandleFailedTasks` for event broadcast + auto-retry
- `task_lifecycle.go:67-96` `PinTaskSession`: persists `session_id` + `work_dir` to task row, enables crash-resume
- `task.go:382-444` `EnqueueTaskForIssue`: validates agent not archived, has runtime → `CreateAgentTask` → broadcast → notify daemon

**AgentHub** (`edge-server/internal/lifecycle/process_executor.go:79-139`):
Status flow: `∅ → queued → started → finished|failed|cancelled|cancelling`
- No `dispatched` state; Start skips directly from `queued` → `started`
- No orphan recovery; no session pinning
- `cancel` pathway goes through `cancelling` intermediate state for graceful SIGTERM

| # | Multica source | AgentHub source | Gap | Priority |
|---|---|---|---|---|
| 1 | `server/internal/service/task.go:944` `StartTask` transitions dispatched→running | `edge-server/internal/lifecycle/process_executor.go:231` `SetRunStatusIf(run.ID, "started", "queued")` | AgentHub has no `dispatched` state. This means there's no way to distinguish "claimed by daemon but not yet executing" from "still in queue". Multica's dispatched state enables stale-claim recovery (`ClaimTaskForRuntime` at `task.go:814` with `claimResponseRecoveryWindow=90s`). | **P1** — needed once multi-node edge deploys |
| 2 | `server/internal/handler/task_lifecycle.go:24-56` `RecoverOrphanedTasks` | _missing_ | AgentHub has no orphan recovery. If ProcessExecutor crashes, runs stuck at `started` never transition. Add `RecoverOrphanedRuns` that atomically fails rows where `status='started'` and no running process exists. | **P1** — data consistency |
| 3 | `server/internal/handler/task_lifecycle.go:67-96` `PinTaskSession` | _missing_ | AgentHub stores SessionID on RunContext but never persists it mid-run. A crash loses the resume pointer. Add `PATCH /runs/:id/session` endpoint + `PinSession` on ProcessExecutor. | **P1** — crash resilience |
| 4 | `server/internal/service/task.go:112-138` `process_executor.go:114-128` graceful cancel via stdin interrupt | `edge-server/internal/lifecycle/process_executor.go:103-138` `Cancel` sends adapter interrupt then context cancel | Both support graceful cancel. Multica's is via poll-based `watchTaskCancellation`; AgentHub's is via adapter `WriteInterrupt`. Feature parity achieved. | **P2** — already done |

### 1.2 Auto-Retry & Failure Classification

**Multica** (`server/internal/service/task.go:1263-1344`):
- `retryableReasons`: `runtime_offline`, `runtime_recovery`, `timeout`, `codex_semantic_inactivity`
- `taskErrorType`: maps reason → `runtime`, `timeout`, `agent_output`, `cancelled` categories
- `MaybeRetryFailedTask`: checks `attempt < max_attempts`, excludes autopilot, calls `CreateRetryTask`
- `resumeUnsafeFailureReason`: `iteration_limit`, `agent_fallback_message`, `api_invalid_request` → force fresh session

**AgentHub** (`edge-server/internal/lifecycle/process_executor.go:322-331`):
- `publishFailed`: marks status `failed`, publishes `run.failed` event with error string
- No retry logic at all
- 30-minute `defaultRunTimeout` is the only timeout handling

| # | Multica source | AgentHub source | Gap | Priority |
|---|---|---|---|---|
| 5 | `server/internal/service/task.go:1263-1272` `retryableReasons` map | _missing_ | AgentHub has no failure classification. All failures are treated identically. Add `FailureReason` enum (runtime_offline, timeout, agent_error) to `store.Run` and classify in `publishFailed`. | **P0** — blocks retry feature |
| 6 | `server/internal/service/task.go:1295-1343` `MaybeRetryFailedTask` | _missing_ | No auto-retry. Implement `MaybeRetryRun` in ProcessExecutor that creates a new queued run inheriting agent/project/thread when failure reason is retryable. | **P1** — user-facing reliability |
| 7 | `server/internal/service/task.go:370-377` `willRetryTask` guard | _missing_ | No max_attempts concept on Run model. Add `Attempt` and `MaxAttempts` fields to `store.Run`. | **P1** — prevents infinite retry loops |

### 1.3 Task Claim & Dispatch

**Multica** (`server/internal/service/task.go:740-918`):
- `ClaimTask(agentID)`: checks `max_concurrent_tasks`, atomically claims next queued task
- `ClaimTaskForRuntime(runtimeID)`: empty-claim Redis cache fast path → reclaim stale dispatched → iterate candidates
- `EmptyClaimCache`: Redis-backed cache avoids Postgres scans on idle runtimes
- `notifyTaskAvailable`: bumps invalidation version then kicks daemon WebSocket

**AgentHub** (`edge-server/internal/lifecycle/process_executor.go:79-101`):
- No claim mechanism. API handler creates run in `queued` status, ProcessExecutor.Start picks it up immediately.
- Single-node: run is created and dispatched synchronously — no distributed claim needed.

| # | Multica source | AgentHub source | Gap | Priority |
|---|---|---|---|---|
| 8 | `server/internal/service/task.go:742-804` `ClaimTask` with `max_concurrent_tasks` checking | `edge-server/internal/lifecycle/process_executor.go:84-86` checks only `status != "queued"` | No concurrency limiting. A single project/agent can have unlimited parallel runs. Add `MaxConcurrentRuns` to agent config. | **P2** — needed at scale |
| 9 | `server/internal/service/task.go:814-918` `ClaimTaskForRuntime` with empty-claim cache | _missing_ | No distributed claim support. When Edge Server scales to multiple instances, two could pick up the same queued run. Add `ClaimRun` with `UPDATE ... WHERE status='queued' RETURNING *` atomicity. | **P2** — needed for multi-node |

### 1.4 Session Resume & Fork

**Multica** (`server/internal/service/task.go:84-95`, daemon claim handler):
- `ForceFreshSession`: flag on task that skips `(agent_id, issue_id)` session resume lookup
- `PriorSessionID`/`PriorWorkDir`: carried on task from previous attempt, passed to agent process env
- Chat sessions: `UpdateChatSessionSession` in same tx as `CompleteAgentTask` — closes race on next claim
- Manual rerun: `force_fresh_session=true` because user judged prior output bad

**AgentHub** (`edge-server/internal/adapters/runnerctx/` — `RunProcessContext`):
- `SessionID`, `ContinueLast`, `ForkSession` fields exist on RunProcessContext
- `ContinueLast` and `ForkSession` are passed to adapter's BuildCommand but no server-side persistence

| # | Multica source | AgentHub source | Gap | Priority |
|---|---|---|---|---|
| 10 | `server/internal/service/task.go:963-998` `CompleteTask` updates `chat_session.session_id` in same tx | `edge-server/internal/lifecycle/process_executor.go:266-269` just sets status to `finished` | AgentHub doesn't persist session ID on completion. Add `SessionID` field to `store.Run` and write it on `run.finished`. | **P1** — resume requires persisted state |
| 11 | `server/internal/handler/task_lifecycle.go:110-154` `RerunIssue` with `ForceFreshSession` | `edge-server/internal/adapters/runnerctx/` has `ContinueLast`/`ForkSession` flags | Feature exists but no UI-accessible rerun. Add "Retry" button in RunDetail that creates a new run with explicit `ForceFreshSession`. | **P2** — UX |

### 1.5 Multi-Tenant Task Types

**Multica** (`server/internal/service/task.go:382-630`):
- `EnqueueTaskForIssue`: agent assigned to issue
- `EnqueueTaskForMention`: @-mentioned agent on issue
- `EnqueueTaskForSquadLeader`: squad leader dispatch
- `EnqueueQuickCreateTask`: natural-language → issue creation
- `EnqueueChatTask`: direct chat message
- `CancelTasksForIssue` / `CancelTasksForAgent` / `CancelTasksByTriggerComment`: scoped cancellation

**AgentHub** (`edge-server/internal/lifecycle/process_executor.go:79`):
- Single `Start(run store.Run, runCtx RunProcessContext)` — one type of run
- No differentiation between chat, issue, quick-create, or mention

| # | Multica source | AgentHub source | Gap | Priority |
|---|---|---|---|---|
| 12 | `server/internal/service/task.go:382-630` five enqueue paths | `edge-server/internal/lifecycle/process_executor.go:79` single Start entry | AgentHub only supports chat-initiated runs. Add `RunType` field (chat, issue, quick_create) to `store.Run` for different post-completion behavior. | **P2** — product scope |

---

## 2. Frontend Architecture

### 2.1 State Management Split

**Multica** (from `CLAUDE.md` and `packages/core/`):
- **TanStack Query**: owns ALL server state (issues, agents, workspaces, inbox)
- **Zustand**: client state only (UI selections, filters, drafts, modal state, navigation)
- **Hard rule**: never duplicate server data into Zustand
- **WS events**: invalidate Query cache — never write to stores directly
- **Mutations**: optimistic by default (apply locally → send → rollback on failure → invalidate on settle)

**AgentHub** (`app/desktop/src/stores/`):
- **Zustand only**: `runStore`, `threadStore`, `connectionStore`, `searchStore`, `uiStore`
- No TanStack Query — all data management is manual
- `runStore` holds both server data (outputText, toolCalls, changedFiles) and client state (isStreaming) — mixed concern
- No optimistic mutation pattern
- `useHealth()` hook (`useHealth.ts`) polls REST for health; no WS-driven cache invalidation

| # | Multica source | AgentHub source | Gap | Priority |
|---|---|---|---|---|
| 13 | `packages/core/` Zustand stores (view-store, draft-store, create-mode-store) are pure client state | `app/desktop/src/stores/runStore.ts:6-12` `RunState` mixes server output with streaming flag | AgentHub stores mix server and client state. Split `runStore` into: (a) TanStack Query cache for run data (output, tool calls, status) and (b) Zustand `runUIStore` for streaming flag, selected run ID, scroll position. | **P0** — architectural |
| 14 | `CLAUDE.md` "WS events invalidate queries — they never write to stores directly" | `useChatMessages.ts` writes streaming output directly to `runStore.appendOutput` | Event → store direct write pattern couples transport to state. Introduce QueryClient invalidation for run data; keep only transient streaming text in a lightweight buffer. | **P0** — race conditions |

### 2.2 WebSocket Client

**Multica** (`packages/core/api/ws-client.ts:27-200`):
- `WSClient` class: typed event handlers (`handlers: Map<WSEventType, Set<EventHandler>>`)
- Auth: token sent as first WebSocket message after connect (not URL param)
- Reconnect: 3s exponential backoff, `onReconnectCallbacks` for cache invalidation
- Identity: `client_platform`, `client_version`, `client_os` as query params
- `anyHandlers` for catch-all listeners
- Graceful disconnect: removes `onclose` before `ws.close()` to prevent reconnect race

**AgentHub** (`app/desktop/src/hooks/useChatMessages.ts`):
- Single hook manages WebSocket lifecycle inline
- No typed event handler registry — processes messages in a switch/if chain
- No reconnect callback pattern

| # | Multica source | AgentHub source | Gap | Priority |
|---|---|---|---|---|
| 15 | `packages/core/api/ws-client.ts:27-200` typed WSClient class with event registry | `app/desktop/src/hooks/useChatMessages.ts` inline WebSocket | AgentHub WS logic is tightly coupled to the hook. Extract `EdgeWSClient` class matching Multica's `WSClient` pattern: typed handler map, auth-first-message, reconnect callbacks. | **P1** — testability, reuse |
| 16 | `packages/core/api/ws-client.ts:126-137` `onReconnectCallbacks` pattern | _missing_ | No mechanism to invalidate caches on reconnect. Add `onReconnect` callback registry to WS client so stale data is refreshed after reconnect. | **P1** — cache consistency |

### 2.3 Package Architecture & Code Sharing

**Multica** (monorepo with pnpm workspaces + Turborepo):
- `packages/core/`: zero react-dom, zero localStorage, zero UI. All shared Zustand stores.
- `packages/views/`: zero next/*, zero react-router-dom. Shared business pages.
- `packages/ui/`: atomic components, zero @multica/core imports.
- `apps/web/platform/` and `apps/desktop/src/renderer/src/platform/`: only place for framework-specific wiring
- `CoreProvider` in `packages/core/platform/`: initializes API client, auth, WS, QueryClient
- `NavigationAdapter`: shared routing abstraction; apps provide concrete implementations

**AgentHub** (`app/desktop/src/`):
- Single SPA — all code in `app/desktop/src/`
- No shared packages between web (if any) and desktop
- Components, stores, hooks all in one app tree
- No framework abstraction layer

| # | Multica source | AgentHub source | Gap | Priority |
|---|---|---|---|---|
| 17 | `packages/core/` ← zero DOM deps; `packages/views/` ← zero framework deps | All in `app/desktop/src/` | No code sharing between potential web + desktop apps. Extract `packages/edge-core/` (stores, API client, WS, types) and `packages/edge-views/` (shared components). | **P2** — multi-platform prep |
| 18 | `packages/core/platform/` `CoreProvider` initializes everything | `App.tsx:36-61` inline initialization | App.tsx does API client, WS, and store initialization inline. Extract `EdgeProvider` that wraps children with pre-configured QueryClient + WS + stores, matching Multica's `CoreProvider`. | **P2** — cleanliness |

### 2.4 Component Architecture

**Multica** (`apps/web/app/[workspaceSlug]/(dashboard)/`):
- Page-per-entity: `agents/page.tsx`, `agents/[id]/page.tsx`, `issues/page.tsx`, `issues/[id]/page.tsx`
- Shared layouts: `layout.tsx` per route segment
- `DashboardGuard` from `packages/views/layout/` for auth/workspace gating
- Agent Live Card: rendered in issue detail, updates via WS→Query invalidation
- `WorkspaceRouteLayout` handles workspace context, auto-heals stale tabs

**AgentHub** (`app/desktop/src/components/`):
- `App.tsx`: monolithic component (20973 bytes) handling sidebar, thread panel, chat view, run detail, search, mobile toggles
- No layout composition — all panels rendered inline in App
- `ChatView.tsx`: lazy-loaded, handles message rendering with MessageTree
- `RunDetail.tsx`: lazy-loaded, render run output/tool calls/file changes
- `PermissionDialog.tsx`: modal for user approval of tool calls

| # | Multica source | AgentHub source | Gap | Priority |
|---|---|---|---|---|
| 19 | `apps/web/app/[workspaceSlug]/(dashboard)/layout.tsx` shared dashboard shell | `app/desktop/src/App.tsx` 500+ line monolithic component | App.tsx is too large. Split into `DashboardLayout` (sidebar + main + right panel) with children slots, matching Multica's layout composition pattern. | **P1** — maintainability |
| 20 | `packages/views/layout/` `DashboardGuard` for auth/workspace gating | `App.tsx:42-43` inline banner state + `useHealth` polling | No shared auth/connection guard. Extract `EdgeGuard` component that shows connection banner, health status, and blocks interaction when disconnected. | **P1** — consistent error UX |
| 21 | Multica `packages/core/agents/use-agent-presence.ts` real-time presence hook | _missing_ | No agent presence tracking in AgentHub. Add `useAgentPresence` hook that derives online/idle/working status from WS events and exposes it to AgentList. | **P2** — UX enhancement |

### 2.5 Mutation Patterns

**Multica** (`CLAUDE.md`):
- "Mutations are optimistic by default"
- Pattern: `useMutation` → `onMutate` (apply locally) → `onError` (rollback) → `onSettled` (invalidate)
- Dedicated `parseWithFallback` with Zod schemas for all API responses

**AgentHub** (`app/desktop/src/api/edgeClient.ts`):
- Direct `fetch` calls with `try/catch` in components
- No `useMutation` wrapping
- No optimistic updates
- No Zod schema validation on responses — raw type assertions

| # | Multica source | AgentHub source | Gap | Priority |
|---|---|---|---|---|
| 22 | `packages/core/api/schema.ts` `parseWithFallback` with Zod | `app/desktop/src/api/edgeClient.ts` raw fetch + type assertion | No response validation. Server schema drift causes white-screen. Add Zod schemas for all API responses and `parseWithFallback` pattern. | **P0** — crash prevention |
| 23 | `CLAUDE.md` "Mutations are optimistic by default" | `App.tsx` direct `startRun()` call with manual state update | No optimistic mutation. Wrap `startRun`, `cancelRun` in `useMutation` with optimistic cache updates. | **P1** — perceived performance |

---

## 3. Adapter Architecture

### 3.1 Interface Design

**Multica** (`server/internal/daemon/daemon.go:29-33`):
- `taskRunner` interface: `run(ctx, task, provider, slot, log) (TaskResult, error)`
- Provider dispatch via `d.cfg.Agents[provider]` map — each provider is a config entry
- Execution environment via `execenv` package: isolated workdir, env vars, repo cache

**AgentHub** (`edge-server/internal/adapters/adapter.go:23-43`):
- `AgentAdapter` interface: `Metadata()`, `Capabilities()`, `BuildCommand()`, `ParseStream()`, `NeedsStdin()`
- Registered in `Registry` map — resolved per-run via agentID → adapter
- Three implementations: `ClaudeCodeAdapter`, `CodexAdapter`, `OpenCodeAdapter`
- `OrchestratorAdapter` wraps ClaudeCode for sub-agent dispatch

| # | Multica source | AgentHub source | Gap | Priority |
|---|---|---|---|---|
| 24 | `server/internal/daemon/daemon.go:2222-2225` provider dispatch via `cfg.Agents[provider]` config map | `edge-server/internal/adapters/registry.go` `Registry.Resolve(agentID)` | AgentHub already has a more structured adapter registry than Multica's config-map approach. Keep and extend. | **P2** — already better |
| 25 | `server/internal/daemon/execenv/` isolated env setup (codex_home, sandbox, skills, git) | `edge-server/internal/lifecycle/process_executor.go:296-320` `envForRun` with sanitized env | Multica's execenv is richer (per-provider sandbox policy, skill file injection, git config). AgentHub only sets AGENTHUB_* vars. Add `execenv` package for provider-specific env setup. | **P2** — capability |

---

## 4. Event Bus & Real-time

### 4.1 Event Taxonomy

**Multica** (`server/pkg/protocol/` + `server/internal/events/bus.go`):
- Task events: `task:queued`, `task:dispatch`, `task:started`, `task:completed`, `task:failed`, `task:cancelled`, `task:progress`
- Agent event: `agent:status`
- Chat events: `chat:done`
- Issue events: `issue:updated`
- Comment events: `comment:created`, `comment:unresolved`
- All events carry `workspace_id` for tenant routing

**AgentHub** (`edge-server/internal/adapters/adapter.go:74-102`):
- Run lifecycle: `run.started`, `run.finished`, `run.failed`, `run.cancelled`
- Agent streaming: `run.agent.text_delta`, `run.agent.thinking`, `run.agent.tool_call`, `run.agent.tool_result`, `run.agent.file_change`, `run.agent.result` (+ 15 more granular event types)
- Permission: `run.agent.permission_requested`, `run.agent.permission_decided`
- Raw output: `run.output.batch`

| # | Multica source | AgentHub source | Gap | Priority |
|---|---|---|---|---|
| 26 | `server/pkg/protocol/` `EventTaskQueued`, `EventTaskDispatch` at enqueue time | `edge-server/internal/adapters/adapter.go:74-102` no queued/dispatched events | AgentHub doesn't emit events when a run is queued. Frontend has no visibility until `run.started`. Add `run.queued` event on API run creation. | **P1** — UI feedback |
| 27 | `server/internal/service/task.go:1579-1593` `ReportProgress` with step/total | `edge-server/internal/adapters/adapter.go:74-102` no progress event type | No task progress reporting. Add `run.agent.progress` event type and emit from adapters that support progress (Codex step counting). | **P2** — UX |

---

## 5. Priority Summary

### P0 (blocking — implement now)
1. **#5**: FailureReason enum + classification on publishFailed
2. **#13**: Split runStore server/client state (introduce TanStack Query)
3. **#14**: WS events invalidate queries, not write to stores
4. **#22**: Zod schemas + parseWithFallback for all API responses

### P1 (important — next sprint)
5. **#1**: Add `dispatched` run status for stale-claim recovery
6. **#2**: Orphan run recovery on process restart
7. **#3**: Mid-run session pinning (`PATCH /runs/:id/session`)
8. **#6**: Auto-retry with `MaybeRetryRun`
9. **#7**: `Attempt`/`MaxAttempts` on Run model
10. **#10**: Persist SessionID on run completion
11. **#15**: Extract typed `EdgeWSClient` class
12. **#16**: Reconnect callback registry for cache invalidation
13. **#19**: Split App.tsx into layout + panels
14. **#20**: Extract `EdgeGuard` connection/auth component
15. **#23**: Optimistic mutations with `useMutation`
16. **#26**: Emit `run.queued` event on run creation

### P2 (nice-to-have — future)
17. **#4**: Graceful cancel (already done)
18. **#8**: `MaxConcurrentRuns` per agent
19. **#9**: Distributed claim for multi-node
20. **#11**: UI rerun button with ForceFreshSession
21. **#12**: RunType enum (chat/issue/quick_create)
22. **#17**: Extract `packages/edge-core/` + `packages/edge-views/`
23. **#18**: `EdgeProvider` component
24. **#21**: Agent presence hook
25. **#24**: Adapter registry (already better than Multica)
26. **#25**: Provider-specific execenv
27. **#27**: Task progress events
