# AgentHub SUPER 修复 — MASTER.md

> 最后更新：2026-06-19
> 追踪模式：**GITHUB_STANDARD**（Issues + Milestones + Labels）
> 仓库：`TokenDanceLab/AgentHub`

## 任务概述

基于 [SUPER 工程审计](../governance/super-score-2026-06-19.md)（63/100）的全面修复计划。目标：SUPER ≥80，release gate 通过。5 个活跃 Phase + 1 个延后 Phase，共 52 个任务。

## 分析文档

| 文档 | 路径 |
|---|---|
| 项目概览 | [docs/analysis/project-overview.md](../analysis/project-overview.md) |
| 模块清单（S.U.P.E.R 评分） | [docs/analysis/module-inventory.md](../analysis/module-inventory.md) |
| 风险评估 | [docs/analysis/risk-assessment.md](../analysis/risk-assessment.md) |

## 计划文档

| 文档 | 路径 |
|---|---|
| 任务分解 | [docs/plan/task-breakdown.md](../plan/task-breakdown.md) |
| 依赖图 | [docs/plan/dependency-graph.md](../plan/dependency-graph.md) |
| 里程碑 | [docs/plan/milestones.md](../plan/milestones.md) |

## Phase 进度

| Phase | 名称 | 任务数 | 完成 | GitHub Milestone |
|---|---|---|---|---|
| [ ] | Phase 1: 后端安全与基础 | 0/12 | 0% | M1 |
| [ ] | Phase 2: Edge 安全加固 | 0/7 | 0% | M2 |
| [ ] | Phase 3: 架构重构 | 0/5 | 0% | M3 |
| [ ] | Phase 4: 前端与 Mobile 质量 | 0/7 | 0% | M4 |
| [ ] | Phase 5: 文档、平台与打磨 | 0/17 | 0% | M5 |
| [ ] | Phase 6: 延后 | 0/4 | 0% | M6 |

## 当前状态

**活跃 Phase**: Phase 1（后端安全与基础）
**活跃任务**: 待启动
**当前分支**: `master`（目标：从 `dev/delicious233` 创建 feature 分支）

## 快速状态命令

```bash
gh issue list --repo TokenDanceLab/AgentHub --label "spec-driven"
gh issue list --repo TokenDanceLab/AgentHub --milestone "Phase 1"
rg -n "Open.*High" docs/governance/security-risk-register.md
powershell -NoProfile -File scripts/verify-release-gate.ps1 -RepoRoot . -SkipRefCheck
```

## 下一步

1. 创建 GitHub Labels 和 Issues
2. 从 `dev/delicious233` 创建 Phase 1 feature 分支
3. 启动 Phase 1 并行执行：4 lanes × 12 tasks

## 治理状态

| 面 | 路径 | 状态 |
|---|---|---|
| AGENTS.md | `/AGENTS.md` (468行) | ✅ 活跃，本次修复后更新 |
| CLAUDE.md | 不存在 | ❌ 待创建 |
| 项目记忆 | `.agenthub/memory/project.md` (9行) | ❌ 待填充 |
