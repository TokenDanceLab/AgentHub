# ADR-013: app.go 文件拆分

## Status

Accepted

## Context

SUPER 审计发现 `hub-server/cmd/hub-server/app.go` 是 Hub Server 中 **S.U.P.E.R 评分最低的单一文件**，共 1081 行，包含以下职责混合：

- **依赖注入（wiring）**：Logger、Store、Repository、Service 等组件的初始化与组装。
- **事件系统初始化**：AgentRunEvent 等事件通道的创建和订阅注册。
- **后台任务管理**：JobScheduler、AgentRunTimeoutWatcher 等 cron/goroutine 生命周期。
- **Admin 管理接口**：Admin SDK token 刷新、Admin API 端点注册。
- **路由注册**：所有 HTTP handler 的路由挂载与中间件装配。

这种单文件巨型入口点导致：

1. **审查困难**：任何涉及启动流程的变更都需要跨 1000+ 行上下文理解，PR review 耗时过长。
2. **合并冲突频繁**：多个开发者同时修改启动流程的不同部分时，冲突集中在同一文件。
3. **测试覆盖不足**：整个启动流程耦合在一个函数中，无法独立测试 wiring 正确性或后台任务生命周期。
4. **新增启动逻辑无处安放**：新增 middle initializer 时开发者难以判断应插入何处，导致逻辑散落在 `main.go` 或 `app.go` 末尾。

## Decision

将 `app.go` 从 1081 行单文件拆分为 **5 个职责明确的文件**，全部位于 `hub-server/cmd/hub-server/` 目录下：

| 文件 | 职责 | 预估行数 |
|------|------|----------|
| `app.go` | 顶层 App 结构体定义、Run() 入口、优雅关闭编排 | ~150 行 |
| `wiring.go` | 依赖注入：Logger → Store → Repository → Service 构建管线 | ~250 行 |
| `events.go` | 事件系统初始化：AgentRunEvent channel、订阅注册、relay 事件桥接 | ~180 行 |
| `background.go` | 后台任务管理：JobScheduler、AgentRunTimeoutWatcher、goroutine 泄漏防护 | ~200 行 |
| `admin.go` | Admin SDK token 刷新、Admin API 端点注册、admin 中间件 | ~150 行 |
| `router.go` | HTTP 路由注册：所有 handler 路由挂载 + 中间件装配 | ~150 行 |

**拆分原则：**

- **顶层 App 结构体保留在 `app.go`**，作为唯一的 public API 入口。
- 各文件通过 `func (a *App) initXxx() error` 方法挂载到 App 上，由 `app.go` 的 `Run()` 按序调用。
- 每个文件自包含其所需的 import，避免循环引用。
- 共享的工具函数提取到 `cmd/hub-server/internal/` 子包。

## Alternatives

### 方案 A：引入 DI 框架（dig/wire）

使用 `uber-go/dig` 或 `google/wire` 进行依赖注入。

- **优点**：声明式依赖管理，自动解析依赖图，减少手写 wiring 代码。
- **缺点**：引入额外的框架依赖和编译时/运行时开销；团队需学习 DI 框架的语义和调试方法；对于当前 ~10 个依赖的规模属于过度设计。
- **结论**：拒绝。当前依赖图规模适中，手写 wiring 足够清晰，DI 框架的抽象成本高于收益。

### 方案 B：保持现有单文件结构

维持 `app.go` 不动，仅通过注释分区和 `// region` 标记来改善可读性。

- **优点**：零变更风险，无重构成本。
- **缺点**：不解决合并冲突、审查困难和无法独立测试的根本问题；SUPER R 评分将持续被此文件拖累。
- **结论**：拒绝。这是阻塞 S.U.P.E.R 评分提升的关键瓶颈，必须解决。

## Consequences

**正面：**

- 每个文件职责单一，开发者可按需定位到对应文件，无需跨 1000+ 行搜索。
- 多个开发者可并行修改 wiring、events、background、router 而不会冲突。
- 每个 `init*` 方法可独立进行单元测试，验证各组件的构建正确性。
- 新增启动逻辑时有明确的归属文件，降低新成员上手门槛。
- S.U.P.E.R R 评分（Responsibility）从此文件中直接提升。

**负面：**

- 文件数量增加（1 → 6），需要在代码导航时注意文件名。
- `init*` 方法的调用顺序需在 `Run()` 中显式维护，顺序错误可能导致启动失败（需集成测试覆盖）。
- 共享的 helper 函数需要提取到 internal 子包，增加一个包层级。
- git blame 历史在拆分后需要 `--follow` 追踪，但属于一次性迁移成本。
