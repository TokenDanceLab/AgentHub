---
name: dev-loop
description: Use when AgentHub work is long-running, cross-file, multi-agent, worktree-based, or needs repeated implementation, review, verification, documentation, and progress synchronization.
---

# Dev Loop

Long-running AgentHub work uses a loop: read current governance, choose the next scoped slice, implement, review, verify, record progress, and push. Short one-file fixes do not need this skill.

## Canonical State

Read these before acting:

1. `AGENTS.md`
2. `docs/progress/MASTER.md` when it exists
3. `docs/roadmap.md` and affected `docs/architecture/*`
4. The relevant issue or PR

Do not create a second roadmap or state file. Active spec-driven work lives in `docs/progress/MASTER.md`; long-term product direction lives in `docs/roadmap.md`.

## Loop

1. Define the narrow task slice, allowed paths, forbidden paths, and evidence gates.
2. Use a worktree only for parallel or risky branch work; small documentation or focused fixes can stay on the current branch.
3. For subagents, pass only the needed files, allowed write scope, forbidden scope, verification commands, and expected report format.
4. Review every subagent result before integrating it.
5. Run the smallest useful gates first, then broader gates when the change affects shared behavior.
6. Update `docs/progress/MASTER.md`, the issue/PR, and affected architecture/roadmap docs in the same pass.
7. Commit and push small verified changes.

## Agent Routing

Do not hard-code provider names or local aliases in task cards. Assign work by capability:

| Need | Route |
|---|---|
| Architecture, security, or high-risk tradeoff | strongest reasoning agent available |
| Narrow Go/TypeScript implementation | focused coding agent with small file set |
| Large read-only survey or documentation synthesis | long-context read-only agent |
| UI/Visual QA | browser/screenshot-capable agent plus Playwright evidence |
| Fast sanity check | lightweight review agent |

## Review Dimensions

- Structure: ownership, file placement, dead code, dependency direction.
- Tests: unit, API, Playwright, Visual QA, smoke, performance/leak gates as applicable.
- Security: secrets, tokens, generated artifacts, auth/authorization boundaries.
- Architecture: API contracts, Hub/Edge/Desktop/Web boundaries, package evidence boundaries.
- UX: transcript cleanliness, ordering, scrolling, visible states, responsive geometry.
- Docs: `AGENTS.md`, `docs/architecture.md`, `docs/roadmap.md`, and active `docs/progress/MASTER.md`.

## Boundaries

- Real E2E, approved-real, packaged Desktop, login, model/API spend, performance, or leak claims must use `.agents/skills/real-e2e-acceptance/SKILL.md`.
- Do not weaken CI, lower thresholds, skip required checks, or relabel stubbed evidence as real.
- Do not resurrect archived project skills from `docs/archives/project-skills/`.
- Do not put local secrets, hostnames, absolute private paths, or agent runtime state into project docs.

## References

- `references/model-strategy.md` records provider-agnostic routing rules.
- `references/review-checklist.md` is the concise review checklist.
