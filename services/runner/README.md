# AgentHub Runner

Runner is the execution node for Agent CLI processes.

Runtime: Go.

## Responsibilities

- Start, monitor and stop Claude Code / Codex / OpenCode processes.
- Manage run workspaces and git worktrees.
- Capture stdout/stderr logs.
- Produce diff, file, preview and log artifacts.
- Start local preview servers.
- Enforce path guards and command approval decisions passed by Edge.

## Not Responsible For

- IM messages, conversations, friends or groups.
- Long-term memory ownership.
- Global permissions or user accounts.
- Remote routing decisions.
- Serving as a public API directly to Web/Mobile.

## Protocol Surfaces

- Edge -> Runner: `run.start`, `run.cancel`, artifact read requests.
- Runner -> Edge: `run.started`, `run.output`, `artifact.created`, `run.finished`.

## Depends On

- `packages/protocol`
- `packages/adapters`
- `packages/artifact-core`
