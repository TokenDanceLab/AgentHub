# OpenCode CLI Audit Report

> Generated: 2026-05-25 | Target: AgentHub Edge Server OpenCode Adapter
> Source: D:\Code\TokenDance\AgentHub\reference\opencode

---

## Section 1: CLI Flag Map

Flags defined in `packages/opencode/src/cli/cmd/run.ts` (the `opencode run` command).

| Flag | Type | Description | Our Status | Priority |
|------|------|-------------|-----------|----------|
| `[message..]` | positional (string[]) | Prompt text; joined with spaces | **Handled** — passed as CLI arg | -- |
| `--command` | string | Execute a named slash-command (e.g., `/compact`) | **MISSING** | P1 |
| `--continue` / `-c` | boolean | Resume the last session | **Handled** | -- |
| `--session` / `-s` | string | Resume a specific session by ID | **Handled** | -- |
| `--fork` | boolean | Fork the session before continuing (`--session` or `--continue` required) | **Handled** | -- |
| `--share` | boolean | Share the session via a URL | **MISSING** | P2 |
| `--model` / `-m` | string | Provider/model in `provider/model` format | **Handled** | -- |
| `--agent` | string | Agent/mode name (build, plan, etc.) | **Handled** | -- |
| `--format` | string | `default` or `json` | **Handled** — always `json` | -- |
| `--file` / `-f` | string[] | File(s) to attach to the prompt | **MISSING** | P1 |
| `--title` | string | Session title (truncated prompt if empty, omitted if absent) | **MISSING** | P2 |
| `--attach` | string | Attach to a remote opencode server (URL) | **Out** (local-only adapter) | -- |
| `--password` / `-p` | string | Auth password for attach mode | **Out** | -- |
| `--username` / `-u` | string | Auth username for attach mode | **Out** | -- |
| `--dir` | string | Working directory | **MISSING** | P1 |
| `--port` | number | Port for the local server | **Out** (batch mode) | -- |
| `--variant` | string | Model variant / reasoning effort (high, max, minimal, etc.) | **Handled** — via `--variant` | -- |
| `--thinking` | boolean | Show thinking/reasoning blocks | **Handled** | -- |
| `--replay` | boolean | Replay visible session history on interactive resume | **Out** (interactive-only) | -- |
| `--replay-limit` | number | Cap replay to N newest messages | **Out** (interactive-only) | -- |
| `--interactive` / `-i` | boolean | Run in direct interactive split-footer TUI mode | **Out** (batch mode only) | -- |
| `--dangerously-skip-permissions` | boolean | Auto-approve all permissions | **Handled** | -- |
| `--demo` | boolean | Enable demo slash commands | **Out** | -- |

### Flag-specific findings

**1. `--format json` behavior:** In `run.ts`, when `--format json` is specified, each event is emitted as a JSON line by the `emit()` function. The format is:
```json
{
  "type": "<event_type>",
  "timestamp": <epoch_ms>,
  "sessionID": "<session_id>",
  "<type-specific-data>": { ... }
}
```
Events are emitted by the `loop()` function, which subscribes to SDK events (`client.event.subscribe()`) and mirrors them to stdout as flattened JSON. The `--format json` mode is mutually exclusive with `--interactive`.

**2. No `--format jsonl` flag exists** — JSON is always newline-delimited JSON (i.e., effectively JSONL already).

**3. `--format json` is actually the ONLY machine-readable output mode** — there is no streaming-SSE, NDJSON-over-WebSocket, or other format option.

**4. Our adapter currently passes `--format json` but does NOT use the `--file`, `--command`, `--dir`, or `--title` flags.**

---

## Section 2: JSON Event Schema

### 2.1. Current Output Format (`opencode run --format json`)

The `emit()` function in `run.ts` (line 618-631) serializes events as described above. The `loop()` function inside `run.ts` maps SDK-internal events to the flat JSON output:

#### Events emitted in `--format json` mode:

