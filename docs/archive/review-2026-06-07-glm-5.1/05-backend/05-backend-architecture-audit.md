# 05 - 后端架构审计报告

> 审计日期: 2026-06-07
> 审计范围: Go 服务结构（hub-server、edge-server）、API 设计、数据库 schema/migration 质量、WebSocket 协议、service 层拆分合理性
> 审计模式: 严格只读

---

## 目录

1. [Go 服务总体架构](#1-go-服务总体架构)
2. [hub-server 架构审计](#2-hub-server-架构审计)
3. [edge-server 架构审计](#3-edge-server-架构审计)
4. [Hub-Edge 通信协议](#4-hub-edge-通信协议)
5. [数据库 Schema 与 Migration](#5-数据库-schema-与-migration)
6. [WebSocket 协议设计](#6-websocket-协议设计)
7. [Service 层拆分合理性](#7-service-层拆分合理性)
8. [安全与配置](#8-安全与配置)
9. [总结](#9-总结)

---

## 1. Go 服务总体架构

### 1.1 🟢 双服务架构职责分明

| 服务 | 职责 | 技术栈 |
|---|---|---|
| **hub-server** | 中央消息、用户、会话、Agent 调度、WebSocket 推送 | Gin + GORM + Redis + PostgreSQL |
| **edge-server** | 本地 Agent 执行、进程管理、事件流 | 标准库 net/http + 内存 Store |

**hub-server** 是完整的多用户消息平台（用户系统、好友、群聊、Agent 市场、审计），**edge-server** 是单实例的 Agent 运行时（进程执行器、适配器、技能注入、MCP 端点）。

两者通过 `pkg/` 共享 errcode/debug/reqlog 工具包，无直接代码耦合。

### 1.2 🟢 Hub-Edge 通信模式清晰

```
Desktop App ──WebSocket──> hub-server ──Dispatch Task──> edge-server (via WS push)
                                                   edge-server ──Callback──> hub-server /edge/agent-tasks/:id/{ack,stream,done,fail}
```

Hub 通过 WebSocket 向 Edge 推送任务（dispatch），Edge 通过 REST 回调 Hub 报告结果。这是一种单向推送 + 回调确认的模式，简洁可靠。

---

## 2. hub-server 架构审计

### 2.1 🟢 标准分层架构

hub-server 遵循经典的 Go Web 分层:

```
cmd/server-hub/main.go        -- 入口（配置加载、依赖初始化）
internal/app/app.go           -- DI 容器（组装所有组件、生命周期管理）
internal/router/router.go     -- 路由注册
internal/handler/             -- HTTP 处理层（18 个 handler）
internal/service/             -- 业务逻辑层（19 个 service）
internal/repository/          -- 数据访问层（16 个 repository）
internal/model/               -- 数据模型（20+ 模型文件）
internal/middleware/           -- 中间件（12 个中间件）
internal/ws/                  -- WebSocket 管理
```

Handler -> Service -> Repository 依赖方向严格单向。

### 2.2 🔴 App DI 容器 -- 参数爆炸与手动组装

**文件**: `hub-server/internal/app/app.go:34-99`

App 结构体包含 **24 个 Handler 字段** 和 **10+ 个 Service 字段**，全部手动组装在 `Run()` 方法中（超过 300 行初始化代码）。`SetupRoutes` 函数接收 **26 个参数**。

```go
// hub-server/internal/router/router.go:15
func SetupRoutes(r *gin.Engine, cfg *config.Config, jwtSecret string, cacheClient *cache.Client,
    authHandler *handler.AuthHandler, wsHandler *handler.WebSocketHandler,
    deviceHandler *handler.DeviceHandler, contactHandler *handler.ContactHandler,
    sessionHandler *handler.SessionHandler, messageHandler *handler.MessageHandler,
    agentHandler *handler.AgentHandler, customAgentHandler *handler.CustomAgentHandler,
    attachmentHandler *handler.AttachmentHandler, notificationHandler *handler.NotificationHandler,
    healthHandler *handler.HealthHandler, publicHandler *handler.PublicHandler,
    oidcHandler *handler.OIDCHandler, agentProfileHandler *handler.AgentProfileHandler,
    skillHandler *handler.SkillHandler, mcpHandler *handler.MCPServerHandler,
    marketHandler *handler.MarketHandler, pbHandler *handler.ProviderBindingHandler,
    targetHandler *handler.ExecutionTargetHandler, auditHandler *handler.AuditHandler,
    relayHandler *handler.RelayHandler, agentTeamHandler *handler.AgentTeamHandler) {
```

**问题**:
1. 每新增一个 Handler，需修改 App struct、Run() 初始化、setupRouter() 调用、SetupRoutes 签名——四处联动
2. 26 个参数的函数签名极其脆弱
3. 无法单元测试路由注册（mock 26 个 handler 过于痛苦）

**建议**: 引入 `RouterConfig` 或 `HandlerRegistry` 结构体封装所有 handler:

```go
type HandlerRegistry struct {
    Auth       *handler.AuthHandler
    WebSocket  *handler.WebSocketHandler
    // ...
}
func SetupRoutes(r *gin.Engine, cfg *Config, handlers *HandlerRegistry)
```

### 2.3 🟡 App.Run() 承担过多职责

**文件**: `hub-server/internal/app/app.go:115-295`

`Run()` 方法同时负责:
- 健康检查（DB ping、Redis ping）
- 所有 Service 和 Handler 的创建和注入
- WebSocket 管理器初始化
- 事件总线创建和订阅
- 后台任务启动（scheduler、heartbeat、metrics）
- HTTP Server 启动和优雅关闭

超过 **180 行**的初始化逻辑在一个方法中。

**建议**: 将 `Run()` 拆分为独立的初始化阶段:
- `initServices()` -- 创建所有 Service
- `initHandlers()` -- 创建所有 Handler
- `initSubscriptions()` -- 订阅事件总线
- `initBackgroundTasks()` -- 启动后台任务

### 2.4 🟢 优雅关闭顺序正确

**文件**: `hub-server/internal/app/app.go:299-351`

关闭顺序: HTTP -> Admin -> WS -> EventBus -> Background -> Audit -> DB -> Redis

这是正确的依赖感知关闭顺序，从外到内。

### 2.5 🟡 路由结构按设备类型分组而非按领域分组

**文件**: `hub-server/internal/router/router.go`

路由组织方式:
- `/client/*` -- 客户端（含 auth、contacts、sessions、messages、attachments、notifications）
- `/edge/*` -- Edge 设备（device 注册、agent task 回调）
- `/web/*` -- Web 设备（agent task 触发、custom agents、profiles、skills、MCP、market、teams）
- `/cloud/*` -- 云 Edge 注册

**问题**: `/web/*` 下包含了大量不同领域的端点（agents、skills、MCP、market、provider-bindings、execution-targets、audit、relay、teams），职责过于集中。

**建议**: 考虑按领域分组而非设备类型:
```
/api/v1/agents/*       -- 所有 agent 相关
/api/v1/sessions/*     -- 会话相关
/api/v1/market/*       -- 市场相关
```
通过 middleware 控制设备类型权限。当前模式可以工作，但随着 API 增长将难以维护。

### 2.6 🟢 Middleware 层设计完善

hub-server 包含 12 个 middleware:
- CORS, API Version, Body Limit, Global Rate Limit
- Request ID, Access Log, Prometheus Metrics, Timeout
- Auth, Device Type Check, Require Admin
- Rate Limit (per-endpoint)

每个 middleware 都有对应的单元测试（`*_test.go`），覆盖完整。

---

## 3. edge-server 架构审计

### 3.1 🟢 插件化适配器架构

**文件**: `edge-server/internal/adapters/`

edge-server 使用适配器模式支持多种 Agent 运行时:

| 适配器 | 文件 | 行数 | 目标 |
|---|---|---|---|
| Claude Code | `claude_code.go` | 209 | Anthropic Claude CLI |
| Codex | `codex.go` | 721 | OpenAI Codex CLI |
| OpenCode | `opencode.go` | 399 | OpenCode CLI |
| Orchestrator | `orchestrator.go` | 640 | 多 Agent 编排 |

通过 `Registry` 模式注册和查找适配器，`main.go` 中通过 `--runner-profile` 选择预设。这是良好的开闭原则（OCP）实践——添加新 Agent 只需实现 `AgentAdapter` 接口。

### 3.2 🟢 进程执行器分层清晰

**文件**: `edge-server/internal/lifecycle/`

```
executor.go              -- RunExecutor 接口
process_executor.go      -- 实际进程管理（1413 行）
mock_executor.go         -- 测试用 mock
decision_loop.go         -- 权限决策循环
result_aggregator.go     -- 子 Agent 结果聚合
env_sanitizer.go         -- 环境变量清理
run_errors.go            -- 运行时错误类型
```

### 3.3 🟡 process_executor.go 体量过大（1413 行）

**文件**: `edge-server/internal/lifecycle/process_executor.go`

这个文件承担了进程启动、stdout/stderr 解析、Agent 适配器调用、Hub 回调、结果收集等多项职责。

**建议**: 考虑拆分为:
- `process_executor.go` -- 核心进程生命周期管理
- `process_output.go` -- 输出流解析和路由
- `process_adapter_bridge.go` -- Agent 适配器集成

### 3.4 🟢 配置管理灵活

edge-server 使用命令行 flags + 环境变量双通道配置（`main.go:155-236`），所有配置项都有环境变量回退:

```go
fs.StringVar(&cfg.Addr, "addr", getEnv("AGENTHUB_ADDR", "127.0.0.1:3210"), "listen address")
```

这符合 12-Factor App 原则。

### 3.5 🟢 安全模型分层合理

edge-server 的安全层次:
1. **监听地址校验** -- `security.ValidateLocalListenAddr` / `ValidateRemoteListenAddr`
2. **自动生成认证令牌** -- 非开发模式下自动生成 64 字符随机 token
3. **CORS 中间件** -- 通过 `security.IsTrustedOrigin` 校验来源
4. **本地认证中间件** -- 支持本地 token 和 Hub JWT 双模式
5. **WebSocket 认证** -- GET /v1/events 不豁免认证
6. **Workspace Allowlist** -- 限制文件系统访问范围

---

## 4. Hub-Edge 通信协议

### 4.1 🟢 Edge->Hub 回调设计健壮

**文件**: `edge-server/internal/hub/callback.go`

回调客户端特性:
- 指数退避重试（1s, 2s, 4s，最多 3 次）
- 4xx 不重试（应用层错误）
- 5xx 重试（服务端错误）
- Hub 响应格式校验（`{"code": "OK"}`）
- Context 传播（支持取消）
- Best-effort 语义（回调失败不阻塞运行时）

### 4.2 🟡 缺少 Hub->Edge 任务确认机制

当前 Hub 通过 WebSocket push dispatch 任务给 Edge，但 dispatch 是单向推送（fire-and-forget）。如果 Edge 在 dispatch 到达时离线，任务会在 Redis 队列中等待重连。

Hub 的 `pushPendingTasks` 机制（`app.go:794-819`）在 Edge 重连时推送队列中的任务，提供了间接的可靠性保证。但没有任务级别 ACK/NACK 协议——Hub 不确定 Edge 是否实际接收并开始执行了任务。

**建议**: 考虑在 Hub dispatch 后等待 Edge 的 `TaskAck` 回调来确认接收。当前通过 `UpdatePendingTaskDispatched` 标记任务状态，但这是一个本地标记而非协议级确认。

---

## 5. 数据库 Schema 与 Migration

### 5.1 🟢 Migration 管理规范

**文件**: `hub-server/migrations/`

共 41 个 migration，使用序号前缀 `0001-0041`，每个都有 up/down 文件。使用 `golang-migrate` 工具管理。

Migration 命名清晰:
```
0001_users                 -- 用户表
0002_friendships           -- 好友关系
0006_messages              -- 消息
0011_agent_instances       -- Agent 实例
0022_agent_profiles        -- Agent 配置
0033_agent_team            -- Agent 团队
0041_ensure_performance_indexes -- 性能索引
```

### 5.2 🟢 Schema 设计质量

**文件**: `hub-server/migrations/0033_agent_team.up.sql`

```sql
CREATE TABLE agent_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(100) NOT NULL,
    ...
);
CREATE TABLE agent_team_members (
    ...
    role VARCHAR(20) NOT NULL DEFAULT 'executor'
        CHECK (role IN ('supervisor', 'executor', 'reviewer')),
    ...
    UNIQUE(team_id, agent_profile_id)
);
CREATE TABLE agent_team_runs (
    ...
    status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    ...
);
```

亮点:
- 使用 `gen_random_uuid()` 而非应用层生成
- 外键约束完整 (`REFERENCES ... ON DELETE CASCADE`)
- CHECK 约束保护枚举字段
- UNIQUE 约束防止重复成员
- 时间戳字段 `NOT NULL DEFAULT now()`

### 5.3 🟡 早期 Migration 使用 uuid-ossp 而非 gen_random_uuid

**文件**: `hub-server/migrations/0001_users.up.sql:1`

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

后期 migration（如 0033）已迁移到 `gen_random_uuid()`（PostgreSQL 13+ 内置）。旧 migration 保留 uuid-ossp 扩展是为了向下兼容，但新项目部署在 PG13+ 时无需此扩展。

**建议**: 在部署文档中注明 PG13+ 要求，未来可在清理 migration 时统一。

### 5.4 🟢 渐进式 Schema 演化

Migration 历史展示了清晰的渐进演化路径:
- `0016_workspace_refactor` -- 重构
- `0017_devices_unique` -> `0021_devices_allow_multiple_same_type` -- 需求变更
- `0035_unify_auth_password_nullable` -- 认证统一（密码改为可选）
- `0039_message_pins_session_fk` -- 补充外键
- `0040_audit_events_immutable` -- 审计表不可变
- `0041_ensure_performance_indexes` -- 性能优化

---

## 6. WebSocket 协议设计

### 6.1 🟢 hub-server WebSocket 管理器设计合理

**文件**: `hub-server/internal/ws/manager.go`

特性:
- 连接按用户+设备类型索引（支持多设备同时在线）
- 新连接踢掉同类型旧连接（`oldConnID` 追踪）
- 心跳检测（ping/pong，可配置最大丢失次数）
- 发送缓冲区满时丢帧而非阻塞（`metrics.WSDroppedFrames` 计数）
- 连接关闭使用 atomic 标志防止 channel panic
- 优雅关闭: 先 close Send channel（解除 writeLoop 阻塞），再 close WebSocket（解除 readLoop 阻塞）

### 6.2 🟢 Frame 协议简洁

**文件**: `hub-server/internal/ws/frame.go`

```go
type Frame struct {
    Type    string      `json:"type"`
    SeqID   int64       `json:"seq_id,omitempty"`
    Payload interface{} `json:"payload,omitempty"`
}
```

定义了 19 种帧类型，覆盖: 消息（new/recall/pin/unpin/read）、会话（created/dissolved/member_joined）、设备（online/offline/kicked）、Agent（dispatch/stream/done/failed/cancel/control）、通知、好友。

### 6.3 🟢 edge-server 事件总线支持持久化和回放

**文件**: `edge-server/internal/events/bus.go`

特性:
- 单调递增序列号（用于 cursor-based replay）
- 环形缓冲区保留最近 10000 个事件
- 持久化钩子（persist-before-broadcast）保证崩溃恢复
- 订阅者支持 cursor 追溯回放
- Gap 检测: 慢消费者会收到 `system.gap` 控制事件，包含丢失事件的 seq 范围
- 高频事件（`run.output.batch`）可配置跳过持久化以优化吞吐量

---

## 7. Service 层拆分合理性

### 7.1 🟢 hub-server 19 个 Service 职责明确

| Service | 文件 | 职责 |
|---|---|---|
| AuthService | 169 行 | 认证（JWT、OIDC） |
| ContactService | - | 好友管理 |
| SessionService | 579 行 | 会话管理 |
| MessageService | 750 行 | 消息 CRUD |
| AgentService | 161 行 | Agent 实例管理 |
| AgentControlService | - | Agent 控制指令 |
| AgentDispatchService | 546 行 | 任务调度和分发 |
| AgentTeamService | - | 多 Agent 团队 |
| AttachmentService | - | 文件附件 |
| AuditService | - | 审计事件 |
| ... | ... | ... |

MessageService（750 行）和 SessionService（579 行）是最大的两个 Service，体量在合理范围内。

### 7.2 🟡 edge-server Handler 文件偏大（1356 行）

**文件**: `edge-server/internal/api/handlers.go`

单个 Handler 文件包含所有 Edge API 端点处理逻辑。hub-server 按领域拆分了 18 个 handler 文件，但 edge-server 集中在一个文件中。

**建议**: 按领域拆分:
- `handlers_run.go` -- Run 相关端点
- `handlers_thread.go` -- Thread 相关端点
- `handlers_event.go` -- WebSocket 事件流
- `handlers_permission.go` -- 权限决策

### 7.3 🟢 事件驱动解耦

hub-server 使用内部事件总线（`service.Bus`）解耦 Service 层和 WebSocket 推送:

```
Service -> Bus.Publish("message.new", msg) -> App subscribes -> WS Manager.PushToSession
```

Service 层不直接依赖 WebSocket Manager，通过事件总线间接通信。这是正确的架构决策。

### 7.4 🟢 事件总线使用协程池

**文件**: `hub-server/internal/service/eventbus.go`

使用 `ants` 协程池（而非 `go` 关键字）执行事件处理器:
- 可控并发度（`EventBusPoolSize`）
- Panic recovery（防止单个 handler 崩溃影响整体）
- Prometheus 指标追踪（`EventBusPanics`、`EventBusQueueLen`）

---

## 8. 安全与配置

### 8.1 🔴 Debug 端点暴露敏感配置

**文件**: `hub-server/internal/app/app.go:652-668`

```go
func (a *App) hubConfigDumper() debugpkg.ConfigDumper {
    return func() map[string]any {
        return map[string]any{
            ...
            "db_password":    cfg.DB.Password,      // 明文密码！
            "redis_password": cfg.Redis.Password,    // 明文密码！
            "jwt_secret":     cfg.JWT.Secret,        // 明文密钥！
        }
    }
}
```

**文件**: `edge-server/internal/httpserver/server.go:562-575`

```go
return map[string]any{
    ...
    "local_auth_token": cfg.LocalAuthToken,    // 明文令牌！
    "hub_jwt_secret":   cfg.HubJWTSecret,      // 明文密钥！
    "hub_token":        cfg.HubToken,           // 明文凭据！
}
```

**问题**: Debug 端点（`/debug/config`）虽然受 Basic Auth 保护，但仍然在 HTTP 响应中返回数据库密码、JWT 密钥、认证令牌等敏感信息的明文。如果 Basic Auth 配置弱或被绕过，将导致全面凭据泄露。

**建议**: 将所有敏感值替换为 `[REDACTED]` 或仅显示前几个字符:
```go
"db_password": "[REDACTED]",
"jwt_secret":  cfg.JWT.Secret[:4] + "****",
```

### 8.2 🟢 Config 结构体实现了 slog.LogValuer 脱敏

**文件**: `hub-server/internal/config/config.go`

所有包含敏感信息的 Config 子结构体（`DBConfig`、`RedisConfig`、`JWTConfig`、`S3Config`、`TokenDanceIDConfig`）都实现了 `slog.LogValuer` 接口，在日志中将密码替换为 `[REDACTED]`。

但这个保护只覆盖日志输出，不覆盖 debug 端点。

### 8.3 🟢 JWT 密钥强度校验

**文件**: `hub-server/internal/config/config.go:424-450`

Validate() 方法包含:
- 已知弱密码黑名单（12 个常见默认值）
- 最小长度 16 字符
- 同时检查 config 文件值和环境变量值

### 8.4 🟢 edge-server 远程模式强制认证

**文件**: `edge-server/cmd/agenthub-edge/main.go:203-208`

```go
if cfg.RemoteMode {
    if cfg.LocalAuthToken == "" && cfg.HubJWTSecret == "" {
        return config{}, fmt.Errorf("--remote-mode requires --local-auth-token or --hub-jwt-secret to be set")
    }
}
```

远程模式不允许无认证运行。

---

## 9. 总结

### 严重级别分布

| 级别 | 数量 | 关键发现 |
|---|---|---|
| 🔴 Critical | 2 | Debug 端点泄露敏感凭据（hub + edge）；DI 容器参数爆炸 |
| 🟡 Warning | 5 | App.Run() 职责过多；路由按设备类型分组；process_executor 偏大；edge handler 未拆分；Hub->Edge 缺少任务级 ACK |
| 🟢 Info | 12 | 分层正确；适配器模式好；Migration 规范；WS 管理器健壮；事件总线设计精良；安全模型完善 |

### 最高优先级建议

1. **立即脱敏 Debug 端点** (🔴): 将 `hubConfigDumper` 和 `edgeConfigDumper` 中的敏感值替换为 `[REDACTED]`
2. **重构 DI 容器** (🔴): 引入 `HandlerRegistry` 减少 SetupRoutes 参数数量
3. **拆分 App.Run()** (🟡): 将初始化逻辑拆分为独立阶段方法
4. **拆分 edge-server handlers** (🟡): 按领域拆分为多个文件
5. **拆分 process_executor** (🟡): 提取输出解析和适配器桥接逻辑

### 架构优点

- hub-server 和 edge-server 职责边界清晰
- Go workspace 共享库（pkg/）设计合理
- 适配器模式支持多 Agent 运行时
- WebSocket 管理器设计健壮（缓冲、心跳、优雅关闭）
- edge-server 事件总线支持持久化和 gap 检测
- 数据库 Migration 命名规范，Schema 质量高
- 配置验证严格（JWT 强度、监听地址校验、远程模式强制认证）
- 日志脱敏覆盖完整（slog.LogValuer）
