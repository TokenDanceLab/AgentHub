# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: Phases 1–73 · P74 through #1261–#1263 / PRs #1265–#1267 · MASTER #1268

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
- [visual-qa-score-2026-07-19-rescore-5](../analysis/visual-qa-score-2026-07-19-rescore-5.md)
- [visual-qa-score-2026-07-19-rescore-6](../analysis/visual-qa-score-2026-07-19-rescore-6.md)
- [07-design-system-ssot](../architecture/07-design-system-ssot.md)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–73 | Baseline through host ports | #22–#94 | closed |
| 74 | Light frosted glass + Visual QA | #95 | active (Iterate residual toward Ship) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #1197–#1263 foundation through density/motion/a11y | closed |
| #1264 MASTER tip (prior) | closed |
| #1269 Agents installed empty list glass | open |
| #1270 Agents nav-row glass hover | open |
| #1271 rescore-6 notes + MASTER (this) | open |

## Quick Status Commands

```bash
gh issue list -R TokenDanceLab/AgentHub --milestone "Phase 74: Light frosted glass system + Visual QA" --state open
git rev-parse --short origin/master
cd app && pnpm --filter agenthub-desktop visual:qa:shell
cd app && pnpm --filter agenthub-web visual:qa:shell
```

## Phase Checklist

- [x] Phase 0–73
- [ ] Phase 74 frosted glass + Visual QA (gate min~70 Iterate; residual #1269–#1270)

## Current Status

**Active Phase**: 74 (visual score loop)
**Active Tasks**: #1269 Agents empty list glass · #1270 Agents nav hover glass
**Blockers**: None
**Product tip**: `88ddc886`
**Rescore-6 gate**: min~**70**/100 (D-light 81 · D-dark 77 · W-light 73 · W-dark 70)
**Gate history**: ~55 → 61 → 64 → 66 → 71 → 70 → ~75 → **70** (web empty list bound)
**Visual north star**: light white frosted glass, dense spacing, micro-motion, screenshot score loop
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git

## Next Steps

1. Agents installed empty list glass (#1269)
2. Agents nav-row glass hover (#1270)
3. Re-capture → re-score toward Ship >=85

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-19 | lead | Rescore-6 min~70; open #1269–#1270; notes #1271 |
| 2026-07-19 | lead | #1261–#1263 density/motion/a11y closed; Desktop ~81, Web empty list lag |

## Completion notes

- Gate climbed ~55 → ~70–81; still Iterate (not Ship).
- Highest weight: Agents installed empty void + nav hover solid.