| Event Type | Trigger Condition | Data Fields | We Handle? |
|------------|------------------|-------------|------------|
| `tool_use` | `message.part.updated` where `part.type === "tool"` AND status is `completed` or `error` | `{ part: ToolPart }` (full SDK part object) | **Yes** |
| `step_start` | `message.part.updated` where `part.type === "step-start"` | `{ part: StepStartPart }` | **Yes** |
| `step_finish` | `message.part.updated` where `part.type === "step-finish"` | `{ part: StepFinishPart }` | **Yes** |
| `text` | `message.part.updated` where `part.type === "text"` AND `part.time?.end` exists | `{ part: TextPart }` | **Yes** |
| `reasoning` | `message.part.updated` where `part.type === "reasoning"` AND `part.time?.end` exists AND `--thinking` is true | `{ part: ReasoningPart }` | **Yes** |
| `error` | `session.error` event from SDK | `{ error: <error object> }` | **Yes** |

### 2.2. Full SDK Event Types (internal bus, not all emitted to JSON)

The SDK exposes a much broader set of events. The full type `Event` union in `types.gen.ts` includes these bus-level event types:

| Event Type | Description | We Handle? |
|------------|-------------|------------|
| `tui.prompt.append` | TUI only | No (not needed) |
| `tui.command.execute` | TUI only | No |
| `tui.toast.show` | TUI only | No |
| `tui.session.select` | TUI only | No |
| `server.connected` | Server lifecycle | No |
| `global.disposed` | Shutdown | No |
| `server.instance.disposed` | Server lifecycle | No |
| `file.edited` | External file edit | **MISSING** (could be P2) |
| `file.watcher.updated` | File watcher event | No |
| `lsp.client.diagnostics` | LSP diagnostics | No |
| `lsp.updated` | LSP status | No |
| `message.part.delta` | Streaming delta for any part field | **MISSING** (important for streaming) |
| `permission.asked` | Permission request | Handled via handleEvent, not JSON |
| `permission.replied` | Permission response | No (internal) |
| `session.diff` | File diff in session | No |
| `session.error` | Session-level error | **Handled** |
| `question.asked` | Question for user | **MISSING** |
| `question.replied` | User replied to question | No (internal) |
| `question.rejected` | User rejected question | No |
| `todo.updated` | Todo list updated | **MISSING** |
| `session.status` | Status change (idle/busy/retry) | Used to detect completion |
| `session.idle` | Session went idle | No |
| `mcp.tools.changed` | MCP server tools changed | No |
| `mcp.browser.open.failed` | MCP browser failure | No |
| `command.executed` | Slash command executed | No |
| `project.updated` | Project config updated | No |
| `session.compacted` | Context compaction completed | No |
| `vcs.branch.updated` | Git branch changed | No |
| `workspace.ready` | Workspace created | No |
| `workspace.failed` | Workspace failed | No |
| `workspace.status` | Workspace status change | No |
| `worktree.ready` | Git worktree created | No |
| `worktree.failed` | Git worktree failed | No |
| `pty.created` | Terminal created | No |
| `pty.updated` | Terminal updated | No |
| `pty.exited` | Terminal exited | No |
| `pty.deleted` | Terminal deleted | No |
| `installation.updated` | OpenCode version change | No |
| `installation.update-available` | Upgrade available | No |
| `message.updated` | Full message info | No |
| `message.removed` | Message deleted | No |
| `message.part.updated` | Part added or updated | **Core loop — dispatches sub-events** |
| `message.part.removed` | Part removed | No |
| `session.created` | Session created | **MISSING** |
| `session.updated` | Session metadata updated | No |
| `session.deleted` | Session deleted | No |
| `session.next.agent.switched` | Agent changed mid-session | No |
| `session.next.model.switched` | Model changed mid-session | No |
| `session.next.prompted` | User prompt submitted | No |
| `session.next.synthetic` | Synthetic/injected text | No |
| `session.next.shell.started` | Shell command started | No |
| `session.next.shell.ended` | Shell command ended | No |
| `session.next.step.started` | AI turn started | No (raw event, `step_start` output covers) |
| `session.next.step.ended` | AI turn ended | No |
| `session.next.step.failed` | AI turn failed | No |
| `session.next.text.started` | Text block started | No |
| `session.next.text.delta` | Text streaming delta | **MISSING (important)** |
| `session.next.text.ended` | Text block complete | No |
| `session.next.reasoning.started` | Reasoning block started | No |
| `session.next.reasoning.delta` | Reasoning streaming delta | **MISSING** |
| `session.next.reasoning.ended` | Reasoning block complete | No |
| `session.next.tool.input.started` | Tool input streaming | No |
| `session.next.tool.input.delta` | Tool input delta | No |
| `session.next.tool.input.ended` | Tool input complete | No |
| `session.next.tool.called` | Tool call parsed | No |
| `session.next.tool.progress` | Tool execution progress | No |
| `session.next.tool.success` | Tool execution succeeded | No |
| `session.next.tool.failed` | Tool execution failed | No |
| `session.next.retried` | API call retried | No |
| `session.next.compaction.started` | Compaction started | No |
| `session.next.compaction.delta` | Compaction summary delta | No |
| `session.next.compaction.ended` | Compaction complete | No |
| `catalog.model.updated` | Model catalog updated | No |

