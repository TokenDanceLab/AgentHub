# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: Phases 1–73 · P74 foundation #1204–#1207 · consumers #1212–#1215 · capture #1216 · score residual #1221–#1223

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
| 74 | Light frosted glass + Visual QA | #95 | active (score-loop residual landed; re-score next) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #1191–#1194 Phase 73 | closed |
| #1197–#1200 P74 foundation | closed PRs #1204–#1207 |
| #1208–#1211 chrome consumers + hygiene | closed PRs #1212–#1215 |
| #1216 visual-qa-shell baseUrl | closed PR #1216 |
| #1217 shell frost + left rails | closed PR #1221 |
| #1218 main/composer glass | closed PR #1222 |
| #1219 web shell capture blank | closed PR #1223 |
| #1220 MASTER hygiene (this) | open → closes with PR |

## Quick Status Commands

```bash
gh issue list -R TokenDanceLab/AgentHub --milestone 95 --state open
git rev-parse --short origin/master
cd app && pnpm --filter agenthub-desktop visual:qa:shell
cd app && pnpm --filter agenthub-web visual:qa:shell
```

## Phase Checklist

- [x] Phase 0–73
- [ ] Phase 74 light frosted glass + Visual QA (foundation + consumers + score residual landed; re-score gate)

## Current Status

**Active Phase**: 74 (visual score loop)
**Active Tasks**: re-capture → re-score after #1221–#1223; residual Issues only if gate min <85
**Blockers**: None
**Product tip**: `f1b2039a` — shell frost · main glass · web capture fix
**Prior score (pre-residual)**: Desktop light ~58 / dark ~55 Block
**Visual north star**: light white frosted glass, dense spacing, micro-motion, screenshot score loop
**Red lines**: Web no Local Edge; renderer no raw process; product language only in public git

## Next Steps

1. Desktop + Web `visual:qa:shell` light/dark 1440×810 on tip
2. Score with [visual-qa-scorecard](../analysis/visual-qa-scorecard.md); gate = min of four
3. If gate <85 open next residual Issues (highest-weight fails only)
4. Optional product later: real Desktop PTY · real FS/git host · page-module glass restyle

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-19 | lead | Score residual closed (#1221–#1223); MASTER tip `f1b2039a`; re-score next |
| 2026-07-19 | lead | Capture fix #1216; score Block → residual #1217–#1219 |
| 2026-07-19 | lead | P74 consumers closed (#1212–#1215); foundation #1204–#1207 |

## Completion notes

- P74 foundation: glass tokens · density/motion · scorecard+capture matrix.
- Chrome consumers: shell · overlays · Aux/Empty.
- Score residual: stronger frost tokens · kill list left rails · main/composer glass · web non-blank capture.
- Phase 73: WorkspaceFiles/Git ports · session import · mock TerminalPort.
