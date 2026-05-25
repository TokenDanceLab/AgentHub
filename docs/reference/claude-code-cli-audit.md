# Claude Code CLI Audit Report for AgentHub Integration

**Source analyzed**: `src/cli/print.ts`, `src/main.tsx`, `src/entrypoints/sdk/coreSchemas.ts`, `src/entrypoints/sdk/controlSchemas.ts`, `src/utils/effort.ts`, `src/utils/thinking.ts`, `src/cli/structuredIO.ts`

**Current adapter**: `edge-server/internal/adapters/claude_code.go` (Go)
**Current parser**: `edge-server/internal/adapters/parser_ndjson.go` (Go)
**Current control**: `edge-server/internal/adapters/control_protocol.go` (Go)

---

## Section 1: CLI Flag Map

Every flag defined in `src/main.tsx` lines 968-1006, with support status in our adapter.

| Flag | Type | Description | Our Support | Priority |
|------|------|-------------|-------------|----------|
| `-p, --print` | bool | Non-interactive/headless mode | YES (always used) | -- |
| `--output-format <format>` | enum | `text`, `json`, `stream-json` | YES (`stream-json`) | -- |
| `--verbose` | bool | Override verbose config | YES (always used) | -- |
| `--max-turns <turns>` | int | Max agentic turns | YES (`maxTurns`) | -- |
| `--model <model>` | string | Model alias or full ID | YES | -- |
| `--effort <level>` | enum | `low`, `medium`, `high`, `max` | YES (`--effort`) | -- |
| `--permission-mode <mode>` | enum | `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk` | YES | -- |
| `-c, --continue` | bool | Continue most recent conversation | YES | -- |
| `-r, --resume [value]` | string/bool | Resume by session ID or picker | YES | -- |
| `--fork-session` | bool | New session ID on resume | YES | -- |
| `--add-dir <dirs...>` | string[] | Allow tool access to dirs | YES (workDir) | -- |
| `--include-partial-messages` | bool | Stream partial deltas | YES | -- |
| `--max-budget-usd <amount>` | float | Dollar cap on API spend | **MISSING** | P1 |
| `--json-schema <schema>` | JSON | Structured output validation | **MISSING** | P1 |
| `--thinking <mode>` | enum | `enabled`, `adaptive`, `disabled` | **PARTIAL** (we pass `--max-thinking-tokens` which is deprecated) | P0 |
| `--max-thinking-tokens <tokens>` | int | **[DEPRECATED]** Use `--thinking` instead | WRONG FLAG (deprecated, hidden) | P0 |
| `--system-prompt <prompt>` | string | Override system prompt | **MISSING** | P1 |
| `--append-system-prompt <prompt>` | string | Append to default system prompt | **MISSING** | P1 |
| `--betas <betas...>` | string[] | Beta API headers | **MISSING** | P2 |
| `--fallback-model <model>` | string | Fallback when primary overloaded | **MISSING** | P2 |
| `--agents <json>` | JSON | Custom agent definitions | **MISSING** | P1 |
| `--agent <agent>` | string | Agent type for session | **MISSING** | P2 |
| `--mcp-config <configs...>` | string[] | MCP server configs | **MISSING** | P1 |
| `--strict-mcp-config` | bool | Only use --mcp-config servers | **MISSING** | P2 |
| `--allowedTools <tools...>` | string[] | Allowlist tool names | **MISSING** | P1 |
| `--disallowedTools <tools...>` | string[] | Denylist tool names | **MISSING** | P2 |
| `--tools <tools...>` | string[] | Specific built-in tool set | **MISSING** | P2 |
| `--session-id <uuid>` | UUID | Explicit session ID | **MISSING** | P1 |
| `--no-session-persistence` | bool | Don't save session to disk | **MISSING** | P2 |
| `--session-name, -n <name>` | string | Display name for session | **MISSING** | P2 |
| `--settings <file-or-json>` | string | Additional settings file/JSON | **MISSING** | P1 |
| `--setting-sources <sources>` | CSV | `user,project,local` sources | **MISSING** | P2 |
| `--plugin-dir <path>` | string[] | Inject plugins | **MISSING** | P2 |
| `--sdk-url <url>` | string | Remote WS endpoint (CCR) | **MISSING** | Out |
| `--input-format <format>` | enum | `text`, `stream-json` | **MISSING** | P2 |
| `--replay-user-messages` | bool | Echo user messages back | **MISSING** | P2 |
| `--include-hook-events` | bool | Emit hook lifecycle events | **MISSING** | P2 |
| `--bare` | bool | Minimal mode (no hooks/skills) | **MISSING** | P2 |
| `--ide` | bool | Auto-connect IDE | **MISSING** | Out |
| `--chrome / --no-chrome` | bool | Claude-in-Chrome | **MISSING** | Out |
| `--file <specs...>` | string[] | Download remote files | **MISSING** | Out |
| `-w, --worktree [name]` | string | Git worktree isolation | **MISSING** | Out |
| `--tmux` | bool | tmux session wrapper | **MISSING** | Out |
| `--dangerously-skip-permissions` | bool | Bypass all permissions | **MISSING** | P2 |
| `--allow-dangerously-skip-permissions` | bool | Allow bypass option | **MISSING** | Out |

