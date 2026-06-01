# AgentHub 全局路线图

最后更新：2026-05-31（Desktop Run Workbench closure）

> **合并方向**：`feat/* → dev/delicious233 → master`
>
> 本文是 AgentHub 全部七层（Desktop / Edge / Hub / CI/CD / Testing / Documentation / Engineering Standards）的**唯一事实源**，取代各方向分散路线图。每项任务均引用审计报告具体发现，含文件路径、优先级和工期。

---

## 1. 当前状态总览

### 1.0 近期更新（Desktop Run Workbench，2026-05-31）

- [x] Desktop 日常工作台闭环保存点：`27ee3a7 feat(desktop): 收口日常工作台闭环`。
- [x] Active Run Sync：Edge WS run lifecycle 事件即时同步 TanStack Query `runs` 缓存，Home/Settings 对 `waiting_approval` 计入 active runs，Home CTA 可回到主工作台 Run 面板。
- [x] Runtime Typed Blocks UI：Run detail 增加 typed Runtime blocks 审阅列表，覆盖 text/code/thinking/tool/file/result/session fallback。
- [x] Approval / Diff / Artifact Review Surface：Run detail 收敛 pending approvals、diff、artifact/preview 证据；artifact/preview 缺接口或事件载荷时显示明确 gap，不做假预览。
- [x] Desktop Run Workbench 最终验收：`pnpm typecheck`、全量 `pnpm test`、`pnpm build`、Playwright 1440x900 / 1280x720 / 375px 截图。

### 1.1 版本矩阵

| 组件 | 技术栈 | 当前能力 | 测试状态 | 覆盖/质量 |
|------|--------|---------|---------|----------|
| **Desktop** | React 19 + Tauri 2 + Zustand + TanStack Query | viewRegistry 9视图、IM UI、AuthPage、RunState 状态机、传输层抽象 | `pnpm typecheck` + `pnpm test:ci`；全量 edge-real/lint 仍是债务 | 生产源码严格 tsc；ESLint 暂为 CI 可见债务 |
| **Edge Server** | Go (net/http + gorilla/websocket) | 3 Adapter、24 NDJSON、Orchestrator P1-P2、Prometheus、E2E 19/19 API | 13/13 包（530 funcs） | CI 硬阈值 75%，race/govulncheck；golangci-lint v2 + gosec 暂 warning-only |
| **Hub Server** | Go (Gin + GORM + Redis + PG) | DI 架构、13 包有测试、CORS+RateLimit+BodyLimit 中间件链、28 migrations | 13/13 包（355 funcs），repository 75.5% | CI 硬阈值 40%，govulncheck；golangci-lint v2 + gosec 暂 warning-only |
| **Web** | React + Vite | WebAgent closeout 已合入 `dev/delicious233`；Hub typed RunEvent replay/`agent.stream` 已接入 RunDetail projection，message runtime payload 仍保留为聊天兼容投影；旧 Trump/Web parity 分支只作单独审查输入 | `corepack.cmd pnpm test -- src/utils/hubAdapters.test.ts` + `corepack.cmd pnpm typecheck` + `corepack.cmd pnpm exec vite build` 通过 | 不做硬性要求；根/wrapper `pnpm build` 在 Windows Node/libuv 生命周期上仍按既有债务单独处理 |
| **CI/CD** | GitHub Actions | 8 job: go-edge/go-hub/benchmark/docker/cross-build/frontend/validate | Web lockfile、Go lint v2 config、gosec module path、Edge store、Desktop CI-safe gate 已收敛，等待新 Actions 复核 | race/govulncheck/覆盖率硬阻断；Go lint/gosec/Desktop lint 暂 warning-only |
| **官网** | Next.js 16 + Tailwind v4 | hub.vectorcontrol.tech — LiveStats + ConnectAgent | 14/20 tests | 静态导出，nginx on production server |
| **部署** | Docker Compose | PG16 + Redis7 + Hub Server（独立实例，不与 AIhub 共用） | ✅ 生产运行 | nginx 反代 api.hub.vectorcontrol.tech:80→8090 |
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
| **M6** | **生产部署**：Docker Compose 生产配置 + 生产部署 + nginx 反代 + Cloudflare DNS + 公开API + 官网 Hub 集成 + 安全加固（CORS/RateLimit/BodyLimit） | 12/12 | 2026-05-24 |
| **M7** | **Desktop P0 打磨**：TanStack Query + Zod + 非受控输入 + 心跳 + 虚拟滚动 + viewRegistry | 12/12 | 2026-05-24 |

### 1.3 关键差距（来自审计报告 — M5 已全部修复）

> 以下 P0-P2 项在 M5 批次（2026-05-24）中全部修复，保留作为记录。

参考：`docs/archive/review-archive/edge-server-audit.md`、`docs/archive/review-archive/hub-server-audit.md`、`docs/review/hub-server-testing.md`、`docs/review/backend-engineering-standards.md`

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
> **参考**：`docs/archive/review-archive/edge-server-audit.md`、`docs/archive/review-archive/hub-server-audit.md`、`docs/review/hub-server-testing.md`、`docs/review/backend-engineering-standards.md`

---

#### 3.1.1 Edge Server 工程完善（~12 天）

> 参考：`docs/archive/review-archive/edge-server-audit.md` 全部 13 项发现

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

> 参考：`docs/archive/review-archive/hub-server-audit.md` 全部 P0-P3 发现 + `docs/review/hub-server-testing.md` 测试改进计划

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
  - 文件：`hub-server/internal/repository/device.go`, `hub-server/migrations/0021_devices_allow_multiple_same_type.up.sql`
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
  - Hub Server 准确性矩阵（`docs/archive/review-archive/hub-server-audit.md` 第 10 节）31 项对比中 15 项不一致
  - 修复关键项：消息撤回 2min vs 5min、CORS/Rate-limit middleware 文档声明但不存在
  - 验收：移除文档中未实现的端点声明

- [x] **Edge Server 本地文档路径修复** `[0.5d]`
  - ✅ 已随 2026-05-25 目录重组落地（`docs/architecture/` 新路径）

---

### 3.2 Q3 2026（功能完善 -- 产品可用）

> **目标**：IM 功能完整、Agent 可观测性、AgentTeam/多 Agent 协作、Desktop 竞争 UX、Settings 能力工作台和 Runtime/Profile/Configuration/Execution Target 概念重构

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
| 在线 IM | 会话、联系人、在线状态、通知入口 | session/message/device/WS sync；Web workspace 已复用 Hub sessions/messages/task bridge | Desktop 桥接 Hub dispatch | 无 | 登录后能看到会话与在线状态，断线重连不丢未读 |
| Agent 市场 | 搜索、安装入口、详情页、能力标签 | CustomAgent/模板/评分/使用统计 | 安装后 Runtime 可执行性检查 | 模板包/Skill 包源 | 搜索安装后出现在 Agent Manager |
| Skill 管理 | 已安装/可安装/启用状态 | 可选同步用户配置 | 本地 skill discovery 与启停 | 本地 skill registry | 无效 skill 有明确错误，启用状态可恢复 |
| MCP 管理 | server 列表、连接状态、日志入口 | 可选同步配置元数据 | 本地 MCP 健康检查 | MCP 配置源 | 连接失败显示可操作错误，不暴露密钥 |
| 模型配置 | provider、默认模型、reasoning 档位 | Profile 持久化 | Runtime 启动参数映射 | provider/cc-switch | 修改后新 run 使用新默认值 |
| 模型映射 | 别名、fallback、能力标签映射 | 用户级映射保存 | Edge run 前解析 | cc-switch/model registry | "sonnet/opus/haiku" 等别名可预览解析结果 |
| cc-switch | provider 健康、切换、配额提示 | 可选账号级状态 | Runtime env 注入边界 | cc-switch CLI/DB | 切换只影响新 run，旧 run 不被打断 |
| 多端 | 设备列表、当前设备、能力差异 | Device registry/WS presence | 设备 capability 上报 | 无 | 同账号多设备可区分在线/离线/能力 |
| 远控 | 远程 Execution Target 选择、授权提示 | dispatch/permission/session | 远程 Edge 回调和状态 | 无 | 未授权不能远控，授权后能发起远程 run |
| 账号鉴权 | TokenDance ID 登录入口、会话状态、登出 | Hub OIDC code exchange 已落地；Web 已接浏览器 PKCE redirect callback 且 Hub token 收敛到 sessionStorage；Desktop 已接本机 callback + Hub exchange，Tauri 路径使用系统凭据存储，浏览器开发 fallback 只用 tab-scoped sessionStorage；Desktop/Web Hub WS 已改为 upgrade 前携带 Hub-issued token；发行版登录/logout/reconnect 证据待补 | `scripts/verify-oidc-readiness.ps1` | TokenDance ID | 入口只指向 TokenDance ID，不直连第三方 OAuth；REST/WS 使用 Hub-issued access token；公开 Web 发布前需要 BFF/HttpOnly cookie 或等价 session 设计 |
| 安全审计 | 权限、密钥、命令风险、配置导出检查 | 审计事件存储 | command/permission/security events | gitleaks/本地扫描器 | 导出/截图不含 token，危险配置有警示 |

##### 批次 D：Run 启动反馈与真实 Edge 验证 `[3d]`

