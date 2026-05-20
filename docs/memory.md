# AgentHub Memory And Context

Date: 2026-05-21

## Principle

AgentHub uses `.agenthub/` as human-readable project memory and context input.

P0 uses deterministic file loading. Retrieval and vector search can come later.

## Project Layout

```text
.agenthub/
  PROJECT.md
  ARCHITECTURE.md
  RULES.md
  AGENTS.md
  DECISIONS.md
  SKILLS/
    frontend-review.md
    diff-review.md
    static-deploy.md
```

## Context Builder

Before calling an Agent, Edge builds context from:

```text
System Prompt
+ Agent Profile
+ .agenthub/AGENTS.md
+ .agenthub/RULES.md
+ relevant SKILLS
+ current Project
+ current Thread summary
+ recent Items
+ current workspace state
+ current user request
```

## P0 Scope

P0 loads:

- `.agenthub/AGENTS.md`
- `.agenthub/RULES.md`
- current Thread recent Items
- current diff / changed files when available

P1 can add:

- Thread summaries
- pinned messages
- memory update suggestions
- skill selection

## Write Rule

Automatic memory writes should produce a suggestion card first. Confirmed writes update the Memory Authority owner.
