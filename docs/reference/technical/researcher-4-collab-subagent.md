# Researcher 4: Collab/Subagent Deep Dive -- Codex Multi-Agent Model

> Sources: `codex-rs/exec/src/exec_events.rs` (CollabToolCallItem, CollabTool, CollabAgentStatus), `codex-rs/app-server-protocol/src/protocol/v2/item.rs` (CollabAgentToolCall, CollabAgentTool), `codex-rs/core/src/config/mod.rs` (DEFAULT_AGENT_MAX_THREADS=6, DEFAULT_AGENT_MAX_DEPTH=1)

## 4.1. CollabTool Enum (5 tools)

```rust
pub enum CollabTool {
    SpawnAgent,   // Create a new agent thread
    SendInput,    // Send input to an existing agent thread
    ResumeAgent,  // Resume a paused agent thread
    Wait,         // Wait for agent threads to complete
    CloseAgent,   // Close/shutdown an agent thread
}
```

**Note**: The exec JSONL events use `collab_tool_call` (snake_case, 4 tools without ResumeAgent). The app-server protocol uses `CollabAgentToolCall` (camelCase, 5 tools including ResumeAgent). The exec events may not expose ResumeAgent as it was introduced in a newer app-server version.

## 4.2. CollabAgentStatus (7 states)

```rust
pub enum CollabAgentStatus {
    PendingInit,   // Agent created, not yet started
    Running,       // Agent is actively processing
    Interrupted,   // Agent paused by user
    Completed,     // Agent finished successfully (optionally with message)
    Errored,       // Agent failed with error
    Shutdown,      // Agent was closed/terminated
    NotFound,      // Agent thread not found
}
```

The `CollabAgentState` struct carries the status and an optional message:
```rust
pub struct CollabAgentState {
    pub status: CollabAgentStatus,
    pub message: Option<String>,
}
```

## 4.3. CollabToolCallItem -- Complete Schema

### exec JSONL version:
```json
{
  "id": "item_collab_1",
  "type": "collab_tool_call",
  "tool": "spawn_agent",
  "sender_thread_id": "th_main",
  "receiver_thread_ids": ["th_child_1"],
  "prompt": "Please analyze the database schema and report any issues.",
  "agents_states": {
    "th_child_1": { "status": "running", "message": null }
  },
  "status": "completed"
}
```

### app-server protocol version (richer):
```json
{
  "id": "item_collab_1",
  "type": "CollabAgentToolCall",
  "tool": "SpawnAgent",
  "senderThreadId": "th_main",
  "receiverThreadIds": ["th_child_1"],
  "prompt": "Please analyze the database schema...",
  "model": "gpt-5.2-codex",
  "reasoningEffort": "high",
  "agentsStates": {
    "th_child_1": { "status": "Running", "message": null }
  },
  "status": "Completed"
}
```

**Key difference**: app-server protocol includes `model` and `reasoningEffort` fields for specifying the spawned agent's configuration. The exec protocol does NOT include these.

## 4.4. Multi-Agent Lifecycle

### Spawn Flow
1. Main agent issues `SpawnAgent` with a prompt for the child
2. Child agent is created as a new thread (receiver_thread_ids populated with child's thread ID)
3. Child enters `PendingInit` -> `Running` -> `Completed`/`Errored`/`Shutdown`
4. Parent receives `collab_tool_call` item.completed with `agents_states` reflecting final child states

### SendInput Flow
1. Parent agent sends input to a running child agent
2. Child state may be `Running` -> `Interrupted` -> `Running` -> `Completed`
3. Useful for iterative refinement

### Wait Flow
1. Parent agent waits for child agents to complete
2. Child states change independently; parent observes via item events
3. Blocking: parent cannot continue until children reach terminal state

### CloseAgent Flow
1. Parent terminates a child agent
2. Child state transitions to `Shutdown`

### Configuration Constants
```
DEFAULT_AGENT_MAX_THREADS = 6       // Max concurrent agent threads
DEFAULT_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION = 4
DEFAULT_MULTI_AGENT_V2_MAX_WAIT_TIMEOUT_MS = 3600000  // 1 hour
DEFAULT_MULTI_AGENT_V2_DEFAULT_WAIT_TIMEOUT_MS = 30000  // 30 seconds
DEFAULT_AGENT_MAX_DEPTH = 1         // Max nesting depth (no recursive spawns by default)
```

## 4.5. Bridge to AgentHub IM Model

### Conceptual Mapping

| Codex Concept | AgentHub Concept | Notes |
|---------------|------------------|-------|
| Agent Thread | Group Chat Thread | One-to-one: thread_id maps directly |
| Sender Thread | Speaker in group | The agent issuing the collab command |
| Receiver Thread | Target listener(s) | The agent(s) being tasked |
| SpawnAgent | Create sub-group / DM | Could create a dedicated child thread in AgentHub |
| SendInput | Mention / Reply | In-thread message addressed to specific agent |
| Agent State | Participant Status | Running = typing/active, Completed = done |
| agents_states | Status aggregation | Collect and display in group UI |

### Integration Strategy

**Option A: Transparent Passthrough (Phase 2 - Recommended)**
- Let Codex manage its own multi-agent internally via collab_tool_call
- AgentHub acts as a "read-only" observer of Codex's internal multi-agent activity
- Pros: Simple, no breaking changes, leverages Codex's built-in coordination
- Cons: Codex agents don't appear as first-class AgentHub participants

**Option B: AgentHub as Coordinator (Phase 3 - Advanced)**
- Intercept SpawnAgent calls and create real AgentHub threads
- Map Codex's internal thread IDs to AgentHub IM thread IDs
- Each spawned agent becomes a real AgentHub "bot" in the group
- Route SendInput through AgentHub message bus
- Pros: Full IM integration, agents are first-class participants
- Cons: Complex, requires bidirectional state sync

### Current Adapter Mapping

Our `codex.go` maps collab events as follows:
- **item.started (collab_tool_call)** -> `BusEventTaskStarted` with taskId, tool, senderThreadId, receiverThreadIds, description (prompt), status
- **item.completed (collab_tool_call)** -> `BusEventTaskNotification` with taskId, tool, status, agentsStates

**Critical Gap**: item.updated for collab_tool_call is NOT handled. This means:
- Agent state transitions (Running -> Interrupted, Running -> Completed) during the task are invisible
- We only see the final state
- No real-time status updates for spawned agents

### Recommended Adapter Changes
1. **Handle `collab_tool_call` item.updated**: Emit `BusEventTaskNotification` with partial agents_states
2. **Normalize `collab_agent_tool_call` variant**: App-server uses this camelCase name; our adapter expects `collab_tool_call`. Add an alias.
3. **Include model/reasoning_effort in TaskStarted**: Add these fields (available in app-server protocol)
4. **Think about SpawnAgent interception** for Phase 3 AgentHub coordination
