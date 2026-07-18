# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: Phases 1–73 · P74 through score residual #1221–#1223 · MASTER #1224

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

- [engineering-loop-capability-map](../analysis/engineering-loop-capability-map.md)
- [07-design-system-ssot](../architecture/07-design-system-ssot.md)
- [visual-qa-scorecard](../analysis/visual-qa-scorecard.md)
- [visual-qa-score-2026-07-19-rescore](../analysis/visual-qa-score-2026-07-19-rescore.md)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–72 | Baseline + residual + loop foundations | #22–#93 | closed |
| 73 | Host ports + import entry | #94 | closed |
| 74 | Light frosted glass + Visual QA | #95 | active (post-rescore residual open) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #1197–#1216 foundation · consumers · capture | closed |
| #1217–#1219 / PRs #1221–#1223 score residual | closed |
| #1220 / PR #1224 MASTER hygiene | closed |
| #1225 empty transcript glass | open |
| #1226 Web page-module glass | open |
| #1227 dark empty ambient | open |
| #1228 rescore notes + MASTER tip | open (this) |

## Quick Status Commands

```bash
gh issue list -R TokenDanceLab/AgentHub --milestone 95 --state open
git rev-parse --short origin/master
cd app && pnpm --filter agenthub-desktop visual:qa:shell
cd app && pnpm --filter agenthub-web visual:qa:shell
```

## Phase Checklist

- [x] Phase 0–73
- [ ] Phase 74 light frosted glass + Visual QA (rescore gate min≈61; residual #1225–#1227)

## Current Status

**Active Phase**: 74 (visual score loop)
**Active Tasks**: #1225 empty center · #1226 web page glass · #1227 dark ambient
**Blockers**: None
**Product tip**: `540b9808`
**Rescore gate**: min≈**61**/100 (Desktop light 70 · dark 65 · Web light 64 · dark 61) — was ~55–58
**Visual north star**: light white frosted glass, dense spacing, micro-motion, screenshot score loop
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git

## Next Steps

1. Empty transcript / welcome glass (#1225)
2. Web Agents/list chrome glass (#1226)
3. Dark empty ambient (#1227)
4. Re-capture → re-score until Ship ≥85

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-19 | lead | Rescore min≈61; open residual #1225–#1227; notes #1228 |
| 2026-07-19 | lead | Score residual closed #1221–#1223; MASTER #1224 |

## Completion notes

- P74 foundation + chrome consumers + score residual landed.
- Gate still Block; highest weight: empty center, web page modules, dark voids.
