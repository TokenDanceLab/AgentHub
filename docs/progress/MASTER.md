# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-18
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#613](https://github.com/TokenDanceLab/AgentHub/pull/613) Phase 9–21 · [#620](https://github.com/TokenDanceLab/AgentHub/pull/620)–[#704](https://github.com/TokenDanceLab/AgentHub/pull/704) Phase 22–29 · [#711](https://github.com/TokenDanceLab/AgentHub/pull/711)–[#786](https://github.com/TokenDanceLab/AgentHub/pull/786) Phase 30–36 · [#793](https://github.com/TokenDanceLab/AgentHub/pull/793)–[#831](https://github.com/TokenDanceLab/AgentHub/pull/831) Phase 37–40 · [#844](https://github.com/TokenDanceLab/AgentHub/pull/844)–[#851](https://github.com/TokenDanceLab/AgentHub/pull/851) Phase 41 · [#858](https://github.com/TokenDanceLab/AgentHub/pull/858)–[#864](https://github.com/TokenDanceLab/AgentHub/pull/864) Phase 42 · [#871](https://github.com/TokenDanceLab/AgentHub/pull/871)–[#875](https://github.com/TokenDanceLab/AgentHub/pull/875) Phase 43 · [#882](https://github.com/TokenDanceLab/AgentHub/pull/882)–[#886](https://github.com/TokenDanceLab/AgentHub/pull/886) Phase 44 · [#893](https://github.com/TokenDanceLab/AgentHub/pull/893)–[#897](https://github.com/TokenDanceLab/AgentHub/pull/897) Phase 45 · [#904](https://github.com/TokenDanceLab/AgentHub/pull/904)–[#908](https://github.com/TokenDanceLab/AgentHub/pull/908) Phase 46 · [#915](https://github.com/TokenDanceLab/AgentHub/pull/915)–[#919](https://github.com/TokenDanceLab/AgentHub/pull/919) Phase 47

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
- **Phase 48 Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 69 --state open`
- **Labels**: `spec-driven` · `phase:48`

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
| 30–36 | Residual polish continue | #51–#57 | closed (PRs #711–#786) |
| 37–40 | Residual polish continue | #58–#61 | closed (PRs #793–#831) |
| 41 | Residual polish continue | #62 | closed (PRs #844–#851) |
| 42 | Security gates + residual polish | #63 | closed (PRs #858–#864) |
| 43 | Delivery/executor stability + residual | #64 | closed (PRs #871–#875) |
| 44 | Security residual + design system + mobile auth | #65 | closed (PRs #882–#886) |
| 45 | Auth residual + residual polish | #66 | closed (PRs #893–#897) |
| 46 | Dual-token hard gate + design/shared residual | #67 | closed (PRs #904–#908) |
| 47 | Design token residual + godfile peels | #68 | closed (PRs #915–#919) |
| 48 | WS protocol auth + design residual + peels | #69 | active (#920–#925) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #424–#457 cleanup Phases 1–7 | closed (PR #446) |
| #458–#464 Phase 8 security | closed (PR #464) |
| #465–#608 Phase 9–21 polish/strangler | closed (PRs #471–#613) |
| #614–#699 Phase 22–29 residual polish | closed (PRs #620–#704) |
| #705–#781 Phase 30–36 residual polish continue | closed (PRs #711–#786) |
| #787–#826 Phase 37–40 residual polish continue | closed (PRs #793–#831; hygiene ops-only) |
| #832–#843 Phase 41 residual polish continue | closed (PRs #844–#851; #837/#843 hygiene ops-only) |
| #852–#857 Phase 42 security gates + residual polish | closed (PRs #858–#864; #857 hygiene ops-only) |
| #865–#870 Phase 43 delivery/executor stability + residual | closed (PRs #871–#875; #870 hygiene ops-only) |
| #876–#881 Phase 44 security residual + design + mobile auth | closed (PRs #882–#886; #881 hygiene ops-only) |
| #887–#892 Phase 45 auth residual + residual polish | closed (PRs #893–#897; #892 hygiene ops-only) |
| #898–#903 Phase 46 dual-token hard gate + design/shared residual | closed (PRs #904–#908; #903 hygiene ops-only) |
| #909–#914 Phase 47 design token residual + godfile peels | closed (PRs #915–#919; #914 hygiene ops-only) |
| #920–#925 Phase 48 WS protocol auth + design residual + peels | open (milestone 69) |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=29 and .number<=69) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 69 --state open
git worktree list
```

