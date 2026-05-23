# Opcode 深度调研报告

> **源码**：`D:\Code\AgentHub\reference\opcode`，commit `HEAD`
> **版本**：v0.2.1，AGPL-3.0
> **作者**：mufeedvh、123vviekr（Asterisk）
> **调研日期**：2026-05-21

---

## 1. Tauri 2 + React 桌面 GUI 架构

### 1.1 总体分层

```
┌─────────────────────────────────────────────────────┐
│  Frontend: React 18 + TypeScript + Vite 6           │
│  src/                                                │
│  ├── App.tsx            (主视图路由)                  │
│  ├── components/        (UI 组件 60+)                 │
│  │   ├── ui/            (shadcn/ui 基元组件 17个)      │
│  │   └── ...            (业务组件)                     │
│  ├── lib/               (API 客户端 + 工具 + analytics)│
│  ├── stores/            (Zustand 状态管理)            │
│  ├── hooks/             (自定义 hooks)                │
│  ├── services/          (持久化服务)                   │
│  └── contexts/          (React Context)               │
├─────────────────────────────────────────────────────┤
│  Tauri Bridge: @tauri-apps/api v2.1.1                │
│  invoke() ←→ #[tauri::command]                       │
├─────────────────────────────────────────────────────┤
│  Backend: Rust + Tauri 2                             │
│  src-tauri/src/                                      │
│  ├── main.rs           (应用入口 + 插件注册 + 状态管理)│
│  ├── lib.rs            (模块声明)                     │
│  ├── commands/         (Tauri 命令处理器 7个模块)      │
│  │   ├── claude.rs     (项目/会话/检查点 主模块)      │
│  │   ├── agents.rs     (Agent CRUD + 执行)           │
│  │   ├── mcp.rs        (MCP 管理)                    │
│  │   ├── usage.rs      (用量统计)                     │
│  │   ├── storage.rs    (数据库直读)                   │
│  │   ├── proxy.rs      (代理设置)                     │
│  │   └── slash_commands.rs (自定义斜杠命令)           │
│  ├── checkpoint/       (检查点/时间线引擎)            │
│  │   ├── mod.rs         (数据模型)                    │
│  │   ├── manager.rs     (检查点管理器)                │
│  │   ├── state.rs       (全局状态池)                  │
│  │   └── storage.rs     (持久化 + 内容寻址)          │
│  ├── process/          (子进程管理)                    │
│  │   ├── mod.rs         (导出)                       │
│  │   └── registry.rs    (进程注册表)                  │
│  ├── web_server.rs     (Axum WebSocket 服务器)        │
│  ├── web_main.rs       (Web 模式入口)                 │
│  └── claude_binary.rs  (Claude 二进制发现)            │
└─────────────────────────────────────────────────────┘
```

### 1.2 前端架构细节

**路由系统** (`src/App.tsx:30-44`)：基于 `useState<View>` 的视图切换，共 15 种视图：

| 视图 | 组件 | 说明 |
|------|------|------|
| `welcome` | AppContent 内联 | 双卡片入口（CC Agents + Projects） |
| `tabs` | TabManager + TabContent | **主交互模式**，多标签页布局 |
| `projects` | ProjectList / SessionList | 项目→会话两级导航 |
| `editor` | MarkdownEditor | MD 编辑器 |
| `claude-file-editor` | ClaudeFileEditor | CLAUDE.md 编辑器 |
| `settings` | Settings | 全局设置 |
| `cc-agents` | CCAgents | Agent 列表/创建 |
| `mcp` | MCPManager | MCP 服务器管理 |
| `usage-dashboard` | UsageDashboard | 用量仪表板 |
| `project-settings` | ProjectSettings | 项目级 Hooks/Slash Commands |

**Tab 系统** (`src/components/TabManager.tsx`): 支持 9 种 Tab 类型：
- `chat`（ClaudeCodeSession 交互对话）
- `agent`、`agents`、`agent-execution`、`create-agent`、`import-agent`（Agent 管线）
- `projects`、`usage`、`mcp`、`settings`、`claude-md`、`claude-file`

Tab 特性：framer-motion Reorder 拖拽排序，`min-w-[120px] max-w-[220px]`，Ctrl+T/W/Tab/1-9 快捷键。

