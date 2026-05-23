# AgentHub 全局路线图

最后更新：2026-05-24（M5 批次完成）

> **合并方向**：`feat/* → dev/delicious233 → master`
>
> 本文是 AgentHub 全部七层（Desktop / Edge / Hub / CI/CD / Testing / Documentation / Engineering Standards）的**唯一事实源**，取代各方向分散路线图。每项任务均引用审计报告具体发现，含文件路径、优先级和工期。

---

## 1. 当前状态总览

### 1.1 版本矩阵

| 组件 | 技术栈 | 当前能力 | 测试状态 | 覆盖/质量 |
|------|--------|---------|---------|----------|
| **Desktop** | React 19 + Tauri 2 + Zustand | 17 组件 / 7 hooks / 5 stores，P0-P3 全部完成，M3b 6/6，M4 8/8 | 12/12 测试文件通过 (123 tests) | 类型检查通过，ESLint + Prettier |
| **Edge Server** | Go (net/http + gorilla/websocket) | 3 种 AgentAdapter（Claude/Codex/OpenCode），24 种 NDJSON 消息，E2E 17/17 通过 | 整体 77.1%，12 个测试文件 | CI 硬阈值 75%，race/gosec/govulncheck 已接入 |
| **Hub Server** | Go (Gin + GORM + Redis + PG) | 40+ REST + WS 路由，15 migration，IM 全功能 | 仅 1/19 包有单元测试（auth 89.1%），26 集成测试 | CI 软阈值 40%（实际 CI 中 `-short` 跳过所有集成测试 → 有效覆盖 0%） |
| **Web** | React + Vite | feat/trump-webui 开发中 | 构建通过 | 不做硬性要求 |
| **CI/CD** | GitHub Actions | 4 job: go-edge / go-hub / frontend-desktop / frontend-web | 全绿 | gosec/govulncheck/race 已接入 |

### 1.2 已完成任务集合

| 批次 | 内容 | 完成项 | 日期 |
|------|------|:--:|------|
| **P0** | Edge 24 消息类型 + stdin 控制 + Desktop 实时打字 + ToolUseBlock | 27/27 | 2026-05 |
| **P1** | Markdown 渲染 + 多行输入 + Stop 按钮 + Token 用量 | 4/4 | 2026-05 |
| **P2** | 线程管理 + Diff 交互 + Agent 搜索 + 延迟指示器 | 4/4 | 2026-05 |
| **P3** | Bundle 分析 + React.lazy 拆分 + 权限事件管道 | 3/3 | 2026-05 |
| **M3b** | AgentHook 接口 + 消息树 + 安全管道 + Task dispatched + Context Budget + 流式增量解析 | 6/6 | 2026-05 |
| **M4** | Hub 骨架 + OpenCode E2E + Codex E2E + 环境隔离 + auth middleware + 权限门控升级 + 响应式布局 | 8/8 | 2026-05 |
| **M5** | **工程基础收敛**：Edge race/metrics/tests/P2 + Hub 安全/DI全5阶段/测试12包/P2 + Desktop 虚拟滚动/高亮/空状态/@mention/tablet + CI增强 | 27/27 | 2026-05-24 |

### 1.3 关键差距（来自审计报告 — M5 已全部修复）

> 以下 P0-P2 项在 M5 批次（2026-05-24）中全部修复，保留作为记录。

参考：`docs/review/edge-server-audit.md`、`docs/review/hub-server-audit.md`、`docs/review/hub-server-testing.md`、`docs/review/backend-engineering-standards.md`

| 严重度 | 层面 | 核心问题 | 报告索引 | 状态 |
|:--:|------|------|:--:|:--:|
| **P0** | Edge | ProcessExecutor race condition | edge S1 | ✅ M5 |
| **P0** | Edge | 零可观测性（无 Prometheus、health check 浅） | edge S2 | ✅ M5 |
| **P0** | Hub | JWT secret 硬编码，pprof :6060 无认证 | hub P0-1, P0-2 | ✅ M5 |
| **P0** | Hub | EventBus panic 静默丢弃 | hub P0-3 | ✅ M5 |
| **P0** | Hub | 零单元测试在 CI 中运行 | testing report | ✅ M5 |
| **P1** | Hub | 全局单例 `config.Cfg`/`repository.DB`/`cache.RDB` | hub P1-2, P1-3 | ✅ M5 |
| **P1** | Hub | go.mod 版本号错误 | standards 2.1 | ✅ M5 |
| **P1** | Hub | DeviceHandler 绕过 service 层 | hub P1-1 | ✅ M5 |
| **P1** | Edge | runnerctx 17.3%，control_protocol 0% | edge S3, S4 | ✅ M5 |
| **P1** | Desktop | 无虚拟滚动 | client.md P0 | ✅ M5 |
| **P2** | Hub | N+1 查询 + jsonb 无验证 + 无速率限制 | hub P2-1/2/3, P1-4 | ✅ M5 |

---

## 2. 架构愿景

### 2.1 三层架构图