## Phase Checklist

- [x] Phase 0–7 cleanup baseline (PR #446)
- [x] Phase 8 security residuals (PR #464)
- [x] Phase 9–21 polish/strangler continue (#465–#608 / PRs #471–#613)
- [x] Phase 22–29 residual polish continue (#614–#699 / PRs #620–#704)
- [x] Phase 30–36 residual polish continue (#705–#781 / PRs #711–#786)
- [x] Phase 37–40 residual polish continue (#787–#826 / PRs #793–#831)
- [x] Phase 41 residual polish continue (#832–#843 / PRs #844–#851)
- [x] Phase 42 security gates + residual polish (#852–#857 / PRs #858–#864)
- [x] Phase 43 delivery/executor stability + residual (#865–#870 / PRs #871–#875)
- [x] Phase 44 security residual + design system + mobile auth (#876–#881 / PRs #882–#886)
- [x] Phase 45 auth residual + residual polish (#887–#892 / PRs #893–#897)
- [x] Phase 46 dual-token hard gate + design/shared residual (#898–#903 / PRs #904–#908)
- [x] Phase 47 design token residual + godfile peels (#909–#914 / PRs #915–#919)
- [ ] Phase 48 WS protocol auth + design residual + peels (#920–#925)

## Current Status

**Active Phase**: Phase 48 — WS protocol auth + design residual + peels (milestone 69)
**Active Tasks**: #920 MASTER · #921 Hub WS Sec-WebSocket-Protocol auth P1 · #922 IM desktop CSS SSOT P1 · #923 process_executor residual · #924 store residual · #925 hygiene
**Blockers**: None
**Stability note**: Post-P47 residual — Hub WS prefer Sec-WebSocket-Protocol over query access_token (#921, keep query fallback); IM desktop CSS design-token SSOT (#922); continue pure peels process_executor (#923) · store (#924)
**Production fact**: hk3 LIVE（server `projects/agenthub` external ops SSOT）
**Tip**: 2853359d on `master` (Phase 47 PR #915–#919 line)
**Residual after P47**: process_executor ~1185 · store ~926 · hubClient ~825 · agent_dispatch ~843
**Boundary map next residual**: WS protocol auth / IM CSS SSOT / PE pure peel / store pure helpers
**Governance**: `AGENTS.md` only · Claude native project memory · `.agenthub/memory/project.md` 过时，不得当 SSOT（#428）

## Next Steps

1. Land Phase 48 issues under milestone 69 (issue-bound Workflows)
2. Keep MASTER ≤150 lines; archive detail elsewhere
3. Prefer #921 WS protocol auth P1 · #922 IM CSS SSOT P1 · #923 PE residual · #924 store residual
4. Hold unmerged locals (`task/super-governance-baseline`) for separate review

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9–41 closed; Phase 42 security advanced |
| 2026-07-18 | lead | Phase 42–47 closed; Phase 48 WS protocol auth + design residual + peels active |

## Completion notes

- Phase 47 closed via #915–#919 (MASTER / desktop ghost status-token SSOT P1 / store residual / process_executor residual / hubClient residual; #914 hygiene ops-only). Tip ~2853359d.
- Phase 48 targets: MASTER sync, Hub WS Sec-WebSocket-Protocol auth P1, IM desktop CSS design-token SSOT P1, process_executor residual, store residual, hygiene.
