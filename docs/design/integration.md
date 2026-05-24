# AgentHub 集成架构

日期：2026-05-24
状态：当前（M3a 已完成，M3b 进行中）

## 1. 系统拓扑

```
Desktop UI (React)                Web/Mobile UI (未来)
  │  REST + WS                         │  REST + WS
  ▼                                    ▼
Edge Server (Go) ◄──────────────► Hub Server (Go)
  │  AgentAdapter                       │  JWT 认证
  ▼                                     │  IM / 同步 / 中继
Agent CLI (Claude Code / Codex / OpenCode)
```

P0 边界：Desktop 仅连接本地 Edge。Hub Server 为骨架状态（可路由，桩响应），不是运行时依赖。

## 2. API 重叠分析

### 2.1 Edge Server REST API（`127.0.0.1:3210`）

P0 已实现路由：

| 方法 | 路径 | 用途 |
|--------|------|---------|
| `GET` | `/v1/health` | 健康检查 |
| `GET` | `/v1/runners` | 列出本地 Runner |
| `GET` | `/v1/agents` | 列出 Agent 适配器（Claude Code、Codex、OpenCode） |
| `GET` | `/v1/projects` | 列出项目 |
| `POST` | `/v1/projects` | 创建项目 |
| `GET` | `/v1/projects/{id}` | 获取项目 |
| `GET` | `/v1/threads` | 列出线程（按 projectId 过滤） |
| `POST` | `/v1/threads` | 创建线程 |
| `GET` | `/v1/threads/{id}` | 获取线程 |
| `GET` | `/v1/threads/{id}/items` | 列出线程项 |
| `POST` | `/v1/threads/{id}/messages` | 创建用户消息 |
| `GET` | `/v1/items/{id}` | 获取项 |
| `GET` | `/v1/runs` | 列出运行（按 threadId 过滤） |
| `POST` | `/v1/runs` | 启动 Agent 运行 |
| `POST` | `/v1/runs/{id}:cancel` | 取消运行 |
| `GET` | `/v1/runs/{id}` | 获取运行详情 |
| `GET` | `/v1/events` | WebSocket 事件流 |
| `POST` | `/v1/permissions/decide` | 提交权限决策 |

关键特征：
- **无认证** — 仅限本地，由 CORS 来源检查保护（`localhost`、`127.0.0.1`、`::1`、`tauri.localhost`）
- 所有响应使用 `{ items: [...], page: { hasMore: false } }` 列表包装
- 错误使用 `{ error: { code, message, traceId } }` 结构
- 请求体通过 `io.LimitReader` 限制为 1MB
- 超时：读取 15s，写入 0（WebSocket 长连接），空闲 60s

### 2.2 Hub Server REST API（`/client/*`、`/edge/*`、`/web/*`）

基于 Gin 框架构建，中间件链：

```
AccessLog → PrometheusMetrics → [AuthMiddleware] → [DeviceTypeCheck] → Handler
```

关键路由组：

| 路由组 | 认证 | 设备检查 | 用途 |
|-------|------|-------------|---------|
| `/health` | 无 | 无 | 健康检查 |
| `/client/auth` | 部分 | 无 | 注册、登录、刷新令牌（无需认证）；登出、个人信息、个人资料、密码（需要认证） |
| `/client/contacts` | JWT | 无 | 好友请求、联系人列表、屏蔽 |
| `/client/sessions` | JWT | 无 | IM 会话（创建、成员、消息、Agent、置顶） |
| `/client/messages` | JWT | 无 | 撤回、置顶、转发、搜索 |
| `/client/attachments` | JWT | 无 | 上传、下载 |
| `/client/notifications` | JWT | 无 | 列表、已读 |
| `/client/ws` | 无 | 无 | WebSocket（通过首帧认证） |
| `/edge/*` | JWT | `desktop` | 设备注册、Agent 任务 ack/stream/done/fail |
| `/web/*` | JWT | `web` | 触发/取消 Agent 任务、自定义 Agent CRUD |

### 2.3 重叠分析

