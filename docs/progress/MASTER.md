# Repo Governance Real E2E Closure - Progress Tracker

> **Task**: Normalize AgentHub repo governance, real E2E acceptance, source/test alignment, and merge readiness.
> **Started**: 2026-06-27
> **Last Updated**: 2026-06-27
> **Mode**: GITHUB_STANDARD
> **Repo**: TokenDanceLab/AgentHub
> **Baseline**: `dev/delicious233`

This file is the lightweight local index for the active spec-driven run. Detailed task execution lives in GitHub issues/PRs and milestone descriptions; old evidence snapshots belong in `docs/archive/` or `docs/archives/`.

## GitHub Resources

- **All Issues**: `gh issue list -R TokenDanceLab/AgentHub --label "spec:repo-governance-real-e2e" --state all`
- **Phase 1 PR**: https://github.com/TokenDanceLab/AgentHub/pull/338
- **Phase 2 PR**: https://github.com/TokenDanceLab/AgentHub/pull/340
- **Project Board**: skipped; current GitHub token does not have project scope.

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
| 1 | Governance Baseline | https://github.com/TokenDanceLab/AgentHub/milestone/8 | 0 | 4 | 4 |
| 2 | Real E2E Contract | https://github.com/TokenDanceLab/AgentHub/milestone/11 | 0 | 5 | 5 |
| 3 | Source And Test Alignment | https://github.com/TokenDanceLab/AgentHub/milestone/9 | 2 | 8 | 10 |
| 4 | Acceptance And Merge Readiness | https://github.com/TokenDanceLab/AgentHub/milestone/10 | 3 | 0 | 3 |

## Issue Mapping

| Task ID | Issue | Title | Status |
|:--|:--|:--|:--|
| T1.1 | #322 | Normalize branch/worktree governance | closed |
| T1.2 | #323 | Normalize document standards and active/archive rules | closed |
| T1.3 | #325 | Add useful project-skill whitelist verification | closed |
| T1.4 | #324 | Clean generated artifact hygiene | closed |
| T2.1 | #326 | Make evidence-level matrix canonical | closed |
| T2.2 | #327 | Split data mode surface auth and execution axes | closed |
| T2.3 | #328 | Align E2E smoke matrix and manifests | closed |
| T2.4 | #329 | Normalize Visual QA acceptance | closed |
| T2.5 | #339 | Degiant active docs and archive stale material | closed |
| T3.0 | #342 | Trim active API/Hub docs and source-contract owner mapping | closed |
| T3.0b | #344 | Trim module README docs and stale active references | closed |
| T3.0c | #346 | Sync progress SSOT and doc governance guardrails | closed |
| T3.0d | #352 | Aggressively consolidate active documentation | closed |
| T3.0e | #354 | Degiant active documentation spine | open |
| T3.1 | #330 | Harden chat transcript behavior tests | closed |
| T3.2 | #331 | Align frontend architecture docs to shared implementation | closed |
| T3.3 | #332 | Classify backend API performance and leak gates | closed |
| T3.4 | #333 | Check Desktop packaged evidence boundary | closed |
| T3.5 | #334 | Align Web Mobile client test lanes | open |
| T4.1 | #335 | Run focused acceptance gate bundle | open |
| T4.2 | #336 | Cross-review and architecture approval packet | open |
| T4.3 | #337 | Merge-readiness and archive preparation | open |

## Quick Status Commands

```powershell
# Phase progress
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.title | startswith("Spec Governance Real E2E")) | "\(.title): \(.open_issues) open, \(.closed_issues) closed"'

# All task issues
gh issue list -R TokenDanceLab/AgentHub --label "spec:repo-governance-real-e2e" --state all --limit 80 --json number,title,state,milestone

# Local branch and worktree truth
git status --short --branch
git worktree list
```

## Phase Checklist

- [x] Phase 1: Governance Baseline (4/4 tasks merged) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/8)
- [x] Phase 2: Real E2E Contract (5/5 tasks merged) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/11)
- [ ] Phase 3: Source And Test Alignment (8/10 tasks merged) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/9)
- [ ] Phase 4: Acceptance And Merge Readiness (0/3 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/10)

## Current Status

**Active Phase**: Phase 3 - Source And Test Alignment

**Active Task**: #354 / T3.0e in `docs/354-doc-spine-cleanup`; #334 worktree remains pending and unchanged.

**Current Focus**: Degiant active documentation spine. Keep the active doc set compact, archive obsolete longform material, and preserve the rule/progress spine: `AGENTS.md`, `docs/progress/MASTER.md`, `docs/roadmap.md`, focused architecture/API owner docs, and `.agents/skills/real-e2e-acceptance/SKILL.md`.

**Blockers**: none. Mobile deep UI/native redesign remains out of scope for #334; #354 must not add new active rule docs.

## Governance Status

**Shared instruction surface**: `AGENTS.md`

**Platform-specific instruction surfaces**: none; `CLAUDE.md` is intentionally not used in this repo.

