# AgentHub 路线图

> 最后更新: 2026-06-05 (五维 Review + 七项深研 + 比赛评审评估) | 唯一事实源 | 旧版归档: [archive/roadmap-v2-pre-restructure-20260605.md](archive/roadmap-v2-pre-restructure-20260605.md)

## 课题目标

构建 IM 形态的多 Agent 协作平台。用户像用飞书/微信一样与 AI Agent 交互：
- 单聊/群聊对话，@Agent 分派任务
- Orchestrator 自动协调多 Agent 协作
- Agent 回复内联 Diff、预览、附件等富媒体
- 统一适配器接入 Claude Code / Codex / OpenCode
- Desktop (Tauri) 为主力端

**考察维度**: AI 协作能力 30% | 功能完整度 25% | 生成效果 20% | 代码理解 15% | 创新与产品感 10%

**交付物**: 产品设计文档 + 技术文档 + 可运行 Demo + AI 协作开发记录 + 3 分钟 Demo 视频

---

## 总体进度

```
Phase A: 工程基础设施 ████████████  70%  ← 当前 (A0/A1/A2/A3 ✅, A4 部分完成, A5/A6 待开始)
Phase B: 持久化 + 性能  ░░░░░░░░░░   0%
Phase C: IM 核心闭环   ░░░░░░░░░░   0%
Phase D: 高级功能      ░░░░░░░░░░   0%
```

### Phase 依赖关系

```
A (基础设施) ──→ B (持久化 + 性能) ──→ C (IM 闭环) ──→ D (高级功能)
     │                                      ↑
     └── App.tsx 拆分 (A4) ──────────────────┘ 前端解耦是 IM 开发前提
```

### 分支策略

- `master` — 受保护，只接受 PR
- `dev/delicious233` — 主开发分支，日常 commit 目标，定期 PR → master
- `phase-aN/xxx` — 临时 feature 分支，在 `.worktrees/` 下开发，完成后合回 dev 后删除
- 协作者分支 (`dev/johnny`, `dev/trump`) — 独立开发线

---

## Phase A: 工程基础设施 + 安全修复

> **目标**: 建立可观测性基座（错误码/日志/调试），修复安全与稳定性隐患，解耦前端开发瓶颈
>
> **入场条件**: ✅ v0.2.0 已发布，架构剖析已完成
> **出场条件**: Edge/Hub 统一错误码 + 请求追踪 + 调试端点；无凭据泄漏；App.tsx 拆为独立模块

### A0: 错误码体系收口 `errcode` ✅

- [x] 共享 `pkg/errcode` 模块 + `go.work` workspace
- [x] Hub 迁移完成：统一 envelope `{"error":{"code":"...","message":"...","traceId":"..."}}`
- [x] Edge 域错误码 — 14 个 Edge 专属错误码（EXECUTOR_UNAVAILABLE 等）
- [x] Edge handlers 重构 — 删除 `errorResponse()`，52 个调用点改用 errcode
- [x] 前端适配 — `app/shared/src/errors.ts` 已兼容，零改动

### A1: 请求日志与追踪 `reqlog` ✅

- [x] `pkg/reqlog` 共享中间件 — trace ID 生成/传播，统一字段（request_id/method/path/status/duration_ms）
- [x] Edge 接入 — `reqlog.AccessLog` 替换现有 AccessLog 中间件
- [x] Hub 接入 — `reqlog.AccessLogGin()` 统一已有 RequestID + AccessLog
- [x] 跨服务追踪 — Edge→Hub API 透传 X-Request-ID（Hub RequestID 中间件复用）

### A2: 调试端点 `debug` ✅

