# AgentHub Authority Model

Date: 2026-05-21

## Principle

AgentHub separates ownership of conversations, execution, artifacts and memory.

```text
Conversation Authority = who owns the message/group/thread primary sequence
Execution Authority    = where the task actually runs
Artifact Authority     = where artifact bytes live and who can serve them
Memory Authority       = where durable project/agent/conversation memory is written
```

This prevents double writes when a Hub conversation triggers work on a remote Desktop Edge or Cloud Edge.

## Conversation Authority

```ts
type ConversationAuthority =
  | { type: "edge"; edgeId: string }
  | { type: "hub"; hubId: string }
```

Conversation Authority owns:

- message append order
- group membership changes
- thread creation
- message IDs
- conversation summary checkpoints

### IM Write Rule

#### 1. `authority = edge`

```text
Desktop UI -> Edge -> append message
Edge -> EdgeEvent(message.created)
Edge -> Hub sync copy when online
```

Rules:

- Desktop UI writes messages only to Edge.
- Edge generates the authoritative local message sequence.
- Hub receives a synchronized copy.
- Hub must not rewrite the primary message sequence.

#### 2. `authority = hub`

```text
Web/Mobile/Desktop -> Hub -> append message
Hub -> message.deliver -> Edge cache/execution
```

Rules:

- Web, Mobile and Desktop write messages to Hub.
- Hub generates the global message sequence.
- Edge receives `message.deliver` for local cache and execution.
- Edge must not append competing primary messages for the same conversation.

#### 3. Hub-controlled remote execution

```text
Hub conversation -> Hub message sequence
Hub -> run.start -> target Edge
Edge -> RunnerCommand
Edge -> RunnerEvent -> Hub
Hub -> append status / artifact messages
```

Rules:

- Hub keeps the message primary sequence.
- Edge executes commands and returns events.
- Edge may store local run cache, but Hub owns user-visible message order.

## Execution Authority

```ts
type ExecutionAuthority = {
  edgeId: string
  runnerId: string
  workspaceId: string
}
```

Execution Authority owns:

- workspace root selection
- process lifecycle
- command approval boundary
- runner health
- raw stdout/stderr collection
- local preview process

Execution Authority does not own the IM message sequence unless the same Edge is also Conversation Authority.

## Artifact Authority

```ts
type ArtifactAuthority =
  | { type: "edge"; edgeId: string }
  | { type: "hub-cache"; hubId: string }
  | { type: "object-storage"; bucket: string }
```

Artifact Authority owns artifact bytes. Artifact metadata can be copied to Hub, but large content should remain near the execution node unless explicitly cached.

Rules:

- Runner creates raw logs, diffs, preview references and files.
- Edge indexes artifact metadata and owns local artifact serving.
- Hub may cache small/high-value artifacts.
- Workspace contents are not uploaded by default.

## Memory Authority

```ts
type MemoryAuthority =
  | { type: "project-edge"; edgeId: string; projectId: string }
  | { type: "agent-edge"; edgeId: string; agentId: string }
  | { type: "hub"; hubId: string; scope: "team" | "global" }
```

Rules:

- Project memory under `.agenthub/` is owned by the Edge that owns the project workspace.
- Agent memory can be local to an Edge or synced to Hub depending on agent type.
- Hub owns team/global memory and sync indexes.
- Automatic memory writes should produce a suggestion card first; confirmed writes update the authority owner.

## Authority Matrix

| Scenario | Conversation Authority | Execution Authority | Artifact Authority | Memory Authority |
|---|---|---|---|---|
| Desktop local offline | Local Edge | Local Edge + Runner | Local Edge | Project Edge |
| Desktop local online | Local Edge, Hub sync copy | Local Edge + Runner | Local Edge, optional Hub cache | Project Edge, Hub index |
| Desktop direct remote | Local Edge | Remote Edge + Runner | Remote Edge | Remote Project Edge |
| Desktop relay remote | Local Edge or Hub | Remote Edge + Runner | Remote Edge, Hub proxy | Remote Project Edge |
| Web relay Desktop | Hub | Desktop Edge + Runner | Desktop Edge, Hub proxy/cache | Desktop Project Edge + Hub index |
| Web relay Cloud | Hub | Cloud Edge + Runner | Cloud Edge or object storage | Cloud Project Edge / Hub |

## Implementation Rule

Every `Conversation` should carry `authority`. Every `Run` should carry `executionAuthority`. Every `Artifact` should carry `location` and `authority`.

Without these fields, remote execution and sync will eventually become ambiguous.
