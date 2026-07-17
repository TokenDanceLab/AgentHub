# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-17
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#476](https://github.com/TokenDanceLab/AgentHub/pull/476) Phase 9 · [#483](https://github.com/TokenDanceLab/AgentHub/pull/483)–[#488](https://github.com/TokenDanceLab/AgentHub/pull/488) Phase 10 · [#495](https://github.com/TokenDanceLab/AgentHub/pull/495)–[#500](https://github.com/TokenDanceLab/AgentHub/pull/500) Phase 11 · [#507](https://github.com/TokenDanceLab/AgentHub/pull/507)–[#512](https://github.com/TokenDanceLab/AgentHub/pull/512) Phase 12 · [#519](https://github.com/TokenDanceLab/AgentHub/pull/519)–[#524](https://github.com/TokenDanceLab/AgentHub/pull/524) Phase 13 · [#531](https://github.com/TokenDanceLab/AgentHub/pull/531)–[#536](https://github.com/TokenDanceLab/AgentHub/pull/536) Phase 14 · [#543](https://github.com/TokenDanceLab/AgentHub/pull/543)–[#547](https://github.com/TokenDanceLab/AgentHub/pull/547) Phase 15 · [#554](https://github.com/TokenDanceLab/AgentHub/pull/554)–[#558](https://github.com/TokenDanceLab/AgentHub/pull/558) Phase 16 · [#565](https://github.com/TokenDanceLab/AgentHub/pull/565)–[#569](https://github.com/TokenDanceLab/AgentHub/pull/569) Phase 17 · [#576](https://github.com/TokenDanceLab/AgentHub/pull/576)–[#580](https://github.com/TokenDanceLab/AgentHub/pull/580) Phase 18 · [#587](https://github.com/TokenDanceLab/AgentHub/pull/587)–[#591](https://github.com/TokenDanceLab/AgentHub/pull/591) Phase 19 · [#598](https://github.com/TokenDanceLab/AgentHub/pull/598)–[#602](https://github.com/TokenDanceLab/AgentHub/pull/602) Phase 20 · [#609](https://github.com/TokenDanceLab/AgentHub/pull/609)–[#613](https://github.com/TokenDanceLab/AgentHub/pull/613) Phase 21 · [#620](https://github.com/TokenDanceLab/AgentHub/pull/620)–[#624](https://github.com/TokenDanceLab/AgentHub/pull/624) Phase 22 · [#631](https://github.com/TokenDanceLab/AgentHub/pull/631)–[#635](https://github.com/TokenDanceLab/AgentHub/pull/635) Phase 23 · [#642](https://github.com/TokenDanceLab/AgentHub/pull/642)–[#646](https://github.com/TokenDanceLab/AgentHub/pull/646) Phase 24 · [#654](https://github.com/TokenDanceLab/AgentHub/pull/654)–[#658](https://github.com/TokenDanceLab/AgentHub/pull/658) Phase 25 · [#665](https://github.com/TokenDanceLab/AgentHub/pull/665)–[#669](https://github.com/TokenDanceLab/AgentHub/pull/669) Phase 26 · [#676](https://github.com/TokenDanceLab/AgentHub/pull/676)–[#681](https://github.com/TokenDanceLab/AgentHub/pull/681) Phase 27 · [#688](https://github.com/TokenDanceLab/AgentHub/pull/688)–[#692](https://github.com/TokenDanceLab/AgentHub/pull/692) Phase 28 · [#700](https://github.com/TokenDanceLab/AgentHub/pull/700)–[#704](https://github.com/TokenDanceLab/AgentHub/pull/704) Phase 29 · [#711](https://github.com/TokenDanceLab/AgentHub/pull/711)–[#716](https://github.com/TokenDanceLab/AgentHub/pull/716) Phase 30 · [#723](https://github.com/TokenDanceLab/AgentHub/pull/723)–[#728](https://github.com/TokenDanceLab/AgentHub/pull/728) Phase 31 · [#735](https://github.com/TokenDanceLab/AgentHub/pull/735)–[#740](https://github.com/TokenDanceLab/AgentHub/pull/740) Phase 32 · [#747](https://github.com/TokenDanceLab/AgentHub/pull/747)–[#752](https://github.com/TokenDanceLab/AgentHub/pull/752) Phase 33

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
- **Phase 34 Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 55 --state open`
- **Labels**: `spec-driven` · `phase:34`

## References

- Analysis: [project-overview](../analysis/project-overview.md) · [module-inventory](../analysis/module-inventory.md) · [hub-service-boundary-map](../analysis/hub-service-boundary-map.md) · [design-token-usage-audit](../analysis/design-token-usage-audit.md)
- Architecture: [07-design-system-ssot](../architecture/07-design-system-ssot.md) · Archive: `docs/archives/cleanup-baseline/` · wiki (non-SSOT)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–7 | Cleanup baseline | #22–#28 | closed |
| 8 | Post-baseline security | #29 | closed (PR #464) |
| 9–21 | Polish / strangler continue | #30–#42 | closed (PRs #471–#613) |
| 22–29 | Residual polish continue | #43–#50 | closed (PRs #620–#704) |
| 30 | Residual polish continue | #51 | closed (PRs #711–#716) |
| 31 | Residual polish continue | #52 | closed (PRs #723–#728) |
| 32 | Residual polish continue | #53 | closed (PRs #735–#740) |
| 33 | Residual polish continue | #54 | closed (PRs #747–#752) |
| 34 | Residual polish continue | #55 | active (#753–#758) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #424–#457 cleanup Phases 1–7 | closed (PR #446) |
| #458–#464 Phase 8 security | closed (PR #464) |
| #465–#608 Phase 9–21 polish/strangler | closed (PRs #471–#613) |
| #614–#699 Phase 22–29 residual polish | closed (PRs #620–#704) |
| #705–#710 Phase 30 residual polish continue | closed (PRs #711–#716) |
| #717–#722 Phase 31 residual polish continue | closed (PRs #723–#728) |
| #729–#734 Phase 32 residual polish continue | closed (PRs #735–#740) |
| #741–#746 Phase 33 residual polish continue | closed (PRs #747–#752) |
| #753–#758 Phase 34 residual polish continue | open (milestone 55) |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=29 and .number<=55) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 55 --state open
git worktree list
```

