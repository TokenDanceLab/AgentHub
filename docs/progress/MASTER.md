# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-20
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: Phases 1–73 · P74 through rescore-8 (#1295)

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
- **Phase 74**: `gh issue list -R TokenDanceLab/AgentHub --milestone "Phase 74: Light frosted glass system + Visual QA" --state open`

## References

- [visual-qa-scorecard](../analysis/visual-qa-scorecard.md)
- [visual-qa-score-2026-07-19-rescore-6](../analysis/visual-qa-score-2026-07-19-rescore-6.md)
- [visual-qa-score-2026-07-19-rescore-7](../analysis/visual-qa-score-2026-07-19-rescore-7.md)
- [07-design-system-ssot](../architecture/07-design-system-ssot.md)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–73 | Baseline through host ports | #22–#94 | closed |
| 74 | Light frosted glass + Visual QA | #95 | active (Iterate residual toward Ship) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #1197–#1270 foundation through empty/nav glass | closed |
| #1271 rescore-6 notes | closed |
| #1275 Agents dual-scroll | closed via #1276 |
| #1277 Agents Chinese-first copy | closed via #1276 |
| #1278 rescore-7 + MASTER | closed via #1279 |
| #1280 Agents detail density | closed via #1290 |
| #1282–#1283 terminal dock right columns | closed |
| #1284 geometry smoke | closed via #1291 |
| #1285 zh product-copy contract | closed via #1289 |
| #1286 visual QA 1440×810 SSOT | closed via #1288 |
| #1287 path-filter visual:qa:shell CI | closed via #1293 |

## Quick Status Commands

```bash
gh issue list -R TokenDanceLab/AgentHub --milestone "Phase 74: Light frosted glass system + Visual QA" --state open
git rev-parse --short origin/master
cd app && pnpm --filter agenthub-desktop visual:qa:shell
cd app && pnpm --filter agenthub-web visual:qa:shell
```

## Phase Checklist

- [x] Phase 0–73
- [ ] Phase 74 frosted glass + Visual QA (gate min~79 Iterate; residual toward Ship ≥85)

## Current Status

**Active Phase**: 74 (visual score loop)
**Active Tasks**: #1295 rescore-8 notes (this) · residual toward Ship if still Iterate
**Blockers**: None
**Product tip**: `db2c2ec7`
**Rescore-8 gate**: min~**79**/100 (D-light 82 · D-dark 79 · W-light 82 · W-dark 79)
**Gate history**: ~55 → 61 → 64 → 66 → 71 → 70 → ~75 → 70 → 76 → **79**
**Visual north star**: light white frosted glass, dense spacing, micro-motion, Chinese-first product copy, screenshot score loop
**Test platform**: geometry smoke + zh copy contract + terminal dock CSS + path-filter visual:qa:shell CI (non-blank)
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git

## Next Steps

1. Land rescore-8 notes (#1295)
2. Highest residual: Desktop chat inspector density + Agents form collapse
3. Optional: Desktop path-filter visual:qa:shell job
4. Re-capture when residual lands → Ship ≥85

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-20 | lead | Rescore-8 min~79 (D82/D79/W82/W79); notes #1295 |
| 2026-07-19 | lead | Wave1–2 done: #1280/#1283–#1287 via #1288–#1293; tip 3ec43287; open set clear |
| 2026-07-19 | lead | Wave1: #1280 density, #1283 dock, #1284 geometry, #1285 copy, #1286 SSOT; #1287 CI |
| 2026-07-19 | lead | #1276 dual-scroll + zh copy; rescore-7 min~76; notes #1278 |
| 2026-07-19 | lead | Rescore-6 min~70; closed #1269–#1270 empty/nav glass |

## Completion notes

- Gate climbed ~55 → ~79; still Iterate (not Ship, −6).
- Web Agents empty void root-caused as single-scroll scroll-away; dual-scroll + zh copy landed.
- Test-platform Wave1 closed the unit/CSS/e2e blind spots for dock occlusion + list viewport + product EN meta.
