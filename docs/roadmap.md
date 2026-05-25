# AgentHub 全局路线图

最后更新：2026-05-25（M8 审计批次规划 — 129 Issues 分 8 批）

> **合并方向**：`feat/* → dev/delicious233 → master`
>
> 本文是 AgentHub 全部七层（Desktop / Edge / Hub / CI/CD / Testing / Documentation / Engineering Standards）的**唯一事实源**，取代各方向分散路线图。每项任务均引用审计报告具体发现，含文件路径、优先级和工期。

---

## 1. 当前状态总览

### 1.1 版本矩阵

| 组件 | 技术栈 | 当前能力 | 测试状态 | 覆盖/质量 |
|------|--------|---------|---------|----------|
| **Desktop** | React 19 + Tauri 2 + Zustand + TanStack Query | viewRegistry 9视图、IM UI、AuthPage、RunState 状态机、传输层抽象 | 519 tests（34 files） | tsc 严格模式，ESLint + Prettier |
| **Edge Server** | Go (net/http + gorilla/websocket) | 3 Adapter、24 NDJSON、Orchestrator P1-P2、Prometheus、E2E 19/19 API | 13/13 包（530 funcs） | CI 硬阈值 75%，race/gosec/govulncheck |
| **Hub Server** | Go (Gin + GORM + Redis + PG) | DI 架构、13 包有测试、CORS+RateLimit+BodyLimit 中间件链、21 migrations | 13/13 包（355 funcs），repository 75.5% | CI 硬阈值 40%，golangci-lint/gitleaks |
| **Web** | React + Vite | feat/trump-webui 已合入主线（2026-05-25 归档） | 构建通过 | 不做硬性要求 |
| **CI/CD** | GitHub Actions | 8 job: go-edge/go-hub/benchmark/docker/cross-build/frontend/validate/gitleaks | 全绿 | race/gosec/govulncheck/覆盖率硬阻断 |
| **官网** | Next.js 16 + Tailwind v4 | hub.vectorcontrol.tech — LiveStats + ConnectAgent | 14/20 tests | 静态导出，nginx on hk2 |
| **部署** | Docker Compose on hk2 | PG16 + Redis7 + Hub Server（独立实例，不与 AIhub 共用） | ✅ 生产运行 | nginx 反代 api.hub.vectorcontrol.tech:80→8090 |
| **Infra** | Docker + Cloudflare DNS | docker-compose.prod.yml、deploy.sh、generate-secrets.sh、Caddyfile | ✅ | .env.production gitignored，密钥不进仓库 |

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
| **M6** | **生产部署**：Docker Compose 生产配置 + hk2 部署 + nginx 反代 + Cloudflare DNS + 公开API + 官网 Hub 集成 + 安全加固（CORS/RateLimit/BodyLimit） | 12/12 | 2026-05-24 |
| **M7** | **Desktop P0 打磨**：TanStack Query + Zod + 非受控输入 + 心跳 + 虚拟滚动 + viewRegistry | 12/12 | 2026-05-24 |

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
│  └──────────────────┘                          │ Runtime Registry │    │
│                                                │ / Target Health  │    │
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

- [x] **S1: 修复 ProcessExecutor race condition** `[0.5d]`
  - 文件：`edge-server/internal/lifecycle/process_executor.go:86-119`
  - 方案：先创建 context 再原子插入 running map，删除 nil placeholder 模式
  - 风险：并发 Cancel 找不到 cancel func，导致僵尸进程
  - 验收：`go test -race ./internal/lifecycle/ -count=10` 零失败

- [x] **S2: 接入 Prometheus metrics + 深度 health check** `[3d]`
  - 文件：新增 `edge-server/internal/metrics/metrics.go`，修改 `internal/httpserver/server.go`
  - 指标：`edge_runs_total`, `edge_run_duration_seconds`, `edge_active_runs`, `edge_ws_connections`, `edge_event_bus_depth`, `edge_event_bus_dropped_total`
  - Health check：验证 store 可读、runner registry 非空
  - 验收：`curl /v1/health` 返回 `{"status":"ok","checks":{"store":"ok","runners":3}}`

- [x] **S3: runnerctx 包测试（17.3% → 80%）** `[1d]`
  - 文件：`edge-server/internal/runnerctx/context_budget_test.go`
  - 缺失测试：`ShouldCompact()`, `UsagePercent()`, `RunOutputStore` 全部方法, `EstimateTokens()`
  - 验收：`go test -cover ./internal/runnerctx/` 覆盖 >= 80%

- [x] **S4: control_protocol 测试（0% → 80%）** `[1.5d]`
  - 文件：`edge-server/internal/adapters/control_protocol.go`
  - 缺失：5 个 `Write*` 函数的 JSON 输出验证 + `HandleControlRequest`/`handleCanUseTool` 测试
  - 修复：`json.Marshal` 错误不再 `_` 丢弃，返回 error
  - 验收：所有 Write* 函数输出合法 JSON，错误路径有覆盖

- [x] **S5: 修复 OrchestratorAdapter NeedsStdin 返回 false** `[0.5d]`
  - 文件：`edge-server/internal/adapters/orchestrator.go:67-68`
  - 方案：改为 `return true`，或确保内层 adapter 永久 bypassPermissions
  - 风险：orchestrator 内部 Claude Code 无法通过 stdin 处理权限请求

##### P1 -- 高优先级

- [x] **S10: 修复 FileStore persist 并发写竞态** `[1d]`
  - 文件：`edge-server/internal/store/file_store.go:162-169`
  - 方案：`persist()` 内部获取 `store.mu` 确保快照一致性
  - 验收：`go test -race ./internal/store/ -count=10` 零失败

- [x] **S7: 环境变量配置支持** `[1d]`
  - 文件：`edge-server/cmd/agenthub-edge/main.go:91-134`
  - 方案：为每个 CLI flag 添加环境变量 fallback
  - 验收：`AGENTHUB_ADDR=:4321 go run ./cmd/agenthub-edge/` 使用环境变量值

- [x] **S6: 抽取共享测试 helper** `[0.5d]`
  - 文件：新增 `edge-server/internal/lifecycle/testutil_test.go`
  - 方案：将 `nextEvent` 等 helper 从 `mock_executor_test.go` 移至专用文件
  - 验收：`go test ./internal/lifecycle/` 不变

##### P2 -- 改善

- [x] **S8: busEventEmitter 移入 adapters 包** `[1d]`
  - 文件：`edge-server/internal/lifecycle/process_executor.go:414-449` → `internal/adapters/event_emitter.go`
- [x] **S9: Orchestrator prompt 模板转义** `[0.5d]`
  - 文件：`edge-server/internal/adapters/orchestrator.go:72-95`
  - 方案：`NewOrchestratorAdapter` 写入 system prompt 前统一调用 `escapePromptLiteral`，转义 backtick 与 `${}`；`formatAgentList` 也复用同一转义逻辑，避免可用 agent 名称进入 prompt 时被下游模板处理误判。
  - 验收：`TestFormatAgentList`、`TestEscapePromptLiteral`、`TestOrchestratorAdapterEscapesSystemPrompt`
- [x] **S11: CreateProject 返回区分已存在/新建** `[0.5d]`
  - 文件：`edge-server/internal/store/store.go`, `edge-server/internal/api/handlers.go`
  - 方案：Store 通过 `ErrProjectExists` 区分重复创建；API 新建返回 201 并发布 `project.created`，已存在返回 200 且不重复发布 created 事件
  - 验收：`TestStoreCreateProjectDistinguishesExistingProject`、`TestMuxPostProjectsExistingProjectReturnsOKWithoutCreatedEvent`
- [x] **S12: 清理空目录 `internal/edgeserver/`** `[0.5d]`
- [x] **常量提取**：`maxConcurrentRuns: 5`, `channel buffer: 256`, `read buffer: 32*1024` 等魔数 → named constants `[0.5d]`
  - 方案：`defaultMaxConcurrentRuns`、`defaultReadBufferSize`、`subscriberChannelBufferSize` 已在对应包内命名；Codex/OpenCode/Claude NDJSON scanner 的初始 buffer 与最大 token size 统一收敛到 `configureAdapterScanner`。
  - 验收：`go test ./internal/adapters ./internal/events -count=1 -v`、`go test ./... -short -count=1`

---

#### 3.1.2 Hub Server 工程完善（~18 天）

> 参考：`docs/review/hub-server-audit.md` 全部 P0-P3 发现 + `docs/review/hub-server-testing.md` 测试改进计划

##### P0 -- 阻断级

- [x] **P0-1: JWT secret 环境变量化管理** `[1d]`
  - 文件：`hub-server/configs/config.yaml:20`, `hub-server/configs/config.docker.yaml:20`
  - 方案：仅从环境变量 `AGENTHUB_JWT_SECRET` 读取，dev 环境硬编码值拒绝启动
  - 修复：`hub-server/internal/config/config.go` -- Load 阶段校验
  - 验收：未设置环境变量时启动 panic