```
┌────────────────────────────────────────────────────────────────────────┐
│                          AgentHub System                                │
│                                                                        │
│  ┌──────────────────┐         JWT/REST+WS       ┌──────────────────┐  │
│  │   Web Client     │ ────────────────────────►  │   Hub Server     │  │
│  │   (browser)      │                            │  (Gin, :8080)    │  │
│  └──────────────────┘                            │                  │  │
│                                                  │  Auth / IM /     │  │
│  ┌──────────────────┐   /client/ws               │  Contacts /      │  │
│  │   Desktop App    │ ◄────────────────────────► │  Notifications / │  │
│  │   (React+Tauri)  │   agent.dispatch (WS)      │  Agent Orch /    │  │
│  │                  │                            │  EventBus /      │  │
│  │  ┌────────────┐  │   /edge/* callbacks        │  WS Manager      │  │
│  │  │Hub Client  │  │ ────────────────────────►  │                  │  │
│  │  │(NEW!)      │  │                            │  DB: PostgreSQL  │  │
│  │  ├────────────┤  │                            │  Cache: Redis    │  │
│  │  │Edge Client │  │   /v1/events (WS)          └──────────────────┘  │
│  │  │(exists)    │  │   /v1/runs (REST)                                │
│  │  └────────────┘  │                                                  │
│  │        │         │   gorilla/websocket      ┌──────────────────┐    │
│  │        ▼         │   EventEnvelope           │   Edge Server    │    │
│  │   @shared/       │ ◄───────────────────────► │  (net/http,3210) │    │
│  │   events.ts      │                          │                  │    │
│  └──────────────────┘                          │  Runner Registry │    │
│                                                │  Agent Adapters  │    │
│  ┌──────────────────┐                          │  Process Executor│    │
│  │   CLI Tools      │   local exec             │  EventBus (seq)  │    │
│  │   (Claude Code,  │ ◄──────────────────────► │  In-Memory Store │    │
│  │    Codex,         │   stdin/stdout           │                  │    │
│  │    OpenCode)      │                          │  CORS: Trusted   │    │
│  └──────────────────┘                          │  Local Origins   │    │
│                                                └──────────────────┘    │
└────────────────────────────────────────────────────────────────────────┘
```

**双连接模式**：Desktop 同时连接 Edge（本地 Agent 事件）和 Hub（远程 IM/调度）。

### 2.2 数据流向

```
用户输入 → Desktop PromptInput
  → Edge POST /v1/runs (本地执行)
    → ProcessExecutor 启动 Agent CLI
      → AgentAdapter NDJSON/JSONL/JSON 解析
        → EventBus Publish
          → WebSocket /v1/events → Desktop EventLog
            → TanStack Query 缓存刷新 → Zustand UI 状态 → React 渲染

Hub 调度（远程）:
  Web /client → Hub agent.dispatch (WS)
    → Desktop HubClient 接收 → 翻译为 Edge StartRunRequest
      → Edge 执行 → Desktop 回调 Hub stream/done/fail
```

### 2.3 技术栈确认

| 层 | 选定技术 | 验证来源 |
|----|---------|---------|
| Desktop UI | React 19 + TypeScript + TailwindCSS + shadcn/ui | LobeHub/OpenCode 验证 |
| Desktop Shell | Tauri 2 (Rust) | OpCode 验证 |
| State Mgmt | TanStack Query (server) + Zustand (client) | Multica/Jean 验证 |
| Edge Server | Go + gorilla/websocket + NDJSON | 进程编排最优 |
| Hub Server | Go + Gin + GORM + Redis + PostgreSQL | LobeHub 对齐 |
| Protocol | WebSocket + NDJSON（主），REST JSON（辅） | Agent 流式最优 |
| Persistence | PostgreSQL (Hub), In-Memory + JSONL (Edge), SQLite + FTS5 (未来) | 离线优先 |

---

## 3. 实施路线图（按季度）

### 3.1 Q2 2026（当前 -- 工程基础收敛）

> **目标**：代码质量达标、测试覆盖完整、CI/CD 完善、消除全局状态。
> **参考**：`docs/review/edge-server-audit.md`、`docs/review/hub-server-audit.md`、`docs/review/hub-server-testing.md`、`docs/review/backend-engineering-standards.md`

---

#### 3.1.1 Edge Server 工程完善（~12 天）

> 参考：`docs/review/edge-server-audit.md` 全部 13 项发现

##### P0 -- 阻断级

- [ ] **S1: 修复 ProcessExecutor race condition** `[0.5d]`
  - 文件：`edge-server/internal/lifecycle/process_executor.go:86-119`
  - 方案：先创建 context 再原子插入 running map，删除 nil placeholder 模式
  - 风险：并发 Cancel 找不到 cancel func，导致僵尸进程
  - 验收：`go test -race ./internal/lifecycle/ -count=10` 零失败

- [ ] **S2: 接入 Prometheus metrics + 深度 health check** `[3d]`
  - 文件：新增 `edge-server/internal/metrics/metrics.go`，修改 `internal/httpserver/server.go`
  - 指标：`edge_runs_total`, `edge_run_duration_seconds`, `edge_active_runs`, `edge_ws_connections`, `edge_event_bus_depth`
  - Health check：验证 store 可读、runner registry 非空
  - 验收：`curl /v1/health` 返回 `{"status":"ok","checks":{"store":"ok","runners":3}}`

- [ ] **S3: runnerctx 包测试（17.3% → 80%）** `[1d]`
  - 文件：`edge-server/internal/runnerctx/context_budget_test.go`
  - 缺失测试：`ShouldCompact()`, `UsagePercent()`, `RunOutputStore` 全部方法, `EstimateTokens()`
  - 验收：`go test -cover ./internal/runnerctx/` 覆盖 >= 80%

- [ ] **S4: control_protocol 测试（0% → 80%）** `[1.5d]`
  - 文件：`edge-server/internal/adapters/control_protocol.go`
  - 缺失：5 个 `Write*` 函数的 JSON 输出验证 + `HandleControlRequest`/`handleCanUseTool` 测试
  - 修复：`json.Marshal` 错误不再 `_` 丢弃，返回 error
  - 验收：所有 Write* 函数输出合法 JSON，错误路径有覆盖

- [ ] **S5: 修复 OrchestratorAdapter NeedsStdin 返回 false** `[0.5d]`
  - 文件：`edge-server/internal/adapters/orchestrator.go:67-68`
  - 方案：改为 `return true`，或确保内层 adapter 永久 bypassPermissions
  - 风险：orchestrator 内部 Claude Code 无法通过 stdin 处理权限请求

##### P1 -- 高优先级

- [ ] **S10: 修复 FileStore persist 并发写竞态** `[1d]`
  - 文件：`edge-server/internal/store/file_store.go:162-169`
  - 方案：`persist()` 内部获取 `store.mu` 确保快照一致性
  - 验收：`go test -race ./internal/store/ -count=10` 零失败

