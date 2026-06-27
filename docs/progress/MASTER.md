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
| 1 | Governance Baseline | https://github.com/TokenDanceLab/AgentHub/milestone/8 | 0 | 4 | 4 |
| 2 | Real E2E Contract | https://github.com/TokenDanceLab/AgentHub/milestone/11 | 4 | 0 | 4 |
| 3 | Source And Test Alignment | https://github.com/TokenDanceLab/AgentHub/milestone/9 | 5 | 0 | 5 |
| 4 | Acceptance And Merge Readiness | https://github.com/TokenDanceLab/AgentHub/milestone/10 | 3 | 0 | 3 |

## Issue Mapping

| Task ID | Issue | Title | Status |
|:--|:--|:--|:--|
| T1.1 | #322 | Normalize branch/worktree governance | closed |
| T1.2 | #323 | Normalize document standards and active/archive rules | closed |
| T1.3 | #325 | Add useful project-skill whitelist verification | closed |
| T1.4 | #324 | Clean generated artifact hygiene | closed |
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

- [x] Phase 1: Governance Baseline (4/4 tasks merged) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/8)
- [ ] Phase 2: Real E2E Contract (0/4 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/11)
- [ ] Phase 3: Source And Test Alignment (0/5 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/9)
- [ ] Phase 4: Acceptance And Merge Readiness (0/3 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/10)

## Current Status

**Active Phase**: Phase 2 - Real E2E Contract
**Active Task**: not started; next work begins at #326 / T2.1.
**Current Focus**: Phase 1 governance baseline is merged into `dev/delicious233` via PR #338 (`4dc4f496d845a3e76c8c87adbe2a74a2d6f8dd4b`). `AGENTS.md` is the single project rule surface, `docs/progress/MASTER.md` is the current spec progress surface, `docs/roadmap.md` is the total progress surface, dated governance evidence is archived, and stale project skills remain archived-only. The next phase should refine the real E2E evidence contract without adding duplicate rule documents.
**Blockers**: none for Phase 1. Phase 2-4 issues remain open and must run through their own spec, implementation, and acceptance gates.

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

1. Start Phase 2 from #326 / T2.1 after a spec checkpoint; do not reuse Phase 1 PR state as implementation evidence.
2. Keep active rules in `AGENTS.md`, current progress in this file, and total roadmap in `docs/roadmap.md`; archive or delete stale rules instead of appending duplicates.
3. For every real E2E claim, map the claim to Playwright, Visual QA, backend/API, observed-local, approved-real, or packaged-release evidence before implementation.
4. Keep Mobile redesign, native package, and mobile-specific UX expansion out of this spec unless the operator opens a separate scoped task.

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
| 2026-06-27 | mobile-visual-contract | Scoped Mobile required-gate fix only. Confirmed the current visible home/account identity is `Delicious233` per existing source/tests, then updated Mobile Visual QA assertions from the stale `Alice` expectation. Added mock-Hub contract checks for `/client/sessions`, `/client/contacts`, CORS preflight, and `/client/ws`; implemented those routes without suppressing browser console errors. CI then showed Linux `Screenshot visual QA (mobile)` hanging after prior steps passed, so `visual-qa.mjs` now starts owned preview/mock-Hub servers in a non-Windows process group and terminates the full process tree during teardown. Evidence level: Expo Web Visual QA + mock-Hub fixture contract, not native package or real Hub login. Verification: `mock:hub:check` failed first on `/client/sessions` preflight, then passed; `visual:qa` passed before and after process-group teardown; `verify` passed with 25 files / 330 tests; CI-style mock-Hub Vitest passed with 25 files / 330 tests. |
| 2026-06-27 | mobile-expo-doctor-contract | Scoped Mobile required-gate fix only. CI `Frontend (mobile)` then failed at Expo Doctor after Visual QA and mock-Hub E2E passed. Aligned Expo SDK 56 patch dependencies and kept React/React DOM on the repo-shared `19.2.7` contract using Expo's documented `expo.install.exclude` for those two packages. Evidence level remains Expo Web + mock-Hub fixture/native config checks, not native package, device install, or real Hub login. Verification: `corepack.cmd pnpm --dir app/mobile-rn verify:qa` passed, including typecheck, lint, brand/boundary checks, 25 Vitest files / 330 tests, Expo Doctor 21/21 checks, native readiness, mock-Hub contract, and Visual QA screenshots. |
| 2026-06-27 | phase-1-merged | PR #338 merged into `dev/delicious233` with all required checks green. GitHub did not auto-close issues because the PR target was not the default branch, so #322-#325 were closed manually with merge evidence. Phase 1 milestone is closed with 0 open / 4 closed issues; Phase 2 begins at #326 after the next spec checkpoint. |
