# AgentHub Product Model

Date: 2026-05-21

## Positioning

AgentHub combines:

```text
Codex-App-style local agent command center
+ IM-style multi-agent collaboration
+ Hub-Edge-Runner network topology
```

Codex App is a reference for local coding-agent product mechanics: project threads, turns, items, worktree isolation, diff review, approvals and context construction. AgentHub keeps that local command-center experience, then adds multi-agent IM and Hub networking.

## Product Layers

### 1. Desktop Command Center

P0/P1 core.

Responsibilities:

- local project management
- project threads
- AgentRun lifecycle
- Runner execution
- worktree isolation
- diff review
- apply / discard
- approval cards
- preview
- `.agenthub/AGENTS.md` and project rules

### 2. IM Collaboration

P1/P2 enhancement.

Responsibilities:

- direct chat
- group chat
- `@Agent`
- Orchestrator
- multi-agent review
- multiple turns in one thread
- multiple agents discussing one artifact

### 3. Hub Network

P2/P3/P4 long-term layer.

Responsibilities:

- auth
- friends
- groups
- multi-device sync
- Edge relay
- Cloud Edge
- team memory
- permission audit

## Product Statement

```text
AgentHub Desktop is a Go-based local multi-agent command center.
AgentHub Hub is the IM, sync, relay and team collaboration extension.
```

P0 should feel like a mature local coding-agent workstation, not just a chat bot.
