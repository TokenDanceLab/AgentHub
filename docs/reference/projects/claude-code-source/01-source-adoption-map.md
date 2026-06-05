# Claude Code Source Adoption Map — AgentHub ClaudeCodeAdapter

> Generated 2026-05-24 from `reference/claude-code-source/claude-code-main/`

This documents every finding from the real Claude Code TypeScript source compared against AgentHub's Go implementation. Each entry maps a Claude Code source behavior to the corresponding (or missing) AgentHub code with a priority.

---

## 1. NDJSON Streaming Protocol

Claude Code uses `--output-format stream-json` which produces NDJSON (one JSON line per event). The protocol is defined and consumed bidirectionally.

### 1.1 Message Types (stdout stream)

| Stream Message `type` | Subtype / Key | Claude Code Source | AgentHub Handler | Priority |
|---|---|---|---|---|
| `system` | `init` | `structuredIO.ts:447` — parsed by `processLine()` | `parser_ndjson.go:97-101` `emitSessionInit()` | **P0** — bare minimum; only maps `model`, `tools`, `mcpServers`, `permissionMode`, `version` |
| `system` | `compact_boundary` | `print.ts` — emitted at context compaction | `parser_ndjson.go:102` `emitCompactBoundary()` | P1 — present, no gap |
| `system` | `status` | CLI emits permission mode & status changes | `parser_ndjson.go:103-104` `emitStatusChange()` | P1 — present |
| `system` | `api_retry` | `print.ts` — API retry info | `parser_ndjson.go:105-106` `emitAPIRetry()` | P1 — present |
| `system` | `task_started` | Sub-agent spawn notification | `parser_ndjson.go:107-108` `emitTaskStarted()` | P1 — present |
| `system` | `task_dispatched` | Sub-agent dispatch | `parser_ndjson.go:109-110` `emitTaskDispatched()` | P1 — present |
| `system` | `task_progress` | Sub-agent progress | `parser_ndjson.go:111-112` `emitTaskProgress()` | P1 — present |
| `system` | `task_notification` | Task completion/status | `parser_ndjson.go:113-126` `emitTaskNotification()` | P1 — present |
| `system` | `session_state_changed` | Running / requires_action states | `parser_ndjson.go:127-128` `emitSessionStateChanged()` | **P0** — maps only `state` field, missing `requires_action_details` for tool prompts |
| `system` | `hook_started` | Hook execution lifecycle | `parser_ndjson.go:129-130` `emitHookStarted()` | P1 — present |
| `system` | `hook_progress` | Hook stdout/stderr output | `parser_ndjson.go:131-132` `emitHookProgress()` | P1 — present |
| `system` | `hook_response` | Hook exit + outcome | `parser_ndjson.go:133-134` `emitHookResponse()` | P1 — present |
| `system` | `files_persisted` | File persistence notification | `parser_ndjson.go:135-136` — logged, not emitted | P2 — logged, fine |
| `assistant` | `message.content[]` | Text blocks, tool_use blocks, thinking blocks | `parser_ndjson.go:141-142` → `parseAssistantMessage()` | **P0** — handles text/text, tool_use, thinking; does **not** parse `redacted_thinking`, `server_tool_use` (MCP), or `search_result` blocks |
| `stream_event` | content block deltas | `structuredIO.ts:447` — streaming token-level deltas during generation | `parser_ndjson.go:144-145` → `parseStreamEvent()` | **P0** — handles `content_block_delta` (text_delta, thinking_delta) and `content_block_start` (tool_use). **Missing** `input_json_delta` for tool arg streaming |
| `user` | `message.content[]` | Tool results from the agent | `parser_ndjson.go:147-148` → `emitToolResult()` | **P0** — present; emits file_change for Write/Edit/NotebookEdit |
| `result` | Final result + usage | `print.ts:4847` — emitted at end of generation | `parser_ndjson.go:150-151` → `parseResult()` | **P0** — present, captures success/error, duration, turns, usage tokens |
| `tool_progress` | Tool execution progress | Per-tool progress stream | `parser_ndjson.go:153-159` | P1 — present |
| `tool_use_summary` | Compact UI summaries for collapsed tools | `parser_ndjson.go:161-166` | P2 — present |
| `auth_status` | OAuth authentication flow status | `parser_ndjson.go:168-172` | P2 — present |
| `rate_limit_event` | API rate limit information | `parser_ndjson.go:174-181` | P2 — present |
| `keep_alive` | Heartbeat, silently ignored | `structuredIO.ts:343-345` — silently dropped | **Not handled** | P2 — likely fine (scanner skips non-JSON), but no explicit handling |
| `update_environment_variables` | Auth token refresh via stdin | `structuredIO.ts:348-361` — merges into `process.env` | **Not handled** | **P0** — in bridge/remote sessions, tokens expire and must be refreshed; without this, sessions die after token expiry |