- [ ] **S7: 环境变量配置支持** `[1d]`
  - 文件：`edge-server/cmd/agenthub-edge/main.go:91-134`
  - 方案：为每个 CLI flag 添加环境变量 fallback
  - 验收：`AGENTHUB_ADDR=:4321 go run ./cmd/agenthub-edge/` 使用环境变量值

- [ ] **S6: 抽取共享测试 helper** `[0.5d]`
  - 文件：新增 `edge-server/internal/lifecycle/testutil_test.go`
  - 方案：将 `nextEvent` 等 helper 从 `mock_executor_test.go` 移至专用文件
  - 验收：`go test ./internal/lifecycle/` 不变

##### P2 -- 改善

- [ ] **S8: busEventEmitter 移入 adapters 包** `[1d]`
  - 文件：`edge-server/internal/lifecycle/process_executor.go:414-449` → `internal/adapters/event_emitter.go`
- [ ] **S9: Orchestrator prompt 模板转义** `[0.5d]`
  - 文件：`edge-server/internal/adapters/orchestrator.go:72-95`
- [ ] **S11: CreateProject 返回区分已存在/新建** `[0.5d]`
  - 文件：`edge-server/internal/store/store.go`
- [ ] **S12: 清理空目录 `internal/edgeserver/`** `[0.5d]`
- [ ] **常量提取**：`maxConcurrentRuns: 5`, `channel buffer: 256`, `read buffer: 32*1024` 等魔数 → named constants `[0.5d]`

---

#### 3.1.2 Hub Server 工程完善（~18 天）

> 参考：`docs/review/hub-server-audit.md` 全部 P0-P3 发现 + `docs/review/hub-server-testing.md` 测试改进计划

##### P0 -- 阻断级

- [ ] **P0-1: JWT secret 环境变量化管理** `[1d]`
  - 文件：`hub-server/configs/config.yaml:20`, `hub-server/configs/config.docker.yaml:20`
  - 方案：仅从环境变量 `AGENTHUB_JWT_SECRET` 读取，dev 环境硬编码值拒绝启动
  - 修复：`hub-server/internal/config/config.go` -- Load 阶段校验
  - 验收：未设置环境变量时启动 panic

- [ ] **P0-2: Admin pprof 绑定 localhost + 认证** `[0.5d]`
  - 文件：`hub-server/cmd/server-hub/main.go:294-300`
  - 方案：绑定 `127.0.0.1:6060`（非 `0.0.0.0`），添加 basic auth 中间件
  - 验收：外部 IP 无法访问 `/debug/pprof/`

- [ ] **P0-3: EventBus panic 记录日志** `[0.5d]`
  - 文件：`hub-server/internal/service/eventbus.go:58-64`
  - 方案：`recover()` 处添加 `slog.Error("eventbus panic", "stack", debug.Stack())`，增加 Prometheus counter
  - 验收：模拟 panic handler，确认日志输出完整 stack trace

- [ ] **修复 go.mod 版本号** `[0.5d]`
  - 文件：`hub-server/go.mod:3` -- `go 1.25.6` → `go 1.24.0`
  - 文件：`hub-server/deployments/Dockerfile` -- 同步 Go 版本
  - 验收：`go build ./...` 和 `go test ./...` 正常执行

##### P1 -- 高优先级架构修复

- [ ] **P1-1: 创建 DeviceService 消除 handler 直连 DB** `[1d]`
  - 文件：`hub-server/internal/handler/device.go:15-17`
  - 新增：`hub-server/internal/service/device.go` -- `DeviceService` struct + methods
  - 验收：`DeviceHandler` 只依赖 `*service.DeviceService`

- [ ] **P1-2: 消除 config.Cfg 全局单例** `[2d]`
  - 文件：`hub-server/internal/config/config.go:63`
  - 影响面：`middleware/auth.go:31`, `service/auth.go:87-88`, `service/attachment.go:65`, `router/router.go:31`
  - 方案：所有受影响模块通过构造函数接受 `*config.Config`
  - 验收：不再有任何文件直接引用 `config.Cfg`

- [ ] **P1-3: 消除 repository.DB 全局单例** `[1d]`
  - 文件：`hub-server/internal/repository/db.go:14`
  - 方案：所有 service/handler 通过构造函数接受 `*gorm.DB`
  - 验收：移除 `var DB *gorm.DB`，所有引用替换为参数传递

- [ ] **P1-4: 实现速率限制中间件** `[1d]`
  - 新增：`hub-server/internal/middleware/rate_limit.go`
  - 方案：基于 Redis 的 per-IP token bucket，登录 5 req/min，注册 3 req/min
  - 验收：`curl` 连续请求被 429 拒绝

- [ ] **P1-5: 修复 JSON 手工构建注入风险** `[0.5d]`
  - 文件：`hub-server/internal/service/message.go:94-95`
  - 方案：`strings.ReplaceAll` → `json.Marshal(map[string]string{"text": req.Content})`
  - 验收：包含特殊字符（换行、反斜杠、引号）的消息正确存储

- [ ] **P1-6: 请求超时中间件** `[0.5d]`
  - 新增：`hub-server/internal/middleware/timeout.go`
  - 方案：Gin middleware 包装 `context.WithTimeout(15s)`，上传端点 30s
  - 验收：模拟慢查询 20s 后返回 504

##### P2 -- 中等严重度

- [ ] **P2-1/P2-2: 修复 N+1 查询** `[1d]`
  - 文件：`hub-server/internal/service/contact.go:217-240` (ListContacts), `:149-172` (ListFriendRequests)
  - 方案：收集所有 friend ID → 单次 `WHERE id IN (?)` → 构建 map

- [ ] **P2-5: CancelTask session_id 错误** `[0.5d]`
  - 文件：`hub-server/internal/service/agent.go:269-274`
  - 方案：通过 `AgentInstance` 查找真实 `SessionID`，而非使用 `AgentInstanceID`

- [ ] **P2-8: Agent 消息生成 ClientMsgID** `[0.5d]`
  - 文件：`hub-server/internal/service/agent.go:312-318, 364-370`
  - 方案：`uuidv7.Must()` 生成 `client_msg_id`
  - 风险：当前 `NOT NULL` 约束会拒绝不含 `client_msg_id` 的 INSERT