### Key finding: `--max-thinking-tokens` is DEPRECATED

In `main.tsx` line 976:
```typescript
.addOption(new Option('--max-thinking-tokens <tokens>',
  '[DEPRECATED. Use --thinking instead for newer models] Maximum number of thinking tokens '
  + '(only works with --print)').argParser(Number).hideHelp())
```

The flag is both deprecated AND hidden from help. Our adapter at `claude_code.go:89` passes `--max-thinking-tokens` which may not work on newer models (4.6+). The correct replacement is `--thinking <mode>` where mode is one of:
- `enabled` (same as `adaptive` internally)
- `adaptive` (Claude decides when/how much to think -- Opus 4.6+)
- `disabled` (no extended thinking)

The `ThinkingConfig` type in `src/utils/thinking.ts` is:
```typescript
type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }
```

However, note that the CLI flag `--thinking` does NOT accept a budgetTokens parameter. `budgetTokens` comes from the settings/config system, not CLI flags.

---

## Section 2: NDJSON Event Schema

Derived from `SDKMessageSchema` in `src/entrypoints/sdk/coreSchemas.ts` (the union of all message types in the stdout stream).

### Complete event types, their fields, and our handling status:

#### 2.1 `system` / `init` -- Session initialization
| Field | Type | We Handle? |
|-------|------|-----------|
| `type` | `"system"` | YES |
| `subtype` | `"init"` | YES |
| `agents` | string[] (optional) | **NO** |
| `apiKeySource` | enum | **NO** |
| `betas` | string[] (optional) | **NO** |
| `claude_code_version` | string | YES (as `version`) |
| `cwd` | string | **NO** |
| `tools` | string[] | YES |
| `mcp_servers` | object[] | YES |
| `model` | string | YES |
| `permissionMode` | enum | YES |
| `slash_commands` | string[] | **NO** |
| `output_style` | string | **NO** |
| `skills` | string[] | **NO** |
| `plugins` | object[] | **NO** |
| `fast_mode_state` | enum (optional) | **NO** |
| `uuid` | UUID | **NO** |
| `session_id` | string | **NO** |

#### 2.2 `assistant` -- Full assistant message
| Field | Type | We Handle? |
|-------|------|-----------|
| `type` | `"assistant"` | YES |
| `message` (role, content[]) | API message | YES |
| `parent_tool_use_id` | string\|null | **NO** |
| `error` | enum (optional) | **NO** |
| `uuid` | UUID | **NO** |
| `session_id` | string | **NO** |

Content blocks we parse: `text`, `tool_use`, `thinking` -- YES.

#### 2.3 `stream_event` -- Partial message deltas (requires `--include-partial-messages`)
| Field | Type | We Handle? |
|-------|------|-----------|
| `type` | `"stream_event"` | YES |
| `event` | RawMessageStreamEvent | YES |
| `parent_tool_use_id` | string\|null | **NO** |
| `uuid` | UUID | **NO** |
| `session_id` | string | **NO** |

We handle `content_block_delta` (text_delta, thinking_delta) and `content_block_start` (tool_use). We do NOT handle `content_block_stop` in a meaningful way (just logs). We also don't handle `message_start`, `message_delta`, `message_stop` events.

#### 2.4 `user` / `SDKUserMessage` -- Tool results
| Field | Type | We Handle? |
|-------|------|-----------|
| `type` | `"user"` | YES |
| `message` (role, content[]) | API message | YES |
| `parent_tool_use_id` | string\|null | **NO** |
| `isSynthetic` | bool (optional) | **NO** |
| `tool_use_result` | unknown (optional) | **NO** |
| `priority` | enum (optional) | **NO** |
| `timestamp` | ISO string (optional) | **NO** |
| `uuid` | UUID (optional) | **NO** |
| `session_id` | string (optional) | **NO** |

