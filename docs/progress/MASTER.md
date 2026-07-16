# AgentHub Cleanup Baseline — Progress Tracker

> **Task**: knowledge-first strangler cleanup + lightweight wiki（非第二 SSOT）
> **Started**: 2026-07-16
> **Last Updated**: 2026-07-16
> **Mode**: `GITHUB_FULL`
> **Repo**: `TokenDanceLab/AgentHub`
> **Worktree**: `.worktrees/cleanup-baseline` @ `chore/cleanup-baseline`

## Management model (locked)

## Two task surfaces (do not mix)

| Surface | Role | NOT for |
|---|---|---|
| **GitHub Project + Issues** (`cleanup-baseline`) | **程序唯一任务清单 / 进度 SSOT** | 会话临时想法 |
| **Claude TaskList** | 仅本会话微编排（读文件、等 workflow、commit 步骤） | 程序 backlog、跨会话进度 |

规则：
1. 跨会话、可交付、可验收的工作 **只** 进 GitHub Issue。
2. Workflow / subagent / 实现 PR **必须** 绑定 Issue number。
3. Claude TaskList 可以丢弃、重建，不影响程序进度。
4. 看进度：`gh issue list -R TokenDanceLab/AgentHub --label cleanup-baseline` 或 Project board。



现代软件工程 + SDD 收口，**不再用 ad-hoc multi-workflow 当 backlog**：

1. **SPEC in-repo**：`docs/analysis/*` + `docs/plan/*` + 本文件
2. **GitHub Project board**：活状态 / WIP
3. **Milestones = Phases**
4. **Issues = 原子任务**（验收标准在 Issue body）
5. **PR closes Issue**；Workflow/subagent **只能执行已建 Issue**
6. wiki 是编译知识层，**不覆盖** AGENTS / architecture / api / risk register