### 2.3. Part Types (within `message.part.updated`)

The `Part` union type from the SDK (`types.gen.ts`):

| Part Type | Key Fields | We Handle? |
|-----------|-----------|------------|
| `TextPart` | `id, sessionID, messageID, type:"text", text, synthetic?, ignored?, time?` | **Yes** (via `text` event) |
| `SubtaskPart` | `id, sessionID, messageID, type:"subtask", prompt, description, agent, model?, command?` | **MISSING** |
| `ReasoningPart` | `id, sessionID, messageID, type:"reasoning", text, metadata?, time` | **Yes** (via `reasoning` event) |
| `FilePart` | `id, sessionID, messageID, type:"file", mime, filename?, url, source?` | **MISSING** (file attachment) |
| `ToolPart` | `id, sessionID, messageID, type:"tool", callID, tool, state` | **Yes** (via `tool_use` event) |
| `StepStartPart` | `id, sessionID, messageID, type:"step-start", snapshot?` | **Yes** (via `step_start` event) |
| `StepFinishPart` | `id, sessionID, messageID, type:"step-finish", reason, cost, tokens, snapshot?` | **Yes** (via `step_finish` event) |
| `SnapshotPart` | `id, sessionID, messageID, type:"snapshot", snapshot` | **MISSING** |
| `PatchPart` | `id, sessionID, messageID, type:"patch", hash, files` | **MISSING** |
| `AgentPart` | `id, sessionID, messageID, type:"agent", name, source?` | **MISSING** |
| `RetryPart` | `id, sessionID, messageID, type:"retry", attempt, error, time` | **MISSING** |
| `CompactionPart` | `id, sessionID, messageID, type:"compaction", auto, overflow?, tail_start_id?` | **MISSING** |

### 2.4. ToolState (within ToolPart)

The `ToolState` union has four variants:

```typescript
ToolStatePending:  { status: "pending", input, raw }
ToolStateRunning:  { status: "running", input, title?, metadata?, time: { start } }
ToolStateCompleted:{ status: "completed", input, output, title, metadata, time, attachments? }
ToolStateError:    { status: "error", input, error, metadata?, time }
```

Our adapter reads `state`, `input`, `output`, and `status` — **correct** for `completed`/`error` states. We **miss** `metadata` and `attachments` on completed tool states.

### 2.5. Events Our Adapter Handles But Are NOT in `--format json` Output

These event types appear in our `opencode.go` dispatch but were NOT found in the `run.ts --format json` code path:
- `session.init` — not in v2 run.ts emit path
- `permission` — handled internally via `permission.asked` → auto-reply loop (not emitted as JSON)
- `file` — not in v2 run.ts emit path
- `task_start` — not found in any OpenCode source; no reference at all
- `task_progress` — not found in any source
- `task_complete` — not found in any source

**These may come from an older version of OpenCode.** The current version uses `message.part.updated` for tool events (including task tools) rather than dedicated `task_*` events. The `session.init` event likely came from a pre-v2 schema.

---

## Section 3: Tool Catalog

OpenCode defines these built-in tools in `packages/opencode/src/tool/`:

### 3.1. Complete Tool List

