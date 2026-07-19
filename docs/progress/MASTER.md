# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-20
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: Phases 1–73 · P74 rescore-8 (#1295) · P75 #1310 · **P76 #1315** (#1311–#1314)

## Two task surfaces (do not mix)

| Surface | Role | NOT for |
|---|---|---|
| **GitHub Project + Issues** | **程序唯一任务清单 / 进度 SSOT** | 会话临时想法 |
| **Claude TaskList** | 仅本会话微编排 | 程序 backlog、跨会话进度 |

规则：跨会话可交付工作只进 GitHub Issue；Workflow/PR 必须绑定 Issue。

## Management model

1. SPEC in-repo + MASTER
2. GitHub Project board
3. Milestones = Phases · Issues = 原子任务
4. PR closes Issue
5. wiki 非第二 SSOT

## GitHub Resources

- **Project Board**: https://github.com/users/DeliciousBuding/projects/6
- **Phase 76 (closed)**: `gh issue list -R TokenDanceLab/AgentHub --milestone "Phase 76: Chat + Inspector density" --state all`

## References

- [visual-qa-scorecard](../analysis/visual-qa-scorecard.md)
- [visual-qa-score-2026-07-20-rescore-8](../analysis/visual-qa-score-2026-07-20-rescore-8.md)
- [07-design-system-ssot](../architecture/07-design-system-ssot.md)
- [P74–P75 handoff](../handoff/2026-07-20-phase-74-75-handoff.md)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–73 | Baseline through host ports | #22–#94 | closed |
| 74 | Light frosted glass + Visual QA | #95 | closed (gate ~79 Iterate) |
| 75 | HiDPI fidelity + typography polish | #96 | closed via #1310 |
| 76 | Chat + Inspector density | #97 | **closed** via #1315 (0 open / 4 closed) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #1304–#1309 P75 HiDPI/type | closed via #1310 |
| #1311 transcript density | closed via #1315 |
| #1312 inspector single primary card | closed via #1315 |
| #1313 composer status zh | closed via #1315 |
| #1314 Chat path visual:qa | closed via #1315 |

## Quick Status Commands

```bash
git rev-parse --short origin/master
cd app && pnpm --filter agenthub-desktop visual:qa:shell
cd app && pnpm --filter agenthub-web visual:qa:shell
cd app && pnpm --filter agenthub-desktop visual:qa:chat
cd app && pnpm --filter agenthub-web visual:qa:chat
```

## Phase Checklist

- [x] Phase 0–73
- [x] Phase 74 frosted glass + Visual QA (gate min~79 Iterate)
- [x] Phase 75 HiDPI + typography (#1304–#1309 via #1310)
- [x] Phase 76 Chat + Inspector density (#1311–#1314 via #1315)

## Current Status

**Active Phase**: 76 complete — milestone 97 closed (0 open / 4 closed) via #1315
**Product tip**: `ad911aba` (P76 Chat density)
**Rescore-8 gate**: min~**79**/100 (pre-P76 Agents shell; re-score recommended with Chat path)
**Gate history**: ~55 → … → 76 → **79**
**P76 landed**: transcript denser rhythm · inspector overview-only default · composer zh status · `visual:qa:chat`
**Blockers**: None
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git

## Next Steps (post-Phase 76)

1. Capture shell + chat 1x (and optional 2x) → rescore toward Ship ≥85
2. Optional: Desktop path-filter visual:qa:shell CI
3. Optional: Agents form further collapse / first-success E2E

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-20 | lead | P76 merged #1315 closes #1311–#1314; tip ad911aba; milestone 97 closed |
| 2026-07-20 | lead | P76 milestone 97 + density PR; CI fix on-demand tabs; visual:qa:chat |
| 2026-07-20 | lead | P75 merged #1310; tip 2f94b7f2; milestone 96 closed |
| 2026-07-20 | lead | Rescore-8 min~79 (D82/D79/W82/W79); notes #1295 |

## Completion notes

- Gate climbed ~55 → ~79; still Iterate (not Ship, −6 pre-P76).
- P76 targets Desktop chat inspector + transcript residual named in rescore-8.
- Inspector tabs beyond overview are on-demand; files section default collapsed.
- `visual:qa:chat` is optional density review — does **not** replace Agents shell merge gate.
