# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: Phases 1–73 · P74 foundation #1204–#1207

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

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–72 | Baseline + residual + loop foundations | #22–#93 | closed |
| 73 | Host ports + import entry | #94 | closed (#1191–#1193; PRs #1201–#1203) |
| 74 | Light frosted glass + Visual QA | #95 | active (foundation landed; chrome consumers open) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #1191–#1194 Phase 73 | closed |
| #1197 glass tokens | closed PR #1204 |
| #1198 motion/spacing | closed PR #1206 |
| #1199 Visual QA scorecard | closed PR #1207 |
| #1200 MASTER hygiene | closed PR #1205 |
| #1208–#1211 chrome consumers + hygiene | open |

## Quick Status Commands

```bash
gh issue list -R TokenDanceLab/AgentHub --milestone 95 --state open
git rev-parse --short origin/master
```

## Phase Checklist

- [x] Phase 0–73
- [ ] Phase 74 light frosted glass + Visual QA (foundation done; consumers in flight)

## Current Status

**Active Phase**: 74 (visual system consumers)
**Active Tasks**: #1208 shell chrome · #1209 floating overlays · #1210 Aux/Empty · #1211 hygiene
**Blockers**: None
**Product tip**: `ffce69bf` — glass tokens + density/motion + visual QA scorecard
**Visual north star**: light frosted glass, dense spacing, micro-motion, screenshot score loop
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git

## Next Steps

1. Shell chrome glass recipe (#1208)
2. Floating overlay glass (#1209)
3. AuxPanel + EmptyState alignment (#1210)
4. Capture → score → iterate via `visual:qa:shell`

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-19 | lead | P74 foundation closed (#1204–#1207); open chrome consumer set #1208–#1211 |
| 2026-07-19 | lead | P73 closed (#1201–#1203); P74 dual-track frosted glass open |

## Completion notes

- P74 foundation: glass tokens · density/motion · scorecard+capture matrix.
- Phase 73: WorkspaceFiles/Git ports · session import · mock TerminalPort.
