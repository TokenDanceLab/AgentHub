# AgentHub Progress Tracker

> **Task**: post-baseline security closeout + product polish
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-17
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Integration branch**: `chore/phase9-product-polish` (tracks `master`)
> **Hygiene branch**: `chore/469-repo-hygiene` → #469
> **Merged PRs**: [#446](https://github.com/TokenDanceLab/AgentHub/pull/446) cleanup-baseline · [#464](https://github.com/TokenDanceLab/AgentHub/pull/464) Phase 8 security

## Two task surfaces (do not mix)

| Surface | Role | NOT for |
|---|---|---|
| **GitHub Project + Issues** | **程序唯一任务清单 / 进度 SSOT** | 会话临时想法 |
| **Claude TaskList** | 仅本会话微编排 | 程序 backlog、跨会话进度 |

规则：跨会话可交付工作只进 GitHub Issue；Workflow/PR 必须绑定 Issue；看进度用 `gh issue list --label cleanup-baseline --state all` 或 milestone filters。

## Management model

1. **SPEC in-repo**：`docs/analysis/*` + `docs/plan/*` + 本文件
2. **GitHub Project board**：活状态 / WIP
3. **Milestones = Phases** · **Issues = 原子任务**
4. **PR closes Issue**；Workflow 只执行已建 Issue
5. wiki 是编译知识层，**不覆盖** AGENTS / architecture / api / risk register

## GitHub Resources

- **Project Board**: https://github.com/users/DeliciousBuding/projects/6
- **Phase 9 Issues**: `gh issue list -R TokenDanceLab/AgentHub --milestone "Phase 9: Product polish — architecture, UI/UX, design system, hygiene"`
- **Label**: `cleanup-baseline` + `spec-driven` (historical) · Phase 9 issues under milestone 30

## References

- Analysis: [project-overview](../analysis/project-overview.md) · [module-inventory](../analysis/module-inventory.md) · [risk-assessment](../analysis/risk-assessment.md) · [cleanup-strategy](../analysis/cleanup-strategy.md)
- Plan: [task-breakdown](../plan/task-breakdown.md) · [dependency-graph](../plan/dependency-graph.md) · [milestones](../plan/milestones.md)
- Archive snapshot: `docs/archives/cleanup-baseline/`
- Compiled wiki (non-SSOT): `wiki/`

## Milestones

| Phase | Name | Milestone | Open | Closed | Total |
|:------|:-----|:----------|-----:|-------:|------:|
| 1–7 | Cleanup baseline | [#22](https://github.com/TokenDanceLab/AgentHub/milestone/22)–[#28](https://github.com/TokenDanceLab/AgentHub/milestone/28) | 0 | 33 | 33 |
| 8 | Post-baseline security & hygiene | [#29](https://github.com/TokenDanceLab/AgentHub/milestone/29) | 0 | 5 | 5 |
| 9 | Product polish | [#30](https://github.com/TokenDanceLab/AgentHub/milestone/30) | 7 | 0 | 7 |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #424–#440 Phases 1–5 | closed |
| #441–#445 Phase 6 | closed |
| #447–#457 Phase 7 CI/SDD | closed (PR #446 MERGED) |
| #458–#462 / #464 Phase 8 security residuals | closed (PR #464 MERGED @ `11c799b8`) |
| #460 → #465 AH-SR-044 residual | open under Phase 9 |
| #465–#470 Phase 9 polish | open (milestone 30) |

Full mapping history: archive `docs/archives/cleanup-baseline/progress/MASTER.md` and GitHub issue list.

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=29 and .number<=30) | "\(.title): \(.open_issues)/\(.closed_issues) \(.state)"'
gh issue list -R TokenDanceLab/AgentHub --milestone 30 --state open
git worktree list
```

## Phase Checklist

- [x] Phase 0–5 baseline program (#424–#440)
- [x] Phase 6 Baseline Hardening (#441–#445)
- [x] Phase 7 CI Green + SDD closeout (#447–#457); PR #446 MERGED
- [x] Phase 8 security residuals (#458–#462); PR #464 MERGED
- [ ] Phase 9 product polish (#465–#470)

## Current Status

**Active Phase**: Phase 9 — Product polish (milestone 30)
**Active Tasks**: #465–#470 (hygiene #469 in flight)
**Blockers**: None
**Production fact**: hk3 LIVE（server `projects/agenthub` external ops SSOT）
**Tip**: `11c799b8` Phase 8 merge on `master`

## Governance Status

**Shared instruction surface**: `AGENTS.md`
**Claude Code instruction surface**: none（本仓仅 AGENTS）
**Memory surface**: Claude native project memory
**Memory note**: `.agenthub/memory/project.md` 过时，不得当 SSOT（#428）

## Next Steps

1. Execute Phase 9 issues #465–#470 under milestone 30
2. Keep MASTER ≤150 lines; archive detail, do not dump here
3. New work must use new Issue / SPEC; no freestyle fleets
4. Hold unmerged locals (`task/super-governance-baseline`, orphan task/ci tips) for separate review

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | GITHUB_FULL Project #6 + Phases 1–7; PR #446 MERGED |
| 2026-07-16 | lead | Phase 8 security PR #464 MERGED (AH-SR-043/045/046/049) |
| 2026-07-17 | hygiene | #469 prune phase8 worktree + merged locals; MASTER Phase 8→9 |

## Baseline + Phase 8 completion

- cleanup-baseline + hardening + Phase 7 CI green closed 2026-07-16 (PR #446).
- Phase 8 post-baseline security residuals closed 2026-07-16 (PR #464 @ `11c799b8`).
- Landed: hubClient SSOT; Edge handlers/journal; capability purpose/action/target/thread; AH-SR-043/045/046/049.
- Phase 9 active: architecture, design system, UI/UX, repo hygiene (#465–#470).