We handle `tool_result` content blocks and emit `file_change` for Write/Edit/NotebookEdit tools.

#### 2.5 `user` / `SDKUserMessageReplay` -- Replayed user messages
Same fields as SDKUserMessage with `isReplay: true`. We do NOT handle this event type.

#### 2.6 `result` -- Final result
| Field | Type | We Handle? |
|-------|------|-----------|
| `type` | `"result"` | YES |
| `subtype` | `"success"` \| error subtypes | YES |
| `duration_ms` | number | YES |
| `duration_api_ms` | number | **NO** |
| `is_error` | bool | **NO** |
| `num_turns` | number | YES |
| `result` | string (success only) | YES |
| `stop_reason` | string\|null | **NO** |
| `total_cost_usd` | number | **NO** |
| `usage` | NonNullableUsage | YES (partial) |
| `modelUsage` | Record<string, ModelUsage> | **NO** |
| `permission_denials` | PermissionDenial[] | **NO** |
| `structured_output` | unknown (optional) | **NO** |
| `fast_mode_state` | enum (optional) | **NO** |
| `uuid` | UUID | **NO** |
| `session_id` | string | **NO** |
| `errors` | string[] (error subtypes only) | YES |

#### 2.7 `system` / `compact_boundary` -- Compaction events
We handle: YES (trigger, pre_tokens). Missing: `preserved_segment` (head_uuid, anchor_uuid, tail_uuid).

#### 2.8 `system` / `status` -- Status changes
We handle: YES (status, permissionMode).

#### 2.9 `system` / `api_retry` -- API retry notification
We handle: YES (attempt, max_retries, retry_delay_ms, error_status, error).

#### 2.10 `system` / `local_command_output` -- Output from slash commands
**NOT HANDLED**. Fields: `content`, `uuid`, `session_id`.

#### 2.11 `system` / `hook_started`, `hook_progress`, `hook_response` -- Hook events
We handle: YES (hook_id, hook_name, hook_event, stdout, stderr, output, exit_code, outcome).
Note: These only fire with `--verbose` (we use it) and `--output-format=stream-json`. We already pass both.

#### 2.12 `tool_progress` -- Tool execution progress
We handle: YES (tool_use_id, tool_name, elapsed_time_seconds, task_id).
Missing: `parent_tool_use_id`, `uuid`, `session_id`.

#### 2.13 `auth_status` -- AWS auth status
We handle: YES (isAuthenticating, output, error).

#### 2.14 `system` / `task_notification` -- Background task completion
We handle: YES (task_id, tool_use_id, status, output_file, summary, usage).

#### 2.15 `system` / `task_started` -- Task creation
We handle: YES (task_id, tool_use_id, description, task_type).
Missing: `workflow_name`, `prompt`, `uuid`, `session_id`.

#### 2.16 `system` / `task_progress` -- Task progress
We handle: YES (task_id, tool_use_id, description, usage, last_tool_name).
Missing: `summary`, `uuid`, `session_id`.

#### 2.17 `tool_use_summary` -- Consolidated tool use
We handle: YES (summary, preceding_tool_use_ids).

#### 2.18 `system` / `session_state_changed` -- Session lifecycle
We handle: YES (state: idle, running, requires_action).

#### 2.19 `rate_limit_event` -- Rate limit info
We handle: YES (rate_limit_info).

#### 2.20 `system` / `files_persisted` -- Files persisted notification
**NOT HANDLED**. Fields: `files[]`, `failed[]`, `processed_at`.

#### 2.21 `system` / `elicitation_complete` -- MCP elicitation complete
**NOT HANDLED**. Fields: `mcp_server_name`, `elicitation_id`.

#### 2.22 `system` / `post_turn_summary` -- Background post-turn summary
**NOT HANDLED**. Fields: `summarizes_uuid`, `status_category`, `status_detail`, `is_noteworthy`, `title`, `description`, `recent_action`, `needs_action`, `artifact_urls`.

#### 2.23 `streamlined_text` -- Streamlined output text
**NOT HANDLED** (internal ant-only feature).

#### 2.24 `streamlined_tool_use_summary` -- Streamlined tool summary
**NOT HANDLED** (internal ant-only feature).

