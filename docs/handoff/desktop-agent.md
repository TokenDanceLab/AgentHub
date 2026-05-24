# DesktopAgent 交接文档

## 接手前必读

1. `AGENTS.md` — 项目规则和开发约束
2. `docs/system-architecture.md` — Hub-Edge-Runner 三层架构
3. `docs/product-requirements.md` — 产品需求（bytedance.md 的工程版）
4. `docs/implementation-guide.md` — 实施路线（M1→M2→M3→M4）
5. `docs/client-roadmap.md` — 客户端开发路线图
6. `docs/client-handoff.md` — 客户端操作手册
7. `api/openapi.yaml` — REST API 契约
8. `api/events.md` — WebSocket 事件契约
9. `~/.claude/plans/structured-imagining-pinwheel.md` — 完整架构方案

## 仓库和分支

```
仓库: github.com/TokenDanceLab/AgentHub
当前分支: feat/desktop-sidecar (worktree: .worktrees/feat-desktop-sidecar)
基线分支: dev/delicious233 (dbd4583)
```

```powershell
cd D:\Code\AgentHub
git worktree add .worktrees/feat-desktop-sidecar -b feat/desktop-sidecar
# 或如果已存在：
cd D:\Code\AgentHub\.worktrees\feat-desktop-sidecar
```

## 全局架构

```
Desktop (Tauri v2 + React/TypeScript + WebView2)
  │
  ├── Rust 侧 (src-tauri/)
  │   ├── Edge Server sidecar 进程管理 (启动/停止/健康检查)
  │   ├── 系统托盘 + 右键菜单
  │   ├── 原生 Windows 通知
  │   └── 文件关联 / 右键菜单集成
  │
  ├── React 侧 (src/)
  │   ├── StatusBar — Edge 连接状态
  │   ├── AgentList — 可用 Agent 列表 (替代 RunnerList)
  │   ├── ThreadPanel — 对话列表
  │   ├── ChatView — IM 消息流 (text/code/diff/preview 卡片)
  │   ├── RunDetail — Agent 执行详情 (输出/tool calls/file changes)
  │   └── EventLog — 调试事件日志
  │
  └── Shared (app/shared/src/)
      ├── types.ts — REST API 类型
      ├── events.ts — WebSocket 事件类型
      └── errors.ts — 错误处理
```

### 设计哲学（对标 Codex App 和 Claude Desktop）

- **Codex App**: Tauri(Rust) shell + Rust CLI engine — 轻量、本地优先、SQLite 持久化
- **Claude Desktop**: Electron(Node.js) shell + Node.js agent loop — 多面板 (Chat/Code/Cowork)、MCP 协议枢纽

AgentHub Desktop 走 Codex App 路线：
- Tauri v2 轻量壳（WebView2 渲染，Windows 11 内置）
- 不嵌入完整 Chromium（不像 Claude Desktop 的 Electron）
- Rust 侧管理 Edge Server 子进程，不走 Node.js 中间层
- 本地优先，离线可用，Hub 是可选的云端同步层

## 当前 Desktop 状态

### 已完成

| 文件 | 内容 | 状态 |
|------|------|------|
| `src/main.rs` | Tauri 入口，`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` | ✅ |
| `src/lib.rs` | `tauri::Builder::default().plugin(tauri_plugin_shell::init()).run()` | ✅ 最小 |
| `src-tauri/Cargo.toml` | tauri v2 + tauri-plugin-shell v2 + serde | ✅ |
| `src-tauri/tauri.conf.json` | CSP: `connect-src http://127.0.0.1:3210 ws://127.0.0.1:3210` | ✅ |
| `src/config.ts` | `EDGE_URL=http://127.0.0.1:3210`, `WS_URL=ws://127.0.0.1:3210/v1/events` | ✅ |
| `src/api/edgeClient.ts` | `fetchHealth()`, `fetchRunners()`, `startRun()`, `cancelRun()` | ✅ |
| `src/api/eventClient.ts` | WebSocket 客户端 + 指数退避重连 + cursor 恢复 | ✅ |
| `src/hooks/useHealth.ts` | 5s 轮询 `/v1/health` | ✅ |
| `src/hooks/useRunners.ts` | 5s 轮询 `/v1/runners`（online 门控） | ✅ |
| `src/hooks/useEventStream.ts` | WebSocket 连接 + 事件日志缓存 (max 1000) | ✅ |
| `src/App.tsx` | StatusBar + RunnerList + EventLog 布局 | ✅ |
| `app/shared/src/types.ts` | `HealthResponse`, `Runner`, `RunInfo`, `ListResponse` | ✅ |
| `app/shared/src/events.ts` | `EventEnvelope` + discriminated union (5 种事件) | ✅ |
| `app/shared/src/errors.ts` | `AppError` class + `parseError()` | ✅ |
| Vitest 单元测试 | API client / errors / hooks / eventClient 测试 | ✅ |
| Playwright e2e | health / runners / events 端到端测试 | ✅ |