- [ ] **P2-9: UpsertDevice ON CONFLICT 字段修正** `[0.5d]`
  - 文件：`hub-server/internal/repository/device.go:10-14`
  - 方案：`ON CONFLICT (id)` → `ON CONFLICT (user_id, device_type)`

- [ ] **P2-10: WebSocket 丢帧告警 + 计数** `[0.5d]`
  - 文件：`hub-server/internal/handler/ws.go:143-147`, `hub-server/internal/ws/manager.go:164-167`
  - 方案：send channel 满时记录 WARN 日志 + Prometheus counter `ws_dropped_frames_total`

- [ ] **P2-3: jsonb 字段类型校验** `[0.5d]`
  - 文件：`hub-server/internal/model/custom_agent.go:17-20`
  - 方案：`CapabilityTags`, `ToolWhitelist`, `ModelParams` 使用 `json.RawMessage` 或 handler 层 JSON 校验

- [ ] **P2-4: FailWithMessage HTTP 状态守卫** `[0.5d]`
  - 文件：`hub-server/internal/handler/response.go:34-39`
  - 方案：添加 `if e.HTTPStatus == 0 { e = errcode.ErrInternal }` 守卫

- [ ] **P2-7: Agent 消息 seq 分配走 Redis 缓存** `[0.5d]`
  - 文件：`hub-server/internal/service/agent.go:326-333`
  - 方案：`HandleTaskStream`/`HandleTaskDone` 使用 `allocateSeq`（Redis INCR + DB fallback）

- [ ] **P2-6: WebSocket writeLoop 添加 panic recovery** `[0.5d]`
  - 文件：`hub-server/internal/handler/ws.go:47-57`
  - 方案：`defer conn.W.Close(...)` + `defer recover()` + 日志

##### P3 -- 低严重度

- [ ] **P3-3/P3-6: 合并双 cmd 入口** `[1d]`
  - 文件：`hub-server/cmd/agenthub-hub/main.go` → 合并到 `cmd/server-hub/main.go` 或明确文档化
- [ ] **P2-11: listFriendRequests 用户查找失败时记录日志** `[0.5d]`
- [ ] **P3-1: 路由参数命名统一** `[0.5d]`
- [ ] **P3-2: 魔数常量化**（50/50/24h/5min/1024/64） `[1d]`
- [ ] **P3-4: 创建 Workspace GORM model** `[0.5d]`
- [ ] **P3-5: gofmt 格式修复** `[0.5d]`

##### 测试基础设施（Phase 1-2，来自 testing audit）

- [ ] **jwtutil 单元测试（0% → 100%）** `[1.5d]` `[P0]`
  - 新增：`hub-server/internal/jwtutil/jwt_test.go`
  - 覆盖：`GenerateAccessToken`, `ParseToken`, `GenerateRefreshToken`, `HashRefreshToken`
  - 验收：`go test -cover ./internal/jwtutil/` >= 90%

- [ ] **cache 单元测试（0% → 80%）** `[1d]` `[P0]`
  - 新增：`hub-server/internal/cache/data_test.go`
  - 覆盖：`GetOrLoad` cache hit/miss, singleflight 去重, `Invalidate`, `AllocateSeq`
  - 验收：mock Redis 测试所有缓存路径

- [ ] **middleware 单元测试（0% → 80%）** `[1d]` `[P1]`
  - 新增：`hub-server/internal/middleware/` 各 middle 的 `*_test.go`
  - 覆盖：auth skip path, device type gating, access log fields

- [ ] **service 层单元测试（0% → 60%）** `[3d]` `[P1]`
  - 新增：`hub-server/internal/service/auth_test.go`, `session_test.go`, `message_test.go`, `eventbus_test.go`
  - 方案：`go-sqlmock` mock DB 层，table-driven tests
  - 验收：核心服务逻辑（注册/登录/创建会话/发送消息/召回）有独立单元测试

- [ ] **eventbus panic recovery 测试** `[0.5d]` `[P1]`
  - 新增：`hub-server/internal/service/eventbus_test.go`
  - 验证：handler panic 后 logger 记录 stack + counter 递增

- [ ] **test isolation（per-test cleanup）** `[1d]` `[P1]`
  - 文件：`hub-server/tests/setup_test.go`
  - 方案：`cleanDB()` 在 `t.Cleanup` 中调用，确保测试不互相污染

- [ ] **Hub 覆盖率阈值 40% → 60%（硬阻断）** `[1d]` `[P1]`
  - 文件：`.github/workflows/checks.yml` go-hub job
  - 方案：`continue-on-error` 改为 `exit 1`；低于 60% 时 CI 失败

---

#### 3.1.3 Desktop 基础打磨（~14 天）

> 参考：`docs/roadmaps/client.md` Phase 0（完整 12 项任务）

- [ ] **P0-1: 状态架构重构** `[5d]`
  - 引入 TanStack Query：新建 `app/desktop/src/api/queryClient.ts`, `threadQueries.ts`, `runQueries.ts`
  - 改造 `useChatMessages.ts`：事件 → `queryClient.invalidateQueries`
  - 改造 `runStore.ts`：删除服务端数据，仅保留 `isStreaming` 等客户端标志
  - RunState 正式状态机：`NO_TASK → RUNNING ↔ STREAMING → WAITING_FOR_INPUT / IDLE / COMPLETED / FAILED / CANCELLED`
  - Zustand selector 粒度优化：所有 store 使用 `subscribeWithSelector`
  - 参考：Multica TanStack Query+Zustand 分离模式，Roo-Code AgentLoopState
  - 实施详情：`docs/design/client-p0-architecture.md#p0-1`

