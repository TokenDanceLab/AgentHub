# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-19
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#613](https://github.com/TokenDanceLab/AgentHub/pull/613) Phase 9–21 · [#620](https://github.com/TokenDanceLab/AgentHub/pull/620)–[#704](https://github.com/TokenDanceLab/AgentHub/pull/704) Phase 22–29 · [#711](https://github.com/TokenDanceLab/AgentHub/pull/711)–[#786](https://github.com/TokenDanceLab/AgentHub/pull/786) Phase 30–36 · [#793](https://github.com/TokenDanceLab/AgentHub/pull/793)–[#831](https://github.com/TokenDanceLab/AgentHub/pull/831) Phase 37–40 · [#844](https://github.com/TokenDanceLab/AgentHub/pull/844)–[#851](https://github.com/TokenDanceLab/AgentHub/pull/851) Phase 41 · [#858](https://github.com/TokenDanceLab/AgentHub/pull/858)–[#864](https://github.com/TokenDanceLab/AgentHub/pull/864) Phase 42 · [#871](https://github.com/TokenDanceLab/AgentHub/pull/871)–[#996](https://github.com/TokenDanceLab/AgentHub/pull/996) Phase 43–54 · [#1003](https://github.com/TokenDanceLab/AgentHub/pull/1003)–[#1007](https://github.com/TokenDanceLab/AgentHub/pull/1007) Phase 55 · [#1014](https://github.com/TokenDanceLab/AgentHub/pull/1014)–[#1018](https://github.com/TokenDanceLab/AgentHub/pull/1018) Phase 56 · [#1025](https://github.com/TokenDanceLab/AgentHub/pull/1025)–[#1029](https://github.com/TokenDanceLab/AgentHub/pull/1029) Phase 57 · [#1036](https://github.com/TokenDanceLab/AgentHub/pull/1036)–[#1041](https://github.com/TokenDanceLab/AgentHub/pull/1041) Phase 58 · [#1048](https://github.com/TokenDanceLab/AgentHub/pull/1048)–[#1052](https://github.com/TokenDanceLab/AgentHub/pull/1052) Phase 59 · [#1059](https://github.com/TokenDanceLab/AgentHub/pull/1059)–[#1063](https://github.com/TokenDanceLab/AgentHub/pull/1063) Phase 60 · [#1072](https://github.com/TokenDanceLab/AgentHub/pull/1072)–[#1082](https://github.com/TokenDanceLab/AgentHub/pull/1082) Phase 61 · [#1089](https://github.com/TokenDanceLab/AgentHub/pull/1089)–[#1092](https://github.com/TokenDanceLab/AgentHub/pull/1092) Phase 62 · [#1097](https://github.com/TokenDanceLab/AgentHub/pull/1097)–[#1100](https://github.com/TokenDanceLab/AgentHub/pull/1100) Phase 63 · [#1106](https://github.com/TokenDanceLab/AgentHub/pull/1106)–[#1110](https://github.com/TokenDanceLab/AgentHub/pull/1110) Phase 64 · [#1116](https://github.com/TokenDanceLab/AgentHub/pull/1116)–[#1120](https://github.com/TokenDanceLab/AgentHub/pull/1120) Phase 65 · [#1126](https://github.com/TokenDanceLab/AgentHub/pull/1126)–[#1130](https://github.com/TokenDanceLab/AgentHub/pull/1130) Phase 66

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
- **Phase 67 open Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 88 --state open`
- **Labels**: `spec-driven` · `phase:67`

## References

- Analysis: [project-overview](../analysis/project-overview.md) · [module-inventory](../analysis/module-inventory.md) · [hub-service-boundary-map](../analysis/hub-service-boundary-map.md) · [design-token-usage-audit](../analysis/design-token-usage-audit.md)
- Architecture: [07-design-system-ssot](../architecture/07-design-system-ssot.md) · Archive: `docs/archives/cleanup-baseline/` · wiki (non-SSOT)
- Root layout ADR: [root-layout](../analysis/root-layout.md)

## Milestones

| Phase | Name | Milestone | Status |
|:------|:-----|:----------|:-------|
| 1–7 | Cleanup baseline | #22–#28 | closed |
| 8–64 | Polish / residual peels | #29–#85 | closed (see prior rows) |
| 65 | Residual peels continue | #86 | closed (PRs #1116–#1120; 5/5 issues) |
| 66 | Residual peels continue | #87 | closed (PRs #1126–#1130; 5/5 issues) |
| 67 | Residual peels continue | #88 | active (open #1131–#1135) |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #424–#1100 Phase 1–63 | closed (see prior session logs) |
| #1101–#1105 Phase 64 | closed (PRs #1106–#1110) |
| #1111–#1115 Phase 65 | closed (PRs #1116–#1120) |
| #1121–#1125 Phase 66 | closed (PRs #1126–#1130) |
| #1131–#1135 Phase 67 | open peels + hygiene |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=85 and .number<=88) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 88 --state open
git worktree list
```

## Phase Checklist

- [x] Phase 0–65 (see earlier rows)
- [x] Phase 66 residual peels continue (ms 87; PRs #1126–#1130)
- [ ] Phase 67 residual peels continue (ms 88)

## Current Status

**Active Phase**: Phase 67 — Residual peels continue (milestone 88; open=5)
**Active Tasks**: #1131 workbenchDemo · #1132 chatviewFixtures · #1133 model_catalog · #1134 hub config · #1135 MASTER hygiene
**Blockers**: None
**Stability note**: Phase 66 closed — process_executor_pure 2440→238 · sdk_fixture_mapper 694→169 · cache/client 682→106 · edgeEventMappers 679→40 barrel
**Production fact**: external ops SSOT only (server `projects/agenthub`; do not invent host labels in-repo)
**Product tip**: last product code = peels #1121–#1124 (PRs #1127–#1130); latest: `git rev-parse --short origin/master`
**Residual LOC band**: workbenchDemo 897 · chatviewFixtures 844 · i18n/resources 817 · model_catalog 676 · config 670 · context_budget 668 · anthropic_sdk 668 · DiffReviewPanel 667 · chatview/adapter 659 · store 635
**Boundary map next residual**: workbenchDemo / chatviewFixtures / model_catalog / hub config peels
**Governance**: `AGENTS.md` only · Claude native project memory · `.agenthub/memory/**` local scratch only, never SSOT (#428)

## Next Steps

1. Land Phase 67 peels #1131–#1134 (issue-bound worktrees)
2. Land hygiene #1135 (MASTER/roadmap live pointers)
3. Keep `super-governance-baseline` held; no bulk root move (ADR #1046)
4. MASTER ≤150 lines; live open = `gh issue list --milestone 88 --state open`

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9–41 closed; Phase 42 security advanced |
| 2026-07-18–19 | lead | P60–P66 closed; P67 open (ms 88; #1131–#1135) |

## Completion notes

- Phase 65 closed via #1111–#1115 (PRs #1116–#1120). ms 86 closed.
- Phase 66 closed via #1121–#1125 (PRs #1126–#1130): pure 2440→238 · fixture 694→169 · cache 682→106 · mappers 679→40. ms 87 closed.