- [x] Settings / TokenDance ID 登录入口 / Agent Manager 已完成 Playwright 截图验证，当前无裸 i18n key 和 console error。
- [x] 真实 Edge `/v1/agents` 已验证返回 Claude Code / Codex / OpenCode 三个可用 Runtime；能力 chips 已在前端显示。
- [x] 使用稳定输入抓包验证 `POST /v1/runs` 返回 202，说明 Edge 接受 run 并进入异步执行链路。
- [x] Hub dispatch bridge 已持久化 `taskId` -> Edge `runId` / `edge_device_id` 映射：`pending_agent_tasks.edge_run_id` + `edge_device_id` 绑定执行任务的具体 Desktop，`/edge/agent-tasks/{id}/ack|stream|done|fail` 接收 `run_id`/`edge_run_id`，Desktop 在 ack、stream、done、fail 回调中回传 Edge run id。
- [x] Desktop Hub task bridge 已挂入 App 根部并受 Hub session gate 控制：Desktop 先恢复/获取 Hub-issued access token，再开启 Hub WS 监听 `agent.dispatch`/`agent.cancel`。桥接层把 Hub task 转成 Local Edge `POST /v1/runs`，将 stdout `run.output.batch` 与结构化 `run.agent.text_delta` / `run.agent.text_block` 回传 `/edge/agent-tasks/{id}/stream`，并用有界可见输出缓存生成 `done.final_content`。
- [x] 2026-05-26 Hub→Desktop→Edge 真实启动 payload 补强：Hub `agent.dispatch` 现在从触发消息 JSON 提取 `prompt`；`/web/agent-tasks` 支持目标 `agent_type` / `agent_instance_id` / `custom_agent_id` 和 model hint，用户选择 Codex/Claude Code/OpenCode 时不会静默派到第一个 agent；Web 自动邀请 Claude Profile 时使用 Edge adapter id `claude-code`，Hub Agent Profile 的 runtime/model/provider/reasoning 元数据会进入 task trigger；Desktop bridge 规范化 legacy `claude` 别名，并在 `POST /v1/runs` 前先 `POST /v1/threads` 确保 Hub session 对应的 Local Edge thread 存在。Web Hub-only fallback 不再把 mock runner 计为 Local Edge ready。验证：`hub-server && go test ./internal/service ./internal/handler -run "Test(DispatchTaskIncludesPrompt|SelectAgentInstance|TriggerAgentTask|EdgeAgentTask|HubWebSocket|AuthHandler|DeviceHandler)" -count=1`、`app/desktop && corepack.cmd pnpm exec vitest run src/__tests__/useHubIntegration.test.ts`、`app/web && corepack.cmd pnpm exec vitest run src/api/agentQueries.test.ts`、`app/web && corepack.cmd pnpm typecheck` 通过；Desktop 全量测试 typecheck 仍有既有 test-only strict optional/index 债。
- [x] 2026-05-26 Agent Profile runtime config bridge：Hub 合并 CustomAgent 默认 `model_params` 与 trigger-time model params；Web `AgentProfile -> AgentInfo` 保留 `permission_mode`、`tool_allowlist`、`target_preferences`，并把 model/provider/reasoning/permission/tool/workdir 写入 Hub task trigger；Desktop bridge 把 `model_params`、`system_prompt`、`tool_whitelist` 翻译为 Edge `/v1/runs` 的 runtime config；Edge API 和 ProcessExecutor 将这些字段传入 adapter `RunProcessContext`，让 Codex/Claude Code/OpenCode BuildCommand 能消费 Profile 配置。验证：`hub-server && go test ./internal/service -run "TestDispatchTaskIncludesPrompt|TestMergeModelParamsLetsDispatchOverrideProfileDefaults" -count=1`、`edge-server && go test ./internal/api -run "TestPostRunsPassesRuntimeProfileConfigToExecutor|TestPostRunsBindsProjectAndThread" -count=1`、`edge-server && go test ./internal/lifecycle ./internal/adapters -run "TestClaudeCodeBuildCommandArgs|TestCodex|TestOpenCodeBuildCommandArgs" -count=1`、`app/desktop && corepack.cmd pnpm exec vitest run src/__tests__/useHubIntegration.test.ts`、`app/web && corepack.cmd pnpm test -- src/api/agentQueries.test.ts src/utils/hubAdapters.test.ts`、`app/web && corepack.cmd pnpm typecheck`、`app/desktop && corepack.cmd pnpm typecheck`、OpenAPI YAML 解析。
- [x] Edge direct callback 已补齐真实输出回传：`ProcessExecutor` 在配置 `hubTaskId` 时会 stream raw stdout 和结构化文本事件到 Hub，`done.final_content` 优先使用真实可见输出；Hub callback chunk 切分保持 UTF-8 完整，避免中文输出被截断成非法字符。
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
- [x] Runtime bridge 输出回传验收：`edge-server && go test ./internal/lifecycle -run "TestProcessExecutor|TestSplitHubCallbackTextPreservesUTF8" -count=1`、`edge-server && go test ./tests -run "TestHubE2E_(RunCompletes|CompleteRoundTrip|CallbackFormat)" -count=1`、`app/desktop && corepack.cmd pnpm exec vitest run src/__tests__/useHubIntegration.test.ts`、`app && corepack.cmd pnpm --filter agenthub-desktop typecheck` 均通过。`corepack.cmd pnpm --filter agenthub-desktop test -- src/__tests__/useHubIntegration.test.ts` 会触发当前 Desktop 全套测试；其中 `edge-real.test.ts` 仍有既有 409/WS Origin 失败，不能作为本轮 hook 单文件验证命令。
- [x] Hub `AH-SR-022` message pin 跨 session 泄露已做 server 侧缓解：pin 创建前通过 `(session_id, message_id)` 确认目标消息属于当前 session；pins 列表 hydration 改为同 session 范围查询，历史或恶意 cross-session `message_pins` 行不会在 API 输出中暴露其他 session 消息。
- [x] Message pin 安全验收：`hub-server && go test ./internal/service -run "Test(PinMessage|ListPinnedMessages)" -count=1`、`hub-server && AGENTHUB_DB_PORT=15432 AGENTHUB_DB_NAME=<temp-db> AGENTHUB_REDIS_PORT=16380 AGENTHUB_JWT_SECRET=<test-secret> go test ./tests -run "Test(MessagePinRejectsCrossSessionMessage|MessagePinsRejectHistoricalCrossSessionPinAtDatabase)$" -count=1 -v`、`hub-server && go test ./internal/repository ./internal/service ./internal/handler -count=1`、`hub-server && go test ./... -short -count=1` 均通过；2026-05-27 新增 migration 0039，先清理历史 cross-session `message_pins` 行，再用 `message_pins(session_id,message_id)` -> `messages(session_id,id)` 复合外键把 pin/session 归属固化到 DB 层。2026-05-29 hk2 读回 `schema_migrations=39|f`、`fk_message_pins_message_session` 存在、历史坏 pin 数为 0。
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
- [x] 2026-05-31 Desktop 日常工作台闭环：Home 已展示真实 active runs、pending approvals、Execution Target health、Hub session、recent threads 和 Hub task bridge 摘要；Settings Skills 改为本地 `.agents/skills` 权威来源并把 Hub sync 标为 login locked / interface gap；IM 增加刷新、错误重试、未读会话摘要，并把 Hub notifications 同步到 Desktop notification badge。验证通过 Desktop focused Vitest、`corepack.cmd pnpm typecheck`、`corepack.cmd pnpm test`、`corepack.cmd pnpm build`、`git diff --check` 和 1440/1280/375px Playwright overflow 截图。
- [x] 2026-05-25 客户端 run start 反馈已落地：提交后显示 queued 乐观运行、启动中禁用输入与重复提交、409 `active_run_exists` 会打开现有 run、显示 toast，并保留未接受的草稿。
- [x] 前端依赖：`AppError` 保留 HTTP status 和顶层 `runId` 到 details；`PromptInput` 支持 async send result；`ToastContainer` 已挂回 App shell。
- [ ] 后续补强：把 runStore/TanStack Query 中 active run 订阅和历史 run 列表刷新接到同一条状态链，避免只靠 optimistic run。
- [x] Edge 依赖：202 accepted、409 active_run_exists、health degraded、runner availability 字段稳定。
- [x] Hub 依赖：Hub dispatch 桥接到 Edge run 时保留 taskId/runId 映射。
- [x] 验收：`pnpm vitest run src/__tests__/errors.test.ts src/__tests__/PromptInput.test.tsx src/__tests__/Toast.test.tsx` 通过 42/42；Playwright 模拟 Edge 409 覆盖草稿保留、toast 可见、无横向溢出，截图见 `app/desktop/screenshots/run-start-active-conflict.png`。
- [x] Active-run 真实 HTTP smoke 已复现 409：临时 Edge `127.0.0.1:3227` 使用可控慢 `powershell Start-Sleep` runner，连续同 thread `POST /v1/runs` 返回 first `202`、second `409 active_run_exists`，且 409 body 带回首个 active `runId`；说明真实 server + `ProcessExecutor` 路径有效，先前 3210 双 202 更可能是旧进程或真实 runtime 过快完成。

##### Web UI 移植状态 `[已合入 / 残留分支待决策]`