- [x] **P0-2: Admin pprof 绑定 localhost + 认证** `[0.5d]`
  - 文件：`hub-server/cmd/server-hub/main.go:294-300`
  - 方案：绑定 `127.0.0.1:6060`（非 `0.0.0.0`），添加 basic auth 中间件
  - 验收：外部 IP 无法访问 `/debug/pprof/`

- [x] **P0-3: EventBus panic 记录日志** `[0.5d]`
  - 文件：`hub-server/internal/service/eventbus.go:58-64`
  - 方案：`recover()` 处添加 `slog.Error("eventbus panic", "stack", debug.Stack())`，增加 Prometheus counter
  - 验收：模拟 panic handler，确认日志输出完整 stack trace

- [x] **修复 go.mod 版本号** `[0.5d]`
  - 文件：`hub-server/go.mod:3` -- `go 1.25.6` → `go 1.24.0`
  - 文件：`hub-server/deployments/Dockerfile` -- 同步 Go 版本
  - 验收：`go build ./...` 和 `go test ./...` 正常执行

##### P1 -- 高优先级架构修复

- [x] **P1-1: 创建 DeviceService 消除 handler 直连 DB** `[1d]`
  - 文件：`hub-server/internal/handler/device.go:15-17`
  - 新增：`hub-server/internal/service/device.go` -- `DeviceService` struct + methods
  - 验收：`DeviceHandler` 只依赖 `*service.DeviceService`

- [x] **P1-2: 消除 config.Cfg 全局单例** `[2d]`
  - 文件：`hub-server/internal/config/config.go:63`
  - 影响面：`middleware/auth.go:31`, `service/auth.go:87-88`, `service/attachment.go:65`, `router/router.go:31`
  - 方案：所有受影响模块通过构造函数接受 `*config.Config`
  - 验收：不再有任何文件直接引用 `config.Cfg`

- [x] **P1-3: 消除 repository.DB 全局单例** `[1d]`
  - 文件：`hub-server/internal/repository/db.go:14`
  - 方案：所有 service/handler 通过构造函数接受 `*gorm.DB`
  - 验收：移除 `var DB *gorm.DB`，所有引用替换为参数传递

- [x] **P1-4: 实现速率限制中间件** `[1d]`
  - 新增：`hub-server/internal/middleware/rate_limit.go`
  - 方案：基于 Redis 的 per-IP token bucket，登录 5 req/min，注册 3 req/min
  - 验收：`curl` 连续请求被 429 拒绝

- [x] **P1-5: 修复 JSON 手工构建注入风险** `[0.5d]`
  - 文件：`hub-server/internal/service/message.go:94-95`
  - 方案：`strings.ReplaceAll` → `json.Marshal(map[string]string{"text": req.Content})`
  - 验收：包含特殊字符（换行、反斜杠、引号）的消息正确存储

- [x] **P1-6: 请求超时中间件** `[0.5d]`
  - 新增：`hub-server/internal/middleware/timeout.go`
  - 方案：Gin middleware 包装 `context.WithTimeout(15s)`，上传端点 30s
  - 验收：模拟慢查询 20s 后返回 504

##### P2 -- 中等严重度

- [x] **P2-1/P2-2: 修复 N+1 查询** `[1d]`
  - 文件：`hub-server/internal/service/contact.go:217-240` (ListContacts), `:149-172` (ListFriendRequests)
  - 方案：收集所有 friend ID → 单次 `WHERE id IN (?)` → 构建 map
  - 验收：`TestListContacts_BatchesFriendUserLookup`、`TestListFriendRequests_BatchesSenderLookupAndSkipsMissingSender`

- [x] **P2-5: CancelTask session_id 错误** `[0.5d]`
  - 文件：`hub-server/internal/service/agent.go:269-274`
  - 方案：通过 `AgentInstance` 查找真实 `SessionID`，而非使用 `AgentInstanceID`
  - 验收：`TestCancelTaskPublishesResolvedSessionID` 覆盖 agent instance → session id 解析

- [x] **P2-8: Agent 消息生成 ClientMsgID** `[0.5d]`
  - 文件：`hub-server/internal/service/agent.go:312-318, 364-370`
  - 方案：`uuidv7.Must()` 生成 `client_msg_id`
  - 验收：`TestHandleTaskStreamPersistsAgentMessageWithClientMsgIDAndRedisSeq`、`TestHandleTaskDoneUsesDBSeqFallbackAndPublishesFinalEvents`

- [x] **P2-9: UpsertDevice ON CONFLICT 字段修正** `[0.5d]`
  - 文件：`hub-server/internal/repository/device.go`, `hub-server/migrations/0020_devices_allow_multiple_same_type.up.sql`
  - 方案：按 `device_id` 做 `ON CONFLICT (id)` 更新，`(user_id, device_type)` 降为非唯一索引；同用户同设备类型可拥有多个物理设备，跨用户或跨类型复用同一 `device_id` 拒绝为客户端错误
  - 验收：`TestDeviceRepo_Upsert` 覆盖同物理设备更新、同用户同类型新增第二设备、跨用户抢占同一 `device_id` 拒绝

- [x] **P2-10: WebSocket 丢帧告警 + 计数** `[0.5d]`
  - 文件：`hub-server/internal/handler/ws.go:143-147`, `hub-server/internal/ws/manager.go:164-167`
  - 方案：send channel 满时记录 WARN 日志 + Prometheus counter `ws_dropped_frames_total`
  - 验收：`TestManagerPushToConnCountsDroppedFrames` 覆盖慢客户端 send buffer 满时 counter 递增

- [x] **P2-3: jsonb 字段类型校验** `[0.5d]`
  - 文件：`hub-server/internal/model/custom_agent.go:17-20`
  - 方案：`CapabilityTags`/`ToolWhitelist` 必须是 JSON array，`ModelParams` 必须是 JSON object；handler 创建/更新前预检，GORM hook 保存前兜底
  - 验收：`TestCustomAgentValidateRejectsWrongJSONBShapes`、`TestCustomAgentHandler_CreateRejectsInvalidJSONBShapeBeforeService`、`TestCustomAgentHandler_UpdateRejectsInvalidJSONBShapeBeforeService`

- [x] **P2-4: FailWithMessage HTTP 状态守卫** `[0.5d]`
  - 文件：`hub-server/internal/handler/response.go:34-39`
  - 方案：添加 `if e.HTTPStatus == 0 { e = errcode.ErrInternal }` 守卫

- [x] **P2-7: Agent 消息 seq 分配走 Redis 缓存** `[0.5d]`
  - 文件：`hub-server/internal/service/agent.go:326-333`
  - 方案：`HandleTaskStream`/`HandleTaskDone` 使用 `allocateSeq`（Redis INCR + DB fallback）
  - 验收：Agent stream 覆盖 Redis seq；Agent done 覆盖 Redis 失败后的 DB fallback

- [x] **P2-6: WebSocket writeLoop 添加 panic recovery** `[0.5d]`
  - 文件：`hub-server/internal/handler/ws.go:47-57`
  - 方案：`defer conn.W.Close(...)` + `defer recover()` + 日志
  - 验收：`writeLoop` 退出统一 close，panic recovery 保留日志

##### P3 -- 低严重度（已推迟至后续批次）

- [ ] **P3-3/P3-6: 合并双 cmd 入口** `[1d]` — 推迟
- [x] **P2-11: listFriendRequests 用户查找失败时记录日志** `[0.5d]`
- [ ] **P3-1: 路由参数命名统一** `[0.5d]` — 推迟
- [x] **P3-2: 魔数常量化**（50/50/24h/5min/1024/64） `[1d]`
- [ ] **P3-4: 创建 Workspace GORM model** `[0.5d]` — 推迟
- [ ] **P3-5: gofmt 格式修复** `[0.5d]` — 推迟

> **说明**：P3 低优先级项（P3-1, P3-3, P3-4, P3-5, P3-6）已从 M5/M6/M7 批次推迟。M5/M6/M7 的 P0-P2 工程基础、生产部署、Desktop P0 打磨已全部完成，P3 清理项后续批次处理。

##### 测试基础设施（Phase 1-2，来自 testing audit）

- [x] **jwtutil 单元测试（0% → 100%）** `[1.5d]` `[P0]`
  - 新增：`hub-server/internal/jwtutil/jwt_test.go`
  - 覆盖：`GenerateAccessToken`, `ParseToken`, `GenerateRefreshToken`, `HashRefreshToken`
  - 验收：`go test -cover ./internal/jwtutil/` >= 90%

