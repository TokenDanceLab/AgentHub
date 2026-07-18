# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#613](https://github.com/TokenDanceLab/AgentHub/pull/613) Phase 9–21 · [#620](https://github.com/TokenDanceLab/AgentHub/pull/620)–[#704](https://github.com/TokenDanceLab/AgentHub/pull/704) Phase 22–29 · [#711](https://github.com/TokenDanceLab/AgentHub/pull/711)–[#786](https://github.com/TokenDanceLab/AgentHub/pull/786) Phase 30–36 · [#793](https://github.com/TokenDanceLab/AgentHub/pull/793)–[#831](https://github.com/TokenDanceLab/AgentHub/pull/831) Phase 37–40 · [#844](https://github.com/TokenDanceLab/AgentHub/pull/844)–[#851](https://github.com/TokenDanceLab/AgentHub/pull/851) Phase 41 · [#858](https://github.com/TokenDanceLab/AgentHub/pull/858)–[#864](https://github.com/TokenDanceLab/AgentHub/pull/864) Phase 42 · [#871](https://github.com/TokenDanceLab/AgentHub/pull/871)–[#996](https://github.com/TokenDanceLab/AgentHub/pull/996) Phase 43–54 · [#1003](https://github.com/TokenDanceLab/AgentHub/pull/1003)–[#1007](https://github.com/TokenDanceLab/AgentHub/pull/1007) Phase 55 · [#1014](https://github.com/TokenDanceLab/AgentHub/pull/1014)–[#1018](https://github.com/TokenDanceLab/AgentHub/pull/1018) Phase 56 · [#1025](https://github.com/TokenDanceLab/AgentHub/pull/1025)–[#1029](https://github.com/TokenDanceLab/AgentHub/pull/1029) Phase 57 · [#1036](https://github.com/TokenDanceLab/AgentHub/pull/1036)–[#1041](https://github.com/TokenDanceLab/AgentHub/pull/1041) Phase 58 · [#1048](https://github.com/TokenDanceLab/AgentHub/pull/1048)–[#1052](https://github.com/TokenDanceLab/AgentHub/pull/1052) Phase 59 · [#1059](https://github.com/TokenDanceLab/AgentHub/pull/1059)–[#1063](https://github.com/TokenDanceLab/AgentHub/pull/1063) Phase 60 · [#1072](https://github.com/TokenDanceLab/AgentHub/pull/1072)–[#1082](https://github.com/TokenDanceLab/AgentHub/pull/1082) Phase 61 · [#1089](https://github.com/TokenDanceLab/AgentHub/pull/1089)–[#1092](https://github.com/TokenDanceLab/AgentHub/pull/1092) Phase 62 · [#1097](https://github.com/TokenDanceLab/AgentHub/pull/1097)–[#1100](https://github.com/TokenDanceLab/AgentHub/pull/1100) Phase 63 · [#1106](https://github.com/TokenDanceLab/AgentHub/pull/1106)–[#1110](https://github.com/TokenDanceLab/AgentHub/pull/1110) Phase 64 · [#1116](https://github.com/TokenDanceLab/AgentHub/pull/1116)–[#1120](https://github.com/TokenDanceLab/AgentHub/pull/1120) Phase 65 · [#1126](https://github.com/TokenDanceLab/AgentHub/pull/1126)–[#1130](https://github.com/TokenDanceLab/AgentHub/pull/1130) Phase 66 · [#1136](https://github.com/TokenDanceLab/AgentHub/pull/1136)–[#1140](https://github.com/TokenDanceLab/AgentHub/pull/1140) Phase 67 · [#1146](https://github.com/TokenDanceLab/AgentHub/pull/1146)–[#1150](https://github.com/TokenDanceLab/AgentHub/pull/1150) Phase 68 · [#1156](https://github.com/TokenDanceLab/AgentHub/pull/1156)–[#1160](https://github.com/TokenDanceLab/AgentHub/pull/1160) Phase 69 · [#1166](https://github.com/TokenDanceLab/AgentHub/pull/1166)–[#1170](https://github.com/TokenDanceLab/AgentHub/pull/1170) Phase 70

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
- **Phase 71 open Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 92 --state open`
- **Labels**: `spec-driven` · `phase:71`

## References

- Analysis: [project-overview](../analysis/project-overview.md) · [module-inventory](../analysis/module-inventory.md) · [hub-service-boundary-map](../analysis/hub-service-boundary-map.md) · [engineering-loop-capability-map](../analysis/engineering-loop-capability-map.md) (when landed)
- Architecture: [07-design-system-ssot](../architecture/07-design-system-ssot.md) · Archive: `docs/archives/cleanup-baseline/` · wiki (non-SSOT)
- Root layout ADR: [root-layout](../analysis/root-layout.md)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–7 | Cleanup baseline | #22–#28 | closed |
| 8–68 | Polish / residual peels | #29–#89 | closed (see prior rows) |
| 69 | Residual peels continue | #90 | closed (PRs #1156–#1160; 5/5 issues) |
| 70 | Residual peels continue | #91 | closed (PRs #1166–#1170; 5/5 issues) |
| 71 | Engineering loop + local workspace surface | #92 | active (open #1171–#1175) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #424–#1160 Phase 1–69 | closed (see prior session logs) |
| #1161–#1165 Phase 70 | closed (PRs #1166–#1170) |
| #1171–#1175 Phase 71 | open product wave + hygiene |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=89 and .number<=92) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 92 --state open
git worktree list
```

## Phase Checklist

- [x] Phase 0–69 (see earlier rows)
- [x] Phase 70 residual peels continue (ms 91; PRs #1166–#1170)
- [ ] Phase 71 engineering loop + local workspace surface (ms 92)

## Current Status

**Active Phase**: Phase 71 — Engineering loop + local workspace surface (milestone 92; open=5)
**Active Tasks**: #1171 capability map · #1172 aux panel shell · #1173 local session index · #1174 terminal host · #1175 MASTER hygiene
**Blockers**: None
**Stability note**: Phase 70 closed — session service / agent_team model+handler / skills peels
**Production fact**: external ops SSOT only (server `projects/agenthub`; do not invent host labels in-repo)
**Product tip**: last product code = peels #1161–#1164 (PRs #1167–#1170); latest: `git rev-parse --short origin/master`
**Product focus**: dense local engineering loop on Desktop (aux panel, session aggregation, terminal host) while preserving Hub IM + Web remote control boundaries
**Governance**: `AGENTS.md` only · Claude native project memory · `.agenthub/memory/**` local scratch only, never SSOT (#428)

## Next Steps

1. Land #1171 capability map (docs SSOT for Wave2)
2. Parallel implement #1172 aux panel · #1173 session index · #1174 terminal host (issue-bound worktrees; file ownership split)
3. Land hygiene #1175
4. Keep red lines: Web no Local Edge; renderer no raw process
5. Keep `super-governance-baseline` held

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9–41 closed; Phase 42 security advanced |
| 2026-07-18–19 | lead | P60–P70 closed; P71 open (ms 92; engineering loop wave) |

## Completion notes

- Phase 69 closed via #1151–#1155 (PRs #1156–#1160). ms 90 closed.
- Phase 70 closed via #1161–#1165 (PRs #1166–#1170). ms 91 closed.
