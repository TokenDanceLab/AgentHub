> 状态: ⏳ 计划中 — 并发控制未在 M1-M4 范围，设计预留

# AgentHub 并发与速率限制设计

> 日期：2026-05-21
> 来源：deep-dive-claude-code-tool-security.md, codex-cli.md, librechat.md, flowise.md, design-observability.md
> 目标：AgentHub Runner 执行器 + Hub 调度层

---

## 1. 概述

AgentHub 处于三个并发域的交汇点：**(a)** 单个 Agent Turn 内的工具执行，**(b)** 多 Agent spawn/subtask 扇出，以及 **(c)** 跨租户的 Hub 调度。每个域有不同的安全属性、资源占用和公平性要求。本文比较了在 Claude Code、Codex CLI、LibreChat 和 Flowise 中观察到的并发与速率限制策略，然后推导出 AgentHub 的设计。

---

## 2. 并发模型：跨系统比较

### 2.1 汇总表

| 系统 | 并发原语 | 分区策略 | 上限 | 上下文安全 |
|------|---------|---------|:---:|----------|
| **Claude Code** | TypeScript `all()` 有界异步生成器 | 相邻只读工具合并为一个并发批次；写入工具拆分为串行批次 | 10 | 串行：即时。并发：批次完成后排队修改器 |
| **Codex CLI** | Rust `tokio` async tasks + ThreadManagerState | Agent 树 spawn/wait；每个 Agent 在自己的 Thread 中运行，有 SQ/EQ channel | `agent_max_threads` + `agent_max_depth` | 通过每个 Agent 的 ThreadId 进行 Agent 隔离；Session 跨树共享 |
| **LibreChat** | LangGraph `StateGraph` + 递归 `buildSubagentConfigs` | 递归子 Agent 扇出，通过 `ancestors` Set 进行循环检测 | `MAX_SUBAGENT_DEPTH` + `MAX_SUBAGENT_RUN_CONFIGS` | 每个子 Agent 深度克隆 ToolRegistry；`initialSummary = undefined` |
| **Flowise Seq** | LangGraph `StateGraph` DAG 执行器 | DAG 节点由 LangGraph 内部调度器管理；`recursionLimit` = 100 | 通过拓扑 + `recursionLimit` 隐式限制 | `BaseCheckpointSaver` 跨节点 |
| **Flowise Sup** | 单个 Supervisor + N 个 Worker 扇出 | Supervisor 每 Turn 通过 function-calling 路由一个 Worker | N/A（一次只活跃一个） | Worker 继承 Supervisor 的 LLM |

### 2.2 模型分析

**Claude Code 的分区优先模型（等效于 goroutine/子进程池）：**
核心洞察是**基于邻接关系的批处理**：连续三个只读工具合并为一个并发批次；它们之间的一个写入工具则拆分为三个批次。这是一个领域感知的分区器，不是通用的线程池。每个工具上的 `isConcurrencySafe()` 声明是并发安全的权威来源。保守默认值：解析失败或未知工具 = 串行。

**Codex CLI 的 Agent 树模型（线程池）：**
每个生成的 Agent 是一个独立的异步任务，拥有自己的 `ThreadId`。控制平面（`AgentControl`）强制执行 `agent_max_threads`（最大并发数）和 `agent_max_depth`（最大树深度）。SQ/EQ 模式将父 Turn 循环与子执行解耦。Spawn 限制在创建线程前检查。

**LibreChat 的递归扇出（带深度保护的异步任务）：**
`buildSubagentConfigs()` 递归展开子 Agent 定义，使用 `ancestors` Set 进行循环检测。`MAX_SUBAGENT_DEPTH` 和 `MAX_SUBAGENT_RUN_CONFIGS` 是**配置时**限制，不是运行时并发上限。

**Flowise 的 DAG 模型（基于图的执行）：**
LangGraph 的内部执行器从图拓扑隐式处理并发。`recursionLimit` 防止无限循环，但不是并发上限。

### 2.3 AgentHub 定位

AgentHub 的 Runner 运行**基于子进程**的 Agent CLI（Claude Code、Codex 等）。这与进程内异步任务有根本区别：
- 每个 Agent Turn 是一次**子进程调用**，拥有自己的 OS 级占用（内存、文件描述符、CPU）
- Turn 内的工具执行由 Agent CLI 自身的编排器处理
- AgentHub 的并发关注点是：**每个 Edge 运行多少个子进程，以及如何跨租户调度**

---

## 3. 速率限制策略：跨系统比较

### 3.1 汇总表

