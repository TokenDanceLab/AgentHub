# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: Phases 1–73 · P74 through residual #1247 / PR #1250

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
- [visual-qa-score-2026-07-19-rescore-4](../analysis/visual-qa-score-2026-07-19-rescore-4.md)
- [visual-qa-score-2026-07-19-rescore-5](../analysis/visual-qa-score-2026-07-19-rescore-5.md)
- [07-design-system-ssot](../architecture/07-design-system-ssot.md)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–73 | Baseline through host ports | #22–#94 | closed |
| 74 | Light frosted glass + Visual QA | #95 | active (rescore-5 Iterate residual) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #1197–#1247 foundation through demo themed blank | closed |
| #1248 rescore-4 notes | closed PR #1249 |
| #1251 dark about:blank themed document | open |
| #1252 rescore-5 notes + MASTER | open (this) |

## Quick Status Commands

```bash
gh issue list -R TokenDanceLab/AgentHub --milestone 95 --state open
git rev-parse --short origin/master
cd app && pnpm --filter agenthub-desktop visual:qa:shell
cd app && pnpm --filter agenthub-web visual:qa:shell
```

## Phase Checklist

- [x] Phase 0–73
- [ ] Phase 74 frosted glass + Visual QA (gate min~70 Iterate; residual #1251)

## Current Status

**Active Phase**: 74 (visual score loop)
**Active Tasks**: #1251 dark about:blank themed document
**Blockers**: None
**Product tip**: `89fb96d1`
**Rescore-5 gate**: min~**70**/100 (D-light 78 · D-dark 70 · W-light 74 · W-dark 71)
**Gate history**: ~55 → 61 → 64 → 66 → 71 → **70** (Ship >=85; dark blank regressed hierarchy)
**Visual north star**: light white frosted glass, dense spacing, micro-motion, screenshot score loop
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git

## Next Steps

1. Dark about:blank themed document (#1251)
2. Re-capture → re-score toward Ship >=85
3. Residual density/form glass if still Iterate

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-19 | lead | Rescore-5 min~70; open #1251; notes #1252 |
| 2026-07-19 | lead | #1247 themed blank merged; light improved, dark still white blank |

## Completion notes

- Gate climbed ~55 → 70-ish; still Iterate (not Ship).
- Highest weight: dark about:blank pure white document.