| 领域 | Edge（P0） | Hub（P2+） | 重叠情况 |
|--------|-----------|-----------|---------|
| 项目 | CRUD | — | Hub 尚无项目概念 |
| 线程 | CRUD | 会话（群聊/私聊） | 不同模型；Hub Session 是 IM 房间，Edge Thread 是任务分支 |
| 消息 | 线程消息 | 会话消息 | 相似结构但 ID 体系与认证不同 |
| 运行 | 全生命周期 | Agent 任务（ack/stream/done/fail） | Hub 通过 Agent 任务委托执行给 Edge |
| Agent | 列出适配器 | 自定义 Agent CRUD | 不同范围：Edge 列出 CLI 适配器，Hub 管理用户定义的 Agent |
| 认证 | 无（CORS） | JWT Bearer | 无冲突 — Edge 仅限本地 |
| 事件 | 带类型的事件流 | 基于帧的 WS | 协议不同（详见第 4 节） |

**迁移路径**：当 Hub 成为云端权威源后，Edge 的 REST API 将变为 Hub 中继层背后的内部实现细节。Desktop 将连接到 Hub（而非直接连 Edge），Hub 将代理或中继 Agent 执行命令给 Edge。

## 3. 数据模型对齐

### 3.1 Edge Store 模型（Go，内存）

```go
Project  { projectId, name, status, createdAt, updatedAt }
Thread   { threadId, projectId, title, status, createdAt, updatedAt }
Run      { runId, projectId, threadId, status, createdAt, startedAt?, finishedAt? }
Item     { itemId, projectId, threadId, runId?, type, role?, status, content?, createdAt, updatedAt }
```

ID 前缀：`proj_`、`thread_`、`run_`、`item_`。所有时间戳均为 RFC3339 字符串。状态值为字符串（`active`、`queued`、`started`、`running`、`finished`、`failed`、`cancelled`）。

### 3.2 Hub Server 模型（Go，GORM/DB）

Hub 模型为关系型（GORM），使用 UUID 主键和外键关联：

```
User、Session、SessionMember、Message、MessagePin、
AgentInstance、CustomAgent、PendingAgentTask、
Device、Friendship、Notification、Attachment、RefreshToken
```

关键结构差异：
- Hub 内部使用 `uint` 自增 ID，外部使用带前缀的字符串
- Hub 具有 Edge 没有的用户/联系人/设备概念
- Hub `Message` 是 IM 消息，Edge `Item` 是时间线事件
- Hub `AgentInstance` 表示会话中的 Agent，Edge `AgentInfo` 是适配器元数据卡片

### 3.3 Desktop 共享类型（TypeScript）

```typescript
// 来自 @shared/types
HealthResponse   { status, version, edgeId }
Runner           { id, name, status, capabilities? }
RunInfo          { runId, projectId, threadId, status, createdAt?, startedAt?, finishedAt? }
ThreadInfo       { threadId, projectId, title, status, createdAt, updatedAt }
ItemInfo         { itemId, projectId, threadId, runId?, type, role?, status, content?, createdAt, updatedAt }
AgentInfo        { id, name, description?, version?, status, capabilities }
AgentCapabilities { streaming, toolCalls, fileChanges, thinkingVisible, multiTurn }
StartRunRequest  { projectId?, threadId?, prompt?, agentId?, model?, reasoningEffort? }
ListResponse<T>  { items: T[], page: { nextCursor?, hasMore } }
PageInfo         { nextCursor?, hasMore }
```

### 3.4 对齐问题

| 问题 | Edge（Go） | Desktop（TS） | 状态 |
|-------|-----------|-------------|--------|
| Project ID 键 | `Project.ID` → json:`"projectId"` | `projectId` | 通过 JSON 标签对齐 |
| Agent 能力 | `AgentCapabilities` struct | `AgentCapabilities` interface | 已对齐；Hub `AgentHandler` 返回兼容格式 |
| Item 与 Message | `Item`（时间线事件） | `ItemInfo` | 已对齐；Desktop 以通用方式处理 items |
| Run 状态 | 字符串枚举 | String | 已对齐（双方使用相同状态字符串） |
| Token 用量命名 | `inputTokens`/`outputTokens`（NDJSON）、`input`/`output`（OpenCode） | `input`/`output` | 在 `useChatMessages.mapUsageToTokenUsage()` 中标准化 |
| 错误结构 | `{ error: { code, message, traceId } }` | `parseError()` 来自 @shared/errors | 通过共享错误解析器对齐 |

