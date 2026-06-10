# 06 — Orchestrator 增强

> 2026-06-10 · 基于 4 竞品深度审计 + 比赛要求解读
> 比赛第 2 条核心功能：「主 Agent 协调器，自动理解意图→拆解→分派→聚合，支持并行调度、失败降级、代码冲突处理」

---

## 现状 vs 比赛要求

| 比赛要求 | 我们 | 状态 |
|---|---|---|
| 自动理解意图 → 拆解 | 从 Claude Code NDJSON 输出中扫描 `dispatch` JSON 指令，无结构化规划 | ⚠️ 可用，但不够 |
| 分派 | 并行 fan-out（10 并发 goroutine），`dispatchInterceptor.handleDispatch()` 注册 → spawn → emit | ✅ |
| 聚合 | `runResultListener` → `processResultMessage` → `handleSubAgentResult` 注入结果文本到 orchestrator 流 → `emitProgressSummary` | ✅ |
| **失败降级** | **无** | ❌ |
| **代码冲突处理** | **无** | ❌ |
| Plan 确认门 | **无** | ❌ |
| 并行调度 | ✅ concurrent dispatch goroutine pool | ✅ |

## 竞品做了什么

### 失败降级（比赛明确要求）

| 竞品 | 方案 | 代码 |
|---|---|---|
| **doloveplayer** | 三级：auto-retry (MAX=3) → ManagerLoop LLM 决策 (continue\|replan\|abort) → 人工上报 | `taskDispatcher.ts:212,975-1179`, `ManagerLoop.ts` |
| **Queena** | 失败分类：transient(重试) / capability(换 agent) / cancel(跳过) → 对应恢复策略 | `dispatch.helpers.ts:138-151`, `reliability.ts:38-64` |
| **SeiyunSky** | 三路：max_tokens→注入"继续"重试3次 / prompt_too_long→压缩后重试 / api_error→指数退避(1-30s)重试5次 | `error_recovery.py:1-224` |

### 代码冲突处理（比赛明确要求）

| 竞品 | 方案 | 代码 |
|---|---|---|
| **Queena** | 同级上下文感知：每个 worker 被告知其他 worker 在做什么 + 并发写入边界警告 | `sibling-context.ts:25-45` |
| **doloveplayer** | 文件冲突检测 → 顺序依赖链重置 → 强制串行化 | `planHandlers.ts:180-232`, `conflictEscalation.ts` |

### Plan 拆分（比赛暗示）

| 竞品 | 方案 | 代码 |
|---|---|---|
| **Queena** | Zod Schema → `generateObject` 结构化输出，SPLIT/COMPETE/PIPELINE 三模式 | `plan.schema.ts`, `supervisor.service.ts:204-260` |
| **doloveplayer** | `planGen.mjs` 沙箱工具：flat/phased/pipeline 三模式 + Zod 验证 + 跨任务引用检查 | `docker/planGen.mjs` |
| **SeiyunSky** | `create_task_plan` 工具 + `blocked_by` DAG 依赖 | `orchestrator_tools.py` |
| **Toufumind** | YAML DAG 引擎，`dependsOn` + `routes` + `timeout` + `retryBackoff` 声明式 | `workflow-engine.ts:1560 行` |

### Plan 确认（比赛暗示）

| 竞品 | 方案 | 代码 |
|---|---|---|
| **Queena** | `pendingPlans` Map + `resumePlan()`，对话级 `requirePlanApproval` 开关 | `supervisor.service.ts:153-155, 376-380, 480-515` |
| **Toufumind** | `action: human_approval` 暂停 DAG → WebSocket 广播 → `submitApproval()` | `workflow-engine.ts:1012-1036, 1209-1254` |

### 上下文压缩（不是比赛要求，但所有竞品都有）

| 竞品 | 方案 | 代码 |
|---|---|---|
| **SeiyunSky** | 三层：micro_compact(工具输出折叠) → global_summarize(LLM总结2000字) → 渐进式触发 | `context_compactor.py:84-352` |
| **doloveplayer** | ContextBus：KV 黑板 + 优先级衰减 + 70% 阈值自动压缩 | `ContextBus.ts` |

---

## 我们应该怎么做

### 核心原则