- [ ] **P0-2: 输入体验修复** `[4d]`
  - 非受控输入迁移：`PromptInput.tsx` `useState` → `useRef + DOM`（0.5d 快赢）
  - 草稿持久化：新建 `useInputDraft.ts`，localStorage 按 threadId 存储（0.5d 快赢）
  - 工具调用循环检测：`useChatMessages.ts` 签名去重，3 次警告 5 次拦截
  - 文件读取去重缓存：`Map<path, {readCount, mtime}>` 缓存

- [ ] **P0-3: 连接健壮性** `[3d]`
  - WebSocket 心跳：10s ping/pong + 15s 超时检测（0.5d 快赢）
  - 离线消息队列：新建 `offlineQueue.ts`，断线入队 localStorage，重连后按序发送
  - 传输层抽象：新建 `transport.ts` Transport 接口，WebSocketTransport / MockTransport 实现

- [x] **P0-4: 性能基础** `[2d]`
  - ✅ 虚拟滚动：`@tanstack/react-virtual`（M5 完成，`ChatView.tsx` + `useAutoScroll.ts`）
  - ✅ App.tsx 视图注册表拆分（`viewRegistry.ts` + `Slot` 模式，651→531 行）

##### Quick Wins（<1 天 / 项）

- [x] QW-1: 非受控输入迁移（✅ M5 `useRef` 完成）
- [x] QW-2: 草稿持久化（✅ M5 `useInputDraft.ts` 完成）
- [x] QW-3: WebSocket 心跳（✅ M5 `eventClient.ts` 完成）
- [x] QW-4: Zustand selector 粒度优化（✅ M5 `useShallow` 完成）
- [x] QW-5: Toast 反馈（✅ M5 `Toast.tsx` + `toastStore.ts` Zustand 完成）

---

#### 3.1.4 CI/CD 流水线升级（~5 天）

> 参考：`docs/review/backend-engineering-standards.md` 第 3 节（CI/CD Pipeline）

##### 已接入（近期 commit `1bbe365` 完成）

- [x] Edge: `-race` 竞态检测
- [x] Edge: `gosec` 安全扫描
- [x] Edge: `govulncheck` 漏洞扫描
- [x] Hub: `-race` 竞态检测
- [x] Hub: `gosec` 安全扫描
- [x] Hub: `govulncheck` 漏洞扫描
- [x] 提交信息格式检查（PR only）
- [x] Edge 覆盖率 75% 硬阻断 + per-package 最低阈值

##### 待实施

- [ ] **Hub 覆盖率阈值 40% → 60%（硬阻断）** `[0.5d]`
  - 文件：`.github/workflows/checks.yml:133-141`
  - 方案：`echo "::warning"` → `echo "::error"` + `exit 1`

- [ ] **Hub Server golangci-lint 项目级配置** `[1d]`
  - 新增：`hub-server/.golangci.yml`
  - 方案：以 `edge-server/.golangci.yml` 为基线，启用 `gosec`，添加 hub 特有排除项

- [ ] **密钥检测（gitleaks）** `[0.5d]`
  - 新增：`.github/workflows/checks.yml` 添加 gitleaks job
  - 验收：误提交 `.env` / API key 时 CI 阻断

- [ ] **Docker 镜像构建 + 推送** `[1d]`
  - 新增：`.github/workflows/checks.yml` 添加 docker job
  - 文件：`hub-server/deployments/Dockerfile`
  - 方案：PR 时构建验证，push master 时推送到 ghcr.io

- [ ] **Benchmark 回归检测** `[1d]`
  - 新增：`edge-server/internal/events/bench_test.go`, `hub-server/internal/service/bench_test.go`
  - 方案：Bus.Publish、NDJSON 解析、JWT 验证、消息写入性能基准
  - CI：`go test -bench=. -benchtime=1s` 检测回归

- [ ] **多平台构建验证（Windows + macOS）** `[1d]`
  - 方案：添加 matrix build，验证跨平台编译

---

#### 3.1.5 文档体系完善（~4 天）

> 参考：`AGENTS.md` 文档规则 + hub-server-audit 文档准确性矩阵

- [ ] **API 文档自动生成** `[1.5d]`
  - 方案：Hub Server 接入 `swaggo/swag`，从代码注解生成 `hub-server/api/swagger.yaml`
  - 验收：`http://localhost:8080/swagger/index.html` 可交互浏览

- [ ] **架构决策记录 (ADR)** `[1d]`
  - 新建：`docs/adr/` 目录，至少 5 篇关键决策记录
  - 内容：Hub-Edge 双层 vs 单体、WebSocket vs SSE、NDJSON vs protobuf、Zustand vs Redux、Worktree 隔离方案
  - 验收：每篇 ADR 含背景、决策、后果、备选方案

- [ ] **文档与代码一致性修复** `[1d]`
  - Hub Server 准确性矩阵（`docs/review/hub-server-audit.md` 第 10 节）31 项对比中 15 项不一致
  - 修复关键项：消息撤回 2min vs 5min、CORS/Rate-limit middleware 文档声明但不存在
  - 验收：移除文档中未实现的端点声明

- [ ] **Edge Server 本地文档路径修复** `[0.5d]`
  - 文件：`edge-server/README.md:36-38` 引用的 `docs/` 路径指向 monorepo 根

---

### 3.2 Q3 2026（功能完善 -- 产品可用）

> **目标**：IM 功能完整、Agent 可观测性、多 Agent 协作、Desktop 竞争 UX

---

#### 3.2.1 Hub-Edge-Desktop 集成（~19 天）

> 参考：`docs/roadmaps/integration.md` 六阶段计划

##### 阶段 1: Desktop Hub 认证 + REST 客户端 `[3d]`

- [ ] 新建 `app/desktop/src/api/hubClient.ts` -- Hub REST 客户端
- [ ] 新建 `app/desktop/src/api/hubAuth.ts` -- JWT 令牌管理（登录/刷新/存储/登出）
- [ ] 修改 `app/desktop/src/config.ts` -- 添加 `HUB_URL`
- [ ] StatusBar Hub 连接状态指示器
- [ ] 验证：Desktop 可登录 Hub、查看用户信息、维持会话

##### 阶段 2: Hub WebSocket 客户端 `[2d]`