- [x] `feat/webui-desktop-port` / `.worktrees/webui-desktop-port` 曾建立 TokenDance 生态 Web Console，`/` 指向生态控制台，旧工作台保留在 `/workbench-preview`。
- [x] 2026-05-25 审查修复：移动端 `.workspace` 固定行/裁切、外层 `App.module.css min-width: 960px` 横向溢出、Toggle 缺少 `role="switch"` / `aria-checked` / accessible name / 44px 触控高度。
- [x] 验证：`corepack.cmd pnpm exec vitest run src/pages/ecosystem/EcosystemConsole.test.tsx`、`corepack.cmd pnpm typecheck`、`corepack.cmd pnpm build` 通过；Playwright 375px 复测 `docScrollWidth=375`、switch `52x44`、无 console error。
- [x] 2026-05-25 Web worker 补强：`app/web/README.md` 已说明 `/` 生态控制台、`/workbench-preview` 旧工作台、TokenDance 生态边界和验证命令；生态控制台新增身份边界、协作同步、Agent runtime、运维护栏等入口，并补响应式 lane 布局与测试。
- [x] Web worker 验证：`corepack.cmd pnpm exec vitest run src/pages/ecosystem/EcosystemConsole.test.tsx` 通过 4/4，`corepack.cmd pnpm typecheck`、`corepack.cmd pnpm build`、`git diff --check -- app/web` 通过。
- [x] 2026-05-25 Web worker 二次补强：`EcosystemConsole` 新增 `Feature readiness` 面板，按 TokenDance ecosystem lane 派生 ready/review/planned 数量和平均进度；测试补到 5/5，`typecheck`、`build`、`git diff --check -- app/web` 通过。
- [x] 2026-05-25 Web worker 三次补强：`EcosystemConsole` 新增移动端/平板 `Jump to surface` picker，可直达 TokenDance ID、Hub、cc-switch、Remote control、audit 等生态入口；窄屏顺序调整为 workspace 优先、detail 次之、长侧边导航最后；测试补到 6/6，`typecheck`、`build`、`git diff --check -- app/web` 通过。
- [x] 2026-05-25 Codex 接手推进：Web workspace 主聊天链路已切到 Hub-only。`useThreads()` 读取 Hub sessions，Hub 允许创建 owner-only group session 作为 Web workspace 会话；Web 新建 Threads、空态发送、选 Agent 都可按需创建该会话，随后发送 Hub message、按需调用 `/client/sessions/{id}/agents`，再通过 `/web/agent-tasks` 触发 Hub→Desktop/Edge dispatch；取消走 `/web/agent-tasks/{id}/cancel`。验证通过 `app/web && corepack pnpm typecheck`、`corepack pnpm build`、Hub handler/service 聚焦测试、目标文件 `git diff --check`、冲突标记和 Trump 分支残留扫描、Playwright 桌面/移动 smoke。
- [x] 2026-05-25 Web TypeScript 收紧：`app/web/tsconfig.json` 已恢复 `strict: true`、`strictNullChecks: true`、`noUncheckedIndexedAccess: true` 与 `exactOptionalPropertyTypes: true`，清理 Web/shared optional DTO、Hub/IM adapter、permission、composer、Settings 与 private chat 形状；验证通过 `app/web && corepack pnpm exec tsc -p tsconfig.json --noEmit --strict true`、`corepack pnpm typecheck`、`corepack pnpm build`。
- [x] 2026-05-25 Web 纯色 Codex App 质感补强：按 `codex-theme-v1` 的 `surface=#25252d`、`ink=#e3e4e6`、`accent=#5d68cc` 改为纯色深灰 surface，移除 `app/web/src` 内全部 `linear/radial/conic-gradient` 与 gradient mask；composer 复用 Desktop 单层 capsule 的 760px 栏宽、17px 输入字号、低边框/低阴影和 14px radius，移除 Web 额外 goal/card 堆叠，空态建议项改成低噪 inline chips；Playwright 桌面/移动 smoke 验证无 console error、无 raw i18n key、无横向溢出、运行时 0 个 gradient 节点且 `backdrop-filter` 生效。截图证据保留为本地 ignored 产物，不进入 Git。
- [x] 2026-05-26 Web Hub token storage hardening：`app/web/src/api/hubTokenStorage.ts` 改为 access/refresh token 只写 `sessionStorage`，`hubAuth.ts` 的 token-source hint 同步改为 `sessionStorage`，并清理 legacy `localStorage` key；新增 `hubTokenStorage.test.ts` 覆盖 access/refresh token 不落 persistent storage 和旧 key 清理。公开 Web 发布前仍需 BFF/HttpOnly cookie 或等价 session 设计。
- [x] 2026-05-26 OIDC release-readiness slice：补 `scripts/verify-oidc-readiness.ps1`，检查 Hub OIDC OpenAPI/server wiring、`.env.example`/compose OIDC 变量、Desktop/Web token storage 和根治理矩阵仍为 Partial；补 Desktop 非 Tauri fallback access token 只写 `sessionStorage` 并清理 legacy `localStorage` key。该检查不连接生产、不读取真实 client secret，不能替代部署态 login/callback/logout/reconnect 截图和 smoke。
- [x] 2026-05-26 OIDC setup 示例修正：`hub-server/.env.example`、`scripts/setup-tokendance-oidc.{ps1,sh}` 和 `scripts/seed-tokendance-client.sql` 改为注册无端口 loopback `http://127.0.0.1/callback` 与 Web dev callback，不再输出旧的 `PORT_IDX` 或 `agenthub://callback`；同时输出 `AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS`，和 TokenDance ID 动态 loopback 规则保持一致。
- [x] 2026-05-26 Hub WebSocket auth slice：对齐真实 `/client/ws` upgrade 鉴权，Desktop/Web `createHubWS` 使用 `access_token` query 连接 Hub，`WebSocketTransport` 在自动/手动重连时保留最新认证 URL；Hub handler 测试覆盖 Hub-local query token 成功和 TokenDance bearer upgrade 前拒绝。部署态 login/logout/reconnect 与截图证据仍未关闭。
- [x] 2026-05-26 Runtime readiness slice：补 `scripts/verify-runtime-readiness.ps1`，结构化检查 AgentAdapter 接口、Claude Code/Codex/OpenCode adapter、Edge CLI/env/profile 注册、`/v1/agents`/`/v1/runners`/`/v1/health.checks.runners`、Desktop Settings runtime inventory、Web Hub-only stub 边界和文档 caveat。该检查不执行真实 CLI、不读取 CLI auth，也不替代 Codex/Claude Code/OpenCode live smoke。
- [x] 2026-05-26 Runtime live smoke slice：`scripts/integration-smoke.ps1` 改为真实 Runtime smoke，不再 fallback mock；支持 `AGENTHUB_CLAUDE_CODE_PATH` / `AGENTHUB_CODEX_PATH` / `AGENTHUB_OPENCODE_PATH`，按 runtime 传入对应 Edge path flag，并给 WebSocket 设置本地 Origin。已分别用 Codex、Claude Code、OpenCode 真实 CLI 验证 `run.queued -> run.started -> run.agent.* -> run.finished`；`scripts/client-smoke.ps1` 同步修复 Origin 和真实 runId cancel 顺序，mock client smoke 19/19 通过。
- [x] 2026-05-26 Desktop permission decision 前端路径收紧：`useChatMessages` 不再发送 Edge 会丢弃的 `run.agent.permission_decide` WebSocket 帧；App 以 permission request 自带 `runId` 调 `/v1/permissions/decide`，Edge 接受后才更新本地决策状态。当前仍只完成 run-scoped REST 决策登记；Claude Code stdin 阻塞式 can_use_tool 回写和远程 Edge 决策证明继续作为安全闭环待办。
- [x] 2026-05-26 Web Hub runtime payload 展示：Web 主聊天的 `hubMessageToChatMessage` 会把 Hub `message.new` 中来自 Desktop/Edge bridge 的 runtime payload JSON 映射成结构化 tool/file/result blocks，避免工具调用和文件变更在 Web 里只显示成 JSON 文本；新增 `hubAdapters.test.ts` 覆盖 tool_call、file_change 和普通 JSON 文本 fallback，验证通过 `app/web && corepack.cmd pnpm exec vitest run src/utils/hubAdapters.test.ts`、`corepack.cmd pnpm typecheck`、`corepack.cmd pnpm build`。
- [x] 2026-05-26 Web RunDetail runtime 投影：`projectRunDetail()` 会从 Hub Chat blocks 派生右侧 RunDetail 所需的 output/tool call/changed files，`WebLayout` 不再向 RunDetail 传空数组；验证通过 `app/web && corepack.cmd pnpm test -- src/utils/hubAdapters.test.ts`、`corepack.cmd pnpm typecheck`、`corepack.cmd pnpm exec vite build`。
- [x] 2026-05-26 Hub typed RunEvent persistence slice：`/edge/agent-tasks/{id}/stream` 兼容旧 `content/chunk`，并支持 `event_type + payload`；Hub 会把规范化 runtime event 写入 `agent_run_events`、发布 `agent.stream`，同时保留 `message.new` 聊天投影。新增 owner-scoped `GET /web/agent-tasks/{id}/events` 作为最小 replay/read API；验证通过 `hub-server && go test ./internal/handler ./internal/service ./internal/repository -run "TestEdgeAgentTaskStream|TestHandleTaskStream|TestEdgeHubProtocol|TestPendingTask|TestHandleTaskAck|TestHandleTaskDone|TestHandleTaskFail|TestListTaskRunEvents|TestDevice|TestAgentRunEvent" -count=1`、`hub-server && go test ./... -short -count=1`、OpenAPI YAML 解析。
- [x] 2026-05-26 Web typed RunEvent consumption slice：Desktop Hub bridge 对 `run.agent.*` / `run.output.batch` 使用 `event_type + payload` 回传 Hub；Hub app 订阅 `agent.stream` 并推送到 session WebSocket；Web `hubClient` 增加 `GET /web/agent-tasks/{id}/events`，`WebLayout` 合并 replay 与 `agent.stream`，RunDetail 优先从 typed RunEvent 投影 output/tool/file。Codex `files[]` file_change、stdout batch chunks、tool call/result 均有 Web 单测覆盖；验证通过 `hub-server && go test ./internal/app -run TestStartEventSubscriptionsPushesAgentStreamToSession -count=1 -v`、`app/web && corepack.cmd pnpm test -- src/utils/hubAdapters.test.ts`、`app/web && corepack.cmd pnpm typecheck`、`app/desktop && corepack.cmd pnpm exec vitest run src/__tests__/useHubIntegration.test.ts`、`app/desktop && corepack.cmd pnpm typecheck`。
- [x] 2026-05-26 Web/Desktop Hub response envelope + Agent Profile slice：两端 `hubClient` 统一解包 Hub `{code,data,message}` 生产响应并兼容旧裸 JSON mock；Web `useAgentList()` 在有 Hub session 时读取 `GET /web/agent-profiles`，把 Hub Agent Profile 映射成 AgentInfo，未登录时才走 preview fallback。OpenAPI 补 `GET /web/agent-profiles` 和 `AgentProfile` schema；验证通过 Web `hubClient/agentQueries/hubAuth` Vitest、Desktop `hubClient` Vitest、Web/Desktop typecheck。
- [x] 2026-05-27 Agent Profile owner boundary slice：`GET /web/agent-profiles/{id}` 改为从 Hub session 传入当前 `user_id`，跨 owner 读取返回 `AUTH_DEVICE_MISMATCH`；Marketplace detail 改走 public-only lookup，未发布 profile 返回 `AGENT_NOT_FOUND`。验证通过 `hub-server && go test ./internal/service ./internal/handler -run "TestAgentProfile(GetIsOwnerScoped|GetPublicOnlyReturnsPublishedProfiles|HandlerGetProfilePassesCurrentUserToService)|TestMarketHandlerGetMarketProfile" -count=1`。
- [x] 2026-05-27 Skill/MCP/ProviderBinding owner boundary slice：`GET /web/skills/{id}`、`GET /web/mcp-servers/{id}` 和 internal `ProviderBindingService.Get` 改为 owner-scoped，跨 owner 返回 `AUTH_DEVICE_MISMATCH`，避免用户私有 catalog/resource metadata 被 UUID 枚举读取。验证通过 `hub-server && go test ./internal/service ./internal/handler -run "Test(Skill|MCPServer|ProviderBinding).*OwnerScoped|Test(SkillHandlerGetSkill|MCPServerHandlerGetMCPServer)" -count=1`。
- [x] 2026-05-27 Web relay command contract slice：`POST /web/relay/commands` 继续接受 `target_edge_id`，并兼容旧 OpenAPI 暴露过的 `target_id` alias；handler 明确要求目标、`command_type` 和非空 `payload`，避免空 payload command 被 admin Web session 创建。OpenAPI 已同步为 `target_edge_id`/deprecated `target_id`、200 OK response，并修正 ack path 为 `/web/relay/commands/{id}/ack`。验证通过 `hub-server && go test ./internal/handler -run TestRelayHandlerCreateCommand -count=1`、`hub-server && go test ./... -short -count=1` 和 OpenAPI YAML 解析。
- [x] 2026-05-26 Web/Desktop Settings OIDC 状态对齐：账号页不再读取旧 `td_code_verifier` / `td_state`。Web 用当前 `agenthub_oidc_pkce_pending` session payload 识别浏览器 PKCE 往返提示；Desktop 因 Tauri 路径把 state/verifier 保持在本机回调闭包中，不再从 storage 推断。验证通过 Desktop `SettingsPage.test.tsx`、Web/Desktop typecheck 和 `git diff --check`。
- [x] 2026-05-26 Hub session boundary slice：新增 `RequireHubSession()`，`/client/auth/me`、contacts、sessions/messages、attachments、notifications、`/web/*`、`/edge/*` 均在 `AuthMiddleware` 后要求 Hub-issued session；TokenDance ID bearer 仅保留 identity compatibility，不能直接授权 Hub 产品 API、设备路由或 Web task dispatch。`verify-oidc-readiness.ps1` 已加结构检查，安全登记 `AH-SR-002` 已同步。
- [x] 2026-05-26 Execution Target owner boundary slice：`ExecutionTargetService.Get/Ping` 改为带 `ownerID`，`ExecutionTargetHandler` 从 Hub session 传入当前 `user_id`；跨 owner 读取或 ping target 返回 `AUTH_DEVICE_MISMATCH`，且不会把目标标记 online。验证通过 `hub-server && go test ./internal/service ./internal/handler -run "TestExecutionTarget" -count=1`。
- [x] 2026-05-26 Execution Target workspace policy foundation：Hub `execution_targets` 增加 `workspace_allowlist`、`trust_level`、`health_state` policy 字段和 JSON string-array/enum 校验；`/web/execution-targets` create/update 接受 `workspace_allowlist` 数组；Edge `agenthub-edge` 增加 `--workspace-allowlist` / `AGENTHUB_WORKSPACE_ALLOWLIST`，配置后 `/v1/runs.workDir` 必须解析到 allowlist root 内，否则返回 `workspace_not_allowed` 且不会创建 run 或启动 Runtime。该切片只完成 Local Edge/registered target 的安全地基，不代表远程/云 3/4/5/6/8 场景完成。验证通过 Hub/Edge 聚焦测试、`hub-server && go test ./... -short -count=1`、`edge-server && go test ./... -short -count=1`、OpenAPI YAML 解析和 `git diff --check`。
- [x] 2026-05-26 Execution Target UI inventory：Web/Desktop `hubClient` 与 TanStack Query 新增 owner-scoped `GET /web/execution-targets` / `POST /web/execution-targets/:id/ping` 只读清单和 ping 调用；Settings `Execution Targets` 不再只展示静态 Remote/Cloud 预留卡，改为显示 Hub target count、health breakdown、type 分布、登录/加载/空/错误状态和逐 target ping。Web 仍只走 Hub session，不恢复浏览器直连 Local Edge；该切片只是 target inventory 可视化，不代表 run dispatch 已按 `target_id` 路由。验证通过 Web/desktop focused Vitest、Web/Desktop typecheck、Web-Hub boundary、JSON 解析和 `git diff --check`。
- [x] 2026-05-26 Hub target_id task contract：`/web/agent-tasks` 接受可选 `target_id`，Hub 校验 target owner、deleted state 和当前可调度 target type（`local_edge` / `hub_relay`），把 `target_id` 持久化到 `pending_agent_tasks` 并透传到 `agent.dispatch` payload；Web/Desktop Hub client 类型已同步。该切片只完成契约和透传，dispatch 仍走当前 inviter desktop route，不代表远程/云 target-bound routing 已完成。验证通过 Hub service/handler 聚焦测试、Hub short tests、Web/Desktop hubClient focused Vitest、Web/Desktop typecheck、OpenAPI YAML 解析和 `git diff --check`。
- [x] 2026-05-26 Hub target-bound desktop routing：`feat/hub-edge-target-routing` 让 Hub 在有 `target_id` 时解析 owner-scoped Execution Target 绑定的 desktop `device_id`，预写 `pending_agent_tasks.edge_device_id`，只向该 device 的 Desktop/Edge WS 下发；目标 device 离线或 stale route 时进入 target/device 专属 Redis queue，reconnect 只 replay 同一 device 的 queue，禁止 fallback 到其他在线 desktop。该切片仍只覆盖绑定本机/desktop device 的 target-bound dispatch，不代表 Remote SSH、Tailscale、Cloud Edge 或 Web→Cloud 场景完成。验证通过 `hub-server && go test ./internal/cache ./internal/ws ./internal/service ./internal/app -run "Test(GetRouteForDevice|PendingTarget|ManagerSetAuth|DispatchTaskRoutesTarget|DispatchTaskQueuesTarget|TriggerAgentTaskPrebinds|OnRouteSetReplaysTarget)" -count=1` 和 `hub-server && go test ./... -short -count=1`。
- [x] 2026-06-01 Execution Target task-entry closure：Web composer 接入 Hub target inventory，默认选中可派发 `local_edge` / `hub_relay` target，发送 Hub task 时携带 `target_id`；离线 target 不伪装在线，作为 device queue 入口保留，未实现 Remote/Cloud target 显示 locked/gap。Shared/Desktop Hub client 支持 `triggerAgentTask(..., { target_id })`，Desktop bridge 保存 `agent.dispatch.target_id` 并在 Settings task queue 展示路由证据。验证通过 Desktop focused Vitest、Desktop/Web typecheck、Web hubClient focused Vitest、shared hubClient tests 和 `git diff --check`；Go 未在本机 PATH，Hub Go focused tests 未运行。
- [x] 2026-05-27 Execution Target health proof hardening：`POST /web/execution-targets/{id}/ping` 只允许当前可证明的 `local_edge` 被手动标记 online，并同步写入 `health_state=healthy`；`remote_ssh` / `tailscale` / `cloud_edge` / `hub_relay` 在 live proof path 未实现前返回 `TARGET_NOT_ROUTABLE`，且不会写 `is_online`、`last_seen_at` 或伪健康状态。OpenAPI 已补 409 语义说明。验证通过 `hub-server && go test ./internal/service -run TestExecutionTargetPing -count=1`、`hub-server && go test ./... -short -count=1`、OpenAPI YAML 解析和生产 compose config。
- [x] 2026-05-27 Execution Target health state system-managed：`ExecutionTargetService.Create/Update` 禁止客户端把 `health_state` 写成 healthy/degraded/offline，`PATCH /web/execution-targets/{id}` 不再在 OpenAPI 暴露 `health_state`；该字段只能由 Hub live proof 路径写入，避免普通配置更新绕过 target health proof。验证通过 `hub-server && go test ./internal/service -run "TestExecutionTarget(Create|Update).*HealthState" -count=1`。
- [x] 2026-05-27 Execution Target create ingress health_state hardening：`POST /web/execution-targets` 现在会显式拒绝非空 `health_state`，避免 Web create 入口静默丢弃 rogue 字段导致客户端误以为伪健康状态已设置；该字段仍只允许 Hub proof path 写入。验证通过 handler 红绿测试 `go test ./internal/handler -run TestExecutionTargetHandlerCreateRejectsClientManagedHealthState -count=1`。
- [x] 2026-05-27 Edge TaskStream client_msg_id ingress hardening：`POST /edge/agent-tasks/{id}/stream` 现在会在 handler 层校验并规范化可选 `client_msg_id` UUID，非法值直接 400 且不会进入 service/DB 查询，避免 Edge callback 把非 UUID 值写入或触发 PostgreSQL uuid cast 错误；验证通过 handler 红绿测试 `go test ./internal/handler -run TestAgentHandlerTaskStreamRejectsInvalidClientMsgID -count=1`。
- [x] 2026-05-27 AgentRunEvent event_type ingress hardening：`HandleTaskStream` 归一化显式或 payload 推断的 `event_type` 后，会拒绝空值、超过 `agent_run_events.event_type` 96 字符上限或包含非常规事件名字符的值，避免 runtime callback 把不可入库事件类型推到 PostgreSQL；验证通过 service 红绿测试 `go test ./internal/service -run TestHandleTaskStreamRejectsOversizedInferredEventType -count=1`。
- [x] 2026-05-27 AgentRunEvent payload/content ingress hardening：`HandleTaskStream` 现在会在入库和聊天投影前拒绝超过 1 MiB 的规范化 runtime payload 或 projected message content，和 Edge structured event budget 对齐，避免异常 Edge callback 把大 JSON/文本写入 `agent_run_events.payload` 或 `messages.content` 持续放大数据库与内存压力；验证通过 service 红绿测试 `go test ./internal/service -run "TestHandleTaskStream(PersistsTypedRunEventAndProjection|RejectsOversizedInferredEventType|RejectsOversizedPayload|RejectsOversizedProjectedContent)" -count=1`。
- [x] 2026-05-27 Edge TaskDone final_content ingress hardening：`HandleTaskDone` 现在会在插入 final message 和 task 状态迁移前拒绝超过 1 MiB 的 `final_content`，补齐 stream 之外的 done callback 存储放大入口；OpenAPI 将 done body 对齐为真实 `final_content` 字段并标注 1 MiB callback payload budget。验证通过 service 红绿测试 `go test ./internal/service -run TestHandleTaskDoneRejectsOversizedFinalContent -count=1`。
- [x] 2026-05-27 Edge TaskFail error ingress hardening：`HandleTaskFail` 现在会在写入 `pending_agent_tasks.error_message` 和广播 `agent.failed` 前拒绝超过 1 MiB 的 `error`，补齐失败回调的 DB/WS 放大入口；OpenAPI 已标注 fail error callback payload budget。验证通过 service 红绿测试 `go test ./internal/service -run TestHandleTaskFailRejectsOversizedError -count=1`。
- [x] 2026-05-27 Edge callback run id ingress hardening：`HandleTaskAck`、`HandleTaskStream`、`HandleTaskDone` 和 `HandleTaskFail` 现在会在查询/持久化/广播前拒绝超过 128 字符的 `run_id` / `edge_run_id`，对齐 `pending_agent_tasks.edge_run_id` 与 `agent_run_events.edge_run_id` 的 `varchar(128)` 上限，避免异常 callback 触发 DB 错误路径或写入超长 runtime id；OpenAPI 已在四个 callback body 标注 `maxLength: 128`。验证通过 service 红绿测试 `go test ./internal/service -run "TestHandleTask(AckRejectsOversizedEdgeRunID|StreamRejectsOversizedEdgeRunID|DoneRejectsOversizedEdgeRunID|FailRejectsOversizedEdgeRunID)" -count=1`。
- [x] 2026-05-27 Edge callback terminal CAS hardening：`HandleTaskDone` 和 `HandleTaskFail` 现在会检查 atomic status update 的 error 与 affected rows，CAS 冲突返回 `BAD_REQUEST` 且不发布 `agent.done` / `agent.failed`；`HandleTaskDone` 的 final message 插入和 task done 迁移放入同一 DB transaction，避免状态迁移失败后遗留 final message。验证通过 service 红绿测试 `go test ./internal/service -run "TestHandleTask(Done_AtomicConflictDoesNotPublish|Fail_AtomicConflictDoesNotPublish)" -count=1`。
- [x] 2026-05-27 Edge TaskStream dispatched->running CAS hardening：`HandleTaskStream` 不再用无条件 status update 把 `dispatched` 改为 `running`；现在通过 atomic compare-and-swap 迁移，CAS 失败后重读任务状态，只允许已被并发 callback 推到 `running` 的路径继续，终态/冲突返回 `BAD_REQUEST` 且不写 `agent_run_events` / `messages` / `agent.stream`。验证通过 service 红绿测试 `go test ./internal/service -run TestHandleTaskStream_DispatchedTransitionConflictDoesNotPersist -count=1`。
- [x] 2026-05-27 Edge TaskAck edge_run_id backfill CAS hardening：`HandleTaskAck` 对已 running 且空 `edge_run_id` 的补写会检查 `RowsAffected`；CAS 失败后重读任务，只允许同一 `edge_run_id` 已被并发写入的幂等情况继续，其它 run id 或仍为空的冲突返回 `BAD_REQUEST`。repository backfill 也收紧为仅 running + empty `edge_run_id` 可写，避免 ack 竞态覆盖其它 callback 结果。验证通过 service 红绿测试 `go test ./internal/service -run "TestHandleTaskAck_EdgeRunIDBackfill" -count=1` 和 repository focused test `go test ./internal/repository -run TestPendingTaskRepo_AtomicWithEdgeRunID -count=1`。
- [x] 2026-05-27 Edge TaskAck queued offline replay CAS fix：`HandleTaskAck` 对 queued offline-replayed task 现在用任务当前状态作为 atomic oldStatus，真实数据库中 queued/dispatched 都能 CAS 到 running 并写入 `edge_run_id`；避免此前 sqlmock rows=1 掩盖真实 queued→running rows=0、ack 被误拒的问题。验证通过 SQLite 红绿测试 `go test ./internal/service -run TestHandleTaskAck_QueuedOfflineReplayTransitionsToRunning -count=1` 和 ack focused test `go test ./internal/service -run "TestHandleTaskAck" -count=1`。
- [x] 2026-05-27 Edge dispatch state persistence fail-closed：在线 direct dispatch、target-bound dispatch 和 reconnect queue replay 现在先持久化 `pending_agent_tasks` 的 `dispatched` 状态/`edge_device_id`，成功后才推送 `agent.dispatch`；`UpdatePendingTaskDispatched` rows=0 会返回错误，避免 DB 未落 dispatched/device 绑定时 Edge 已收到任务、后续 ack 被拒或重复投递。验证通过 service/app/repository 红绿测试 `go test ./internal/service -run "TestDispatchTask(DoesNotPush.*DispatchedStateMissing|RoutesTargetBoundTaskToBoundDevice)" -count=1`、`go test ./internal/app -run "TestOnRouteSet(DoesNotReplayTargetQueueWhenDispatchStateMissing|ReplaysTargetQueueOnlyForConnectedDevice)" -count=1`、`go test ./internal/repository -run TestPendingTaskRepo_CRUD -count=1`。
- [x] 2026-05-27 Edge dispatch terminal-state guard：`UpdatePendingTaskDispatched` 只允许 queued/dispatched task 写入 dispatched/device 绑定；cancelled/done/failed/timeout 等终态 rows=0 并返回错误，上层 direct/target dispatch 因而不会把已取消或已终态任务重新推给 Edge。验证通过 service/repository/app 红绿测试 `go test ./internal/service -run "TestDispatchTask(DoesNotPushTerminal|DoesNotPush.*DispatchedStateMissing|RoutesTargetBoundTaskToBoundDevice)" -count=1`、`go test ./internal/repository -run TestPendingTaskRepo_CRUD -count=1`、`go test ./internal/app -run "TestOnRouteSet(DoesNotReplayTargetQueueWhenDispatchStateMissing|ReplaysTargetQueueOnlyForConnectedDevice)" -count=1`。
- [x] 2026-05-27 Edge task timeout CAS hardening：`startTaskScheduler` 不再用无条件 status update 把扫描到的 expired task 写成 `timeout`；现在使用扫描时的旧状态做 atomic CAS，CAS 失败时跳过 `agent.timeout` 广播，避免 done/failed/cancelled 等并发终态被超时扫描覆盖。验证通过 service/app 红绿测试 `go test ./internal/service -run "TestTimeoutExpiredTask" -count=1`、`go test ./internal/app -run TestPublishExpiredTaskTimeoutSkipsStaleTerminalTask -count=1`。
- [x] 2026-05-27 Team approval control idempotent redelivery：`DecideApproval` 对已经记录过的同一 allow/deny 决策不再直接返回 `BAD_REQUEST`；当 TeamEvent 已写入但 `agent.control` 投递或客户端响应丢失时，重复提交同一决策会按原 `edge_control` 重新投递到绑定 Desktop device，且不追加重复 `team.approval.decided` 事件；相反决策仍拒绝。验证通过 service 红绿测试 `go test ./internal/service -run TestAgentTeamService_DecideApprovalRedeliversSameDecisionWithoutDuplicateEvent -count=1`。
- [x] 2026-05-27 Agent control offline queue dedupe：离线 `agent.control` 队列现在对同一 user/device 的完全相同 control payload 先 `LREM` 再 `LPUSH`，避免 approval 幂等重投在 Desktop 离线期间把 Redis list 重复堆积，仍保持 device 级隔离。验证通过 cache/service 红绿测试 `go test ./internal/cache -run TestPendingAgentControlsDeduplicateExactPayloadForDevice -count=1`、`go test ./internal/service -run TestAgentControlServiceQueuesDuplicateOfflineControlOnce -count=1`。
- [x] 2026-05-27 Agent control offline queue resource cap：离线 `agent.control` 队列现在在 exact-payload 去重后追加 `LTRIM` 和 `EXPIRE`，每个 user/device 最多保留 256 条最新 control，24 小时未重连自动过期，避免 Desktop 长时间离线时 Redis list 无界增长。验证通过 cache 红绿测试 `go test ./internal/cache -run TestPendingAgentControlsAreCappedAndExpire -count=1`、cache/service/app 相关测试和 `hub-server && go test ./... -short -count=1`。
- [x] 2026-05-27 Pending task Redis queue TTL：普通离线 `pending_tasks` 和 target/device 专属 `pending_tasks:*:device:*:target:*` Redis list 现在写入后设置 24 小时 TTL，target index set 同步设置 TTL；与 DB `pending_agent_tasks.expire_at` 对齐，避免 stale offline task queue key 永久驻留。验证通过 cache 红绿测试 `go test ./internal/cache -run "TestPending(TasksExpire|TargetTasksExpireWithIndex)" -count=1`、cache/service/app 相关测试和 `hub-server && go test ./... -short -count=1`。
- [x] 2026-05-27 #173 non-text message content normalization：`SendMessage` 写入 jsonb 前统一 normalize content；text 仍包装为 `{"text": ...}`，非 text 必须是 JSON object 并按类型校验必需字段后 compact marshal，`deploy_card` 不再跳过 JSON 校验，避免 raw client JSON 或 invalid JSON 进入持久层。验证通过 service 红绿测试 `go test ./internal/service -run "TestSendMessage_(NormalizesNonTextContentBeforeJsonbWrite|RejectsInvalidDeployCardJSONBeforeDBLookup)" -count=1`、`go test ./internal/service -run TestSendMessage -count=1` 和 `hub-server && go test ./... -short -count=1`。
- [x] 2026-05-27 #145 configured upload directory：附件上传 handler 不再用 hash 的最终 blob path 在当前工作目录创建 staging temp 文件，改为系统临时文件；最终 blob 仍通过 `AttachmentService.StoreBlob` 写入配置的 `Upload.Dir` / S3 storage，避免 configured upload dir 场景下遗留 `./uploads` 临时目录，也避免本地 storage 根为 `.` 时 temp 目录与最终文件路径冲突。验证通过 handler 红绿测试 `go test ./internal/handler -run TestAttachmentUploadUsesConfiguredLocalStorageDir -count=1`、attachment 相关 handler/service 测试和 `hub-server && go test ./... -short -count=1`。
- [x] 2026-05-27 #138 device register contract alignment：OpenAPI 已对齐 Hub 实际 `/edge/devices/register` slash route、`{code,message,data}` response envelope 和当前 `Device` response 字段；Hub handler 不再把存储层 `capabilities` JSON 字符串泄漏给客户端，注册/列表响应会返回数组。验证通过 OpenAPI 合同红绿测试 `go test ./internal/handler -run TestOpenAPIEdgeDeviceRegisterMatchesHubRouteAndEnvelope -count=1`、handler register response 红绿测试、相关 Edge protocol 测试、OpenAPI YAML 解析和 `hub-server && go test ./... -short -count=1`。
- [x] 2026-05-27 #142 Edge callback request body contract：OpenAPI 的 Edge task stream/done callback request body 现在明确指向 Hub 实际 schema；stream 至少要求 `content`、`chunk` 或 `payload` 之一，`client_msg_id` 标为 UUID，`content`/`chunk`/`final_content`/`error` 字符串字段写明 1 MiB 上限，`event_type` 写明 96 字符上限，`run_id`/`edge_run_id` 保持 128 字符上限。验证通过 OpenAPI 合同红绿测试 `go test ./internal/handler -run TestOpenAPIEdgeTaskCallbacksDocumentStreamAndDoneBodies -count=1`、`go test ./internal/handler -count=1`、OpenAPI YAML 解析和 `hub-server && go test ./... -short -count=1`。
- [x] 2026-05-27 #105 CI gate policy alignment：新增 `scripts/verify-ci-gates.ps1` 并接入 `validate` job，防止 CI gate 再次漂移；校验 Edge/Hub 覆盖率硬阈值分别为 75%/40%，`govulncheck` 为硬阻断，Go lint/gosec 保持 warning-only 可见债务，validate job 保留 whitespace、secret guard 和 OpenAPI YAML 解析。路线图验收标准同步区分 CI 硬 gate 与发布审计 gate。验证通过本地红绿执行 `pwsh -NoLogo -NoProfile -File scripts\verify-ci-gates.ps1`、OpenAPI YAML 解析、`hub-server && go test ./... -short -count=1` 和目标文件 `git diff --check`。
- [x] 2026-05-27 #110 Hub device_id UUID contract closeout：Edge integration mock Hub 现在按真实 Hub 合同拒绝非 UUID `device_id`，Edge/Hub protocol fixtures 改用稳定 UUID；OpenAPI 增加重复 mapping key 守护并确认 OIDC authorize/callback 的 `device_type`/`device_id` required + UUID contract，清理 `HubOIDCAuthorizeRequest.device_id` 重复 description。验证通过 Edge 红绿测试 `go test ./tests -run "TestEdgeRegistersWithHub|TestEdgeFullProtocolRoundTrip" -count=1 -v`、OpenAPI 红绿测试 `go test ./internal/handler -run "TestOpenAPI(DoesNotContainDuplicateMappingKeys|HubAuthDeviceIDsUseUUIDContract|EdgeDeviceRegisterMatchesHubRouteAndEnvelope)" -count=1 -v`、OpenAPI YAML 解析和后续 Hub/Edge short tests。
- [x] 2026-05-29 AH-SR-024 AgentTeam read/write boundary slice：`ListTeams` 改为返回 owner teams + requester 拥有已安装 Agent Profile 的 readable teams；`GetTeam` 与 TeamRun reads 复用 readable-member 检查；`HandleRouteDecision`、`DecideApproval`、`ResolveConflict` 保持 owner-only，避免成员读者升级为 TeamRun 决策写权限。生产部署脚本同步对预加载镜像使用 `--no-build --force-recreate`，仍禁止服务器 build。验证通过成员读/list/不可写红绿测试、`go test ./internal/service -run TestAgentTeamService -count=1`、`go test ./internal/repository -run TestAgentTeam -count=1` 和 `hub-server && go test ./... -short -count=1`。
- [x] 2026-05-29 AH-SR-026 OIDC-only nullable password slice：Hub 当前只暴露 TokenDance ID OIDC auth/refresh/me/logout/profile 路由，不暴露 legacy local password login/register；`model.User.PasswordHash` 改为 `*string`，仓储和 OIDC 测试库 schema 对齐 migration 0035，验证 OIDC-only 用户 `password_hash IS NULL` 时读取为 nil 且 callback 仍签发 Hub-local session。验证通过红绿测试 `go test ./internal/repository -run TestUserRepo_ReadsOIDCOnlyUserWithNullPasswordHash -count=1 -v`、OIDC callback focused tests、`go test ./internal/model -count=1` 和 `hub-server && go test ./... -short -count=1`。
- [x] 2026-05-29 AH-SR-025 AgentTeam delegation/resource guardrail slice：`agent_team` 配置和 `AGENTHUB_AGENT_TEAM_*` env 已覆盖委派深度、active subagents、route repeat、TeamRun 总任务、assignment timeout 和 budget；`AgentTeamService` 由 App 注入配置值，直接 `CreateAssignment` 也补齐 ancestor max-depth、脏数据循环检测、总任务 cap 和 active cap，避免绕过 coordinator route guardrails。验证通过配置 defaults/env/invalid 红绿测试、direct assignment depth/task/cycle 红绿测试、route decision guardrail 回归、`go test ./internal/service -run TestAgentTeamService -count=1 -v`、`hub-server && go test ./... -short -count=1` 和 `git diff --check`。
- [x] 2026-05-29 AH-SR-017 public admin probe / NoRoute slice：生产探针发现主 API 对未知路径、`/metrics`、`/debug/pprof/` 返回空 `200`，根因是 Timeout middleware 未 flush 无 body 状态码且 router 未显式 NoRoute。已补 Timeout header-only status flush、router JSON 404/405，确保 admin metrics/pprof 仍只在独立 Basic Auth admin mux 下，公网主 API 不再把未知路由伪装成 200。验证通过 `go test ./internal/router -run TestNoRouteReturnsNotFound -count=1 -v`、`go test ./internal/middleware -run "TestTimeout_(FlushesHeaderOnlyStatus|HandlerCompletesNormally|Returns504WhenHandlerSlow)" -count=1 -v`、`hub-server && go test ./... -short -count=1` 和 `git diff --check`；commit `f071d03` 已用 no-server-build tar/load/recreate 流程部署到 hk2，生产 `/metrics`、`/debug/pprof/`、`/does-not-exist` 均返回 404，health `status=ok`、`migrations=39`。
- [x] 2026-05-29 AH-SR-016 production CORS smoke closeout：hk2 live container 读回 `AGENTHUB_ENV=production`、`AGENTHUB_CORS_ORIGINS=https://hub.vectorcontrol.tech`；OPTIONS `/health` 对 `http://localhost:5173` 与 `http://127.0.0.1:5173` 返回 403 且无 allow-origin，对 `https://hub.vectorcontrol.tech` 返回 204 且 allow-origin 匹配；`/health` 仍 `status=ok`、`migrations=39`，runtime image digest 保持 `bc3af60` 部署镜像，`/tmp/agenthub-hub-*.tar` 为 0。验证通过 `hub-server && go test ./internal/middleware -run "Test(CORSRejectsProductionLoopbackOrigin|ValidateCORSOriginsForEnvironment)" -count=1 -v`；本次未 build、未 restart。
- [x] 2026-05-29 AH-SR-027 Hub runtime event growth guardrail slice：`HandleTaskStream` 现在通过 capped transactional insert 写入 `agent_run_events`，默认 `MaxRunEventsPerTask=4096`；达到 per-task 上限后返回 `BAD_REQUEST`，并回滚 runtime event 与聊天投影 message，避免异常 Runtime/Edge callback loop 让 PostgreSQL 事件表和 replay 查询成本无界增长。验证通过红绿测试 `go test ./internal/service -run "TestHandleTaskStream(RejectsRunEventWhenTaskEventCapReached|PersistsTypedRunEventAndProjection|RejectsOversizedPayload|RejectsOversizedProjectedContent|RejectsOversizedEdgeRunID|_DispatchedTransitionConflictDoesNotPersist)" -count=1 -v`、`go test ./internal/repository ./internal/service ./internal/handler -count=1` 和 `hub-server && go test ./... -short -count=1`。commit `f0894ea` 已用 no-server-build tar/load/recreate 流程部署到 hk2，runtime image digest `sha256:c8a628ef41701bddfb1932b5c1234487f3854d14e652c32bee8efe993087f0ea`，tar SHA-256 `22949584df27819dbbbf23d50a036420123fdc014233698c88fb73438c4732ef`，生产 `/health` 为 `status=ok`、`migrations=39`，CORS loopback origins 403、official origin 204，Hub/PG/Redis 资源和 `/tmp/agenthub-hub-*.tar` 清理已复验。
- [x] **2026-05-26：`feat/web-agent-closeout-20260526` 已合入并删除本地/远端分支。** WebAgent 产出已成为 `dev/delicious233` 主线的一部分。
- [x] **2026-05-26：PR #197 已关闭。** 其中安全可独立验证的 `team-hub-authz`、`team-hub-reliability`、`team-adapter-compat` 已直接合入主线；Johnny 聚合分支因 migrations/API/process-executor-test 冲突保留单独审。
- [x] 2026-05-26 Web Hub-only boundary slice：删除 `app/web/src/api/eventClient.ts`、`edgeAuth.ts`、`hooks/useHubIntegration.ts`、旧 `useChatMessages.ts`、Local Edge status/event/runners hooks，权限弹窗类型迁到 `app/web/src/types/permissions.ts`；新增 `scripts/verify-web-hub-boundary.ps1` 并接入 runtime readiness，阻断浏览器端重新引入 Local Edge loopback、`/v1/runs` 或 `/v1/events`。Web `edgeClient.ts` 只保留显式 Hub-only/stubbed 兼容面。
- [ ] Web follow-up：继续把 Settings/Agent Market/Execution Target 面从 preview fallback 收敛到 Hub Agent Profile、registered Edge target 和 Hub task lifecycle；公开 Web 发布前补 BFF/HttpOnly cookie 或等价 server-owned session。Agent Profile 配置已能进入 runtime start request，下一步要补 registered Edge target/workspace allowlist 和运行时配置的 UI 可编辑闭环。
- [ ] Runtime history follow-up：Hub typed RunEvent 已有最小持久化、owner-scoped read API、Web replay/WS consumption 和 RunDetail 投影；2026-05-27 已补 `GET /web/agent-tasks/{id}/events` 的 `event_type` / `after_seq` / `limit` 查询过滤，以及 owner-scoped `GET /web/agent-tasks/{id}/events/summary`，汇总 task status、event counts、tool/step/artifact/approval、token、output bytes 和 elapsed runtime 指标。剩余：把 Edge/adapter 的 approval/artifact payload 继续统一到 AgentHub event shape，并让 Web/Desktop 消费 summary API。两个 Home 仍是低风险 product/docs OIDC 个性化站点，不作为 runtime 控制台；需要 runtime 展示时应深链到 AgentHub Web/Hub session。Edge 仍保留完整本地 EventStore，前端只消费 AgentHub 事件族，不直读 Codex/Claude Code/OpenCode 私有 JSON。bytedance.md 功能差距和竞品方向见 `docs/reference/cross-comparison/11-bytedance-feature-map.md`。
- [ ] Eight-scenario follow-up：当前不是 8/8。已完成 1（Desktop 本地离线），2（Desktop 本地在线）和 7（Web 中继当前 Desktop）仍需部署/截图/高信任 Web session 证据；3/4/5/6/8 远程/云执行场景仍未实现，下一批应优先做 registered Edge target、workspace allowlist、target health、Hub relay routing 和远程审批证明。
- [ ] Cherry/Aion UI reference follow-up：Cherry Studio 调研已补到 `docs/reference/projects/cherry-studio/`，AionUi 继续作为 action-first Home、team composition、runtime auto-detection、scheduling/approval ergonomics 的参考。下一批 UI 只借鉴可证明的交互模式：operational Home、Settings row/group primitives、typed message blocks、tool group waiting state、composer scopes、artifact preview；不复制 Cherry 的 renderer-as-SSOT、provider secret 持久化、Web 直连本地 Runtime 或第三方直接登录。
- [x] AgentTeam competitive roadmap follow-up：深度报告已合入（`13-agentteam-competitive-roadmap.md`、`14-product-direction-competitive-roadmap.md`）。AgentHub 长期定位收敛为 local-first multi-runtime Agent command center + Hub-governed collaboration fabric + Target network。当前 AgentTeam MVP 已在 `feat/agentteam-core` worktree 推进中：Hub 端 AgentTeam/TeamMember/TeamRun 模型、migration 0033、CRUD API、StartTeamRun 最小闭环。产品级完整 TeamRunState、typed CoordinatorRouteDecision、delegation guardrails、双真实 Runtime Profile 群组 E2E、聚合 transcript 和冲突处理仍在后续批次。
- [ ] Product direction competitive roadmap follow-up：综合产品方向报告已合入。四条产品主线（Runtime Workbench、AgentTeam Collaboration、Target Network、Agent Platform）已明确。下一批要优先让两个 Home 变成 operational console，而不是继续堆 marketing/preview 卡片。
- [ ] P2-P4 scenario roadmap follow-up：8 场景缺口不再作为普通 follow-up 管理，按产品主线拆为 P2A identity/session evidence（场景 2/7 部署态证据）、P2B enterprise foundation（org/project/workspace/team membership、resource/action authz、audit schema）、P3A registered Remote Edge（场景 3/4 target 注册/路由/远程审批/proxy）、P3B Cloud Edge lease（场景 5/6/8 workspace provider/lease/quota/session key）和 P4 Team Platform。
- [x] 下一批 worktree 建议（2026-05-26 上午）：
  - `feat/runtime-event-blocks-ui`：`app/web/src/utils/hubAdapters.ts`、Web/desktop RunDetail/ChatView/shared block primitives；验收 Web/Desktop focused Vitest + typecheck + Web-Hub boundary。
  - `feat/operational-home-console`：Web/Desktop Home surfaces、Agent/Profile/Target query composition、TokenDance ID session state；验收 Playwright 桌面/移动截图、无 raw i18n key、无浏览器直连 Local Edge。
  - `feat/artifact-lifecycle`：Edge event、Hub artifact index、Web/Desktop preview/apply/discard 权限和 provenance；验收 artifact 从 RunEvent 到 UI 可 replay。
  - `feat/run-config-snapshot`：固化 runtime version、profile/config version、ModelRoute、Skill/MCP version、target、approval policy 和 resolver 结果；验收任意历史 run 可解释当时为什么这样启动。
  - `feat/platform-profile-market`：Hub Profile store、Team template、Tooling Registry、ModelSpec/ModelRoute、cc-switch ProviderBinding masked metadata；验收安装/启用后 readiness 可解释且不泄露 secret。
  - `feat/agentteam-contract`：`hub-server/`、`api/`、Web/Desktop Hub clients 和 docs；落 AgentTeam/AgentTeamMember CRUD、owner boundary、Team Builder 空壳和 readiness summary。
  - `feat/teamrun-state-router`：`hub-server/`、`edge-server/`、`api/events.md` 和 docs；落 TeamRun/TeamTask/TeamEvent、TeamRunState projection、typed `CoordinatorRouteDecision`、max depth/active subagents/route repeats/budget/timeout guardrails。
  - `feat/teamrun-local-smoke`：Hub dispatch、Desktop bridge、Edge runtime execution、Web/Desktop TeamRun Console；验收 Codex + Claude Code 或 Codex + OpenCode 两个真实 Runtime Profile 的 local TeamRun smoke。
