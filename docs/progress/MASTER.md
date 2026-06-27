# Repo Structure Doc Tooling Cleanup - Progress Tracker

> **Task**: Converge AgentHub repo docs, archives, scripts, tests, and root evidence artifacts into a clean current-source layout.
> **Started**: 2026-06-28
> **Last Updated**: 2026-06-28
> **Mode**: GITHUB_STANDARD
> **Repo**: TokenDanceLab/AgentHub
> **Baseline**: `dev/delicious233`

## References

- [Initial SPEC](../plan/repo-structure-doc-tooling-cleanup-spec.md)
- [Project Overview](../analysis/project-overview.md)
- [Module Inventory](../analysis/module-inventory.md)
- [Risk Assessment](../analysis/risk-assessment.md)
- [Task Breakdown](../plan/task-breakdown.md)
- [Dependency Graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)

## GitHub Resources

- Tracking mode: `GITHUB_STANDARD`; no project board because the current token lacks project scope.
- All issues: `gh issue list -R TokenDanceLab/AgentHub --label "spec:repo-structure-doc-tooling-cleanup" --state all`

## Milestones

| Phase | Milestone | URL | Open | Closed |
|---|---|---|---:|---:|
| 1 | Design and Reference Graph Baseline | https://github.com/TokenDanceLab/AgentHub/milestone/12 | 0 | 2 |
| 2 | Docs Archive and ADR Migration | https://github.com/TokenDanceLab/AgentHub/milestone/13 | 1 | 1 |
| 3 | Scripts and Tests Wrapper Migration | https://github.com/TokenDanceLab/AgentHub/milestone/14 | 2 | 0 |
| 4 | Final Wrapper and Root Hygiene Cleanup | https://github.com/TokenDanceLab/AgentHub/milestone/15 | 1 | 0 |
| 5 | Acceptance and SPEC Archive | https://github.com/TokenDanceLab/AgentHub/milestone/16 | 1 | 0 |

## Phase Checklist

- [x] Phase 1: Design and Reference Graph Baseline (2/2 tasks)
- [ ] Phase 2: Docs Archive and ADR Migration (1/2 tasks)
- [ ] Phase 3: Scripts and Tests Wrapper Migration (0/2 tasks)
- [ ] Phase 4: Final Wrapper and Root Hygiene Cleanup (0/1 tasks)
- [ ] Phase 5: Acceptance and SPEC Archive (0/1 tasks)

## Issue Mapping

| Task ID | Issue | Status |
|---|---|---|
| T1.1 | #360 | closed |
| T1.2 | #361 | closed |
| T2.1 | #362 | closed |
| T2.2 | #363 | in progress |
| T3.1 | #364 | pending |
| T3.2 | #365 | pending |
| T4.1 | #366 | pending |
| T5.1 | #367 | pending |

## Current Status

**Active Phase**: Phase 2 - Docs Archive and ADR Migration

**Active Task**: #363 / T2.2 - Compress old ADR bodies into `docs/decisions.md`.

**Current Focus**: Remove in-repo ADR bodies after external archive PR #2, keep `docs/decisions.md` as the active decision summary, and update active links/verifiers away from `docs/adr/`.

## Governance Status

**Shared instruction surface**: `AGENTS.md`

**Platform-specific instruction surfaces**: none

**Memory surface**: native Codex memory; no repo fallback selected

## Execution Telemetry

- T1.1 started after previous repo governance SPEC was archived and all its milestones closed.
- Initial reference graph found direct active references to history trees, ADRs, root `scripts/*.ps1|sh`, `tests/scripts/**`, and Desktop readiness script paths.
- T1.1 completed by PR #368; drift 0.
- T1.2 receiver worktree selected: `D:\Code\TokenDance\.worktrees\tokendance-docs-agenthub-archive` on branch `docs/agenthub-archive-receiver`; dirty docs main checkout is not used for writes.
- T1.2 completed by PR #369; drift 0. Phase 1 milestone #12 is closed.
- T2.1 external archive commit: TokenDanceLab/docs merge commit `8417e00b` (source commit `e94cb7d`) on PR #1, containing former AgentHub history trees under `archive/agenthub/repo/docs/`.
- T2.1 completed by PR #370; drift 0. T2.2 external ADR archive commit: TokenDanceLab/docs merge commit `50c360e` (source commit `4fe876b`) on PR #2, containing old ADR bodies under `archive/agenthub/repo/docs/adr/`.

## Quick Status Commands

```powershell
gh issue list -R TokenDanceLab/AgentHub --label "spec:repo-structure-doc-tooling-cleanup" --state all
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.title | startswith("Repo Structure Cleanup")) | "\(.title): \(.open_issues) open, \(.closed_issues) closed"'
git status --short --branch
git worktree list
```