## Phase Checklist

- [x] Phase 0–7 cleanup baseline (PR #446)
- [x] Phase 8 security residuals (PR #464)
- [x] Phase 9–21 polish/strangler continue (#465–#608 / PRs #471–#613)
- [x] Phase 22–29 residual polish continue (#614–#699 / PRs #620–#704)
- [x] Phase 30 residual polish continue (#705–#710 / PRs #711–#716)
- [x] Phase 31 residual polish continue (#717–#722 / PRs #723–#728)
- [x] Phase 32 residual polish continue (#729–#734 / PRs #735–#740)
- [x] Phase 33 residual polish continue (#741–#746 / PRs #747–#752)
- [ ] Phase 34 residual polish continue (#753–#758)

## Current Status

**Active Phase**: Phase 34 — Residual polish continue (milestone 55)
**Active Tasks**: #753 MASTER · #754 designIcons · #755 workbenchTranscriptChromeHelpers · #756 agent_dispatch · #757 normalizeEdgeEvents · #758 hygiene
**Blockers**: None
**Production fact**: hk3 LIVE（server `projects/agenthub` external ops SSOT）
**Tip**: b126fe6e on `master` (Phase 33 PR #747–#752 line; TaskTableViews #752)
**Residual after P33**: designIcons ~1038 · workbenchTranscriptChromeHelpers ~1258 · agent_dispatch ~1085 · normalizeEdgeEvents ~1117 · useWebWorkbenchModel ~1195 · delivery_outbox ~647 · hubClient large (~2489 shared)
**Boundary map next residual**: design system icons / transcript chrome helpers / dispatch typed seam / edge-event normalize
**Governance**: `AGENTS.md` only · Claude native project memory · `.agenthub/memory/project.md` 过时，不得当 SSOT（#428）

## Next Steps

1. Land Phase 34 issues under milestone 55 (issue-bound Workflows)
2. Keep MASTER ≤150 lines; archive detail elsewhere
3. Prefer #754 designIcons · #755 workbenchTranscriptChromeHelpers · #756 agent_dispatch · #757 normalizeEdgeEvents
4. Hold unmerged locals (`task/super-governance-baseline`) for separate review

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9–31 closed; Phase 32–33 advanced |
| 2026-07-17 | lead | Phase 32 closed via #735–#740; Phase 33 #741–#746 active |
| 2026-07-17 | lead | Phase 33 closed via #747–#752; Phase 34 #753–#758 active |

## Completion notes

- Phase 33 closed via #747–#752 (MASTER / WorkbenchFrameParts / ProfilePopover / DeliveryOutbox residual / TaskTableViews; #746 hygiene ops-only).
- Phase 34 targets: MASTER sync, designIcons residual, workbenchTranscriptChromeHelpers residual, agent_dispatch residual, normalizeEdgeEvents residual, hygiene.