**Other platform rule surfaces**: none found (`.cursor/`, `.windsurf/`, `.clinerules*`, `.codex/`)

**Memory surface**: native Codex memory; no repo fallback selected

**Memory fallback path**: none

## Project Skill Boundary

- Active project skills are only the allowlisted directories under `.agents/skills/`.
- Archived project skills live under `docs/archives/project-skills/` for historical reference only.
- Archived skills such as `ui-screenshot`, `dev-team`, and `dev-team-codex` must not be loaded as active workflows.
- Real E2E acceptance is the active replacement for the old screenshot skill: `.agents/skills/real-e2e-acceptance/SKILL.md`.

## Execution Telemetry

- GitHub modes store per-task telemetry in issue comments and milestone descriptions.
- Phase 3 adaptive state is in milestone #9. Current drift score: 3 after #354 was added for continued active-doc cleanup pressure; annotate threshold is already active, replan threshold is 4.
- T3.0c actual effort: S; S.U.P.E.R focus S/U/R pass; unplanned dependency count: 1 (GitHub milestone adaptive state was stale after #344 closed).
- T3.1 actual effort: M; S.U.P.E.R focus S/P/R pass; unplanned dependency count: 1 (new Web optimistic-send E2E passed on current implementation, so no production fix was needed).
- T3.2 actual effort: M; S.U.P.E.R focus S/U/R pass; unplanned dependency count: 0. PR #349 merged; #331 closed. Phase 3 is now 5/8 with `drift_score=1`.
- T3.3 actual effort: M; S.U.P.E.R focus P/E pass; unplanned dependency count: 0. PR #350 merged; #332 closed. Drift contribution 0; Phase 3 is now 6/8 with `drift_score=1`.
- T3.4 actual effort: M; S.U.P.E.R focus P/E pass; unplanned dependency count: 0. PR #351 merged; #333 closed. Drift contribution 0; Phase 3 was 7/8 before #352 expanded the phase to 9 tasks.
- T3.0d actual effort: M; S.U.P.E.R focus S/U/R pass; unplanned dependency count: 1 (`verify-real-e2e-contract` still depended on the archived workflow doc). PR #353 merged; #352 closed. Drift contribution 1; Phase 3 is now 8/9 with `drift_score=2`.
- T3.0e plan opened from user-directed doc-spine cleanup pressure. Planned effort: M; S.U.P.E.R focus S/U/R; unplanned dependency count before execution: 1. Issue #354 tracks the work; this entry is the required plan-before-audit checkpoint.

## Recent Checkpoints

| Date | Checkpoint | Evidence |
|:--|:--|:--|
| 2026-06-27 | Phase 1 merged | PR #338 merged; #322-#325 closed. |
| 2026-06-27 | Phase 2 merged | PR #340 merged; #326-#329 and #339 closed. |
| 2026-06-27 | Active doc regroup merged | PR #341 merged; old active-doc regroup branch/worktree cleaned. |
| 2026-06-27 | API/Hub source contract merged | PR #343 merged; #342 closed. |
| 2026-06-27 | Module README cleanup merged | PR #345 merged; #344 closed. |
| 2026-06-27 | Progress SSOT cleanup | #346 closes stale Phase 3 counts, stale branch wording, and oversized MASTER session log drift. |
| 2026-06-27 | Chat transcript tests | #330 adds Web delayed-send optimistic bubble coverage and verifies existing shared/Desktop/Web/Visual QA chat-flow gates. |
| 2026-06-27 | Frontend architecture SSOT | PR #349 merged; #331 closed; `docs/architecture/04-frontend-data-flow.md` now maps shared implementation owners. |
| 2026-06-27 | Backend performance/leak gates | PR #350 merged; #332 closed; `scripts/load-test-scenarios.md` owns gate classification and `scripts/verify-backend-perf-leak-gates.ps1` runs focused behavior + microbench smoke. |
| 2026-06-27 | Desktop packaged boundary | PR #351 merged; #333 closed; package readiness/dry gates separate Vite renderer, packaged-release, signing/updater/release upload, and `real_tested=false` boundaries. |
| 2026-06-27 | Active doc consolidation merged | PR #353 merged; #352 closed; duplicate active governance rule files archived and verifiers now block them from returning. |
| 2026-06-27 | Adaptive drift warning | Milestone #9 drift score updated to 2; #334 annotated for possible Web/Mobile client lane contract/verifier alignment. |
| 2026-06-27 | Continued doc-spine cleanup opened | #354 added after follow-up review found active docs still risk becoming giant, duplicated, or stale. |

## Next Steps

1. Inventory active Markdown/rule surfaces for #354 and classify keep/merge/archive/delete candidates.
2. Archive stale or duplicate longform material under existing archive trees; do not create replacement rule sprawl.
3. Run focused governance gates and update only high-signal guardrails.
4. Return to #334 after #354 is merged or explicitly deferred.