- [ ] 新建 `app/desktop/src/api/hubWS.ts` -- 含 auth 帧协议的 Hub WS 客户端
- [ ] 新建 `app/shared/src/hubEvents.ts` -- Hub WS 事件类型定义
- [ ] 创建 `useHubEventStream` hook
- [ ] 验证：Desktop 接收 `message.new`, `agent.dispatch`, `notification.new` 事件

##### 阶段 3: Agent 任务桥接 `[4d]`

- [ ] 新建 `app/desktop/src/hooks/useHubIntegration.ts` -- Hub-Edge 桥接核心
- [ ] 监听 `agent.dispatch` → 解析 dispatchPayload → Edge `StartRunRequest`
- [ ] Edge `run.agent.text_delta` → Hub `streamTask(taskId, content)`
- [ ] Edge `run.agent.result` → Hub `doneTask()` 或 `failTask()`
- [ ] 映射 `runId` ↔ `taskId` 双向追踪
- [ ] 启动时注册设备 `POST /edge/devices/register`
- [ ] 验证：Web 触发 Agent → Desktop 收到调度 → Edge 运行 → Web 聊天中看到 Agent 消息

##### 阶段 4: Desktop IM UI `[5d]`

- [ ] 新建会话列表侧边栏（来源：`docs/reference/cross-comparison/02-im-ux.md` 2.2 节）
- [ ] 新建 IM 消息视图（聊天气泡 + Agent/User 区分 + Authority 色带）
- [ ] 新建会话消息输入（文本/代码/附件上传）
- [ ] 新增加联系人管理（搜索/添加好友/屏蔽）
- [ ] 新增通知浮层（好友请求/Agent 完成/@提及）
- [ ] 新增在线状态指示器（从 device 事件获取）
- [ ] 增量消息同步（REST `/sync` + WS `message.new`）

##### 阶段 5: 设备与同步强化 `[3d]`

- [ ] 消息同步对账（基于 seq，处理缺口）
- [ ] 离线任务队列（Desktop 离线后重连拉取待处理）
- [ ] 优雅断开/重连（清洗认证状态 + 重新握手）
- [ ] 设备能力上报（支持哪些 Agent 类型）
- [ ] 令牌刷新鲁棒性（WS 收到 401 时重新认证）

##### 阶段 6: Edge Server 强化 `[2d]`

- [ ] 并发 run 验证（每线程一个 run）
- [ ] Run 清理（过期 run、资源限制）
- [ ] 可选：重启后 run 历史持久化
- [ ] Health check 包含 runner 状态

---

#### 3.2.2 Desktop 竞争 UX（~15 天）

> 参考：`docs/roadmaps/client.md` Phase 1（12 项任务）

##### P1-1: 多 Agent 聊天 `[5d]`

- [ ] 消息树形数据模型（`buildTree/flattenTree` 函数，来源：LibreChat `buildTree()`）
- [ ] 子 Agent 内联视图（`SubAgentCard.tsx`，处理 `child_spawn/child_result` 事件）
- [ ] 消息 Fork 支持（从任意消息分叉新线程，4 种模式：DIRECT_PATH / INCLUDE_BRANCHES / TARGET_LEVEL / DEFAULT）
- [ ] SiblingSwitch 分支导航（来源：LibreChat `SiblingSwitch.tsx`）

##### P1-2: 富文本输入 `[4d]`

- [ ] @提及 + 自动补全（`@agent` / `@file` / `@thread`，来源：Jean `ChatInput.tsx:316-475`）
- [ ] 斜杠命令系统（`/model`, `/clear`, `/retry`, `/fork` 等）
- [ ] 模型别名解析（"sonnet" → 完整 model ID）

##### P1-3: Agent 可观测性 `[3d]`

- [ ] Token 用量实时更新（流式过程中实时更新 ContextUsage 条）
- [ ] 工具调用时间线面板（`ToolTimeline.tsx`）
- [ ] Agent 任务列表（`TaskList.tsx`）
- [ ] Agent Live Card（来源：Multica，显示 Agent 实时状态）

##### P1-4: 线程管理升级 `[3d]`

- [ ] 按项目+日期分组（Today / Yesterday / Older，来源：LibreChat `groupConversationsByDate()`）
- [ ] 线程状态标记（运行中/错误/未读）
- [ ] 线程归档
- [ ] 快捷键面板（`ShortcutPanel.tsx`，来源：CloudCLI command palette）

---

#### 3.2.3 多 Agent 协作基础设施（~12 天）

> 参考：`docs/reference/cross-comparison/00-synthesis.md` + `docs/reference/cross-comparison/10-best-practices-playbook.md`

- [ ] **A3: Sub-agent spawn handler + Agent registry** `[5d]` `[P0]`
  - 新增：`edge-server/internal/adapters/agent_registry.go` -- `map[string]*AgentInstance` + `sync.RWMutex`
  - 实现：`reserve_spawn_slot()` Go `atomic.Int32`，cycle detection（祖先 Set + 深度限制）
  - 参考：Codex `registry.rs:22-26` + LibreChat `run.ts:654-668`

- [ ] **A2: Agent 正式状态机** `[5d]` `[P0]`
  - 新增：`edge-server/internal/adapters/agent_state.go`
  - 状态：`idle | running | waiting_for_human | done | error | interrupted`
  - 包含 `stepCount`, `maxSteps`, `forceFinish`, `pendingToolsCalling`, `pendingHumanPrompt`
  - 参考：LobeHub `state.ts:20-147` + Roo-Code `agent-state.ts:48-108`

- [ ] **A6: Agent 间消息队列 (mailbox)** `[2d]` `[P0]`
  - 新增：`edge-server/internal/adapters/agent_mailbox.go`
  - 方案：per-agent buffered channel，支持 Agent 间异步通信
  - 参考：Codex `input_queue.rs:25-88`

---

### 3.3 Q4 2026（差异化 -- 超越竞品）

> **目标**：AgentHub 独有功能，构建竞争壁垒

---

#### 3.3.1 差异化功能