### 1.2 NDJSON Line Safety

**Claude Code:** `ndjsonSafeStringify.ts` — escapes U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR as `\\u2028`/`\\u2029` to prevent NDJSON line-splitting receivers from breaking JSON mid-string.

**AgentHub:** `parser_ndjson.go:57` — `bufio.Scanner` with 10MB max buffer, skips empty lines. No U+2028/U+2029 handling.

**Gap:** P2 — U+2028/U+2029 in tool output could break the scanner's newline-based splitting. Very rare in practice (these chars appear in some CJK text and JSON embedded in comments).

### 1.3 Control Protocol (stdin/stdout bidirectional)

Claude Code uses a `control_request`/`control_response` protocol over stdin/stdout for tool permissions, interrupts, model switching, and MCP.

| Control Subtype | Direction | Claude Code Source | AgentHub Handler | Priority |
|---|---|---|---|---|
| `can_use_tool` | out→←in | `structuredIO.ts:536-658` — full permission pipeline | `control_protocol.go:84-144` `handleCanUseTool()` | **P0** — AgentHub **auto-approves all tools** (`behavior: "allow"`). This is the `DefaultPermissionHandler` — bypassPermissions mode. No user-prompting path. |
| `hook_callback` | out→←in | `structuredIO.ts:661-689` — SDK hook callbacks | **Not implemented** | **P0** — SDK-powered hooks cannot run without this |
| `elicitation` | out→←in | `structuredIO.ts:694-721` — MCP elicitation requests | **Not implemented** | P1 — needed for MCP servers that use elicitation (OAuth, forms) |
| `mcp_message` | out→←in | `structuredIO.ts:758-773` — MCP message relay | **Not implemented** | P1 — needed for MCP integration in SDK mode |
| `interrupt` | →in | `control_protocol.go:153-168` `WriteInterrupt()` | Implemented | P1 — via ProcessExecutor.Cancel() |
| `set_model` | →in | `control_protocol.go:170-185` `WriteSetModel()` | Implemented | P2 |
| `set_permission_mode` | →in | `control_protocol.go:187-202` `WriteSetPermissionMode()` | Implemented | P2 |
| `stop_task` | →in | `control_protocol.go:204-219` `WriteStopTask()` | Implemented | P2 |
| `control_cancel_request` | out | `structuredIO.ts:490-495` — abort pending request | `parser_ndjson.go:94` — silently ignored | P1 — fine for now; cancels are internal to control protocol |

### 1.4 Event Bus — AgentHub vs Claude Code

Claude Code emits typed messages to stdout; AgentHub translates them to a bus with subscribers.

| Claude Code Output | AgentHub Bus Event | Mapping Quality |
|---|---|---|
| `content_block_delta` with `text_delta` | `run.agent.text_delta` | Good — content string |
| `content_block_delta` with `thinking_delta` | `run.agent.thinking` | Good — content string |
| `assistant` message with `text` block | `run.agent.text_block` | Good |
| `assistant` message with `tool_use` block | `run.agent.tool_call` (status: pending) | Good |
| `content_block_start` with `tool_use` | `run.agent.tool_call` (status: started) | Good |
| `user` message with `tool_result` | `run.agent.tool_result` + `run.agent.file_change` | Good |
| `system` `init` | `run.agent.session_init` | Good |
| `result` | `run.agent.result` | Good |
| `system` `session_state_changed` | `run.agent.session_state_changed` | **Incomplete** — only maps `state` string, not `requires_action` details |
| `system` `task_*` | `run.agent.task_*` | Good |
| `system` `hook_*` | `run.agent.hook_*` | Good |
| (no Claude Code equivalent) | `run.agent.permission_requested` | AgentHub invention — emitted by `control_protocol.go` when `can_use_tool` arrives |
| (no Claude Code equivalent) | `run.agent.permission_decided` | AgentHub invention — emitted after auto-approval |

---

## 2. Tool Security & Permission System

### 2.1 Claude Code Permission Pipeline