参考：
- [GitHub Spec-Driven Development toolkit](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)
- [GitHub Projects best practices](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/best-practices-for-projects)
- [Strangler Fig](https://martinfowler.com/bliki/StranglerFigApplication.html)

## GitHub Resources

- **Project Board**: https://github.com/users/DeliciousBuding/projects/6
  （用户级 Project；Issues 在 `TokenDanceLab/AgentHub`。跨 owner `project link` 有限制，但不阻塞 item 跟踪）
- **All Issues**: `gh issue list -R TokenDanceLab/AgentHub --label cleanup-baseline --state all`
- **Label**: `cleanup-baseline` + `spec-driven`

## References

- [Dirty Tree Policy](../analysis/dirty-tree-policy.md) (#427)
- [hubClient SSOT Slice1](../analysis/hubclient-ssot-slice1.md) (#430)

- [Project Overview](../analysis/project-overview.md)
- [Module Inventory](../analysis/module-inventory.md)
- [Risk Assessment](../analysis/risk-assessment.md)
- [Cleanup Strategy](../analysis/cleanup-strategy.md)
- [Frontend Dedupe Plan](../analysis/frontend-dedupe-plan.md)
- [Task Breakdown](../plan/task-breakdown.md)
- [Dependency Graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)
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

## Issue Mapping

| Task ID | Issue | Title | Status |
|:--------|:------|:------|:-------|
| T1.1 | #424 | 建立 GitHub Project + Issues 并把 MASTER 改为 GITHUB_FULL | closed |
| T1.2 | #425 | 冻结 ad-hoc fleets：实现只允许 issue-bound PR | closed |
| T1.3 | #426 | 统一镜像名/CD 叙事决策 | closed |
| T2.1 | #427 | 主工作区 dirty 政策 | closed |
| T2.2 | #428 | 中和 .agenthub/memory 假进度指针 | closed |
| T2.3 | #429 | 降级旧 prod 模板为非权威 | closed |
| T3.1 | #430 | hubClient 类型/矩阵 slice1 | closed |
| T3.2 | #431 | shared hubClient 方法补齐 + contract tests | closed |
| T3.3 | #432 | Desktop thin re-export cutover | closed |
| T3.4 | #433 | Web cutover + AH-SR-043 fail-closed | closed |
| T4.1 | #434 | Edge handlers 机械拆分 | closed |
| T4.2 | #435 | ProcessExecutor 接口抽取 | closed |
| T4.3 | #436 | AH-SR-046 capability 闭环 | closed (issuer landed) |
| T4.4 | #437 | AH-SR-049 outbox retry / journal | closed (journal minimal; durable residual) |
| T5.1 | #438 | AH-SR-037 决策 | closed accepted |
| T5.2 | #439 | Settings/TeamRun orphan 决策 | closed |
| T5.3 | #440 | 专项收口与归档计划 | closed |
| T6.1 | #441 | desktop hubClient cutover tsc | closed (`83f5e1ea`) |
| T6.2 | #442 | web hubClient 类型/测试对齐 | closed (`83f5e1ea`) |
| T6.3 | #443 | 抽取 SectionId | closed (`8fd3625f`) |
| T6.4 | #444 | purpose=run-start 强制 | closed (`e41ed1ed`) |
| T6.5 | #445 | SQLite durable DeliveryJournal | closed (`342cc711`) |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=22 and .number<=27) | "\(.title): \(.open_issues) open / \(.closed_issues) closed"'
gh issue list -R TokenDanceLab/AgentHub --label cleanup-baseline --state open
gh project item-list 6 --owner @me --format json --limit 50
```

## Phase Checklist
- [x] Phase 0: Analysis baseline（`347642b6` 等）
- [x] Phase 1: Governance Lock (3/3 closed: #424-#426)
- [x] Phase 2: Hygiene Residual (3/3 closed: #427-#429)
- [x] Phase 3: Frontend Strangler (4/4 closed: #430-#433)
- [x] Phase 4: Edge Seams + Security (4/4 closed: #434-#437)
- [x] Phase 5: Closure Decisions (3/3 closed: #438-#440)
- [x] Phase 6: Baseline Hardening (5/5 closed: #441-#445)

## Current Status
**Active Phase**: COMPLETE (baseline + hardening + residual closeout)
**Active Task**: none
**Blockers**: None
**Production fact**: hk3 LIVE（server `projects/agenthub/STATE.md`）
**Baseline commits**:
- `347642b6` docs(cleanup): baseline analysis, wiki, LIVE narrative
- Phase 6: `8fd3625f` #443 · `e41ed1ed` #444 · `342cc711` #445 · `83f5e1ea` #441/#442

## Governance Status
**Shared instruction surface**: `AGENTS.md`
**Claude Code instruction surface**: none（本仓仅 AGENTS）
**Memory surface**: Claude native project memory
**Memory note**: `.agenthub/memory/project.md` 过时，不得当 SSOT（#428）

## Next Steps
1. push `chore/cleanup-baseline` 并开 PR 汇总 #424–#445 + residual closeout commits
2. 禁止 freestyle multi-workflow 实现 fleets；新工作必须新 Issue
3. 可选增强（非基线阻塞）：live Hub→Edge capability E2E；cross-service journal offline/replay E2E

## Session Log
| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Analysis/wiki/hygiene baseline; stopped ad-hoc fleets; Project #6 + milestones 22–26 + issues #424–#440; MASTER → GITHUB_FULL |
| 2026-07-16 | lead | Phase 6 #441–#445 closed: SectionId extract, purpose=run-start, SQLite journal, desktop/web tsc clean |
| 2026-07-16 | lead | residual closeout: orphan UI physical delete; AH-SR-046 bindings; AH-SR-049 reconciliation API |


## Baseline completion

- Program cleanup-baseline + Phase 6 hardening + residual closeout closed on 2026-07-16.
- Orphan Settings/TeamRun UI physically deleted; AH-SR-046 action/target/thread bindings landed; AH-SR-049 durable journal + reconciliation read path landed.
- Optional future enhancements (not baseline blockers): live Hub→Edge E2E evidence; automatic redelivery worker.
- Next work must open a **new** SPEC/Issues; do not freestyle on this branch without issues.
