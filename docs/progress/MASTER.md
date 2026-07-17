# AgentHub Progress Tracker

> **Task**: continuous product polish (architecture / UIUX / design system / hygiene)
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-18
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Merged program PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 · [#471](https://github.com/TokenDanceLab/AgentHub/pull/471)–[#613](https://github.com/TokenDanceLab/AgentHub/pull/613) Phase 9–21 · [#620](https://github.com/TokenDanceLab/AgentHub/pull/620)–[#704](https://github.com/TokenDanceLab/AgentHub/pull/704) Phase 22–29 · [#711](https://github.com/TokenDanceLab/AgentHub/pull/711)–[#786](https://github.com/TokenDanceLab/AgentHub/pull/786) Phase 30–36 · [#793](https://github.com/TokenDanceLab/AgentHub/pull/793)–[#797](https://github.com/TokenDanceLab/AgentHub/pull/797) Phase 37 · [#804](https://github.com/TokenDanceLab/AgentHub/pull/804)–[#808](https://github.com/TokenDanceLab/AgentHub/pull/808) Phase 38 · [#815](https://github.com/TokenDanceLab/AgentHub/pull/815)–[#820](https://github.com/TokenDanceLab/AgentHub/pull/820) Phase 39 · [#827](https://github.com/TokenDanceLab/AgentHub/pull/827)–[#831](https://github.com/TokenDanceLab/AgentHub/pull/831) Phase 40 · [#844](https://github.com/TokenDanceLab/AgentHub/pull/844)–[#851](https://github.com/TokenDanceLab/AgentHub/pull/851) Phase 41

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
- **Phase 42 Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone 63 --state open`
- **Labels**: `spec-driven` · `phase:42`

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
| 42 | Security gates + residual polish | #63 | active (#852–#857) |

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
| #852–#857 Phase 42 security gates + residual polish | open (milestone 63) |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=29 and .number<=63) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 63 --state open
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
- [ ] Phase 42 security gates + residual polish (#852–#857)

## Current Status

**Active Phase**: Phase 42 — Security gates + residual polish (milestone 63)
**Active Tasks**: #852 MASTER · #853 JWT audience gate P0 · #854 workDir P0 · #855 artifact sandbox P1 · #856 process_executor residual · #857 hygiene
**Blockers**: None
**Security note**: 16-agent review flagged P0s — Hub JWT audience/purpose gate (#853) and Edge non-empty workDir for adapter runs (#854); also P1 artifact iframe sandbox (#855)
**Production fact**: hk3 LIVE（server `projects/agenthub` external ops SSOT）
**Tip**: 3b4800a4 on `master` (Phase 41 PR #844–#851 line)
**Residual after P41**: process_executor ~1240 · store ~1200 · hubClient ~981 · agent_dispatch ~863 · orchestrator_failure ~1013
**Boundary map next residual**: JWT audience gate / workDir gate / process_executor residual / hygiene
**Governance**: `AGENTS.md` only · Claude native project memory · `.agenthub/memory/project.md` 过时，不得当 SSOT（#428）

## Next Steps

1. Land Phase 42 issues under milestone 63 (issue-bound Workflows)
2. Keep MASTER ≤150 lines; archive detail elsewhere
3. Prefer #853 JWT audience P0 · #854 workDir P0 · #855 artifact sandbox P1 · #856 process_executor
4. Hold unmerged locals (`task/super-governance-baseline`) for separate review

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Phases 1–8 closed; PRs #446/#464 |
| 2026-07-17 | lead | Phase 9–40 closed; Phase 41 advanced |
| 2026-07-18 | lead | Phase 41 closed via #844–#851; Phase 42 security active |

## Completion notes

- Phase 41 closed via #844–#851 (MASTER / hubClient residual / agent_dispatch aliases / store pure / agentteam routing / handlers pure / process_executor; hygiene ops-only). Tip ~3b4800a4.
- Phase 42 targets: MASTER sync, JWT audience gate P0, workDir P0, artifact sandbox P1, process_executor residual, hygiene.
