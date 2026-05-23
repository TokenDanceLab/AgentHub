# AgentHub Best Practices Playbook

> Generated: 2026-05-24 from 17 source adoption maps across 14 reference projects
> Methodology: Patterns appear in 2+ independent reference projects → evaluated against AgentHub source → concrete adoption plan
> Target audience: AgentHub core team (Edge Server, Desktop, Hub Server)

---

## 1. `edge-server/internal/adapters/` -- Adapter Interface, Hook System, Agent Lifecycle

### Priority Summary

| # | Pattern | Ref Count | P | Effort | Depends On |
|---|---------|-----------|----|--------|------------|
| A1 | Permission rule engine (deny/ask/allow) | 5 | P0 | 6d | Security section (S1) |
| A2 | Agent state machine (status enum + transitions) | 5 | P0 | 5d | -- |
| A3 | Sub-agent spawn handler + agent registry | 4 | P0 | 5d | A5 |
| A4 | Phase-driven agent loop | 3 | P0 | 8d | A2 |
| A5 | ContextManager with token tracking + auto-compact | 5 | P0 | 5d | -- |
| A6 | Inter-agent message queue (mailbox) | 3 | P0 | 3d | A3 |
| A7 | ModelSpec struct (replaces string aliases) | 4 | P1 | 3d | -- |
| A8 | ToolDefinition interface (custom tool registration) | 3 | P1 | 3d | -- |
| A9 | Hook system expansion (6 -> 16+ hooks) | 4 | P1 | 5d | -- |
| A10 | RetryConfig + auto-retry (FailureReason enum) | 3 | P1 | 2d | A2 |
| A11 | Sub-agent context isolation | 3 | P1 | 1d | A3 |
| A12 | External hook execution (shell/HTTP/LLM) | 2 | P2 | 4d | -- |
| A13 | Per-agent capability whitelist | 2 | P2 | 1d | -- |

### A1: Permission Rule Engine (deny/ask/allow) -- 5 reference projects

**Pattern**: Every mature agent runtime implements a 3-tier rule engine with exact/prefix/wildcard matching against tool name + input content. Rules are layered by source (user settings, project settings, local settings, CLI flags). Deny beats ask, ask beats allow. Claude Code `permissions.ts` uses `getDenyRules()`/`getAskRules()`/`getAllowRules()` with shell-command-aware matchers that strip safe wrappers before matching. LobeHub has a 7-phase intervention pipeline with security blacklist, per-tool resolvers, override policies, and mode-based escalation. Goose has `PermissionInspector` with allow/deny/ask triple output. cline has `CommandPermissionController` with per-command configurable permissions.

**Current gap**: `edge-server/internal/adapters/control_protocol.go:74-144` -- `DefaultPermissionHandler` auto-approves every `can_use_tool` with `behavior: "allow"` unconditionally. The `SecurityHook.PreToolUse` at `security_hooks.go:36` blocks `RiskBlocked` patterns only. There is no deny/ask/allow rule store, no prefix/wildcard matching, no rule layering.

**Best solution**: Port Claude Code's rule engine from `bashPermissions.ts:869-935`. Create `edge-server/internal/security/permission_engine.go` with `PermissionRule` struct, `PermissionEngine` holding deny/ask/allow rules per tool, `CheckPermission(toolName, input, context) PermissionDecision`, and `stripSafeWrappers(command)` ported from `bashPermissions.ts:524-615`. Integrate into a new `SecuredPermissionHandler` that replaces `DefaultPermissionHandler`.

### A2: Agent State Machine -- 5 reference projects

**Pattern**: LobeHub defines `AgentState` with `idle | running | waiting_for_human | done | error | interrupted` at `state.ts:20-147`, with `stepCount`, `maxSteps`, `forceFinish`, `interruption` struct, `pendingToolsCalling`, `pendingHumanPrompt`, and `costLimit`. Roo-Code defines `AgentLoopState` with `NO_TASK → RUNNING ↔ STREAMING → WAITING_FOR_INPUT / IDLE / RESUMABLE` at `agent-state.ts:48-108`. cline tracks 20+ dimensions in `TaskState.ts:6-83`. Kanna uses 3-Map state machine with `activeTurns`, `drainingStreams`, `claudeSessions` at `agent.ts:674-684`. Multica has `∅ → queued → dispatched → running → completed|failed|cancelled` at `task.go:80-86`.

**Current gap**: `edge-server/internal/adapters/orchestrator.go:17-19` -- `OrchestratorAdapter` is a stateless wrapper. `app/desktop/src/stores/runStore.ts:6-12` -- `RunState` has only `runId, status (untyped string), outputText, toolCalls, changedFiles`. No state transitions, no cost tracking, no interruption/resume.

**Best solution**: Create `edge-server/internal/adapters/agent_state.go` with a Go struct mirroring LobeHub's `AgentState` at `state.ts:20-147`. Define valid transitions. Thread through `RunProcessContext`. Reference Kanna's `ActiveTurn` at `agent.ts:57-74` for the 22-field turn tracking pattern.

