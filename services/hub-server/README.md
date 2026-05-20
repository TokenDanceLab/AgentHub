# AgentHub Hub Server

Hub Server is the central control plane for AgentHub.

Runtime: Go.

## Responsibilities

- Account, login and user identity.
- Friends, contacts, groups and cloud conversations.
- Multi-device sync and message delivery.
- Edge device registration and heartbeat.
- Hub Relay for Web/Mobile and NAT traversal.
- Permission checks, audit records and remote command routing.
- Optional cloud artifact cache and memory index.

## Not Responsible For

- Running Claude Code, Codex or OpenCode directly.
- Reading or writing workspace files directly.
- Owning local project `.agenthub/` memory by default.
- Serving as a replacement for Edge in Desktop offline mode.

## Protocol Surfaces

- UI <-> Hub: Web/Mobile conversations, device status, remote control.
- Edge <-> Hub: reverse WSS registration, sync, relay and command delivery.
- Hub -> Edge: `message.deliver`, `run.start`, `run.stop`, `preview.request`.

## Depends On

- `packages/protocol`
- `packages/im-core`
- `packages/sync-core`
- `packages/artifact-core`
- `packages/memory-core`