- [ ] Execution Target dispatch 拆分建议：
  - `feat/hub-target-id-dispatch-contract`：已完成 `/web/agent-tasks target_id` owner/type 校验、pending task 持久化、`agent.dispatch` 透传、OpenAPI/events 文档和 Web/Desktop client 类型；workspace allowlist 的实际执行仍由 Edge `/v1/runs.workDir` 护栏承担，target-bound route 仍未完成。
  - `feat/hub-edge-target-routing`：已完成 Hub dispatch/app/ws/cache/pending-task 切片；有 `target_id` 时按 target 绑定 `device_id` route 派发，离线队列按 target/device 隔离，禁止 fallback 到第一个 online desktop。2026-06-01 已补 Web task-entry target 选择和 Desktop bridge target evidence。仍未完成 Remote/Cloud target 的 relay/provisioning、设备证明、workspace allowlist 同步和远程审批证明。
  - `feat/runtime-typed-control-callbacks`：Edge hub callback、ProcessExecutor、adapter callback tests、Hub stream handler/service/app 和 API docs；把 Codex/Claude Code/OpenCode 的 `run.agent.*`、`run.output.batch`、permission/control event 统一以 `event_type + payload` 上报 Hub，继续持久化到 `agent_run_events` 并保持聊天兼容投影。
