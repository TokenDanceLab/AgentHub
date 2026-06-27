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
| 2 | Docs Archive and ADR Migration | https://github.com/TokenDanceLab/AgentHub/milestone/13 | 0 | 2 |
| 3 | Scripts and Tests Wrapper Migration | https://github.com/TokenDanceLab/AgentHub/milestone/14 | 0 | 2 |
| 4 | Final Wrapper and Root Hygiene Cleanup | https://github.com/TokenDanceLab/AgentHub/milestone/15 | 1 | 0 |
| 5 | Acceptance and SPEC Archive | https://github.com/TokenDanceLab/AgentHub/milestone/16 | 1 | 0 |

## Phase Checklist

- [x] Phase 1: Design and Reference Graph Baseline (2/2 tasks)
- [x] Phase 2: Docs Archive and ADR Migration (2/2 tasks)
- [x] Phase 3: Scripts and Tests Wrapper Migration (2/2 tasks)
- [ ] Phase 4: Final Wrapper and Root Hygiene Cleanup (0/1 tasks)
- [ ] Phase 5: Acceptance and SPEC Archive (0/1 tasks)

## Issue Mapping

| Task ID | Issue | Status |
|---|---|---|
| T1.1 | #360 | closed |
| T1.2 | #361 | closed |
| T2.1 | #362 | closed |
| T2.2 | #363 | closed |
| T3.1 | #364 | closed |
| T3.2 | #365 | closed |
| T4.1 | #366 | PR #374 pending CI |
| T5.1 | #367 | pending |

## Current Status

**Active Phase**: Phase 4 - Final Wrapper and Root Hygiene Cleanup

**Active Task**: #366 / T4.1 - Remove wrappers and root one-off evidence.

**Current Focus**: T4.1 local validation passed in PR #374; waiting for CI before merge.

## Governance Status

**Shared instruction surface**: `AGENTS.md`

**Platform-specific instruction surfaces**: none

**Memory surface**: native Codex memory; no repo fallback selected

## Execution Telemetry

