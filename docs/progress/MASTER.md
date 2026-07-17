# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-17
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#476](https://github.com/TokenDanceLab/AgentHub/pull/476) Phase 9 · [#483](https://github.com/TokenDanceLab/AgentHub/pull/483)–[#488](https://github.com/TokenDanceLab/AgentHub/pull/488) Phase 10 · [#495](https://github.com/TokenDanceLab/AgentHub/pull/495)–[#500](https://github.com/TokenDanceLab/AgentHub/pull/500) Phase 11 · [#507](https://github.com/TokenDanceLab/AgentHub/pull/507)–[#512](https://github.com/TokenDanceLab/AgentHub/pull/512) Phase 12 · [#519](https://github.com/TokenDanceLab/AgentHub/pull/519)–[#524](https://github.com/TokenDanceLab/AgentHub/pull/524) Phase 13 · [#531](https://github.com/TokenDanceLab/AgentHub/pull/531)–[#536](https://github.com/TokenDanceLab/AgentHub/pull/536) Phase 14 · [#543](https://github.com/TokenDanceLab/AgentHub/pull/543)–[#547](https://github.com/TokenDanceLab/AgentHub/pull/547) Phase 15 · [#554](https://github.com/TokenDanceLab/AgentHub/pull/554)–[#558](https://github.com/TokenDanceLab/AgentHub/pull/558) Phase 16 · [#565](https://github.com/TokenDanceLab/AgentHub/pull/565)–[#569](https://github.com/TokenDanceLab/AgentHub/pull/569) Phase 17

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
- **Phase 18 Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 39 --state open`
- **Labels**: `spec-driven` · `phase:18`

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
| 13 | Architecture depth | #34 | closed (PRs #519–#524) |
| 14 | Hotspot strangler | #35 | closed (PRs #531–#536) |
| 15 | Residual hotspots | #36 | closed (PRs #543–#547) |
| 16 | Residual strangler continue | #37 | closed (PRs #554–#558) |
| 17 | Residual strangler continue | #38 | closed (PRs #565–#569) |
| 18 | Residual strangler continue | #39 | active (#570–#575) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #424–#457 cleanup Phases 1–7 | closed (PR #446) |
| #458–#464 Phase 8 security | closed (PR #464) |
| #465–#470 Phase 9 polish | closed (PRs #471–#476) |
| #477–#482 Phase 10 depth | closed (PRs #483–#488) |
| #489–#494 Phase 11 residual | closed (PRs #495–#500) |
| #501–#506 Phase 12 polish continue | closed (PRs #507–#512) |
| #513–#518 Phase 13 architecture depth | closed (PRs #519–#524) |
| #525–#530 Phase 14 hotspot strangler | closed (PRs #531–#536) |
| #537–#542 Phase 15 residual hotspots | closed (PRs #543–#547) |
| #548–#553 Phase 16 residual strangler continue | closed (PRs #554–#558) |
| #559–#564 Phase 17 residual strangler continue | closed (PRs #565–#569) |
| #570–#575 Phase 18 residual strangler continue | open (milestone 39) |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=29 and .number<=39) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 39 --state open
git worktree list
```

## Phase Checklist

- [x] Phase 0–7 cleanup baseline (PR #446)
- [x] Phase 8 security residuals (PR #464)
- [x] Phase 9 product polish (#465–#470 / PRs #471–#476)
- [x] Phase 10 product depth (#477–#482 / PRs #483–#488)
- [x] Phase 11 residual polish (#489–#494 / PRs #495–#500)
- [x] Phase 12 product polish continue (#501–#506 / PRs #507–#512)
- [x] Phase 13 architecture depth (#513–#518 / PRs #519–#524)
- [x] Phase 14 hotspot strangler (#525–#530 / PRs #531–#536)
- [x] Phase 15 residual hotspots (#537–#542 / PRs #543–#547)
- [x] Phase 16 residual strangler continue (#548–#553 / PRs #554–#558)
- [x] Phase 17 residual strangler continue (#559–#564 / PRs #565–#569)
- [ ] Phase 18 residual strangler continue (#570–#575)

## Current Status

**Active Phase**: Phase 18 — Residual strangler continue (milestone 39)
**Active Tasks**: #570 MASTER · #571 TasksPage · #572 SettingsPage · #573 redispatch residual · #574 Contacts 2nd · #575 hygiene
**Blockers**: None
**Production fact**: hk3 LIVE（server `projects/agenthub` external ops SSOT）
**Tip**: ~4c7e3357 on `master` (Phase 17 PR #565–#569 line)
**Residual after P17**: WorkbenchRoutes ~427 · RightInspector ~463 · AgentHubWorkbench ~323 · AgentsPage ~152 · ContactsPage ~542 · ProjectsPage ~299 · SettingsPage ~809 · TasksPage ~799 · DocsPage ~427 · agent_dispatch.go ~919 · delivery_outbox.go ~822 · message.go ~860 · session.go ~728

## Governance Status

**Shared instruction surface**: `AGENTS.md`
**Claude Code instruction surface**: none（本仓仅 AGENTS）
**Memory surface**: Claude native project memory
**Memory note**: `.agenthub/memory/project.md` 过时，不得当 SSOT（#428）

## Next Steps

1. Land Phase 18 issues under milestone 39 (issue-bound Workflows)
2. Keep MASTER ≤150 lines; archive detail elsewhere
3. Prefer #571 TasksPage · #572 SettingsPage · #573 redispatch residual · #574 Contacts 2nd
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
| 2026-07-17 | lead | Phase 13 closed via #519–#524; Phase 14 #525–#530 active |
| 2026-07-17 | lead | Phase 14 closed via #531–#536; Phase 15 #537–#542 active |
| 2026-07-17 | lead | Phase 15 closed via #543–#547; Phase 16 #548–#553 active |
| 2026-07-17 | lead | Phase 16 closed via #554–#558; Phase 17 #559–#564 active |
| 2026-07-17 | lead | Phase 17 closed via #565–#569; Phase 18 #570–#575 active |

## Completion notes

- Phase 9–12: see earlier closed PRs (runtime inventory → EdgeCallbackService / workbench slices).
- Phase 13: MASTER sync (#513/#519), pure outbox helpers (#514/#522), workbench fifth residual (#515/#524), Projects/Docs EmptyState (#516/#523, #517/#521), design residual (#518/#520).
- Phase 14: MASTER sync (#525/#531), WorkbenchRoutes first slice (#526/#533), RightInspector first slice (#527/#535), DeliveryOutbox sketch (#528/#532), Agents StatusNotice (#529/#536), Settings residual (#530/#534).
- Phase 15: MASTER sync (#537/#543), DeliveryOutbox thin (#540/#544), WorkbenchRoutes slice2 (#538/#545), RightInspector slice2 (#539/#546), SectionId collapse A (#541/#547).
- Phase 16: MASTER sync (#548/#554), RightInspector slice3 (#550/#555), WorkbenchRoutes slice3 (#549/#556), AgentsPage slice1 (#552/#557), DeliveryOutbox model (#551/#558).
- Phase 17: MASTER sync (#559/#565), Contacts first (#561/#566), Dispatch thin (#563/#567), Agents 2nd (#560/#568), Projects first (#562/#569).
- Phase 18 targets: MASTER sync, TasksPage / SettingsPage residual, redispatch residual, Contacts second slice, post-merge hygiene.
