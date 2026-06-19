# ADR-015: 消除循环引用 —— Setter 注入替换

## Status

Accepted

## Context

SUPER 审计发现 Hub Server 的核心服务之间存在 **循环依赖** 链：

```
AgentTeamService ──依赖──→ AgentService
       ↑                        │
       │                        ↓
       └────依赖──── RelayService ←┘
```

具体问题表现：

1. **`AgentTeamService` 依赖 `AgentService`**：启动 TeamRun 时需要 AgentService 创建和管理独立 Agent 运行。
2. **`AgentService` 依赖 `RelayService`**：Agent 运行时需要通过 RelayService 与 Edge Server 通信。
3. **`RelayService` 依赖 `AgentTeamService`**：Relay 回调时需要 AgentTeamService 更新 TeamRun 状态（如某个 Agent 运行结束后的聚合判断）。

当前实现通过 **`Set*` setter 注入**（`SetAgentService`、`SetRelayService`）打破编译期循环，但带来了以下运行时问题：

- **初始化顺序脆弱**：如果某个 `Set*` 未被调用，运行时 nil pointer panic 而非编译期错误。
- **状态不一致窗口**：在 Setter 调用完成前，服务处于部分初始化状态，任何并发请求可能访问到 nil 依赖。
- **隐式依赖图**：依赖关系隐藏在 Setter 调用序列中，无法从构造函数签名推断完整依赖。
- **S.U.P.E.R E 评分受损**：setter 注入是运行时错误的温床，违反"失败应在编译期捕获"的原则。

## Decision

采用 **窄接口 + EventBus 中介** 消除循环：

### 1. 窄接口替换 Setter 注入

为每个循环依赖点定义最小接口（1-2 个方法），只暴露被依赖方真正需要的操作：

```go
// agent_team.go — 定义 RelayService 所需的窄接口
type TeamRunStatusUpdater interface {
    UpdateAgentRunStatus(ctx context.Context, teamRunID string, agentID string, status RunStatus) error
}

// relay.go — RelayService 依赖窄接口而非完整 AgentTeamService
type RelayService struct {
    teamRunUpdater TeamRunStatusUpdater  // 替代 *AgentTeamService
    // ...
}
```

- `AgentService` 通过 `AgentRunNotifier` 窄接口通知 RelayService，而非直接持有完整引用。
- `RelayService` 通过 `TeamRunStatusUpdater` 窄接口更新 TeamRun 状态，而非直接依赖 `AgentTeamService`。

### 2. EventBus 中介 Relay 回调

对于 RelayService 回调更新 TeamRun 状态的场景，引入事件总线中介：

```
AgentRun 结束 → RelayService 发布 "agent.run.completed" 事件
                      ↓
                EventBus 分发
                      ↓
         AgentTeamService 订阅并更新 TeamRun 状态
```

- RelayService 只依赖 EventBus 接口（`Publish`），不依赖任何具体服务。
- AgentTeamService 在初始化时订阅 `agent.run.completed` 事件。
- EventBus 使用 Hub Server 已有的 AgentRunEvent channel 基础设施（`hub-server/internal/events`），不引入新的消息中间件。

### 3. 构造函数显式依赖

所有服务必须通过构造函数注入依赖，移除全部 `Set*` setter：

```go
func NewAgentTeamService(
    store Store,
    agentService AgentService,           // 依然是直接依赖（不构成循环）
    eventBus EventBus,                    // 新增：事件总线
    // 不再需要 Set* 调用
) *AgentTeamService
```

## Alternatives

### 方案 A：引入 DI 容器（dig/wire）延迟解析

使用 `uber-go/dig` 的延迟解析或 `google/wire` 的 provider set 来解决循环。

- **优点**：自动解析依赖图，不需要手动设计窄接口。
- **缺点**：循环依赖的语义问题依然存在，只是交给框架在运行时/代码生成时处理；引入额外依赖和概念负担；wire 的 provider set 在循环场景下依然会编译失败。
- **结论**：拒绝。DI 容器不能消除循环依赖，只是推迟了问题的暴露时机。

### 方案 B：延迟解析（Lazy Resolution）

在服务内部使用 `sync.Once` + 内部 setter 实现延迟初始化。

- **优点**：代码改动最小，只需包装 Setter 为线程安全的延迟加载。
- **缺点**：依然存在部分初始化窗口；依赖关系依然隐式；首次调用时可能因初始化顺序不正确而 panic。
- **结论**：拒绝。仅在初始化时序上加了锁，未解决根本的架构耦合问题。

### 方案 C：合并服务

将 AgentTeamService、AgentService、RelayService 合并为单个 MegaService。

- **优点**：物理消除循环（变成一个结构体的内部方法调用）。
- **缺点**：创建数千行的超级服务，严重违反单一职责，SUPER 评分反而全面恶化。
- **结论**：拒绝。这是一个倒退方案。

## Consequences

**正面：**

- 依赖方向从循环变为单向：`AgentTeamService → AgentService → RelayService`，无反向依赖。
- 所有依赖在构造函数中显式声明，编译期保证不出现 nil 依赖。
- 窄接口使每个服务的耦合面最小化，修改一个服务不影响无关方法。
- EventBus 中介使 RelayService 回调变为异步解耦，增强系统容错性（事件可重放）。
- S.U.P.E.R E 评分显著提升：消除 setter 注入 = 消除一类运行时错误源。

**负面：**

- 窄接口定义增加了文件中的类型声明量（每个接口 1-2 个方法，预计 3-5 个新接口）。
- EventBus 引入异步解耦后，Relay 回调变为最终一致性（而非同步确认），需要适应的错误处理模式。
- 从同步 setter 调用切换到事件订阅，调试时需要追踪事件发布/订阅链，排查路径变长。
- 现有代码中大量 `s.agentTeamService.DoSomething()` 调用需要改为 `s.teamRunUpdater.UpdateStatus()`，迁移工作量大。