- [ ] Remote/Cloud productization 拆分建议：
  - `feat/p2-session-evidence-smoke`：真实 TokenDance ID login/logout/reconnect、Hub WS auth、Desktop/Web callback UX、Web 高信任 session 方案和截图证据。
  - `feat/org-workspace-authz-foundation`：org/project/workspace/team membership、permission key、Profile/Configuration 可见性、audit event schema；只做最小 RBAC，不做复杂策略语言。
  - `feat/registered-remote-edge-proof`：Remote Edge device proof、target health、workspace allowlist sync、target-bound dispatch、remote approval、preview/artifact proxy。
  - `feat/cloud-edge-lease-contract`：Cloud workspace provider、WorkspaceSpec、status state machine、startup grace、session key、quota、exposed URL policy。
	- [x] ADR-006 Agent 间通信模型已决策（2026-05-26）：Agent 间通信走结构化委派（TeamAssignment），不走自由聊天（IM message）。Hub 是 Agent 通信的单一事实源，Edge local MessageQueue 将弃用。IM 消息只作为可选的人可读投影。
	- [ ] AgentTeam 实现路线（按顺序）：
	  - `feat/agentteam-core`：✅ Hub 端 AgentTeam/TeamMember/TeamRun 模型、migration、CRUD API 与 StartTeamRun 最小闭环已落地。
	  - `feat/agentteam-assignment`：✅ TeamAssignment 模型、migration、CRUD、基础委派权限、最大深度/活跃任务/cycle guard 与状态机接口已落地。
	  - `feat/agentteam-run-state`：✅ TeamEvent model/migration、append/list repository、TeamTask 一等化、TeamRunState replay service 与 `GET /web/agent-teams/{id}/runs/{run_id}/state` 已落地并部署；TeamRun supervisor task 与 Assignment dispatch 已绑定真实 Hub pending task，TeamRunState 已合并 AgentRunEvent runtime 摘要、TeamTask dependencies、runtime budget projection、approval summary 和 artifact/file-change summary。
	  - `feat/agentteam-delegation-guard`：✅ typed `CoordinatorRouteDecision` Web 入口、accepted/rejected TeamEvent 审计、`MAX_TASKS_PER_TEAM_RUN`、`MAX_ACTIVE_SUBAGENTS_PER_RUN`、`MAX_ROUTE_REPEATS`、TeamRun budget、assignment timeout、Edge supervisor structured-output parser 与 Desktop auto-binding 已落地。
	  - `feat/agentteam-orchestrator-refactor`：Edge OrchestratorAdapter 不再自己做子 Agent spawn，改为输出 delegation 指令回 Hub，由 Hub 创建 TeamAssignment 并 dispatch。
	  - `feat/agentteam-local-smoke`：Hub→Desktop→Edge 完整 TeamRun，两个真实 Runtime Profile（Codex + Claude Code）的委派/聚合/审批 smoke。
	- [ ] 残留分支：`origin/dev/trump` 不作为可信进度来源；`feat/web-desktop-parity` / `origin/worktree-feat+web-desktop-parity` 与当前 WebAgent 主线大幅分叉，删除或 cherry-pick 前必须人工审 diff。

