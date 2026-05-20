# Codex App Reference For AgentHub

Date: 2026-05-21

## How AgentHub Uses This Reference

Codex App is a product and architecture reference for local coding-agent command centers.

AgentHub should learn from:

- App Server protocol layer.
- Thread / Turn / Item stream model.
- worktree isolation.
- reviewable diffs.
- approvals.
- skills / AGENTS.md / context construction.

AgentHub should not copy:

- single-agent-only assumptions.
- OpenAI-only ecosystem assumptions.
- local-only product boundary.

## Mapping

```text
Codex App:
Project -> Thread -> Turn -> Item

AgentHub:
Project -> Conversation -> Thread -> Turn -> Item -> Artifact
             ^
             IM / group / @Agent
```

## Difference

AgentHub adds:

- Claude Code / Codex / OpenCode adapters.
- IM group and `@Agent` interaction.
- Orchestrator.
- Hub sync and relay.
- Desktop / Cloud / Lab Edge nodes.
- `.agenthub/` project memory.

## Runtime Constraint

Even though the reference product may use its own app-server implementation, AgentHub implements Hub, Edge and Runner in Go.
