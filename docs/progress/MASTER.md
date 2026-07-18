# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-18
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#613](https://github.com/TokenDanceLab/AgentHub/pull/613) Phase 9–21 · [#620](https://github.com/TokenDanceLab/AgentHub/pull/620)–[#704](https://github.com/TokenDanceLab/AgentHub/pull/704) Phase 22–29 · [#711](https://github.com/TokenDanceLab/AgentHub/pull/711)–[#786](https://github.com/TokenDanceLab/AgentHub/pull/786) Phase 30–36 · [#793](https://github.com/TokenDanceLab/AgentHub/pull/793)–[#831](https://github.com/TokenDanceLab/AgentHub/pull/831) Phase 37–40 · [#844](https://github.com/TokenDanceLab/AgentHub/pull/844)–[#851](https://github.com/TokenDanceLab/AgentHub/pull/851) Phase 41 · [#858](https://github.com/TokenDanceLab/AgentHub/pull/858)–[#864](https://github.com/TokenDanceLab/AgentHub/pull/864) Phase 42 · [#871](https://github.com/TokenDanceLab/AgentHub/pull/871)–[#996](https://github.com/TokenDanceLab/AgentHub/pull/996) Phase 43–54 · [#1003](https://github.com/TokenDanceLab/AgentHub/pull/1003)–[#1007](https://github.com/TokenDanceLab/AgentHub/pull/1007) Phase 55 · [#1014](https://github.com/TokenDanceLab/AgentHub/pull/1014)–[#1018](https://github.com/TokenDanceLab/AgentHub/pull/1018) Phase 56 · [#1025](https://github.com/TokenDanceLab/AgentHub/pull/1025)–[#1029](https://github.com/TokenDanceLab/AgentHub/pull/1029) Phase 57 · [#1036](https://github.com/TokenDanceLab/AgentHub/pull/1036)–[#1041](https://github.com/TokenDanceLab/AgentHub/pull/1041) Phase 58 · [#1048](https://github.com/TokenDanceLab/AgentHub/pull/1048)–[#1052](https://github.com/TokenDanceLab/AgentHub/pull/1052) Phase 59 · [#1059](https://github.com/TokenDanceLab/AgentHub/pull/1059)–[#1063](https://github.com/TokenDanceLab/AgentHub/pull/1063) Phase 60 · [#1072](https://github.com/TokenDanceLab/AgentHub/pull/1072)–[#1076](https://github.com/TokenDanceLab/AgentHub/pull/1076) Phase 61

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
- **Phase 61 open Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 82 --state open`
- **Labels**: `spec-driven` · `phase:61`

## References

- Analysis: [project-overview](../analysis/project-overview.md) · [module-inventory](../analysis/module-inventory.md) · [hub-service-boundary-map](../analysis/hub-service-boundary-map.md) · [design-token-usage-audit](../analysis/design-token-usage-audit.md)
- Architecture: [07-design-system-ssot](../architecture/07-design-system-ssot.md) · Archive: `docs/archives/cleanup-baseline/` · wiki (non-SSOT)
- Root layout ADR: [root-layout](../analysis/root-layout.md)

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
| 58 | Offline/outbox dual redelivery + residual peels | #79 | closed (PRs #1036–#1041) |
| 59 | Residual peels + root layout research | #80 | closed (PRs #1048–#1052; #1047 ops-only) |
| 60 | Residual peels + product polish continue | #81 | closed (PRs #1059–#1063; #1058 ops-only) |
| 61 | Residual peels + design-token residual continue | #82 | active (open #1067–#1069; hygiene/design-token closed) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #424–#457 cleanup Phases 1–7 | closed (PR #446) |
| #458–#991 Phase 8–54 | closed (see prior session logs) |
| #997–#1002 Phase 55 | closed (PRs #1003–#1007) |
| #1008–#1013 Phase 56 | closed (PRs #1014–#1018) |
| #1019–#1024 Phase 57 | closed (PRs #1025–#1029) |
| #1030–#1035 Phase 58 | closed (PRs #1036–#1041) |
| #1042–#1047 Phase 59 | closed (PRs #1048–#1052) |
| #1053–#1058 Phase 60 | closed (PRs #1059–#1063; #1058 ops-only) |
| #1066–#1071 Phase 61 Wave1 | #1066/#1070/#1071 closed; open peels #1067–#1069 |
| #1075–#1077 Phase 61 docs tip | #1075 closed (#1076); #1077 this tip align |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=29 and .number<=82) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 82 --state open
git worktree list
```

## Phase Checklist

- [x] Phase 0–59 (see earlier rows)
- [x] Phase 60 residual peels + product polish (#1053–#1058 / PRs #1059–#1063)
- [ ] Phase 61 residual peels continue (#1067–#1069 open; #1066/#1070/#1071 closed)

## Current Status

**Active Phase**: Phase 61 — Residual peels continue (milestone 82; open=3)
**Active Tasks**: #1067 process_executor peel · #1068 agent_dispatch peel · #1069 sqlite_store peel
**Blockers**: None (Wave1 product peels #1067–#1069 not started after 429; design-token + progress hygiene landed)
**Stability note**: #1066 MASTER (#1072) · #1070 design-token (#1073) · #1071 hygiene (#1074) · #1075 tip (#1076)
**Production fact**: external ops SSOT only (server `projects/agenthub`; do not invent host labels in-repo)
**Tip**: a26a2828 on `master` (#1075/#1076; prior hygiene #1074 @ 6c42a0dc · design-token #1073 @ 96588ea1)
**Residual LOC band**: process_executor 1126 · hubClient 526 · agent_dispatch 786 · sqlite_store 709 · delivery_outbox 469
**Boundary map next residual**: PE / agent_dispatch / sqlite_store peels only
**Governance**: `AGENTS.md` only · Claude native project memory · `.agenthub/memory/**` local scratch only, never SSOT (#428)

## Next Steps

1. Land residual peels #1067–#1069 from tip (issue-bound worktrees)
2. Keep `super-governance-baseline` held; no bulk root move (ADR #1046)
3. Keep MASTER ≤150 lines; live pointers stay Phase 61 / ms 82

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9–41 closed; Phase 42 security advanced |
| 2026-07-18 | lead | P60 closed; P61 open peels #1067–#1069; tip a26a2828; hygiene/design-token closed |

## Completion notes

- Phase 59 closed via #1042–#1047 (PRs #1048–#1052). Tip 82d904e7. ms 80 closed.
- Phase 60 closed via #1053–#1058 (PRs #1059–#1063; #1058 hygiene ops-only): PE 1146→1126 · hubClient 671→526 · agent_dispatch 789→786 · design-token ModelDropdown/IM. Product tip 03decef8. ms 81 closed.
- Phase 61 progress: #1066 MASTER (#1072) · #1070 design-token (#1073) · #1071 hygiene (#1074) · #1075 tip self-heal (#1076 @ a26a2828). Open peels #1067–#1069.