Claude Code's permission system is a multi-step pipeline (`permissions.ts:1158-1319`):

```
Step 1a: Check deny rules → deny
Step 1b: Check ask rules → ask
Step 1c: Tool-specific checkPermissions() → passthrough/deny/ask
Step 1d: Tool denied → deny
Step 1e: Tool requires user interaction → ask
Step 1f: Content-specific ask rules → ask
Step 1g: Safety check (bypass-immune) → ask
Step 2a: bypassPermissions mode → allow
Step 2b: Always-allow rule → allow
Step 3:  Convert passthrough → ask
```

Post-pipeline (in `hasPermissionsToUseTool`):
- **dontAsk mode**: converts `ask` → `deny`
- **Auto mode** (TRANSCRIPT_CLASSIFIER): acceptEdits fast-path → allowlist check → classifier API call → allow/deny
- **Headless agents** (`shouldAvoidPermissionPrompts`): run PermissionRequest hooks → auto-deny if no hook decides
- **Denial tracking**: consecutive/total denials → threshold → fallback to prompting → abort for headless

### 2.2 AgentHub Permission System

AgentHub has two layers:

| Layer | File | Behavior |
|---|---|---|
| **SecurityHook (pre-exec)** | `security_hooks.go` | Blocks dangerous patterns (rm -rf /, curl\|bash, sudo bash, chmod 777, >/dev/sd*) |
| **PermissionHandler (can_use_tool)** | `control_protocol.go` | Auto-approves ALL tools; emits permission_requested/permission_decided events for observation |

### 2.3 Gaps

| Gap | Claude Code Source | AgentHub Status | Priority |
|---|---|---|---|
| No deny/ask rules | `permissions.ts:1069-1156` `getDenyRules()`, `getAskRules()`, `getAllowRules()` | Not implemented | **P0** — every production adapter needs allow/deny rule management |
| No tool-specific permission check | `Tool.checkPermissions()` — per-tool logic (e.g., Bash subcommand rules) | Not implemented | **P0** — Bash without subcommand allowlisting is dangerous |
| No bypassPermissions mode | `permissions.ts:1262-1281` — mode-based skip | Auto-approve in handler is equivalent, but can't be toggled off | P1 — needs explicit mode control |
| No auto mode / classifier | `permissions.ts:520-927` — `TRANSCRIPT_CLASSIFIER` feature | Not implemented | P2 — auto mode is Claude Code-specific; lower priority |
| No PermissionRequest hooks | `structuredIO.ts:787-859` — hook-based allow/deny race | Not implemented | **P0** — this is how users customize tool authorization |
| No user-prompt path | `structuredIO.ts:536-658` — `sendRequest(can_use_tool)` → SDK consumer shows UI | Auto-approve only; Desktop can observe via events but cannot decide | **P0** — Desktop needs ability to prompt user and return decision |
| Security patterns incomplete | `security_hooks.go` — 7 pattern categories | Claude Code has 23-check pipeline (expandable via hooks) | P1 — current patterns cover main threats; hook-based extension is the real gap |
| No sandbox network access forwarding | `structuredIO.ts:731-753` `createSandboxAskCallback()` | Not implemented | P2 |

### 2.4 Claude Code Tool Inventory vs AgentHub

Claude Code registers **60+ tools** dynamically. AgentHub maps a subset via the NDJSON parser.

**Tools present in Claude Code but not individually tracked by AgentHub:**
- `SkillTool`, `TaskStopTool`, `WebSearchTool`, `WebFetchTool`, `NotebookEditTool`, `AskUserQuestionTool`, `EnterPlanModeTool`, `EnterWorktreeTool`, `ExitWorktreeTool`, `TaskCreateTool`, `TaskGetTool`, `TaskUpdateTool`, `TaskListTool`, `TaskOutputTool`, `LSPTool`, `SendMessageTool`
- Many are feature-flagged and not always available

**Impact:** Low — the NDJSON parser emits generic `tool_call`/`tool_result` events regardless. But for security validation, each tool needs its own `classifyRisk()` mapping.

---

## 3. Hook System

### 3.1 Claude Code Hooks (28 events)

Claude Code supports **28 hook events** (`coreTypes.ts:25-53`):

