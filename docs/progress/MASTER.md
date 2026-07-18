# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-18
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#613](https://github.com/TokenDanceLab/AgentHub/pull/613) Phase 9–21 · [#620](https://github.com/TokenDanceLab/AgentHub/pull/620)–[#704](https://github.com/TokenDanceLab/AgentHub/pull/704) Phase 22–29 · [#711](https://github.com/TokenDanceLab/AgentHub/pull/711)–[#786](https://github.com/TokenDanceLab/AgentHub/pull/786) Phase 30–36 · [#793](https://github.com/TokenDanceLab/AgentHub/pull/793)–[#831](https://github.com/TokenDanceLab/AgentHub/pull/831) Phase 37–40 · [#844](https://github.com/TokenDanceLab/AgentHub/pull/844)–[#851](https://github.com/TokenDanceLab/AgentHub/pull/851) Phase 41 · [#858](https://github.com/TokenDanceLab/AgentHub/pull/858)–[#864](https://github.com/TokenDanceLab/AgentHub/pull/864) Phase 42 · [#871](https://github.com/TokenDanceLab/AgentHub/pull/871)–[#875](https://github.com/TokenDanceLab/AgentHub/pull/875) Phase 43 · [#882](https://github.com/TokenDanceLab/AgentHub/pull/882)–[#886](https://github.com/TokenDanceLab/AgentHub/pull/886) Phase 44 · [#893](https://github.com/TokenDanceLab/AgentHub/pull/893)–[#897](https://github.com/TokenDanceLab/AgentHub/pull/897) Phase 45 · [#904](https://github.com/TokenDanceLab/AgentHub/pull/904)–[#908](https://github.com/TokenDanceLab/AgentHub/pull/908) Phase 46 · [#915](https://github.com/TokenDanceLab/AgentHub/pull/915)–[#919](https://github.com/TokenDanceLab/AgentHub/pull/919) Phase 47 · [#926](https://github.com/TokenDanceLab/AgentHub/pull/926)–[#930](https://github.com/TokenDanceLab/AgentHub/pull/930) Phase 48 · [#937](https://github.com/TokenDanceLab/AgentHub/pull/937)–[#941](https://github.com/TokenDanceLab/AgentHub/pull/941) Phase 49 · [#948](https://github.com/TokenDanceLab/AgentHub/pull/948)–[#952](https://github.com/TokenDanceLab/AgentHub/pull/952) Phase 50 · [#959](https://github.com/TokenDanceLab/AgentHub/pull/959)–[#963](https://github.com/TokenDanceLab/AgentHub/pull/963) Phase 51 · [#970](https://github.com/TokenDanceLab/AgentHub/pull/970)–[#974](https://github.com/TokenDanceLab/AgentHub/pull/974) Phase 52 · [#981](https://github.com/TokenDanceLab/AgentHub/pull/981)–[#985](https://github.com/TokenDanceLab/AgentHub/pull/985) Phase 53 · [#992](https://github.com/TokenDanceLab/AgentHub/pull/992)–[#996](https://github.com/TokenDanceLab/AgentHub/pull/996) Phase 54 · [#1003](https://github.com/TokenDanceLab/AgentHub/pull/1003)–[#1007](https://github.com/TokenDanceLab/AgentHub/pull/1007) Phase 55 · [#1014](https://github.com/TokenDanceLab/AgentHub/pull/1014)–[#1018](https://github.com/TokenDanceLab/AgentHub/pull/1018) Phase 56 · [#1025](https://github.com/TokenDanceLab/AgentHub/pull/1025)–[#1029](https://github.com/TokenDanceLab/AgentHub/pull/1029) Phase 57 · [#1036](https://github.com/TokenDanceLab/AgentHub/pull/1036)–[#1039](https://github.com/TokenDanceLab/AgentHub/pull/1039) Phase 58 partial

## Two task surfaces (do not mix)

| Surface | Role | NOT for |
|---|---|---|
| **GitHub Project + Issues** | **程序唯一任务清单 / 进度 SSOT** | 会话临时想法 |
| **Claude TaskList** | 仅本会话微编排 | 程序 backlog、跨会话进度 |

规则：跨会话可交付工作只进 GitHub Issue；Workflow/PR 必须绑定 Issue。

## Management model

