# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-18
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#613](https://github.com/TokenDanceLab/AgentHub/pull/613) Phase 9–21 · [#620](https://github.com/TokenDanceLab/AgentHub/pull/620)–[#704](https://github.com/TokenDanceLab/AgentHub/pull/704) Phase 22–29 · [#711](https://github.com/TokenDanceLab/AgentHub/pull/711)–[#786](https://github.com/TokenDanceLab/AgentHub/pull/786) Phase 30–36 · [#793](https://github.com/TokenDanceLab/AgentHub/pull/793)–[#831](https://github.com/TokenDanceLab/AgentHub/pull/831) Phase 37–40 · [#844](https://github.com/TokenDanceLab/AgentHub/pull/844)–[#851](https://github.com/TokenDanceLab/AgentHub/pull/851) Phase 41 · [#858](https://github.com/TokenDanceLab/AgentHub/pull/858)–[#864](https://github.com/TokenDanceLab/AgentHub/pull/864) Phase 42 · [#871](https://github.com/TokenDanceLab/AgentHub/pull/871)–[#875](https://github.com/TokenDanceLab/AgentHub/pull/875) Phase 43 · [#882](https://github.com/TokenDanceLab/AgentHub/pull/882)–[#886](https://github.com/TokenDanceLab/AgentHub/pull/886) Phase 44 · [#893](https://github.com/TokenDanceLab/AgentHub/pull/893)–[#897](https://github.com/TokenDanceLab/AgentHub/pull/897) Phase 45

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
- **Phase 46 Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 67 --state open`
- **Labels**: `spec-driven` · `phase:46`

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
| 46 | Dual-token hard gate + design/shared residual | #67 | active (#898–#903) |

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
| #898–#903 Phase 46 dual-token hard gate + design/shared residual | open (milestone 67) |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=29 and .number<=67) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 67 --state open
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
- [ ] Phase 46 dual-token hard gate + design/shared residual (#898–#903)

## Current Status

**Active Phase**: Phase 46 — Dual-token hard gate + design/shared residual (milestone 67)
**Active Tasks**: #898 MASTER · #899 dual-token capability hard gate P1 · #900 ChatView design-token SSOT P1 · #901 hubClient residual · #902 agent_dispatch residual · #903 hygiene
**Blockers**: None
**Stability note**: Partial 16-agent review residual — dual-token capability required when Hub identity present (#899 / AH-SR-046); ChatView tokens alias shared design SSOT (#900); residual pure peels hubClient (#901) + agent_dispatch (#902)
**Production fact**: hk3 LIVE（server `projects/agenthub` external ops SSOT）
**Tip**: 2679f8a5 on `master` (Phase 45 PR #893–#897 line)
**Residual after P45**: process_executor ~1211 · sqlite_store ~783 · hubClient ~981 · agent_dispatch ~863
**Boundary map next residual**: dual-token capability hard gate / ChatView design SSOT / hubClient pure helpers / agent_dispatch pure peel
**Governance**: `AGENTS.md` only · Claude native project memory · `.agenthub/memory/project.md` 过时，不得当 SSOT（#428）

## Next Steps

1. Land Phase 46 issues under milestone 67 (issue-bound Workflows)
2. Keep MASTER ≤150 lines; archive detail elsewhere
3. Prefer #899 dual-token capability P1 · #900 ChatView design SSOT P1 · #901 hubClient residual · #902 agent_dispatch residual
4. Hold unmerged locals (`task/super-governance-baseline`) for separate review

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9–41 closed; Phase 42 security advanced |
| 2026-07-18 | lead | Phase 42–45 closed; Phase 46 dual-token + design/shared residual active |

## Completion notes

- Phase 45 closed via #893–#897 (MASTER / access JWT jti + logout blacklist P1 / WS hub-session gate P1 / sqlite_store residual / process_executor residual; #892 hygiene ops-only). Tip ~2679f8a5.
- Phase 46 targets: MASTER sync, dual-token capability hard gate P1, ChatView design-token SSOT P1, hubClient residual, agent_dispatch residual, hygiene.