## 4. WebSocket 协议

### 4.1 Edge 事件流（`/v1/events`）

**连接**：标准 WebSocket 升级，含 CORS 来源检查。

**游标回放**：`GET /v1/events?cursor={seq}` — 在连接时重放所有 `seq > cursor` 的事件。

**事件信封**（Go）：
```go
EventEnvelope {
    Version string         // "v1"
    ID      string         // "evt_<hex>"
    Seq     int64          // 每个 Edge 实例单调递增
    Type    string         // 如 "run.agent.text_delta"
    Scope   map[string]any // { projectId, threadId, runId }
    TraceID string         // 可选追踪关联
    SentAt  string         // RFC3339 UTC
    Payload any            // 类型特定的载荷
}
```

**关键事件类型**（已定义 20+）：
- 生命周期：`run.queued`、`run.started`、`run.finished`、`run.failed`、`run.cancelled`
- Agent 输出：`run.agent.text_delta`、`run.agent.text_block`、`run.agent.thinking`、`run.agent.tool_call`、`run.agent.tool_result`、`run.agent.file_change`、`run.agent.session_init`、`run.agent.result`
- 子 Agent：`run.agent.task_started`、`run.agent.task_dispatched`、`run.agent.task_progress`、`run.agent.task_notification`
- 权限：`run.agent.permission_requested`、`run.agent.permission_decided`、`run.agent.permission_decide`
- 系统：`run.agent.compact_boundary`、`run.agent.api_retry`、`run.agent.status_change`、`run.agent.auth_status`、`run.agent.rate_limit`
- 基础设施：`runner.online`、`runner.offline`、`project.created`、`thread.created`、`message.created`、`item.created`、`error`

**心跳**：服务器每 30 秒发送 WebSocket Ping。客户端必须回复 Pong。读取超时 60s。

**客户端发送**：无（仅服务器推送）。来自客户端的消息按设计被丢弃。权限决策通过 REST `POST /v1/permissions/decide` 完成。

**总线内部**（`events/bus.go`）：
- 10,000 个事件的环形缓冲区
- 非阻塞扇出到所有订阅者
- 慢订阅者的事件将被丢弃

### 4.2 Hub WebSocket（`/client/ws`）

**连接**：通过 `github.com/coder/websocket` 进行 WebSocket 升级。

**认证握手**：客户端的第一帧必须是认证帧：
```json
{ "type": "auth", "payload": { "access_token": "<JWT>" } }
```
服务器回复 `{ "type": "auth.ok" }` 或 `{ "type": "auth.fail", "payload": { "reason": "..." } }`。

**帧类型**（定义在 `ws/frame.go` 中）：
- 客户端 → 服务器：`auth`、`typing`
- 服务器 → 客户端：`auth.ok`、`auth.fail`、`message.new`、`message.recall`、`message.pin`、`message.unpin`、`message.read`、`session.created`、`session.dissolved`、`session.member_joined`、`session.member_left`、`session.info_updated`、`device.online`、`device.offline`、`device.kicked`、`agent.dispatch`、`agent.stream`、`agent.done`、`agent.failed`、`agent.cancel`、`notification.new`、`friend.request`、`friend.accepted`

**连接路由**（`ws/manager.go`）：
- `Register` → 分配 UUIDv7 连接 ID
- `SetAuth` → 将连接绑定到 userID + deviceType；替换同一 user+device 的旧连接
- `PushToUser` → 扇出到用户的所有设备连接
- `PushToSession` → 解析会话成员，扇出到所有成员

**心跳**：服务器每 30 秒 ping 所有连接。连续 2 次缺少 pong → 断开。

### 4.3 协议对比

