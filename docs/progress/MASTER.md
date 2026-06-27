# Repo Governance Real E2E Closure - Progress Tracker

> **Task**: Normalize AgentHub repo governance, real E2E acceptance, source/test alignment, and merge readiness.
> **Started**: 2026-06-27
> **Last Updated**: 2026-06-27
> **Mode**: GITHUB_STANDARD
> **Repo**: TokenDanceLab/AgentHub
> **Branch**: docs/repo-governance-real-e2e
> **Baseline**: origin/dev/delicious233

## GitHub Resources

- **All Issues**: `gh issue list -R TokenDanceLab/AgentHub --label "spec:repo-governance-real-e2e" --state all`
- **Phase 1 PR**: https://github.com/TokenDanceLab/AgentHub/pull/338
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
| 1 | Governance Baseline | https://github.com/TokenDanceLab/AgentHub/milestone/8 | 4 | 0 | 4 |
| 2 | Real E2E Contract | https://github.com/TokenDanceLab/AgentHub/milestone/11 | 4 | 0 | 4 |
| 3 | Source And Test Alignment | https://github.com/TokenDanceLab/AgentHub/milestone/9 | 5 | 0 | 5 |
| 4 | Acceptance And Merge Readiness | https://github.com/TokenDanceLab/AgentHub/milestone/10 | 3 | 0 | 3 |

## Issue Mapping

| Task ID | Issue | Title | Status |
|:--|:--|:--|:--|
| T1.1 | #322 | Normalize branch/worktree governance | open |
| T1.2 | #323 | Normalize document standards and active/archive rules | open |
| T1.3 | #325 | Add useful project-skill whitelist verification | open |
| T1.4 | #324 | Clean generated artifact hygiene | open |
| T2.1 | #326 | Make evidence-level matrix canonical | open |
| T2.2 | #327 | Split data mode surface auth and execution axes | open |
| T2.3 | #328 | Align E2E smoke matrix and manifests | open |
| T2.4 | #329 | Normalize Visual QA acceptance | open |
| T3.1 | #330 | Harden chat transcript behavior tests | open |
| T3.2 | #331 | Align frontend architecture docs to shared implementation | open |
| T3.3 | #332 | Classify backend API performance and leak gates | open |
| T3.4 | #333 | Check Desktop packaged evidence boundary | open |
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

- [ ] Phase 1: Governance Baseline (4/4 tasks implemented locally; merge pending) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/8)
- [ ] Phase 2: Real E2E Contract (0/4 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/11)
- [ ] Phase 3: Source And Test Alignment (0/5 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/9)
- [ ] Phase 4: Acceptance And Merge Readiness (0/3 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/10)

## Current Status

**Active Phase**: Phase 1 - Governance Baseline
**Active Task**: Phase 1 PR #338 open; issues #322-#325 close on merge.
**Current Focus**: review/merge Phase 1 governance baseline while landing safe Phase 2 contract hardening in the same PR: `AGENTS.md` is now the single project rule surface, `docs/progress/MASTER.md` is the current spec progress surface, `docs/roadmap.md` is the total progress surface, dated governance evidence is archived, and Desktop/Web real E2E evidence boundaries are encoded in the smoke matrix manifest. Mobile-specific UI/fixture fixes are deferred for a later pass by operator direction.
**Blockers**: PR #338 is blocked only by the `Frontend (mobile)` required check. Current local Desktop/Web focused gates and all non-Mobile GitHub checks are green. Mobile now fails fast in Visual QA on the existing `Alice` visibility assertion instead of hanging indefinitely.

### Local Phase 1 Evidence

| Task | Local status | Evidence |
|:--|:--|:--|
| T1.1 | Implemented in branch | `AGENTS.md` and `docs/governance/branch-governance.md` now use live-state branch/worktree rules; stale active branch table removed. |
| T1.2 | Implemented in branch | `AGENTS.md` is the only active project rule surface; `CLAUDE.md` was removed; dated governance reports moved to `docs/archives/governance-evidence/`; old Desktop UI QA SOP moved to `docs/archive/`; `docs/governance/document-standards.md`, `docs/README.md`, `docs/contributing.md`, and `docs/reference/README.md` align active SPEC, archive, skill whitelist, and current CI coverage policy boundaries. |
| T1.3 | Implemented in branch | `scripts/verify-project-skills.ps1` added; CI validate now runs it; old project skills remain archived only; PowerShell and Bash CI policy verifiers both check this gate. |
| T1.4 | Verified in branch | `app/desktop/stats.html` is not tracked by Git and is ignored by `.gitignore`; stale skill unignore rules removed; generated artifact hygiene remains explicit. |

## Governance Status

**Shared instruction surface**: `AGENTS.md`
**Platform-specific instruction surfaces**: none; `CLAUDE.md` is intentionally not used in this repo.
**Other platform rule surfaces**: none found (`.cursor/`, `.windsurf/`, `.clinerules*`, `.codex/`)
**Memory surface**: native Codex memory; no repo fallback selected
**Memory fallback path**: none

### Project Skill Boundary

- Active project skills are only the allowlisted directories under `.agents/skills/`.
- Archived project skills live under `docs/archives/project-skills/` for historical reference only.
- Archived skills such as `ui-screenshot`, `dev-team`, and `dev-team-codex` must not be loaded as active workflows.
- Real E2E acceptance is now the active replacement for the old screenshot skill: `.agents/skills/real-e2e-acceptance/SKILL.md`.