##### 文档架构 sweep `[并行]`

- [x] 2026-05-25 gpt-5.5 xhigh 文档 worker 已完成文档架构审查，结论已合并入本文档；`docs/inbox/` 仍保留为临时报告投递入口，处理后归档到 `docs/reference/` 或 `docs/archive/`。
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

#### 3.2.5 AgentTeam / 多 Agent 协作基础设施（~18-25 天）

> 参考：`docs/reference/cross-comparison/13-agentteam-competitive-roadmap.md`、`docs/reference/cross-comparison/03-orchestration.md`、`docs/reference/projects/aionui/`、`docs/reference/projects/cherry-studio/`、`docs/reference/projects/langflow-flowise/`。
> 口径：M3b 的 Edge local sub-agent spawn/registry/message queue/result aggregation 是 runtime 原型，不等于产品级 AgentTeam 完成。P1 要求 Hub-visible、可审计、可恢复的 AgentTeam / TeamRun / TeamTask / TeamEvent。

- [ ] **AT-1: AgentTeam 契约和 Team Builder 空壳** `[3-5d]` `[P1]`
  - Hub model/migration/API：`agent_teams`、`agent_team_members`、owner boundary、visibility、member role、target preference、budget/concurrency policy。
  - Web/Desktop：Settings 或 Workspace 中增加 Team list、member table、readiness summary；不做 canvas-first builder。
  - 验收：owner-scoped CRUD、跨 owner 403/404、Web Hub-only boundary、OpenAPI/events/docs 同步。

