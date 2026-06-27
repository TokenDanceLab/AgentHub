# Repo Governance Real E2E Closure - Progress Tracker

> **Task**: Normalize AgentHub repo governance, real E2E acceptance, source/test alignment, and merge readiness.
> **Started**: 2026-06-27
> **Last Updated**: 2026-06-28
> **Mode**: GITHUB_STANDARD
> **Repo**: TokenDanceLab/AgentHub
> **Baseline**: `dev/delicious233`

This file is the archived local index for the completed spec-driven run. Live task history remains in GitHub issues/PRs and milestone descriptions; evidence snapshots remain in `docs/archive/` or `docs/archives/`.

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
| 3 | Source And Test Alignment | https://github.com/TokenDanceLab/AgentHub/milestone/9 | 0 | 10 | 10 |
| 4 | Acceptance And Merge Readiness | https://github.com/TokenDanceLab/AgentHub/milestone/10 | 1 | 2 | 3 |

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
| T3.0e | #354 | Degiant active documentation spine | closed |
| T3.1 | #330 | Harden chat transcript behavior tests | closed |
| T3.2 | #331 | Align frontend architecture docs to shared implementation | closed |
| T3.3 | #332 | Classify backend API performance and leak gates | closed |
| T3.4 | #333 | Check Desktop packaged evidence boundary | closed |
| T3.5 | #334 | Align Web Mobile client test lanes | closed |
| T4.1 | #335 | Run focused acceptance gate bundle | closed |
| T4.2 | #336 | Cross-review and architecture approval packet | closed |
| T4.3 | #337 | Merge-readiness and archive preparation | PR-ready |

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
- [x] Phase 3: Source And Test Alignment (10/10 tasks merged) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/9)
- [ ] Phase 4: Acceptance And Merge Readiness (2/3 tasks complete; #337 prepared this archive branch) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/10)

## Current Status

**Active Phase**: Archived after Phase 4 merge-readiness preparation

**Active Task**: #337 / T4.3 merge-readiness and archive preparation.

**Current Focus**: Merge the archive-preparation PR, manually close #337 if GitHub does not auto-close against `dev/delicious233`, close Phase 4 milestone, then start the separate `repo-structure-doc-tooling-cleanup` SPEC.

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
- Phase 3 closed at `drift_score=4`; scope stabilization held and no extra task was added.
- T3.0c actual effort: S; S.U.P.E.R focus S/U/R pass; unplanned dependency count: 1 (GitHub milestone adaptive state was stale after #344 closed).
- T3.1 actual effort: M; S.U.P.E.R focus S/P/R pass; unplanned dependency count: 1 (new Web optimistic-send E2E passed on current implementation, so no production fix was needed).
- T3.2 actual effort: M; S.U.P.E.R focus S/U/R pass; unplanned dependency count: 0. PR #349 merged; #331 closed. Phase 3 is now 5/8 with `drift_score=1`.
- T3.3 actual effort: M; S.U.P.E.R focus P/E pass; unplanned dependency count: 0. PR #350 merged; #332 closed. Drift contribution 0; Phase 3 is now 6/8 with `drift_score=1`.
- T3.4 actual effort: M; S.U.P.E.R focus P/E pass; unplanned dependency count: 0. PR #351 merged; #333 closed. Drift contribution 0; Phase 3 was 7/8 before #352 expanded the phase to 9 tasks.
- T3.0d actual effort: M; S.U.P.E.R focus S/U/R pass; unplanned dependency count: 1 (`verify-real-e2e-contract` still depended on the archived workflow doc). PR #353 merged; #352 closed. Drift contribution 1; Phase 3 is now 8/9 with `drift_score=2`.
- T3.0e actual effort: M; S.U.P.E.R focus S/U/R pass; unplanned dependency count: 1 (`verify-brand-assets.mjs` still read the archived Mobile handoff). PR #355 merged; #354 closed.
- T3.5 actual effort: M; S.U.P.E.R focus S/P/E/R pass; unplanned dependency count: 0. PR #356 merged; #334 closed; local gates and CI passed.
- T4.1 actual effort: L; S.U.P.E.R focus P/E pass; unplanned dependency count: 0. Gate stabilization notes: Desktop smoke now follows Entry Gate -> Demo workbench, and client smoke now installs from the app workspace root. Evidence: [phase4-acceptance-gates-2026-06-27.md](../../governance-evidence/phase4-acceptance-gates-2026-06-27.md).
- T4.2 actual effort: M; S.U.P.E.R focus R pass; unplanned dependency count: 0. Evidence: [architecture-approval-repo-governance-real-e2e-2026-06-28.md](../../governance-evidence/architecture-approval-repo-governance-real-e2e-2026-06-28.md).
- T4.3 actual effort: M; S.U.P.E.R focus R pass; unplanned dependency count: 0. This branch archives `docs/analysis/`, `docs/plan/`, and `docs/progress/` under `docs/archives/repo-governance-real-e2e-closure/`.

## Recent Checkpoints

| Date | Checkpoint | Evidence |
|:--|:--|:--|
| 2026-06-27 | API/Hub source contract merged | PR #343 merged; #342 closed. |
| 2026-06-27 | Module README cleanup merged | PR #345 merged; #344 closed. |
| 2026-06-27 | Progress SSOT cleanup | #346 closes stale Phase 3 counts, stale branch wording, and oversized MASTER session log drift. |
| 2026-06-27 | Chat transcript tests | #330 adds Web delayed-send optimistic bubble coverage and verifies existing shared/Desktop/Web/Visual QA chat-flow gates. |
| 2026-06-27 | Frontend architecture SSOT | PR #349 merged; #331 closed; `docs/architecture/04-frontend-data-flow.md` now maps shared implementation owners. |
| 2026-06-27 | Backend performance/leak gates | PR #350 merged; #332 closed; `scripts/load-test-scenarios.md` owns gate classification and `scripts/verify-backend-perf-leak-gates.ps1` runs focused behavior + microbench smoke. |
| 2026-06-27 | Desktop packaged boundary | PR #351 merged; #333 closed; package readiness/dry gates separate Vite renderer, packaged-release, signing/updater/release upload, and `real_tested=false` boundaries. |
| 2026-06-27 | Active doc consolidation merged | PR #353 merged; #352 closed; duplicate active governance rule files archived and verifiers now block them from returning. |
| 2026-06-27 | Adaptive drift warning | Milestone #9 drift score updated to 2; #334 annotated for possible Web/Mobile client lane contract/verifier alignment. |
| 2026-06-27 | Continued doc-spine cleanup merged | PR #355 merged; #354 closed; branch-governance and Mobile handoff moved to archive, Mobile README shortened, and doc SSOT now guards Mobile stale proof claims. |
| 2026-06-27 | Lightweight replan | Phase 3 drift reached 4; no new task added because #334 already owns the remaining Web/Mobile lane alignment. |
| 2026-06-27 | Web/Mobile lane merged | PR #356 merged; #334 closed; Phase 3 is complete. |
| 2026-06-27 | Phase 4 acceptance bundle | #335 focused gates have 0 failed rows; smoke matrix is passed-with-blockers only for expected approved-real login readiness. Evidence file: [phase4-acceptance-gates-2026-06-27.md](../../governance-evidence/phase4-acceptance-gates-2026-06-27.md). |
| 2026-06-28 | Architecture approval packet | #336 cross-review found no Critical/High blockers; doc/archive/ADR bulk is deferred to the next cleanup SPEC. Evidence file: [architecture-approval-repo-governance-real-e2e-2026-06-28.md](../../governance-evidence/architecture-approval-repo-governance-real-e2e-2026-06-28.md). |
| 2026-06-28 | Merge-readiness archive | #337 moves this SPEC's analysis, plan, and progress materials under `docs/archives/repo-governance-real-e2e-closure/` and leaves the next repository-structure cleanup as a separate SPEC. |

## Next Steps

1. Merge the #337 archive-preparation PR into `dev/delicious233`.
2. Close #337 and milestone #10 if GitHub does not auto-close because `dev/delicious233` is not the default branch.
3. Start the separate `repo-structure-doc-tooling-cleanup` SPEC before moving external archives or reorganizing scripts/tests.
