# Researcher 2: codex exec JSONL -- Complete Event & Item Type Schema

> Source: `codex-rs/exec/src/exec_events.rs` (318 lines, authoritative schema)

## 2.1. Top-Level Event Types (JSONL "type" discriminator)

The `--json` flag outputs one JSON object per line. The top-level `type` field determines the event:

| Event Type | Description | Adapter Event Emitted |
|------------|-------------|-----------------------|
| `thread.started` | Emitted first; contains thread_id | `BusEventSessionInit` (mapped) |
| `turn.started` | Turn begins (new prompt processing) | `BusEventSessionStateChanged` (state=busy) |
| `turn.completed` | Turn finished successfully; contains `usage` | `BusEventResult` (success:true + usage) |
| `turn.failed` | Turn failed; contains `error` | `BusEventResult` (success:false + error) |
| `item.started` | New item added, in-progress state | `dispatchItemStarted` by item type |
| `item.updated` | Existing item updated | `dispatchItemUpdated` by item type |
| `item.completed` | Item reached terminal state | `dispatchItemCompleted` by item type |
| `error` | Unrecoverable stream error; contains `message` | `BusEventResult` (success:false) |

### Event payloads

```typescript
// thread.started
{ "type": "thread.started", "thread_id": "<uuid>" }

// turn.started
{ "type": "turn.started" }

// turn.completed
{
  "type": "turn.completed",
  "usage": {
    "input_tokens": 1234,
    "cached_input_tokens": 0,
    "output_tokens": 567,
    "reasoning_output_tokens": 89
  }
}

// turn.failed
{
  "type": "turn.failed",
  "error": { "message": "error description" }
}

// item.started, item.updated, item.completed all have the same shape:
{ "type": "item.started", "item": { "id": "...", "type": "...", ... } }

// error
{ "type": "error", "message": "unrecoverable error" }
```

## 2.2. ThreadItemDetails -- Item Types (discriminator: "type")

Every item has `id: String` and `type: String` (snake_case). 9 types:

### 2.2.1. AgentMessage
```json
{
  "id": "item_abc",
  "type": "agent_message",
  "text": "I will now implement the feature..."
}
```
- **Adapter**: Emitted as `BusEventTextBlock` on item.completed ONLY
- **Gap**: No streaming deltas for agent messages (app-server provides `AgentMessageDelta`)

### 2.2.2. Reasoning
```json
{
  "id": "item_reasoning_1",
  "type": "reasoning",
  "text": "I need to first understand the codebase structure..."
}
```
- **Adapter**: Emitted as `BusEventThinking` on item.completed ONLY
- **Gap**: No streaming deltas

### 2.2.3. CommandExecution
```json
{
  "id": "item_cmd_1",
  "type": "command_execution",
  "command": "ls -la",
  "aggregated_output": "total 100\ndrwxr-xr-x ...",
  "exit_code": 0,
  "status": "completed"  // "in_progress" | "completed" | "failed" | "declined"
}
```
- **Adapter**: Tool call (started/updated/completed) as `BusEventToolCall` + `BusEventToolResult`
- **Adapter maps to**: toolName="shell_command"
- **Item.updated**: Contains progressive `aggregated_output` -- we map to `BusEventToolCall(status="in_progress")`

### 2.2.4. FileChange
```json
{
  "id": "item_fc_1",
  "type": "file_change",
  "changes": [
    { "path": "src/main.rs", "kind": "update" }
  ],
  "status": "completed"  // "in_progress" | "completed" | "failed"
}
```
- **PatchChangeKind**: "add" | "delete" | "update"
- **Adapter**: Emitted as `BusEventFileChange` with files array

### 2.2.5. McpToolCall
```json
{
  "id": "item_mcp_1",
  "type": "mcp_tool_call",
  "server": "github",
  "tool": "search_repos",
  "arguments": { "query": "rust" },
  "result": {
    "content": [...],
    "_meta": {...},
    "structured_content": {...}
  },
  "error": { "message": "..." },
  "status": "completed"  // "in_progress" | "completed" | "failed"
}
```
- **Adapter**: Tool call/result with toolName="mcp__{server}__{tool}"
- **Gap**: `mcp_app_resource_uri` field not present in exec events (app-server only)

