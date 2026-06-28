# Real Foundation Hardening - Progress Tracker

> **Task**: Desktop/Web chat workflow, shared transcript, data-boundary, and real E2E/Visual QA foundation hardening
> **Started**: 2026-06-28
> **Last Updated**: 2026-06-28
> **Mode**: GITHUB_STANDARD
> **Repo**: TokenDanceLab/AgentHub

## GitHub Resources

- **All Issues**: `gh issue list -R TokenDanceLab/AgentHub --label "spec-driven" --state all`
- **Project Board**: Not created; current `gh` token lacks `read:project`/Project scope.

## References

- [Project Overview](../analysis/project-overview.md)
- [Module Inventory](../analysis/module-inventory.md)
- [Risk Assessment](../analysis/risk-assessment.md)
- [Task Breakdown](../plan/task-breakdown.md)
- [Dependency Graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)

## Milestones

| Phase | Name | Milestone URL | Open | Closed | Total |
|:--|:--|:--|--:|--:|--:|
| 1 | Evidence Contract Foundation | https://github.com/TokenDanceLab/AgentHub/milestone/17 | 1 | 3 | 4 |
| 2 | Shared Chat Timeline Hardening | https://github.com/TokenDanceLab/AgentHub/milestone/18 | 4 | 0 | 4 |
| 3 | Desktop/Web Boundary And Backend Truth | https://github.com/TokenDanceLab/AgentHub/milestone/19 | 3 | 0 | 3 |
| 4 | Real E2E And Visual QA Closure | https://github.com/TokenDanceLab/AgentHub/milestone/20 | 3 | 0 | 3 |
| 5 | Acceptance, Merge, Archive | https://github.com/TokenDanceLab/AgentHub/milestone/21 | 2 | 0 | 2 |

## Issue Mapping

| Task ID | Issue | Title | Status |
|:--|:--|:--|:--|
| T1.1 | #378 | Define chat-flow evidence manifest contract | closed via #395 |
| T1.2 | #379 | Align Visual QA viewports and report shape | closed via #396 |
| T1.3 | #380 | Reuse data-mode boundary helper in acceptance gates | closed via #397 |
| T1.4 | #381 | Document evidence bundle without rule duplication | open; adaptive replan required |
| T2.1 | #382 | Add golden mixed-source transcript fixtures | open |
| T2.2 | #383 | Harden optimistic send and auto-follow contract | open |
| T2.3 | #384 | Harden card grouping and rounded-stack rules | open |
| T2.4 | #385 | Keep markdown/table rendering and debug filtering clean | open |
| T3.1 | #386 | Web Hub-only guarded-flow check | open |
| T3.2 | #387 | Desktop entry-preflight vs workbench-runtime split | open |
| T3.3 | #388 | Observed and approved-real manifest boundary | open |
| T4.1 | #389 | Add focused chat acceptance gate | open |
| T4.2 | #390 | Add semi-automated Visual QA artifact loop | open |
| T4.3 | #391 | Keep packaged Desktop claim separate | open |
| T5.1 | #392 | Run final acceptance matrix | open |
| T5.2 | #393 | Merge readiness and archive SPEC | open |

## Quick Status Commands

```powershell
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.title | startswith("Phase ")) | "\(.title): \(.open_issues) open, \(.closed_issues) closed"'
gh issue list -R TokenDanceLab/AgentHub --milestone "Phase 1: Evidence Contract Foundation" --state open --json number,title
gh issue list -R TokenDanceLab/AgentHub --label "spec-driven" --state all --json number,title,state,milestone
```

## Phase Checklist

- [ ] Phase 1: Evidence Contract Foundation (3/4 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/17)
- [ ] Phase 2: Shared Chat Timeline Hardening (0/4 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/18)
- [ ] Phase 3: Desktop/Web Boundary And Backend Truth (0/3 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/19)
- [ ] Phase 4: Real E2E And Visual QA Closure (0/3 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/20)
- [ ] Phase 5: Acceptance, Merge, Archive (0/2 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/21)

## Current Status

**Active Phase**: Phase 1
**Active Task**: Phase 1 adaptive replan before T1.4 (#381)
**Blockers**: Adaptive `drift_score=2` reached the Phase 1 replan threshold. Do not start #381 as a broad docs pass; keep it docs-only and concise. GitHub Project board requires refreshed `project` scope and is intentionally skipped.

## Governance Status

**Shared instruction surface**: `AGENTS.md`
**Claude Code instruction surface**: unavailable; no separate Claude-only rule surface is active
**Other platform rule surfaces**: none active for this SPEC
**Memory surface**: native Codex memory available; no repo fallback selected
**Memory fallback path**: none
**Project skill**: `.agents/skills/real-e2e-acceptance/SKILL.md`

## Execution Telemetry

Per-task telemetry is stored in GitHub issue comments before task closure. Adaptive drift state is stored in each milestone description.

## Next Steps

1. Replan the remaining #381 scope as a narrow docs-only closure task.
2. Keep full Web Visual QA brand-shell failure scoped to the Visual QA/design acceptance lane; do not overclaim it as green.
3. Continue Phase 1 only after the #381 replan note is accepted in the task issue.

## Session Log

| Date | Session | Summary |
|:--|:--|:--|
| 2026-06-28 | spec setup | Created analysis docs, plan docs, GitHub milestones #17-#21, and task issues #378-#393 from branch `spec/real-foundation-hardening`. |
| 2026-06-28 | T1.1 implementation | Added shared chat-flow evidence manifest contract and tests; full shared Vitest passed, targeted TypeScript passed, broad `app/shared lint` remains blocked by pre-existing story/test type debt unrelated to this task. |
| 2026-06-28 | T1.2 implementation | Aligned Web Visual QA desktop scenes to `1440x810`, added screenshot/DOM-metrics report output, tightened the real-e2e verifier, and generated a failing Visual QA report that now records the remaining shell brand-image assertion. |
| 2026-06-28 | T1.3 implementation | Added shared E2E request-decision helper and reused it from Desktop/Web Playwright boundary gates; Desktop chat-flow and Web stubbed Hub E2E passed with `real_tested=false` boundaries. |
| 2026-06-28 | adaptive replan sync | #380 merged via #397; Phase 1 drift reached the replan threshold, so #381 must stay as a narrow docs-only closure task before Phase 1 completes. |