| 方面 | Edge WS | Hub WS |
|--------|---------|--------|
| 认证模型 | 无（仅 CORS） | 首帧 JWT |
| 事件模型 | 带 `seq` 的类型信封 | 带可选 `seq_id` 的类型帧 |
| 回放 | 基于游标从总线历史回放 | 无回放（无状态） |
| 扇出 | 所有订阅者 | 按用户、按设备、按会话 |
| 心跳 | WebSocket Ping/Pong | WebSocket Ping/Pong，含丢包计数 |
| 客户端发送 | 丢弃 | 认证 + 输入状态指示 |
| 库 | `gorilla/websocket` | `coder/websocket` |

## 5. 认证流程

### 5.1 Edge：仅限本地（无认证）

Edge 在 P0 阶段明确仅限本地。安全措施包括：

1. **CORS 来源检查**（`security/origin.go`）：仅允许匹配 `localhost`、`127.0.0.1`、`::1`、`tauri.localhost`（用于 Tauri 桌面壳）或 `tauri://` scheme 的来源。空来源（非浏览器客户端）同样允许。

2. **绑定地址**：默认 `127.0.0.1:3210` — 不暴露到网络接口。

3. **信任边界**：Edge 信任本地机器。如果攻击者拥有本地代码执行能力，他们已控制了该机器。这是一个有意的 P0 权衡。

### 5.2 Hub：JWT Bearer 令牌

Hub 使用 HMAC 签名的 JWT：

1. **注册**（`POST /client/auth/register`）：创建用户，返回 JWT access + refresh 令牌。
2. **登录**（`POST /client/auth/login`）：验证凭据，返回 JWT access + refresh 令牌。
3. **令牌结构**（`jwtutil`）：Claims 包含 `sub`（用户 ID）、`name`、`device_type`、`device_id`、`exp`、`iat`。
4. **认证中间件**（`middleware/auth.go`）：从 `Authorization` 头提取 `Bearer <token>`，解析并验证 JWT，将 `user_id`、`device_type`、`device_id` 注入 Gin context。
5. **跳过路径**：认证中间件可配置跳过路径（精确或前缀匹配），用于公共端点，如 `/health`、`/client/auth/login`、`/client/auth/register`。

**存在两个中间件实现**：
- `hub-server/internal/middleware/auth.go` — 用于 Hub HTTP 路由的 Gin 中间件
- `hub-server/internal/auth/middleware.go` — 标准 `net/http` 中间件，包含 `User` context 类型和 `UserFromContext()` 辅助函数

两者使用相同的密钥验证 JWT 并提取相同的 claims。Gin 版本用于路由；`net/http` 版本可用于非 Gin 处理器。

### 5.3 认证差距分析

| 关注点 | Edge | Hub | 差距 |
|---------|------|-----|-----|
| 本地访问 | CORS 来源检查 | 不适用 | P0 阶段足够 |
| 远程访问 | 不适用 | JWT Bearer | Hub 认证就位，尚未与 Edge 集成 |
| Desktop → Hub | P0 未使用 | 通过 `/client/auth` 的 JWT | Desktop 尚无 Hub 认证代码 |
| Edge → Hub 中继 | 未实现 | 含 JWT + 设备检查的 `/edge/*` 路由 | 需要 Edge 持有并出示 JWT |
| 令牌刷新 | 不适用 | `/client/auth/refresh` | 已在 Hub 中实现，Desktop 无消费者 |

## 6. 消息流

### 6.1 端到端：从提示词到 UI 渲染

