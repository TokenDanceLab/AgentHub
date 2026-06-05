> 状态: ⏳ 计划中 — 模型路由/fallback 未实现，M3 真实 adapter 接入后启用

# 设计：模型 Fallback 与 Provider 降级

> 生成日期：2026-05-21
> 来源：opencode.md, kanna.md, librechat.md, cross-analysis-adapters.md
> 范围：AgentHub ModelRouter —— 自动模型切换与 Provider 级降级

## 1. 现状：四个系统今天做什么

### 1.1 汇总表

| 系统 | 模型 Fallback 链 | 错误重试 | Provider 降级 | 未知 Provider Fallback |
|------|-----------------|---------|-------------|---------------------|
| **OpenCode** | 无——仅同模型重试 | RouteExecutor：指数退避 + jitter，最多 2 次重试，500ms 基础 / 10s 上限 | 无——12 条路由独立，无降级链 | 无——必须显式注册 provider |
| **Kanna** | 无——仅手动 UX 切换 | 无——委托给 CC/Codex SDK | 两个 Provider（Claude/Codex），手动切换 | N/A——仅两个 provider |
| **LibreChat** | 无——仅 Agent 级模型配置 | 无——委托给 LangChain SDK | 每个 Agent 的摘要 provider 与聊天 provider 分离 | 是——`initializeCustom` 用于任何 OpenAI 兼容端点 |
| **AgentHub（目标）** | **待设计** | **待设计** | **待设计** | **待设计** |

### 1.2 OpenCode：错误感知、模型不感知的重试

OpenCode 的 `RouteExecutor`（`llm/src/route/executor.ts:334-353`）拥有四个系统中最复杂的错误分类：

- **10 变体错误可区分联合类型**：`InvalidRequest | NoRoute | Authentication | RateLimit | QuotaExceeded | ContentPolicy | ProviderInternal | Transport | InvalidProviderOutput | UnknownProvider`
- **`retryable` getter**：只有 `RateLimit` 和 `ProviderInternal`（500/503/504/529）可重试；其他一切立即失败
- **重试机制**：指数退避 + jitter，最多 2 次重试，基础延迟 500ms，上限 10000ms
- **局限性**：重试命中**同一条路由**——不尝试替代模型或替代 provider

### 1.3 Kanna：UX 暴露的 Provider 目录

Kanna 的 `provider-catalog.ts` 建模了**三层解析链**：

```
Provider → Model → Effort
```

每层有默认值，但模型调用失败时**没有自动 fallback**。用户手动切换 provider（`ChatPreferenceControls` 中的 Claude/Codex tabs）。Provider 选择器在**活跃 Turn 期间锁定**以防止流中突变。

### 1.4 LibreChat：带自定义端点门的 Adapter 分发

LibreChat 的 `providerConfigMap` 分发到已知 Adapter（`anthropic → initializeAnthropic`、`google → initializeGoogle` 等）。关键洞察：**未知 provider fallback 到 `initializeCustom`**，通过从 YAML/DB 查找 `getCustomEndpointConfig` 将任何端点视为 OpenAI 兼容。

这是唯一有 **Provider 级降级路径**的系统，但它是编译时分发，而非运行时 fallback——在配置时选择 Adapter，而非调用失败时。

---

## 2. AgentHub ModelRouter 的设计原则

1. **错误分类驱动路由决策**——并非所有错误都相同。速率限制应在不同模型上重试；认证错误决不应重试。
2. **模型 fallback 是链，不是重试**——当模型 A 以不可重试错误失败时，尝试模型 B，而非再次尝试模型 A。
3. **Provider 降级是显式且可配置的**——Provider 级故障转移跨越计费域，因此必须是主动选择的。
4. **Fallback 决策是可观测的**——每次切换必须发出事件，以便用户/UI 知道实际是哪个模型服务了请求。
5. **断路器防止级联浪费**——刚刚返回 429 的模型在 N 秒内不应再次尝试。

---

## 3. ModelRouter 架构

### 3.1 错误分类（继承自 OpenCode）

```
                    ┌─────────────────────────┐
                    │     LLM 调用失败         │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │  按 _tag 分类错误        │
                    └───────────┬─────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
  ┌───────▼───────┐   ┌────────▼────────┐   ┌────────▼────────┐
  │  可重试        │   │  可 Fallback    │   │  终止            │
  │  （同一模型）   │   │  （下一个模型）   │   │  （请求失败）     │
  ├───────────────┤   ├─────────────────┤   ├─────────────────┤
  │ RateLimit     │   │ QuotaExceeded   │   │ Authentication  │
  │ ProviderInternal│  │ NoRoute         │   │ InvalidRequest  │
  │ Transport?    │   │ ContentPolicy    │   │ UnknownProvider │
  │               │   │ InvalidOutput    │   │                 │
  └───────┬───────┘   └────────┬────────┘   └────────┬────────┘
          │                    │                     │
          ▼                    ▼                     ▼
   在同一模型上          推进到链中的            向调用方
   重试 N 次             下一个模型              返回错误
```