- [x] **cache 单元测试（0% → 80%）** `[1d]` `[P0]`
  - 新增：`hub-server/internal/cache/data_test.go`
  - 覆盖：`GetOrLoad` cache hit/miss, singleflight 去重, `Invalidate`, `AllocateSeq`
  - 验收：mock Redis 测试所有缓存路径

- [x] **middleware 单元测试（0% → 80%）** `[1d]` `[P1]`
  - 新增：`hub-server/internal/middleware/` 各 middle 的 `*_test.go`
  - 覆盖：auth skip path, device type gating, access log fields

- [x] **service 层单元测试（0% → 60%）** `[3d]` `[P1]`
  - 新增：`hub-server/internal/service/auth_test.go`, `session_test.go`, `message_test.go`, `eventbus_test.go`
  - 方案：`go-sqlmock` mock DB 层，table-driven tests
  - 验收：核心服务逻辑（注册/登录/创建会话/发送消息/召回）有独立单元测试

- [x] **eventbus panic recovery 测试** `[0.5d]` `[P1]`
  - 新增：`hub-server/internal/service/eventbus_test.go`
  - 验证：handler panic 后 logger 记录 stack + counter 递增

- [x] **test isolation（per-test cleanup）** `[1d]` `[P1]`
  - 文件：`hub-server/tests/setup_test.go`
  - 方案：`cleanDB()` 在 `t.Cleanup` 中调用，确保测试不互相污染

- [x] **Hub 覆盖率阈值 40% → 60%（硬阻断）** `[1d]` `[P1]`
  - 文件：`.github/workflows/checks.yml` go-hub job
  - 方案：`continue-on-error` 改为 `exit 1`；低于 60% 时 CI 失败

---

#### 3.1.3 Desktop 基础打磨（~14 天）✅ M5/M7 全部完成

> **详细实现描述见 `docs/roadmaps/client.md` Phase 0。** 以下仅保留摘要。
> 实施详情：`docs/architecture/design/client-p0-architecture.md` | 参考模式：`docs/architecture/design/client-reference-patterns.md`

- [x] **P0-1: 状态架构重构** `[5d]` — TanStack Query + RunState 状态机 + Zustand selector 粒度优化
- [x] **P0-2: 输入体验修复** `[4d]` — 非受控输入 + 草稿持久化 + 循环检测 + 文件去重
- [x] **P0-3: 连接健壮性** `[3d]` — WebSocket 心跳 + 离线队列 + Transport 抽象
- [x] **P0-4: 性能基础** `[2d]` — 虚拟滚动 + viewRegistry 拆分

##### Quick Wins（<1 天 / 项）✅ M5 全部完成

- [x] QW-1~QW-5: 非受控输入、草稿持久化、心跳、selector 优化、Toast 反馈

---

#### 3.1.4 CI/CD 流水线升级（~5 天）

> 参考：`docs/review/backend-engineering-standards.md` 第 3 节（CI/CD Pipeline）

##### 已接入（commit `1bbe365` 完成）

- [x] Edge: `-race` 竞态检测
- [x] Edge: `gosec` 安全扫描
- [x] Edge: `govulncheck` 漏洞扫描
- [x] Hub: `-race` 竞态检测
- [x] Hub: `gosec` 安全扫描
- [x] Hub: `govulncheck` 漏洞扫描
- [x] 提交信息格式检查（PR only）
- [x] Edge 覆盖率 75% 硬阻断 + per-package 最低阈值

##### 待实施

- [x] **Hub 覆盖率阈值 40% → 60%（硬阻断）** `[0.5d]` ✅ M5
- [x] **Hub Server golangci-lint 项目级配置** `[1d]` ✅ M5
- [x] **密钥检测（gitleaks）** `[0.5d]` ✅ M5

- [x] **Docker 镜像构建 + 推送** `[1d]` ✅ M5
  - `hub-server/deployments/Dockerfile`（Go 1.25、Alpine 3.21、HEALTHCHECK）
  - `.github/workflows/checks.yml` docker job（PR 构建验证）
  - `hub-server/.dockerignore`

- [x] **Benchmark 回归检测** `[1d]`
  - 新增：`edge-server/internal/events/bench_test.go`, `hub-server/internal/service/bench_test.go`
  - 方案：Bus.Publish、NDJSON 解析、JWT 验证、消息写入性能基准
  - CI：`go test -bench=. -benchtime=1s` 检测回归

- [x] **多平台构建验证（Windows + macOS + Linux）** `[1d]` ✅ M5

---

#### 3.1.5 文档体系完善（~4 天）

> 参考：`AGENTS.md` 文档规则 + hub-server-audit 文档准确性矩阵

- [ ] **API 文档自动生成** `[1.5d]`
  - 方案：Hub Server 接入 `swaggo/swag`，从代码注解生成 `hub-server/api/swagger.yaml`
  - 验收：`http://localhost:8080/swagger/index.html` 可交互浏览

- [x] **架构决策记录 (ADR)** `[1d]` ✅ M5
  - `docs/architecture/adr/` — 5 篇：Hub-Edge双层/WS+NDJSON/Zustand+TanStack/Go进程编排/Worktree隔离

- [x] **文档与代码一致性修复** `[1d]`
  - Hub Server 准确性矩阵（`docs/review/hub-server-audit.md` 第 10 节）31 项对比中 15 项不一致
  - 修复关键项：消息撤回 2min vs 5min、CORS/Rate-limit middleware 文档声明但不存在
  - 验收：移除文档中未实现的端点声明

- [x] **Edge Server 本地文档路径修复** `[0.5d]`
  - ✅ 已随 2026-05-25 目录重组落地（`docs/architecture/` 新路径）

---

### 3.2 Q3 2026（功能完善 -- 产品可用）

> **目标**：IM 功能完整、Agent 可观测性、多 Agent 协作、Desktop 竞争 UX、Settings 能力工作台和 Runtime/Profile/Configuration/Execution Target 概念重构

---

#### 3.2.1 Q3 启动：Orchestrator Phase 1 ✅ `[2d]`

- [x] Agent Registry（7 状态/树操作/并发安全）
- [x] Agent Message Queue（6 消息类型/广播/父子通信）
- [x] Sub-Agent Spawn（dispatchInterceptor + NDJSON 解析）
- [x] REST: GET /v1/agent-instances
- [x] 33 tests，12/12 包通过

---

#### 3.2.2 Hub-Edge-Desktop 集成

> **详细实现描述见 `docs/roadmaps/integration.md`。** 以下仅保留阶段摘要。
> 阶段 1-3 已于 M5 完成，阶段 4 核心组件完成，阶段 5-6 部分完成。

| 阶段 | 内容 | 工期 | 状态 |
|------|------|:--:|:--:|
| 阶段 1 | Desktop Hub 认证 + REST 客户端 | 3d | ✅ M5 |
| 阶段 2 | Hub WebSocket 客户端 | 2d | ✅ M5 |
| 阶段 3 | Agent 任务桥接（dispatch→run→stream→done/fail） | 4d | ✅ M5 |
| 阶段 4 | Desktop IM UI（核心组件完成，侧边栏/附件/通知待补） | 5d | 🔄 |
| 阶段 5 | 设备与同步强化（消息对账、离线队列、令牌刷新） | 3d | ⬜ |
| 阶段 6 | Edge Server 强化（并发 run、清理、持久化） | 2d | 🔄 |

---

#### 3.2.3 当前 Sprint：Desktop 架构 / Settings / 概念重构（~12 天）

> 顺序：先完成文档与架构语义收敛，再继续客户端实现。当前 worker 只维护 `docs/roadmap.md` 与 `docs/handoff/STATE.md`；核心架构文档由主线程在客户端实现前同步。

##### 批次 A：概念模型收敛 `[2d]`

- [x] 将 Desktop / Edge / Hub 统一抽象为四个一等概念：
  - `Runtime`：可执行代理运行时，如 Claude Code、Codex、OpenCode、本地/远程 Runtime。
  - `Profile`：用户可选的运行画像，包含模型、权限、工具、环境和默认 Execution Target。
  - `Configuration`：可保存、可审计、可同步的设置集合，覆盖模型映射、MCP、Skill、cc-switch、账号鉴权、安全策略。
  - `Execution Target`：一次 run 的实际目标，包含本地 Edge、远程设备、Hub 调度、特定 workspace/thread。