```
1. 用户在 Desktop UI 输入提示词
   └─ PromptInput.tsx → onSend(prompt, agentId, opts)

2. Desktop 调用 Edge REST API
   └─ edgeClient.ts → POST /v1/runs { projectId, threadId, prompt, agentId, model }

3. Edge API 处理器（handlers.go:PostRuns）
   └─ 在 store 中创建 Run（状态："queued"）
   └─ 发布 "run.queued" 事件
   └─ 调用 ProcessExecutor.Start(run, runCtx)

4. ProcessExecutor（lifecycle/process_executor.go）
   └─ 将 run 状态设为 "started" → 发布 "run.started"
   └─ 从注册表中解析 agent 适配器（按 agentId 或使用默认值）
   └─ 调用 adapter.BuildCommand(runCtx) → 获取 cmd 路径 + args + env
   └─ 启动 OS 进程，使用适配器感知的 stdin 管道

5. Agent CLI 运行（Claude Code / Codex / OpenCode）
   └─ 向 stdout 输出结构化 JSON/NDJSON
   └─ 从 stdin 监听控制消息（权限、取消、模型切换）

6. Adapter.ParseStream 逐行读取 stdout
   └─ NDJSONStreamParser / inline scanner 将 CLI 协议映射为 BusEvent 类型
   └─ 通过 EventEmitter 发出：Emit("run.agent.text_delta", scope, payload)
   └─ 事件发布到 events.Bus

7. 事件总线（events/bus.go）
   └─ 分配单调 seq
   └─ 追加到环形缓冲区（容量 10K）
   └─ 扇出到所有 WebSocket 订阅者（非阻塞）

8. WebSocket 处理器（handlers.go:GetEvents）
   └─ 从订阅者通道读取
   └─ 将 EventEnvelope 以 JSON 格式写入 WebSocket 连接

9. Desktop EventClient（eventClient.ts）
   └─ createEventStream() 打开 WebSocket 到 ws://127.0.0.1:3210/v1/events
   └─ 收到消息：解析 JSON，更新游标，通知处理器

10. useChatMessages hook（useChatMessages.ts）
    └─ 订阅事件流
    └─ Dispatch EVENT_RECEIVED → processEvent() reducer
    └─ 将每个事件类型映射到 ChatMessage / MessageBlock：
        text_delta → 合并的文本块（流式）
        tool_call → ToolUseBlock（可折叠，含嵌套子项）
        tool_result → 嵌套在匹配的 tool_use 块下
        file_change → FileChangeBlock
        session_init → SessionInitBlock
        result → ResultBlock（成功 + token 用量）

11. ChatView 渲染（ChatView.tsx）
    └─ 将 ChatMessage[] 映射到 UI 组件：
        StreamingTextBlock → MarkdownRenderer（含打字动画）
        ThinkingBlock → 可折叠手风琴
        ToolUseBlock → 可展开卡片，含参数查看器 + 结果子项
        DiffCard → 行内 diff，含 +/- 行高亮
        FileChangeBlock → details/summary，含操作徽章
    └─ 流式输出时自动滚动，用户上滚时显示滚动到底部指示器
```

### 6.2 控制流：取消

```
Desktop UI → POST /v1/runs/{runId}:cancel
  → Edge 处理器：h.Executor.Cancel(runID)
    → ProcessExecutor.Cancel：
      1. 向 stdin 写入 "interrupt" 控制消息（适配器感知）
      2. 调用 run 协程的 context.CancelFunc
      3. 将 run 状态设为 "cancelled"
      4. 发布 "run.cancelled" 事件
  → Agent CLI 收到中断信号，停止
  → ParseStream 返回（context 已取消）
  → Desktop UI 收到 "run.cancelled" → 设置 isStreaming=false
```

### 6.3 权限流程

```
1. Agent CLI 请求权限（如文件写入）
   → Adapter.ParseStream 检测到权限提示
   → 发布 "run.agent.permission_requested" 事件

2. Desktop 收到事件
   → useChatMessages 添加到 permissionRequests[]
   → UI 显示权限横幅

3. 用户点击允许/拒绝
   → Desktop 调用 POST /v1/permissions/decide { runId, requestId, decision }

4. Edge 处理器发布 "run.agent.permission_decided"
   → control_protocol.go 中的权限处理器通过 stdin 发送决策给 CLI

5. CLI 根据决策执行（继续或中止）
```

### 6.4 重连流程

```
1. WebSocket 断开
   → eventClient.ts onclose 触发
   → notifyStatus(false) → connectionStore 显示断开横幅
   → scheduleReconnect() 使用指数退避（1s → 2s → 4s → ... → 最大 30s）

2. 重连成功
   → WebSocket 以最后游标打开：ws://.../?cursor={lastSeq}
   → Edge 从环形缓冲区重放 seq > cursor 的事件
   → 如游标已过期（历史已淘汰）：UI 应拉取 REST 快照
     （REST 快照拉取在 Desktop 中尚未实现）

3. Edge 重启
   → 所有内存状态丢失
   → Desktop 检测到断开
   → 使用过期游标重连：Edge 发送错误事件
   → Desktop 应从 REST 重新获取线程/运行（尚未实现）
```