```
PreToolUse, PostToolUse, PostToolUseFailure, Notification,
UserPromptSubmit, SessionStart, SessionEnd, Stop, StopFailure,
SubagentStart, SubagentStop, PreCompact, PostCompact,
PermissionRequest, PermissionDenied, Setup,
TeammateIdle, TaskCreated, TaskCompleted,
Elicitation, ElicitationResult,
ConfigChange, WorktreeCreate, WorktreeRemove,
InstructionsLoaded, CwdChanged, FileChanged
```

Hook types: shell commands (`command`), LLM prompt hooks (`prompt`), HTTP callbacks (`http`), plugin hooks, skill hooks, session hooks, function hooks.

**Hook features:**
- `if` condition filtering (permission-rule syntax like `Bash(git *)`)
- `async` / `asyncRewake` modes (background execution)
- `timeout` per hook
- `once` (auto-remove after first execution)
- `statusMessage` (custom spinner text)
- `decision`: approve/block (for PreToolUse)
- `additionalContext`, `updatedInput` (context injection)
- `systemMessage` (warning shown to user)

### 3.2 AgentHub Hooks (6 core hooks)

AgentHub's hook system (`hooks.go`) defines 6 hooks:

```
PreToolUse  → classify risk, block dangerous patterns
PostToolUse → sanitize output
PermissionRequest → deny/allow/allow_once based on risk
OnError     → retry/abort/fallback
PrePrompt   → modify user prompt
PostResponse → modify complete response
```

### 3.3 Mapping & Gaps

| Claude Code Hook | AgentHub Equivalent | Status | Priority |
|---|---|---|---|
| `PreToolUse` | `PreToolUse` | Covered — risk classification + pattern blocking | ✅ |
| `PostToolUse` | `PostToolUse` | Covered — output sanitization | ✅ |
| `PermissionRequest` | `PermissionRequest` | Covered — risk-based decisions | ✅ |
| `PermissionDenied` | — | **Missing** | P1 — handle what happens after user denies |
| `UserPromptSubmit` | — | **Missing** | P1 — validate/modify prompts before sending |
| `SessionStart` | — | **Missing** | P1 — setup, initial context, watch paths |
| `SessionEnd` | — | **Missing** | P2 — cleanup, session storage |
| `Stop` / `StopFailure` | `OnError` (partial) | Partially covered | P1 — stop reason handling |
| `SubagentStart` / `SubagentStop` | — | **Missing** | P1 — sub-agent lifecycle hooks |
| `PreCompact` / `PostCompact` | — | **Missing** | P1 — context compaction hooks |
| `Notification` | — | **Missing** | P2 — system notification hooks |
| `Setup` | — | **Missing** | P2 — initial setup |
| `Elicitation` / `ElicitationResult` | — | **Missing** | P2 — MCP elicitation hooks |
| `ConfigChange` / `InstructionsLoaded` / `FileChanged` / `CwdChanged` | — | **Missing** | P2 — event-driven hooks |
| `TaskCreated` / `TaskCompleted` | — | **Missing** | P2 — task lifecycle hooks |
| `TeammateIdle` | — | **Missing** | P2 — teammate status hooks |
| `WorktreeCreate` / `WorktreeRemove` | — | **Missing** | P2 — worktree hooks |

**Critical gap:** AgentHub's hooks are **in-process Go code only** (middleware pattern). Claude Code hooks are **external processes** (shell commands, HTTP calls, LLM prompts). AgentHub cannot run user-defined shell scripts or HTTP callbacks as hooks. This is the primary hook gap.

---

## 4. Session Management & Persistence

### 4.1 Claude Code Session Model

| Aspect | Claude Code Source | Details |
|---|---|---|
| **Session ID** | `bootstrap/state.ts` `getSessionId()` | UUID-based; persisted in config dir |
| **Resume** | `--resume <sessionId>`, `--continue` | `cli/print.ts:4912-4977` — `loadConversationForResume()` |
| **Fork** | `--fork-session` | `cli/print.ts:5075-5176` — fork-specific resume logic |
| **Session storage** | `utils/sessionStorage.ts` | JSONL files in config dir; `getTranscriptPathForSession()` and `getAgentTranscriptPath()` |
| **Conversation recovery** | `utils/conversationRecovery.ts` | `loadConversationForResume()` + `TurnInterruptionState` |
| **Session directory** | Per-project, per-session JSONL files | Stored in `~/.claude/projects/<hash>/` |
| **Bridge sessions** | `bridge/sessionRunner.ts` | Remote CLI child processes with stderr capture, activity tracking |
| **Bridge session creation** | `bridge/createSession.ts` | POST /v1/sessions REST API for creating remote sessions |
| **History** | `history.ts` | Global `history.jsonl` in `~/.claude/`; per-project via `getProjectRoot()`; paste reference storage |