- [ ] **Authority 可视化** `[3d]`
  - 来源：`docs/reference/cross-comparison/02-im-ux.md` 3.2 节
  - 内容：每条消息色带标识来源（蓝=Hub / 绿=Edge / 橙=Hybrid）
  - 消息树用连线颜色区分 hub-owned / edge-owned / hybrid 三种模式
  - AgentHub 独有能力 -- 四个竞品均无

- [ ] **多 Agent 产物对比** `[3d]`
  - 同一 prompt 下不同 Agent 产出 side-by-side 展示
  - 产物溯源链路：artifact → tool_use → message → session → Agent

- [ ] **Agent 市场 / 发现** `[4d]`
  - Agent 模板分享（CustomAgent 配置包）
  - Agent 能力标签搜索（capability_tags 过滤）
  - 使用次数 + 评分排序

- [ ] **Plugin 系统（6 Slot）** `[5d]`
  - 来源：CloudCLI Manifest+RPC + Claude Code Hook 模式
  - Slot: `tab`, `sidebar`, `toolbar`, `overlay`, `artifact-renderer`, `command`
  - 插件注册、发现、生命周期管理

- [ ] **进阶 Diff / 代码审查** `[5d]`
  - Side-by-side diff 视图
  - 行级评论系统
  - Diff 语法高亮（Shiki）
  - 来源：Claude Code Viewer `DiffViewer.tsx` + `CommentButton/CommentForm`

- [ ] **Agent 通信图可视化** `[3d]`
  - D3/ReactFlow 绘制 Agent 间消息传递关系
  - 来源：Codex AgentTree 可视化

- [ ] **FTS5 全文搜索** `[3d]`
  - 来源：Claude Code Viewer FTS5 trigram + BM25
  - 跨 session/thread/message 搜索 + 页内高亮

- [ ] **Checkpoint/Undo（Turn 边界）** `[4d]`
  - 来源：OpCode content-addressable storage
  - 内容：SHA-256 文件快照 + zstd 压缩 + Timeline 树结构
  - 支持：restore / fork / diff between checkpoints

---

#### 3.3.2 性能与可靠性

- [ ] **React.memo 全面审计 + 代码块懒加载** `[1d]`
- [ ] **WCAG 2.1 AA a11y 审计** `[1d]`
- [ ] **E2E 测试覆盖（Playwright + Tauri driver）** `[2d]`
- [ ] **消息同步压力测试**（1000 消息 / 100 并发会话）`[1d]`

---

## 4. 验收标准

### 4.1 每阶段验收命令

#### Q2 验收

```powershell
# Edge Server
go test ./... -count=1 -short -race -coverprofile=coverage.out ./...
go tool cover -func=coverage.out | grep total          # >= 80%
go run golang.org/x/vuln/cmd/govulncheck@latest ./...  # 零高危漏洞
go run github.com/securecodewarrior/gosec/v2/cmd/gosec@latest ./...  # 零高危

# Hub Server
go test ./... -count=1 -short -race -coverprofile=coverage.out ./...
# 不少于 5 个包有独立单元测试
go tool cover -func=coverage.out | grep total          # >= 60%

# Desktop
pnpm test:run                                          # 全部通过
pnpm typecheck                                         # 零错误

# 全链路 smoke
.\scripts\integration-e2e.ps1                          # 全绿
```

#### Q3 验收

```powershell
# Hub-Edge-Desktop 集成
# Web 触发 Agent → Desktop 收到调度 → Edge 运行 → Web 聊天看到 Agent 消息
.\scripts\integration-e2e.ps1 -IncludeIM

# Desktop IM UI 完整流程
# 登录 → 创建会话 → 添加 Agent → 发送消息 → 看到 Agent 响应 → 消息树分支
```

#### Q4 验收

```powershell
# 差异化功能
# Authority 可视化正确显示蓝/绿/橙色带
# 多 Agent 对比面板可同时展示两个 Agent 对同一文件的修改
# Agent 市场可搜索、安装、使用自定义 Agent
# FTS5 搜索在 1000 会话中 100ms 内返回结果
# Checkpoint 创建 + 恢复 < 2s
```

### 4.2 性能基准

| 指标 | 目标 | 测量方式 |
|------|:--:|---------|
| Edge run 启动延迟（含 CLI 冷启动） | < 3s | `time curl -X POST /v1/runs` |
| WebSocket 事件首次到达延迟 | < 200ms | `EventEnvelope.timestamp` diff |
| Desktop 首屏渲染 | < 1.5s | Lighthouse Performance |
| 消息流式渲染帧率 | 60fps | React DevTools Profiler |
| 虚拟滚动 10000 条消息 | < 100MB 内存 | Chrome Memory Profiler |
| Hub 消息发送延迟 | < 500ms (P99) | Prometheus histogram |
| Hub 并发 WebSocket 连接 | 1000+ | 压力测试 |

### 4.3 安全审计通过标准

- [ ] `gosec`：零 HIGH/MEDIUM
- [ ] `govulncheck`：零可利用漏洞
- [ ] `gitleaks`：零密钥泄露
- [ ] JWT secret 仅环境变量（代码中无硬编码）
- [ ] 速率限制生效（登录/注册 429 拒绝）
- [ ] pprof/metrics 端口仅 localhost 绑定
- [ ] 23 项安全检查管道覆盖 `rm -rf /`, `curl|bash`, `chmod 777`, Command Substitution, Obfuscated Flags, IFS Injection

---

## 5. 风险与依赖

### 5.1 外部依赖

| 依赖 | 影响范围 | 风险 | 缓解 |
|------|---------|------|------|
| Claude Code CLI 可用性 | Edge adapter | Anthropic 变更 SDK 协议 | AgentAdapter 抽象层隔离，多 CLI 支持降级 |
| Codex CLI API key | Edge adapter | 配额/封禁 | 多 provider fallback (CC Switch) |
| OpenAI API 额度 | OpenCode adapter | 不可用 | 本地模型（暂无计划）|
| Redis 可用性 | Hub Server | Seq 分配失败 | `allocateSeq` DB fallback 已实现 |
| PostgreSQL 可用性 | Hub Server | 全部服务中断 | Docker Compose 高可用部署 |
| GitHub Actions 配额 | CI/CD | 流水线不触发 | 本地验证脚本兜底 |

