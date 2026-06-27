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
| 1 | Design and Reference Graph Baseline | https://github.com/TokenDanceLab/AgentHub/milestone/12 | 2 | 0 |
| 2 | Docs Archive and ADR Migration | https://github.com/TokenDanceLab/AgentHub/milestone/13 | 2 | 0 |
| 3 | Scripts and Tests Wrapper Migration | https://github.com/TokenDanceLab/AgentHub/milestone/14 | 2 | 0 |
| 4 | Final Wrapper and Root Hygiene Cleanup | https://github.com/TokenDanceLab/AgentHub/milestone/15 | 1 | 0 |
| 5 | Acceptance and SPEC Archive | https://github.com/TokenDanceLab/AgentHub/milestone/16 | 1 | 0 |

## Phase Checklist

- [ ] Phase 1: Design and Reference Graph Baseline (0/2 tasks)
- [ ] Phase 2: Docs Archive and ADR Migration (0/2 tasks)
- [ ] Phase 3: Scripts and Tests Wrapper Migration (0/2 tasks)
- [ ] Phase 4: Final Wrapper and Root Hygiene Cleanup (0/1 tasks)
- [ ] Phase 5: Acceptance and SPEC Archive (0/1 tasks)

## Issue Mapping

| Task ID | Issue | Status |
|---|---|---|
| T1.1 | #360 | in progress |
| T1.2 | #361 | pending |
| T2.1 | #362 | pending |
| T2.2 | #363 | pending |
| T3.1 | #364 | pending |
| T3.2 | #365 | pending |
| T4.1 | #366 | pending |
| T5.1 | #367 | pending |

## Current Status

**Active Phase**: Phase 1 - Design and Reference Graph Baseline

**Active Task**: T1.1 - Finalize SPEC docs, GitHub tracking, and reference graph.

**Current Focus**: Finish non-destructive SPEC setup, create GitHub milestones/issues, then merge this planning baseline before destructive archive/script/test moves.

## Governance Status

**Shared instruction surface**: `AGENTS.md`

**Platform-specific instruction surfaces**: none

**Memory surface**: native Codex memory; no repo fallback selected

## Execution Telemetry

- T1.1 started after previous repo governance SPEC was archived and all its milestones closed.
- Initial reference graph found direct active references to `docs/archive`, `docs/archives`, `docs/adr`, root `scripts/*.ps1|sh`, `tests/scripts/**`, and Desktop readiness script paths.

## Quick Status Commands

```powershell
gh issue list -R TokenDanceLab/AgentHub --label "spec:repo-structure-doc-tooling-cleanup" --state all
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.title | startswith("Repo Structure Cleanup")) | "\(.title): \(.open_issues) open, \(.closed_issues) closed"'
git status --short --branch
git worktree list
```
