# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: Phases 1–73 · P74 through residual #1241–#1242 / PRs #1244–#1246

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
- [visual-qa-score-2026-07-19-rescore-3](../analysis/visual-qa-score-2026-07-19-rescore-3.md)
- [visual-qa-score-2026-07-19-rescore-4](../analysis/visual-qa-score-2026-07-19-rescore-4.md)
- [07-design-system-ssot](../architecture/07-design-system-ssot.md)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–73 | Baseline through host ports | #22–#94 | closed |
| 74 | Light frosted glass + Visual QA | #95 | active (rescore-4 Iterate residual) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #1197–#1242 foundation through residual waves | closed |
| #1243 rescore-3 notes | closed PR #1244 |
| #1247 demo preview themed blank | open |
| #1248 rescore-4 notes + MASTER | open (this) |

## Quick Status Commands

```bash
gh issue list -R TokenDanceLab/AgentHub --milestone 95 --state open
git rev-parse --short origin/master
cd app && pnpm --filter agenthub-desktop visual:qa:shell
cd app && pnpm --filter agenthub-web visual:qa:shell
```

## Phase Checklist

- [x] Phase 0–73
- [ ] Phase 74 frosted glass + Visual QA (gate min~71 Iterate; residual #1247)

## Current Status

**Active Phase**: 74 (visual score loop)
**Active Tasks**: #1247 demo preview themed blank
**Blockers**: None
**Product tip**: `f0d8673a`
**Rescore-4 gate**: min~**71**/100 (D-light 75 · D-dark 71 · W-light 74 · W-dark 71)
**Gate history**: ~55 → 61 → 64 → 66 → **71** (Ship >=85)
**Visual north star**: light white frosted glass, dense spacing, micro-motion, screenshot score loop
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git

## Next Steps

1. Demo preview default themed blank (#1247)
2. Re-capture → re-score toward Ship >=85
3. Residual density/form glass if still Iterate

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-19 | lead | Rescore-4 min~71 Iterate; open #1247; notes #1248 |
| 2026-07-19 | lead | #1241–#1242 closed; Web Agents capture; gate 66→71 |

## Completion notes

- Gate climbed ~55 → 71; still Iterate (not Ship).
- Highest weight: external white preview document in demo shell.
