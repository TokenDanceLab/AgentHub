# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-18
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#613](https://github.com/TokenDanceLab/AgentHub/pull/613) Phase 9–21 · [#620](https://github.com/TokenDanceLab/AgentHub/pull/620)–[#704](https://github.com/TokenDanceLab/AgentHub/pull/704) Phase 22–29 · [#711](https://github.com/TokenDanceLab/AgentHub/pull/711)–[#786](https://github.com/TokenDanceLab/AgentHub/pull/786) Phase 30–36 · [#793](https://github.com/TokenDanceLab/AgentHub/pull/793)–[#831](https://github.com/TokenDanceLab/AgentHub/pull/831) Phase 37–40 · [#844](https://github.com/TokenDanceLab/AgentHub/pull/844)–[#851](https://github.com/TokenDanceLab/AgentHub/pull/851) Phase 41 · [#858](https://github.com/TokenDanceLab/AgentHub/pull/858)–[#864](https://github.com/TokenDanceLab/AgentHub/pull/864) Phase 42 · [#871](https://github.com/TokenDanceLab/AgentHub/pull/871)–[#875](https://github.com/TokenDanceLab/AgentHub/pull/875) Phase 43 · [#882](https://github.com/TokenDanceLab/AgentHub/pull/882)–[#886](https://github.com/TokenDanceLab/AgentHub/pull/886) Phase 44 · [#893](https://github.com/TokenDanceLab/AgentHub/pull/893)–[#897](https://github.com/TokenDanceLab/AgentHub/pull/897) Phase 45 · [#904](https://github.com/TokenDanceLab/AgentHub/pull/904)–[#908](https://github.com/TokenDanceLab/AgentHub/pull/908) Phase 46 · [#915](https://github.com/TokenDanceLab/AgentHub/pull/915)–[#919](https://github.com/TokenDanceLab/AgentHub/pull/919) Phase 47 · [#926](https://github.com/TokenDanceLab/AgentHub/pull/926)–[#930](https://github.com/TokenDanceLab/AgentHub/pull/930) Phase 48 · [#937](https://github.com/TokenDanceLab/AgentHub/pull/937)–[#941](https://github.com/TokenDanceLab/AgentHub/pull/941) Phase 49 · [#948](https://github.com/TokenDanceLab/AgentHub/pull/948)–[#952](https://github.com/TokenDanceLab/AgentHub/pull/952) Phase 50 · [#959](https://github.com/TokenDanceLab/AgentHub/pull/959)–[#963](https://github.com/TokenDanceLab/AgentHub/pull/963) Phase 51 · [#970](https://github.com/TokenDanceLab/AgentHub/pull/970)–[#974](https://github.com/TokenDanceLab/AgentHub/pull/974) Phase 52 · [#981](https://github.com/TokenDanceLab/AgentHub/pull/981)–[#985](https://github.com/TokenDanceLab/AgentHub/pull/985) Phase 53 · [#992](https://github.com/TokenDanceLab/AgentHub/pull/992)–[#996](https://github.com/TokenDanceLab/AgentHub/pull/996) Phase 54 · [#1003](https://github.com/TokenDanceLab/AgentHub/pull/1003)–[#1007](https://github.com/TokenDanceLab/AgentHub/pull/1007) Phase 55 · [#1014](https://github.com/TokenDanceLab/AgentHub/pull/1014)–[#1018](https://github.com/TokenDanceLab/AgentHub/pull/1018) Phase 56

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
- **Phase 57 Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 78 --state open`
- **Labels**: `spec-driven` · `phase:57`

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
| 57 | Callback backpressure + design token residual + peels | #78 | active (#1019–#1024) |

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
| #1019–#1024 Phase 57 callback backpressure + design token residual + peels | open (milestone 78) |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=29 and .number<=78) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 78 --state open
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
- [ ] Phase 57 callback backpressure + design token residual + peels (#1019–#1024)

## Current Status

**Active Phase**: Phase 57 — Callback backpressure + design token residual + peels (milestone 78)
**Active Tasks**: #1019 MASTER · #1020 callback backpressure P1 · #1021 design token residual P2 · #1022 PE residual · #1023 hubClient residual · #1024 hygiene
**Blockers**: None
**Stability note**: Post-P56 residual — Hub callback stream can stall lifecycle on full callbackSem (#1020 P1); ghost `--color-*` status tokens remain (#1021 P2); PE/hubClient pure peels
**Production fact**: hk3 LIVE（server `projects/agenthub` external ops SSOT）
**Tip**: 8024adb5 on `master` (Phase 56 PR #1014–#1018 line)
**Residual after P56**: process_executor ~1190 · agent_dispatch ~778 · hubClient ~739 · delivery_outbox ~469
**Boundary map next residual**: callback backpressure / design tokens / PE peel / hubClient peel
**Governance**: `AGENTS.md` only · Claude native project memory · `.agenthub/memory/project.md` 过时，不得当 SSOT（#428）

## Next Steps

1. Land Phase 57 issues under milestone 78 (issue-bound Workflows)
2. Keep MASTER ≤150 lines; archive detail elsewhere
3. Prefer #1020 callback backpressure P1 · #1021 design tokens P2 · #1022 PE residual · #1023 hubClient residual
4. Hold unmerged locals (`task/super-governance-baseline`) for separate review

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9–41 closed; Phase 42 security advanced |
| 2026-07-18 | lead | Phase 42–56 closed; Phase 57 callback backpressure + tokens active |

## Completion notes

- Phase 56 closed via #1008–#1013 (MASTER / outbox atomic claim P1 / chat loadError UX + Hub/Edge selection / PE pure peel / agent_dispatch pure peel; #1013 hygiene ops-only). Tip ~8024adb5.
- Phase 57 targets: MASTER sync, invert Hub callback backpressure P1, design token residual P2, PE pure peel, hubClient pure peel, hygiene.
