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
| 3 | Scripts and Tests Wrapper Migration | https://github.com/TokenDanceLab/AgentHub/milestone/14 | 2 | 0 |
| 4 | Final Wrapper and Root Hygiene Cleanup | https://github.com/TokenDanceLab/AgentHub/milestone/15 | 1 | 0 |
| 5 | Acceptance and SPEC Archive | https://github.com/TokenDanceLab/AgentHub/milestone/16 | 1 | 0 |

## Phase Checklist

- [x] Phase 1: Design and Reference Graph Baseline (2/2 tasks)
- [x] Phase 2: Docs Archive and ADR Migration (2/2 tasks)
- [ ] Phase 3: Scripts and Tests Wrapper Migration (0/2 tasks)
- [ ] Phase 4: Final Wrapper and Root Hygiene Cleanup (0/1 tasks)
- [ ] Phase 5: Acceptance and SPEC Archive (0/1 tasks)

## Issue Mapping

| Task ID | Issue | Status |
|---|---|---|
| T1.1 | #360 | closed |
| T1.2 | #361 | closed |
| T2.1 | #362 | closed |
| T2.2 | #363 | closed |
| T3.1 | #364 | in progress |
| T3.2 | #365 | pending |
| T4.1 | #366 | pending |
| T5.1 | #367 | pending |

## Current Status

**Active Phase**: Phase 3 - Scripts and Tests Wrapper Migration

**Active Task**: #364 / T3.1 - Reorganize `scripts/` wrapper-first.

**Current Focus**: Move script implementations into `scripts/verify`, `scripts/dev`, `scripts/release`, `scripts/smoke`, and `scripts/lib` while preserving old root script paths as compatibility wrappers.

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
- T2.2 completed by PR #371; drift 0. Phase 2 milestone #13 is closed.
- T3.1 worktree validation: root script wrappers preserved, implementations moved under categorized script dirs, PowerShell wrappers propagate implementation exit codes, and script contract tests read implementation paths while executing old compatibility paths. Local gates passed: `git diff --check`, `verify-doc-ssot`, `verify-project-skills`, `verify-real-e2e-contract`, `verify-ci-gates`, OpenAPI YAML parse, `go test ./tests/teamrun -count=1`, `verify-tauri-package-readiness`, `verify-tauri-installer-smoke`, `verify-p0-remote-control-fixture`, `tests/scripts/verify-p0-remote-control-fixture`, `tests/scripts/verify-tauri-package-readiness`, `tests/scripts/verify-tauri-package-dry`, and `tests/scripts/verify-p0-desktop-edge-cli-smoke`. Drift 0.
- T3.1 non-blocking observation: `verify-packaged-login-real-readiness` still fails on pre-existing `docs/roadmap.md` future-OIDC prerequisite wording, not on wrapper routing; leave that to the owning login/readiness slice instead of expanding this scripts-wrapper PR.
- T3.1 CI correction: PR #372 `validate` failed because Bash wrappers directly exec categorized `.sh` implementations and the new implementation files lacked executable bits. Set executable bits on categorized Bash implementations, renamed the localhost observed-loop fixture id from a `task-` prefix to a `run-` prefix, and rewrote redaction regex literals so newly added script content does not trip secret guard false positives. Drift 0.

## Quick Status Commands

```powershell
gh issue list -R TokenDanceLab/AgentHub --label "spec:repo-structure-doc-tooling-cleanup" --state all
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.title | startswith("Repo Structure Cleanup")) | "\(.title): \(.open_issues) open, \(.closed_issues) closed"'
git status --short --branch
git worktree list
```
