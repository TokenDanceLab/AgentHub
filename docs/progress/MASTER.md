# AgentHub Cleanup Baseline — Progress Tracker

> **Task**: knowledge-first strangler cleanup + lightweight wiki（非第二 SSOT）
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-16
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Worktree**: `.worktrees/cleanup-baseline` @ `chore/cleanup-baseline`
> **PR**: https://github.com/TokenDanceLab/AgentHub/pull/446

## Two task surfaces (do not mix)

| Surface | Role | NOT for |
|---|---|---|
| **GitHub Project + Issues** (`cleanup-baseline`) | **程序唯一任务清单 / 进度 SSOT** | 会话临时想法 |
| **Claude TaskList** | 仅本会话微编排 | 程序 backlog、跨会话进度 |

规则：跨会话可交付工作只进 GitHub Issue；Workflow/PR 必须绑定 Issue；看进度用 `gh issue list --label cleanup-baseline`。

## Management model

1. **SPEC in-repo**：`docs/analysis/*` + `docs/plan/*` + 本文件
2. **GitHub Project board**：活状态 / WIP
3. **Milestones = Phases** · **Issues = 原子任务**
4. **PR closes Issue**；Workflow 只执行已建 Issue
5. wiki 是编译知识层，**不覆盖** AGENTS / architecture / api / risk register

## GitHub Resources

- **Project Board**: https://github.com/users/DeliciousBuding/projects/6
- **All Issues**: `gh issue list -R TokenDanceLab/AgentHub --label cleanup-baseline --state all`
- **Label**: `cleanup-baseline` + `spec-driven`

## References

- Analysis: [project-overview](../analysis/project-overview.md) · [module-inventory](../analysis/module-inventory.md) · [risk-assessment](../analysis/risk-assessment.md) · [cleanup-strategy](../analysis/cleanup-strategy.md)
- Plan: [task-breakdown](../plan/task-breakdown.md) · [dependency-graph](../plan/dependency-graph.md) · [milestones](../plan/milestones.md)
- Archive snapshot: `docs/archives/cleanup-baseline/`
- Compiled wiki (non-SSOT): `wiki/`

## Milestones

| Phase | Name | Milestone | Open | Closed | Total |
|:------|:-----|:----------|-----:|-------:|------:|
| 1 | Governance Lock | [#22](https://github.com/TokenDanceLab/AgentHub/milestone/22) | 0 | 3 | 3 |
| 2 | Hygiene Residual | [#23](https://github.com/TokenDanceLab/AgentHub/milestone/23) | 0 | 3 | 3 |
| 3 | Frontend Strangler | [#24](https://github.com/TokenDanceLab/AgentHub/milestone/24) | 0 | 4 | 4 |
| 4 | Edge Seams + Security | [#25](https://github.com/TokenDanceLab/AgentHub/milestone/25) | 0 | 4 | 4 |
| 5 | Closure Decisions | [#26](https://github.com/TokenDanceLab/AgentHub/milestone/26) | 0 | 3 | 3 |
| 6 | Baseline Hardening | [#27](https://github.com/TokenDanceLab/AgentHub/milestone/27) | 0 | 5 | 5 |
| 7 | Baseline CI Green | [#28](https://github.com/TokenDanceLab/AgentHub/milestone/28) | 0 | 11 | 11 |

## Issue Mapping (summary)

| Range | Status |
|:------|:-------|
| #424–#440 Phases 1–5 | closed |
| #441–#445 Phase 6 | closed (`8fd3625f` … `83f5e1ea`) |
| #447–#457 Phase 7 CI/SDD | closed (tip `22832670` + MASTER note) |

Full mapping history: archive `docs/archives/cleanup-baseline/progress/MASTER.md` and GitHub issue list.

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=22 and .number<=28) | "\(.title): \(.open_issues)/\(.closed_issues)"'
gh issue list -R TokenDanceLab/AgentHub --label cleanup-baseline --state open
gh pr checks 446 -R TokenDanceLab/AgentHub
```

## Phase Checklist

- [x] Phase 0–5 baseline program (#424–#440)
- [x] Phase 6 Baseline Hardening (#441–#445)
- [x] Phase 7 CI Green + SDD closeout (#447–#457); PR #446 required checks green

## Current Status

**Active Phase**: COMPLETE — PR #446 merge-ready
**Active Task**: none
**Blockers**: None
**Production fact**: hk3 LIVE（server `projects/agenthub` external ops SSOT）
**Tip**: `22832670` Phase 7 CI gate; MASTER update may follow for ≤150-line SSOT

## Governance Status

**Shared instruction surface**: `AGENTS.md`
**Claude Code instruction surface**: none（本仓仅 AGENTS）
**Memory surface**: Claude native project memory
**Memory note**: `.agenthub/memory/project.md` 过时，不得当 SSOT（#428）

## Next Steps

1. Review/merge PR #446 (`chore/cleanup-baseline` → `master`)
2. 新工作必须新 Issue / 新 SPEC；禁止 freestyle fleets
3. 可选非阻塞：live Hub→Edge capability E2E；journal offline/replay E2E

## Session Log

| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | GITHUB_FULL Project #6 + Phases 1–6 + residual closeout |
| 2026-07-16 | lead | Phase 7 CI green #447–#457; PR #446 required checks pass |

## Baseline completion

- cleanup-baseline + hardening + residual + Phase 7 CI green closed 2026-07-16.
- Landed: hubClient SSOT cutover; Edge handlers/journal; capability purpose/action/target/thread; orphan UI delete; archives.
- PR #446 required checks green; mobile/E2E/benchmark remain workflow_dispatch skips.
- Next work: new SPEC/Issues only.