- [x] **AT-2: TeamRun / TeamTask / TeamEvent + TeamRunState** `[5-7d]` `[P1]`
  - Hub model/migration/API：`team_runs`、`team_tasks`、`team_events`；新增 `GET /web/team-runs/{id}`、`GET /web/team-runs/{id}/events` 或等价 read API。
  - Projection：从 TeamEvent / RunEvent 派生 `TeamRunState`，包含 members、tasks、dependencies、route decisions、approvals、budgets、terminal reason。
  - 验收：Hub/Edge replay 后 UI 可恢复同一个 TeamRun 的任务树和状态，不依赖内存 queue。
  - 2026-05-27 进展：Hub 已新增 `agent_team_tasks` model/migration、owner-scoped `GET /web/agent-teams/{id}/runs/{run_id}/tasks`、`agent_team_events` append/list、TeamRunState replay projection、state endpoint 和 events 读取 API；accepted route decision 会同步创建 TeamAssignment 与 TeamTask 并写 `team.task.created`。TeamRun supervisor task 现在使用真实 trigger message，Assignment dispatch 会创建 assignment prompt message、触发 Hub pending task、绑定 `agent_task_id` / `edge_run_id`，并在 TeamRunState 中从 pending task 同步 dispatched/running/done/fail 状态。TeamRunState 也会按 TeamTask/Assignment 绑定的 Hub task id 合并 `agent_run_events` 摘要，并从 `parent_task_id` 派生 dependencies、从 `run.agent.result` / context usage events 汇总 budget、从 `run.agent.permission_*` 派生 approvals、从 `run.agent.file_change` 派生 artifacts。当前后端 projection 覆盖 members、tasks、dependencies、assignments、route decisions、terminal reason、Hub task binding、Edge run id、runtime event 摘要、budget、approval summary 和 artifact/file-change summary；双真实 Runtime Profile 的 live 群组 E2E 归 AT-4 验收。

- [x] **AT-3: Structured Supervisor route + delegation guardrails** `[4-5d]` `[P1]`
  - 定义 `CoordinatorRouteDecision{next_worker,instructions,reasoning,finish,blocked_reason,correlation_id}`，新增 `team.route.decided` / `team.route.rejected` 事件。
  - 保留旧文本 JSON dispatch 兼容，但新 TeamRun 只消费 typed route。
  - Guardrails：`MAX_DELEGATION_DEPTH`、`MAX_ACTIVE_SUBAGENTS_PER_RUN`、`MAX_ROUTE_REPEATS`、`MAX_TASKS_PER_TEAM_RUN`、budget、timeout、ancestor/cycle reject、context budget、compact/checkpoint。
  - 验收：非法 route 被拒绝且可审计；重复委派、超深度、超预算不会启动 Runtime。
  - 2026-05-27 进展：Hub 已新增 `POST /web/agent-teams/{id}/runs/{run_id}/route-decisions`，合法 `delegate/review/approve` 会创建 `TeamAssignment` + `TeamTask` 并写 `team.route.decided` + `assignment.created` + `team.task.created`；非法 worker/schema/任务总数超限、同一 TeamRun 活跃 subagent 超限、重复 route 超限、TeamRun budget 超限和 active assignment 超时都会写 `team.route.rejected` 后返回 400。TeamRun supervisor dispatch 现在带 `structured_output_schema` 和 TeamRun context；Edge Claude NDJSON `structured_output` 会提升为 `run.agent.route_decision`，Desktop bridge 会用 `team_id/team_run_id/team_member_role` 自动 POST route decision，同时保留原 `RunEvent` replay。AT-4 仍需两个真实 Runtime Profile 的 live TeamRun smoke。

- [ ] **AT-4: Local TeamRun smoke with two real Runtime Profiles** `[4-6d]` `[P1]`
  - Dispatch：TeamTask 复用现有 Hub `/web/agent-tasks` 和 Desktop bridge，每个 task 绑定 Edge `run_id`。
  - Runtime：至少 Codex + Claude Code 或 Codex + OpenCode 两个真实 Runtime Profile 参与同一个 TeamRun。
  - UI：TeamRun Console 展示 task board、member status、subagent activity row、branch switch、typed team blocks、pending approval count、result blocks。
  - 2026-05-27 进展：Hub 后端 dispatch binding 已补齐到真实 `/web/agent-tasks` pending task；仍需 Desktop/Edge live smoke 证明两个真实 Runtime Profile 在同一 TeamRun 中完成委派与回传。
  - 验收：一个 TeamRun 可并行/串行派发两个本地 Profile，Hub 可 replay 全部 TeamEvent，Web/Desktop 可恢复状态。

- [ ] **AT-5: Artifact / Approval / Conflict 一等化** `[4-6d]` `[P1-P2]`
  - Artifact index 追溯到 member/task/run/tool；Approval 汇总到 TeamRun header；同文件多 agent 修改标为 conflict。
  - UI：side-by-side artifacts/diffs、result comparison、human decision gate。
  - 2026-05-27 进展：Hub `TeamRunState` 已将 approval/file-change runtime events 关联到 `team_task_id` / `assignment_id` / `member_id`，并从多个 member/task 对同一路径的 file-change 事件投影 `conflicts[]` 和 artifact `conflict_id`；新增 `POST /web/agent-teams/{id}/runs/{run_id}/conflicts/{conflict_id}/resolve`，把人工决策写入 append-only `team.conflict.resolved` TeamEvent 并在后续 replay 中标记 conflict resolved；新增 `agent_team_artifacts` DB index，将 artifact 追溯字段、source event、tool、normalized path 和 conflict_id 持久化，供后续 side-by-side/UI 查询；新增 `POST /web/agent-teams/{id}/runs/{run_id}/approvals/{approval_id}/decide`，校验 pending approval 后写入 append-only `team.approval.decided` TeamEvent，并返回可投递给 Edge `/v1/permissions/decide` 的 `edge_control` payload；Hub 侧已新增 exact-device `agent.control` / `permission.decide` 推送与 user/device 离线队列，缺 `edge_device_id` 时拒绝决策，禁止 fallback 到其它 Desktop；生产 compose 同步加入 Hub/PostgreSQL/Redis 内存、CPU、pids 与 Redis 连接池护栏。剩余：Desktop/Edge bridge 消费 `agent.control` 并实际 POST Edge `/v1/permissions/decide`、Web/Desktop side-by-side 决策 UI。
  - 验收：两个 Agent 同改一文件时 UI 标出冲突并要求人类决策；审批结果进入 Edge control、Hub audit 和 TeamEvent。

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
go tool cover -func=coverage.out | grep total          # CI 硬阈值 >= 75%
go run golang.org/x/vuln/cmd/govulncheck@latest ./...  # CI 硬阻断：零可利用漏洞
# gosec 当前在 CI 中 warning-only，可见但不阻断；发布审计再按 4.3 执行零 HIGH/MEDIUM

# Hub Server
go test ./... -count=1 -short -race -coverprofile=coverage.out ./...
# 不少于 5 个包有独立单元测试
go tool cover -func=coverage.out | grep total          # CI 硬阈值 >= 40%
go run golang.org/x/vuln/cmd/govulncheck@latest ./...  # CI 硬阻断：零可利用漏洞
# gosec 当前在 CI 中 warning-only，可见但不阻断；发布审计再按 4.3 执行零 HIGH/MEDIUM

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

- [x] CI 硬阻断：Edge/Hub `govulncheck` 零可利用漏洞
- [x] CI 硬阻断：`scripts/check-secrets.sh` 零密钥泄露
- [x] CI 可见债务：Edge/Hub `gosec` warning-only，结果必须在 Actions 中可见
- [ ] 发布审计：`gosec` 零 HIGH/MEDIUM
- [ ] 发布审计：`gitleaks` 零密钥泄露
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
| Web 前端 | WebAgent / Delicious233 | `dev/delicious233` | Web closeout 已合入；Trump/Web parity 残留分支单独审，不自动合 |

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

| 批次 | 模块 | Issue 数 | 工期 | 状态 |
|------|------|:--:|------|:--:|
| B1 | Auth / Token 安全 | 8 | 3d | ✅ 完成 (2026-05-25) |
| B2 | 数据完整性 / 并发 | 5 | 2d | ✅ 完成 (2026-05-25) |
| B3 | Edge 可靠性 / 错误处理 | 8 | 3d | ✅ 完成 (2026-05-25) |
| B4 | 输入校验 / 边界防御 | 10 | 3d | ✅ 完成 (2026-05-25) |
| B5 | Session / Group 生命周期 | 8 | 3d | ✅ 完成 (2026-05-25) |
| B6 | Desktop IM / Hub 对接 | 12 | 4d | 🔶 部分完成（纯后端已修，客户端待推进） |
| B7 | CI / 文档 / 清理 | 8 | 2d | 🔶 部分完成（4/8 待处理） |
| B8 | Enhancement / 产品方向 | 6 | — | 规划中 |
| **B10** | **后端服务强化（本轮新增）** | **19** | **—** | **✅ 完成 (2026-05-25)** |