| Tool ID | Source File | Description | Input Key Fields | Conditional |
|---------|------------|-------------|-----------------|-------------|
| `invalid` | `invalid.ts` | Placeholder for unknown tools | — | Always on |
| `shell` | `shell.ts` | Execute shell commands | `command`, `description`, `workdir?`, `timeout?` | Always on |
| `read` | `read.ts` | Read file contents | `filePath`, `offset?`, `limit?`, `symbol?` | Always on |
| `glob` | `glob.ts` | File pattern matching | `pattern`, `path?` | Always on |
| `grep` | `grep.ts` | Search file contents | `pattern`, `path?`, `context?` | Always on |
| `edit` | `edit.ts` | Edit file with diff | `filePath`, `oldString`, `newString`, `replaceAll?` | When not using gpt-5 |
| `write` | `write.ts` | Create/overwrite file | `filePath`, `content` | When not using gpt-5 |
| `task` | `task.ts` | Delegate to subagent | `description`, `prompt`, `subagent_type`, `task_id?`, `command?`, `background?` | Always on |
| `task_status` | `task_status.ts` | Poll background task | `task_id`, `wait?` | Only with `experimentalBackgroundSubagents` flag |
| `todowrite` | `todo.ts` | Manage todo list | `todos` (array of `{content, status, priority}`) | Always on |
| `question` | `question.ts` | Ask user questions | `questions` (array of `{question, header, options, multiple?, custom?}`) | CLI only, `enableQuestionTool` flag |
| `webfetch` | `webfetch.ts` | Fetch URL content | `url`, `prompt?`, `format?` | Always on |
| `websearch` | `websearch.ts` | Web search | `query`, `provider?` | Always on (provider-dependent) |
| `skill` | `skill.ts` | Load skill instructions | `name` | Always on |
| `apply_patch` | `apply_patch.ts` | Apply multi-file patch | `patches` (array of `{filePath, patch}`) | Only for GPT-5+ models |
| `lsp` | `lsp.ts` | LSP operations | `filePath`, `operation`, `line?`, `character?` | Only with `experimentalLspTool` flag |
| `plan_exit` | `plan.ts` | Exit plan mode to build | — | Only with `experimentalPlanMode` + CLI |
| `repo_clone` | `repo_clone.ts` | Clone a git repository | `repo`, `branch?` | Only with `experimentalScout` flag |
| `repo_overview` | `repo_overview.ts` | Repository overview | `path` | Only with `experimentalScout` flag |

### 3.2. Tool Execution Flow

Each tool has:
1. **Schema** (`Parameters`): Effect Schema defining input params
2. **JSON Schema** (`jsonSchema`): Auto-generated from parameters (or manually crafted for `task`)
3. **Description**: Markdown description from `.txt` file
4. **execution**: Effect-based async function called with `(params, context)`
5. **Output**: `{ title, output, metadata, attachments? }`

### 3.3. File-Modifying Tool Detection

Our adapter's `isFileModifyingTool()` function currently likely checks for tool name patterns. From the source, the file-modifying tools are:
- `edit` — modifies existing files
- `write` — creates/overwrites files
- `apply_patch` — applies patches to multiple files
- `repo_clone` — clones repositories (creates files)

The `TaskTool` can also cause file changes indirectly through subagents.

### 3.4. Task Tool (Subagent Delegation)

This is critical for AgentHub. The `task` tool:
- Takes `description`, `prompt`, `subagent_type`, optional `task_id`
- Creates a **child session** with `parentID = current session ID`
- Derives permissions from parent agent + subagent config
- Runs the prompt in the child session, then returns `<task_result>` back
- Supports `background: true` for async subagent execution (experimental flag)
- Returns `task_id: <sessionID>` for resuming or `task_status` polling

This maps directly to AgentHub's orchestrator/subagent model. The child session IDs can be tracked.

---

## Section 4: ACP Protocol

### 4.1. What Is ACP?

**Agent Communication Protocol (ACP)** is a standardized protocol for agent-client communication, implemented over the `@agentclientprotocol/sdk` package. OpenCode acts as an ACP **agent** (server-side), allowing ACP-compliant **clients** (like IDE plugins) to connect.

### 4.2. Architecture

```
ACP Client (IDE/Editor) <--ACP Protocol--> ACP Agent (OpenCode)
                                              |
                                              +-- OpenCode SDK (internal HTTP)
                                              |
                                              +-- Session Manager
```

The ACP agent (`packages/opencode/src/acp/agent.ts`) implements the `@agentclientprotocol/sdk` `Agent` interface.

### 4.3. ACP Capabilities

From `initialize()`:
- **Agent Info**: name="OpenCode", version from installation
- **Session Capabilities**: `close`, `fork`, `list`, `resume`
- **Prompt Capabilities**: `embeddedContext`, `image`
- **MCP Capabilities**: `http`, `sse`
- **Auth Methods**: `opencode-login` (terminal-auth)