### 4.2 AgentHub Session Model

| Aspect | AgentHub Source | Details |
|---|---|---|
| **Event Bus** | `events/bus.go` | In-memory bus with monotonic seq, cursor-based replay, max 10K event history |
| **File Store** | `store/file_store.go` | JSONL-based; Run/Thread/Project CRUD |
| **Run Lifecycle** | `store/store.go` | `RunLifecycleStore` interface: GetRun, SetRunStatusIf |
| **Process Executor** | `lifecycle/process_executor.go` | Spawns CLI subprocess; handles cancel via stdin interrupt; env sanitization |

### 4.3 Gaps

| Gap | Claude Code Source | AgentHub Status | Priority |
|---|---|---|---|
| No session resume from disk | `sessionStorage.ts` — full JSONL session serialization | AgentHub passes `--resume <sessionId>` to CLI but doesn't persist session state itself | **P0** — session resume depends entirely on the CLI's internal storage; AgentHub can't reconstruct sessions |
| No conversation storage | `sessionStorage.ts` `getTranscriptPathForSession()` | AgentHub has `store.Run` but stores only metadata (status, timestamps), not conversation messages | **P0** — `EventStore` plan exists but not implemented; messages lost on restart |
| No multi-session support | `bridge/sessionRunner.ts` — manages multiple child processes | Single process per run; no session pool | P1 |
| No bridge/remote session API | `bridge/createSession.ts` `POST /v1/sessions` | Not implemented | P1 — needed for Desktop bridge mode |
| No context compaction tracking | `commands/compact/compact.ts` — triggers + token thresholds | `ContextBudget` exists but only tracks cumulative tokens; no compaction trigger integration | P1 |
| No fork session tracking | `print.ts:5075-5176` — fork-specific resume with parent session | `ForkSession` field in `RunProcessContext` but no fork state management | P1 |
| No JWT auth middleware | Bridge uses OAuth tokens + JWT for session auth | `api/handlers.go` — exist but relationship to session auth unclear | P2 |

---

## 5. Claude Code Build Command Mapping

### 5.1 `claude_code.go:54-120` vs Claude Code CLI flags

| Flag | AgentHub Support | Notes |
|---|---|---|
| `-p <prompt>` | Yes | Primary use case |
| `--output-format stream-json` | Yes | Fixed; not configurable |
| `--verbose` | Yes | Fixed |
| `--max-turns=<n>` | Yes | Default 50 |
| `--model <model>` | Yes | Via `ctx.Model` or adapter default; routed through `ResolveModel()` |
| `--permission-mode <mode>` | Yes | Default, acceptEdits, plan, bypassPermissions |
| `--reasoning-effort <effort>` | Yes | Via `ctx.ReasoningEffort`; routed through `ResolveReasoningEffort()` |
| `--max-thinking-tokens <n>` | Yes | Via `ctx.MaxThinkingTokens` |
| `--fast` | Yes | Via `ctx.FastMode` |
| `--include-partial-messages` | Yes | Via `ctx.IncludePartial` |
| `--resume <sessionId>` | Yes | Via `ctx.SessionID` |
| `--continue` | Yes | Via `ctx.ContinueLast` |
| `--fork-session` | Yes | Via `ctx.ForkSession` |
| `--add-dir <dir>` | Yes | Fixed to `ctx.WorkDir` (or `.`) |
| `--agents <json>` | **No** | Sub-agent definitions |
| `--system-prompt <text>` | **No** | Custom system prompt |
| `--append-system-prompt <text>` | **No** | Appended system prompt |
| `--mcp-config <json>` | **No** | MCP server configuration |
| `--tools <preset>` | **No** | Tool presets; defaults to all |
| `--allowed-tools <list>` | **No** | Tool allowlisting |
| `--disallowed-tools <list>` | **No** | Tool denylist |
| `--no-approval` | **No** | Skip all permission prompts |
| `--sandbox` | **No** | Enable sandbox mode |
| `--sandbox-upload-dir` | **No** | Sandbox working directory |
| `--setting-sources <sources>` | **No** | Settings source filter |
| `--custom-instructions <text>` | **No** | Custom instructions appended to system prompt |
| `--agent <name>` | **No** | Run as a specific named agent |
| `--ide` | **No** | IDE integration mode |
| `--acp` | **No** | Agent Communication Protocol |
| `--plugin-dir <dir>` | **No** | Plugin directory |