### 待完成（本次 Desktop 任务）

| # | 任务 | 文件 | 优先级 |
|---|------|------|--------|
| 1 | **Tauri Rust sidecar** — 启动/停止 Edge Server 子进程 | `src-tauri/src/edge_manager.rs` | P0 |
| 2 | **Edge 健康检查** — Rust 侧轮询 + 进程存活监控 | `src-tauri/src/edge_health.rs` | P0 |
| 3 | **系统托盘** — 右键菜单：显示/隐藏窗口、启动/停止 Edge、退出 | `src-tauri/src/tray.rs` | P0 |
| 4 | **Tauri commands** — Rust→JS API：`get_edge_status`/`start_edge`/`stop_edge` | `src-tauri/src/commands.rs` | P0 |
| 5 | **原生通知** — Agent 执行完毕时 Windows toast | `src-tauri/src/notifications.rs` | P1 |
| 6 | **扩展 shared types** — `Agent`/`AgentCapabilities`/新的 event 类型 | `app/shared/src/types.ts`, `events.ts` | P0 |
| 7 | **扩展 edgeClient** — `fetchAgents()`/`startRun(prompt, agentId, model)` | `src/api/edgeClient.ts` | P0 |
| 8 | **AgentList 面板** — 展示可用 Agent（替代 RunnerList） | `src/components/AgentList.tsx` | P0 |
| 9 | **ChatView 面板** — IM 消息流，支持 text/code block 渲染 | `src/components/ChatView.tsx` | P0 |
| 10 | **RunDetail 面板** — Agent 执行输出 + tool calls 表格 + file changes diff | `src/components/RunDetail.tsx` | P1 |
| 11 | **PromptInput 组件** — 输入框 + @Agent 选择器 + 发送按钮 | `src/components/PromptInput.tsx` | P0 |
| 12 | **ThreadPanel** — 左侧对话列表（创建/切换/搜索） | `src/components/ThreadPanel.tsx` | P1 |
| 13 | **Agent events 渲染** — `useEventStream` 处理新的 `run.agent.*` 事件 | `src/hooks/useEventStream.ts` | P0 |

## 接口边界

Desktop 只通过 REST + WebSocket 与 Edge Server 通信：

### REST 端点 (Edge Server `:3210`)

| 方法 | 路径 | 用途 | 当前状态 |
|------|------|------|----------|
| GET | `/v1/health` | 健康检查 | ✅ 已有 |
| GET | `/v1/agents` | 可用 Agent 列表 | ❌ Edge 端待实现 |
| GET/POST | `/v1/projects` | 项目管理 | ✅ 已有 |
| GET/POST | `/v1/threads` | 对话线程 | ✅ 已有 |
| POST | `/v1/threads/{id}/messages` | 发送消息 | ✅ 已有 |
| GET/POST | `/v1/runs` | 创建/查询 Agent 执行 | ⚠️ 需扩展 (agentId/prompt/model) |
| POST | `/v1/runs/{id}:cancel` | 取消执行 | ✅ 已有 |
| GET | `/v1/runs/{id}/items` | 获取执行输出 | ⚠️ Edge 端待完善 |
| GET | `/v1/runs/{id}/diff` | 获取文件 diff | ⚠️ Edge 端待实现 |
| GET/POST | `/v1/artifacts` | 产物流转 | ⚠️ Edge 端待实现 |
| GET | `/v1/events` | WebSocket 升级 | ✅ 已有 |

### WebSocket 事件

| 事件类型 | 用途 | 当前状态 |
|----------|------|----------|
| `run.started/finished/failed` | Run 生命周期 | ✅ 已有 |
| `run.output.batch` | 批量 stdout/stderr | ✅ 已有 |
| `runner.online/offline` | Runner 状态 | ✅ 已有 |
| `run.agent.text_delta` | Agent 流式文本 | ✅ Edge 端已定义 |
| `run.agent.text_block` | Agent 完整文本 | ✅ Edge 端已定义 |
| `run.agent.thinking` | Agent 思考内容 | ✅ Edge 端已定义 |
| `run.agent.tool_call` | 工具调用 | ✅ Edge 端已定义 |
| `run.agent.tool_result` | 工具结果 | ✅ Edge 端已定义 |
| `run.agent.file_change` | 文件变更 | ✅ Edge 端已定义 |
| `run.agent.session_init` | 会话初始化 | ✅ Edge 端已定义 |
| `run.agent.result` | 执行结果 | ✅ Edge 端已定义 |

## 开发顺序

### Phase 1: Rust 侧基础设施（无 UI 依赖）

1. `src-tauri/src/edge_manager.rs` — Edge Server sidecar 进程管理
   - 从 Tauri bundle 旁加载 `agenthub-edge.exe`
   - 开发阶段从 `edge-server/` 编译产物路径加载
   - 启动：`Command::new(edge_path).args(["--store-file", store_path]).spawn()`
   - 停止：kill 子进程 + 等待退出
   - 自动重启：进程异常退出时重试