**状态管理**：Zustand v5 + `subscribeWithSelector` 中间件

| Store | 文件 | 职责 |
|-------|------|------|
| `sessionStore` | `src/stores/sessionStore.ts` | 项目列表、会话加载、实时输出更新 |
| `agentStore` | `src/stores/agentStore.ts` | Agent Run 列表、5秒缓存、轮询管理 |

**React Context**：
- `TabContext` (`src/contexts/TabContext.tsx`) — 全局 Tab 状态
- `ThemeContext` (`src/contexts/ThemeContext.tsx`) — 主题切换

**API 适配层** (`src/lib/apiAdapter.ts` + `src/lib/api.ts`):
- `apiCall()` 函数封装了 `window.__TAURI__` 检测 → `invoke()` 或 WebSocket 回退
- `initializeWebMode()` 在 App 挂载时检测运行模式

**持久化服务**：
- `SessionPersistenceService` (`src/services/sessionPersistence.ts`) — `localStorage` 序列化会话恢复数据，30 天过期清理
- `TabPersistenceService` (`src/services/tabPersistence.ts`) — Tab 状态持久化

### 1.3 后端架构细节

**Tauri 插件注册** (`src-tauri/src/main.rs:58-61`):

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
```

共 8 个 Tauri 插件：dialog, shell, fs, process, updater, notification, clipboard-manager, global-shortcut, http。

**全局状态（Tauri Managed State）** (`src-tauri/src/main.rs:119-148`)：

| 状态类型 | 行号 | 类型 | 用途 |
|---------|------|------|------|
| `AgentDb` | :121 | `Mutex<rusqlite::Connection>` | SQLite 数据库连接 |
| `CheckpointState` | :124 | 全局单例 | 跨会话检查点管理器池 |
| `ProcessRegistryState` | :145 | `Arc<ProcessRegistry>` | 运行中进程注册表 |
| `ClaudeProcessState` | :148 | `Arc<Mutex<Option<Child>>>` | 当前 Claude 子进程句柄 |

**命令注册** (`src-tauri/src/main.rs:186-292`)：
共注册 60+ 个 Tauri 命令，分为 7 大类：
1. **Claude & Project Management** (26 个命令) — 项目 CRUD、会话执行、文件操作、Hook 管理
2. **Checkpoint Management** (13 个命令) — 检查点 CRUD、恢复、分叉、时间线、diff、自动检查点
3. **Agent Management** (18 个命令) — Agent CRUD、执行、导入导出、GitHub Agent 浏览
4. **Usage & Analytics** (4 个命令) — 统计、按日期、详情、会话统计
5. **MCP** (11 个命令) — 服务器 CRUD、导入、测试、项目配置
6. **Storage Management** (6 个命令) — 数据库直读（调试用）
7. **Slash Commands / Proxy** (6 个命令) — 自定义命令、代理

**进程管理** (`src-tauri/src/process/registry.rs`):

`ProcessRegistry` 是一个线程安全的进程注册表，管理两种进程：
- `ProcessType::AgentRun` — Agent 后台执行
- `ProcessType::ClaudeSession` — Claude 交互会话

关键能力：
- `register_process()` (:57-82) — 注册带 `tokio::process::Child` 句柄的进程
- `register_sidecar_process()` (:85-119) — 注册无句柄的 sidecar 进程
- `kill_process()` (:239-360) — 优雅关闭（SIGTERM → 5s 超时 → SIGKILL + taskkill fallback）
- `append_live_output()` / `get_live_output()` (:472-491) — 实时输出流

**Web Server 模式** (`src-tauri/src/web_server.rs`):

基于 Axum 0.8 的独立 HTTP+WebSocket 服务器，支持浏览器远程访问：
- REST API 端点（Claude 执行、继续、恢复）
- WebSocket 实时流式输出
- `AppState` 维护活跃 WebSocket 会话映射
- CORS 全开放（`Any`）
- 安全风险：无身份验证，需 LAN/SSH 隧道限制访问

### 1.4 依赖栈

**前端关键依赖**：React 18, TypeScript 5.6, Vite 6, Tailwind CSS v4, Zustand 5, Radix UI (9个), shadcn/ui, Framer Motion 12, react-markdown, react-syntax-highlighter, recharts, date-fns, diff, html2canvas, posthog-js

**后端关键依赖**：Tokio (full), rusqlite (bundled), Axum 0.8 (ws), reqwest 0.12 (native-tls-vendored), zstd, uuid v4, sha2, serde_yaml, which

---

## 2. Timeline/Checkpoint/Diff 交互设计

### 2.1 数据模型

**核心类型** (`src-tauri/src/checkpoint/mod.rs`):

| 类型 | 行号 | 说明 |
|------|------|------|
| `Checkpoint` | :13-30 | 检查点实体：id, session_id, project_id, message_index, timestamp, description, parent_checkpoint_id, metadata |
| `CheckpointMetadata` | :34-46 | 元数据：total_tokens, model_used, user_prompt, file_changes, snapshot_size |
| `FileSnapshot` | :49-66 | 文件快照：checkpoint_id, file_path, content, hash(SHA-256), is_deleted, permissions, size |
| `TimelineNode` | :69-78 | 时间线树节点：checkpoint + children + file_snapshot_ids |
| `SessionTimeline` | :82-96 | 会话时间线：root_node, current_checkpoint_id, auto_checkpoint_enabled, checkpoint_strategy, total_checkpoints |
| `CheckpointStrategy` | :99-110 | 4 种策略：Manual, PerPrompt, PerToolUse, Smart |
| `CheckpointDiff` | :144-158 | 两个检查点差异：modified_files, added_files, deleted_files, token_delta |
| `FileDiff` | :161-171 | 单文件差异：path, additions, deletions, diff_content |
| `FileTracker` | :113-117 | 文件状态跟踪：tracked_files: HashMap<PathBuf, FileState> |

**策略说明** (`mod.rs:99-110`):
- `Manual` — 仅手动创建
- `PerPrompt` — 每次用户提示后
- `PerToolUse` — 每次工具调用后
- `Smart` (默认) — 仅在破坏性操作后（write/edit/multiedit/bash/rm/delete）

### 2.2 检查点引擎

**CheckpointManager** (`src-tauri/src/checkpoint/manager.rs`):

核心字段 (:17-25):
```rust
pub struct CheckpointManager {
    project_id: String,
    session_id: String,
    project_path: PathBuf,
    file_tracker: Arc<RwLock<FileTracker>>,
    pub storage: Arc<CheckpointStorage>,
    timeline: Arc<RwLock<SessionTimeline>>,
    current_messages: Arc<RwLock<Vec<String>>>,
}
```

**创建检查点流程** (`manager.rs:188-302`)：
1. 提取最新消息的 metadata（用户提示、模型、累计 token 数）(:305-398)
2. 递归遍历项目目录收集所有文件（跳过 `.` 开头的隐藏目录如 `.git`）(:201-235)
3. 为每个修改过的文件创建 FileSnapshot（读取内容 + SHA-256 哈希）(:401-449)
4. 生成 UUID v4 作为 checkpoint_id (:238)
5. 构造 Checkpoint 结构体，parent 指向当前活跃检查点 (:244-270)
6. 调用 storage.save_checkpoint() 写入磁盘 (:274-280)
7. 从磁盘重载 timeline 确保 total_checkpoints 同步 (:283-289)
8. 更新 current_checkpoint_id (:292-293)
9. 重置 file_tracker 中的 is_modified 标记 (:296-299)

**恢复检查点流程** (`manager.rs:452-599`):
1. 加载检查点数据和文件快照 (:454-456)
2. 收集当前项目所有文件，构建 "应该存在" 的文件集合 (:485-495)
3. 删除不再属于检查点的文件 (:501-518)
4. 递归清理空目录 (:522-552)
5. 逐文件恢复（创建父目录 + 写入内容 + Unix 权限）(:555-564)
6. 清空并重置 current_messages (:567-571)
7. 更新 timeline 的 current_checkpoint_id (:574-575)
8. 重建 file_tracker（所有快照文件标记为未修改）(:578-592)

**分叉流程** (`manager.rs:661-680`):
1. 加载基础检查点
2. 先恢复文件到该检查点
3. 创建新检查点，parent_checkpoint_id 指向原检查点
4. 在时间线树中作为子节点添加

**自动检查点触发判断** (`manager.rs:683-746`):
- `PerPrompt` — 检查消息 type == "user"
- `PerToolUse` — 检查 message.content 中是否有 type == "tool_use"
- `Smart` — 检查工具名是否在 `["write", "edit", "multiedit", "bash", "rm", "delete"]` 中

### 2.3 存储层

**CheckpointStorage** (`src-tauri/src/checkpoint/storage.rs`):

采用 **内容寻址存储 (Content-Addressable Storage)** 架构：

**目录结构**：
```
~/.claude/projects/{project_id}/.timelines/{session_id}/
├── timeline.json          # SessionTimeline 序列化
├── checkpoints/
│   └── {checkpoint_id}/
│       ├── metadata.json  # Checkpoint 结构体
│       └── messages.jsonl # zstd 压缩的 JSONL 消息
└── files/
    ├── content_pool/      # 内容寻址池：{sha256_hash} → zstd 压缩文件内容
    └── refs/              # 引用目录
        └── {checkpoint_id}/
            └── {safe_filename}.json  # {path, hash, is_deleted, permissions, size}
