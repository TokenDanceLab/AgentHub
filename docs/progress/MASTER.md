# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: Phases 1–73 · P74 through #1251–#1252 / PRs #1253–#1254

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
- **Phase 74**: `gh issue list -R TokenDanceLab/AgentHub --milestone 95 --state open`

## References

- [visual-qa-scorecard](../analysis/visual-qa-scorecard.md)
- [visual-qa-score-2026-07-19-rescore-5](../analysis/visual-qa-score-2026-07-19-rescore-5.md)
- [07-design-system-ssot](../architecture/07-design-system-ssot.md)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–73 | Baseline through host ports | #22–#94 | closed |
| 74 | Light frosted glass + Visual QA | #95 | active (Iterate residual toward Ship) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #1197–#1252 foundation through dark blank + notes | closed |
| #1255 Agents detail form glass | open |
| #1256 Terminal/inspector empty glass | open |
| #1257 MASTER tip (this) | open |

## Quick Status Commands

```bash
gh issue list -R TokenDanceLab/AgentHub --milestone 95 --state open
git rev-parse --short origin/master
cd app && pnpm --filter agenthub-desktop visual:qa:shell
cd app && pnpm --filter agenthub-web visual:qa:shell
```

## Phase Checklist

- [x] Phase 0–73
- [ ] Phase 74 frosted glass + Visual QA (gate min~72–78 Iterate; residual #1255–#1256)

## Current Status

**Active Phase**: 74 (visual score loop)
**Active Tasks**: #1255 Agents form glass · #1256 empty panels glass
**Blockers**: None
**Product tip**: `3800ee40`
**Latest gate**: min~**72–78**/100 Iterate after dark blank fix (Ship >=85)
**Gate history**: ~55 → 61 → 64 → 66 → 71 → 70 → **~75** (dark blank fixed)
**Visual north star**: light white frosted glass, dense spacing, micro-motion, screenshot score loop
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git

## Next Steps

1. Agents detail form glass + density (#1255)
2. Terminal/inspector empty glass (#1256)
3. Re-capture → re-score toward Ship >=85

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-19 | lead | #1251 dark blank closed; open Ship residual #1255–#1256; MASTER #1257 |
| 2026-07-19 | lead | Continuous visual residual waves; gate climbed ~55→~75 |

## Completion notes

- Gate climbed ~55 → ~75; still Iterate (not Ship).
- Highest weight: Agents form density · empty panel glass.