- [x] 前端依赖：SettingsPage 信息架构、i18n 文案、运行入口、Agent 管理面板统一改用上述术语，不再混用 "Agent/Model/Connection" 指代不同层级。
- [x] Edge 依赖：`/v1/agents`、`/v1/health`、`POST /v1/runs` 能提供 Runtime capability、availability、accepted/error 语义；PascalCase/camelCase 在 API 边界规范化。
- [ ] Hub 依赖：后续需要为 Profile/Configuration 提供账号级持久化和多端同步；TokenDance ID 只做身份，产品配置归 Hub/AgentHub。
- [ ] 生态依赖：cc-switch、模型 provider、Skill/MCP discovery 先作为外部配置源接入，避免把密钥或私有路径写入仓库文档。
- [ ] 验收：Settings 与 Agent Manager 截图中四个术语含义清晰；类型/normalizer 测试覆盖 Edge capability 映射；真实 `POST /v1/runs` 使用稳定输入返回 202 后 UI 进入乐观运行态。
- [x] 2026-05-25 前端落地：Settings 新增 `Agent Profiles` 与 `Execution Targets` 一级页面，消费 `useHealth()` / `useAgentList()`；`HealthResponse` 与 Zod schema 保留 `/v1/health.checks.runners` 扩展字段，Playwright 覆盖桌面和 375px 移动端无 raw i18n key、无 console error、无横向溢出。

##### 批次 B：Codex App 布局融合与侧栏回收 `[2d]`

- [ ] 学习 Codex App 布局密度、工具栏层级和消息操作方式，但保留 AgentHub 的三层架构、IM-native 与 TokenDance ID 登录边界。
- [ ] 左侧栏支持回收/展开：保留 workspace/thread/IM 入口，提供图标按钮、键盘快捷键和窄宽度自适应状态。
- [ ] 右侧栏支持回收/展开：运行详情、Agent 管理、工具时间线、Diff/Preview 不应强占空白状态；无 run 时默认收起或显示轻量入口。
- [ ] 所有小按钮统一使用现有 icon 库和共享 IconButton 模式；只在必要时保留文字按钮，hover/focus/disabled/loading 状态必须完整。
- [ ] 前端依赖：App shell、shared UI、Tooltip、快捷键管理、可访问性焦点环。
- [ ] Edge/Hub 依赖：无新协议；右侧栏内容仍消费现有 run/event/agent/device 数据。
- [ ] 验收：Playwright 覆盖 1440x900、1280x720、移动窄宽三档；左右侧栏收起后文本不溢出、不遮挡输入框；按钮无裸文本占位和裸 SVG。

##### 批次 C：Settings 能力工作台 `[5d]`

| 能力页 | 前端职责 | Hub 依赖 | Edge 依赖 | 生态集成 | 验收 |
|---|---|---|---|---|---|
| Agent Profile | Runtime + Model + Configuration 管理入口、可用 Profile 摘要 | 后续 Profile 持久化/同步 | `/v1/agents`、runner health | TokenDance ID profile sync / Agent Market | 2026-05-25 已接 Settings 预览与 Edge 真实状态，待接 Hub 存储 |
| Execution Target | Local Edge / Hub Relay / SSH/Tailscale / Cloud Edge 目标入口 | dispatch/permission/session | `/v1/health.checks.runners` | SSH/Tailscale/Hub Relay | 2026-05-25 已接 Settings 预览与移动端验证，待接远程目标注册 |
| 任务列表 | 本地 Run 概览、最近 Run、Hub task bridge 队列、审批入口 | pending task / ack / sync | `/v1/runs`、`useTaskBridgeStore` | TokenDance ID task sync / Hub dispatch | 2026-05-25 已接 Settings Tasks 实数据面，桌面 + 375px Playwright 无横向溢出 |
| 在线 IM | 会话、联系人、在线状态、通知入口 | session/message/device/WS sync | Desktop 桥接 Hub dispatch | 无 | 登录后能看到会话与在线状态，断线重连不丢未读 |
| Agent 市场 | 搜索、安装入口、详情页、能力标签 | CustomAgent/模板/评分/使用统计 | 安装后 Runtime 可执行性检查 | 模板包/Skill 包源 | 搜索安装后出现在 Agent Manager |
| Skill 管理 | 已安装/可安装/启用状态 | 可选同步用户配置 | 本地 skill discovery 与启停 | 本地 skill registry | 无效 skill 有明确错误，启用状态可恢复 |
| MCP 管理 | server 列表、连接状态、日志入口 | 可选同步配置元数据 | 本地 MCP 健康检查 | MCP 配置源 | 连接失败显示可操作错误，不暴露密钥 |
| 模型配置 | provider、默认模型、reasoning 档位 | Profile 持久化 | Runtime 启动参数映射 | provider/cc-switch | 修改后新 run 使用新默认值 |
| 模型映射 | 别名、fallback、能力标签映射 | 用户级映射保存 | Edge run 前解析 | cc-switch/model registry | "sonnet/opus/haiku" 等别名可预览解析结果 |
| cc-switch | provider 健康、切换、配额提示 | 可选账号级状态 | Runtime env 注入边界 | cc-switch CLI/DB | 切换只影响新 run，旧 run 不被打断 |
| 多端 | 设备列表、当前设备、能力差异 | Device registry/WS presence | 设备 capability 上报 | 无 | 同账号多设备可区分在线/离线/能力 |
| 远控 | 远程 Execution Target 选择、授权提示 | dispatch/permission/session | 远程 Edge 回调和状态 | 无 | 未授权不能远控，授权后能发起远程 run |
| 账号鉴权 | TokenDance ID 登录入口、会话状态、登出 | OIDC code exchange、本地 session | 无直接依赖 | TokenDance ID | 桌面入口只指向 TokenDance ID，不直连第三方 OAuth |
| 安全审计 | 权限、密钥、命令风险、配置导出检查 | 审计事件存储 | command/permission/security events | gitleaks/本地扫描器 | 导出/截图不含 token，危险配置有警示 |

##### 批次 D：Run 启动反馈与真实 Edge 验证 `[3d]`

