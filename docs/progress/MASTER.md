# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-17
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#476](https://github.com/TokenDanceLab/AgentHub/pull/476) Phase 9 · [#483](https://github.com/TokenDanceLab/AgentHub/pull/483)–[#488](https://github.com/TokenDanceLab/AgentHub/pull/488) Phase 10 · [#495](https://github.com/TokenDanceLab/AgentHub/pull/495)–[#500](https://github.com/TokenDanceLab/AgentHub/pull/500) Phase 11 · [#507](https://github.com/TokenDanceLab/AgentHub/pull/507)–[#512](https://github.com/TokenDanceLab/AgentHub/pull/512) Phase 12 · [#519](https://github.com/TokenDanceLab/AgentHub/pull/519)–[#524](https://github.com/TokenDanceLab/AgentHub/pull/524) Phase 13 · [#531](https://github.com/TokenDanceLab/AgentHub/pull/531)–[#536](https://github.com/TokenDanceLab/AgentHub/pull/536) Phase 14 · [#543](https://github.com/TokenDanceLab/AgentHub/pull/543)–[#547](https://github.com/TokenDanceLab/AgentHub/pull/547) Phase 15 · [#554](https://github.com/TokenDanceLab/AgentHub/pull/554)–[#558](https://github.com/TokenDanceLab/AgentHub/pull/558) Phase 16 · [#565](https://github.com/TokenDanceLab/AgentHub/pull/565)–[#569](https://github.com/TokenDanceLab/AgentHub/pull/569) Phase 17 · [#576](https://github.com/TokenDanceLab/AgentHub/pull/576)–[#580](https://github.com/TokenDanceLab/AgentHub/pull/580) Phase 18 · [#587](https://github.com/TokenDanceLab/AgentHub/pull/587)–[#591](https://github.com/TokenDanceLab/AgentHub/pull/591) Phase 19 · [#598](https://github.com/TokenDanceLab/AgentHub/pull/598)–[#602](https://github.com/TokenDanceLab/AgentHub/pull/602) Phase 20 · [#609](https://github.com/TokenDanceLab/AgentHub/pull/609)–[#613](https://github.com/TokenDanceLab/AgentHub/pull/613) Phase 21 · [#620](https://github.com/TokenDanceLab/AgentHub/pull/620)–[#624](https://github.com/TokenDanceLab/AgentHub/pull/624) Phase 22 · [#631](https://github.com/TokenDanceLab/AgentHub/pull/631)–[#635](https://github.com/TokenDanceLab/AgentHub/pull/635) Phase 23 · [#642](https://github.com/TokenDanceLab/AgentHub/pull/642)–[#646](https://github.com/TokenDanceLab/AgentHub/pull/646) Phase 24 · [#654](https://github.com/TokenDanceLab/AgentHub/pull/654)–[#658](https://github.com/TokenDanceLab/AgentHub/pull/658) Phase 25 · [#665](https://github.com/TokenDanceLab/AgentHub/pull/665)–[#669](https://github.com/TokenDanceLab/AgentHub/pull/669) Phase 26 · [#676](https://github.com/TokenDanceLab/AgentHub/pull/676)–[#681](https://github.com/TokenDanceLab/AgentHub/pull/681) Phase 27 · [#688](https://github.com/TokenDanceLab/AgentHub/pull/688)–[#692](https://github.com/TokenDanceLab/AgentHub/pull/692) Phase 28 · [#700](https://github.com/TokenDanceLab/AgentHub/pull/700)–[#704](https://github.com/TokenDanceLab/AgentHub/pull/704) Phase 29

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
- **Phase 30 Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 51 --state open`
- **Labels**: `spec-driven` · `phase:30`

## References

- Analysis: [project-overview](../analysis/project-overview.md) · [module-inventory](../analysis/module-inventory.md) · [hub-service-boundary-map](../analysis/hub-service-boundary-map.md) · [design-token-usage-audit](../analysis/design-token-usage-audit.md)
- Architecture: [07-design-system-ssot](../architecture/07-design-system-ssot.md) · Archive: `docs/archives/cleanup-baseline/` · wiki (non-SSOT)

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
| 23 | Residual polish continue | #44 | closed (PRs #631–#635) |
| 24 | Residual polish continue | #45 | closed (PRs #642–#646) |
| 25 | Residual polish continue | #46 | closed (PRs #654–#658) |
| 26 | Residual polish continue | #47 | closed (PRs #665–#669) |
| 27 | Residual polish continue | #48 | closed (PRs #676–#681) |
| 28 | Residual polish continue | #49 | closed (PRs #688–#692) |
| 29 | Residual polish continue | #50 | closed (PRs #700–#704) |
| 30 | Residual polish continue | #51 | active (#705–#710) |

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
| #625–#630 Phase 23 residual polish continue | closed (PRs #631–#635) |
| #636–#641 Phase 24 residual polish continue | closed (PRs #642–#646) |
| #648–#653 Phase 25 residual polish continue | closed (PRs #654–#658) |
| #659–#664 Phase 26 residual polish continue | closed (PRs #665–#669) |
| #670–#675 Phase 27 residual polish continue | closed (PRs #676–#681) |
| #682–#687 Phase 28 residual polish continue | closed (PRs #688–#692) |
| #694–#699 Phase 29 residual polish continue | closed (PRs #700–#704) |
| #705–#710 Phase 30 residual polish continue | open (milestone 51) |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=29 and .number<=51) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 51 --state open
git worktree list
```

