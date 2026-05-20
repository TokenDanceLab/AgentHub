# AgentHub Edge Server

Edge Server is the control node that runs near projects and runners.

It can run inside Desktop, on a remote machine, or as a headless Cloud Edge.

Runtime: Go.

## Responsibilities

- Local or edge-owned conversations.
- Project registry and workspace roots.
- `.agenthub/` project memory and context building.
- Runner discovery, health and scheduling.
- Artifact metadata index.
- Local API/WebSocket for Desktop UI.
- Hub client for sync, relay and remote commands.
- Permission boundary for local data and Local Runner Fast Path.

## Not Responsible For

- Global account system.
- Global friend/group graph.
- Cloud conversation authority when `authority=hub`.
- Directly executing Agent CLI subprocesses; Runner owns process lifecycle.

## Protocol Surfaces

- UI <-> Edge: local IM, local artifacts, local run control.
- Edge <-> Hub: sync events, relay, heartbeat, delivered commands.
- Edge <-> Runner: `RunnerCommand`, `RunnerEvent`, artifact reads.

## Depends On

- `packages/protocol`
- `packages/transport`
- `packages/im-core`
- `packages/sync-core`
- `packages/memory-core`
- `packages/artifact-core`