### 4.4. ACP Session Flow

1. **Initialize** — client connects, receives capabilities and auth methods
2. **NewSession** — creates an OpenCode session internally, returns `sessionId`, `models`, `modes` (agents), `configOptions` (model/effort/mode selects)
3. **LoadSession** — loads existing session, replays message history as ACP updates
4. **Prompt** — client sends text/images/files/resources, agent processes
5. **Events** — agent streams `agent_message_chunk` (text), `agent_thought_chunk` (reasoning), `tool_call` (start), `tool_call_update` (progress/completed/failed), `plan` (todos), `usage_update` (tokens/cost)
6. **Fork** — forks a session with history
7. **Resume** — resumes with recent history
8. **Cancel** — aborts current run
9. **Close** — closes and aborts session

### 4.5. Event Flow from SDK to ACP

The ACP agent subscribes to `sdk.global.event()` and handles:
- `permission.asked` — forwards to ACP client; handles `edit` permission with file sync
- `message.part.updated` — converts tool/text/reasoning parts to ACP session updates
- `message.part.delta` — streams text/reasoning deltas

Tool output includes both `content` (text + diff + images) and `rawOutput` (output + metadata + attachments).

### 4.6. How AgentHub Can Leverage ACP

1. **As ACP Client**: AgentHub's Edge Server could implement an ACP client connecting to an OpenCode ACP agent via WebSocket or stdio. This gives richer streaming (real-time deltas, not just completed events), session management, and model/mode selection.

2. **As ACP Agent**: If AgentHub exposes an ACP agent interface, it could work with any ACP-compliant client. This is more relevant for UI integration than CLI integration.

3. **Session Management**: ACP exposes full session CRUD (create, load, list, fork, close, resume) — richer than the CLI's `--session`/`--continue` flags.

4. **Model/Mode Selection**: ACP provides `models` list, `modes` list, and `configOptions` for runtime selection.

5. **Multi-Agent**: ACP supports switching agents/modes per session via `setSessionMode`. The task tool already creates child sessions for subagents.

**Recommendation**: For Phase 2+, consider implementing an ACP client sidecar that talks to an OpenCode server rather than spawning CLI processes. This gives streaming deltas, richer events, and proper session lifecycle.

---

## Section 5: Adapter Gaps

### 5.1. What We Handle Correctly

- Model resolution (`-m provider/model`)
- Reasoning effort (`--thinking` + `--variant`)
- Agent mode (`--agent`)
- Session continuity (`--session`, `--continue`, `--fork`)
- Permission bypass (`--dangerously-skip-permissions`)
- Basic event parsing (step_start, text, tool_use, tool_result, reasoning, step_finish, error)
- Token usage tracking
- Cost tracking

### 5.2. What We Handle But With Wrong/Incomplete Schema

| Gap | Impact | Current Behavior | Correct Behavior |
|-----|--------|-----------------|------------------|
| `session.init` event | Medium | Dispatched on `step_start` instead of separate event | Wait — this event does NOT exist in current OpenCode `--format json` output |
| `permission` event | Low | Emits with `permissionMode`, `permissionTool`, `permissionInput` | Permission is now handled by the ACP agent or auto-replied; not in JSON output |
| `file` event | Low | Emits with `path`, `operation` | FilePart now has `url`, `mime`, `filename`, `source`; not in JSON output |
| `task_start/progress/complete` | High | Handles these events with schema | **These events DO NOT EXIST in the current OpenCode source code.** Likely from an earlier version. |
| ToolResult attachements | Low | Only reads `output` string | `ToolStateCompleted` also has `attachments[]`, `metadata`, time tracking |

### 5.3. What We Completely Miss