## 7. 关键集成差距

### 7.1 已实现

- [x] Desktop → Edge REST API（带类型的客户端，使用 `@shared/types`）
- [x] Desktop ↔ Edge WebSocket（含重连的事件流）
- [x] Edge → Agent CLI（AgentAdapter 接口，3 个实现）
- [x] Agent CLI → Edge → Desktop（完整事件管道：20+ 事件类型）
- [x] 权限请求 → 决策往返
- [x] 取消运行（REST → stdin 中断 → context 取消）
- [x] Hub Server 骨架（18 条路由，健康检查，桩响应）
- [x] Hub JWT 认证中间件
- [x] Hub WebSocket（基于帧、认证握手、按用户路由）

### 7.2 尚未集成

- [ ] Desktop → Hub 认证（Desktop 无登录/注册 UI）
- [ ] Edge → Hub 同步（Edge 不向 Hub 注册或上传事件）
- [ ] Hub → Edge 中继（通过 Hub 远程控制 Edge 尚未实现）
- [ ] WebSocket 游标过期时的 REST 快照恢复
- [ ] Edge 与 Hub 之间的会话/线程同步
- [ ] 跨设备消息投递
- [ ] 从 Hub Web UI 调度 Agent 任务到 Edge

### 7.3 待解决的数据结构不匹配

| 项目 | Edge 结构 | Hub 结构 | 解决方案 |
|------|-----------|-----------|------------|
| Run ID | `run_<hex>`（8 字节） | 基于 UUID | 以 Edge ID 为规范；Hub 存储映射 |
| Thread 与 Session | Thread 是任务分支 | Session 是 IM 房间 | 同步时将 Edge Thread 映射到 Hub Session |
| 事件格式 | EventEnvelope（带类型） | Frame（带类型） | 在 Hub 中继边界转换 |
| Agent 表示 | 适配器元数据 | AgentInstance + CustomAgent | 注册时将适配器元数据映射到 AgentInstance |

## 8. 共享代码依赖

```
@shared（app/shared/src/）
  ├── types.ts        → Edge REST 类型（HealthResponse、RunInfo、AgentInfo 等）
  ├── events.ts       → WebSocket 事件类型（EventEnvelope、所有 agent 事件载荷）
  ├── errors.ts       → 错误解析器（parseError、isErrorResponse）
  ├── tree.ts         → 消息树工具（buildTree、flattenTree）
  ├── diff.ts         → 旧 diff 引擎
  ├── diff/engine.ts  → 新 diff 引擎（从 OpenCode 移植）
  └── context/        → Token 估算、上下文预算分解

使用者：
  - app/desktop（完全依赖）
  - app/web（部分依赖，通过 webpack/tsconfig alias）
  - Edge 和 Hub 尚未使用（Go 代码有独立的类型定义）
```

**注意**：Edge 和 Hub 定义了自己的 Go 结构体，镜像了共享的 TypeScript 类型。它们之间没有代码生成。JSON 字段名通过人工保持一致（如 Go 中的 `json:"projectId"` 匹配 TypeScript 中的 `projectId`）。

## 9. 端口与地址

| 服务 | 默认地址 | 协议 | 备注 |
|---------|----------------|----------|-------|
| Desktop UI | `http://127.0.0.1:5173` | HTTP（Vite 开发） | 可通过 `vite.config.ts` 配置 |
| Edge Server | `http://127.0.0.1:3210` | HTTP + WS | 可通过 `--addr` 标志配置 |
| Hub Server | （可配置） | HTTP + WS | Gin 框架，配置在 `configs/` 中 |
| Agent CLI | 托管子进程 | stdio（stdin/stdout） | 由 Edge ProcessExecutor 启动 |

Desktop 配置（`app/desktop/src/config.ts`）：
```typescript
EDGE_URL = 'http://127.0.0.1:3210'
WS_URL   = 'ws://127.0.0.1:3210/v1/events'
```
