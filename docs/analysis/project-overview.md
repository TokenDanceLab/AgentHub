# Project Overview

## Scope

This SPEC cleans repository structure, active documentation, archive ownership, scripts, tests, and root evidence artifacts. It does not change product behavior, UI runtime logic, Hub/Edge APIs, or Mobile implementation.

## Current Shape

| Area | Current Finding |
|---|---|
| Active docs | `docs/README.md`, `docs/roadmap.md`, `docs/architecture.md`, `docs/architecture/`, `docs/governance/`, `docs/reference/`, and `docs/adr/` are active. |
| Historical docs | Former in-repo history trees were copied to the external TokenDance docs archive; AgentHub now keeps only `docs/history.md`. |
| ADR | `docs/adr/` has 16 ADR body files plus `README.md`; several code comments still mention ADR IDs. |
| Scripts | Root `scripts/` has many direct CI, docs, package, Desktop, and test references; `scripts/evidence/` and `scripts/git-hooks/` already exist. |
| Tests | Root `tests/` currently has `fixtures/` and `scripts/`; release-readiness triggers on `tests/scripts/**`. |
| Root artifacts | `css-audit-results.json` is tracked at repo root and appears to be one-off CSS audit evidence. |
| External archive target | `D:\Code\TokenDance\docs` is an independent Git repo and currently dirty. Receiver worktree: `D:\Code\TokenDance\.worktrees\tokendance-docs-agenthub-archive` on `docs/agenthub-archive-receiver`. |
| GitHub mode | `GITHUB_STANDARD`; `gh project` lacks `read:project` scope, so no project board. |

## Implementation Boundaries

- Baseline branch: `dev/delicious233`.
- Worktrees: project-local `.worktrees/` for AgentHub; external docs archive work uses `D:\Code\TokenDance\.worktrees\tokendance-docs-agenthub-archive`.
- No bulk delete before reference graph and verifier updates.
- Mobile deep UI/native work is out of scope.
- `real_tested=false` remains required for stubbed/fixture/readiness-only evidence.