### 2.2.6. CollabToolCall
```json
{
  "id": "item_collab_1",
  "type": "collab_tool_call",
  "tool": "spawn_agent",       // "spawn_agent" | "send_input" | "wait" | "close_agent"
  "sender_thread_id": "th_xxx",
  "receiver_thread_ids": ["th_yyy"],
  "prompt": "Analyze this file...",
  "agents_states": {
    "th_yyy": { "status": "running", "message": null }
  },
  "status": "completed"  // "in_progress" | "completed" | "failed"
}
```
- **CollabAgentStatus**: "pending_init" | "running" | "interrupted" | "completed" | "errored" | "shutdown" | "not_found"
- **CollabTool**: "spawn_agent" | "send_input" | "wait" | "close_agent"
- **Adapter**: Maps item.started to `BusEventTaskStarted`, item.completed to `BusEventTaskNotification`

### 2.2.7. WebSearch
```json
{
  "id": "item_ws_1",
  "type": "web_search",
  "query": "rust async traits",
  "action": { ... }  // WebSearchAction from protocol/models
}
```
- **Adapter**: Tool call/result as "web_search" with kind="web_search"

### 2.2.8. TodoList
```json
{
  "id": "item_todo_1",
  "type": "todo_list",
  "items": [
    { "text": "Analyze codebase", "completed": true },
    { "text": "Implement feature", "completed": false }
  ]
}
```
- **Adapter**: Emitted as `BusEventToolCall` with toolName="plan" and kind="plan"
- **Note**: Simple checklist, not a rich Plan item. Pure completed/uncompleted toggles.

### 2.2.9. Error
```json
{
  "id": "item_err_1",
  "type": "error",
  "message": "Something went wrong"
}
```
- **Adapter**: Emitted as `BusEventResult` (success:false)

## 2.3. What We Do NOT Handle (Gaps)

### Missing from item.started dispatch
The adapter's `dispatchItemStarted` handles: command_execution, mcp_tool_call, web_search, collab_tool_call, file_change, todo_list.
It does NOT emit anything for: agent_message, reasoning, error items at start time. This is correct -- these types only need completed events.

### Missing from item.updated dispatch
The adapter handles: command_execution, mcp_tool_call, todo_list, file_change.
It does NOT handle updates for: agent_message (text deltas NOT in exec), reasoning (text deltas NOT in exec), web_search (no intermediate updates in exec), collab_tool_call (agent state changes), error.

**Key Gap**: `collab_tool_call` item.updated events (agent state transitions) are NOT handled. When a spawned agent changes state (Running -> Completed), the executor will NOT propagate this.

### Field naming mismatches app-server vs exec
The exec events use snake_case (`collab_tool_call`), while app-server uses camelCase (`CollabAgentToolCall`). Our adapter currently uses snake_case field names in Go structs, which aligns with exec events.

### exec events are BATCH-ONLY
- No streaming text deltas (agent_message text only in completed)
- No streaming reasoning deltas (reasoning text only in completed)
- Command output available only at completed (except via item.updated for aggregated_output)
- MCP results only at completed

## 2.4. Comparison: exec vs app-server Item Types

| Feature | exec (JSONL) | app-server (JSON-RPC) |
|---------|-------------|----------------------|
| AgentMessage deltas | NO (text in completed only) | YES (`AgentMessageDelta`) |
| Reasoning deltas | NO (text in completed only) | YES (`ReasoningTextDelta`, `ReasoningSummaryTextDelta`) |
| Plan deltas | N/A (no Plan item in exec) | YES (`PlanDelta`) |
| Command delta output | YES (item.updated.aggregated_output) | YES (`CommandExecutionOutputDelta`) |
| FileChange delta | NO (changes in completed only) | YES (`FileChangePatchUpdated`) |
| CollabAgent model/reasoning_effort | NO | YES (in CollabAgentToolCall item) |
| DynamicToolCall | NO (not in exec) | YES |
| ImageView/ImageGeneration | NO (not in exec) | YES |
| EnteredReviewMode/ExitedReviewMode | NO (not in exec) | YES |
| ContextCompaction | NO (not in exec) | YES |
| Guardian approval review events | NO (not in exec) | YES (`ItemGuardianApprovalReview*`) |
| Duration tracking (duration_ms) | NO | YES (on CommandExecution, McpToolCall, DynamicToolCall) |
