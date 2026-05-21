# AgentHub Implementation Plan

Date: 2026-05-21

## Runtime Constraint

Hub Server, Edge Server and Runner are Go services from P0.

No Node.js backend prototype is planned. TypeScript is used for UI and generated protocol types.

## P0: Desktop Local Command Center

Goal:

```text
Desktop UI -> Local Edge Server -> Local Runner -> Claude Code / Codex
```

Must demonstrate:

- Project list.
- Thread list.
- One Thread starts one AgentRun.
- Agent profile and runtime status are visible before a run starts.
- Runner starts Claude Code or Codex CLI.
- stdout/stderr streamed as Items.
- git worktree isolation.
- changed-file detection.
- Diff viewer.
- Apply / Discard patch.
- Approval card.
- Progress, blocker and error cards in the Thread.
- `.agenthub/AGENTS.md` context.

Not in P0:

- Friends.
- Full group chat.
- Mobile client.
- Hub Relay.
- Cloud Edge.
- Multi-tenant permissions.
- Plugin marketplace.

## P1: Multi-Agent Thread

Goal:

```text
One Thread, multiple Agent Turns.
```

Add:

- `@ClaudeCode` implement.
- `@Codex` review.
- `@OpenCode` alternative plan.
- Orchestrator summary.
- Reviewer reads diff artifact.

## P2: Edge-Hub Sync

Goal:

```text
Edge <-> Hub
Web/Mobile -> Hub status view
```

Add:

- Hub Server.
- Edge registration.
- Device online/offline.
- EdgeEvent sync.
- Artifact metadata sync.
- Conversation summary sync.
- remote approval from Web/Mobile.

## P3: Hub Relay And Cloud Edge

Goal:

```text
Web/Mobile -> Hub -> Desktop/Cloud Edge -> Runner
```

Add:

- Hub Relay.
- Cloud Edge.
- Cloud Runner.
- permission audit.
- remote run start.
- Preview Hub Proxy.

## P4: Full IM Collaboration

Goal:

```text
team IM + multi-agent collaboration
```

Add:

- users.
- friends.
- groups.
- team spaces.
- agent contacts.
- full multi-device sync.
- team memory.
- organization permissions.
