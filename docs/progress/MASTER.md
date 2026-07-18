# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#613](https://github.com/TokenDanceLab/AgentHub/pull/613) Phase 9–21 · [#620](https://github.com/TokenDanceLab/AgentHub/pull/620)–[#704](https://github.com/TokenDanceLab/AgentHub/pull/704) Phase 22–29 · [#711](https://github.com/TokenDanceLab/AgentHub/pull/711)–[#786](https://github.com/TokenDanceLab/AgentHub/pull/786) Phase 30–36 · [#793](https://github.com/TokenDanceLab/AgentHub/pull/793)–[#831](https://github.com/TokenDanceLab/AgentHub/pull/831) Phase 37–40 · [#844](https://github.com/TokenDanceLab/AgentHub/pull/844)–[#851](https://github.com/TokenDanceLab/AgentHub/pull/851) Phase 41 · [#858](https://github.com/TokenDanceLab/AgentHub/pull/858)–[#864](https://github.com/TokenDanceLab/AgentHub/pull/864) Phase 42 · [#871](https://github.com/TokenDanceLab/AgentHub/pull/871)–[#996](https://github.com/TokenDanceLab/AgentHub/pull/996) Phase 43–54 · [#1003](https://github.com/TokenDanceLab/AgentHub/pull/1003)–[#1007](https://github.com/TokenDanceLab/AgentHub/pull/1007) Phase 55 · [#1014](https://github.com/TokenDanceLab/AgentHub/pull/1014)–[#1018](https://github.com/TokenDanceLab/AgentHub/pull/1018) Phase 56 · [#1025](https://github.com/TokenDanceLab/AgentHub/pull/1025)–[#1029](https://github.com/TokenDanceLab/AgentHub/pull/1029) Phase 57 · [#1036](https://github.com/TokenDanceLab/AgentHub/pull/1036)–[#1041](https://github.com/TokenDanceLab/AgentHub/pull/1041) Phase 58 · [#1048](https://github.com/TokenDanceLab/AgentHub/pull/1048)–[#1052](https://github.com/TokenDanceLab/AgentHub/pull/1052) Phase 59 · [#1059](https://github.com/TokenDanceLab/AgentHub/pull/1059)–[#1063](https://github.com/TokenDanceLab/AgentHub/pull/1063) Phase 60 · [#1072](https://github.com/TokenDanceLab/AgentHub/pull/1072)–[#1082](https://github.com/TokenDanceLab/AgentHub/pull/1082) Phase 61 · [#1089](https://github.com/TokenDanceLab/AgentHub/pull/1089)–[#1092](https://github.com/TokenDanceLab/AgentHub/pull/1092) Phase 62 · [#1097](https://github.com/TokenDanceLab/AgentHub/pull/1097)–[#1100](https://github.com/TokenDanceLab/AgentHub/pull/1100) Phase 63 · [#1106](https://github.com/TokenDanceLab/AgentHub/pull/1106)–[#1110](https://github.com/TokenDanceLab/AgentHub/pull/1110) Phase 64 · [#1116](https://github.com/TokenDanceLab/AgentHub/pull/1116)–[#1120](https://github.com/TokenDanceLab/AgentHub/pull/1120) Phase 65 · [#1126](https://github.com/TokenDanceLab/AgentHub/pull/1126)–[#1130](https://github.com/TokenDanceLab/AgentHub/pull/1130) Phase 66 · [#1136](https://github.com/TokenDanceLab/AgentHub/pull/1136)–[#1140](https://github.com/TokenDanceLab/AgentHub/pull/1140) Phase 67 · [#1146](https://github.com/TokenDanceLab/AgentHub/pull/1146)–[#1150](https://github.com/TokenDanceLab/AgentHub/pull/1150) Phase 68 · [#1156](https://github.com/TokenDanceLab/AgentHub/pull/1156)–[#1160](https://github.com/TokenDanceLab/AgentHub/pull/1160) Phase 69

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
- **Phase 70 open Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 91 --state open`
- **Labels**: `spec-driven` · `phase:70`

## References

- Analysis: [project-overview](../analysis/project-overview.md) · [module-inventory](../analysis/module-inventory.md) · [hub-service-boundary-map](../analysis/hub-service-boundary-map.md) · [design-token-usage-audit](../analysis/design-token-usage-audit.md)
- Architecture: [07-design-system-ssot](../architecture/07-design-system-ssot.md) · Archive: `docs/archives/cleanup-baseline/` · wiki (non-SSOT)
- Root layout ADR: [root-layout](../analysis/root-layout.md)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–7 | Cleanup baseline | #22–#28 | closed |
| 8–67 | Polish / residual peels | #29–#88 | closed (see prior rows) |
| 68 | Residual peels continue | #89 | closed (PRs #1146–#1150; 5/5 issues) |
| 69 | Residual peels continue | #90 | closed (PRs #1156–#1160; 5/5 issues) |
| 70 | Residual peels continue | #91 | active (open #1161–#1165) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #424–#1150 Phase 1–68 | closed (see prior session logs) |
| #1151–#1155 Phase 69 | closed (PRs #1156–#1160) |
| #1161–#1165 Phase 70 | open peels + hygiene |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=88 and .number<=91) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 91 --state open
git worktree list
```

## Phase Checklist

- [x] Phase 0–68 (see earlier rows)
- [x] Phase 69 residual peels continue (ms 90; PRs #1156–#1160)
- [ ] Phase 70 residual peels continue (ms 91)

## Current Status

**Active Phase**: Phase 70 — Residual peels continue (milestone 91; open=5)
**Active Tasks**: #1161 session service · #1162 agent_team model · #1163 agent_team handler · #1164 skills · #1165 MASTER hygiene
**Blockers**: None
**Stability note**: Phase 69 closed — DiffReviewPanel 667→361 · openai_sdk 617→241 · message service 618→68 · agents registry 595→135
**Production fact**: external ops SSOT only (server `projects/agenthub`; do not invent host labels in-repo)
**Product tip**: last product code = peels #1151–#1154 (PRs #1157–#1160); latest: `git rev-parse --short origin/master`
**Residual LOC band**: i18n/resources 817 · agent_team model 627 · session service 612 · agent_team handler 577 · agent_team_run 575 · agent_team_approval 574 · agent_team_routing 572 · skills 558 · hubClient types 556–568
**Boundary map next residual**: session service / agent_team model / agent_team handler / skills peels
**Orchestration**: main session gate only; easy pure peels → sonnet/haiku worktrees; escalate fable for watch/race-y logic
**Governance**: `AGENTS.md` only · Claude native project memory · `.agenthub/memory/**` local scratch only, never SSOT (#428)

## Next Steps

1. Land Phase 70 peels #1161–#1164 (issue-bound worktrees; sonnet-first)
2. Land hygiene #1165 (MASTER/roadmap live pointers)
3. Keep `super-governance-baseline` held; no bulk root move (ADR #1046)
4. MASTER ≤150 lines; live open = `gh issue list --milestone 91 --state open`
5. Defer low-ROI: i18n resource tables, pure type dumps unless export chaos

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9–41 closed; Phase 42 security advanced |
| 2026-07-18–19 | lead | P60–P69 closed; P70 open (ms 91; #1161–#1165) |

## Completion notes

- Phase 68 closed via #1141–#1145 (PRs #1146–#1150). ms 89 closed.
- Phase 69 closed via #1151–#1155 (PRs #1156–#1160): DiffReview 667→361 · openai 617→241 · message 618→68 · registry 595→135. ms 90 closed.