### A3: Sub-Agent Spawn Handler + Agent Registry -- 4 reference projects

**Pattern**: Codex has `handle_spawn_agent()` at `spawn.rs:45-234` with `SpawnAgentArgs { message, task_name, agent_type, model, fork_turns }`. `AgentRegistry` at `registry.rs:22-26` tracks agents with `Mutex<HashMap<String, AgentMetadata>>` and `AtomicUsize` total count, with `reserve_spawn_slot()` using atomic CAS for `agent_max_threads` limits. Goose has `SubagentHandler` with full session management at `subagent_handler.rs`. LibreChat has `buildSubagentConfigs()` at `run.ts:628-716` with recursive sub-agent config tree, ancestor cycle detection, and depth assertion.

**Current gap**: `edge-server/internal/adapters/orchestrator.go:25-31` -- `subAgents` parameter is explicitly ignored (`_ = subAgents`). Orchestrator only wraps Claude Code with a system prompt. No spawn handler, no agent instance registry, no slot limits, no cycle detection.

**Best solution**: Create `edge-server/internal/adapters/agent_registry.go` with `map[string]*AgentInstance` guarded by `sync.RWMutex`, `reserve_spawn_slot()` using Go `atomic.Int32`. Create spawn handler in `orchestrator.go` that intercepts `task_started` events and forks sub-agent runs. Implement cycle detection with `ancestors` Set and depth limit (LibreChat's `run.ts:654-668`). Implement fork modes for context inheritance (Codex `spawn.rs:88-98`).

---

## 2. `edge-server/internal/lifecycle/` -- Process Management, Workspace, Sandbox

### Priority Summary

| # | Pattern | Ref Count | P | Effort | Depends On |
|---|---------|-----------|----|--------|------------|
| L1 | WorkspaceProvider interface (ABC pattern) | 2 | P0 | 4d | -- |
| L2 | Health check + startup grace period | 2 | P0 | 2d | L1 |
| L3 | ProcessWorkspaceProvider (upgrade ProcessExecutor) | 2 | P0 | 5d | L1 |
| L4 | Workspace status state machine | 2 | P1 | 2d | L1 |
| L5 | Workspace limit enforcement (auto-pause oldest) | 2 | P1 | 2d | L3 |
| L6 | Session API key per workspace | 2 | P1 | 2d | L3 |
| L7 | Dispatched run status for stale-claim recovery | 2 | P1 | 1d | -- |
| L8 | DockerWorkspaceProvider | 1 | P1 | 7d | L1 |
| L9 | Orphan run recovery on process restart | 2 | P1 | 2d | -- |

### L1: WorkspaceProvider Interface -- 2 reference projects

**Pattern**: OpenHands defines `SandboxService` ABC at `sandbox_service.py:29-232` with 7 abstract methods: `search`, `get`, `start`, `resume`, `pause`, `delete`, `wait`. Three implementations: Docker, Process, Remote. The `SandboxSpec` at `sandbox_spec_models.py` provides reusable blueprints with `id`, `command`, `initial_env`, `working_dir`. Codex has `execenv` package with per-provider sandbox policy, skill file injection, and git config isolation.

**Current gap**: `edge-server/internal/lifecycle/executor.go:5-16` -- `RunExecutor` has only 2 methods: `Start(run, ctx) error` + `Cancel(runID) CancelResult`. `ProcessExecutor` at `process_executor.go:32` runs `exec.CommandContext` directly with no sandbox abstraction, no workspace lifecycle, no health check.

**Best solution**: Create `edge-server/internal/lifecycle/workspace_provider.go` with `WorkspaceProvider` interface (8 methods: `StartWorkspace`, `ResumeWorkspace`, `PauseWorkspace`, `DeleteWorkspace`, `GetWorkspace`, `WaitReady`, `EnforceLimit`). Create `WorkspaceSpec` struct at `workspace_spec.go` mimicking OpenHands' `SandboxSpecInfo`. Upgrade `ProcessExecutor` to implement `WorkspaceProvider`.

### L2: Health Check + Startup Grace Period -- 2 reference projects

**Pattern**: OpenHands validates sandbox health via `wait_for_sandbox_running()` at `sandbox_service.py:78-126` -- polls every 2s, checks `/alive` endpoint, ERROR if timeout after `startup_grace_seconds` (default 15s). Kanna similarly uses `claudeSessions` map to track session health with stream error handling.

**Current gap**: `edge-server/internal/lifecycle/process_executor.go:79-101` -- `Start()` immediately sets `"started"` on `cmd.Start()` success. If the child process starts but immediately crashes, AgentHub won't know until `cmd.Wait()`.

**Best solution**: Add health-check poll after `cmd.Start()`: poll workspace health endpoint every 1s for up to `startupGracePeriod` (default 15s). Wire through `WorkspaceProvider.WaitReady()`.

### L3: ProcessWorkspaceProvider -- 2 reference projects

**Pattern**: OpenHands' `ProcessSandboxService` at `process_sandbox_service.py:67-461` gives each sandbox its own working directory, port allocation, session API key, and process tracking. Kanna's `AgentCoordinator` at `agent.ts:674-684` tracks per-chat sessions with `claudeSessions` map.

**Current gap**: `edge-server/internal/lifecycle/process_executor.go` shares `cfg.WorkDir` across runs, has no port management, no session API key, no health checking, no limit enforcement, no lifecycle states.

**Best solution**: Upgrade `ProcessExecutor` to implement `WorkspaceProvider`: create dedicated subdirectory under `workspaces/` root per workspace, track workspaces in `sync.Map`, add `WaitReady()` with HTTP health poll, add `PauseWorkspace()` via process signal, add `EnforceLimit()`.

---

## 3. `edge-server/internal/security/` -- Permission, Validation, Approval

### Priority Summary

| # | Pattern | Ref Count | P | Effort | Depends On |
|---|---------|-----------|----|--------|------------|
| S1 | 23-check security pipeline (multi-validator) | 2 | P0 | 8d | -- |
| S2 | Shell unquoting before security checks | 2 | P0 | 1d | -- |
| S3 | Path validation for path-aware commands | 2 | P0 | 5d | -- |
| S4 | Compound command security gates (cd+git, cd+write) | 2 | P0 | 3d | S3 |
| S5 | Event-emitting permission UI (blocking Desktop approval) | 3 | P1 | 3d | S1 |
| S6 | Wrapper command stripping before rule matching | 2 | P1 | 2d | S1 |
| S7 | Sandbox integration point for auto-allow | 2 | P1 | 2d | L1 |
| S8 | AST-based shell parsing | 2 | P1 | 5d | S2 |

### S1: 23-Check Security Pipeline -- 2 reference projects

**Pattern**: Claude Code runs a 23-check Bash security pipeline at `bashSecurity.ts:77-101` with individual validators: `OBFUSCATED_FLAGS`, `SHELL_METACHARACTERS`, `DANGEROUS_VARIABLES`, `COMMAND_SUBSTITUTION`, `IFS_INJECTION`, `BACKSLASH_ESCAPED_OPERATORS`, `MID_WORD_HASH`, `CARRIAGE_RETURN`, `BRACE_EXPANSION`, `ZSH_DANGEROUS_COMMANDS`, etc. Each validator gets `ValidationContext` with `originalCommand`, `unquotedContent`, `fullyUnquotedContent`, optional `treeSitter` analysis. Goose has `SecurityInspector` at `security/mod.rs:53-241` with pattern-based prompt injection detection.

**Current gap**: `edge-server/internal/adapters/security_hooks.go:147-182` -- single `dangerousPatternsRE` regex covering only 7 categories (rm -rf, curl|bash, sudo, chmod 777, block device writes, cp/mv/tee to dev). No per-validator context, no shell-unquoting, no ASCII/Unicode awareness.

**Best solution**: Refactor `security_hooks.go` into individual validator functions, each receiving `ShellContext` struct with `unquotedContent`, `fullyUnquotedContent`, `baseCommand`. Port Claude Code's 23 validators. Critical P0 subset: validators 4 (OBFUSCATED_FLAGS), 8 (COMMAND_SUBSTITUTION), 15 (CARRIAGE_RETURN), 16 (BRACE_EXPANSION), 21 (BACKSLASH_ESCAPED_OPERATORS) -- all known HackerOne attack vectors.

### S2: Shell Unquoting Before Security Checks -- 2 reference projects

**Pattern**: Claude Code extracts `unquotedContent` + `fullyUnquotedContent` + `unquotedKeepQuoteChars` views at `bashSecurity.ts:128-174`. Matches `fullyUnquotedContent` against security patterns. Goose's `ThinkFilter` at `base.rs:40-149` uses zero-copy streaming with cross-chunk tag parsing and nested depth tracking.

**Current gap**: `edge-server/internal/adapters/security_hooks.go:123-128` -- `containsDangerousPattern()` matches regex directly against raw command string. An attacker can hide blocked patterns inside quotes.

**Best solution**: Add `extractShellQuotes(command string) ShellContext` to `security_hooks.go`. Use `ShellContext.FullyUnquotedContent` as primary match target. This is surgical -- the regex stays, the target changes.

### S3: Path Validation for Path-Aware Commands -- 2 reference projects

**Pattern**: Claude Code validates paths for 32 commands at `pathValidation.ts:27-66`, from `cd` to `md5sum`. Each has `PATH_EXTRACTORS` that correctly parse flags vs. positional path arguments. Uses `filterOutFlags()` respecting `--` POSIX end-of-options. `checkDangerousRemovalPaths()` catches `rm -rf /`.

**Current gap**: AgentHub has no path-level validation. `security_hooks.go` checks command patterns only, not where files are being read/written.

**Best solution**: Create `edge-server/internal/security/path_validation.go` with `PathCommand` type enumerating 20+ commands, `ExtractPaths(command, cmdType) []string` using flag-aware parsing, `ValidatePaths(paths, cwd, allowedDirs) PermissionResult`. Wire into `SecurityHook.PreToolUse`.

---

## 4. `edge-server/internal/events/` -- WebSocket, Event Bus

### Priority Summary

| # | Pattern | Ref Count | P | Effort | Depends On |
|---|---------|-----------|----|--------|------------|
| E1 | Topic-based subscription (scope filtering) | 2 | P1 | 2d | -- |
| E2 | Snapshot signature dedup | 2 | P1 | 2d | -- |
| E3 | 16ms debounce batcher | 2 | P2 | 2d | -- |
| E4 | BusEvent state-machine enum (typed events) | 2 | P1 | 2d | -- |
| E5 | Event replay cursor + history persistence | 3 | P1 | 3d | Store section (ST3) |

### E1: Topic-Based Subscription -- 2 reference projects

**Pattern**: Kanna defines 8 `SubscriptionTopic` types at `protocol.ts:44-52`: `sidebar`, `local-projects`, `update`, `keybindings`, `app-settings`, `chat`, `project-git`, `terminal`. Each subscriber declares topics at subscribe time, and `pushSnapshots()` routes only matching topics at `ws-router.ts:586-617`. Multica routes events by `workspace_id` for tenant isolation at `protocol/ EventTaskQueued`.

**Current gap**: `edge-server/internal/events/bus.go:49-85` -- `Bus.Publish()` fans out to ALL subscribers with no topic filtering. WebSocket clients receive every event and filter client-side.

**Best solution**: Add `Topic string` field to `EventEnvelope`. Add `topic` on subscriber in `Subscribe()`. In `Publish()`, route only to subscribers whose topic matches envelope topic.

### E2: Snapshot Signature Dedup -- 2 reference projects

**Pattern**: Kanna's `pushSnapshots()` at `ws-router.ts:789-801` maintains `snapshotSignatures` Map per subscription. Before pushing, compares JSON signature -- if unchanged, skip push. This prevents unnecessary re-renders from repeated identical state broadcasts.

**Current gap**: `edge-server/internal/api/handlers.go:488-505` -- WebSocket loop unconditionally pushes every `EventEnvelope`, regardless of whether client already has identical state.

**Best solution**: Add signature cache per WebSocket connection at the Bus or handler layer: `connState { signatures map[string]string }`. Compare `JSON.Marshal(envelope.Scope+payload)` hash before sending.

---

## 5. `edge-server/internal/store/` -- Persistence, EventStore

### Priority Summary

| # | Pattern | Ref Count | P | Effort | Depends On |
|---|---------|-----------|----|--------|------------|
| ST1 | EventStore with cursor-based replay | 3 | P0 | 5d | -- |
| ST2 | Checkpoint system with content-addressable storage | 2 | P1 | 6d | ST1 |
| ST3 | Session resume (session pinning + crash recovery) | 4 | P0 | 3d | ST1 |
| ST4 | FailureReason enum + auto-retry | 3 | P1 | 2d | -- |
| ST5 | Thread/timeline branching model | 2 | P2 | 3d | -- |

### ST1: EventStore with Cursor-Based Replay -- 3 reference projects

**Pattern**: Claude Code persists sessions as JSONL files at `sessionStorage.ts` with `loadConversationForResume()`. Multica stores tasks with `session_id` and `work_dir` pinned for crash-resume at `task_lifecycle.go:67-96`. Goose uses SQLite + LRU memory cache for `SessionManager` at `session_manager.rs`. All three enable full conversation reconstruction after restart.

**Current gap**: AgentHub's `events/bus.go` has an in-memory ring buffer with max 10K events and `file_store.go` based JSONL storage, but events are ephemeral -- cleared on restart. `store.Item` has no `EventStore` backing. Messages cannot be replayed after server restart.

**Best solution**: Implement `EventStore` interface backed by SQLite or JSONL. Store events with `(runID, seq, eventType, payload)`. On WebSocket reconnect with cursor, replay events from cursor position. Enables session resume, crash recovery, and conversation replay.

### ST2: Checkpoint System with Content-Addressable Storage -- 2 reference projects

**Pattern**: OpCode's `CheckpointManager` at `manager.rs:188-302` creates file-level snapshots per turn: recursively scans project files, SHA-256 hashes content, stores zstd-compressed content in `content_pool/{sha256_hash}`, stores references in `refs/{checkpoint_id}/{filename}.json`. Supports `restore` and `fork` from any checkpoint. Multica has `ForceFreshSession` for reruns with clean state at `task.go:84-95`.

**Current gap**: AgentHub has no checkpoint/rollback system. No file snapshotting, no version tree, no restore capability.

**Best solution**: Create `edge-server/internal/checkpoint/` package with `CheckpointManager`, content-addressable storage via SHA-256 + zstd, `FileSnapshot` model, `Timeline` tree structure. Wire into `ProcessExecutor` to create checkpoints per turn.

---

## 6. `app/desktop/src/components/` -- ChatView, ThreadPanel, DiffViewer, PromptInput

### Priority Summary

| # | Pattern | Ref Count | P | Effort | Depends On |
|---|---------|-----------|----|--------|------------|
| C1 | Uncontrolled input with DOM refs | 2 | P0 | 0.5d | -- |
| C2 | Input draft persistence (crash recovery) | 3 | P0 | 0.5d | -- |
| C3 | Rich mention/autocomplete (@files, /commands) | 2 | P0 | 4d | -- |
| C4 | Execution mode selector (Plan/Build/Yolo) | 2 | P0 | 2d | -- |
| C5 | View registry with guard system | 2 | P1 | 3d | -- |
| C6 | Command palette (cmdk) | 2 | P1 | 3d | -- |
| C7 | Per-agent message grouping (agentId on messages) | 3 | P1 | 2d | -- |
| C8 | AgentRunsPanel (multi-agent view) | 2 | P1 | 3d | C7 |
| C9 | ForkDialog component | 2 | P2 | 2d | -- |
| C10 | Toast feedback for background operations | 2 | P1 | 1d | -- |
| C11 | Reconnect overlay | 2 | P2 | 1d | -- |
| C12 | Hierarchical thread sidebar (project groups + status) | 2 | P2 | 3d | -- |

### C1: Uncontrolled Input with DOM Refs -- 2 reference projects

**Pattern**: Jean's `ChatInput.tsx:104` uses `valueRef` + direct DOM manipulation -- avoids React re-renders on every keystroke. Only triggers `setState` at the empty/non-empty boundary for hint toggle. Roo-Code similarly keeps streaming components always mounted to prevent unmount/remount during streaming.

**Current gap**: `app/desktop/src/components/PromptInput.tsx` uses controlled `useState(prompt)` -- every keystroke triggers a full component re-render including agent selector, model/reasoning selects, and send button.

**Best solution**: Replace `useState(prompt)` with `useRef` + direct DOM writes. Keep boundary state updates only. Sync to store via debounced write.

### C2: Input Draft Persistence -- 3 reference projects

**Pattern**: Jean persists input value to `chatStore.inputDrafts[sessionId]` with 1-second debounce, restores on session switch at `ChatInput.tsx:106-184`. Multica uses optimistic mutations: apply locally, rollback on error, invalidate on settle. OpCode keeps session state in localStorage with 30-day expiry.

**Current gap**: AgentHub's `prompt` is component-local state, lost on every unmount, page refresh, or crash.

**Best solution**: Add `inputDrafts: Record<string, string>` to `threadStore.ts` or a new `draftStore.ts`. Debounce saves on each keystroke (1s). Restore on thread change. Clear draft on successful send.

### C3: Rich Mention/Autocomplete System -- 2 reference projects

**Pattern**: Jean detects three inline triggers at `ChatInput.tsx:316-475`: `@` for file mentions, `#` for context (issues/PRs), `/` for slash commands. Each triggers a positioned popover with keyboard navigation, fuzzy search, and scope switching. LobeHub has a `ToolManifestMap` + `toolSourceMap` for tool routing at `state.ts:127-134`.

**Current gap**: `PromptInput.tsx` has no mention/autocomplete system. Agent selection is a separate dropdown button.

**Best solution**: Add `FileMentionPopover` triggered by `@`, `SlashCommandPopover` triggered by `/`. Reuse existing popover positioning pattern from agent selector. Add keyboard navigation (ArrowUp/Down, Enter/Tab, Escape).

### C4: Execution Mode Selector -- 2 reference projects

**Pattern**: Jean has three execution modes at `ChatToolbar.tsx:390-398`: Plan (agent creates plan, waits approval), Build (agent executes with permission gates), Yolo (agent runs with no approval). Each has different placeholder text, permission behavior, and model/effort overrides. LobeHub has `costLimit.onExceeded` with 3 policies (stop/interrupt/continue) at `runtime.ts:800-860`.

**Current gap**: No execution mode concept in AgentHub. PermissionDialog exists but no mode skips permissions entirely.

**Best solution**: Add `executionMode: 'plan' | 'build' | 'yolo'` to run state. Wire mode to PermissionDialog behavior (yolo = auto-allow all). Add mode selector to PromptInput config row.

---

## 7. `app/desktop/src/stores/` -- Zustand State Management

### Priority Summary

| # | Pattern | Ref Count | P | Effort | Depends On |
|---|---------|-----------|----|--------|------------|
| STO1 | TanStack Query for server state + Zustand for client state | 3 | P0 | 4d | -- |
| STO2 | getState() in callbacks (avoid render cascades) | 2 | P1 | 1d | -- |
| STO3 | Optimistic mutations with rollback | 2 | P1 | 2d | STO1 |
| STO4 | Zod schemas + parseWithFallback for API responses | 2 | P0 | 2d | -- |
| STO5 | WS events invalidate queries (never write to stores directly) | 3 | P0 | 2d | STO1 |
| STO6 | Store mutation guards (no-op if unchanged) | 2 | P1 | 0.5d | -- |

### STO1: TanStack Query + Zustand Split -- 3 reference projects

**Pattern**: Multica's CLAUDE.md mandates: TanStack Query owns ALL server state; Zustand is client state only (UI selections, drafts, modal state); never duplicate server data into Zustand. Jean layers: `useState` (component-local), `Zustand` (global UI), `TanStack Query` (server/persistent data). LobeHub has domain-specific stores with `action.ts` (mutations) and `selectors.ts` (derived state), using `subscribeWithSelector` middleware.

**Current gap**: AgentHub uses Zustand for everything -- `runStore`, `threadStore`, `connectionStore`, `searchStore`, `uiStore`. `runStore` holds both server data (outputText, toolCalls, changedFiles) and client state (isStreaming) -- mixed concern. No TanStack Query. 10-second polling loops instead of `refetchInterval`.

**Best solution**: Add `@tanstack/react-query`. Move thread list, agent list, run history to Query cache. Keep Zustand for UI state only (sidebar widths, theme, drafts). Replace `setInterval` polling loops with `refetchInterval` in query options.

### STO4: Zod Schemas for API Responses -- 2 reference projects

**Pattern**: Multica uses `parseWithFallback` with Zod for all API responses at `schema.ts`. LobeHub has `ZodSchema` for all agent runtime types, including `AgentInstruction`, `AgentEvent`, `ToolPayload`.

**Current gap**: `app/desktop/src/api/edgeClient.ts` uses raw `fetch` + type assertion. Server schema drift causes white-screen crashes.

**Best solution**: Add Zod schemas for all API responses (`ThreadInfo`, `RunInfo`, `AgentInfo`, `ChatMessage`, etc.). Wrap `fetch` responses with `parseWithFallback` to degrade gracefully on schema mismatch.

### STO5: WS Events Invalidate Queries -- 3 reference projects

**Pattern**: Multica's CLAUDE.md: "WS events invalidate queries -- they never write to stores directly." Mutations are optimistic: apply locally, rollback on error, invalidate on settle. Jean uses WS events to trigger cache revalidation via `onReconnectCallbacks`.

**Current gap**: `useChatMessages.ts` writes streaming output directly to `runStore.appendOutput`. Event-to-store direct write couples transport to state.

**Best solution**: Introduce QueryClient invalidation for run data. Keep only transient streaming text in a lightweight buffer. On reconnect, invalidate all active queries to refresh from server state.

---

## 8. `app/desktop/src/hooks/` -- Custom React Hooks

### Priority Summary

| # | Pattern | Ref Count | P | Effort | Depends On |
|---|---------|-----------|----|--------|------------|
| H1 | Typed WSClient class with event registry | 3 | P1 | 3d | -- |
| H2 | Reconnect callback pattern for cache invalidation | 2 | P1 | 1d | H1 |
| H3 | Transport-agnostic client abstraction | 2 | P2 | 2d | H1 |
| H4 | SSE client hook (alternative to WebSocket) | 2 | P2 | 2d | -- |
| H5 | Per-agent streaming tracking (Set<string> not boolean) | 2 | P1 | 1d | -- |

### H1: Typed WSClient Class with Event Registry -- 3 reference projects

**Pattern**: Multica's `WSClient` at `ws-client.ts:27-200` has typed event handlers (`handlers: Map<WSEventType, Set<EventHandler>>`), auth token sent as first WebSocket message, 3s exponential backoff reconnect, `onReconnectCallbacks` for cache invalidation, `anyHandlers` for catch-all, and graceful disconnect that removes `onclose` before `ws.close()` to prevent reconnect race. Kanna's `KannaSocket` at `socket.ts:37-404` has auto-reconnect (750ms-5s), 15s ping heartbeat, visibility-change pause/resume, offline message queuing.

**Current gap**: `app/desktop/src/hooks/useChatMessages.ts` manages WebSocket lifecycle inline with a switch/if chain. No typed event handler registry, no reconnect callback, no heartbeat, no graceful disconnect protocol.

**Best solution**: Extract `EdgeWSClient` class to `app/desktop/src/api/socket.ts` matching Multica's `WSClient` pattern: typed handler map, auth-first-message, reconnect callbacks, heartbeat. Adapt Kanna's visibility-change pause/resume for the Tauri desktop environment.

### H2: Reconnect Callback Pattern -- 2 reference projects

**Pattern**: Multica's `WSClient` at `ws-client.ts:126-137` has `onReconnectCallbacks` array that fires after reconnection to trigger cache invalidation. Kanna's `KannaSocket` fires reset and replay callbacks on reconnect success.

**Current gap**: AgentHub has no mechanism to invalidate caches on reconnect. Stale data persists after WebSocket reconnection.

**Best solution**: Add `onReconnect` callback registry to `EdgeWSClient`. On reconnect, fire all callbacks to invalidate TanStack Query caches and refresh UI state.

---

## 9. `hub-server/internal/` -- Hub Server

### Priority Summary

| # | Pattern | Ref Count | P | Effort | Depends On |
|---|---------|-----------|----|--------|------------|
| HU1 | Dual-auth JWT middleware (OIDC + session) | 2 | P1 | 2d | -- |
| HU2 | SSE streaming endpoint with history replay | 2 | P2 | 3d | -- |
| HU3 | SSE event subscriber with Redis backend | 2 | P2 | 3d | -- |

### HU1: Dual-Auth JWT Middleware -- 2 reference projects

**Pattern**: LobeHub's `checkAuth()` at `auth/index.ts:61-181` handles OIDC JWT (CLI/API clients) + Better Auth session (web clients) + dev mock mode. Inject `serverDB`, `jwtPayload`, `userId` into handler context. LibreChat similarly uses session-based auth with API key fallback. Both support configurable skip paths.

**Current gap**: `hub-server/internal/auth/middleware.go:68-127` -- basic JWT Bearer validation with skip paths, HMAC signing validation, context injection. Single auth mode only.

**Best solution**: Extend to support dual auth modes (session for web, API key / JWT for CLI), configurable dev mock user, typed error responses matching `ChatErrorType` pattern from LobeHub.

---

## Implementation Sequencing

### Phase 1: Foundation (P0, ~8 weeks)

Week 1-2: **Security Core**
  - S2: Shell unquoting before security checks (1d)
  - S1: 23-check security pipeline P0 subset (8d)
  - A1: Permission rule engine + SecuredPermissionHandler (6d)

Week 3-4: **Agent Lifecycle + Persistence**
  - ST1: EventStore with SQLite backing (5d)
  - A2: Agent state machine (5d)
  - ST3: Session resume + crash recovery (3d)
  - A5: ContextManager with token tracking (5d)

Week 5-6: **Sub-Agent Infrastructure**
  - A3: Sub-agent spawn handler + agent registry (5d)
  - A6: Inter-agent message queue (mailbox) (3d)
  - A4: Phase-driven agent loop (8d)

Week 7-8: **Frontend State Architecture**
  - STO1: TanStack Query + Zustand split (4d)
  - STO4: Zod schemas for API responses (2d)
  - STO5: WS events invalidate queries (2d)
  - H1: Typed WSClient class (3d)

### Phase 2: Core UX (P1, ~4 weeks)

Week 9-10: **Desktop Components**
  - C1: Uncontrolled input (0.5d)
  - C2: Input draft persistence (0.5d)
  - C3: Rich mention/autocomplete (4d)
  - C4: Execution mode selector (2d)

Week 11-12: **Lifecycle + Events**
  - L1: WorkspaceProvider interface (4d)
  - L2: Health check + startup grace period (2d)
  - L3: ProcessWorkspaceProvider upgrade (5d)
  - E1: Topic-based subscription (2d)

### Phase 3: Polish (P2, ~4 weeks)

Week 13-16: **P2 items by priority**
  - C5: View registry (3d)
  - C6: Command palette (3d)
  - ST2: Checkpoint system (6d)
  - C7: Per-agent message grouping (2d)
  - L8: DockerWorkspaceProvider (7d)

---

## Cross-Cutting Architecture Decisions

### Decision 1: CLI Wrapper vs Native Agent Runtime

AgentHub is a CLI wrapper (ProcessExecutor spawns claude/codex/opencode as subprocesses). LibreChat, Goose, and LobeHub are native agent runtimes (execute LLM calls directly in-process). This is an architectural choice, not a gap:

- **Keep**: CLI wrapper gives provider-agnostic multi-adapter support (AgentHub's core differentiator)
- **Extend**: Add in-process capabilities (ModelProtocol for direct API, ToolDefinition for custom tools) alongside CLI mode

### Decision 2: Permission Double-Gate

AgentHub's current architecture has two separate code paths: `SecurityHook.PreToolUse` (parser-level blocking) and `DefaultPermissionHandler` (control protocol auto-approval). The fix is to **unify** them:

```
SecurityHook (deny-gate) → PermissionEngine (rule match) → PermissionHandler (UI prompt/auto-allow)
```

This matches Claude Code's pipeline: deny rules → ask rules → tool-specific check → safety check → bypass → allow rules.

### Decision 3: Event Bus vs Direct Store Writes

All 3 reference projects (Multica, Jean, Kanna) follow the pattern: **WS events invalidate caches, never write to stores directly.** AgentHub currently inverts this: events write directly to Zustand stores. This must be reversed to prevent race conditions and stale data.

### Decision 4: AgentHub Advantages to Preserve

These capabilities are already ahead of reference projects and should be maintained:

1. **SecurityHook self-test**: 17 dangerous + 5 safe test cases at `security_hooks.go:187-224` -- unique among all projects
2. **EventEnvelope richness**: `seq`, `scope`, `traceId`, `version` -- more complete than OpenHands' `BaseEvent`
3. **Multi-CLI adapter registry**: `registry.go` thread-safe with role-based defaults -- more structured than any reference
4. **Control protocol separation**: stdin/stdout control channel separate from WebSocket data channel -- cleaner than OpenHands' mixed WebSocket
5. **SanitizedEnv with secret detection**: 200+ key whitelist + 90+ secret pattern detection -- more secure than OpenHands' bare env
6. **Tree connector visuals**: MessageTree with indent lines + connector graphics -- more advanced than LibreChat's flat rendering
7. **AgentList component**: dedicated agent sidebar with capability tags and online status -- no equivalent in Kanna or Jean

---

## Reference Project File Index

### Codex CLI
- `protocol/src/agent_path.rs:15-72` -- AgentPath tree addressing
- `core/src/agent/control.rs:153-358` -- AgentControl spawn & lifecycle
- `core/src/agent/registry.rs:22-329` -- AgentRegistry concurrency & limits
- `core/src/tools/handlers/multi_agents_v2/spawn.rs:45-234` -- handle_spawn_agent
- `core/src/context_manager/history.rs:34-568` -- ContextManager & token tracking
- `core/src/compact.rs:46-530` -- Compaction engine
- `core/src/session/input_queue.rs:25-88` -- InputQueue mailbox
- `protocol/src/protocol.rs:663-711` -- InterAgentCommunication protocol

### LibreChat
- `packages/data-provider/src/messages.ts:5-50` -- buildTree algorithm
- `client/src/components/Chat/Messages/SiblingSwitch.tsx:7-68` -- branch navigation
- `client/src/components/Chat/Messages/Fork.tsx:202-446` -- fork UI
- `api/server/utils/import/fork.js:85-353` -- fork backend (4 modes)
- `packages/api/src/agents/run.ts:465-959` -- subagent dispatch + summarization
- `client/src/hooks/Messages/useBuildMessageTree.ts:15-77` -- 4 tree modes
- `client/src/store/families.ts:347-350` -- Recoil atomFamily per-message siblingIdx

### Kanna
- `src/server/agent.ts:57-74,674-1401` -- AgentCoordinator + ActiveTurn + drainingStreams
- `src/server/ws-router.ts:773-934` -- snapshot signature dedup + 16ms debounce
- `src/client/app/socket.ts:37-404` -- KannaSocket with reconnect
- `src/client/app/useKannaState.ts:726-2095` -- centralized state hook
- `src/shared/protocol.ts:44-52` -- SubscriptionTopic types

### OpenHands
- `app_server/sandbox/sandbox_service.py:29-232` -- SandboxService ABC
- `app_server/sandbox/docker_sandbox_service.py:82-553` -- DockerSandboxService
- `app_server/sandbox/process_sandbox_service.py:67-461` -- ProcessSandboxService
- `app_server/sandbox/sandbox_models.py:9-30` -- SandboxStatus, ExposedUrl

### Claude Code
- `tools/BashTool/bashSecurity.ts:77-174` -- 23-check pipeline + shell unquoting
- `tools/BashTool/bashPermissions.ts:524-2557` -- permission pipeline + wrapper stripping
- `tools/BashTool/pathValidation.ts:27-1109` -- path validation for 32 commands
- `services/compact/autoCompact.ts:72-530` -- context compaction engine
- `cli/structuredIO.ts:348-859` -- control protocol + hook callbacks
- `utils/hooks/hooksConfigManager.ts:270-392` -- hook grouping

### Multica
- `server/internal/service/task.go:80-918` -- task lifecycle + auto-retry
- `server/internal/handler/task_lifecycle.go:24-154` -- orphan recovery + pin + rerun
- `packages/core/api/ws-client.ts:27-200` -- WSClient class

### LobeHub
- `packages/agent-runtime/src/agents/GeneralChatAgent.ts:125-792` -- phase-driven loop + intervention pipeline
- `packages/agent-runtime/src/types/state.ts:20-147` -- AgentState + cost limits
- `packages/agent-runtime/src/types/instruction.ts:369-388` -- AgentInstruction union
- `packages/agent-runtime/src/core/runtime.ts:38-860` -- executor registry + cost enforcement

### Jean (Command Center)
- `src/components/chat/ChatInput.tsx:104-475` -- uncontrolled input + mention system
- `src/components/chat/ChatToolbar.tsx:390-398` -- execution mode selector
- `CLAUDE.md` -- state management onion + getState() pattern

### OpCode
- `src-tauri/src/checkpoint/manager.rs:188-680` -- checkpoint engine
- `src-tauri/src/checkpoint/storage.rs:13-459` -- content-addressable storage
- `src-tauri/src/checkpoint/mod.rs:13-171` -- checkpoint data models

### Goose
- `crates/goose/src/providers/base.rs:802-1272` -- ProviderDef/Provider traits
- `crates/goose/src/tool_inspection.rs:34-250` -- ToolInspector chain
- `crates/goose/src/agents/extension_manager.rs:827-1099` -- MCP transport + tool cache
- `crates/goose/src/session/session_manager.rs` -- SQLite session persistence
- `crates/goose/src/context_mgmt/mod.rs` -- auto-compaction

### Roo-Code
- `apps/cli/src/agent/agent-state.ts:48-463` -- AgentLoopState state machine
- `apps/cli/src/agent/message-processor.ts:75-120` -- layered processor architecture
- `apps/cli/src/agent/state-store.ts:106-384` -- observable state pattern

### cline
- `src/core/task/TaskState.ts:6-83` -- 20-dimensional task state
- `src/core/task/loop-detection.ts:21-68` -- tool call loop detection