| Gap | Impact | Description |
|-----|--------|-------------|
| `--file / -f` flag | **P1** | Cannot attach files to prompts. FileFilePart has `type:"file"`, `url`, `filename`, `mime`. Would need to resolve file paths and pass as arguments. |
| `--command` flag | **P1** | Cannot execute slash commands (e.g., `/compact`). Would use `sdk.session.command()` internally. |
| `--dir` flag | **P1** | Cannot specify working directory. Currently defaults to `"."`. OpenCode `run` has `cwd` support. |
| Text streaming deltas | **P2** | Current `text` event only fires when `part.time?.end` exists (complete). Real-time streaming requires `message.part.delta` or abridged polling via `session.next.text.delta`. |
| `SubtaskPart` handling | **P2** | OpenCode Part union includes `SubtaskPart` (distinct from ToolPart/task). Not handled. |
| `QuestionPart`/`TodoPart` | **P2** | Question and todo updates provide structured planning data. Not emitted in current JSON output but could be. |
| `CompactionPart` | **P2** | Context compaction events provide awareness that earlier context was summarized. |
| `RetryPart` | **P2** | API retries are tracked. Important for reliability monitoring. |
| `AgentPart` | **P2** | Agent switch mid-session is tracked as a part. For multi-agent workflows. |
| `SnapshotPart` | **P2** | File snapshots enable reverting changes. Useful for safety/audit. |
| Session lifecycle events | **P2** | `session.created`, `session.updated`, `session.deleted` — not available in CLI JSON output but available via SDK. |
| SDK-level API access | **P0 (long-term)** | We spawn CLI processes. For richer integration, use the OpenCode SDK/HTTP API directly instead of CLI. |

### 5.4. Critical Observation: Event Schema Mismatch

Our adapter handles event types that do NOT exist in the current OpenCode v2 `--format json` code path:
- `session.init` — not emitted
- `permission` — not emitted (handled via auto-reply internally)
- `file` — not emitted
- `task_start` — not in source at all
- `task_progress` — not in source at all
- `task_complete` — not in source at all

The current `--format json` code path (from `run.ts`) only outputs these events:
```
step_start, text, tool_use, step_finish, reasoning, error
```

**This means our adapter may have been written for an older OpenCode CLI version**, or the events were aspirational. We need to verify which version of the OpenCode binary we are actually testing against.

---

## Section 6: Recommended Changes

### 6.1. Immediate Fixes (P0 — adapter is built against wrong event schema)

**1. Audit the actual OpenCode binary version we're using.**
Run `opencode --version` and `opencode run "hello" --format json` to observe actual output. Compare with our `dispatch()` cases.

**2. Rewrite the event dispatch map to match current `--format json` output.**
Based on reading `run.ts`, the actual events in JSON format are:
```
step_start, step_finish, text, tool_use, reasoning, error
```
Where `tool_use` is used for BOTH tool start and tool completion (with status indicating state).

**3. Fix ToolPart handling.**
The current `run.ts` JSON output emits `tool_use` events for **both** tool execution start AND completion/error. Our adapter currently emits two different events (`tool_use` and `tool_result`). We should:
- On first `tool_use` with `state.status === "pending"` or `"running"`: emit `tool_use` (working state)
- On `tool_use` with `state.status === "completed"`: emit `tool_result` with output and also `tool_use` for final state
- On `tool_use` with `state.status === "error"`: emit `tool_result` with error

**4. Fix `session.init` → `step_start` mapping.**
If the binary doesn't emit `session.init`, remove it. The first `step_start` event contains `agent`, `model` information.

### 6.2. Priority Changes (P1)

**5. Add `--file` flag support.**
```go
// In BuildCommand:
if len(ctx.Attachments) > 0 {
    for _, att := range ctx.Attachments {
        args = append(args, "--file", att.Path)
    }
}
```
Files are auto-detected as mime `text/plain` or `application/x-directory`.

**6. Add `--dir` flag support.**
```go
// In BuildCommand:
if ctx.WorkDir != "" {
    args = append(args, "--dir", ctx.WorkDir)
}
```

**7. Add `--command` flag support.**
For slash commands like `compact`:
```go
if ctx.Command != "" {
    args = append(args, "--command", ctx.Command)
}
```

**8. Support streaming text deltas.**
The current adapter only gets completed text blocks. For real-time streaming, we would need to use the SDK directly (see 6.4) or parse `message.part.delta` events.

**9. Extract ToolState metadata and attachments.**
Add to `opencodePart`:
```go
type opencodePart struct {
    // ... existing fields ...
    Metadata    any          `json:"metadata,omitempty"`
    Attachments []FilePart   `json:"attachments,omitempty"`
    Time        *struct{Start float64; End float64} `json:"time,omitempty"`
}
```

### 6.3. Enhancement Opportunities (P2)

**10. Track session lifecycle via session.created / session.idle events** (if emitted).

**11. Handle compaction events** — when OpenCode auto-compacts context, the summary is important for AgentHub's orchestrator to know.

