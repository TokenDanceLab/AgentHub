# ADR-014: agent_team.go 文件拆分

## Status

Accepted

## Context

`hub-server/internal/service/agent_team.go` 是 Hub Server 中**函数数量最多、行数最长的服务文件**，共 2313 行，包含 81 个函数，涉及以下混杂关注点：

- **团队 CRUD**：创建、更新、删除、查询 AgentTeam。
- **成员管理**：添加/移除 Agent、角色分配、成员列表查询。
- **运行编排**：TeamRun 启动、状态追踪、结果聚合。
- **竞争模式**：Compete 模式的选手管理、轮次控制、结果裁判。
- **路由分发**：Agent 消息路由、多 Agent 对话协调。
- **事件发布**：AgentRunEvent 发布、状态变更通知。
- **Backend API 调用**：对各 AI backend 的请求构造与响应解析。
- **重试与超时**：Backend 调用的重试策略和超时控制。
- **Mock/Fixture**：测试辅助函数与 mock 实现也混在同一个文件中。

该文件的 SUPER 审计发现以下具体问题：

1. **S（Size）**：2313 行远超可维护阈值（推荐 < 400 行）。
2. **U（Understandability）**：81 个函数平铺，无层级组织，新成员需通读全文才能理解单个流程。
3. **P（Parallelism）**：任何团队成员功能的修改都需锁定同一文件，多人协作阻塞严重。
4. **E（Error-proneness）**：函数间共享包级变量和未导出 helper，修改一处易引发远端副作用。
5. **R（Responsibility）**：单一文件承担 6+ 种职责，严重违反单一职责原则。

## Decision

将 `agent_team.go` 拆分为 **6 个领域文件 + 1 个 Facade 文件**：

| 文件 | 职责 |
|------|------|
| `agent_team.go` | Facade：AgentTeamService 结构体定义、公共接口方法声明、跨域编排 |
| `agent_team_crud.go` | 团队 CRUD：Create、Update、Delete、Get、List |
| `agent_team_member.go` | 成员管理：AddMember、RemoveMember、UpdateRole、ListMembers |
| `agent_team_run.go` | 运行编排：StartRun、CancelRun、GetRun、RunStatus 状态机 |
| `agent_team_compete.go` | 竞争模式：选手注册、轮次推进、结果裁判（已部分提取） |
| `agent_team_routing.go` | 路由分发：Agent 消息路由、多 Agent 对话协调（已部分提取） |
| `agent_team_events.go` | 事件发布：AgentRunEvent 构造、发布、订阅桥接 |

**拆分原则：**

- Facade（`agent_team.go`）仅保留结构体定义、构造函数、以及跨域的编排方法，控制在 ~200 行以内。
- 各领域文件通过 `func (s *AgentTeamService) methodName()` 挂载，可独立编译和测试。
- `agent_team_compete.go` 和 `agent_team_routing.go` 已在之前的迭代中部分提取，本次拆分将其完成并规范化。
- 内部共享的 helper（请求构造、重试逻辑）提取到 `agent_team_internal.go`（不导出）。
- 每个领域文件配备对应的 `_test.go`：`agent_team_crud_test.go` 等。

## Alternatives

### 方案 A：按层级拆分（handler / service / repository）

将 81 个函数按调用层级分散到 handler、service、repository 三层。

- **优点**：符合传统分层架构直觉。
- **缺点**：当前 `agent_team.go` 中 CRUD、run、routing 是水平切面而非垂直层级；强行拆分到不同层会割裂同一业务流程（如 CreateTeam 需同时涉及 handler 参数校验、service 业务逻辑、repository 数据持久化），导致追踪一个完整流程需要跨 3 个文件跳转。
- **结论**：拒绝。垂直切分（按业务领域）更适合当前代码组织。

### 方案 B：保持现有单文件

继续在 `agent_team.go` 中维护所有逻辑，仅通过更好的注释和 `// MARK:` 分区来管理。

- **优点**：零重构成本。
- **缺点**：SUPER 评分中的 S、U、P、E、R 五个维度全部受影响，无法通过任何方式改善。且随着 Compete 模式等新功能的加入，文件将继续膨胀至 3000+ 行。
- **结论**：拒绝。这是 SUPER 审计中最关键的整改项之一。

## Consequences

**正面：**

- 每个领域文件 < 400 行，符合可维护性标准。
- 开发者可按功能关键词直接定位到对应文件，无需在 2313 行中搜索。
- 各领域可独立编写单元测试，测试文件也相应拆分，测试运行更快（可按文件过滤）。
- 多人可并行开发不同领域（CRUD / Run / Compete / Routing）而互不冲突。
- Facade 保持稳定，新增功能只需添加新文件，符合开闭原则。

**负面：**

- 文件数量从 1 增至 7（6 领域 + 1 Facade + internal helper），目录列表变长。
- 跨域逻辑（如创建团队后自动发布事件）需要在 Facade 层显式编排，不能被遗漏。
- `*_test.go` 文件同比例增长，CI 中测试文件扫描时间略有增加。
- 需要团队约定：新功能应先判断归属领域，不确定时在 Facade 中编排。