## Execution Telemetry

- GitHub modes store per-task telemetry in issue comments before closure.
- Adaptive control state lives in milestone descriptions.
- Current drift score for all phases: 0.
- 2026-06-27 `doc-ssot-cleanup`: actual effort M; S.U.P.E.R quick check S/U/R pass for rule ownership, doc flow, and replaceable archived evidence; unplanned dependencies 2 (`verify-runtime-readiness` stale STATE assertion, old Desktop UI QA SOP archival).

## Next Steps

1. Do not merge PR #338 until `Frontend (mobile)` is fixed in a scoped Mobile pass or the workflow owner explicitly changes the Mobile gate policy.
2. Keep Mobile-specific UI/fixture fixes out of this branch unless the operator re-scopes the work; only workflow-level timeout/diagnostic hardening is in scope here.
3. After PR #338 merges, confirm issues #322-#325 close, update this tracker from GitHub state, and start Phase 2 from the evidence-level contract tasks.
4. If PR #338 cannot merge because Mobile remains stuck, record that as a workflow gating issue under T3.5/T4.3 instead of silently weakening Mobile assertions.

## Session Log

| Date | Session | Summary |
|:--|:--|:--|
| 2026-06-27 | setup | Phase 1-3 analysis/plan docs existed; refreshed GitHub state, created missing Phase 4 issues #335-#337, and created this MASTER index. |
| 2026-06-27 | phase-1-local | Normalized project-skill archive/whitelist rules, branch/worktree live-state rules, document active/archive rules, and focused validators. Verification: `verify-project-skills.ps1`, `verify-ci-gates.ps1`, `verify-ci-gates.sh`, OpenAPI YAML parse, and `git diff --check` passed. |
| 2026-06-27 | phase-1-pr | Pushed `docs/repo-governance-real-e2e` and opened PR #338 to `dev/delicious233`; PR body closes #322-#325 on merge and records evidence boundaries. |
| 2026-06-27 | desktop-web-gates | Scoped Mobile out for this pass; tuned Desktop/Web Playwright and manual visual chat-flow navigation budgets to match Windows cold-start behavior without weakening UI assertions. Verification: shared data-mode contract 784 tests passed, Desktop chat-flow Playwright 4/4 passed, Web stubbed Hub Playwright 7/7 passed, Desktop/Web manual 1440x810 visual chat-flow checks passed. |
| 2026-06-27 | mobile-gate-timeout | Did not change Mobile UI or fixtures. Added hard timeouts to the Mobile GitHub job, screenshot Visual QA step, and mock-Hub E2E step, enforced them through PowerShell and Bash CI policy verifiers, and made the Mobile Visual QA script exit immediately after reporting its real assertion failure. Verification: `verify-ci-gates.ps1`, `verify-ci-gates.sh`, and `corepack.cmd pnpm --dir app/mobile-rn visual:qa` failed fast in ~45s on the existing `Alice` assertion. |
| 2026-06-27 | desktop-web-transcript-cleanliness | Kept scope on Desktop/Web. Added Playwright assertions that mode/debug status does not enter the main transcript for Desktop mock and Web stubbed Hub flows, and added Desktop visual JSON evidence `transcriptHasModeDebug: false`. Verification: Desktop chat-flow Playwright 4/4 passed, Web stubbed Hub Playwright 7/7 passed, Desktop/Web manual 1440x810 visual chat-flow checks passed, Desktop test typecheck passed, Web typecheck passed, targeted eslint on changed E2E files passed. Full Desktop lint remains blocked by pre-existing unrelated lint debt. |
| 2026-06-27 | e2e-evidence-contract | Added Phase 2 contract hardening without touching Mobile UI fixtures. `scripts/verify-e2e-smoke-matrix.ps1` now runs Web `test:e2e:stubbed-hub` instead of a misleading/nonexistent real-mode command and emits row-level `evidence_level`, `real_tested`, and `claim`; top-level `evidence_levels` only includes non-skipped rows. `workflow-standard.md`, `04-frontend-data-flow.md`, `roadmap.md`, and `real-e2e-acceptance` now share the same evidence vocabulary and data-mode axis boundary. Verification: smoke matrix skip-only manifest produced empty executed evidence levels, Web stubbed-Hub matrix passed with `evidence_levels=["stubbed-hub"]` and `real_tested=false`, `verify-project-skills.ps1` passed, `verify-ci-gates.ps1` passed. |
| 2026-06-27 | doc-ssot-cleanup | Reorganized active rule ownership: `AGENTS.md` is the project rule SSOT, `docs/progress/MASTER.md` is current spec progress, `docs/roadmap.md` is total progress, and `CLAUDE.md` was deleted to avoid duplicate platform-specific rules. Active project skills are being shortened to current CI/runtime entrypoints and stale fixed test counts are removed. |
| 2026-06-27 | doc-ssot-archive | Archived dated governance evidence into `docs/archives/governance-evidence/`, archived the old Desktop UI QA SOP under `docs/archive/`, added `scripts/verify-doc-ssot.ps1`, wired it into CI validate and CI-policy verifiers, and fixed runtime-readiness checks to use the current approved-real boundary instead of a missing STATE handoff file. |