#### 2.25 `prompt_suggestion` -- Predicted next user prompt
**NOT HANDLED**. Fields: `suggestion`.

#### Events emitted by print.ts that are NOT in SDKMessageSchema (filtered out):
- `control_response` -- we handle
- `control_request` -- we handle
- `control_cancel_request` -- we handle
- `keep_alive` -- we don't handle (ignored by stdin protocol)

### Summary of unhandled NDJSON events (ordered by impact):

| Event | Impact if Missing |
|-------|------------------|
| `result.total_cost_usd` | Cannot show USD cost to user |
| `result.permission_denials` | Cannot show what was denied |
| `result.modelUsage` | Cannot break down cost by model |
| `result.structured_output` | Cannot return structured output |
| `system/files_persisted` | Cannot notify file persistence |
| `system/elicitation_complete` | Cannot track MCP elicitation |
| `system/local_command_output` | Missing slash command output |
| `system/post_turn_summary` | Missing post-turn metadata |
| `system/init.session_id` | **Critical** -- cannot get session ID from init event |
| `system/init.cwd` | Cannot verify working directory |
| `prompt_suggestion` | Missing predictive prompts |

---

## Section 3: Stdin Control Protocol

The CLI reads NDJSON lines from stdin. Messages are defined in `StdintMessageSchema` (controlSchemas.ts:655).

### Messages the CLI accepts on stdin:

#### 3.1 `user` (SDKUserMessage)
Send a user message mid-stream. Useful for multi-turn conversations in `--input-format=stream-json`.
We DO NOT use this currently.

#### 3.2 `control_request` (SDKControlRequest)
Wrapper for all control operations. Inner schema: `SDKControlRequestInnerSchema` union.

| Subtype | We Support? | Notes |
|---------|-------------|-------|
| `initialize` | **NO** | Session init with hooks, MCP, agents, jsonSchema |
| `interrupt` | YES | Via `WriteInterrupt()` |
| `can_use_tool` | **PARTIAL** | We auto-approve via `DefaultPermissionHandler` |
| `set_permission_mode` | YES | Via `WriteSetPermissionMode()` |
| `set_model` | YES | Via `WriteSetModel()` |
| `set_max_thinking_tokens` | **NO** | Set max thinking tokens at runtime |
| `mcp_status` | **NO** | Get MCP server status |
| `get_context_usage` | **NO** | Get context window breakdown |
| `hook_callback` | **NO** | Deliver hook callback |
| `mcp_message` | **NO** | Send JSON-RPC to MCP server |
| `rewind_files` | **NO** | Rewind files to message |
| `cancel_async_message` | **NO** | Cancel pending message |
| `seed_read_state` | **NO** | Seed read file cache |
| `mcp_set_servers` | **NO** | Replace MCP servers dynamically |
| `reload_plugins` | **NO** | Reload plugins from disk |
| `mcp_reconnect` | **NO** | Reconnect MCP server |
| `mcp_toggle` | **NO** | Enable/disable MCP server |
| `stop_task` | YES | Via `WriteStopTask()` |
| `apply_flag_settings` | **NO** | Merge settings at runtime |
| `get_settings` | **NO** | Get effective settings |
| `elicitation` | **NO** | Response to MCP elicitation |