```

**内容去重**：相同内容（相同 SHA-256）在 content_pool 中只存一份，多个检查点通过 refs 引用 (:100-116)。

**压缩**：zstd level 3，消息和文件内容均压缩存储。

**垃圾回收** (`storage.rs:409-459`):
- 遍历所有 refs 收集被引用的 hash 集合
- 删除 content_pool 中未被引用的文件
- 在 `cleanup_old_checkpoints()` 后自动触发

**清理策略** (`storage.rs:337-377`):
- 按时间排序所有检查点
- 保留最近 `keep_count` 个
- 自动 GC 孤儿内容文件

### 2.4 全局状态池

**CheckpointState** (`src-tauri/src/checkpoint/state.rs`):

- `get_or_create_manager()` (:52-82) — 按 session_id 懒加载单例，已存在则复用 Arc 引用
- `remove_manager()` (:96-99) — 会话结束时清理
- `active_count()` / `list_active_sessions()` — 监控活跃检查点会话
- 包含单元测试 (:137-184) 验证生命周期

### 2.5 前端 UI 设计

**TimelineNavigator** (`src/components/TimelineNavigator.tsx`):

- 树形时间线可视化，递归渲染 `TimelineNode` (:247-420)
- 每个节点显示：ID 前 8 位、时间戳（相对时间）、描述、用户提示预览、token 数、文件变更数
- 当前活跃检查点用 `ring-2 ring-primary/20` 高亮
- 每个节点 3 个操作按钮 (Restore / Fork / Compare) (:339-396)
- 节点展开/折叠（ChevronDown/ChevronRight），自动展开当前检查点路径 (:90-93)
- `refreshVersion` prop 支持外部触发重新加载（如自动检查点后）(:38)
- Diff 对话框：显示修改/添加/删除文件计数、Token 增量、逐文件增减行数 (:530-630)
- IME 组合输入支持 (:199-207)
- 顶部显示 "Experimental Feature" 警告横幅 (:425-435)

**CheckpointSettings** (`src/components/CheckpointSettings.tsx`):

- 自动检查点开关 + 4 种策略下拉 (:193-223)
- 存储管理卡片：显示总数 + 保留最近 N 个 + 清理按钮 (:252-298)
- 保存后 3 秒自动消失的成功提示 (:96)
- 同样带有 "Experimental Feature" 警告

**useCheckpoints hook** (`src/components/claude-code-session/useCheckpoints.ts`):
- 提供 `createCheckpoint / restoreCheckpoint / deleteCheckpoint / forkCheckpoint` 操作
- `timelineVersion` 计数器用于触发 TimelineNavigator 刷新

### 2.6 与 AgentHub Project/Thread/Turn 模型对比

| 维度 | Opcode | AgentHub (建议) |
|------|--------|-----------------|
| **项目粒度** | `~/.claude/projects/{project_id}/` — 基于目录 | 可沿用，增加 Project 元数据（描述、标签） |
| **会话模型** | Session = JSONL 文件，无结构化分段 | Thread = 连贯对话单元，Turn = 一次请求-响应 |
| **检查点粒度** | message_index 级别，可恢复文件 + 消息 | 映射到 Turn 级别更自然（每个 Turn 是一个检查点候选） |
| **时间线** | 单会话树形结构（支持 fork 分支） | 可扩展为跨 Session 的时间线 |
| **Diff** | 文件级别（modified/added/deleted + 增减行数） | 可增强为语义级 Diff（哪些 Turn 引入了哪些变更） |
| **存储** | 内容寻址 + zstd 压缩，基于 SHA-256 | 可直接复用内容寻址 + 压缩方案 |
| **策略** | Manual / PerPrompt / PerToolUse / Smart | AgentHub 可简化：PerPrompt(默认) + Manual |
| **缺失能力** | 无 Turn 级索引、无语义搜索、无跨会话关联 | AgentHub 的 Turn 模型天然支持这些 |

---

## 3. MCP Server 管理、Usage Analytics 与 CLAUDE.md

### 3.1 MCP Server 管理

**后端** (`src-tauri/src/commands/mcp.rs`):

所有 MCP 操作通过 CLI 命令 `claude mcp <subcommand>` 间接执行 (:99-117):
```rust
fn execute_claude_mcp_command(app_handle: &AppHandle, args: Vec<&str>) -> Result<String> {
    let claude_path = find_claude_binary(app_handle)?;
    let mut cmd = create_command_with_env(&claude_path);
    cmd.arg("mcp");
    // ...
}
```

**11 个 Tauri 命令**:

| 命令 | 说明 | 行号 |
|------|------|------|
| `mcp_add` | 添加服务器（支持 stdio/sse transport, scope, env） | :121-209 |
| `mcp_list` | 列出所有服务器 | :213-220 |
| `mcp_get` | 获取单个服务器详情 | — |
| `mcp_remove` | 移除服务器 | — |
| `mcp_add_json` | 通过 JSON 字符串批量添加 | — |
| `mcp_add_from_claude_desktop` | 从 Claude Desktop 配置导入 | — |
| `mcp_serve` | 启动 MCP 服务 | — |
| `mcp_test_connection` | 测试服务器连接 | — |
| `mcp_reset_project_choices` | 重置项目级 MCP 选择 | — |
| `mcp_get_server_status` | 获取服务器运行状态 | — |
| `mcp_read_project_config` / `mcp_save_project_config` | 读写 `.mcp.json` | — |

**MCPServer 数据模型** (`mcp.rs:25-44`):
```rust
pub struct MCPServer {
    pub name: String,
    pub transport: String,         // "stdio" | "sse"
    pub command: Option<String>,   // stdio 模式
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub url: Option<String>,       // SSE 模式
    pub scope: String,             // "local" | "project" | "user"
    pub is_active: bool,
    pub status: ServerStatus,
}
```

**前端 UI** (`src/components/MCPManager.tsx`):

三 Tab 布局 (:135-144):
1. **Servers Tab** — MCPServerList 展示所有服务器
2. **Add Server Tab** — MCPAddServer 表单（name, transport, command/url, args, env, scope）
3. **Import/Export Tab** — MCPImportExport（从 Claude Desktop config 导入，JSON 导出）

交互特点：添加/导入成功后自动切回 Servers Tab + toast 通知，server 移除后乐观更新本地列表。

### 3.2 Usage Analytics

#### 3.2.1 用量统计引擎

**后端** (`src-tauri/src/commands/usage.rs`):

数据来源：解析 `~/.claude/projects/*/` 下的 JSONL 会话文件 (:78-102)：

```rust
struct JsonlEntry {
    timestamp: String,
    message: Option<MessageData>,  // 嵌套 model + usage
    session_id: Option<String>,
    cost_usd: Option<f64>,         // 已有成本字段
}
```

**Claude 4 定价常量** (`usage.rs:67-76`):

| 模型 | Input/MTok | Output/MTok | Cache Write/MTok | Cache Read/MTok |
|------|-----------|-------------|------------------|-----------------|
| Opus 4 | $15.00 | $75.00 | $18.75 | $1.50 |
| Sonnet 4 | $3.00 | $15.00 | $3.75 | $0.30 |

**统计维度**:

| 命令 | 行号 | 返回结构 |
|------|------|---------|
| `get_usage_stats` | — | `UsageStats` — total_cost, total_tokens, input/output/cache tokens, by_model, by_date, by_project |
| `get_usage_by_date_range` | — | 同上，限定日期范围 |
| `get_session_stats` | — | `ProjectUsage[]` — 按项目/会话聚合 |
| `get_usage_details` | — | 明细级别 |

**Token 计数逻辑** (`manager.rs:305-398` — 检查点模块中也复用)：
- 检查 `message.usage.input_tokens`、`output_tokens`
- 检查 `message.usage.cache_creation_input_tokens`、`cache_read_input_tokens`
- 同时检查 `usage` 顶层字段（result messages）

#### 3.2.2 前端仪表板

**UsageDashboard** (`src/components/UsageDashboard.tsx`):

**5 个 Tab**：overview, models, projects, sessions, timeline

**性能优化**：
- 10 分钟 `Map` 缓存 (`dataCache`, :24-25)
- `useMemo` 缓存 summaryCards / mostUsedModels / topProjects / timelineChartData
- `requestIdleCallback` 预加载相邻 Tab 数据 (:177-201)
- `Promise.all` 并行加载 stats + sessions (:117-121 和 :137-147)
- 分页（projects/sessions 各 10 条/页）

**Overview Tab 摘要卡片** (:204-250):
- Total Cost（USD 格式化）、Total Sessions、Total Tokens（K/M 缩写）、Avg Cost/Session

**Timeline Tab**: 自定义迷你柱状图（非 recharts），按日期展示成本趋势

#### 3.2.3 Analytics 埋点系统

**架构** (`src/lib/analytics/`):

```
analytics/
├── index.ts          # PostHog 初始化和 analytics 单例
├── events.ts         # 50+ 事件定义 + eventBuilders + sanitizers
├── consent.ts        # 用户同意管理
├── resourceMonitor.ts # CPU/内存资源监控
└── types.ts          # TypeScript 类型定义
```

**事件分类** (`events.ts:48-134`):

| 类别 | 事件数 | 示例 |
|------|--------|------|
| Session | 9 | session_created, prompt_submitted, checkpoint_created/restored, tool_executed |
| Feature/UI | 8 | feature_used, tab_created/closed, file_opened/edited/saved |
| Agent | 4 | agent_executed, agent_started, agent_progress, agent_error |
| MCP | 6 | mcp_server_connected/disconnected, mcp_server_added/removed, mcp_tool_invoked, mcp_connection_error |
| Slash Command | 4 | slash_command_selected/executed/created |
| Error/Performance | 6 | api_error, ui_error, performance_bottleneck, memory_warning |
| User Journey | 2 | journey_milestone, user_retention |
| Quality | 4 | output_regenerated, conversation_abandoned, suggestion_accepted/rejected |
| Workflow | 3 | workflow_started/completed/abandoned |
| Feature Adoption | 3 | feature_discovered, feature_adopted, feature_combination |
| AI Interaction | 2 | ai_interaction, prompt_pattern |
| Network | 2 | network_performance, network_failure |
| Engagement | 1 | session_engagement |
| Resource | 2 | resource_usage_high, resource_usage_sampled |

**PII 脱敏** (`events.ts:648-700`):
- `sanitizeFilePath()` — 替换为 `*.ext`
- `sanitizeProjectPath()` — 替换为 `project`
- `sanitizeErrorMessage()` — 移除路径、API key 模式、邮箱
- `sanitizeAgentName()` — 只保留类型前缀
- `sanitizeEndpoint()` — `/path/:id` 参数化

**增强型事件** (`enhancedSessionStopped` :233-270):
会话结束时的详细指标：duration_ms, prompts_sent, tools_executed/failed, files_created/modified/deleted, total_tokens_used, code_blocks_generated, errors_encountered, model, checkpoint_count, stop_source, final_state, pending_prompts_count

### 3.3 CLAUDE.md 编辑器

**ClaudeFileEditor** (`src/components/ClaudeFileEditor.tsx`):
- 基于 MarkdownEditor 组件的全功能 Markdown 编辑器
- 支持从 ProjectList 直接打开项目的 CLAUDE.md 文件
- 语法高亮 (react-syntax-highlighter)
- 实时预览 (react-markdown + remark-gfm)

**ProjectSettings** (`src/components/ProjectSettings.tsx`):
- 集成 HooksEditor（管理 project-level hooks）
- 集成 SlashCommandsManager（管理自定义 slash commands）
- `.gitignore` 检查：检测 `.claude/settings.local.json` 是否加入 gitignore

---

## 4. 对 AgentHub Desktop 的具体建议

### 4.1 架构层面可直接借鉴

1. **Tauri 2 + React + Vite 栈完全匹配**：AgentHub Desktop 可复用相同技术栈。Opcode 的 `package.json` 与 `Cargo.toml` 依赖版本可作为基线。

2. **Zustand store 模式**：Opcode 的 sessionStore + agentStore 展示了如何在 Tauri 2 环境下做前端状态管理。AgentHub 的 Thread/Turn 模型可映射为 `threadStore` + `turnStore`，复用 `subscribeWithSelector` + 缓存模式。

3. **apiAdapter 双模式**：Opcode 的 `apiAdapter.ts` 同时支持 Tauri invoke 和 WebSocket 回退。AgentHub 如需 Web 版本可直接复用此模式。

4. **SessionPersistenceService**：基于 localStorage 的会话恢复机制可迁移为 Thread 恢复，30 天清理策略可直接采用。

### 4.2 Checkpoint 系统建议

5. **将 Turn 作为检查点边界**：Opcode 的 `message_index` 粒度自然对应 AgentHub 的 Turn 概念。每个 Turn 完成时自动创建检查点（PerPrompt 或 Smart 策略）。

6. **内容寻址存储直接复用**：Opcode 的 CheckpointStorage（SHA-256 + zstd + content_pool + refs）设计精巧，可完整移植到 AgentHub。

7. **时间线可视化增强**：Opcode 的 TimelineNavigator 只支持单个会话内树形展示。AgentHub 可扩展为跨 Thread 的 Project 级时间线，增加语义搜索。

8. **Diff 增强**：Opcode 只有文件级 diff。AgentHub 可增加 Turn 级语义 diff（对比两个 Turn 的 prompt/response/tool_calls 差异）。

### 4.3 MCP 管理建议

9. **CLI 桥接模式谨慎采用**：Opcode 通过 `claude mcp` CLI 子命令管理 MCP，优点是复用 Claude 原生能力，缺点是依赖 Claude CLI 安装、版本耦合。AgentHub 可考虑直接解析/写入 `.mcp.json` 或 `claude_desktop_config.json`，减少外部依赖。

10. **三 Tab 布局参考**：Servers / Add Server / Import/Export 的 UX 布局简洁实用，可直接参考。

### 4.4 Usage 与 Analytics 建议

11. **JSONL 解析引擎可复用**：Opcode 的 `commands/usage.rs` 中的 JSONL 解析逻辑和定价常量可作为 AgentHub Usage 模块的起点。

12. **Analytics 埋点框架可参考**：Opcode 的 `lib/analytics/` 模块结构清晰（事件定义 + 构建器 + 脱敏 + consent），AgentHub 可建立类似的埋点体系。建议将 sanitizers 提取为共享模块。

13. **Dashboard 性能优化模式**：Map 缓存 + useMemo + requestIdleCallback 预加载 + Promise.all 并行的模式可照搬。

### 4.5 安全注意事项

14. **Web Server 模式需加认证**：Opcode 的 web_server.rs 使用 CORS Any 且无身份验证，仅适合 LAN/SSH 环境。AgentHub 如需远程访问必须增加认证层。

15. **实验性功能标记**：Opcode 明确标记 Checkpoint 和部分功能为 Experimental 并附带警告，AgentHub 可采用相同策略标记早期功能。

### 4.6 差异化机会

16. **Turn 模型天然优势**：Opcode 的会话只是 JSONL 流，没有结构化的请求-响应边界。AgentHub 的 Thread/Turn 模型可在此建立差异化优势：Turn 级检查点、Turn 级 re-run/rollback、Turn Diff、Turn 搜索。

17. **多 Provider 支持**：Opcode 仅支持 Claude Code CLI。AgentHub 可原生支持多 Provider（Claude API、OpenAI、Gemini 等），提供统一的 Thread/Turn 抽象。

18. **协作能力**：Opcode 是纯本地应用。AgentHub 可增加 Thread 分享、Turn 评论等协作功能。