**`Transport`**（网络/超时）是有条件可重试的：在同一模型上重试一次，如果持续存在则视为可 fallback。

### 3.2 模型 Fallback 链

```go
// ModelFallbackChain 是一个有序的模型条目列表。
// 路由器按顺序尝试每个条目直到有一个成功。
type ModelFallbackChain struct {
    Name     string             // 例如 "production", "budget"
    Strategy FallbackStrategy   // "sequential" | "parallel_hedge" | "cost_ascending"
    Entries  []ModelChainEntry
}

type ModelChainEntry struct {
    ModelID      string           // 例如 "claude-sonnet-4-6"
    ProviderID   string           // 例如 "anthropic"
    Role         ChainRole        // "primary" | "secondary" | "fallback"
    RetryConfig  *RetryConfig     // 按条目覆盖
}

type ChainRole string
const (
    RolePrimary   ChainRole = "primary"   // 用户首选模型
    RoleSecondary ChainRole = "secondary" // 第一个 fallback
    RoleFallback  ChainRole = "fallback"  // 最后手段
)
```

### 3.3 Provider 降级链

Provider 降级是与模型 fallback**独立的关注点**。Provider 是认证 + 计费域；请求中途切换 provider 有成本影响。

```go
type ProviderDegradationPolicy struct {
    Enabled      bool
    SameProviderOnly bool  // true 时，绝不跨越 provider 边界
    AllowedTransitions []ProviderTransition
}

type ProviderTransition struct {
    From ProviderID
    To   ProviderID
    MaxBudgetUSD float64  // 故障转移支出上限（0 = 无限制）
}
```

**默认策略**：`SameProviderOnly = true`。跨 provider fallback 需要显式管理员配置。这防止了从例如 Anthropic → Google 故障转移产生意外账单。

### 3.4 断路器

```go
type CircuitBreaker struct {
    FailThreshold   int           // 打开断路所需的连续失败次数（默认：3）
    CooldownPeriod  time.Duration // 半开探测前的时间（默认：30s）
    HalfOpenMaxReqs int           // 半开时允许的探测请求数（默认：1）
}

type ModelCircuitState struct {
    ModelID       string
    State         CircuitState  // "closed" | "open" | "half_open"
    FailCount     int
    LastFailTime  time.Time
    LastFailReason string
}
```

断路器是**按 (ModelID, ProviderID)** 的。返回 429 的模型进入 open 状态，并在冷却时间过期前在 fallback 链遍历中被跳过。

### 3.5 路由器执行流

```
请求到达，携带：
  - fallbackChainID："production"（或 nil = 无 fallback）
  - activeCircuitBreakers：map[ModelID]CircuitState
  ──────────────────────────────────────────────────────
  for each entry in chain:
    1. 检查 (entry.ModelID, entry.ProviderID) 的断路器
       - OPEN：跳过，发出 EventFallbackSkipped
       - HALF_OPEN + 配额已用完：跳过
       - CLOSED 或 HALF_OPEN + 探测可用：继续
    2. 执行 LLM 调用
    3. 成功时：
       - 关闭断路器
       - 发出 EventModelRouted(modelID, providerID, role)
       - 返回响应
    4. 可重试错误：
       - 在同一 entry 上重试，最多 RetryConfig.MaxRetries 次
       - 耗尽时：推进到下一个链 entry
    5. 可 fallback 错误：
       - 为此 entry 打开断路器
       - 发出 EventFallbackTriggered(fromModel, toModel, reason)
       - 推进到下一个链 entry
    6. 终止错误：
       - 中止链，返回错误
  ──────────────────────────────────────────────────────
  链耗尽：
    - 返回 ErrAllModelsExhausted{ChainName, triedModels[]}
```

### 3.6 路由器事件

```go
// 在 fallback 触发时发出
type FallbackTriggeredEvent struct {
    FromModel    string
    FromProvider string
    ToModel      string
    ToProvider   string
    Reason       string   // 例如 "QuotaExceeded", "RateLimit", "Transport"
    ChainName    string
    Step         int      // 链中的位置
}

// 在最终模型选定后发出
type ModelRoutedEvent struct {
    ModelID     string
    ProviderID  string
    Role        ChainRole
    ChainStep   int
    TotalTries  int
}

// 在模型被断路器跳过时发出
type FallbackSkippedEvent struct {
    ModelID    string
    Reason     string   // "circuit_open"
    CooldownRemaining time.Duration
}
```

---

## 4. 预配置的 Fallback 链

### 4.1 Anthropic-only（SameProviderOnly，推荐默认）

```
primary:   claude-sonnet-4-6   (anthropic)
secondary: claude-sonnet-4-5   (anthropic)
fallback:  claude-haiku-4-5    (anthropic)
```