| 策略 | 使用者 | 机制 | 反压 | 公平性 |
|------|-------|------|------|--------|
| **信号量**（并发上限） | Claude Code (10), Codex (`agent_max_threads`) | 固定大小的许可池 | 阻塞调用方 | FIFO |
| **深度保护** | LibreChat (`MAX_SUBAGENT_DEPTH`), Codex (`agent_max_depth`) | 配置时验证；超出则拒绝 | 立即拒绝 | N/A |
| **队列深度 + 超时** | Claude Code (120s/600s, 15s auto-bg) | 超时 + 超出预算后转入后台 | 超时终止；后台产出 | 按命令 |
| **递归限制** | Flowise (`recursionLimit = 100`) | 节点计数器；超出则中止 | 立即中止 | 按图 |
| **基于预算的阻塞** | AgentHub (design-observability.md) | 运行前 `spentUSD / limitUSD` 门控 | 硬拒绝 | 按 scope |
| **心跳死线** | AgentHub (design-observability.md) | 60s 无心跳 -> 从调度中移除 | 驱逐过期容量 | Edge 级别 |

### 3.2 策略分析

**令牌桶**和**滑动窗口**在四个系统中均未观察到用于工具执行。这些是 API 级别的速率限制器。AgentHub 仅在**模型 API 网关层**需要令牌桶，不在 Runner 调度层。

**信号量**是通用的：Claude Code 上限为 10，Codex 为 `agent_max_threads`。两者都是简单的许可池，没有速率平滑、优先级队列或动态调整。

**队列深度**是隐式的：Claude Code 的 `all()` 生成器在 10 个工具运行时将第 11 个工具排队。Codex 的 spawn slot 预留同样在达到容量时阻塞。

### 3.3 AgentHub 需要但现有系统不提供的

1. **跨租户公平性**：Hub 面向多个用户/项目运行。一个重度用户不能饿死其他用户。
2. **Edge 容量感知**：调度必须考虑报告的 CPU/内存/磁盘，而不仅仅是并发上限。
3. **优先级抢占**：关键运行（管理员、事故响应）插队。
4. **基于成本的反压**：超出预算 = 阻塞，而不仅仅是警告（在 design-observability.md 中部分覆盖）。

---

## 4. AgentHub Runner 并发策略

### 4.1 设计原则

1. **将工具级并发委托给 Agent CLI。** AgentHub 不应重新实现 Claude Code 的分区器或 Codex 的 Agent 树。Runner 启动子进程；子进程管理其自身的内部并发。
2. **Runner 级并发 = 子进程池。** 固定大小的 slot 池。每个 slot = 一个 Agent Turn 子进程。
3. **Hub 级调度 = 容量感知分发。** Hub 追踪每个 Edge 的可用 slot，路由到负载最低的 Edge。
4. **预算是硬门控。** `BudgetTracker.CheckAndRecord()` 失败 -> 以 `error_max_budget_usd` 拒绝。

### 4.2 子进程池（Runner 侧）

```
Runner: SubprocessPool
  maxSlots: 4（可配置）
  slotTimeout: 600s（硬终止，匹配 Claude Code 的 getMaxTimeoutMs）
  gracefulTimeout: 30s（SIGTERM 在 SIGKILL 之前）
```

```go
type SubprocessPool struct {
    sem             chan struct{}  // 信号量，容量 = maxSlots
    maxSlots        int
    slotTimeout     time.Duration
    gracefulTimeout time.Duration
}
// Acquire() 阻塞直到 slot 空闲；Release() 释放 slot。
// Available() = maxSlots - len(sem) 返回空闲数量。
```

**Slot 分配**：Runner 内 FIFO。没有优先级（优先级是 Hub 的关注点）。满时 `Acquire` 阻塞。Hub 不应向已满的 Runner 分发。

### 4.3 Hub 调度（容量感知分发）

```
Hub 分发:
  1. 预算门控 -> 超出？402 拒绝
  2. Edge 选择：查询在线 Edge -> 过滤（slots > active）-> 排序（active 最少优先）
     -> 无容量？带优先级排队
  3. 分发：POST /api/runs 到选中的 Edge -> Runner.Acquire()
```

```go
type Scheduler struct {
    edges  EdgeRegistry
    budget *BudgetTracker
    queue  *PriorityQueue[RunRequest]
}

type RunRequest struct {
    RunID            string
    Priority         int    // 0=bg, 50=interactive, 100=admin
    BudgetScope      string
    EstimatedCostUSD float64
}
// Dispatch()：预算门控 -> 负载最低的 Edge -> fallback 到队列
```

### 4.4 优先级队列（Hub 侧）

| 级别 | 值 | 用例 |
|:---|:---:|---|
| `PriorityAdmin` | 100 | 管理员覆盖、事故响应 |
| `PriorityInteractive` | 50 | 面向用户的交互式会话 |
| `PriorityBatch` | 10 | 定时/批处理作业 |
| `PriorityBackground` | 0 | 后台分析、预热 |

