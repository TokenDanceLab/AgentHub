# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: Phases 1–73 · P74 through residual #1225–#1228 / PRs #1229–#1232

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
- [visual-qa-score-2026-07-19-rescore](../analysis/visual-qa-score-2026-07-19-rescore.md)
- [visual-qa-score-2026-07-19-rescore-2](../analysis/visual-qa-score-2026-07-19-rescore-2.md)
- [07-design-system-ssot](../architecture/07-design-system-ssot.md)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–73 | Baseline through host ports | #22–#94 | closed |
| 74 | Light frosted glass + Visual QA | #95 | active (rescore-2 residual open) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #1197–#1224 foundation · consumers · score residual 1 | closed |
| #1225–#1228 empty/web/dark/notes | closed PRs #1229–#1232 |
| #1233 browser/preview glass void | open |
| #1234 light main canvas white frost | open |
| #1235 Web shell frost catch-up | open |
| #1236 rescore-2 notes + MASTER | open (this) |

## Quick Status Commands

```bash
gh issue list -R TokenDanceLab/AgentHub --milestone 95 --state open
git rev-parse --short origin/master
cd app && pnpm --filter agenthub-desktop visual:qa:shell
cd app && pnpm --filter agenthub-web visual:qa:shell
```

## Phase Checklist

- [x] Phase 0–73
- [ ] Phase 74 frosted glass + Visual QA (gate min≈64; residual #1233–#1235)

## Current Status

**Active Phase**: 74 (visual score loop)
**Active Tasks**: #1233 preview glass · #1234 light canvas frost · #1235 web shell catch-up
**Blockers**: None
**Product tip**: `6cf91f30`
**Rescore-2 gate**: min≈**64**/100 (D-light 73 · D-dark 69 · W-light 66 · W-dark 64)
**Visual north star**: light white frosted glass, dense spacing, micro-motion, screenshot score loop
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git

## Next Steps

1. Browser/preview pane glass frame (#1233)
2. Light main canvas white frost (#1234)
3. Web shell catch-up (#1235)
4. Re-capture → re-score until Ship ≥85

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-19 | lead | Rescore-2 min≈64; open #1233–#1235; notes #1236 |
| 2026-07-19 | lead | Residual wave #1225–#1228 closed (#1229–#1232) |

## Completion notes

- Gate climbed ~55 → 61 → 64; still Block.
- Highest weight: pure white browser void · muddy light canvas · Web lag.