1. **SPEC in-repo**：`docs/analysis/*` + historical `docs/plan/*` (cleanup-baseline freeze) + 本文件
2. **GitHub Project board**：活状态 / WIP
3. **Milestones = Phases** · **Issues = 原子任务**
4. **PR closes Issue**；Workflow 只执行已建 Issue
5. wiki 是编译知识层，**不覆盖** AGENTS / architecture / api / risk register

## GitHub Resources

- **Project Board**: https://github.com/users/DeliciousBuding/projects/6
- **Phase 58 open Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 79 --state open`
- **Labels**: `spec-driven` · `phase:58`

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
| 43–54 | Delivery/security/WS auth + residual peels | #64–#75 | closed (PRs #871–#996) |
| 55 | MCP workDir SSOT + outbox truthfulness + cascade cancel | #76 | closed (PRs #1003–#1007) |
| 56 | Outbox atomic claim + chat loadError UX + residual peels | #77 | closed (PRs #1014–#1018) |
| 57 | Callback backpressure + design token residual + peels | #78 | closed (PRs #1025–#1029) |
| 58 | Offline/outbox dual redelivery + residual peels | #79 | active (open #1033/#1035; closed #1030–#1032/#1034) |

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
| #865–#991 Phase 43–54 residual polish / security / WS auth / peels | closed (PRs #871–#996; hygiene ops-only) |
| #997–#1002 Phase 55 MCP workDir + outbox truthfulness + cascade cancel | closed (PRs #1003–#1007; #1002 hygiene ops-only) |
| #1008–#1013 Phase 56 outbox atomic claim + chat loadError UX + residual peels | closed (PRs #1014–#1018; #1013 hygiene ops-only) |
| #1019–#1024 Phase 57 callback backpressure + design token residual + peels | closed (PRs #1025–#1029; #1024 hygiene ops-only) |
| #1030–#1035 Phase 58 offline/outbox dual redelivery + residual peels | partial — closed #1030/#1031/#1032/#1034 (PRs #1036–#1039); open #1033/#1035 (milestone 79 open=2) |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=29 and .number<=79) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 79 --state open
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
- [x] Phase 43–54 residual polish / security / WS auth / peels (#865–#991 / PRs #871–#996)
- [x] Phase 55 MCP workDir SSOT + outbox truthfulness + cascade cancel (#997–#1002 / PRs #1003–#1007)
- [x] Phase 56 outbox atomic claim + chat loadError UX + residual peels (#1008–#1013 / PRs #1014–#1018)
- [x] Phase 57 callback backpressure + design token residual + peels (#1019–#1024 / PRs #1025–#1029)
- [ ] Phase 58 offline/outbox dual redelivery + residual peels (#1030–#1035)

## Current Status

**Active Phase**: Phase 58 — Offline/outbox dual redelivery + residual peels (milestone 79; open=2)
**Active Tasks**: #1033 agent_dispatch residual pure peel · #1035 hygiene closeout
**Blockers**: None
**Stability note**: Phase 58 partial — dual redelivery ownership + sqlite_store peel + OpenAPI envelope note landed; residual pure peel on agent_dispatch; hygiene closeout open
**Production fact**: external ops SSOT only (server `projects/agenthub`; do not invent host labels in-repo)
**Tip**: 8f4a846c on `master` (Phase 58 partial PRs #1036–#1039)
**Residual LOC band**: process_executor 1160 · hubClient 696 · agent_dispatch 800 · sqlite_store 709 · delivery_outbox 469
**Boundary map next residual**: agent_dispatch peel (#1033) · hygiene closeout (#1035)
**Governance**: `AGENTS.md` only · Claude native project memory · `.agenthub/memory/**` local scratch only, never SSOT (#428)

## Next Steps

1. Prefer #1033 agent_dispatch residual pure peel, then #1035 hygiene closeout (issue-bound Workflows)
2. Keep MASTER ≤150 lines; archive detail elsewhere
3. Hold unmerged locals (`task/super-governance-baseline`) for separate review

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9–41 closed; Phase 42 security advanced |
| 2026-07-18 | lead | Phase 42–57 closed; Phase 58 partial landings #1030/#1031/#1032/#1034; open #1033/#1035 |

## Completion notes

- Phase 57 closed via #1019–#1024 (PRs #1025–#1029). Tip then dd576b4a.
- 2026-07-18 Phase 58 partial: #1030 MASTER (#1036) · #1031 dual redelivery (#1038) · #1032 sqlite_store (#1039) · #1034 OpenAPI envelope note (#1037). Tip 8f4a846c. Open: #1033 agent_dispatch · #1035 hygiene.