### 5.2 技术风险

| 风险 | 概率 | 影响 | 缓解 |
|------|:--:|:--:|------|
| Desktop 双 WebSocket 连接管理复杂度 | 中 | 连接断开时桥接失效 | useHubIntegration hook 追踪双连接状态 |
| TanStack Query 迁移数据丢失 | 低 | 线程/运行列表空白 | 渐进迁移，保留 Zustand 读路径直到验证通过 |
| Hub-Edge 事件翻译遗漏 | 中 | Agent 任务结果丢失 | 映射表测试覆盖所有事件类型 |
| 全局状态消除引入回归 bug | 中 | Hub Server 不稳定 | 每步 commit + 全量集成测试 |
| Orchestrator 真正 spawn Agent 导致循环 | 中 | 资源耗尽 | 循环检测 (ancestors Set + depth limit) |
| Checkpoint 磁盘空间增长 | 低 | 磁盘满 | zstd 压缩 + 定期 GC 策略 |

### 5.3 人员与进度

| 方向 | 负责 | 当前分支 | Q2 关键交付 |
|------|------|---------|-----------|
| 客户端 (Desktop + Edge) | Delicious233 | `dev/delicious233` | Edge 审计修复 + Desktop Phase 0 + 集成阶段 1-6 |
| 后端 (Hub Server) | Johnny | `dev/delicious233` | Hub 审计 P0-P1 修复 + 测试基础设施建设 |
| Web 前端 | Trump | `feat/trump-webui` | Web UI 功能完善 → `dev/delicious233` 合并 |

---

## 6. 工作量汇总

| 季度 | 模块 | 任务数 | 工期 |
|------|------|:--:|:--:|
| **Q2** | Edge Server 工程完善 | 15 | ~12d |
| | Hub Server 工程完善 | 25+ | ~18d |
| | Desktop 基础打磨 | 12 | ~14d |
| | CI/CD 流水线升级 | 6 | ~5d |
| | 文档体系完善 | 4 | ~4d |
| | **小计** | **62+** | **~53d** |
| **Q3** | Hub-Edge-Desktop 集成 | 6 阶段 | ~19d |
| | Desktop 竞争 UX | 12 | ~15d |
| | 多 Agent 协作 | 3 | ~12d |
| | **小计** | **~21** | **~46d** |
| **Q4** | 差异化功能 | 8 | ~31d |
| | 性能与可靠性 | 4 | ~5d |
| | **小计** | **12** | **~36d** |
| **总计** | | **~95** | **~135d** |

### 优先级速查

| 优先级 | Q2 任务数 | Q3 任务数 | Q4 任务数 | 代表项 |
|:--:|:--:|:--:|:--:|------|
| **P0** | 20 | 6 | 0 | Edge race fix, JWT env, 单元测试, TanStack Query |
| **P1** | 20 | 10 | 2 | 全局状态消除, 速率限制, IM UI, 消息树 |
| **P2** | 18 | 5 | 10 | N+1 查询, jsonb 校验, Diff 增强, Checkpoint |

---

## 7. 不构建的内容

| 决定 | 原因 |
|------|------|
| 不用 protobuf（保持 JSON/NDJSON） | 当前规模 JSON 足够，Agent CLI 原生协议均为 JSON |
| 不用自研编辑器 | textarea 够用，P1 MentionInput 是轻量增强 |
| 不用 Service Worker 离线 | Tauri 原生离线能力替代 |
| 不构建多窗口 | 推迟到 Q1 2027+ |
| 不引入额外状态库 | Zustand + TanStack Query 覆盖全部场景 |
| 不构建插件系统（Q2-Q3） | 先完成核心 UX 打磨，Q4 启动 |
| Canvas-first 编排（Langflow/Flowise 模式） | AgentHub IM-native，画布仅辅助视图 |
| Docker 唯一沙箱 | 本地桌面过度设计，Worktree 更轻量 |
| 中心化服务器权威（Multica 模式） | Hub-Edge 双层，Edge 本地自治 |
| CRDT/OT 实时同步 | Agent 非字符级协同编辑 |
| 固定 YAML 拓扑（ChatDev 模式） | 限制 Agent 动态调度 |

---

## 8. 参考文档索引

| 类别 | 文档 | 用途 |
|------|------|------|
| **审计** | `docs/review/edge-server-audit.md` | Edge 13 项发现（S1-S13） |
| | `docs/review/hub-server-audit.md` | Hub 22 项发现（P0-1 ~ P3-9） |
| | `docs/review/hub-server-testing.md` | Hub 测试覆盖率 + 改进计划 |
| | `docs/review/backend-engineering-standards.md` | 工程标准评分 + Top 10 改进 |
| **路线图** | `docs/roadmaps/client.md` | Desktop Phase 0/1/2 详细任务 |
| | `docs/roadmaps/integration.md` | Hub-Edge-Desktop 集成 6 阶段 |
| **参考** | `docs/reference/cross-comparison/00-synthesis.md` | 18 项目全景分析 |
| | `docs/reference/cross-comparison/10-best-practices-playbook.md` | 最佳实践索引 |
| | `docs/reference/cross-comparison/02-im-ux.md` | IM/UX 设计建议 |
| | `docs/inbox/RESEARCH-SUMMARY-2026-05-24.md` | 竞品研究总结 |
| **设计** | `docs/design/client-p0-architecture.md` | Desktop P0 实施细节 |
| | `docs/design/client-reference-patterns.md` | Desktop 参考模式 |
| **架构** | `docs/system-architecture.md` | 系统架构文档 |
| | `docs/product-requirements.md` | 产品需求文档 |
| | `docs/implementation-guide.md` | 功能实现文档 |
| **规则** | `AGENTS.md` | 项目开发规则和约定 |