The adapter only exposes a subset of Claude Code's CLI flags. Adding `--allowed-tools`, `--disallowed-tools`, `--agents`, and `--mcp-config` would immediately unlock major capability improvements.

---

## 6. Summary: Priority Stack

### P0 — Must Fix (blocks production use)

1. **Permission system needs user-prompt path**: `control_protocol.go` auto-approves all tools. Desktop must be able to present permission prompts to the user and relay decisions back via the control protocol. This is the fundamental security gap.
   - Claude Code ref: `structuredIO.ts:536-658` `createCanUseTool()` — full race between hooks and SDK permission prompt
   - AgentHub fix: implement `EventEmittingPermissionHandler` with a blocking wait for Desktop response before writing control_response

2. **Session persistence**: AgentHub has no conversation storage. Messages are ephemeral (in-memory bus, cleared on restart). Every production agent needs message history.
   - Claude Code ref: `sessionStorage.ts` — JSONL session files, `loadConversationForResume()`
   - AgentHub fix: implement `EventStore` backed by JSONL or SQLite, replay on resume

3. **Hook callback support**: `hook_callback` control subtype is not implemented. Without it, hooks registered via the SDK (VS Code, plugins) cannot run.
   - Claude Code ref: `structuredIO.ts:661-689` `createHookCallback()`
   - AgentHub fix: add `handleHookCallback()` in control_protocol.go that invokes hook handlers

4. **Environment variable updates**: `update_environment_variables` message type is not handled. Bridge session tokens will expire and cannot be refreshed.
   - Claude Code ref: `structuredIO.ts:348-361`
   - AgentHub fix: add `update_environment_variables` case in parser_ndjson.go

5. **Hook system is external-only gap**: AgentHub's hooks are Go middleware only. Claude Code's hooks are external processes (shell/HTTP/LLM). Need to support external hook execution.
   - Claude Code ref: `utils/hooks.ts` — `executeInBackground()`, `wrapSpawn()`, child process management
   - AgentHub fix: add `ShellHook`, `HTTPHook`, `PromptHook` implementations in hooks.go

6. **Missing permission rules**: No deny/ask/allow rule system. Every tool use goes through auto-approve.
   - Claude Code ref: `permissions.ts` — `getAllowRules()`, `getDenyRules()`, `getAskRules()`, rule matching by tool name + content pattern
   - AgentHub fix: implement `PermissionRuleEngine` in a new `internal/permissions/` package

7. **`requires_action_details` not parsed**: The `session_state_changed.requires_action` field carries tool prompt info but AgentHub only reads `state`.
   - Claude Code ref: `structuredIO.ts:93-117` `buildRequiresActionDetails()`
   - AgentHub fix: add `requires_action` struct to claudeSDKMessage, emit in session_state_changed handler

### P1 — Should Fix (quality/feature gaps)

8. **Missing stream event types**: `input_json_delta`, `redacted_thinking`, `server_tool_use`, `search_result`
9. **Missing CLI flags**: `--allowed-tools`, `--disallowed-tools`, `--agents`, `--mcp-config`, `--sandbox`
10. **No session resume from AgentHub's side**: Dependency on CLI's `--resume` without own session store
11. **No multi-session support**: Single run at a time
12. **No bridge/remote session API**: Needed for Desktop bridge mode
13. **Missing hook events**: `PermissionDenied`, `UserPromptSubmit`, `SessionStart/End`, `StopFailure`, `SubagentStart/Stop`, `PreCompact/PostCompact`
14. **No sub-agent lifecycle**: Task hooks exist but no sub-agent control protocol
15. **No elicitation support**: MCP elicitation control subtype not implemented
16. **No context compaction integration**: ContextBudget tracks tokens but no compaction trigger

### P2 — Nice to Have (future roadmap)

17. **U+2028/U+2029 line terminator handling** in NDJSON scanner
18. **Sandbox network access forwarding** via `SandboxNetworkAccess` tool name
19. **More CLI flags**: `--system-prompt`, `--custom-instructions`, `--agent`, `--ide`
20. **Event-driven hooks**: `ConfigChange`, `InstructionsLoaded`, `FileChanged`, `CwdChanged`
21. **MCP message relay** control subtype
