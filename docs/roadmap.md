# AgentHub 路线图

> 最后更新: 2026-06-05 | 唯一事实源 | 旧版归档: [archive/roadmap-v2-pre-restructure-20260605.md](archive/roadmap-v2-pre-restructure-20260605.md)

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
Phase A: 工程基础设施 ████████░░  45%  ← 当前 (Wave 1 完成，Wave 2 进行中)
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

---

## Phase A: 工程基础设施 + 安全修复

> **目标**: 建立可观测性基座（错误码/日志/调试），修复安全与稳定性隐患，解耦前端开发瓶颈
>
> **入场条件**: ✅ v0.2.0 已发布，架构剖析已完成
> **出场条件**: Edge/Hub 统一错误码 + 请求追踪；无凭据泄漏；App.tsx 拆为独立模块

### A0: 错误码体系收口 `errcode` ✅

- [x] 共享 `pkg/errcode` 模块 + `go.work` workspace
- [x] Hub 迁移完成：统一 envelope `{"error":{"code":"...","message":"...","traceId":"..."}}`
- [x] Edge 域错误码 — 14 个 Edge 专属错误码（EXECUTOR_UNAVAILABLE 等）
- [x] Edge handlers 重构 — 删除 `errorResponse()`，52 个调用点改用 errcode
- [x] 前端适配 — `app/shared/src/errors.ts` 已兼容，零改动

### A1: 请求日志与追踪 `reqlog` 🔧

- [ ] `pkg/reqlog` 共享中间件 — trace ID 生成/传播，统一字段（request_id/method/path/status/duration_ms）
- [ ] Edge 接入 — 生成 X-Request-ID，替换现有 AccessLog
- [ ] Hub 接入 — 统一已有 RequestID + AccessLog 为 reqlog 版
- [ ] 跨服务追踪 — Edge→Hub API 透传 X-Request-ID

### A2: 调试端点 `debug`

- [ ] `pkg/debug` 模块 — health + pprof + 脱敏配置转储
- [ ] Hub `/debug/` — DB+Redis 连通性 + pprof (admin auth) + config dump
- [ ] Edge `/debug/` — store+bus 状态 + pprof (local auth) + config dump

### A3: 安全与稳定性 P0 修复 ✅

- [x] **Edge auth token 明文日志** — `slog.Info` → `slog.Debug`，前缀 16→8 字符
- [x] **Edge FileStore async persist** — 同步 persist → 异步 50ms debounce + background goroutine + `Close()`/`Flush()`
- ~~Hub workspace schema 不一致~~ — 验证 0016 migration 已完整桥接，误报关闭

### A4: 前端架构解耦 🔧

> **关键路径**: App.tsx 拆分是 Phase C (IM 闭环) 的前置条件。

- [x] **App.tsx 拆分 Wave 1** — 1837→1525 行（-17%），已拆出 ShellIconButton、useFocusSourceTracking、DesktopHubTaskBridge、TopMenuBar、useShellShortcuts
- [x] **lazy-load** — SettingsPage、AuthPage、HomeDashboard 已改为 `React.lazy()`
- [ ] **继续拆分** — LayoutShell、ConnectionManager、ChatController 等核心模块
- [ ] **Rust 后端基础测试** — commands.rs / oidc_server.rs 核心路径覆盖

### A5: 开发者构建体验

- [x] 移除 keyring v4 重依赖（-213 crate）
- [x] Cargo dev profile 优化（`opt-level=1`）
- [x] 前端 vendor bundle 拆分
- [ ] Edge 自动构建 — `tauri dev` 检测 edge-server 变更自动 `go build`
- [ ] sccache / CI 缓存共享
- [ ] 开发文档 — 冷启动预期、前置依赖、troubleshooting

### A6: Review 发现的安全加固（新增）

> 来自 2026-06-05 五维度深度 Review（架构/API/前端/后端/DevOps）。

- [ ] **统一响应信封** — Hub `{code,data}` vs Edge 裸 JSON，前端需两套解析。统一为一方
- [ ] **API 密钥迁移到 secure_store** — 当前 base64 弱混淆存 localStorage，Tauri secure_store 已实现但未使用
- [ ] **DB TLS 可配置** — Hub `sslmode=disable` 硬编码，改为环境变量，默认 `require`
- [ ] **.env 密钥轮换 + secret guard 加固** — 加 pre-commit hook 防泄漏，密钥迁移到 OS secret manager

---

## Phase B: Edge 持久化 + 性能治理

> **目标**: Edge 从内存临时态升级到 SQLite 持久化；修复 Hub 性能瓶颈；大文件拆分提升可维护性
>
> **入场条件**: Phase A 出场（错误码 + 日志 + P0 修复完成）
> **出场条件**: Edge 重启不丢数据 + FTS5 搜索；Hub 无 N+1 查询 + 全索引覆盖