- T1.1 started after previous repo governance SPEC was archived and all its milestones closed.
- Initial reference graph found direct active references to history trees, ADRs, root script wrappers, the legacy script-test directory, and Desktop readiness script paths.
- T1.1 completed by PR #368; drift 0.
- T1.2 receiver worktree selected: `D:\Code\TokenDance\.worktrees\tokendance-docs-agenthub-archive` on branch `docs/agenthub-archive-receiver`; dirty docs main checkout is not used for writes.
- T1.2 completed by PR #369; drift 0. Phase 1 milestone #12 is closed.
- T2.1 external archive commit: TokenDanceLab/docs merge commit `8417e00b` (source commit `e94cb7d`) on PR #1, containing former AgentHub history trees under `archive/agenthub/repo/docs/`.
- T2.1 completed by PR #370; drift 0. T2.2 external ADR archive commit: TokenDanceLab/docs merge commit `50c360e` (source commit `4fe876b`) on PR #2, containing old ADR bodies under `archive/agenthub/repo/docs/adr/`.
- T2.2 completed by PR #371; drift 0. Phase 2 milestone #13 is closed.
- T3.1 worktree validation: root script wrappers preserved, implementations moved under categorized script dirs, PowerShell wrappers propagate implementation exit codes, and script contract tests read implementation paths while executing old compatibility paths. Local gates passed: `git diff --check`, `verify-doc-ssot`, `verify-project-skills`, `verify-real-e2e-contract`, `verify-ci-gates`, OpenAPI YAML parse, `go test ./tests/teamrun -count=1`, `verify-tauri-package-readiness`, `verify-tauri-installer-smoke`, `verify-p0-remote-control-fixture`, and focused script contract gates for P0 remote control, Tauri package readiness/dry, and P0 Desktop/Edge/CLI smoke. Drift 0.
- T3.1 non-blocking observation: `verify-packaged-login-real-readiness` still fails on pre-existing `docs/roadmap.md` future-OIDC prerequisite wording, not on wrapper routing; leave that to the owning login/readiness slice instead of expanding this scripts-wrapper PR.
- T3.1 CI correction: PR #372 `validate` failed because Bash wrappers directly exec categorized `.sh` implementations and the new implementation files lacked executable bits. Set executable bits on categorized Bash implementations, renamed the localhost observed-loop fixture id from a `task-` prefix to a `run-` prefix, and rewrote redaction regex literals so newly added script content does not trip secret guard false positives. Drift 0.
- T3.1 completed by PR #372, merge commit `ffe82137`; issue #364 was closed manually because GitHub did not auto-close a PR merged into non-default `dev/delicious233`. Drift 0.
- T3.2 started in worktree `.worktrees/repo-structure-cleanup-365` on branch `docs/365-tests-contract-path`.
- T3.2 validation: moved script contract tests and fixtures from the legacy script-test directory to `tests/contract/scripts`; updated release-readiness path filters and active script callers; legacy path reference scan returned no active references. Local gates passed: `git diff --check`, Git-for-Windows `bash scripts/verify/check-secrets.sh --worktree`, `verify-doc-ssot`, `verify-project-skills`, `verify-real-e2e-contract`, OpenAPI YAML parse, `go test ./tests/teamrun -count=1`, `verify-ci-gates`, root wrapper gates `verify-p0-remote-control-fixture` and `verify-tauri-package-readiness`, focused contract gates for approved-real preflight, P0 Desktop/Edge/CLI smoke, P0 remote-control fixture, Tauri package readiness/dry, and Desktop/Web frontend gates (`agenthub-desktop typecheck + test:ci`, `agenthub-web lint + build + test`). Web lint reported existing warnings only. Drift 0.
- T3.2 completed by PR #373, merge commit `9bd1da79`; issue #365 was closed manually because GitHub did not auto-close a PR merged into non-default `dev/delicious233`. Phase 3 milestone #14 is closed. Drift 0.
- T4.1 started in worktree `.worktrees/repo-structure-cleanup-366` on branch `docs/366-wrapper-root-hygiene`.
- T4.1 external root evidence archive: TokenDanceLab/docs PR #3 merged at `bc774192` (source commit `6cb00e9`), storing `css-audit-results.json` under `archive/agenthub/repo/root-evidence/` with SHA256 `B9018084D892895D566D1D84A2F27094FBB75278A9A022F11796C914BB2A76ED`.
- T4.1 local validation: root `scripts/` contains only `dev`, `lib`, `release`, `smoke`, and `verify`; `css-audit-results.json` is removed; stale wrapper/reference scans for old root paths, `scripts/evidence`, `scripts/git-hooks`, and bad nested `tests/contract/scripts/{verify,smoke,release,dev,lib}` paths returned no active hits.
- T4.1 gates passed: `git diff --check`, `verify-doc-ssot`, `verify-project-skills`, `verify-real-e2e-contract`, `verify-ci-gates`, OpenAPI YAML parse, Git-for-Windows secret guard, `go test ./tests/teamrun -count=1`, `edge-server go test ./... -short -count=1`, root categorized gates for P0 remote-control fixture and Tauri package readiness/dry, focused script contract gates for approved-real preflight, P0 remote fixture, Tauri package readiness/dry, and P0 Desktop/Edge/CLI smoke, plus Desktop typecheck/test:ci and Web lint/build/test. Web lint still reports existing warnings only. Drift 0.
- T4.1 evidence boundary: these gates are static, fixture, renderer, dry package, and short backend tests. They do not claim real TokenDance ID login, real CLI/model/API spend, production deploy, signed installer, release upload, or packaged-runtime execution.
- T4.1 PR: #374 opened against `dev/delicious233`; awaiting CI before merge.

## Quick Status Commands

```powershell
gh issue list -R TokenDanceLab/AgentHub --label "spec:repo-structure-doc-tooling-cleanup" --state all
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.title | startswith("Repo Structure Cleanup")) | "\(.title): \(.open_issues) open, \(.closed_issues) closed"'
git status --short --branch
git worktree list
```
