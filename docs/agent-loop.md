# AgentHub Agent Loop

Date: 2026-05-21

## Runtime Choice

Hub Server, Edge Server and Runner are implemented in **Go**.

TypeScript is used for UI and generated client types only. AgentHub may reference Codex App product ideas, but the backend runtime is Go from P0.

## Local P0 Loop

```text
Desktop UI
  -> Edge Server
  -> Runner
  -> Claude Code / Codex / OpenCode
```

Flow:

1. User creates a Thread.
2. Edge creates a Turn and AgentRun.
3. Edge builds context from project memory, recent Items and current request.
4. Runner creates a worktree for the run.
5. Runner starts the selected CLI Agent.
6. Runner streams stdout/stderr and structured events as Items.
7. Runner detects file changes and creates diff artifacts.
8. Edge indexes artifacts and emits ServerEvents to UI.
9. User reviews diff and approvals.
10. Edge tells Runner to apply or discard the patch/worktree.

## JSON-RPC Direction

AgentHub protocol is schema-first, but runtime communication uses JSON-RPC style request/response/notification envelopes where appropriate.

```text
UI <-> Edge      JSON-RPC over WebSocket
Edge <-> Runner  JSON-RPC over local HTTP/WebSocket/stdio
Edge <-> Hub     JSON-RPC over reverse WSS
Hub <-> Web      JSON-RPC over WebSocket + REST for simple reads
```

P0 can use local WebSocket/HTTP between Edge and Runner, but method names should match the long-term JSON-RPC surface.

## Key Methods

```text
project/list
project/open

thread/create
thread/list
thread/read

turn/start
turn/interrupt
turn/resume

item/subscribe
item/created
item/updated

approval/decide

artifact/list
artifact/read
artifact/apply
artifact/discard

runner/list
runner/status

hub/connect
hub/sync
```

## Go Service Boundaries

Edge owns:

- Project / Thread / Turn metadata.
- Context building.
- Approval policy decisions.
- Runner selection.
- Artifact index.

Runner owns:

- CLI process lifecycle.
- Worktree lifecycle.
- Raw logs.
- Diff generation.
- Preview process lifecycle.

Hub owns:

- Remote delivery.
- Sync.
- Relay.
- Cloud/Web conversation authority.