#### 3.3 `control_response` (SDKControlResponse)
Response to a `control_request` sent on stdout. We DO handle this (it's the permission response).

#### 3.4 `keep_alive` (SDKKeepAliveMessage)
Heartbeat. Silently ignored by structuredIO.ts. We don't need to send these.

#### 3.5 `update_environment_variables`
Update env vars at runtime. Used by bridge for auth token refresh. We DON'T need to send this.

### Messages the CLI sends on stdout (control protocol):

| Type | We Handle? | Notes |
|------|-----------|-------|
| `control_request` | YES | Permission prompts, elicitation, hook callbacks, etc. |
| `control_response` | Ignored | These are responses to our stdin requests |
| `control_cancel_request` | Ignored | CLI cancels a pending request |

### Critical Gap: Permission bridging

Our `DefaultPermissionHandler` auto-approves all tools. A proper integration should:
1. On `can_use_tool` control_request from stdout: emit `permission_requested` event to Desktop
2. Wait for Desktop's `permission_decided` response (via event bus subscription or callback)
3. Write the appropriate `control_response` to stdin

Currently, the `EventEmittingPermissionHandler` emits the event AND auto-approves immediately (no waiting). This is a synchronous fire-and-forget pattern that does not actually bridge to Desktop's approval UI.

---

## Section 4: Adapter Gaps (Ordered by Impact)

### P0 -- Critical

1. **`--max-thinking-tokens` is deprecated**: We pass `--max-thinking-tokens` which is hidden and deprecated. Should use `--thinking <mode>` instead. This likely breaks on Opus 4.6+ models. See `main.tsx` line 976 and `src/utils/thinking.ts`.

2. **Cannot get session ID from init event**: We parse `system/init` but don't extract `session_id` from it. This means AgentHub cannot track the actual Claude Code session ID. Without it, `--resume` and session continuity break.

3. **Permission approval is not bridged**: Permission requests are auto-approved synchronously. Desktop has no chance to display an approval dialog and wait for user input. The `can_use_tool` control protocol supports a proper request-response pattern that we are not using.

### P1 -- High Impact

4. **Missing `--json-schema` for structured output**: Claude Code supports structured output via `--json-schema` (a JSON Schema string for output validation). This is a key feature for AgentHub agents that need structured responses.

5. **Missing `--system-prompt` and `--append-system-prompt`**: These allow injecting custom system prompts, essential for AgentHub-managed agents with specialized personas.

6. **Missing `--agents` flag for custom agents**: AgentHub-managed agents should be injectable as custom subagents via `--agents <json>`. The JSON format is a record of `AgentDefinition` objects per `AgentDefinitionSchema`:
   ```json
   {
     "reviewer": {
       "description": "Reviews code",
       "prompt": "You are a code reviewer",
       "tools": ["Read", "Grep", "Glob"],
       "model": "sonnet"
     }
   }
   ```

7. **Missing `--mcp-config` for server injection**: AgentHub-managed MCP servers cannot be injected.

8. **Missing `--session-id` flag**: Cannot explicitly set the session ID, relying on `--resume` which may not always be appropriate.

9. **Missing `--max-budget-usd`**: Cannot cap API spending per run.

10. **Missing `--allowedTools`**: Cannot restrict which tools an agent can use.

### P2 -- Medium Impact

11. **Missing system/init fields**: `session_id`, `cwd`, `slash_commands`, `skills`, `plugins`, `agents`, `apiKeySource`, `betas` -- all useful for client-side rendering.

12. **Missing result fields**: `total_cost_usd`, `permission_denials`, `modelUsage`, `structured_output`, `duration_api_ms`, `stop_reason`, `fast_mode_state`, `uuid`, `session_id`.

13. **Missing `--fallback-model`**: Automatic fallback when primary model is overloaded.

14. **Missing `--no-session-persistence`**: Useful for ephemeral runs.

15. **Missing `--settings` flag**: Cannot inject settings JSON for this specific run.

16. **Missing `--include-hook-events`**: Cannot observe hook lifecycle events.

17. **Missing advanced stdin control requests**: `mcp_status`, `get_context_usage`, `mcp_set_servers`, `mcp_reconnect`, `get_settings`, `apply_flag_settings` -- these enable runtime configuration changes.

18. **Unhandled NDJSON events**: `files_persisted`, `elicitation_complete`, `local_command_output`, `post_turn_summary`, `prompt_suggestion`.

### Out of Scope (for now)

19. `--sdk-url`, `--worktree`, `--tmux`, `--ide`, `--chrome`, `--file`, `--bare`, `--plugin-dir`, `--allow-dangerously-skip-permissions`.

---

## Section 5: Recommended Changes

### 5.1 Fix `--max-thinking-tokens` (P0)

**File**: `edge-server/internal/adapters/claude_code.go`, lines 84-90

Replace:
```go
// Reasoning effort & thinking budget
if ctx.ReasoningEffort != "" {
    effort := ResolveReasoningEffort("claude-code", ctx.ReasoningEffort)
    args = append(args, "--effort", effort)
}
if ctx.MaxThinkingTokens > 0 {
    args = append(args, "--max-thinking-tokens", fmt.Sprintf("%d", ctx.MaxThinkingTokens))
}
```

With:
```go
// Reasoning effort (--effort)
if ctx.ReasoningEffort != "" {
    effort := ResolveReasoningEffort("claude-code", ctx.ReasoningEffort)
    args = append(args, "--effort", effort)
}

// Thinking mode (--thinking) replaces deprecated --max-thinking-tokens
if ctx.ThinkingMode != "" {
    args = append(args, "--thinking", ctx.ThinkingMode) // "enabled", "adaptive", "disabled"
} else if ctx.MaxThinkingTokens > 0 {
    // Fallback: use --thinking enabled for budget token support
    args = append(args, "--thinking", "enabled")
}
```

The `--thinking` flag is the current way to control extended thinking. `enabled` is equivalent to `adaptive` internally.

### 5.2 Extract `session_id` from init event (P0)

**File**: `edge-server/internal/adapters/parser_ndjson.go`, function `parseLine`

Add to `claudeSDKMessage`:
```go
SessionID string `json:"session_id,omitempty"`
```

In `emitSessionInit`, include `session_id` in the payload. Also expose it so the run manager can store it for later `--resume` calls.

### 5.3 Implement permission bridging (P0)

**File**: `edge-server/internal/adapters/control_protocol.go`

Replace `DefaultPermissionHandler.handleCanUseTool` to:
1. Emit `permission_requested` event with request_id, tool_name, input, tool_use_id
2. Wait for a response via a channel/callback mechanism
3. Write the `control_response` only after receiving the decision

This requires a bidirectional event bridge between the adapter and Desktop's approval UI. The `EventEmitter` interface may need a `RequestResponse` method or a separate approval channel.

### 5.4 Add `--json-schema` support (P1)

**File**: `edge-server/internal/adapters/claude_code.go`

Add:
```go
if ctx.StructuredOutputSchema != "" {
    args = append(args, "--json-schema", ctx.StructuredOutputSchema)
}
```

### 5.5 Add system prompt injection (P1)

**File**: `edge-server/internal/adapters/claude_code.go`

Add:
```go
if ctx.SystemPrompt != "" {
    args = append(args, "--system-prompt", ctx.SystemPrompt)
}
if ctx.AppendSystemPrompt != "" {
    args = append(args, "--append-system-prompt", ctx.AppendSystemPrompt)
}
```

### 5.6 Add `--agents` for custom agent injection (P1)

**File**: `edge-server/internal/adapters/claude_code.go`

The `--agents` flag accepts a JSON object mapping agent names to `AgentDefinition` objects:
```go
if len(ctx.AgentDefinitions) > 0 {
    agentsJSON, err := json.Marshal(ctx.AgentDefinitions)
    if err == nil {
        args = append(args, "--agents", string(agentsJSON))
    }
}
```

This maps to `RunProcessContext.AgentDefinitions map[string]AgentDefinition`.

### 5.7 Add `--mcp-config` support (P1)

**File**: `edge-server/internal/adapters/claude_code.go`

```go
if ctx.MCPConfig != "" {
    args = append(args, "--mcp-config", ctx.MCPConfig)
}
```

### 5.8 Add `--session-id` flag (P1)

```go
if ctx.SessionID != "" {
    // Use --session-id for explicit ID assignment instead of only --resume
    args = append(args, "--session-id", ctx.SessionID)
}
```

Current code uses `--resume` for session ID, but `--session-id` is the flag for setting a specific ID.

### 5.9 Add missing control requests (P2)

Add support for additional stdin control messages:
- `set_max_thinking_tokens` -- runtime thinking config
- `mcp_status` -- query MCP servers
- `get_context_usage` -- context window breakdown
- `mcp_set_servers` -- dynamic MCP config
- `get_settings` / `apply_flag_settings` -- runtime settings

### 5.10 Add missing result fields to parser (P2)

Add to `claudeSDKMessage` and `parseResult`:
- `total_cost_usd` (float64)
- `duration_api_ms` (int64)
- `stop_reason` (string)
- `permission_denials` ([]any)
- `modelUsage` (map[string]ModelUsage)
- `structured_output` (any)
- `uuid` / `session_id` (strings)

### 5.11 Context for RunProcessContext additions needed

To support the above changes, `RunProcessContext` (in `runnerctx`) needs:
```go
type RunProcessContext struct {
    // existing fields...
    ThinkingMode           string                            // "enabled", "adaptive", "disabled"
    StructuredOutputSchema string                            // JSON Schema string
    SystemPrompt           string                            // Override system prompt
    AppendSystemPrompt     string                            // Append to default system prompt
    AgentDefinitions       map[string]AgentDefinition         // --agents JSON
    MCPConfig              string                            // --mcp-config value
}
```
