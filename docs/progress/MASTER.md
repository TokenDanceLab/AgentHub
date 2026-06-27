# Repo Governance Real E2E Closure - Progress Tracker

> **Task**: Normalize AgentHub repo governance, real E2E acceptance, source/test alignment, and merge readiness.
> **Started**: 2026-06-27
> **Last Updated**: 2026-06-27
> **Mode**: GITHUB_STANDARD
> **Repo**: TokenDanceLab/AgentHub
> **Branch**: dev/delicious233 baseline; current governance/source-contract branch `docs/module-readme-trim`
> **Baseline**: origin/dev/delicious233

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
| 3 | Source And Test Alignment | https://github.com/TokenDanceLab/AgentHub/milestone/9 | 6 | 1 | 7 |
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
| T3.0b | #344 | Trim module README docs and stale active references | open |
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
- [x] Phase 2: Real E2E Contract (5/5 tasks merged) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/11)
- [ ] Phase 3: Source And Test Alignment (1/7 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/9)
- [ ] Phase 4: Acceptance And Merge Readiness (0/3 tasks) - [milestone](https://github.com/TokenDanceLab/AgentHub/milestone/10)

## Current Status

**Active Phase**: Phase 3 - Source And Test Alignment
**Active Task**: #344 / T3.0b on `docs/module-readme-trim`; #330 / T3.1 remains the next UI/source implementation task after this branch is merged.
**Current Focus**: PR #343 has been merged into `dev/delicious233`, #342 is closed, and the temporary `docs/active-markdown-trim` worktree/branch has been cleaned up. This branch trims remaining module-level active README/reference bloat for Web/Desktop/Edge/Hub tests/load scenarios, archives old longform snapshots, fixes stale active links, and extends doc SSOT checks so the same bloat does not return. Phase 3 implementation remains scoped to Desktop/Web chat transcript behavior, frontend architecture docs, backend API/performance/leak gates, Desktop packaged evidence, and Web/Mobile client lanes.
**Blockers**: none for module README cleanup. Mobile deep UI/native redesign remains out of scope.

### Local Phase 1 Evidence

| Task | Local status | Evidence |
|:--|:--|:--|
| T1.1 | Implemented in branch | `AGENTS.md` and `docs/governance/branch-governance.md` now use live-state branch/worktree rules; stale active branch table removed. |
| T1.2 | Implemented in branch | `AGENTS.md` is the only active project rule surface; `CLAUDE.md` was removed; dated governance reports moved to `docs/archives/governance-evidence/`; old Desktop UI QA SOP moved to `docs/archive/`; `docs/governance/document-standards.md`, `docs/README.md`, `CONTRIBUTING.md`, and `docs/reference/README.md` align active SPEC, archive, skill whitelist, and current CI coverage policy boundaries. |
| T1.3 | Implemented in branch | `scripts/verify-project-skills.ps1` added; CI validate now runs it; old project skills remain archived only; PowerShell and Bash CI policy verifiers both check this gate. |
| T1.4 | Verified in branch | `app/desktop/stats.html` is not tracked by Git and is ignored by `.gitignore`; stale skill unignore rules removed; generated artifact hygiene remains explicit. |

### Local Phase 2 Evidence

| Task | Local status | Evidence |
|:--|:--|:--|
| T2.1 | Implemented in branch | `real-e2e-acceptance` now owns the only evidence-level matrix and includes canonical machine labels; `workflow-standard.md` links to it instead of duplicating the table; `scripts/verify-real-e2e-contract.ps1` blocks drift. |
| T2.2 | Verified in branch | Existing `app/shared/src/testing/e2eDataModeContract.ts` remains the data-mode boundary contract; targeted Vitest passed for `e2eDataModeContract.test.ts` with 5 tests. No new data-mode source system was added. |
| T2.3 | Implemented in branch | `scripts/verify-e2e-smoke-matrix.ps1` emits canonical labels such as `approved-real` and `packaged-release`; Web stubbed-Hub matrix run passed with executed `evidence_levels=["stubbed-hub"]` and `real_tested=false`. |
| T2.4 | Verified in branch | Desktop/Web visual chat-flow checks passed at `1440x810`, with screenshots under app-local `.tmp/`, `horizontalOverflow=0`, `scrollGap=0`, and `transcriptHasModeDebug=false`. Architecture docs now name `1440x810` as the primary Desktop/Web Visual QA viewport. |
| T2.5 | Implemented in branch | Active docs were de-gianted: old longform roadmap, obsolete root state snapshot, static API reference, duplicate contributing guide, dated audits, release/merge notes, stale one-off plans, deprecated designs, cc-switch/design reports, and third-party project research moved to `docs/archive/`; concise active entrypoints now own the current facts. |

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
- 2026-06-27 `phase-2-real-e2e-contract`: actual effort M; S.U.P.E.R quick check S/P/E/R pass for single matrix ownership, manifest ports, environment-labeled evidence, and replaceable verifiers; unplanned dependencies 2 (stale Mobile roadmap blocker wording, smoke matrix non-canonical derived evidence labels).
- 2026-06-27 `active-doc-degianting`: actual effort L; S.U.P.E.R quick check S/P/E/R pass for single owner docs, archive ports, active-doc environment boundaries, and replaceable concise entrypoints; unplanned dependencies 3 (root STATE tests, duplicate API reference, stale docs/reference projects).
- 2026-06-27 `phase-2-ci-fix`: actual effort S; S.U.P.E.R quick check S/P/E/R pass for roadmap ownership, fixture topology contract, environment honesty, and verifier reuse; unplanned dependencies 1 (PR merge CI exposed a stale roadmap line not caught before push).
- 2026-06-27 `active-doc-regroup`: actual effort M; S.U.P.E.R quick check S/U/R pass for owner-file consolidation, archive routing, and stricter verifier limits; unplanned dependencies 2 (Git index lock after attempted parallel `git mv`, stale roadmap Phase 2 status).
- 2026-06-27 `active-markdown-trim`: actual effort M; S.U.P.E.R quick check S/P/E/R pass for API/HUB owner-file consolidation, source-owner routing, environment boundary cleanup, and verifier limits; unplanned dependencies 3 (WS event doc mixed Edge/Hub/fixture/manifest responsibilities, Hub README duplicated architecture/API/config, deployment README duplicated live-infra and env facts).
- 2026-06-27 `active-markdown-trim-ci-fix`: actual effort S; S.U.P.E.R quick check S/P/R pass for event owner coverage, parser/test contract routing, and concise active-doc inventory; unplanned dependencies 1 (CI exposed missing `run.agent.text_block` coverage after trimming `api/events.md`).
- 2026-06-27 `module-readme-trim`: actual effort M; S.U.P.E.R quick check S/P/R pass for module README ownership, stale-link blocking, archive routing, and verifier reuse; unplanned dependencies 2 (Web README embedded long screenshot evidence, Desktop/reference docs linked removed architecture/SOP paths).

## Next Steps

1. Review and merge `docs/module-readme-trim` for #344 / T3.0b, then start Phase 3 from #330 / T3.1 with a fresh spec checkpoint and a new branch/worktree from `dev/delicious233`.
2. Keep Phase 3 chat transcript source/test implementation separate from this module-doc cleanup patch.
3. Preserve the evidence boundary: fixture/stub/readiness/dry gates stay `real_tested=false` unless an approved-real path is explicitly executed.
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
| 2026-06-27 | phase-2-real-e2e-contract | Implemented Phase 2 contract cleanup: canonical evidence matrix and machine labels live only in `real-e2e-acceptance`; workflow docs now reference that skill; new `verify-real-e2e-contract.ps1` is wired into CI validate and CI policy verifiers; smoke matrix uses canonical `approved-real` and `packaged-release` labels while keeping readiness/dry scope in claim/status; roadmap stale Mobile blocker wording was replaced with bounded evidence; architecture Visual QA now names `1440x810` as primary Desktop/Web viewport. Verification: real E2E contract verifier, doc SSOT, project skill whitelist, PS/Bash CI policy, shared data-mode contract Vitest 5/5, skip-only smoke manifest, Web stubbed-Hub smoke matrix, and Desktop/Web 1440x810 visual chat-flow checks passed. |
| 2026-06-27 | active-doc-degianting | Added issue #339 and aggressively archived stale/duplicated active docs: old longform roadmap, obsolete root state snapshot, duplicate contributing/API reference docs, dated audits, release/merge notes, one-off plans, deprecated designs, old test-result snapshots, cc-switch/design reports, and third-party project research. Active entrypoints are now concise `AGENTS.md`, `CONTRIBUTING.md`, `docs/README.md`, `docs/roadmap.md`, `docs/api-reference.md`, and `docs/reference/README.md`; `verify-doc-ssot.ps1` blocks old active paths and entrypoint bloat. Verification: doc SSOT, real E2E contract, project skill whitelist, PS/Bash CI policy, readiness/gold-path scripts, Desktop targeted Vitest 22/22, shared data-mode contract 5/5, Desktop/Web typecheck, Web stubbed-Hub smoke matrix, and Desktop/Web 1440x810 Visual QA passed. |
| 2026-06-27 | phase-2-ci-fix | PR #340 CI showed `validate` failing on a `docs/roadmap.md` stale root-rule filename and `Backend E2E (fixture-only)` failing on a missing P0 remote-control topology sentence. Fixed the roadmap without widening scope. Verification: `verify-doc-ssot.ps1` and `verify-p0-remote-control-fixture.ps1` passed locally. |
| 2026-06-27 | phase-2-merged | PR #340 merged into `dev/delicious233` with all checks green. Because the PR target was not the default branch, #326-#329 and #339 were closed manually with merge evidence; Phase 2 milestone #11 is closed with 0 open / 5 closed issues. Phase 3 begins at #330 after the next spec checkpoint. |
| 2026-06-27 | active-doc-regroup | Operator requested aggressive active-doc cleanup before Phase 3 implementation. Created `docs/active-doc-regroup`, archived old longform architecture/security/changelog/threat-model/reference/screenshot checklist snapshots, rebuilt concise owner docs, shortened quickstart, and tightened `verify-doc-ssot.ps1` line limits to prevent active entrypoint bloat. |
| 2026-06-27 | active-doc-regroup-merged | PR #341 merged into `dev/delicious233`; local main fast-forwarded to `34d9e318`; `.worktrees/active-doc-regroup` and local/remote `docs/active-doc-regroup` branch are gone. |
| 2026-06-27 | active-markdown-trim | Operator expanded the active goal to full branch/rule/doc/source/test governance. Created `docs/active-markdown-trim` from `dev/delicious233` to finish active Markdown consolidation before Phase 3 implementation. |
| 2026-06-27 | active-markdown-trim-ci-fix | PR #343 CI showed Edge/cross-platform/benchmark failures from `TestEventDocsCoverRuntimeAdapterEvents`; `api/events.md` now keeps a compact runtime adapter inventory instead of restoring the old long event table. Verification: adapter contract test, adapters short test, doc SSOT, real E2E contract, project skill whitelist, OpenAPI YAML parse, and `git diff --check` passed locally. |
| 2026-06-27 | module-readme-trim | Added #344 / T3.0b and created `docs/module-readme-trim` from merged baseline. Archived old Web/Desktop/Edge/Hub-test/load-scenario longform docs, rebuilt concise active module README/reference entries, and extended `verify-doc-ssot.ps1` to block stale module links and active-doc bloat. Verification: doc SSOT, stale-link scan, real E2E contract, project skill whitelist, OpenAPI YAML parse, and `git diff --check` passed locally. |
