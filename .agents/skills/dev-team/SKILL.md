---
name: dev-team
description: Use when a task needs multiple teams, multiple subagents, or parallel workstreams coordinated by one main Agent.
---

# Dev Team

## Overview

Use this skill to run a parallel engineering team inside AgentHub. It defines the coordination pattern only; it does not bind the project to any specific model, provider, or local alias.

The main Agent owns context, decomposition, dispatch, review, integration, and final verification. Team Leaders and Workers take narrow, bounded slices.

## When To Use

- A task naturally splits across independent modules or workstreams.
- Several audits, fixes, tests, or docs updates can run in parallel.
- A main Agent needs to coordinate multiple teams without mixing write scopes.
- Review and integration risk is higher than single-agent execution.
- The user asks to increase subagent or team parallelism.

## Operating Model

1. Define the objective and acceptance checks before dispatch.
2. Split work by ownership boundary: backend, frontend, desktop, mobile, docs, tests, security, or another clear module.
3. Prefer enough teams to keep independent work moving in parallel, but only after file ownership is clear.
4. Give each team a write scope that does not overlap with another team.
5. Ask each Worker to report files changed, checks run, risks, and open questions.
6. The main Agent reviews every Worker result before integrating it.
7. Merge or apply changes in a controlled order, then run the smallest meaningful verification set.
8. Clean up stale or completed agents, branches, worktrees, notes, and handoff files when they are no longer needed.

## Planning Rules

- Write a short team map before dispatch: team name, goal, allowed write scope, forbidden files, and required checks.
- Use directories or explicit file lists as ownership boundaries. If two teams need the same file, split the task differently or serialize that part.
- Use separate worktrees or branches when multiple write teams could collide, generated files are involved, or the current tree is dirty.
- Keep read-only review teams separate from write teams. Review teams can inspect broad areas, but they must not edit files unless reassigned.
- Do not dispatch open-ended cleanup. Every Worker needs a bounded result and a concrete stopping condition.

## Dispatch Template

```text
Goal:
Allowed write scope:
Required reading:
Checks to run:
Do not touch:
Report back with:
- summary
- files changed
- verification
- risks or blockers
```

## Worker Rules

- Workers must stay inside the assigned write scope.
- Workers must stop and report back if a fix requires files outside scope, contract changes, secret handling, or production/runtime assumptions.
- Workers must not revert unknown changes. They should adapt to current files and report conflicts.
- Each Worker must run at least one relevant verification command or explain why it could not run.
- Each Worker report must include changed files, commands, results, residual risk, and any follow-up needed from the main Agent.

## Integration Rules

- Review every Worker diff before accepting it.
- Integrate small batches, then run focused checks before taking another batch.
- Treat non-trivial merge conflicts as a planning failure: stop, identify which scopes overlapped, resolve deliberately, and update the team map.
- Keep default CI free of local machine credentials, private paths, provider-specific auth assumptions, and model-consuming real CLI checks.
- Do not turn read-only audit findings into code changes until the main Agent assigns a write scope.

## Boundaries

- Do not dispatch two teams to edit the same files at the same time.
- Do not let Workers expand scope silently; they must hand back scope changes to the main Agent.
- Do not merge Worker output that the main Agent has not reviewed.
- Do not remove another active Agent's new feature, generated state, branch, or worktree unless the owner explicitly confirms it is obsolete.
- Do not commit generated artifacts, local databases, logs, coverage output, deploy bundles, screenshots, or private handoff dumps.
- Keep project skills portable: do not embed machine-specific paths, credentials, IPs, local account names, or private environment details.

## Relation To Other Skills

- Use `dev-loop` for long-running single-track iteration.
- Use `dev-team` when parallelism and team coordination are the main need.
- Use a more specific project skill when the task is limited to a known area such as testing, adapter development, or environment sandboxing.
