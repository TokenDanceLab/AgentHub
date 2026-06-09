---
name: dev-team-codex
description: Use when Codex should run an AgentHub project team with a gpt-5.5 Leader and gpt-5.5 Workers.
---

# Dev Team Codex

## Overview

Use this skill for Codex-specific team formation. It specializes the generic `dev-team` pattern with an explicit Leader and Worker lineup.

## Roles

- Leader: `gpt-5.5 xhigh`
  - Understands background, constraints, current repo state, and active worktrees.
  - Decides task split, write scopes, sequencing, and verification.
  - May create multiple Workers when work can proceed safely in parallel.
  - Reviews Worker outputs, integrates changes, and owns the final answer.
- Workers: `gpt-5.5 high`
  - Run bounded implementation, audit, testing, docs, or cleanup tasks.
  - Stay inside the assigned write scope.
  - Report changed files, verification, risks, and blockers.

## Workflow

1. Leader reads the task, current worktree state, relevant project rules, and affected skill or doc.
2. Leader splits work into independent Worker tasks only when write scopes do not overlap.
3. Each Worker prompt includes goal, allowed files or directories, required reading, checks, and explicit non-goals.
4. Workers stop and report back if they need to edit outside scope.
5. Leader reviews every Worker result before accepting it.
6. Leader integrates changes in small batches and verifies the final state.
7. Leader promptly closes old or completed agents so stale context does not keep acting on the repo.

## Safety Rules

- Write scope must be explicit for every Worker.
- Avoid broad cleanup while other Agents are active.
- Do not delete or overwrite another Agent's newly added feature, branch, worktree, note, or generated output without clear evidence it is obsolete.
- Prefer review and integration by the Leader over direct Worker commits to shared branches.
- Keep project skills portable: do not embed machine-specific paths, credentials, IPs, local account names, or private environment details.
