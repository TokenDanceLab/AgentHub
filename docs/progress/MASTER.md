# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-17
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#476](https://github.com/TokenDanceLab/AgentHub/pull/476) Phase 9 · [#483](https://github.com/TokenDanceLab/AgentHub/pull/483)–[#488](https://github.com/TokenDanceLab/AgentHub/pull/488) Phase 10 · [#495](https://github.com/TokenDanceLab/AgentHub/pull/495)–[#500](https://github.com/TokenDanceLab/AgentHub/pull/500) Phase 11 · [#507](https://github.com/TokenDanceLab/AgentHub/pull/507)–[#512](https://github.com/TokenDanceLab/AgentHub/pull/512) Phase 12

## Two task surfaces (do not mix)

| Surface | Role | NOT for |
|---|---|---|
| **GitHub Project + Issues** | **程序唯一任务清单 / 进度 SSOT** | 会话临时想法 |
| **Claude TaskList** | 仅本会话微编排 | 程序 backlog、跨会话进度 |

规则：跨会话可交付工作只进 GitHub Issue；Workflow/PR 必须绑定 Issue。

## Management model

1. **SPEC in-repo**：`docs/analysis/*` + `docs/plan/*` + 本文件
2. **GitHub Project board**：活状态 / WIP
3. **Milestones = Phases** · **Issues = 原子任务**
4. **PR closes Issue**；Workflow 只执行已建 Issue
5. wiki 是编译知识层，**不覆盖** AGENTS / architecture / api / risk register

## GitHub Resources

- **Project Board**: https://github.com/users/DeliciousBuding/projects/6
- **Phase 13 Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 34 --state open`
- **Labels**: `spec-driven` · `phase:13`

## References

- Analysis: [project-overview](../analysis/project-overview.md) · [module-inventory](../analysis/module-inventory.md) · [hub-service-boundary-map](../analysis/hub-service-boundary-map.md) · [design-token-usage-audit](../analysis/design-token-usage-audit.md)
- Architecture: [07-design-system-ssot](../architecture/07-design-system-ssot.md)
- Archive: `docs/archives/cleanup-baseline/` · wiki (non-SSOT)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–7 | Cleanup baseline | #22–#28 | closed |
| 8 | Post-baseline security | #29 | closed (PR #464) |
| 9 | Product polish | #30 | closed (PRs #471–#476) |
| 10 | Product depth | #31 | closed (PRs #483–#488) |
| 11 | Residual polish | #32 | closed (PRs #495–#500) |
| 12 | Product polish continue | #33 | closed (PRs #507–#512) |
| 13 | Architecture depth | #34 | active (#513–#518) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #424–#457 cleanup Phases 1–7 | closed (PR #446) |
| #458–#464 Phase 8 security | closed (PR #464) |
| #465–#470 Phase 9 polish | closed (PRs #471–#476) |
| #477–#482 Phase 10 depth | closed (PRs #483–#488) |
| #489–#494 Phase 11 residual | closed (PRs #495–#500) |
| #501–#506 Phase 12 polish continue | closed (PRs #507–#512) |
| #513–#518 Phase 13 architecture depth | open (milestone 34) |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=29 and .number<=34) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 34 --state open
git worktree list
```

## Phase Checklist

- [x] Phase 0–7 cleanup baseline (PR #446)
- [x] Phase 8 security residuals (PR #464)
- [x] Phase 9 product polish (#465–#470 / PRs #471–#476)
- [x] Phase 10 product depth (#477–#482 / PRs #483–#488)
- [x] Phase 11 residual polish (#489–#494 / PRs #495–#500)
- [x] Phase 12 product polish continue (#501–#506 / PRs #507–#512)
- [ ] Phase 13 architecture depth (#513–#518)

## Current Status

**Active Phase**: Phase 13 — Architecture depth (milestone 34)
**Active Tasks**: #513 MASTER · #514 outbox helpers · #515 workbench residual · #516 ProjectsPage EmptyState · #517 DocsPage EmptyState · #518 design residual
**Blockers**: None
**Production fact**: hk3 LIVE（server `projects/agenthub` external ops SSOT）
**Tip**: Phase 12 tip on `master` (PR #507–#512 line)

## Governance Status

**Shared instruction surface**: `AGENTS.md`
**Claude Code instruction surface**: none（本仓仅 AGENTS）
**Memory surface**: Claude native project memory
**Memory note**: `.agenthub/memory/project.md` 过时，不得当 SSOT（#428）

## Next Steps

1. Land Phase 13 issues under milestone 34 (issue-bound Workflows)
2. Keep MASTER ≤150 lines; archive detail elsewhere
3. Prefer #514 pure outbox helpers and #515 workbench residual before design residual
4. Hold unmerged locals (`task/super-governance-baseline`) for separate review

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9 #465–#470 closed via #471–#476 |
| 2026-07-17 | lead | Phase 10 opened #477–#482 |
| 2026-07-17 | lead | Phase 10 closed via #483–#488; Phase 11 #489–#494 active |
| 2026-07-17 | lead | Phase 11 closed via #495–#500; Phase 12 #501–#506 active |
| 2026-07-17 | lead | Phase 12 closed via #507–#512; Phase 13 #513–#518 active |

## Completion notes

- Phase 9: runtime inventory (#465), design SSOT (#466), workbench extract (#467), hub `agentevent` (#468), hygiene (#469), settings inventory (#470).
- Phase 10: RunEventService (#478/#484), settings load/error UX (#479/#486), spacing tokens (#480/#485), workbench slice2 (#481/#488), welcome glass (#482), MASTER sync (#477/#487).
- Phase 11: MASTER sync (#489/#495), delete `useWorkbenchCallbacks` (#490/#498), chatview token inventory (#491/#497), EmptyState consistency (#492/#499), hub boundary map (#493/#496), workbench residual (#494/#500).
- Phase 12: MASTER sync (#501/#507), delete orphan WorkbenchShell (#502/#508), Tasks/Contacts EmptyState (#503/#509, #504/#510), EdgeCallbackService (#505/#511), workbench fourth residual (#506/#512).
- Phase 13 targets: MASTER sync, pure outbox helpers, workbench fifth residual, Projects/Docs EmptyState, design residual.