- [x] `pkg/debug` 模块 — 统一注册接口 + 认证辅助（BasicAuth / BearerToken）
  - `MuxConfig` 结构体：HealthChecker / EnablePprof / MetricsHandler / ConfigDumper / StateDumper / Auth
  - `RegisterEndpoints(mux, cfg)` — 注册 /health, /ready, /debug/pprof/*, /metrics, /debug/config, /debug/state
  - `BasicAuth` + `BearerAuth` — 认证辅助 + `SanitizeConfig` 递归脱敏
  - 11 个测试覆盖全部端点 + 认证 + 脱敏
- [x] Hub `/debug/` — 用 pkg/debug 替换 `app.go` 的 `newAdminMux()`
  - 保留独立 admin 端口 + `AGENTHUB_PPROF_USER/PASS` BasicAuth 认证
  - 新增 `/debug/config` — SanitizeConfig 脱敏（DB/Redis/JWT/S3/TokenDanceID 各字段）
  - 新增 `/debug/state` — DB pool stats + WS connections
- [x] Edge `/debug/` — 在 `httpserver.Run()` 的 mux 上注册
  - 新增 pprof — dev 环境无认证，生产 BearerAuth(LocalAuthToken)
  - 新增 `/debug/config` — 脱敏（LocalAuthToken / HubJWTSecret / HubToken）
  - 新增 `/debug/state` — store 统计（project count）+ bus 状态（history_len）
  - 去重 `/metrics` — 统一走 debug 模块，带 auth 保护

### A3: 安全与稳定性 P0 修复 ✅

- [x] **Edge auth token 明文日志** — `slog.Info` → `slog.Debug`，前缀 16→8 字符
- [x] **Edge FileStore async persist** — 同步 persist → 异步 50ms debounce + background goroutine + `Close()`/`Flush()`
- ~~Hub workspace schema 不一致~~ — 验证 0016 migration 已完整桥接，误报关闭

### A4: 前端架构解耦 🔧

> **关键路径**: App.tsx 拆分是 Phase C (IM 闭环) 的前置条件。

- [x] **App.tsx 拆分 Wave 1** — 1837→1525 行（-17%），已拆出 ShellIconButton、useFocusSourceTracking、DesktopHubTaskBridge、TopMenuBar、useShellShortcuts
- [x] **lazy-load** — SettingsPage、AuthPage、HomeDashboard 已改为 `React.lazy()`
- [ ] **Wave 2 拆分** — 目标 1525→~926 行（-39%），7 个自定义 Hook：
  - [x] `useHiddenMessages.ts` — 隐藏消息 ID 管理 30 行（低难度）✅
  - [x] `useSidebarResize.ts` — 侧边栏拖拽缩放 40 行（低难度）✅
  - [x] `useThreadCache.ts` — React Query 缓存操作 37 行 + 4 个 ref（低难度）✅
  - [ ] `useTopMenuConfig.ts` — 菜单定义 221 行（低难度，优先）← 下一步
  - [ ] `useDesktopCommands.ts` — 窗口/编辑/诊断命令 80 行（中难度）
  - [ ] `useThreadNavigation.ts` — 线程选择/创建/搜索 75 行（中难度）
  - [ ] `useSendRun.ts` — 发送/启动 run 116 行（高难度，最后）
  - 执行顺序：E→F→G→A（阶段1低风险）→ D→C（阶段2）→ B（阶段3核心）
- [ ] **Rust 后端基础测试** — commands.rs / oidc_server.rs 核心路径覆盖

### A5: 开发者构建体验

- [x] 移除 keyring v4 重依赖（-213 crate）
- [x] Cargo dev profile 优化（`opt-level=1`）
- [x] 前端 vendor bundle 拆分
- [ ] Edge 自动构建 — `tauri dev` 检测 edge-server 变更自动 `go build`
- [ ] sccache / CI 缓存共享
- [ ] 开发文档 — 冷启动预期、前置依赖、troubleshooting

### A6: Review 发现的安全加固（新增）

> 来自 2026-06-05 五维度深度 Review + 七项深研。
> 优先级排序：API 密钥(P0) > 统一信封(P1) > DB TLS(P1) > .env 加固(P2)

- [ ] **API 密钥迁移到 secure_store** (P0 — 最高安全优先)
  - 当前: `modelSettingsStore.ts` 的 `obscureApiKey`/`revealApiKey`（base64 + 静态 salt `ah-creds-v1`，167-188 行）
  - 目标: `secure_store.rs` 已有 keyring 集成（当前仅存 Hub 令牌），新增 `store_model_credential`/`read_model_credential`/`clear_model_credential`
  - 迁移: Zustand store 初始化时检测 localStorage 旧格式 → 写入 keychain → 清除 localStorage
  - Web 端无 `ProviderCredential` 字段，不受影响
- [ ] **统一响应信封** (P1 — 低风险，Edge 对齐 Hub)
  - Hub: `handler/response.go` 的 `OK(c,data)` 返回 `{code:"OK", data:...}`，19 个 handler 文件使用
  - Edge: `api/handlers.go` 的 `writeJSON` 直接返回裸 JSON，约 23 处成功返回点
  - 方案: Edge 加 `successResponse(data)` wrapper，前端 `edgeClient.ts` 加 `unwrapEdgeResponse`
  - 错误格式已统一（共享 `pkg/errcode`），仅成功格式需对齐
- [ ] **DB TLS 可配置** (P1 — ~20 行改动)
  - `config.go:73-76` 的 `DSN()` 硬编码 `sslmode=disable`
  - `DBConfig` 新增 `SSLMode` 字段，默认 `"disable"` 保持向后兼容
  - `Validate()` 加有效值校验，`Load()` 加 `AGENTHUB_DB_SSLMODE` 环境变量覆盖
  - 更新 3 个 `.env.example` 文件
- [ ] **.env 密钥轮换 + secret guard 加固** (P2 — 增量改进)
  - 密钥轮换: 轮换 .env 中真实云服务密钥；`config.go` `Validate()` 扩展弱密码拒绝到 DB/Redis/TokenDanceID
  - pre-commit 加固: 新增 `scripts/git-hooks/pre-commit` 调用 `check-secrets.sh --staged`（当前仅在 commit-msg 运行）
  - Secret Guard 扩展: 增加 base64 解码检测、二进制密钥文件检测（`*.p12`/`*.jks`）

---

## Phase B: Edge 持久化 + 性能治理

> **目标**: Edge 从内存临时态升级到 SQLite 持久化；修复 Hub 性能瓶颈；大文件拆分提升可维护性
>
> **入场条件**: Phase A 出场（错误码 + 日志 + 调试 + P0 修复完成）
> **出场条件**: Edge 重启不丢数据 + FTS5 搜索；Hub 无 N+1 查询 + 全索引覆盖

### B0: Edge SQLite 持久化

当前 Edge 用内存 + JSON 快照（FileStore），重启丢数据、无搜索、无同步。升级为 `modernc.org/sqlite`（纯 Go，FTS5 内置，无 CGO）。

- [ ] JSONL 事件流 — append-only 日志替代 JSON 快照，写操作先 append 再更新内存
- [ ] SQLite Schema — projects / threads / runs / items 四张表 + 索引
  - 现有接口 `store.Reader` / `store.Writer` / `store.Repository` 保持不变，上层零改动
  - 当前内存结构：`map[string]*Project` + `map[string]*Thread` + `map[string]*Run` + `map[string]*Item`
  - FileStore 消费者：`api/handlers.go`（读写）、`lifecycle/process_executor.go`（写）、`events/bus.go`（读）
- [ ] FTS5 搜索 — `session_messages_fts` 虚拟表，BM25 排序，`snippet()` 高亮
- [ ] 数据迁移 — 启动时检测旧 JSON 快照，自动导入 SQLite
  - 回退方案：检测 SQLite 损坏时 fallback 到 JSON 快照或空 store

> 参考: `docs/archive/build-specs-backend-03-eventstore-memory.md`

### B1: Edge 离线与同步

- [ ] 离线队列 — Hub 断连时写操作入队，重连后批量同步
- [ ] Cursor 同步协议 — `?cursor=<last_seq>` 增量拉取

### B2: Hub 性能治理

- [ ] **N+1 查询 — Session list correlated subquery** (`repository/session.go:54-79`)
  - `ListUserSessions` 和 `SearchSessions` 的 `(SELECT COUNT(*) FROM session_members WHERE session_id = s.id)` 逐行执行
  - 修复: 改为 `LEFT JOIN (SELECT session_id, COUNT(*) GROUP BY session_id) mc ON mc.session_id = s.id`
- [ ] **N+1 查询 — StartTeamRun 逐条查 CustomAgent** (`service/agent_team.go:323-334`)
  - for 循环内逐个 `GetCustomAgentByID` 做鉴权，同函数后半段已正确批量查询
  - 修复: 批量查询提前到鉴权循环前，`WHERE id IN ?` 一次取出，构建 map 复用
- [ ] **N+1 查询 — dispatchTask 逐次查 CustomAgent** (`service/agent.go:445-452`)
  - 每个 dispatch goroutine 独立查询，TeamRun 并发场景形成隐式 N+1
  - 修复: `TriggerAgentTask` 预查询 CustomAgent，通过参数传入 `dispatchTask`
- [ ] **缺索引 — GORM model tag 缺 index 标记**（migration SQL 已有索引，但 AutoMigrate 路径会丢失）
  - `agent_team_tasks.team_run_id` — `model/agent_team.go:172`
  - `agent_team_assignments.team_run_id` — `model/agent_team.go:126`
  - `notifications.user_id` — `model/notification.go:21`
  - 修复: 补 GORM `index:` tag + 新增 `0041_ensure_performance_indexes` migration（IF NOT EXISTS）
- [ ] **migration 双系统统一** — golang-migrate 唯一生产路径（`repository/migrate.go:15`），AutoMigrate 仅在测试中使用
  - 风险: model tag 和 migration SQL 默认值/FK/索引可能不同步
  - 修复: model 包加文档注释声明 golang-migrate 唯一性；清理测试中的 `db.AutoMigrate()` 调用；CI 加 migration 完整性检查

### B3: 大文件拆分

- [ ] **Hub agent.go** — 1371 行 → 5 个文件（同 package，无新接口）
  - `agent.go` — 保留核心：struct + 构造 + `AddAgentToSession` + `allocateSeq` + 6 个仓库包装（~200 行）
  - `agent_custom.go` — CustomAgent CRUD：Create/Get/List/Update/Delete（~80 行）
  - `agent_dispatch.go` — 任务调度全链路：TriggerAgentTask + dispatchTask + CancelTask + 辅助函数（~500 行）
  - `agent_edge_callback.go` — Edge 回调：HandleTaskAck/Stream/Done/Fail + authorizeTaskEdgeCallback（~310 行）
  - `agent_run_event.go` — 运行时事件查询 + 校验：ListTaskRunEvents + summarizeAgentRunEvents + normalizeRunEventInput（~310 行）
- [ ] **Edge ProcessExecutor** — 1413 行 → 4 个文件（同 package，无新接口）
  - `process_executor.go` — 保留核心：struct + Start/Cancel/run + envForRun + finish + publishFailed/Cancelled（~500 行）
  - `process_output.go` — 输出聚合：publishOutput + publishStructuredOutput + runOutputLimiter + threadTranscriptEmitter（~250 行）
  - `process_hub_callback.go` — Hub 回调：fireHubAck/Stream/Done/Fail + hubCallbackEmitter + hubOutputCollector（~350 行）
  - `process_subagent.go` — 子 Agent 编排：SpawnSubAgent + sendSubAgentResult + childBudget（~170 行）

### B4: Edge 行为修正

- [ ] **双重 dispatch 路径统一** — `orchestrator.go` text scan + `orchestrator_dispatch.go` NDJSON event 两条路径 → 统一
- [ ] **Output 截断通知** — stdout/stderr 1MB 截断时发 `run.output.truncated` 事件

---

## Phase C: IM 核心闭环

> **目标**: 打通 IM 核心工作流，Desktop 前端可用，Agent 操作可视化
>
> **入场条件**: Phase B 出场（Edge 持久化完成 + App.tsx 已拆分）
> **出场条件**: 用户可以在 Desktop 中与 Agent 进行完整的 IM 对话

### C0: 对话核心

- [ ] 对话列表 — 新建/置顶/归档/搜索，按最近活跃排序
- [ ] 单聊模式 — 选中联系人/Agent → 1v1 对话
- [ ] 群聊模式 — 创建群组 → 邀请多 Agent → @Agent 分派任务
- [ ] 消息类型 — 文本、代码块、图片、文件附件、Diff 视图卡片、网页预览卡片
- [ ] 消息操作 — 回复、引用、复制代码、展开预览
- [ ] 上下文管理 — 聊天历史自动传递，支持 pin 关键消息

### C1: Agent 可视化

- [ ] Agent 运行状态 — 思考中/工具调用中/生成中等实时指示
- [ ] 工具调用可视化 — ToolUseBlock 展示工具名、参数、结果
- [ ] 代码 Diff 内联 — Agent 产出代码时展示 Diff 视图卡片，一键应用
- [ ] 文件操作可视化 — Agent 读写文件的实时展示
- [ ] 多 Agent 并行流 — 群聊中多 Agent 依次/并行回复的可视化
- [ ] 审批面板 — 高风险操作弹窗确认

### C2: 前端打磨

- [ ] 对话列表 UI — 未读计数、最后消息预览、在线状态
- [ ] 消息气泡 — 头像、时间戳、发送状态、Agent 标识
- [ ] 输入体验 — @Agent 弹窗选择、文件拖拽、快捷键
- [ ] 侧边栏 — 会话/联系人/Agent 商店导航
- [ ] 响应式适配 — 窄屏/宽屏自适应

### C3: Orchestrator 协调器

- [ ] 意图理解 + 任务拆解 — 群聊模式自动理解用户意图
- [ ] 子 Agent 调度 — 并行调度，失败降级
- [ ] 产出聚合 — 子 Agent 完成后在聊天流中汇报
- [ ] 冲突处理 — 多 Agent 修改同一文件时的冲突检测

---

## Phase D: 高级功能

> **入场条件**: Phase C 出场（IM 闭环可用）
> **目标**: 产品差异化与生态扩展

### D0: 代码生成与 API 契约

- [ ] OpenAPI spec → 类型生成 — 消除手工维护 openapi.yaml + types.ts 的漂移
- [ ] shared API client 共享 — desktop/web/mobile 统一 HTTP client

### D1: 安全增强

- [ ] Hub OIDC blacklist 写入失败补偿 — Redis 不可用时旧 refresh token 可被重放
- [ ] Edge `internal/runners` 死代码清理 — 仍在 `httpserver/server.go` 被 import
- [ ] Hub 端点加 `/v1/` 版本前缀（或显式文档声明策略）— 当前 Hub 用 `/client/`/`/edge/`/`/web/` 无版本
- [ ] Release workflow 加分支限制 — `release.yml` 任何分支推 `v*` tag 都触发发布
- [ ] 收紧 golangci-lint + gosec 为硬阻断 — 当前 `continue-on-error: true` 无约束力
- [ ] Tauri CSP 策略收紧 — `connect-src` 端口通配符改为具体端口（3210/8080），移除 `unsafe-inline`
- [ ] macOS CI 测试取消 `continue-on-error` — 或明确记录跳过原因
- [ ] 配置 Renovate/Dependabot + CODEOWNERS

### D2: 产品扩展

- [ ] 部署发布 — 聊天中"部署"指令，返回部署状态卡片
- [ ] Agent 商店 — 搜索、安装、使用自定义 Agent
- [ ] 版本历史 — Checkpoint + Diff 对比 + 回滚
- [ ] Mobile 轻量端 — 查看/审批/预览
- [ ] Content Pool — SHA-256 + zstd 文件内容去重
- [ ] 远程 Edge — SSH / Tailscale / Hub Relay 连接远程 Desktop

---

## Quick Wins

> 不依赖特定 Phase，发现即修。trivial 修复直接执行，无需等 Phase 排期。

- [x] ~~Desktop OIDC 超时不一致~~ — `CALLBACK_TIMEOUT_SECS` 60→300，对齐 "5 minutes" 消息
- [x] ~~Desktop Edge 端口硬编码~~ — 提取 `DEFAULT_EDGE_PORT` 常量（Rust 侧）
- [ ] 补齐 OpenAPI 缺失端点（文档-代码漂移）：
  - `GET /v1/model-catalog` — 代码已实现，OpenAPI 完全缺失
  - `GET /v1/agent-instances/{id}` — 代码已实现，OpenAPI 仅定义集合端点
  - `DELETE /v1/threads/{threadId}` — 代码已实现，OpenAPI 路径定义缺失（头注释提及但无路径）
  - `POST /v1/threads/{threadId}:archive` — 代码已实现，OpenAPI 标记 planned（不准确）
  - `POST /v1/agent-instances` — OpenAPI 标记 implemented 但代码只注册 GET（自相矛盾）
  - `POST /cloud/edge/register` — Hub 代码已实现（router.go:174），OpenAPI 完全缺失
  - `GET /client/auth/oidc/callback` — Hub 代码已实现（router.go:69），OpenAPI 缺失
- [ ] 修复事件文档漂移（events.md vs 代码）：
  - `run.agent.sub_agent_status` — 代码用此名，文档定义为 `sub_agents_complete`（语义不同）
  - `run.agent.task_dispatch_failed` — 代码中发布，events.md 完全缺失
  - `friend.accepted` — 文档列为可用事件，代码从未发布（缺 "not yet emitted" 标记）
  - `message.delta` — 文档标 P0 但从未实现，建议降级为 P1
- [ ] Web 包定位决策 — 当前 App.tsx 仅 13 行空壳，但基础设施 ~32K 行已就绪（~80%）
  - 推荐：轻量 wiring（5-8 天），接入 slot 机制 + Hub 连接 + IM 消息流，暂缓未实现功能

---

## 已完成

| 批次 | 内容 | 完成日期 |
|------|------|:-------:|
| P0-P3 | Edge 24 消息类型 + Markdown + 线程管理 + Bundle 优化 | 2026-05 |
| M3b | AgentHook + 消息树 + 安全管道 + Context Budget | 2026-05 |
| M4 | Hub 骨架 + OpenCode/Codex E2E + 权限门控 | 2026-05 |
| M5 | 工程基础收敛: Edge race/metrics, Hub DI, Desktop 虚拟滚动 | 2026-05-24 |
| M6 | 生产部署: Docker + nginx + Cloudflare + 安全加固 | 2026-05-24 |
| M7 | Desktop P0: TanStack Query + RunState + 心跳 + viewRegistry | 2026-05-24 |
| M8 | 安全审计: 129 Issues 修复，纯后端清零 | 2026-05-27 |
| W22 | Desktop UI 大打磨: 40+ 验收项，Mobile/Web 对齐 | 2026-05-30 |
| 文档体系 | ADR 11 篇 + 竞品调研 25 项目 + 架构三合一 | 2026-06-02 |
| v0.2.0 | Sidecar edge + Updater + NSIS/DMG + 安全加固 + CI 签名 | 2026-06-05 |
| 构建优化 | 去除 keyring turso/tantivy（-213 crate）+ dev profile + bundle 拆分 | 2026-06-05 |
| 架构剖析 | Edge / Desktop / Hub / 集成层全面审查，P0×4 + P1×8 + P2×6 | 2026-06-05 |
| 全局死链清理 | 20 文件 docs/tutorials→docs/roadmap 等路径修复 + 端口 5199→5173 | 2026-06-05 |
| 错误码统一 (Hub) | pkg/errcode 共享模块 + Hub re-export + 统一 envelope + traceId | 2026-06-05 |
| 安全修复 | Orchestrator bypassPermissions 硬编码移除 | 2026-06-05 |
| **A0 Edge errcode** | 14 域错误码 + 52 handlers 调用点重构 + 前端已兼容 | 2026-06-05 |
| **A1 请求日志** | pkg/reqlog + Edge/Hub 接入 + context ID 传播 + 6 tests | 2026-06-05 |
| **A3 P0 安全** | Auth token Debug 日志 + FileStore async persist (50ms debounce) | 2026-06-05 |
| **A2 调试端点** | pkg/debug 共享模块 + Hub/Edge 统一注册 + health/pprof/metrics/config/state + 11 tests | 2026-06-05 |
| **A4 Wave 2 (3/7)** | App.tsx 1525→1440 行，useHiddenMessages/useSidebarResize/useThreadCache 拆出 | 2026-06-05 |
| **Quick Wins** | OIDC 超时 60→300 + DEFAULT_EDGE_PORT 常量提取 | 2026-06-05 |
| **五维 Review** | 架构/API/前端/后端/DevOps 深度审查，新增 A6 安全加固 + D1 补充 | 2026-06-05 |
| **七项深研** | A2 调试端点方案 + B2 性能治理定位(N+1×3+索引+迁移双系统) + B3 大文件拆分(process_executor→4文件, agent→5文件) + Quick Wins(OpenAPI 7缺口+事件漂移3项+Web包决策) | 2026-06-05 |
| **比赛评审评估** | 5 维度深度评估(AI协作22/30+功能15.5/25+代码理解12/15+创新8/10+Demo策略) + 竞品动态调研(Codeg/Cursor3.2/Copilot SDK/Claude Agent View/Devin ACP) | 2026-06-05 |

> 详细历史见 [archive/roadmap-v2-pre-restructure-20260605.md](archive/roadmap-v2-pre-restructure-20260605.md)

---

## 比赛评审维度评估

> 2026-06-05 基于代码实证 + 竞品对比的预估得分。总分满分 100。

| 维度 | 权重 | 预估得分 | 关键发现 |
|------|:----:|:-------:|---------|
| AI 协作能力 | 30% | **22/30** | 结构化委派+IM 双模独有；七层 guardrails 业界唯一；短板：Edge/Hub 双轨未统一(-2)、无跨 Run 记忆(-1)、故障恢复不完整(-1) |
| 功能完整度 | 25% | **15.5/25** | P0 执行闭环 80%、P1 IM 55%、P2 Hub 35%；核心短板：TeamRun E2E 未打通(-3)、Edge 无持久化(-2)、P2 远程场景未实现(-2) |
| 生成效果 | 20% | **12/20** | Diff 基础可用但无语法高亮(-2)、Tool Call 7/10、流式仅文本块级非 token 级且 Codex 无流式(-2)、Artifact 正则提取脆弱(-1)、Preview 无 dev server(-2) |
| 代码理解 | 15% | **12/15** | AGENTS.md 渐进式加载竞品独一无二；workspace fail-closed 领先；MCP 仅 Server 端缺 Client(-1)、Skill 仅 Codex 格式(-1)、上下文预算未可视化(-1) |
| 创新与产品感 | 10% | **8/10** | IM-native 多 Agent "无人竞争"(UNCONTESTED)；三层架构本地优先独树一帜；Agent Profile 四层模型比竞品成熟；短板：多 Agent IM 交互缺原型验证(-1)、Profile 配置界面未落地(-1) |

**当前已评总分：57.5/80（已评维度）** | 生成效果待补

### 比赛提分关键路径（按性价比排序）

1. **打通 TeamRun E2E**（+3 分，~3 天）— 核心差异化唯一证据，用真实 Runtime 完成群聊多 Agent 协作
2. **Edge SQLite 持久化 B0**（+2 分，~3 天）— Demo 经得起重启
3. **修复 102 个失败测试 + Preview 增强**（+1.5 分，~1.5 天）— 测试 91%→100%、网页/文件预览
4. **Edge→Hub 模式统一**（+2 分 AI 协作，~5 天）— 消除双轨并行，补齐审计链

### 竞品威胁更新（2026-06-05）

| 竞品 | 威胁级别 | 关键动态 |
|------|:-------:|---------|
| **Codeg v0.14.7** | **HIGH** | 最接近 AgentHub 的开源项目——多 CLI Agent 聚合 + Telegram/Lark IM + 多 Agent 协作 |
| **Claude Code Agent View** | **MEDIUM→HIGH** | 从单 Agent 演进到多 Session 管理面板；/bg 后台派遣 |
| **Cursor 3.2** | HIGH | /multitask 异步子代理 + /best-of-n 多模型并行 + Cursor SDK |
| **GitHub Copilot SDK** | HIGH | 6 语言 SDK GA + Sub-agents + Cloud Automations + Copilot Memory |
| **CodeBanana** | MEDIUM | 商用发布"群聊+Agent+Workspace"，36 氪获奖 |
| **Devin Desktop + ACP** | MEDIUM | Windsurf 更名为 Devin Desktop，发布 Agent Client Protocol |

**核心差异化窗口在缩窄**：IM 多 Agent 不再无人竞争。剩余壁垒：Tauri 2 原生桌面 + Hub-Edge-Runner 分布式 + 开源社区

### 调整建议

- 飞书/Telegram IM 桥接从 P1 提升为 **P0 加速**（Codeg 已证明可行）
- 新增 **Agent Adapter SDK** 为 P0（参考 Copilot/Cursor SDK，降低第三方 CLI 接入门槛）
- 新增 **后台 Agent 调度器** 为 P1（Claude Code /bg、Codex Goal Mode、Copilot Automations 成为标配）

### Demo 3 分钟策略

- **场景**：三 Agent（Architect/Builder/Reviewer）协作修复 Dashboard 性能问题，三种 Runtime 各司其职
- **时间轴**：开场钩子(25s) → Claude Code 分析+审批(30s) → Codex 执行+Diff(35s) → OpenCode 审查+聚合(40s) → 总结对比(50s)
- **三个最亮点**：(1) Thinking 面板+审批弹窗 (2) Diff 内联+FileChangeGroup (3) 三 Agent 产出聚合
- **P0 打磨项**：BlockRenderer 6 个 null case(~30 行) + Agent Profile 预设(~50 行) + @mention Runtime 信息(~20 行) + Diff 稳定渲染(~30 行)

| 层 | 技术 | 存储 | 代码量 | 测试 |
|----|------|------|--------|------|
| Desktop | React 19 + Tauri 2 + Zustand + TanStack Query | 平台 Credential Store | Rust 2,113 行 / TS ~45 组件 | `pnpm test && pnpm typecheck` |
| Edge Server | Go + gorilla/websocket + NDJSON | **JSON 快照 → SQLite + FTS5** | 15,509 行 | `go test ./... -short -race` |
| Hub Server | Go + Gin + GORM + Redis + PG | PostgreSQL 16 | ~46,000 行 | `go test ./... -short -race` |
| 协议 | REST JSON + WebSocket NDJSON | — | OpenAPI 5,590 行 | — |
| CI | GitHub Actions (Win + macOS) | — | — | `scripts/verify-ci-gates.ps1` |
