# Real Foundation Hardening - Progress Tracker

> **Task**: Desktop/Web chat workflow, shared transcript, data-boundary, and real E2E/Visual QA foundation hardening
> **Started**: 2026-06-28
> **Last Updated**: 2026-06-29
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
| 1 | Evidence Contract Foundation | https://github.com/TokenDanceLab/AgentHub/milestone/17 | 0 | 4 | 4 |
| 2 | Shared Chat Timeline Hardening | https://github.com/TokenDanceLab/AgentHub/milestone/18 | 0 | 4 | 4 |
| 3 | Desktop/Web Boundary And Backend Truth | https://github.com/TokenDanceLab/AgentHub/milestone/19 | 1 | 2 | 3 |
| 4 | Real E2E And Visual QA Closure | https://github.com/TokenDanceLab/AgentHub/milestone/20 | 3 | 0 | 3 |
| 5 | Acceptance, Merge, Archive | https://github.com/TokenDanceLab/AgentHub/milestone/21 | 2 | 0 | 2 |

## Issue Mapping

| Task ID | Issue | Title | Status |
|:--|:--|:--|:--|
| T1.1 | #378 | Define chat-flow evidence manifest contract | closed via #395 |
| T1.2 | #379 | Align Visual QA viewports and report shape | closed via #396 |
| T1.3 | #380 | Reuse data-mode boundary helper in acceptance gates | closed via #397 |
| T1.4 | #381 | Document evidence bundle without rule duplication | closed via #399 |
| T2.1 | #382 | Add golden mixed-source transcript fixtures | closed via #401 |
| T2.2 | #383 | Harden optimistic send and auto-follow contract | closed via #402 |
| T2.3 | #384 | Harden card grouping and rounded-stack rules | closed via #404 |
| T2.4 | #385 | Keep markdown/table rendering and debug filtering clean | closed via #405 |
| T3.1 | #386 | Web Hub-only guarded-flow check | closed via #406 |
| T3.2 | #387 | Desktop entry-preflight vs workbench-runtime split | closed via #408 |
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

- [x] Phase 1: Evidence Contract Foundation (4/4 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/17)
- [x] Phase 2: Shared Chat Timeline Hardening (4/4 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/18)
- [ ] Phase 3: Desktop/Web Boundary And Backend Truth (2/3 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/19)
- [ ] Phase 4: Real E2E And Visual QA Closure (0/3 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/20)
- [ ] Phase 5: Acceptance, Merge, Archive (0/2 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/21)

## Current Status

**Active Phase**: Phase 3
**Active Task**: T3.3 - Observed and approved-real manifest boundary (#388)
**Blockers**: None for GitHub Standard. GitHub Project board requires refreshed `project` scope and is intentionally skipped.

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

1. Start T3.3 (#388) in a separate task worktree from `origin/dev/delicious233`.
2. Keep #388 focused on observed/approved-real manifest boundaries; do not expand it into packaging or live-runtime claims.
3. Keep full Web Visual QA brand-shell failure scoped to the Visual QA/design acceptance lane; do not overclaim it as green.
4. Preserve `real_tested=false` boundaries unless an approved-real run is explicitly approved and executed.

## Session Log

| Date | Session | Summary |
|:--|:--|:--|
| 2026-06-28 | spec setup | Created analysis docs, plan docs, GitHub milestones #17-#21, and task issues #378-#393 from branch `spec/real-foundation-hardening`. |
| 2026-06-28 | T1.1 implementation | Added shared chat-flow evidence manifest contract and tests; full shared Vitest passed, targeted TypeScript passed, broad `app/shared lint` remains blocked by pre-existing story/test type debt unrelated to this task. |
| 2026-06-28 | T1.2 implementation | Aligned Web Visual QA desktop scenes to `1440x810`, added screenshot/DOM-metrics report output, tightened the real-e2e verifier, and generated a failing Visual QA report that now records the remaining shell brand-image assertion. |
| 2026-06-28 | T1.3 implementation | Added shared E2E request-decision helper and reused it from Desktop/Web Playwright boundary gates; Desktop chat-flow and Web stubbed Hub E2E passed with `real_tested=false` boundaries. |
| 2026-06-28 | adaptive replan sync | #380 merged via #397; Phase 1 drift reached the replan threshold, so #381 must stay as a narrow docs-only closure task before Phase 1 completes. |
| 2026-06-28 | T1.4 implementation | Linked the evidence bundle from architecture and roadmap without duplicating the real-e2e skill or AGENTS rules; scope remained docs-only. |
| 2026-06-28 | Phase 1 complete | #381 merged via #399; milestone #17 closed with 4/4 tasks complete and Phase 2 is now active. |
| 2026-06-28 | T2.1 implementation | Added shared golden mixed-source transcript fixtures and switched Web chat-flow E2E to consume the shared fixture; #401 merged. |
| 2026-06-28 | T2.2 implementation | Tightened optimistic send auto-follow so pending-to-confirmed reconciliation does not steal scrollback; Desktop/Web chat-flow E2E and Visual QA passed with `real_tested=false`; #402 merged. |
| 2026-06-28 | T2.3 implementation | Split related card stacks from unrelated consecutive cards, removed nested preview-card framing, and verified Desktop/Web chat-flow geometry with `real_tested=false`; #404 merged and #384 closed manually because non-default base did not auto-close it. |
| 2026-06-29 | T2.4 implementation | Expanded shared runtime diagnostic filtering, kept Markdown table rendering under shared/Web tests, verified Desktop/Web chat-flow and Visual QA with `real_tested=false`; #405 merged and #385 closed manually because non-default base did not auto-close it. |
| 2026-06-29 | T3.1 implementation | Enforced Web guarded Hub-only data boundary, added stubbed-Hub manifest `evidence_level`, blocked Local Edge/TDI/Gateway boundary attempts in Playwright, and verified Web/shared gates with `real_tested=false`; #406 merged and #386 closed manually because non-default base did not auto-close it. |
| 2026-06-29 | Phase 3 sync | Updated Phase 3 live state after #406: milestone #19 is 1/3 complete, T3.2 (#387) is the active next task, and adaptive milestone `completed_tasks` is 1. |
| 2026-06-29 | T3.2 implementation | Added Desktop entry/workbench data-boundary Playwright coverage, moved chat-flow phase marking to the Demo transition boundary, hardened disabled health polling against in-flight updates, and verified Desktop Vite gates with `real_tested=false`; #408 merged and #387 closed manually because non-default base did not auto-close it. |
| 2026-06-29 | Phase 3 sync | Updated Phase 3 live state after #408: milestone #19 is 2/3 complete, adaptive drift_score is 1, #388 has a drift warning, and T3.3 (#388) is the active next task. |
| 2026-06-29 | T3.3 implementation | Hardened observed/approved-real manifest boundaries, kept packaged-release claims separate, aligned smoke-matrix contract checks with current stubbed-Hub replay names, and verified shared/contract gates with `real_tested=false`; PR pending. |