**12. Handle multi-agent mode switches** — `AgentPart` signals agent changes. In AgentHub's multi-agent context, this could drive orchestrator decisions.

**13. Handle retry monitoring** — `RetryPart` events for API reliability metrics.

**14. Handle question/todo structured data** — for richer orchestrator orchestration.

### 6.4. Long-Term: Direct SDK Integration (P0 for Phase 2)

The CLI approach is inherently limited. For full integration:

1. **Use the OpenCode SDK/HTTP API** instead of spawning CLI processes.
   - The SDK exposes `POST /session/prompt`, `GET /event` (SSE stream), `POST /session/command`, etc.
   - Events from `/event` include ALL event types (full SDK event schema).
   - Real-time streaming deltas.
   - Session lifecycle management.

2. **Embed OpenCode as a library** via the `@opencode-ai/sdk/v2` package.
   - This requires a Node.js/bun runtime sidecar.
   - The Go adapter would talk to this sidecar via HTTP or gRPC.

3. **Implement as an ACP Client**.
   - Connect to a running OpenCode ACP agent.
   - Get full session management, streaming, model/mode selection.
   - Standard protocol for tooling.

4. **For the task tool and subagents**:
   - Track `parentID` on sessions to map subagent tasks.
   - When `ToolPart.tool === "task"`, extract `subagent_type`, `description`, `prompt`.
   - The child session ID is in the output as `task_id: <sessionID>`.
   - This maps directly to AgentHub's orchestrator → subagent model.

### 6.5. Configuration Discoveries

**Model variants**: OpenCode models have a `variants` map (e.g., `{"high": {...}, "low": {...}, "max": {...}}`). The `--variant` flag selects which variant to use. The variant body options (like `reasoning_effort` values) are merged into the API request. Our adapter already passes `--variant` correctly.

**Provider/model format**: `providerID/modelID` — parsed by `Provider.parseModel()` which splits on the first `/`. Model IDs themselves can contain `/` (e.g., `openai/gpt-5.1` where provider=openai, model=gpt-5.1). This is already correct in our adapter.

**Bundled providers**: 21 providers are bundled (AI SDK V5 compat): Amazon Bedrock, Anthropic, Azure, Google, Vertex, OpenAI, OpenRouter, xAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, Gateway, TogetherAI, Perplexity, Vercel, Alibaba, GitLab, GitHub Copilot, Venice. Plus custom providers via npm packages or config.

**Experimental flags** (via `OPENCODE_EXPERIMENTAL_*` env vars):
- `experimentalBackgroundSubagents`: enables `task_status` tool
- `experimentalLspTool`: enables `lsp` tool
- `experimentalPlanMode`: enables `plan_exit` tool agent
- `experimentalScout`: enables `repo_clone`, `repo_overview` tools
- `experimentalOxfmt`: enables oxfmt code formatter
- `enableQuestionTool`: enables `question` tool in non-CLI modes
- `enableExperimentalModels`: enables alpha-status models

---

## Appendix: Key File Reference

| File | Content |
|------|---------|
| `packages/opencode/src/cli/cmd/run.ts` | CLI `run` command: flags, `--format json` event loop, session lifecycle |
| `packages/opencode/src/cli/cmd/run/tool.ts` | Tool display rules, file-modifying detection, tool inline info |
| `packages/core/src/session-event.ts` | Internal event v2 schema (`session.next.*` events) |
| `packages/core/src/event.ts` | Event v2 framework (define, publish, subscribe) |
| `packages/opencode/src/acp/agent.ts` | ACP agent implementation (full protocol) |
| `packages/opencode/src/acp/session.ts` | ACP session management (create, load, remove) |
| `packages/opencode/src/acp/types.ts` | ACP types (ACPSessionState, ACPConfig) |
| `packages/opencode/src/tool/registry.ts` | Tool registry: all tools, initialization, filtering |
| `packages/opencode/src/tool/task.ts` | Task tool: subagent delegation with child sessions |
| `packages/opencode/src/provider/provider.ts` | Provider system: 21 bundled providers, model parsing, SDK resolution |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | Full SDK types: Event, Part, ToolPart, ToolState, all message/event types |
| `packages/core/src/tool-output.ts` | Tool output content types (TextContent, FileContent, Structured) |
| `packages/core/src/catalog.ts` | V2 Catalog: provider/model management |