- [x] Settings / TokenDance ID 登录入口 / Agent Manager 已完成 Playwright 截图验证，当前无裸 i18n key 和 console error。
- [x] 真实 Edge `/v1/agents` 已验证返回 Claude Code / Codex / OpenCode 三个可用 Runtime；能力 chips 已在前端显示。
- [x] 使用稳定输入抓包验证 `POST /v1/runs` 返回 202，说明 Edge 接受 run 并进入异步执行链路。
- [x] Hub dispatch bridge 已持久化 `taskId` -> Edge `runId` / `edge_device_id` 映射：`pending_agent_tasks.edge_run_id` + `edge_device_id` 绑定执行任务的具体 Desktop，`/edge/agent-tasks/{id}/ack|stream|done|fail` 接收 `run_id`/`edge_run_id`，Desktop 在 ack、stream、done、fail 回调中回传 Edge run id。
- [x] Hub Agent callback 安全验收：service/handler 覆盖错误 user/device/run id 拒绝，真实 Postgres/Redis HTTP 集成覆盖同用户错误 Desktop device 和错误 run id 拒绝；离线 pending-task replay 在重新推送到具体 WS conn 时写入 `edge_device_id`，route 存在但 manager/conn 不可用时回落 pending queue，不误标 dispatched。
- [x] 真实 Codex-profile Edge WebSocket smoke 已通过：临时 Edge `--runner-profile codex` 产生 `run.agent.text_block: OK`、`run.agent.result`、`run.finished`，证明 Agent CLI -> Edge adapter -> event bus -> WS 链路可用。
- [x] Edge runner 状态已对齐真实 executor：runtime adapter executor 下 `/v1/runners` 和 `/v1/health.checks.runners` 显示 `Codex Runner (local)`，不再误报默认 Mock Runner。
- [x] Edge permission decision spoofing 已做 server 侧缓解：`/v1/permissions/decide` 必须匹配 pending `runId/requestId`，未知、错 run、重复 decision 均拒绝；adapter 权限事件补齐 run/project/thread scope，OpenAPI 已把 `runId` 标为必填。
- [x] Edge raw run output 已加 per-run 字节预算：`ProcessExecutor` stdout/stderr 共享 4 MiB 默认上限，超限时截断 temp-file 持久化和 `run.output.batch` 文本，并用 `truncated/maxBytes/bytesWritten/message` 标记兼容事件。
- [x] Edge structured adapter payload 已加单事件预算：`run.agent.*` map payload 在进入 EventBus 前按默认 1 MiB JSON payload 上限递归截断字符串字段，附加 `truncated/maxBytes/bytesBefore/message`，必要时降级为 `dropped: true` metadata-only payload；orchestrator 内部 dispatch 解析仍在截断前进行。
- [x] Hub `device_id` UUID 边界已做 server 侧缓解：`/client/auth/login` 和 `/edge/devices/register` 在 handler 层 trim/parse UUID，非法值返回 `BAD_REQUEST` 且不会调用 service/repository；OpenAPI 已把登录和 Edge 设备注册请求的 `device_id` 标为 UUID。
- [x] Hub `device_id` UUID 边界已过真实 Postgres/Redis 集成验证：临时 `docker compose up -d postgres redis` 使用 `15432/16380`，跑通 `TestEdgeDevice` 的 register → login → me → desktop login → authenticated `/edge/devices/register` 链路，并修正 `tests` helper 让每个测试用户/设备类型使用稳定但不同的 UUID，避免真实 `devices.id` 主键冲突。
- [x] Hub 多设备登录语义已对齐真实 Postgres：`devices(user_id, device_type)` 改为非唯一索引，登录/设备注册按 `device_id` upsert；同用户两个 desktop UUID 可分别登录并刷新 token，另一个用户复用已归属 `device_id` 返回 `BAD_REQUEST` 而不是 `INTERNAL_ERROR`。
- [x] Hub `AH-SR-010` Redis/cache nil 行为已做 service 层缓解：Auth/Contact/Session/Message/Agent 构造器和方法统一经 `resolve*Cache` 处理 nil 与 typed-nil cache；测试/离线路径用 no-op/fallback cache 避免 panic，Message/Agent seq 仍走 DB fallback，生产 `App.Run` 继续 Redis ping fail-fast。
- [x] Hub cache fallback 验收：`go test ./internal/service -run "Test(ResolveCacheUsesNoopForTypedNilClient|SendMessage_NilCacheUsesDBSeqFallback|ChangePassword_NilCacheDoesNotPanic|UpdateProfile_NilCacheDoesNotPanic|AcceptFriendRequest_NilCacheDoesNotPanic|ListContacts_NilCacheMarksOffline|CreatePrivateSession_NilCacheDoesNotPanic|HandleTaskDoneNilCacheUsesDBSeqFallback)$" -count=1 -v`、`go test ./internal/service -count=1`、`go test ./... -short -count=1` 均通过。
- [x] Hub `AH-SR-008` dev compose 暴露面已收敛：`docker-compose.yml` 默认通过 `AGENTHUB_BIND_HOST=127.0.0.1` 只把 PostgreSQL、Redis、Hub API、Hub admin/metrics 发布到本机回环；远程开发需要显式设置 `AGENTHUB_BIND_HOST=0.0.0.0`，生产 compose 保持内部网络/loopback 发布。
- [x] Dev compose loopback 验收：`docker compose config --services`、`docker compose config` 解析通过。
- [x] Hub `AH-SR-011` 公开 stats 已改为官网可用但不暴露精确 live totals：`/api/public/stats` 保持原字段名和数字类型，但 user/agent/message/online 数值返回下限桶，uptime 返回 `<1h`/小时/天/`30d+` 粗粒度桶。
- [x] Edge `AH-SR-015` REST timeout 已和 WebSocket 拆开：`WriteTimeout=0` 继续服务 `/v1/events` 长连接，非 WebSocket REST 请求通过 30s middleware 兜底超时。
- [x] Public stats/REST timeout 验收：`hub-server && go test ./internal/handler -run TestPublicStatsBucketsCountsAndUptime -count=1`、`edge-server && go test ./internal/httpserver -run "TestRESTTimeoutMiddleware" -count=1`、`hub-server && go test ./... -short -count=1`、`edge-server && go test ./... -short -count=1` 均通过。
- [x] Edge `AH-SR-014` 本地调用边界已做可选 token 缓解：`--local-auth-token` / `AGENTHUB_EDGE_AUTH_TOKEN` 非空时，除 `/v1/health` 和 CORS preflight 外的 Edge REST API 需要 `Authorization: Bearer <token>` 或 `X-AgentHub-Edge-Token`，浏览器 WebSocket 使用 `/v1/events?access_token=<token>`；默认空 token 保持本地开发兼容，远程 Edge 仍需 Hub session/device proof 设计。
- [x] Edge local auth 验收：`edge-server && go test ./internal/httpserver ./cmd/agenthub-edge -count=1`、`edge-server && go test ./... -short -count=1`、`hub-server && go test ./... -short -count=1`、`app/desktop && pnpm vitest run src/__tests__/edgeClient.test.ts src/__tests__/eventClient.test.ts`、`app/desktop && pnpm exec tsc --noEmit`、`.\scripts\client-smoke.ps1 -EdgeAddr 127.0.0.1:3228 -EdgeAuthToken local-smoke-token`（23/23）均通过。
- [x] Hub `AH-SR-022` message pin 跨 session 泄露已做 server 侧缓解：pin 创建前通过 `(session_id, message_id)` 确认目标消息属于当前 session；pins 列表 hydration 改为同 session 范围查询，历史或恶意 cross-session `message_pins` 行不会在 API 输出中暴露其他 session 消息。
- [x] Message pin 安全验收：`hub-server && go test ./internal/service -run "Test(PinMessage|ListPinnedMessages)" -count=1`、`hub-server && AGENTHUB_DB_PORT=15432 AGENTHUB_REDIS_PORT=16380 AGENTHUB_JWT_SECRET=<test-secret> go test ./tests -run "Test(MessagePinRejectsCrossSessionMessage|ListPinsDoesNotLeakHistoricalCrossSessionPin)$" -count=1 -v`、`hub-server && go test ./internal/repository ./internal/service ./internal/handler -count=1`、`hub-server && go test ./... -short -count=1` 均通过；剩余是历史坏 pin 行清理或 DB 复合约束设计。
- [x] Hub `AH-SR-021` attachment 共享已做 server 侧缓解：新增 `message_attachments` 引用表，file message 发送时抽取并校验 UUID attachment 引用，发送者必须是 uploader 或已通过现有会话引用获权；下载允许 uploader 或引用所在 session 的 active user member，局外人保持 `ATTACH_NOT_FOUND`。
- [x] Attachment 共享验收：TDD 红灯覆盖 session member 下载失败、file message 不落引用、非法 `attachment_id`、引用他人附件；实现后 `go test ./internal/service -run "Test(GetAttachmentByIDAllowsSessionMemberForReferencedAttachment|SendMessage_FileContent)" -count=1 -v`、`go test ./internal/repository -run "TestMessageAttachmentRepo_CreateAndAccess|TestAttachmentRepo_CreateAndGet|TestMessageRepo_(Pins|InsertAndGet)" -count=1 -v`、真实 PostgreSQL/Redis 下 `go test ./tests -run TestAttachmentDownloadAllowsSessionMemberAfterFileMessage -count=1 -v` 均通过。
- [x] `client-smoke.ps1` 已对齐当前 Edge runtime 架构：不再构建已删除的独立 `runner/` 目录，改用 Edge 内置 `--runner-profile agenthub-runner-mock`，并新增 `-EdgeAddr` 便于用隔离端口跑 smoke。
- [x] Client/Edge smoke 验收：`app/shared/pnpm-lock.yaml` 已同步 shared React 类型/dev 依赖，`app/desktop && pnpm build` 通过；`.\scripts\client-smoke.ps1 -EdgeAddr 127.0.0.1:3228` 通过 23/23，覆盖 Edge build、shared 依赖安装、Desktop web build、`/v1/health`、`/v1/runners`、`POST /v1/runs`、cancel、WebSocket `run.started` / `run.output.batch` / `run.finished` 和 Edge Go tests。
- [x] Desktop Settings `Agent Profiles` / `Execution Targets` 已完成 Playwright 桌面和 375px 移动端验证，截图见 `app/desktop/screenshots/settings-agent-profiles.png`、`settings-execution-targets.png`、`settings-execution-targets-mobile.png`。
- [x] Desktop Settings `Tasks` 已从预留 surface 接入真实数据面：`useRuns()` 读取 `/v1/runs`，`useTaskBridgeStore` 展示 Hub dispatch bridge task，任务页展示本地 run 总数/active 数、Hub bridge 总数/active 数、最近 run 和桥接任务队列。
- [x] Tasks 验收：`pnpm vitest run src/__tests__/SettingsPage.test.tsx src/__tests__/PromptInput.test.tsx src/__tests__/errors.test.ts src/__tests__/Toast.test.tsx` 通过 43/43；`python -m json.tool src/i18n/locales/{en,zh}.json` 与 `git diff --check` 通过；Playwright 桌面和 375px 移动端无横向溢出、无 raw i18n key，截图见 `app/desktop/screenshots/settings-tasks-real-runs.png`、`app/desktop/screenshots/settings-tasks-real-runs-mobile.png`。
- [x] Run 状态机幂等修复：重复 terminal run event / WebSocket replay 下 `RunStateMachine.transition(COMPLETED)` 不再产生 `COMPLETED -> COMPLETED` warning；`pnpm vitest run src/__tests__/runStateMachine.test.ts src/__tests__/useChatMessages.test.ts src/__tests__/SettingsPage.test.tsx` 通过 72/72，Playwright 桌面和 375px 移动端复测 `logs: []`，截图见 `app/desktop/screenshots/settings-tasks-runstate-idempotent.png`、`settings-tasks-runstate-idempotent-mobile.png`。
- [x] Desktop Settings `Agent Scheduling` 已从占位行推进到真实调度概览：复用 `useRuns()`、`useTaskBridgeStore`、`useAgentList()`、`useHealth()` 和设置开关，展示调度队列、Agent Profile、Execution Target readiness、模型映射/cc-switch/远控/审批策略输入，并明确“调度选择 Profile/Model/Target，流式输出/工具调用/文件修改是 Run 基础能力”的边界。
- [x] Agent Scheduling 验收：`pnpm vitest run src/__tests__/SettingsPage.test.tsx src/__tests__/PromptInput.test.tsx src/__tests__/errors.test.ts src/__tests__/Toast.test.tsx` 通过 44/44；`python -m json.tool src/i18n/locales/{en,zh}.json` 与 `git diff --check -- app/desktop/src/...` 通过；Playwright 桌面和 375px 移动端无 console error、无 raw i18n key、无横向溢出，截图见 `app/desktop/screenshots/settings-agent-scheduling-real-data.png`、`app/desktop/screenshots/settings-agent-scheduling-real-data-mobile.png`。
- [x] Desktop Settings `Agent Market` 已从预留入口推进到真实本地 Profile/发布准备视图：复用 `useAgentList()`、TokenDance ID 登录状态和 Agent capability 字段，展示本地 Agent Profile 数、可发布 Profile、能力覆盖、Hub 发布状态、已安装 Profile 卡片和发布审核清单。
- [x] Agent Market 验收：`pnpm vitest run src/__tests__/SettingsPage.test.tsx src/__tests__/PromptInput.test.tsx src/__tests__/errors.test.ts src/__tests__/Toast.test.tsx` 通过 45/45；`python -m json.tool src/i18n/locales/{en,zh}.json` 与 `git diff --check -- app/desktop/src/...` 通过；Playwright 桌面和 375px 移动端无 console error、无 raw i18n key、无横向溢出，真实页面读到 OpenCode / Claude Code / Codex 三个本地 Profile，截图见 `app/desktop/screenshots/settings-agent-market-real-profiles.png`、`app/desktop/screenshots/settings-agent-market-real-profiles-mobile.png`。
- [x] Desktop Settings `Skill Management` 已从单行路径推进到项目级 registry 概览：基于当前 `.agents/skills/*/SKILL.md` 快照展示 7 个仓库级 Skill、6/7 可审核状态、1 个含脚本 Skill、1 个 references Skill、Hub sync 边界和脚本审计入口。
- [x] Skill Management 验收：`pnpm vitest run src/__tests__/SettingsPage.test.tsx src/__tests__/PromptInput.test.tsx src/__tests__/errors.test.ts src/__tests__/Toast.test.tsx` 通过 46/46；`python -m json.tool src/i18n/locales/{en,zh}.json` 与 `git diff --check -- app/desktop/src/...` 通过；Playwright 桌面和 375px 移动端无 console error、无 raw i18n key、无横向溢出，截图见 `app/desktop/screenshots/settings-skill-registry-real-data.png`、`app/desktop/screenshots/settings-skill-registry-real-data-mobile.png`。
- [x] 2026-05-25 客户端 run start 反馈已落地：提交后显示 queued 乐观运行、启动中禁用输入与重复提交、409 `active_run_exists` 会打开现有 run、显示 toast，并保留未接受的草稿。
- [x] 前端依赖：`AppError` 保留 HTTP status 和顶层 `runId` 到 details；`PromptInput` 支持 async send result；`ToastContainer` 已挂回 App shell。
- [ ] 后续补强：把 runStore/TanStack Query 中 active run 订阅和历史 run 列表刷新接到同一条状态链，避免只靠 optimistic run。
- [x] Edge 依赖：202 accepted、409 active_run_exists、health degraded、runner availability 字段稳定。
- [x] Hub 依赖：Hub dispatch 桥接到 Edge run 时保留 taskId/runId 映射。
- [x] 验收：`pnpm vitest run src/__tests__/errors.test.ts src/__tests__/PromptInput.test.tsx src/__tests__/Toast.test.tsx` 通过 42/42；Playwright 模拟 Edge 409 覆盖草稿保留、toast 可见、无横向溢出，截图见 `app/desktop/screenshots/run-start-active-conflict.png`。
- [x] Active-run 真实 HTTP smoke 已复现 409：临时 Edge `127.0.0.1:3227` 使用可控慢 `powershell Start-Sleep` runner，连续同 thread `POST /v1/runs` 返回 first `202`、second `409 active_run_exists`，且 409 body 带回首个 active `runId`；说明真实 server + `ProcessExecutor` 路径有效，先前 3210 双 202 更可能是旧进程或真实 runtime 过快完成。

