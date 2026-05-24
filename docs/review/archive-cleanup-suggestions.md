# Archive 清理建议 — 2026-05-23

> 基于 `doc-audit-2026-05-23.md` 的审计结果，对 `docs/archive/` 中 25 份文件逐份评估。

## 建议删除（7 份）

| 文件 | 原因 |
|---|---|
| `deepseek-handoff.md` | 一次性任务交接单，任务已完成，无持续参考价值 |
| `chinese-documentation-roadmap.md` | 翻译路线图，引用 deepseek-handoff，同属已完成的一次性任务说明 |
| `protocol-rest-websocket-migration-plan.md` | 迁移已完结，当前协议见 `protocol.md` 和 `system-architecture.md`，本文件是执行步骤而非参考文档 |
| `grill/agenthub-api-interface-planning.md` | 早期 Grill 规划笔记，已被 `api/openapi.yaml` + `api/events.md` + `api/conventions.md` 取代 |
| `grill/agenthub-architecture.md` | 早期架构 Grill（3 人 20 天计划），已被 `system-architecture.md` + `architecture.md` 完整覆盖 |
| `grill/agenthub-round2-audit.md` | 第二轮审计 Grill，一次性评审记录，结论已融入当前架构 |
| `grill/branch-management.md` | 分支策略讨论，已被 `implementation-guide.md` 和 `AGENTS.md` 中的实际规范取代 |

## 保留（18 份）

每份被保留的文件都有明确理由：

| 文件 | 保留原因 |
|---|---|
| `agent-loop.md` | P0 本地 loop 设计，M1-M3 执行链路的基础参考 |
| `approvals.md` | 审批系统设计，审批请求已在 M1 落地，完整方案待后续 |
| `architecture-optimization.md` | 架构优化决策记录，包含 P0 表设计和优化方向 |
| `architecture.md` | Hub-Edge-Runner 完整架构蓝图，是 `system-architecture.md` 的深度补充 |
| `authority.md` | 四层权威模型，当前代码的权限边界依据 |
| `codex-app-reference.md` | Codex App 概念映射，adapter 设计时的重要参考 |
| `data-model.md` | Project->Conversation->Thread->Turn->Item->Artifact 层级，当前数据模型基石 |
| `data-plane.md` | 数据面规则（preview 路由、产物位置），M4 实现依据 |
| `glossary.md` | 术语表，新人 onboarding 和 Agent 理解项目的词典 |
| `implementation-plan.md` | P0-P4 阶段规划，当前 M1 收口和后续里程碑的参照 |
| `language-policy.md` | 现行文档/提交/代码语言规则 |
| `memory.md` | Memory/Context 设计，.agenthub/ 布局规范 |
| `module-boundaries.md` | 五个模块的职责边界，防止越界实现 |
| `product-model.md` | 产品定位：Desktop CC + IM + Hub Network |
| `project-management.md` | GitHub milestones、labels、分支策略的实际操作规范 |
| `protocol.md` | 当前协议参考（REST JSON + WebSocket），与 `api/` 目录互补 |
| `topology.md` | 8 种场景的完整网络拓扑和路由解析 |
| `workspace.md` | worktree 隔离和运行时布局，M4 实现基础 |

## 清理影响评估

- **风险**: 极低。7 份建议删除的文件均为过程性文档或已完成任务的说明，不影响任何当前实现或未来设计决策。
- **Grill 子目录**: 全部 4 份 Grill 文件均可删除，`docs/archive/grill/` 目录将变空。确认后可一并移除该目录。
- **后续行动**: 删除后 `docs/archive/` 将保留 18 份有明确参考价值的文档，结构更清晰。
