# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-20
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: Phases 1–73 · P74 through rescore-8 (#1295) · P75 via #1310 (#1304–#1309) · P76 in flight (#1311–#1314)

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
- **Phase 76**: `gh issue list -R TokenDanceLab/AgentHub --milestone "Phase 76: Chat + Inspector density" --state open`

## References

- [visual-qa-scorecard](../analysis/visual-qa-scorecard.md)
- [visual-qa-score-2026-07-20-rescore-8](../analysis/visual-qa-score-2026-07-20-rescore-8.md)
- [07-design-system-ssot](../architecture/07-design-system-ssot.md)
- [P74–P75 handoff](../handoff/2026-07-20-phase-74-75-handoff.md)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–73 | Baseline through host ports | #22–#94 | closed |
| 74 | Light frosted glass + Visual QA | #95 | closed (gate ~79 Iterate; 0 open / 47 closed) |
| 75 | HiDPI fidelity + typography polish | #96 | closed via #1310 (0 open / 13 closed) |
| 76 | Chat + Inspector density | #97 | **active** (#1311–#1313 in PR; #1314 open) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #1197–#1270 foundation through empty/nav glass | closed |
| #1280–#1293 P74 density/dock/test platform | closed |
| #1304–#1309 P75 HiDPI/type | closed via #1310 |
| #1311 transcript density tokens | in flight (P76) |
| #1312 inspector single primary card | in flight (P76) |
| #1313 composer status zh visibility | in flight (P76) |
| #1314 Chat path visual:qa capture | open (P1 follow-up) |

## Quick Status Commands

```bash
gh issue list -R TokenDanceLab/AgentHub --milestone "Phase 76: Chat + Inspector density" --state open
git rev-parse --short origin/master
cd app && pnpm --filter agenthub-desktop visual:qa:shell
cd app && pnpm --filter agenthub-web visual:qa:shell
```

## Phase Checklist

- [x] Phase 0–73
- [x] Phase 74 frosted glass + Visual QA (gate min~79 Iterate; milestone 95 open=0/closed=47)
- [x] Phase 75 HiDPI + typography (#1304–#1309 via #1310)
- [ ] Phase 76 Chat + Inspector density (#1311–#1314)

## Current Status

**Active Phase**: 76 — Chat + Inspector density (milestone 97)
**Product tip**: `66f7fa93` (handoff) / P75 product `2f94b7f2`
**Rescore-8 gate**: min~**79**/100 (pre-P76; re-score after Chat density + capture)
**Gate history**: ~55 → 61 → 64 → 66 → 71 → 70 → ~75 → 70 → 76 → **79**
**P76 scope**: transcript denser rhythm · inspector single primary card · composer zh status · (#1314) chat visual:qa
**Blockers**: None
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git

## Next Steps (post-Phase 76 merge)

1. Merge P76 density PR → close #1311–#1313
2. #1314 Chat path shell capture → rescore toward Ship ≥85
3. Optional: Desktop path-filter visual:qa:shell CI

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-20 | lead | P76 milestone 97 + #1311–#1314; feat/p76-chat-density density PR |
| 2026-07-20 | lead | P75 merged #1310 closes #1304–#1309; tip 2f94b7f2; milestone 96 closed |
| 2026-07-20 | lead | P75 open: #1304–#1309 HiDPI+type; worktree feat/p75-hidpi-typography |
| 2026-07-20 | lead | Final neat-freak: milestone 95 closed, branches/worktrees pruned, .tmp-issues removed, MASTER synced; tip 727b7e93 |
| 2026-07-20 | lead | Rescore-8 min~79 (D82/D79/W82/W79); notes #1295 |
| 2026-07-19 | lead | Wave1–2 done: #1280/#1283–#1287 via #1288–#1293; tip 3ec43287; open set clear |
| 2026-07-19 | lead | Wave1: #1280 density, #1283 dock, #1284 geometry, #1285 copy, #1286 SSOT; #1287 CI |
| 2026-07-19 | lead | #1276 dual-scroll + zh copy; rescore-7 min~76; notes #1278 |
| 2026-07-19 | lead | Rescore-6 min~70; closed #1269–#1270 empty/nav glass |

## Completion notes

- Gate climbed ~55 → ~79; still Iterate (not Ship, −6).
- Web Agents empty void root-caused as single-scroll scroll-away; dual-scroll + zh copy landed.
- Test-platform Wave1 closed the unit/CSS/e2e blind spots for dock occlusion + list viewport + product EN meta.
- P75 HiDPI/type closed via #1310 (OpenType, fluid type, 2x glass, visual:qa DPR, 760 SSOT).