不动 UI（这些全是管线/后端层改动），不动 orchestrator 基本架构（dispatchInterceptor 模式是对的）。

### P0 — 比赛硬要求（今天必须补）

| # | 功能 | 参考竞品 | 实现方式 | 预计 |
|---|---|---|---|---|
| 1 | **失败降级** — transient(自动重试3次+指数退避) / capability(切换 agent) / cancel(跳过回滚) 三级分类 | doloveplayer + Queena | 在 `dispatchInterceptor.handleDispatch()` 的 error path 加分类逻辑，在 sub-agent 失败回调 `handleSubAgentResult(msg, isError=true)` 加重试/切换/跳过路径 | 90 分钟 |
| 2 | **同级上下文** — sub-agent spawn 时注入同级 agent 列表 + 并发写入边界警告 | Queena | 在 `SubAgentTask` 结构体加 `SiblingAgents` 字段，spawn 时收集同批次 agent 信息 → 注入 prompt | 30 分钟 |
| 3 | **Plan 确认门** — orchestrator 输出 dispatch JSON 后暂停，等待用户 approve 再执行 | Queena | 在 `dispatchInterceptor.scanForDispatch()` 检测到 dispatch 后暂停 → emit `plan.proposed` WS 事件 → Hub 端等 `plan:approve` 再 `fanOutDispatches()` | 60 分钟 |

### P1 — 增强型（短期，提升产品体验）

| # | 功能 | 参考 | 实现方式 | 预计 |
|---|---|---|---|---|
| 4 | **结构化 Plan 拆分** — orchestrator 输出结构化的 `Plan { tasks: [{agent, description, dependsOn}] }` 而非自由文本 JSON | Queena Zod + SeiyunSky create_task_plan | 增强 `DefaultOrchestratorPrompt()` 的 prompt 模板，定义清晰的 dispatch schema（agent/task/dependsOn/mode） | 45 分钟 |
| 5 | **DAG 依赖** — task 间 `dependsOn` → 拓扑排序调度 | doloveplayer Kahn | `dispatchInterceptor` 新增 DAG 预扫描：收集所有 dispatch → 构建邻接表 → 拓扑顺序执行（已完成的先决任务的结果传给后续） | 120 分钟 |
| 6 | **Pipeline 模式** — 链式分发，上游输出注入下游 prompt | Queena SPLIT/PIPELINE | 在 DAG 引擎基础上实现：dependsOn 边上的 result 传递 | 60 分钟 |
| 7 | **上下文压缩** — tool 输出截断 + 历史折叠 | SeiyunSky context_compactor | `context_budget.go` 已有的基础上加 tool output folding（超过 16KB 截断 + 摘要） | 45 分钟 |

### P2 — 长期（下个版本）

| # | 功能 | 参考 |
|---|---|---|
| 8 | 执行后审查（post-plan summary → agent memory） | doloveplayer ArchiveManager + ExperienceExtractor |
| 9 | 过期任务检测（10 分钟无心跳 → 标记失败） | doloveplayer staleTaskChecker |
| 10 | YAML 工作流定义 | Toufumind workflow YAML + checkpoint/recovery |

---

## 与现有 Roadmap 的交叉引用

| 本文功能 | 对应 roadmap |
|---|---|
| #1 失败降级 | [01-pipeline.md](01-pipeline.md) #5（上下文压缩）+ 新增 |
| #2 同级上下文 | 新增（竞品驱动） |
| #3 Plan 确认门 | 新增（比赛要求） |
| #4 结构化 Plan | [02-light-ui.md](02-light-ui.md) #5（StepCard 渲染）——Plan 拆分是管线，UI 渲染是 02 |
| #5 DAG 依赖 | [03-right-panel.md](03-right-panel.md) #13（DagTree）——DAG 计算是管线，树渲染是 03 |
| #7 上下文压缩 | [01-pipeline.md](01-pipeline.md) #5 — 合并 |

---

## 一句话

> **Orchestrator 骨架（dispatch scan + fan-out + result listener）是对的。比赛缺的只有三件事：失败降级、同级上下文、Plan 确认门。全部是管线改动，不需要任何新 UI。90 + 30 + 60 = 3 小时。**