##### Web UI 移植工作树状态 `[并行]`

- [x] `feat/webui-desktop-port` / `.worktrees/webui-desktop-port` 曾建立 TokenDance 生态 Web Console，`/` 指向生态控制台，旧工作台保留在 `/workbench-preview`。
- [x] 2026-05-25 审查修复：移动端 `.workspace` 固定行/裁切、外层 `App.module.css min-width: 960px` 横向溢出、Toggle 缺少 `role="switch"` / `aria-checked` / accessible name / 44px 触控高度。
- [x] 验证：`corepack.cmd pnpm exec vitest run src/pages/ecosystem/EcosystemConsole.test.tsx`、`corepack.cmd pnpm typecheck`、`corepack.cmd pnpm build` 通过；Playwright 375px 复测 `docScrollWidth=375`、switch `52x44`、无 console error。
- [x] 2026-05-25 Web worker 补强：`app/web/README.md` 已说明 `/` 生态控制台、`/workbench-preview` 旧工作台、TokenDance 生态边界和验证命令；生态控制台新增身份边界、协作同步、Agent runtime、运维护栏等入口，并补响应式 lane 布局与测试。
- [x] Web worker 验证：`corepack.cmd pnpm exec vitest run src/pages/ecosystem/EcosystemConsole.test.tsx` 通过 4/4，`corepack.cmd pnpm typecheck`、`corepack.cmd pnpm build`、`git diff --check -- app/web` 通过。
- [x] 2026-05-25 Web worker 二次补强：`EcosystemConsole` 新增 `Feature readiness` 面板，按 TokenDance ecosystem lane 派生 ready/review/planned 数量和平均进度；测试补到 5/5，`typecheck`、`build`、`git diff --check -- app/web` 通过。
- [x] 2026-05-25 Web worker 三次补强：`EcosystemConsole` 新增移动端/平板 `Jump to surface` picker，可直达 TokenDance ID、Hub、cc-switch、Remote control、audit 等生态入口；窄屏顺序调整为 workspace 优先、detail 次之、长侧边导航最后；测试补到 6/6，`typecheck`、`build`、`git diff --check -- app/web` 通过。
- [x] **2026-05-25：`feat/webui-desktop-port` 分支与 worktree 已删除。** 产出已合入 `dev/delicious233` 主线（`app/web/` 与验证修复），不再独立维护。
- [x] 结论：`/` 生态控制台入口已作为正式 Web 产品方向合入主线，旧 worktree 遗留问题（React alias、提交落后）随分支删除一并关闭。

##### 文档架构 sweep `[并行]`

- [x] 2026-05-25 gpt-5.5 xhigh 文档 worker 已完成文档架构审查（原写入 `docs/inbox/`，该目录已于 2026-05-25 目录重组中删除，结论已合并入本文档）。
- [x] 2026-05-25 Codex follow-up 文档 worker 已完成，确认主文档已基本对齐，剩余风险集中在 Runner 兼容 API 命名和旧 client handoff 入口。
- [x] 结论：主文档已基本对齐 Runtime/Profile/Configuration/Execution Target、TokenDance ID、IM、多端、远控、Skill/MCP、cc-switch、安全审计等边界。
- [x] 旧 client smoke 文档入口已最小收口：`docs/operations/client-roadmap.md`、`docs/architecture/implementation-guide.md`、`edge-server/README.md` 已说明早期独立 `runner/` 目录废弃，`client-smoke.ps1` 使用 Edge 内置 mock executor 和 `-EdgeAddr`。
- [ ] 文档待办：补 `/v1/runners`、`runner.*` 作为历史兼容命名的说明；归档或改写 `docs/archive/client-handoff.md`、`docs/roadmaps/integration.md` 等仍含旧独立 `runner/` 语义的文档。
- [ ] API 待办：决定 `/v1/runners`、`runner_offline`、`runner.online/offline` 是否长期保留为 deprecated compatibility，新增 schema 优先 Runtime/Profile/Execution Target 命名。

---

#### 3.2.4 Desktop 竞争 UX（~15 天）

