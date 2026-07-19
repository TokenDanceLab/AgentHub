# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: Phases 1–73 · P74 through residual #1233–#1235 / PRs #1237–#1240

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
- [visual-qa-score-2026-07-19-rescore-3](../analysis/visual-qa-score-2026-07-19-rescore-3.md)
- [07-design-system-ssot](../architecture/07-design-system-ssot.md)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–73 | Baseline through host ports | #22–#94 | closed |
| 74 | Light frosted glass + Visual QA | #95 | active (rescore-3 residual open) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #1197–#1232 foundation through residual waves 1–2 | closed |
| #1233–#1235 / PRs #1238–#1240 preview · light canvas · web catch-up | closed |
| #1236 / PR #1237 rescore-2 notes | closed |
| #1241 preview iframe empty fill | open |
| #1242 web shell capture frosted page | open |
| #1243 rescore-3 notes + MASTER | open (this) |

## Quick Status Commands

```bash
gh issue list -R TokenDanceLab/AgentHub --milestone 95 --state open
git rev-parse --short origin/master
cd app && pnpm --filter agenthub-desktop visual:qa:shell
cd app && pnpm --filter agenthub-web visual:qa:shell
```

## Phase Checklist

- [x] Phase 0–73
- [ ] Phase 74 frosted glass + Visual QA (gate min≈66; residual #1241–#1242)

## Current Status

**Active Phase**: 74 (visual score loop)
**Active Tasks**: #1241 iframe empty fill · #1242 web capture page surface
**Blockers**: None
**Product tip**: `9c19e98f`
**Rescore-3 gate**: min≈**66**/100 (D-light 75 · D-dark 71 · W-light 69 · W-dark 66)
**Gate history**: ~55 → 61 → 64 → **66** (Ship ≥85)
**Visual north star**: light white frosted glass, dense spacing, micro-motion, screenshot score loop
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git

## Next Steps

1. Preview iframe empty document fill (#1241)
2. Web visual:qa:shell frosted page surface (#1242)
3. Re-capture → re-score until Ship ≥85

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-19 | lead | Rescore-3 min≈66; open #1241–#1242; notes #1243 |
| 2026-07-19 | lead | Residual #1233–#1235 closed (#1238–#1240); gate 64→66 |

## Completion notes

- Gate climbed ~55 → 61 → 64 → 66; still Block.
- Highest weight: pure white iframe document · web capture under-represents frost.