> B1-B5 由 5 个 parallel team 在 2026-05-25 早前修复完成。B10 由 3 个 parallel team 在 2026-05-25 晚间修复完成。

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

**2026-05-26 Worker A CI 定位记录**：
- PR #199 合入后 `Cross-platform build (windows-latest)` 红灯定位到 `edge-server/internal/lifecycle` 的 `TestProcessExecutorPublishesOutputAndFinished`：Windows runner 实际 stdout 为 `"stdout chunk\n"`，测试期望包含动态 `run=run_TestProcessExecutorPublishesOutputAndFinished_...`。
- 同一 run 的 go-edge、go-hub、ubuntu/macOS cross-build、frontend、validate 均通过；该问题属于 Edge Go 后端测试跨平台断言/命令输出差异，不在本轮 `api/**`、`docs/**`、`app/shared/**` 修复范围内，后续由 Edge/CI worker 在 `edge-server/internal/lifecycle/process_executor_test.go` 或 CI Windows 命令路径收口。

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

### 7.9 B9: S3 对象存储接入（2026-05-29，✅ 完成）

**目标**：附件存储支持 S3 兼容对象存储（中国科技云 / 自部署 MinIO）。

| 子任务 | 文件 | 方案 |
|--------|------|------|
| S3 config | `hub-server/internal/config/config.go` | `S3Config{Endpoint, AccessKey, SecretKey, Bucket, Region, UseSSL}` 已接 `AGENTHUB_S3_*` 环境变量；配置不完整时 startup validation fail fast |
| Storage 分层 | `hub-server/internal/service/attachment.go` / `s3_client.go` | `Upload()` 通过 `ObjectStorage` 分流：未配置 S3 时使用本地 `Upload.Dir`，配置后使用 S3-compatible `PutObject` |
| go.mod | `hub-server/go.mod` | 已加入 AWS SDK v2 S3 依赖 |
| 部署配置 | `hub-server/deployments/.env.production.example` / `docker-compose.prod.yml` | 生产 env 模板与 compose 已传入 `AGENTHUB_S3_ENDPOINT`、`AGENTHUB_S3_BUCKET`、`AGENTHUB_S3_ACCESS_KEY`、`AGENTHUB_S3_SECRET_KEY`、`AGENTHUB_S3_REGION`、`AGENTHUB_S3_USE_SSL` |
| 回退兼容 | — | 无 S3 配置时继续使用本地 `Upload.Dir`；配置 S3 后不要求本地 upload dir 存在，避免大附件继续压 hk2 根盘 |

**验收**：未配置 S3 时行为不变；配置 S3 后附件写入 S3-compatible object store；hash object 写入使用 `If-None-Match: *`，已存在对象不覆盖；S3 初始化失败不再静默回退本地盘。验证通过 `go test ./internal/config -run "Test(EnvOverrideS3Config|S3Config_IsConfigured|S3Config_IsEmpty|ValidateS3ConfigRequiresCompleteCredentials|ValidateS3ConfigDoesNotRequireLocalUploadDir)$" -count=1 -v`、`go test ./internal/service -run "Test(LocalStorage_PutAndGet|S3Storage_LocalPathReturnsEmpty|S3Storage_PutReturnsTrue|S3Storage_PutReturnsFalseWhenBlobAlreadyExists|SaveAttachment_StorageInjection)$" -count=1 -v`、`go test ./internal/config ./internal/service ./internal/app -count=1`、`go test ./... -short -count=1`、`docker compose -f deployments/docker-compose.prod.yml --env-file deployments/.env.production.example config --quiet` 和 `git diff --check`。commit `bc3af60` 已用 no-server-build tar/load/recreate 流程部署到 hk2，生产 S3 env 当前为空、按设计继续使用本地 upload 行为；health `status=ok`、`migrations=39`，公网 `/metrics`、`/debug/pprof/`、`/does-not-exist` 仍为 404，tar 已清理。

---

### 7.10 B10: 后端服务强化（2026-05-25，19 fix，3 Team 并行）

**Team 1 — Hub Core Service（5 commits）**: `feat/team-hub-core-service`

| # | Issue | 修复 |
|---|-------|------|
| 154 | Update session last_message_at | `allocateSeq` 在 Redis seq 分配后 touch session |
| 132 | Expire running agent tasks | `ScanExpiredTasks` 纳入 `running` 状态 |
| 159 | Allow clearing contact remarks | 空字符串备注合法化 |
| 120 | Contact remark update error | `UpdateRemark` 0 行影响 → 404 |
| 157 | Honor message search filters | 支持 content_type + 时间范围过滤 |
| 122 | Align private-session with friendship | `CreatePrivateSession` 前校验好友关系 |

**Team 2 — Agent + Edge Callbacks（3 commits）**: `feat/team-agent-edge-callbacks`

| # | Issue | 修复 |
|---|-------|------|
| 130 | Non-duplicating stream-to-message | `HandleTaskStream` 通过 `client_msg_id` 幂等去重 |
| 109 | Task lifecycle enforcement | `done`/`fail` 只接受 `running`/`dispatched` 状态 |
| 99 | Offline-replayed task dispatch | `HandleTaskAck` 接受 `queued` → `dispatched` 转换 |
| 132 | Running task heartbeat | `BumpRunningTaskExpireAt` 每次 stream 刷新 TTL |
| 154 | Session refresh on agent output | `TouchSessionLastMessage` on stream/done |
| 137 | Offline queue failure surface | `PushPendingTask` 错误记录 Error 日志 |
| 179 | NDJSON parse failure | `parseErr` 传播，run 标记 failed |
| 177 | CLI availability detection | `exec.LookPath` 检测，unavailable 上报 |
| 108 | Cancel response alignment | 缺失 run → 404，terminal run → 200 |

**Team 3 — WS + Auth + Middleware（1 commit）**: `feat/team-ws-auth-middleware`

| # | Issue | 修复 |
|---|-------|------|
| 178 | WS routes for multi-device | `byUser` 改用 `connID` 索引 |
| 96 | Recall only to original session | 事件处理器仅推到 `msg.SessionID` |
| 93 | Mark-read sequence validation | `lastReadSeq > member.LastReadSeq` 才推进 |
| 88 | Typing sender membership | 广播前校验发送者是 session member |
| 78 | Session cache after DeleteForMe | `DeleteForMe` 新增 member cache 失效 |
| 82 | WS auth alignment | `ServeWS` 复用 Gin middleware 认证上下文 |

**验证**：hub-server 13/13 全绿，edge-server 15/15 全绿，`go test -race` 通过。

---
### 7.11 剩余待处理

**纯后端（0 个）**：

| # | Issue | 优先级 |
|---|-------|:--:|
| — | — | — |

**B7 剩余（4 个，客户端相关）**：#181, #180, #71, #114
**B6 剩余（9 个，Desktop IM/Hub 对接）**：#123, #121, #119, #118, #125, #126, #102, #106, #150

---

### 7.12 修复策略

1. **按批次顺序推进**：B1 → B2 → ... → B7，不跨批次跳跃
2. **每批次一个 PR**：10 个左右 Issue → 一个 PR，方便 review
3. **先写测试，再修代码**：每个 Issue 补一个失败测试 → 修代码 → 测试变绿
4. **CI 硬阻断**：`go test -race ./...` + `pnpm test` 必须全绿
5. **每日收尾**：当天修完的批次当天 commit + push

---

## 8. 仓库治理（2026-05-27）✅ 已完成 → v0.1.0 发布

> 驱动文档：审计报告见各 task，修复按批次推进。

| 批次 | 范围 | 状态 |
|------|------|:--:|
| Batch 1 | CRITICAL 安全——生产 IP + OIDC client ID 脱敏 | ✅ 完成 |
| Batch 2 | HIGH——服务器别名替换、配置修正、脚本修复 | ✅ 完成 |
| Batch 3 | API 契约——OpenAPI 幽灵端点、events.md 补齐 | ✅ 完成 |
| Batch 4 | 文档——死链修复、术语更新、孤儿文件 | ✅ 完成 |
| 发版 | Release pipeline（scripts/release.ps1 + CI workflow） | ✅ 完成 |
| 架构审计 | 迁移数修正、Hub 完整实现措辞、runners 包澄清 | ✅ 完成 |
| 竞品研究 | Teamily AI/Dust/SageOx 新入局、AgentTeam 加速建议 | ✅ 完成 |
| 部署修复 | restore-db.sh 格式匹配、rollback 文档、.dockerignore | ✅ 完成 |
| Trump PR #219 | 共享模块（workbenchState/dataMode/hubClient）+ SettingsPage 拆分——已合并 | ✅ 完成 |
| Trump PR #220 | Desktop IM 系统（useIMChat/IMView/IMContactList +10 功能）——已合入 | ✅ 完成 |
| PR #217 | Trump dev/trump→dev/delicious233——已关闭（冲突 33，拆分为 #219 #220） | ✅ 已处理 |
| 类型修复 | IM types/HubNotification/Session 字段补齐——Desktop typecheck 通过 | ✅ 完成 |
| 测试覆盖 | hub 整体 48.2%（CI 门槛 40%）、edge 整体 75.7%（CI 门槛 75%）——均通过 | ✅ CI 合规 |
| 文档收尾 | hub README 迁移数/Redis端口修正、desktop README 绝对路径清除、PR 模板 runner→desktop/hub、errcode 40→100% | ✅ 完成 |
| Trump PR #221 | Web 页面——Workbench/AgentSquare/Chat/Group/Project 真实 API + i18n——已合并 | ✅ 完成 |
| Trump PR #222 | 玻璃态 Select 组件——已审查，3 个阻塞项待修（rebase + 测试 + tokens） | ⏳ 待修改 |
| 全量健康 | 36 commits、Desktop 697/712、Web typecheck ✅、Mobile 2 tests | ✅ 通过 |

### 后续方向

> 全量健康检查 2026-05-28：hub (13/13 ✅) · edge (15/15 ✅) · Desktop (697/712, 13 修复, 15 预存/用户新测试) · Web (9, 31 ✅) · Mobile (1, 2 ✅) · OpenAPI YAML ✅ · TS typecheck ✅

| 方向 | 建议 | 优先级 |
|------|------|:--:|
| 工作树提交 | ~120 个未提交文件——桌面/移动端活跃开发改动，需用户 commit | **阻塞** |
| AgentTeam 加速 | 竞品压力（AionUI 团战、Claude Teams）——设计文档已写，待开发 | High |
| 远程 Edge PoC | 演示 Hub 中继到第二台 Desktop——证明架构不是空文档 | Medium |
| 跨会话记忆 | Codex Memory 预览已上线——AgentHub 需要 profile 级记忆 | Medium |

---

## 9. 参考文档索引

| 类别 | 文档 | 用途 |
|------|------|------|
| **审计** | `docs/archive/review-archive/edge-server-audit.md` | Edge 13 项发现（S1-S13） |
| | `docs/archive/review-archive/hub-server-audit.md` | Hub 22 项发现（P0-1 ~ P3-9） |
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
