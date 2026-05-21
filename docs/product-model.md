# AgentHub Product Model

Date: 2026-05-21

## Positioning

AgentHub combines:

```text
Codex-App-style local agent command center
+ Multica-style managed agent lifecycle
+ IM-style multi-agent collaboration
+ Hub-Edge-Runner network topology
```

Codex App is a reference for local coding-agent product mechanics: project threads, turns, items, worktree isolation, diff review, approvals and context construction. Multica is the highest-priority reference for agent identity, runtime registration, task lifecycle, progress reporting, blocker reporting, skills and team operations. AgentHub keeps the local command-center experience, adds managed agent lifecycle, then puts the main interaction into multi-agent IM and Hub networking.

## Reference Priority

| Reference | Use For | Boundary |
|---|---|---|
| ByteDance brief | Product requirement authority: IM, group chat, `@Agent`, Orchestrator and deliverable records | Competition material is authoritative for the product scenario |
| Multica | Agent as teammate, agent profile, runtime/daemon lifecycle, task queue, progress/blocker reporting, skills, polished frontend structure | Do not become Issue/Board-first; AgentHub starts from Conversation / Thread / Artifact |
| Codex App | Local command-center mechanics: thread, turn, item, worktree, diff, approval, context | Do not lock to one agent ecosystem |
| Emdash / Orca / Jean | Desktop workbench, worktree, remote machine, diff/preview, mobile control | Use as workflow references, not product positioning |

## Product Layers

### 1. Desktop Command Center

P0/P1 core.

Responsibilities:

- local project management
- project threads
- AgentRun lifecycle
- agent profile and runtime status
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
- progress / blocker cards in the conversation
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