## Phase Checklist

- [x] Phase 0–7 cleanup baseline (PR #446)
- [x] Phase 8 security residuals (PR #464)
- [x] Phase 9–21 polish/strangler continue (#465–#608 / PRs #471–#613)
- [x] Phase 22 residual polish continue (#614–#619 / PRs #620–#624)
- [x] Phase 23 residual polish continue (#625–#630 / PRs #631–#635)
- [x] Phase 24 residual polish continue (#636–#641 / PRs #642–#646)
- [x] Phase 25 residual polish continue (#648–#653 / PRs #654–#658)
- [x] Phase 26 residual polish continue (#659–#664 / PRs #665–#669)
- [x] Phase 27 residual polish continue (#670–#675 / PRs #676–#681)
- [x] Phase 28 residual polish continue (#682–#687 / PRs #688–#692)
- [x] Phase 29 residual polish continue (#694–#699 / PRs #700–#704)
- [ ] Phase 30 residual polish continue (#705–#710)

## Current Status

**Active Phase**: Phase 30 — Residual polish continue (milestone 51)
**Active Tasks**: #705 MASTER · #706 UnifiedComposerParts · #707 ContactMainSections · #708 Session package · #709 ProfileChrome · #710 hygiene
**Blockers**: None
**Production fact**: hk3 LIVE（server `projects/agenthub` external ops SSOT）
**Tip**: 741c2537 on `master` (Phase 29 PR #700–#704 line)
**Residual after P29**: UnifiedComposerParts ~337 · ContactMainSections ~354 · ProfileChrome ~323 · FrameParts ~311 · UnifiedComposer ~292 · designIcons ~1038 · agent_dispatch ~1193 · message ~783 · session ~767 · attachment pkg ~394 · contact ~403 · workspace ~370 · messagereaction ~217
**Boundary map next residual**: Session typed package (then Message) / optional outbox model package move
**Governance**: `AGENTS.md` only · Claude native project memory · `.agenthub/memory/project.md` 过时，不得当 SSOT（#428）

## Next Steps

1. Land Phase 30 issues under milestone 51 (issue-bound Workflows)
2. Keep MASTER ≤150 lines; archive detail elsewhere
3. Prefer #706 UnifiedComposerParts · #707 ContactMainSections · #708 Session package · #709 ProfileChrome
4. Hold unmerged locals (`task/super-governance-baseline`) for separate review

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9–28 closed via #471–#692; Phase 29 #694–#699 active |
| 2026-07-17 | lead | Phase 29 closed via #700–#704; Phase 30 #705–#710 active |

## Completion notes

- Phase 28 closed via #688–#692 (MASTER / AgentHubWorkbench / AgentOpsParts / Contact package / SettingsPanes; #687 hygiene ops-only).
- Phase 29 closed via #700–#704 (MASTER / AgentEditPanel / ProjectPanelParts / Attachment package / WorkbenchFrameParts; #699 hygiene ops-only).
- Phase 30 targets: MASTER sync, UnifiedComposerParts residual, ContactMainSections residual, Session typed package, ProfileChrome residual, hygiene.
