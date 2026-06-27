# Project Overview

## Scope

This SPEC cleans repository structure, active documentation, archive ownership, scripts, tests, and root evidence artifacts. It does not change product behavior, UI runtime logic, Hub/Edge APIs, or Mobile implementation.

## Current Shape

| Area | Current Finding |
|---|---|
| Active docs | `docs/README.md`, `docs/roadmap.md`, `docs/architecture.md`, `docs/decisions.md`, `docs/architecture/`, `docs/governance/`, and `docs/reference/` are active. |
| Historical docs | Former in-repo history trees were copied to the external TokenDance docs archive; AgentHub now keeps only `docs/history.md`. |
| ADR | Old ADR bodies are archived externally; AgentHub keeps `docs/decisions.md` as the current compact summary. Code comments may keep ADR ID tags. |
| Scripts | Root `scripts/` keeps only `dev/`, `lib/`, `release/`, `smoke/`, and `verify/`; old wrapper references were migrated to categorized paths. |
| Tests | Root `tests/` has `fixtures/` and the script contract target `contract/scripts/`; release-readiness triggers on `tests/contract/scripts/**`. |
| Root artifacts | Former root `css-audit-results.json` was archived externally as one-off CSS audit evidence and removed from AgentHub source root. |
| External archive target | `D:\Code\TokenDance\docs` is an independent Git repo; writes use isolated worktrees because the main checkout can be dirty. History/ADR/root-evidence archives are under `archive/agenthub/`. |
| GitHub mode | `GITHUB_STANDARD`; `gh project` lacks `read:project` scope, so no project board. |

## Implementation Boundaries

- Baseline branch: `dev/delicious233`.
- Worktrees: project-local `.worktrees/` for AgentHub; external docs archive work uses isolated worktrees under `D:\Code\TokenDance\.worktrees\`.
- No bulk delete before reference graph and verifier updates.
- Mobile deep UI/native work is out of scope.
- `real_tested=false` remains required for stubbed/fixture/readiness-only evidence.
