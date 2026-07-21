# AgentHub Progress Tracker

> **Task**: post-polish residual hardening — **complete** (docs authority + mobile hubClient strangler)
> **Started**: 2026-07-16 (Visual polish); residual program 2026-07-20; closed 2026-07-21
> **Last Updated**: 2026-07-21
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`

## Progress index (no open residual program)

| Item | Value |
|---|---|
| Active SPEC | **None** — residual Phases 79–80 closed; pick next from [roadmap P0/P1](../roadmap.md) |
| Closed residual analysis | [post-polish-project-overview](../analysis/post-polish-project-overview.md) · [module-inventory](../analysis/post-polish-module-inventory.md) · [risk-assessment](../analysis/post-polish-risk-assessment.md) |
| Closed residual plan | [task-breakdown](../plan/post-polish-task-breakdown.md) · [dependency-graph](../plan/post-polish-dependency-graph.md) · [milestones](../plan/post-polish-milestones.md) |
| Strategy (delivered) | Strangler Fig — thin mobile hubClient + docs authority; **no** big-bang rewrite; **no** static Visual QA chase past 89 |
| Tracking | Issues **#1335–#1339** (closed) · GH milestones **98–99** (closed) · PRs **#1340** / **#1341** / **#1342** |

### Residual phases (closed 2026-07-21)

| Phase | Name | Milestone | Issues | Status |
|:------|:-----|:----------|:-------|:-------|
| 79 | Docs Authority + Gates Hygiene | 98 | #1335 #1336 | **closed** · PR #1340 |
| 80 | Mobile hubClient Strangler | 99 | #1337 #1338 #1339 | **closed** · PR #1341 (~737→~342 LOC Proxy thin) |

### Closed polish phases (2026-07-20)

| Phase | Name | Status |
|:------|:-----|:-------|
| 73 | Engineering loop host ports + import entry | closed |
| 74 | Light frosted glass + Visual QA | closed |
| 75 | HiDPI fidelity + typography | closed |
| 76 | Chat + Inspector density | closed |
| 77 | Agents density + blank browser + terminal dock | closed |
| 78 | A11y focus + Glass border/shadows/elevation + CI path-filter | closed |

Historical cleanup-baseline plan under `docs/plan/task-breakdown.md` (and siblings) is **HISTORICAL only** — not live backlog.

**No open residual-program phases.** Next work: pick from roadmap P0/P1 (E2E contract, chat reliability, deploy-only security evidence) — not static Visual QA past 89.

## Product tip & Visual QA

**Product tip**: `1ac86aa5` (post #1340–#1343)
**Gate**: **89**/100 — 🟢🟢🟢 **SHIP**
**Gate history**: 55 → 76 → 79 → 82 → 84 → 85 → 87 → 88 → **89**

### Dimension grid (7/9 maxed)

| Dim | Score | Max | Status |
|-----|-------|-----|--------|
| Glass | 18 | 18 | ✅ |
| Hierarchy | 14 | 14 | ✅ |
| Spacing | 14 | 14 | ✅ |
| Light | 12 | 12 | ✅ |
| Dark | 8 | 8 | ✅ |
| A11y | 8 | 8 | ✅ |
| Empty | 5 | 6 | ⏳ multi-state needed |
| Type | 9 | 10 | ⏳ zh refinement |
| Motion | 9 | 10 | ⏳ interactive eval |

References: [visual-qa-scorecard](../analysis/visual-qa-scorecard.md) · [rescore-17-final](../analysis/visual-qa-score-2026-07-20-rescore-17-final.md) · [_archive/](../analysis/_archive/)

### Methodology ceiling

Remaining 3pt (Type/Motion/Empty) require interactive testing, multi-state data, or multi-component CJK font changes — beyond static 1440×810 screenshot evaluation. **Do not chase gate past 89** under residual program.

## Infrastructure & gates hygiene

### CI path-filter

- Unified `changes` job (`dorny/paths-filter@v3`) in `.github/workflows/checks.yml`
- Go-only PR skips frontend CI; CSS-only PR skips Go CI
- Estimated savings: up to ~20 CI minutes per PR

### Backend perf / leak gates (T79.2 evidence)

| Item | State | Note |
|---|---|---|
| `scripts/verify/verify-backend-perf-leak-gates.ps1` | **PASS** (behavior + short microbench) | Not production capacity |
| [backend-performance-gates.md](../reference/backend-performance-gates.md) | Active owner (dated 2026-06-27) | Evidence classes: behavior / microbench / load smoke / pprof |
| Capacity claim | **Not claimed** | Load smoke / pprof still path-specific; no “production capacity proven” language |

Optional future: wire script as `workflow_dispatch` only — not every PR (see residual risk assessment T5).

## Explicit out of scope (residual)

- Live OIDC / secret rotation / packaged Desktop evidence
- Full Mobile UI redesign
- Static Visual QA gate chase past 89
- Edge handlers further split without concrete API change

## Session Log

| Date | Summary |
|:-----|:--------|
| 2026-07-20 | 🟢🟢🟢 **Ship 89** — polish Phases 73–78 closed; CI path-filter; docs rescore archive |
| 2026-07-20 | SDD Phase 0–1: post-polish analysis trio committed |
| 2026-07-21 | Residual program delivered: Phase 79 #1340 + Phase 80 #1341; milestones 98–99 closed; hubClient ~342 LOC |
| 2026-07-21 | Closeout #1342 + SSOT sync #1343 · tip `1ac86aa5`; analysis inventory marked delivered |
