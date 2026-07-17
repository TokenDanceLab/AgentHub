# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-17
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#476](https://github.com/TokenDanceLab/AgentHub/pull/476) Phase 9 · [#483](https://github.com/TokenDanceLab/AgentHub/pull/483)–[#488](https://github.com/TokenDanceLab/AgentHub/pull/488) Phase 10 · [#495](https://github.com/TokenDanceLab/AgentHub/pull/495)–[#500](https://github.com/TokenDanceLab/AgentHub/pull/500) Phase 11 · [#507](https://github.com/TokenDanceLab/AgentHub/pull/507)–[#512](https://github.com/TokenDanceLab/AgentHub/pull/512) Phase 12 · [#519](https://github.com/TokenDanceLab/AgentHub/pull/519)–[#524](https://github.com/TokenDanceLab/AgentHub/pull/524) Phase 13 · [#531](https://github.com/TokenDanceLab/AgentHub/pull/531)–[#536](https://github.com/TokenDanceLab/AgentHub/pull/536) Phase 14 · [#543](https://github.com/TokenDanceLab/AgentHub/pull/543)–[#547](https://github.com/TokenDanceLab/AgentHub/pull/547) Phase 15 · [#554](https://github.com/TokenDanceLab/AgentHub/pull/554)–[#558](https://github.com/TokenDanceLab/AgentHub/pull/558) Phase 16 · [#565](https://github.com/TokenDanceLab/AgentHub/pull/565)–[#569](https://github.com/TokenDanceLab/AgentHub/pull/569) Phase 17 · [#576](https://github.com/TokenDanceLab/AgentHub/pull/576)–[#580](https://github.com/TokenDanceLab/AgentHub/pull/580) Phase 18 · [#587](https://github.com/TokenDanceLab/AgentHub/pull/587)–[#591](https://github.com/TokenDanceLab/AgentHub/pull/591) Phase 19 · [#598](https://github.com/TokenDanceLab/AgentHub/pull/598)–[#602](https://github.com/TokenDanceLab/AgentHub/pull/602) Phase 20 · [#609](https://github.com/TokenDanceLab/AgentHub/pull/609)–[#613](https://github.com/TokenDanceLab/AgentHub/pull/613) Phase 21 · [#620](https://github.com/TokenDanceLab/AgentHub/pull/620)–[#624](https://github.com/TokenDanceLab/AgentHub/pull/624) Phase 22

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
- **Phase 23 Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 44 --state open`
- **Labels**: `spec-driven` · `phase:23`

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
| 18 | Residual strangler continue | #39 | closed (PRs #576–#580) |
| 19 | Residual strangler continue | #40 | closed (PRs #587–#591) |
| 20 | Residual strangler continue | #41 | closed (PRs #598–#602) |
| 21 | Residual strangler continue | #42 | closed (PRs #609–#613) |
| 22 | Residual polish continue | #43 | closed (PRs #620–#624) |
| 23 | Residual polish continue | #44 | active (#625–#630) |

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
| #570–#575 Phase 18 residual strangler continue | closed (PRs #576–#580) |
| #581–#586 Phase 19 residual strangler continue | closed (PRs #587–#591) |
| #592–#597 Phase 20 residual strangler continue | closed (PRs #598–#602) |
| #603–#608 Phase 21 residual strangler continue | closed (PRs #609–#613) |
| #614–#619 Phase 22 residual polish continue | closed (PRs #620–#624) |
| #625–#630 Phase 23 residual polish continue | open (milestone 44) |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=29 and .number<=44) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 44 --state open
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
- [x] Phase 18 residual strangler continue (#570–#575 / PRs #576–#580)
- [x] Phase 19 residual strangler continue (#581–#586 / PRs #587–#591)
- [x] Phase 20 residual strangler continue (#592–#597 / PRs #598–#602)
- [x] Phase 21 residual strangler continue (#603–#608 / PRs #609–#613)
- [x] Phase 22 residual polish continue (#614–#619 / PRs #620–#624)
- [ ] Phase 23 residual polish continue (#625–#630)

## Current Status

**Active Phase**: Phase 23 — Residual polish continue (milestone 44)
**Active Tasks**: #625 MASTER · #626 ProjectPanelViews · #627 TranscriptChrome residual · #628 Hub IM first seam · #629 AgentOpsViews · #630 hygiene
**Blockers**: None
**Production fact**: hk3 LIVE（server `projects/agenthub` external ops SSOT）
**Tip**: ~263526ee on `master` (Phase 22 PR #620–#624 line)
**Residual after P22**: WorkbenchRoutes ~327 · RightInspector ~296 · AgentHubWorkbench ~323 · AgentsPage ~152 · ContactsPage ~57 · ProjectsPage ~123 · SettingsPage ~44 · TasksPage ~38 · DocsPage ~79 · useWorkbenchTranscriptChrome ~517 · WorkbenchFrame ~418 · UnifiedComposer ~397 · AgentInstalledViews ~223 · ProjectDetailViews ~18 · ProjectPanelViews ~564 · AgentOpsViews ~426 · agent_dispatch.go ~1193 · message.go ~905 · session.go ~767
**Boundary map next residual**: IM subpackages / optional outbox model package move

## Governance Status

**Shared instruction surface**: `AGENTS.md`
**Claude Code instruction surface**: none（本仓仅 AGENTS）
**Memory surface**: Claude native project memory
**Memory note**: `.agenthub/memory/project.md` 过时，不得当 SSOT（#428）

## Next Steps

1. Land Phase 23 issues under milestone 44 (issue-bound Workflows)
2. Keep MASTER ≤150 lines; archive detail elsewhere
3. Prefer #626 ProjectPanelViews · #627 TranscriptChrome residual · #628 Hub IM first seam · #629 AgentOpsViews
4. Hold unmerged locals (`task/super-governance-baseline`) for separate review

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9–19 closed via #471–#591; Phase 20 #592–#597 opened |
| 2026-07-17 | lead | Phase 20 closed via #598–#602; Phase 21 #603–#608 active |
| 2026-07-17 | lead | Phase 21 closed via #609–#613; Phase 22 #614–#619 active |
| 2026-07-17 | lead | Phase 22 closed via #620–#624; Phase 23 #625–#630 active |

## Completion notes

- Phase 9–20: see earlier closed PRs (runtime inventory → EdgeCallback / workbench + DeliveryOutbox / residual slices).
- Phase 21: MASTER (#603/#609), design residual (#607/#610), AttachmentService (#606/#611), Docs residual (#605/#612), Settings residual (#604/#613).
- Phase 22: MASTER (#614/#620), Dispatch residual (#617/#621), AgentInstalledViews (#616/#622), chrome/transcript helpers (#615/#623), ProjectDetailViews (#618/#624).
- Phase 23 targets: MASTER sync, ProjectPanelViews, TranscriptChrome residual, Hub IM first seam, AgentOpsViews, post-merge hygiene.