> **详细实现描述见 `docs/roadmaps/client.md` Phase 1/Phase 2。** 以下仅保留摘要。

- **P1-1: 多 Agent 聊天** `[5d]` — 消息树形数据模型、子 Agent 内联视图、消息 Fork、SiblingSwitch 分支导航
- **P1-2: 富文本输入** `[4d]` — @提及/自动补全、斜杠命令系统、模型别名解析
- **P1-3: Agent 可观测性** `[3d]` — Token 用量实时更新、工具时间线面板、Agent 任务列表、Live Card
- **P1-4: 线程管理升级** `[3d]` — 按项目+日期分组、状态标记、归档、快捷键面板

---

#### 3.2.5 多 Agent 协作基础设施（~12 天）

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
> **详细实现描述见 `docs/roadmaps/client.md` Phase 2。** 以下仅保留功能摘要。

#### 3.3.1 差异化功能

- **Authority 可视化** `[3d]` — 每条消息色带（蓝=Hub/绿=Edge/橙=Hybrid），消息树连线区分来源
- **多 Agent 产物对比** `[3d]` — 同 prompt 不同 Agent 产出 side-by-side，产物溯源链路
- **Agent 市场/发现** `[4d]` — 模板分享、能力标签搜索、使用次数+评分排序
- **Plugin 系统（6 Slot）** `[5d]` — tab/sidebar/toolbar/overlay/artifact-renderer/command
- **进阶 Diff/代码审查** `[5d]` — Side-by-side diff、行级评论、Shiki 语法高亮
- **Agent 通信图可视化** `[3d]` — D3/ReactFlow 绘制 Agent 间消息传递
- **FTS5 全文搜索** `[3d]` — trigram + BM25，跨 session/thread/message 搜索
- **Checkpoint/Undo** `[4d]` — SHA-256 快照 + zstd 压缩 + Timeline 树

#### 3.3.2 性能与可靠性

- **React.memo 审计 + 代码块懒加载** `[1d]`
- **WCAG 2.1 AA a11y 审计** `[1d]`
- **E2E 测试覆盖（Playwright + Tauri driver）** `[2d]`
- **消息同步压力测试** `[1d]`

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
| Web 前端 | Trump | `feat/trump-webui`（已删除，2026-05-25 归档） | Web UI 功能完善 → 已合入 `dev/delicious233` |

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

## 7. M8: Codex 系统性安全审计 — 修复批次（129 Issues）

> Codex 在 2026-05-25 开发 session 中对 Hub/Edge/Desktop 全模块进行了系统性安全审计，
> 共创建 129 个 Issue。按模块分组为 8 个批次，每批次 4-10 个 Issue，分批修复。

### 7.0 批次总览

| 批次 | 模块 | Issue 数 | 工期 | 风险等级 |
|------|------|:--:|------|:--:|
| B1 | Auth / Token 安全 | 8 | 3d | 🔴 严重 |
| B2 | 数据完整性 / 并发 | 5 | 2d | 🔴 严重 |
| B3 | Edge 可靠性 / 错误处理 | 8 | 3d | 🟡 高 |
| B4 | 输入校验 / 边界防御 | 10 | 3d | 🟡 高 |
| B5 | Session / Group 生命周期 | 8 | 3d | 🟡 高 |
| B6 | Desktop IM / Hub 对接 | 12 | 4d | 🟢 中 |
| B7 | CI / 文档 / 清理 | 8 | 2d | 🟢 低 |
| B8 | Enhancement / 产品方向 | 6 | — | 规划中 |

> 其余未列入批次的 Issue（约 64 个）为 no-label 杂项，在批次推进中按文件就近顺手修。

---

### 7.1 B1: Auth / Token 安全（🔴 严重，3d）

**目标**：防止越权操作、token 泄漏、身份伪造。

| # | Issue | 文件 | 方案 |
|---|-------|------|------|
| 158 | TokenDance bearer 不应修改 Hub 本地用户 | `hub-server/internal/middleware/auth.go` | TokenDance 用户映射只读，禁止写 local user 表 |
| 65 | TokenDance bearer 不能当 Edge session | `edge-server/internal/httpserver/server.go` | 区分 `Authorization: Bearer td_xxx` vs `X-AgentHub-Edge-Token` |
| 63 | 校验 TokenDance ID token 的 issuer/audience | `hub-server/internal/jwtutil/tokendance.go` | `ParseTokenDanceJWT` 增加 iss/aud 校验 |
| 101 | 拒绝 dev compose 中的固定 JWT fallback | `hub-server/internal/config/config.go` | 生产环境 `AGENTHUB_JWT_SECRET` 为空时直接 fatal |
| 66 | logout 必须吊销 refresh token | `hub-server/internal/service/auth.go:Logout` | 写入 Redis blacklist + DB revoke |
| 134 | refresh 成功后轮换 refresh token | `hub-server/internal/service/auth.go:Refresh` | 旧 token 标记 revoked，发新 token |
| 149 | logout 按 device_type 作用域化 | `hub-server/internal/handler/auth.go:Logout` | 接受 `?device_type=` 参数，不传则全清 |
| 161 | login 时校验 device_type 白名单 | `hub-server/internal/service/auth.go:Login` | `device_type` 枚举：`desktop`/`web`/`cli` |

**验收**：
- `go test ./hub-server/internal/service/ -run "Auth" -count=1`
- TokenDance 用户调用 Hub-local mutation API → 403
- logout 后 refresh token 不可用

---

### 7.2 B2: 数据完整性 / 并发（🔴 严重，2d）

**目标**：防止数据竞争、状态不一致、静默丢失。

| # | Issue | 文件 | 方案 |
|---|-------|------|------|
| 189 | Agent task 状态转换原子化 | `hub-server/internal/service/agent.go` | `UPDATE ... WHERE status = $old` + 行锁 |
| 187 | 状态更新失败 fail closed | `hub-server/internal/repository/agent.go` | `RowsAffected == 0` → return error |
| 136 | 密码修改 + refresh 吊销原子化 | `hub-server/internal/service/auth.go:ChangePassword` | 同一事务内 `UPDATE password` + `DELETE refresh_tokens` |
| 168 | session pin 上限原子检查 | `hub-server/internal/repository/message.go:Pin` | `SELECT COUNT FOR UPDATE` + insert |
| 124 | 群组加人前检查重复 member_id | `hub-server/internal/service/session.go:AddMembers` | 去重 + UNIQUE 约束 |

**验收**：
- `go test -race ./hub-server/internal/service/ -count=5` 零 race
- 并发 pin 超过上限 → 第二个请求返回 error

---

### 7.3 B3: Edge 可靠性 / 错误处理（🟡 高，3d）

| # | Issue | 文件 | 方案 |
|---|-------|------|------|
| 191 | cursor 与 replay 实现对齐 | `edge-server/internal/events/bus.go` | `ReplayFrom(cursor)` 从精确 cursor 开始回放 |
| 167 | Run 创建持久化失败不映射为 not_found | `edge-server/internal/api/handlers.go:PostRuns` | 区分 store 错误类型，返回 500 |
| 165 | FileStore 持久化失败时 surface 到 Run 状态 | `edge-server/internal/store/file_store.go` | persist 失败时返回 error，Run 标记 failed |
| 111 | Run 输出到上限前截断 | `edge-server/internal/lifecycle/process_executor.go` | `maxOutputBytes = 1MB`，超限截断 + 警告 |
| 175 | 拒绝未知 agentId（不 fallback 默认 adapter） | `edge-server/internal/api/handlers.go:PostRuns` | 未知 agentId → 400 bad_request |
| 103 | Edge WS heartbeat 对齐 Desktop ping/pong | `edge-server/internal/httpserver/server.go` | 30s ping interval |
| 94 | REST write deadline 与长连接 WS 分离 | `edge-server/internal/httpserver/server.go` | REST 30s timeout，WS 不设 deadline |
| 172 | Edge store 拒绝跨 project 的 thread ID 碰撞 | `edge-server/internal/store/store.go:CreateThread` | 检查 project_id 归属 |

**验收**：
- `go test ./edge-server/internal/api/ -run "Run" -count=1`
- `go test -race ./edge-server/internal/store/ -count=3` 零 race
- Edge WS `ping` 每 30s → Desktop 收到 `pong`

---

### 7.4 B4: 输入校验 / 边界防御（🟡 高，3d）

