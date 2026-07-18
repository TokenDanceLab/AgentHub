# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-18
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#613](https://github.com/TokenDanceLab/AgentHub/pull/613) Phase 9–21 · [#620](https://github.com/TokenDanceLab/AgentHub/pull/620)–[#704](https://github.com/TokenDanceLab/AgentHub/pull/704) Phase 22–29 · [#711](https://github.com/TokenDanceLab/AgentHub/pull/711)–[#786](https://github.com/TokenDanceLab/AgentHub/pull/786) Phase 30–36 · [#793](https://github.com/TokenDanceLab/AgentHub/pull/793)–[#831](https://github.com/TokenDanceLab/AgentHub/pull/831) Phase 37–40 · [#844](https://github.com/TokenDanceLab/AgentHub/pull/844)–[#851](https://github.com/TokenDanceLab/AgentHub/pull/851) Phase 41 · [#858](https://github.com/TokenDanceLab/AgentHub/pull/858)–[#864](https://github.com/TokenDanceLab/AgentHub/pull/864) Phase 42 · [#871](https://github.com/TokenDanceLab/AgentHub/pull/871)–[#996](https://github.com/TokenDanceLab/AgentHub/pull/996) Phase 43–54 · [#1003](https://github.com/TokenDanceLab/AgentHub/pull/1003)–[#1007](https://github.com/TokenDanceLab/AgentHub/pull/1007) Phase 55 · [#1014](https://github.com/TokenDanceLab/AgentHub/pull/1014)–[#1018](https://github.com/TokenDanceLab/AgentHub/pull/1018) Phase 56 · [#1025](https://github.com/TokenDanceLab/AgentHub/pull/1025)–[#1029](https://github.com/TokenDanceLab/AgentHub/pull/1029) Phase 57 · [#1036](https://github.com/TokenDanceLab/AgentHub/pull/1036)–[#1041](https://github.com/TokenDanceLab/AgentHub/pull/1041) Phase 58 · [#1048](https://github.com/TokenDanceLab/AgentHub/pull/1048)–[#1052](https://github.com/TokenDanceLab/AgentHub/pull/1052) Phase 59 · [#1059](https://github.com/TokenDanceLab/AgentHub/pull/1059)–[#1063](https://github.com/TokenDanceLab/AgentHub/pull/1063) Phase 60 · [#1072](https://github.com/TokenDanceLab/AgentHub/pull/1072)–[#1082](https://github.com/TokenDanceLab/AgentHub/pull/1082) Phase 61 · [#1089](https://github.com/TokenDanceLab/AgentHub/pull/1089)–[#1092](https://github.com/TokenDanceLab/AgentHub/pull/1092) Phase 62 · [#1097](https://github.com/TokenDanceLab/AgentHub/pull/1097)–[#1100](https://github.com/TokenDanceLab/AgentHub/pull/1100) Phase 63

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
- **Phase 64 open Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 85 --state open`
- **Labels**: `spec-driven` · `phase:64`

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
| 61 | Residual peels + design-token residual continue | #82 | closed (PRs #1072–#1082; 8/8 issues) |
| 62 | Residual peels continue | #83 | closed (PRs #1089–#1092; 4/4 issues) |
| 63 | Residual peels continue | #84 | closed (PRs #1097–#1100; 4/4 issues) |
| 64 | Residual peels continue | #85 | active (open #1101–#1105) |

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
| #1066–#1071 / #1075 / #1077 Phase 61 | closed (PRs #1072–#1082) |
| #1084–#1087 Phase 62 | closed (PRs #1089–#1092) |
| #1093–#1096 Phase 63 | closed (PRs #1097–#1100) |
| #1101–#1105 Phase 64 | open peels + hygiene |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=80 and .number<=85) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 85 --state open
git worktree list
```

## Phase Checklist

- [x] Phase 0–62 (see earlier rows)
- [x] Phase 63 residual peels continue (ms 84; PRs #1097–#1100)
- [ ] Phase 64 residual peels continue (ms 85)

## Current Status

**Active Phase**: Phase 64 — Residual peels continue (milestone 85; open=5)
**Active Tasks**: #1101 hubClientPayloadRequests · #1102 hubClientTransportUtils · #1103 codex adapter · #1104 mcp tools · #1105 MASTER hygiene
**Blockers**: None
**Stability note**: Phase 63 closed — sqlite_store_query 806→241 · orchestrator_failure 1013→423 · hubClientPayloadUtils 1587→227 (barrel)
**Production fact**: external ops SSOT only (server `projects/agenthub`; do not invent host labels in-repo)
**Product tip**: last product code = peels #1093–#1095 (PRs #1098–#1100); latest: `git rev-parse --short origin/master`
**Residual LOC band**: hubClientPayloadRequests 1014 · hubClientTransportUtils 946 · codex 926 · mcp/tools 890 · orchestrator 818 · surfacing 785 · httpserver 735 · parser_ndjson 704 · sqlite_store 461 · orchestrator_failure 423
**Boundary map next residual**: payload requests / transport utils / codex / mcp tools peels
**Governance**: `AGENTS.md` only · Claude native project memory · `.agenthub/memory/**` local scratch only, never SSOT (#428)

## Next Steps

1. Land Phase 64 peels #1101–#1104 (issue-bound worktrees)
2. Land hygiene #1105 (MASTER/roadmap live pointers)
3. Keep `super-governance-baseline` held; no bulk root move (ADR #1046)
4. MASTER ≤150 lines; live open = `gh issue list --milestone 85 --state open`

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9–41 closed; Phase 42 security advanced |
| 2026-07-18 | lead | P60–P63 closed; P64 open (ms 85; #1101–#1105) |

## Completion notes

- Phase 62 closed via #1084–#1087 (PRs #1089–#1092). ms 83 closed.
- Phase 63 closed via #1093–#1096 (PRs #1097–#1100): query 806→241 · failure 1013→423 · payload utils 1587→227. ms 84 closed.