所有模型共享同一 API key 和计费。无意外成本。适合 AgentHub 的默认配置。

### 4.2 跨 Provider（显式 opt-in）

```
primary:   claude-sonnet-4-6   (anthropic)
secondary: gpt-5               (openai)
fallback:  gemini-2.5-pro      (google)
```

需要管理员审批 + `ProviderDegradationPolicy.AllowedTransitions` 条目。每个转换可以有 `MaxBudgetUSD` 上限。

### 4.3 OpenRouter 代理链

```
primary:   claude-sonnet-4-6   (openrouter)
secondary: claude-sonnet-4-6   (anthropic-direct)
```

OpenRouter 作为前置代理，如果 OpenRouter 宕机则 fallback 到直接 API。适用于使用 OpenRouter 进行成本聚合但希望有直接路径安全网的团队。

---

## 5. 与 AgentHub Adapter 集成

### 5.1 Adapter 职责

Adapter 层（`cross-analysis-adapters.md` 第 2 节）负责**传输级重试**（例如生成子进程、重连 HTTP）。ModelRouter 层负责**模型级 fallback**（切换到不同的模型 ID）。

| 层 | 负责 | 重试范围 |
|---|------|---------|
| Adapter 传输 | 网络错误、进程崩溃 | 相同模型、相同 provider |
| ModelRouter | 模型不可用、配额、速率限制 | 不同模型、相同或不同 provider |

### 5.2 Adapter 契约变更

`StartRequest`（cross-analysis-adapters.md 第 2.2 节）增加一个 `FallbackChainID` 字段：

```go
type StartRequest struct {
    // ... 现有字段 ...
    FallbackChainID string              // "" = 无 fallback，"production" = 使用命名链
    FallbackChain   *ModelFallbackChain  // 内联覆盖，优先级高于命名链
}
```

Adapter 调用 `ModelRouter.Execute(ctx, req, chain)` 而非直接调用 LLM。路由器处理链遍历，返回成功响应或 `ErrAllModelsExhausted`。

---

## 6. AgentHub 不应做什么

| 反模式 | 原因 |
|--------|------|
| 在认证错误上重试 | 401/403 永远不会自我解决；重试浪费配额并延迟错误传播 |
| 静默 fallback | 每次模型切换必须发出用户/UI 可见的事件 |
| 默认跨 provider | 不同 provider = 不同计费；必须是显式 opt-in |
| 无限重试 | OpenCode 的最大 2 次重试是一个好的上限；AgentHub 应使用 3 次并配合断路器 |
| Fallback 到较弱模型但不提示降级 | 如果链 fallback 到 haiku，UI 应指示能力降低 |

---

## 7. 实施分阶段

| 阶段 | 交付物 | 依赖 |
|------|--------|------|
| P0 | 错误分类（10 变体可区分联合类型 → Go） | opencode.md 第 3.5 节 |
| P0 | ModelFallbackChain 数据模型 + 顺序遍历 | 本文第 3.2 节 |
| P0 | 集成到 ClaudeCodeAdapter.Start() | cross-analysis-adapters.md 第 2.2 节 |
| P1 | 按 (ModelID, ProviderID) 的断路器 | P0 |
| P1 | Fallback 事件（FallbackTriggered, ModelRouted, FallbackSkipped） | P0 |
| P1 | ProviderDegradationPolicy（跨 provider opt-in） | P0 |
| P2 | 并行对冲策略（竞速 primary + secondary，使用第一个成功者） | P1 |
| P2 | 成本升序自动链（按 $/1M tokens 排序） | P1 |
| P2 | 根据 Agent 能力动态构建链（匹配工具支持） | P1 |

---

## 8. 关键设计决策

1. **错误分类与路由分离**：OpenCode 的 10 变体错误模型足够丰富，可以驱动路由决策。AgentHub 应直接采用它，而非发明新的分类法。

2. **链是显式的，不是推导的**：用户/管理员配置 fallback 链。AgentHub 不从模型能力自动推导链。这避免了路由器静默选择一个缺乏工具调用或具有不同上下文窗口的模型带来的意外。

3. **断路器是必需的，不可选**：没有它，一个被限速的模型会堵塞整条链——每个请求都探测它，产生延迟，然后穿透。连续 3 次失败后 30 秒冷却是一个安全的默认值。

4. **默认 SameProviderOnly**：LibreChat 的 `initializeCustom` 模式（未知 → OpenAI 兼容）在配置时分发时很聪明，但运行时跨 provider fallback 跨越了计费边界。AgentHub 必须保守。

5. **事件是一等的**：Kanna 的快照广播模型和 LibreChat 的 MCP 事件流都为每次状态变更发出结构化事件。AgentHub 的 fallback 事件遵循相同原则——UI 必须知道哪个模型服务了请求。

---

*设计完成。2026-05-21.*
