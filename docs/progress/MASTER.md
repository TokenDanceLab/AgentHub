# AgentHub Cleanup Baseline — Progress Tracker

> **Task**: knowledge-first strangler cleanup + lightweight wiki（非第二 SSOT）  
> **Started**: 2026-07-16  
> **Last Updated**: 2026-07-16  
> **Mode**: `GITHUB_FULL`  
> **Repo**: `TokenDanceLab/AgentHub`  
> **Worktree**: `.worktrees/cleanup-baseline` @ `chore/cleanup-baseline`

## Management model (locked)

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
| 1 | Governance Lock | [#22](https://github.com/TokenDanceLab/AgentHub/milestone/22) | 3 | 0 | 3 |
| 2 | Hygiene Residual | [#23](https://github.com/TokenDanceLab/AgentHub/milestone/23) | 3 | 0 | 3 |
| 3 | Frontend Strangler | [#24](https://github.com/TokenDanceLab/AgentHub/milestone/24) | 4 | 0 | 4 |
| 4 | Edge Seams + Security | [#25](https://github.com/TokenDanceLab/AgentHub/milestone/25) | 4 | 0 | 4 |
| 5 | Closure Decisions | [#26](https://github.com/TokenDanceLab/AgentHub/milestone/26) | 3 | 0 | 3 |

## Issue Mapping

| Task ID | Issue | Title | Status |
|:--------|:------|:------|:-------|
| T1.1 | #424 | 建立 GitHub Project + Issues 并把 MASTER 改为 GITHUB_FULL | open → completing |
| T1.2 | #425 | 冻结 ad-hoc fleets：实现只允许 issue-bound PR | open → completing |
| T1.3 | #426 | 统一镜像名/CD 叙事决策 | open |
| T2.1 | #427 | 主工作区 dirty 政策 | open |
| T2.2 | #428 | 中和 .agenthub/memory 假进度指针 | open |
| T2.3 | #429 | 降级旧 prod 模板为非权威 | open |
| T3.1 | #430 | hubClient 类型/矩阵 slice1 | open |
| T3.2 | #431 | shared hubClient 方法补齐 + contract tests | open |
| T3.3 | #432 | Desktop thin re-export cutover | open |
| T3.4 | #433 | Web cutover + AH-SR-043 fail-closed | open |
| T4.1 | #434 | Edge handlers 机械拆分 | open |
| T4.2 | #435 | ProcessExecutor 接口抽取 | open |
| T4.3 | #436 | AH-SR-046 capability 闭环 | open |
| T4.4 | #437 | AH-SR-049 outbox retry / journal | open |
| T5.1 | #438 | AH-SR-037 决策 | open |
| T5.2 | #439 | Settings/TeamRun orphan 决策 | open |
| T5.3 | #440 | 专项收口与归档计划 | open |

## Quick Status Commands

```bash
gh api repos/TokenDanceLab/AgentHub/milestones --jq '.[] | select(.number>=22 and .number<=26) | "\(.title): \(.open_issues) open / \(.closed_issues) closed"'
gh issue list -R TokenDanceLab/AgentHub --label cleanup-baseline --state open
gh project item-list 6 --owner @me --format json --limit 50
```

## Phase Checklist
- [x] Phase 0: Analysis baseline（`347642b6` 等）
- [ ] Phase 1: Governance Lock (T1.1/T1.2 completing)
- [ ] Phase 2: Hygiene Residual (0/3)
- [ ] Phase 3: Frontend Strangler (0/4)
- [ ] Phase 4: Edge Seams + Security (0/4)
- [ ] Phase 5: Closure Decisions (0/3)

## Current Status
**Active Phase**: Phase 1 Governance Lock  
**Active Task**: T1.1 #424 / T1.2 #425  
**Blockers**: None  
**Production fact**: hk3 LIVE（server `projects/agenthub/STATE.md`）  
**Baseline commits**:
- `347642b6` docs(cleanup): baseline analysis, wiki, LIVE narrative
- `843c64d4` docs(progress): phase ticks (pre-GITHUB_FULL)

## Governance Status
**Shared instruction surface**: `AGENTS.md`  
**Claude Code instruction surface**: none（本仓仅 AGENTS）  
**Memory surface**: Claude native project memory  
**Memory note**: `.agenthub/memory/project.md` 过时，不得当 SSOT（#428）

## Next Steps
1. Close #424 / #425 after this MASTER commit lands  
2. 仅 issue-bound 执行：下一步推荐 **#430 (T3.1)** 与 **#427 (T2.1)** 分 PR  
3. 禁止 freestyle multi-workflow 实现 fleets  
4. 安全切片 #436/#437 必须 issue-bound + 测试

## Session Log
| Date | Session | Summary |
|:-----|:--------|:--------|
| 2026-07-16 | lead | Analysis/wiki/hygiene baseline; stopped ad-hoc fleets; Project #6 + milestones 22–26 + issues #424–#440; MASTER → GITHUB_FULL |