2. `src-tauri/src/commands.rs` — Tauri commands
   ```rust
   #[tauri::command]
   fn get_edge_status(state: State<AppState>) -> EdgeStatus { ... }
   
   #[tauri::command]
   fn start_edge(state: State<AppState>) -> Result<(), String> { ... }
   
   #[tauri::command]
   fn stop_edge(state: State<AppState>) -> Result<(), String> { ... }
   ```

3. `src-tauri/src/tray.rs` — 系统托盘
   - 托盘图标：Edge 在线/离线状态色
   - 菜单：显示窗口 / 启动 Edge / 停止 Edge / 退出

### Phase 2: TypeScript 侧接口对齐

4. 扩展 `app/shared/src/types.ts`
   ```typescript
   interface AgentMetadata {
     id: string; name: string; description: string; version: string;
   }
   interface AgentCapabilities {
     streaming: boolean; toolCalls: boolean; fileChanges: boolean;
     thinkingVisible: boolean; multiTurn: boolean;
   }
   interface AgentInfo extends AgentMetadata {
     status: string; capabilities: AgentCapabilities;
   }
   interface StartRunRequest {
     projectId?: string; threadId?: string;
     prompt?: string; agentId?: string; model?: string;
   }
   ```

5. 扩展 `app/shared/src/events.ts`
   ```typescript
   type AgentTextDeltaEvent = { type: "run.agent.text_delta"; payload: { content: string; offset: number } };
   type AgentToolCallEvent = { type: "run.agent.tool_call"; payload: { callId: string; toolName: string; input: any; status: string } };
   type AgentFileChangeEvent = { type: "run.agent.file_change"; payload: { path: string; action: string; diff?: string } };
   // ... 等
   ```

6. 扩展 `src/api/edgeClient.ts`
   ```typescript
   async function fetchAgents(): Promise<ListResponse<AgentInfo>> { ... }
   async function startRun(req: StartRunRequest): Promise<RunInfo> { ... }
   ```

### Phase 3: React UI 组件

7. `AgentList` — 左侧面板，展示可用 Agent（头像/名称/能力标签/在线状态）
8. `PromptInput` — 底部输入栏，含 @Agent 选择器
9. `ChatView` — 中间 IM 消息流
   - Agent 回复文本块（支持 Markdown）
   - 内联 code block（语法高亮）
   - Tool call 折叠卡片（展开看参数和结果）
   - File change diff 卡片（绿色/红色，点击展开完整 diff）
   - Thinking 折叠区域（灰色小字）
10. `RunDetail` — 右侧面板
    - 当前 Run 状态指示器（queued/running/finished/failed）
    - 实时输出流
    - Tool calls 时间线
    - Changed files 列表

### Phase 4: 端到端集成

11. 修改 `App.tsx` 布局 — 三栏布局替代单栏
12. 修改启动流程 — Tauri 启动时自动检查/启动 Edge Server
13. `pnpm test:e2e` 更新

## 构建和测试

```powershell
cd D:\Code\AgentHub\.worktrees\feat-desktop-sidecar\app\desktop

# 安装依赖
pnpm install

# 单元测试
pnpm test

# 构建
pnpm build

# Tauri dev 模式（热重载）
pnpm tauri dev

# Tauri 生产构建
pnpm tauri build

# Playwright e2e
pnpm test:e2e

# 如果没装 Chromium
pnpm exec playwright install chromium
```

### 开发时的 Edge Server 准备

```powershell
# 先构建 Edge（另一个 worktree）
cd D:\Code\AgentHub\.worktrees\feat-edge-adapters\edge-server
go build -o agenthub-edge.exe ./cmd/agenthub-edge

# 启动 (mock 模式，用来开发 UI)
.\agenthub-edge.exe --store-file test_store.json

# 然后 Desktop 开发连接 127.0.0.1:3210
```

## 设计原则

1. **本地优先** — Desktop 启动后自动连接本机 Edge，不依赖 Hub/网络
2. **状态面板化** — 每个 Agent action（tool call / file change / thinking）渲染为独立卡片，不堆纯文本
3. **事件驱动** — UI 状态来自 WebSocket 事件流，不由轮询驱动
4. **Rust 做进程，React 做 UI** — 不把进程管理逻辑写进 TypeScript
5. **Tauri commands 是边界** — Rust 侧暴露给 JS 的都是类型安全的 command，不传裸 JSON

## 隐私红线

- Desktop 只能访问本机 127.0.0.1 的 Edge Server
- 不提交 `.env`、API key、token
- 不提交真实项目 workspace 路径
- 不提交本机 Edge 编译产物路径
- `.worktrees/` 在 `.gitignore` 中，不得提交

## Commit 规范

```
type(scope): 中文摘要

type: feat|fix|docs|refactor|chore|test|style
scope: desktop|shared|tauri
```

示例:
```
feat(desktop): 实现 Edge sidecar 进程管理
feat(shared): 扩展 Agent 和事件类型
feat(desktop): 添加 AgentList 和 PromptInput 组件
```