优先级仅在队列非空时有意义。Edge 容量充足时，所有运行立即分发。

### 4.5 反压流程

```
用户提交 -> Hub 预算（超出 -> 402）
         -> Hub 找 Edge（无容量 -> 202 排队）
         -> Edge 找 Runner（无 slot -> 重新分发）
         -> Runner Acquire（超时 -> 503）
         -> 子进程（slotTimeout -> SIGTERM -> SIGKILL -> failed）
```

---

## 5. 多 Agent 子进程扇出

### 5.1 抽象

AgentHub **不在内部**实现多 Agent 生成：
- Claude Code 子 Agent（task 工具）= CC 内部机制。AgentHub 看到的是一个 TurnResult。
- Codex 子 Agent（spawn 工具）= Codex 内部机制。同上。
- **Hub 级并行执行**（例如两个 Agent 在不同 Edge 上）= Conversation authority 创建两个 RunRequest，并发分发。

### 5.2 扇出限制

| 限制 | 值 | 理由 |
|:---|---:|:---|
| 每个 Conversation 最大并行运行数 | 6 | 匹配 Codex 的 6 个并发 Agent 流 |
| 每个用户最大并行运行数 | 12 | 两个并发 Conversation x 6 |
| 每个 Edge 最大并行运行数 | 可配置（默认 4） | 取决于硬件 |
| 子进程深度（Agent 内部） | N/A | 委托给 Agent CLI |

### 5.3 死锁预防

- **无跨运行依赖**：每个运行独立。AgentHub 不支持"运行 B 等待运行 A"。
- **循环检测**：Hub 层面不需要。子 Agent 循环由 Agent CLI 处理（Codex 的 `ancestors` Set，LibreChat 的循环检查）。
- **超时死线**：每个运行有 600s `slotTimeout`。挂起的子进程被 SIGKILL 终止。

---

## 6. 可观测性集成

### 6.1 池指标

```go
type PoolMetrics struct {
    ActiveSlots    atomic.Int64
    MaxSlots       int
    QueuedRuns     atomic.Int64  // Hub 队列深度
    TotalTimedOut  atomic.Int64
}
```

### 6.2 健康信号

- **Runner 心跳**（10s）：包含 `AvailableSlots`、`ActiveRuns`
- **Edge 心跳**（30s）：聚合所有 Runner 池统计
- **Hub** `/api/metrics`：队列深度、分发延迟、每个 Edge 的 slot 利用率

### 6.3 告警阈值

| 条件 | 级别 | 操作 |
|---|---|---|
| Hub 队列深度 > 10 持续 > 60s | WARN | 考虑增加 Edge 容量 |
| Edge slot 利用率 > 90% 持续 > 5min | WARN | 预扩容 |
| Runner AvailableSlots == 0 持续 > 30s | INFO | 监控超时级联 |
| 子进程 slotTimeout 触发 | ERROR | 调查挂起的 Agent |

---

## 7. 决策摘要

| 决策 | 选择 | 理由 |
|------|------|------|
| 工具级并发 | 委托给 Agent CLI | CC/Codex 已有分区；不重复分层 |
| Runner 模型 | 基于信号量的子进程池 | OS 级隔离；映射 CC 的信号量模式 |
| 池大小 | 每个 Edge 可配置（默认 4） | 取决于硬件；4 对 8GB Edge 是安全的 |
| Hub 调度 | 容量感知的最小负载分发 | 避免 Edge 过载；支持水平扩展 |
| 队列模型 | 优先级队列（4 个级别） | Interactive > Batch > Background；管理员覆盖 |
| 速率限制 | 预算门控 + 容量门控 | 成本/可靠性是 Agent 的约束性限制 |
| 多 Agent 扇出 | Hub 级并行分发 | 简单、可预测；Agent 内部是 CLI 的工作 |
| 子进程超时 | 600s 硬，30s 优雅 | 匹配 CC `getMaxTimeoutMs()` = 600000 |
| 死线开关 | Runner 60s 无心跳 = offline | 防止向已死 Runner 分发 |

---

## 8. 参考资料

- `deep-dive-claude-code-tool-security.md` -- 工具分区模型（第 1 节），超时策略（第 4 节）
- `codex-cli.md` -- 多 Agent spawn 限制（第 2.4 节），SQ/EQ 模型（第 2.3 节）
- `librechat.md` -- 子 Agent 深度/数量限制（第 2.2 节），循环检测（第 2.2 节）
- `flowise.md` -- Sequential Agents DAG 模型（第 2.2 节），recursionLimit（第 2.2 节）
- `design-observability.md` -- 预算追踪（第 4.3 节），心跳（第 3.4-3.5 节），指标（第 2 节）