| # | Issue | 文件 | 方案 |
|---|-------|------|------|
| 170 | Edge JSON body 严格解码 | `edge-server/internal/api/handlers.go` | `json.NewDecoder` + `DisallowUnknownFields` |
| 169 | message forward 目标列表校验限界 | `hub-server/internal/service/message.go:Forward` | 限制 `targets` 长度 ≤ 50 |
| 188 | 附件上传校验配置的 max size | `hub-server/internal/handler/attachment.go` | 读取 `cfg.MaxUploadBytes`，超限 413 |
| 185 | CustomAgent model_params 规范化后再校验 | `hub-server/internal/model/custom_agent.go` | `BeforeSave` hook 规范化 JSON |
| 140 | 校验 client_msg_id 格式 | `hub-server/internal/handler/message.go` | UUID/ULID 格式校验 |
| 139 | profile nickname/avatar URL 校验 | `hub-server/internal/service/user.go:UpdateProfile` | nickname 1-50 chars，avatar URL 格式 |
| 127 | shell 命令危险模式匹配前先标准化 | `edge-server/internal/security/origin.go` | 去掉多余空白、注释后再匹配 |
| 143 | 附件重复上传不覆盖已有文件 | `hub-server/internal/service/attachment.go` | hash 去重，返回已有 attachment |
| 70 | 附件 hash 校验后推导存储路径 | `hub-server/internal/service/attachment.go:Upload` | sha256 → `uploads/XX/YY/hash` |
| 153 | reply_to_message_id 校验在同一 session 内 | `hub-server/internal/service/message.go:Send` | 查询 message → 比对 session_id |

**验收**：
- Edge POST `{"unknownField": 1}` → 400
- 附件超过 max size → 413
- nickname 为空 → 400 validation error

---

### 7.5 B5: Session / Group 生命周期（🟡 高，3d）

| # | Issue | 文件 | 方案 |
|---|-------|------|------|
| 166 | 消息 API 对齐 dissolved session 生命周期 | `hub-server/internal/service/message.go` | dissolved session 内拒绝新消息 |
| 163 | session membership guard 仓储错误 fail closed | `hub-server/internal/service/session.go` | repo 错误返回 500，不静默通过 |
| 113 | group owner 离开保护应用到 delete-session | `hub-server/internal/handler/session.go:Delete` | owner 需先转让或解散 |
| 116 | dissolved session 拒绝新 agent task | `hub-server/internal/service/agent.go:Dispatch` | 检查 session status |
| 115 | 列表/搜索中标记 dissolved session | `hub-server/internal/repository/session.go` | `WHERE status != 'dissolved'` 默认过滤 |
| 97 | owner 不能通过 member removal 移除自己 | `hub-server/internal/service/session.go:RemoveMembers` | 禁止移除 owner_id |
| 112 | 群名/头像/公告修改需 owner 权限 | `hub-server/internal/handler/session.go:Update` | 检查 `requester_id == owner_id` |
| 135 | 群成员被移除时清理 invited agents | `hub-server/internal/service/session.go:RemoveMembers` | 级联删除 pending agent invitations |

**验收**：
- dissolved session 内发消息 → 410 Gone
- 非 owner 修改群名 → 403

---

### 7.6 B6: Desktop IM / Hub 对接（🟢 中，4d）

| # | Issue | 文件 | 方案 |
|---|-------|------|------|
| 123 | Desktop IM 对话接入真实 Hub session | `app/desktop/src/api/hubClient.ts` | 对接 `POST /v1/sessions` |
| 122 | private-session 创建对齐联系人好友边界 | `app/desktop/src/api/hubClient.ts` | 非好友不能创建 private session |
| 121 | Desktop session model 对齐 session_id 响应 | `app/desktop/src/api/hubClient.ts` | 统一 `sessionId` 字段 |
| 119 | Desktop IM send 对齐 Hub message 契约 | `app/desktop/src/api/hubClient.ts:sendMessage` | `POST /v1/sessions/:id/messages` |
| 118 | Desktop 处理 session 生命周期 WS 事件 | `app/desktop/src/hooks/useChatMessages.ts` | 监听 `session.created/updated/dissolved` |
| 117 | Hub 发布 session 生命周期 WS 事件 | `hub-server/internal/ws/manager.go` | 广播 session 变更 |
| 125 | Desktop client 解包 Hub response envelope | `app/desktop/src/api/hubClient.ts` | 统一处理 `{data, error}` 包装 |
| 155 | 同上 — Hub response envelope 解包 | 同上 | 同上 |
| 126 | 分离 Desktop Hub client 方法与 web 路由 | `app/desktop/src/api/hubClient.ts` | `hubClient.desktop.*` vs `hubClient.web.*` |
| 106 | Desktop thread rename/delete 实现或隐藏 | `app/desktop/src/components/ThreadPanel.tsx` | 对接 Hub API |
| 150 | Desktop 权限门控不自动聚焦 Allow | `app/desktop/src/components/PermissionGate.tsx` | 去掉 `autoFocus` |
| 102 | Desktop 权限批准阻塞原 tool request | `app/desktop/src/hooks/useChatMessages.ts` | `await decidePermission()` |

**验收**：
- Desktop 创建 session → Hub 持久化 → 刷新后可见
- Desktop 发消息 → Hub 存储 → 其他端收到 WS 推送

---

### 7.7 B7: CI / 文档 / 清理（🟢 低，2d）

| # | Issue | 文件 | 方案 |
|---|-------|------|------|
| 181 | Desktop CI test 脚本名修正 | `.github/workflows/checks.yml` | `test:desktop` → 正确脚本名 |
| 180 | Web ESLint 接入 package scripts + CI | `app/web/package.json` | 添加 `lint` script |
| 105 | CI gates 对齐安全/覆盖率策略 | `.github/workflows/checks.yml` | 硬阻断门槛确认 |
| 71 | pnpm lockfile 漂移修复 | `app/web/pnpm-lock.yaml` | 重新 `pnpm install` |
| 164 | 清理跟踪的 Go coverage profiles | `edge-server/cov_full`, `hub-server/tests/uploads/` | `.gitignore` + `git rm --cached` |
| 74 | 同上 — 删除 tracked Edge coverage | `.gitignore` | 同上 |
| 69 | 删除 tracked Desktop bundle analyzer 输出 | `.gitignore` | `app/desktop/stats.html` |
| 114 | dev/smoke 脚本更新（runner 已移除） | `scripts/client-smoke.ps1` | 更新引用 |

**验收**：
- CI 全绿
- `git status` 无 tracked build artifacts

---

### 7.8 B8: Enhancement / 产品方向（规划中，不定工期）

| # | Issue | 说明 |
|---|-------|------|
| 182 | Edge 事件流作用域订阅 | Hub relay 扩展前的必要基础设施 |
| 68 | Hub-Edge-Desktop 远程任务闭环优先 Q4 差异化 | 产品决策 |
| 146 | IM-native agent 协作的竞品定位刷新 | 文档/策略 |
| 16 | M1: 客户端 | Epic |
| 15 | M1: 后端 | Epic |
| 14 | M1: 前端 | Epic |

---

### 7.9 B9: S3 对象存储接入（1-2d，🟢 中）

**目标**：附件存储支持 S3 兼容对象存储（中国科技云 / hk1 自部署 MinIO）。

| 子任务 | 文件 | 方案 |
|--------|------|------|
| S3 config | `hub-server/internal/config/config.go` | 新增 `S3Config{Endpoint, AccessKey, SecretKey, Bucket, Region, UseSSL}` |
| Storage 分层 | `hub-server/internal/service/attachment.go` | `Upload()` 分流：`Upload.Dir` 本地 vs S3 `PutObject` |
| go.mod | `hub-server/go.mod` | 加 `github.com/aws/aws-sdk-go-v2/service/s3` |
| 部署配置 | `hub-server/deployments/.env.production.example` | 加 `S3_ENDPOINT`、`S3_BUCKET` 等环境变量 |
| 回退兼容 | — | 无 S3 配置时回退本地 `Upload.Dir`，不破坏现有部署 |

**验收**：`S3_ENDPOINT` 未设置时行为不变，设置后附件写入 S3。

---

### 7.10 修复策略

1. **按批次顺序推进**：B1 → B2 → ... → B7，不跨批次跳跃
2. **每批次一个 PR**：10 个左右 Issue → 一个 PR，方便 review
3. **先写测试，再修代码**：每个 Issue 补一个失败测试 → 修代码 → 测试变绿
4. **CI 硬阻断**：`go test -race ./...` + `pnpm test` 必须全绿
5. **每日收尾**：当天修完的批次当天 commit + push

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
| **设计** | `docs/architecture/design/client-p0-architecture.md` | Desktop P0 实施细节 |
| | `docs/architecture/design/client-reference-patterns.md` | Desktop 参考模式 |
| **架构** | `docs/architecture/system-architecture.md` | 系统架构文档 |
| | `docs/architecture/product-requirements.md` | 产品需求文档 |
| | `docs/architecture/implementation-guide.md` | 功能实现文档 |
| **规则** | `AGENTS.md` | 项目开发规则和约定 |