### B0: Edge SQLite 持久化

当前 Edge 用内存 + JSON 快照（FileStore），重启丢数据、无搜索、无同步。升级为 `modernc.org/sqlite`（纯 Go，FTS5 内置，无 CGO）。

- [ ] JSONL 事件流 — append-only 日志替代 JSON 快照，写操作先 append 再更新内存
- [ ] SQLite Schema — projects / threads / runs / items 四张表 + 索引
- [ ] FTS5 搜索 — `session_messages_fts` 虚拟表，BM25 排序，`snippet()` 高亮
- [ ] 数据迁移 — 启动时检测旧 JSON 快照，自动导入 SQLite

> 参考: `docs/archive/build-specs-backend-03-eventstore-memory.md`

### B1: Edge 离线与同步

- [ ] 离线队列 — Hub 断连时写操作入队，重连后批量同步
- [ ] Cursor 同步协议 — `?cursor=<last_seq>` 增量拉取

### B2: Hub 性能治理

- [ ] **N+1 查询** — session list 的 correlated subquery + agent dispatch 逐个查 CustomAgent → JOIN / Preload
- [ ] **缺索引** — `agent_team_tasks(team_run_id)`、`agent_team_assignments(team_run_id)`、`notifications(user_id)`
- [ ] **migration 双系统统一** — golang-migrate + GORM AutoMigrate 并存 → 统一走 golang-migrate，关掉 AutoMigrate

### B3: 大文件拆分

- [ ] **Hub agent.go** — 1371 行 → `agent_custom.go` / `agent_task.go` / `agent_dispatch.go` / `agent_events.go`
- [ ] **Edge ProcessExecutor** — 1413 行 → `executor_spawn.go` / `executor_cancel.go` / `executor_hub.go` / `executor_output.go`

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
- [ ] Edge `internal/runners` 死代码清理
- [ ] Hub 端点加 `/v1/` 版本前缀（或显式文档声明策略）
- [ ] Release workflow 加分支限制
- [ ] 收紧 golangci-lint + gosec 为硬阻断
- [ ] 配置 Renovate/Dependabot + CODEOWNERS

### D2: 产品扩展

- [ ] 部署发布 — 聊天中"部署"指令，返回部署状态卡片
- [ ] Agent 商店 — 搜索、安装、使用自定义 Agent
- [ ] 版本历史 — Checkpoint + Diff 对比 + 回滚
- [ ] Mobile 轻量端 — 查看/审批/预览
- [ ] Content Pool — SHA-256 + zstd 文件内容去重
- [ ] 远程 Edge — SSH / Tailscale / Hub Relay 连接远程 Desktop

---

## Quick Wins（随时可做）

> 不依赖特定 Phase，发现即修。trivial 修复直接执行，无需等 Phase 排期。

- [ ] Desktop OIDC 超时不一致 — `CALLBACK_TIMEOUT_SECS = 60` 但错误消息写 "5 minutes"
- [ ] Desktop Edge 端口硬编码 — Rust `port: 3210` 写死，前端 config.ts 默认也是 3210
- [ ] 补齐 OpenAPI 缺失端点 — DELETE thread、model-catalog 等
- [ ] Web 包定位决策 — 要么启动要么最小化

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
| **A3 P0 安全** | Auth token Debug 日志 + FileStore async persist (50ms debounce) | 2026-06-05 |
| **A4 前端解耦** | App.tsx 1837→1525 (-17%)，5 模块拆出 + 3 组件 lazy-load | 2026-06-05 |
| **五维 Review** | 架构/API/前端/后端/DevOps 深度审查，新增 A6 安全加固 + D1 补充 | 2026-06-05 |

> 详细历史见 [archive/roadmap-v2-pre-restructure-20260605.md](archive/roadmap-v2-pre-restructure-20260605.md)

---

## 技术栈速查

| 层 | 技术 | 存储 | 代码量 | 测试 |
|----|------|------|--------|------|
| Desktop | React 19 + Tauri 2 + Zustand + TanStack Query | 平台 Credential Store | Rust 2,113 行 / TS ~45 组件 | `pnpm test && pnpm typecheck` |
| Edge Server | Go + gorilla/websocket + NDJSON | **JSON 快照 → SQLite + FTS5** | 15,509 行 | `go test ./... -short -race` |
| Hub Server | Go + Gin + GORM + Redis + PG | PostgreSQL 16 | ~46,000 行 | `go test ./... -short -race` |
| 协议 | REST JSON + WebSocket NDJSON | — | OpenAPI 5,590 行 | — |
| CI | GitHub Actions (Win + macOS) | — | — | `scripts/verify-ci-gates.ps1` |
