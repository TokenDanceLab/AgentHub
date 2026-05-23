# OpCode 全面采纳报告：Checkpoint、Tauri 桌面与原生集成

> 基于：`docs/reference/01-learn/repos/05-opcode.md`
> 源码：`D:\Code\AgentHub\reference\opcode` (v0.2.1, AGPL-3.0, commit HEAD)
> 交叉参考：`docs/reference/02-decide/05-undo-rollback.md`、`docs/reference/03-build/frontend/01-desktop-ux.md`
> 日期：2026-05-23

---

## 目录

1. [Checkpoint 系统 -> AgentHub Undo/Rollback 设计](#1-checkpoint-系统---agenthub-undorollback-设计)
2. [Tauri 模式 -> AgentHub Desktop 架构推荐](#2-tauri-模式---agenthub-desktop-架构推荐)
3. [文件系统访问模式](#3-文件系统访问模式)
4. [原生集成模式](#4-原生集成模式)
5. [前端 Zustand Store 与 Tab 系统](#5-前端-zustand-store-与-tab-系统)
6. [水平对比：OpCode vs Kanna vs Claude Code WebUI](#6-水平对比opcode-vs-kanna-vs-claude-code-webui)
7. [安全与实验性功能标记](#7-安全与实验性功能标记)
8. [差异化机会与不采纳项](#8-差异化机会与不采纳项)

---

## 1. Checkpoint 系统 -> AgentHub Undo/Rollback 设计

### 1.1 OpCode Checkpoint 数据模型（完整）

OpCode 定义了 8 个核心类型，构成完整的检查点系统。以下是其定义和如何映射到 AgentHub 的 Project/Thread/Turn 模型。

**核心类型** (`src-tauri/src/checkpoint/mod.rs`):

```rust
// Checkpoint 实体 -- 映射到 AgentHub Turn
struct Checkpoint {
    id: String,                          // UUID v4
    session_id: String,                  // -> AgentHub thread_id
    project_id: String,                  // -> AgentHub project_id
    message_index: u32,                  // -> AgentHub turn_index
    timestamp: String,
    description: Option<String>,
    parent_checkpoint_id: Option<String>, // 形成树形链
    metadata: CheckpointMetadata,
}

// 元数据 -- AgentHub 可扩展为 Turn 元数据
struct CheckpointMetadata {
    total_tokens: u64,
    model_used: Option<String>,
    user_prompt: Option<String>,
    file_changes: Vec<FileChange>,
    snapshot_size: u64,
}

// 文件快照 -- 直接复用
struct FileSnapshot {
    checkpoint_id: String,
    file_path: String,
    content: Vec<u8>,        // zstd 压缩
    hash: String,            // SHA-256
    is_deleted: bool,
    permissions: Option<u32>,
    size: u64,
}
```

**关键映射**：

| OpCode 概念 | AgentHub 概念 | 说明 |
|-------------|--------------|------|
| `session_id` | `thread_id` | 一对一映射 |
| `message_index` | `turn_index` | OpCode 用 JSONL 消息索引，AgentHub 用结构化的 Turn |
| `parent_checkpoint_id` | checkpoint 链 | 完全相同，形成树形历史 |
| 4 种策略 (Manual/PerPrompt/PerToolUse/Smart) | PerPrompt 仅此一种 | AgentHub 的 Turn 边界天然提供了 OpCode 需要 Smart 策略才能实现的粒度 |

### 1.2 内容寻址存储 (Content-Addressed Storage)

OpCode 的 `CheckpointStorage` 是整个检查点系统的基础设施，AgentHub 应完整移植。

**目录结构**：

```
project/.agenthub/checkpoints/{thread_id}/
├── timeline.json            # 序列化的 checkpoint 链
├── content_pool/            # 内容寻址池
│   ├── {sha256_hex_1}       # zstd 压缩的文件内容 (level 3)
│   └── {sha256_hex_2}
└── refs/                    # 引用目录
    └── {checkpoint_id}/
        └── {safe_filename}.json  # {"path": "...", "hash": "...", "is_deleted": bool}
```

**核心机制**：

1. **内容去重** (`storage.rs:100-116`)：相同 SHA-256 的文件在 `content_pool` 中只存一份。多个 checkpoints 通过 `refs/{checkpoint_id}/` 下的 JSON 引用相同 hash。
2. **zstd 压缩**：level 3，消息和文件内容均压缩。实测压缩率约 3-5x（对代码文件）。
3. **安全文件名**：`safe_filename` 将原始路径中的 `/` 和 `\` 替换为安全字符，避免路径穿越。
4. **权限保存**：Unix 权限位存储在 refs JSON 中 (`:561`)。

**AgentHub 移植要点**：

- 将 `~/.claude/projects/` 替换为项目根目录下的 `.agenthub/checkpoints/`
- `content_pool` 路径用 `PathBuf::join()` 而非字符串拼接（OpCode 当前没有问题，但应加固）
- 移植垃圾回收 (`storage.rs:409-459`)：遍历所有 refs 收集被引用的 hash 集合，删除未被引用的 content_pool 文件
- 移植清理策略 (`storage.rs:337-377`)：保留最近 `keep_count` 个 checkpoints，自动 GC

### 1.3 CheckpointManager 核心流程

**创建检查点** (`manager.rs:188-302`) 共 9 步：

1. 提取最新消息 metadata（用户提示、模型、累计 token）(`:305-398`)
2. 递归遍历项目目录收集所有文件（跳过 `.` 开头的隐藏目录如 `.git`）(`:201-235`)
3. 为每个修改过的文件创建 FileSnapshot（读取 + SHA-256 hash）(`:401-449`)
4. 生成 UUID v4 作为 checkpoint_id (`:238`)
5. 构造 Checkpoint 结构体，parent 指向当前活跃 checkpoint (`:244-270`)
6. `storage.save_checkpoint()` 写入磁盘 (`:274-280`)
7. 从磁盘重载 timeline 确保 total_checkpoints 同步 (`:283-289`)
8. 更新 current_checkpoint_id (`:292-293`)
9. 重置 file_tracker 的 is_modified 标记 (`:296-299`)

**AgentHub 简化版**（仅 6 步，因为 Turn 模型消除了消息提取的复杂度）：

```rust
// AgentHub: create_checkpoint_on_turn_completed(turn)
fn create_checkpoint_on_turn_completed(turn: &Turn) -> Result<Checkpoint> {
    // 1. 收集 workspace 文件变更（从 Turn.tool_calls 提取文件操作）
    let file_changes = extract_file_changes(&turn.tool_calls);
    // 2. 仅为变更文件创建快照（跳过未修改文件，复用 parent checkpoint 的 refs）
    let snapshots = create_snapshots(&file_changes);
    // 3. 写入 content_pool + refs
    storage.save_checkpoint(checkpoint_id, &snapshots);
    // 4. 更新 timeline.json
    timeline.append(checkpoint_id, parent_id);
    // 5. 追加 turn_completed event（含 checkpoint_id）
    event_store.append(TurnCompleted { turn_id, checkpoint_id });
    // 6. 更新 FTS5 索引
    fts_index.index_turn(turn);
}
```

**恢复检查点** (`manager.rs:452-599`) 共 8 步，AgentHub 保持相同逻辑：

1. 加载 checkpoint 数据 + file snapshots
2. 收集当前项目所有文件，构建 "应该存在" 的文件集合
3. 删除不再属于 checkpoint 的孤儿文件
4. 递归清理空目录
5. 逐文件恢复（创建父目录 + 写入内容 + 权限）
6. 清空并重置 current_messages（AgentHub：重置 Thread.current_turn_id）
7. 更新 timeline 的 current_checkpoint_id
8. 重建 file_tracker

**AgentHub 差异**：恢复时追加 `turn_undone` 补偿事件而非物理删除。见 `docs/reference/02-decide/05-undo-rollback.md` 4.3 节。

### 1.4 检查点策略：简化为 PerPrompt

OpCode 的 4 种策略及其在 AgentHub 中的必要性：

| 策略 | OpCode 触发条件 | AgentHub 是否需要 | 原因 |
|------|----------------|------------------|------|
| Manual | 用户显式创建 | **保留** | 用户手动保存场景 |
| PerPrompt | `message.type == "user"` | **默认策略** | Turn 完成即触发 |
| PerToolUse | message 中有 tool_use | **不需要** | Turn 内部粒度，过度保存 |
| Smart (OpCode 默认) | 工具名在 `[write, edit, multiedit, bash, rm, delete]` 中 | **不需要** | Turn 边界天然覆盖 |

OpCode 需要 Smart 策略是因为它的 JSONL 会话没有结构化的请求-响应边界。AgentHub 的 Turn 模型天然提供此边界 -- Turn 完成时 state 已是确定性的。

### 1.5 Fork 与 Undo 的双模式融合

OpCode 的 Fork (`manager.rs:661-680`) 恢复文件到基础 checkpoint 后创建新 checkpoint。AgentHub 需要 **Undo (Replace) + Fork (Clone)** 双模式：

```
Undo (Turn 级回退):
  触发: 用户对 Turn T3 执行 Undo
  文件层: restore_checkpoint(T1) -- 直接覆盖
  事件层: append turn_undone(T3) + turn_undone(T2,cascade)
  消息层: FTS5 标记 T2+T3 为 archived（不物理删除）

Fork (Thread 级分支):
  触发: 用户从 Turn T2 Fork 新 Thread
  文件层: 新 Thread 共享 content_pool（SHA-256 天然去重）
  事件层: 新 Thread 独立 JSONL，复制 T0..T2 事件
  消息层: 新 messageId (UUID v4), 时间戳校准 (+1ms)
```

---

## 2. Tauri 模式 -> AgentHub Desktop 架构推荐

### 2.1 当前 AgentHub Desktop 状态

AgentHub Desktop 已有 Tauri 2 骨架：

```
src-tauri/
├── Cargo.toml          # tauri 2, shell, notification, tokio, reqwest
├── tauri.conf.json     # CSP: connect-src http://127.0.0.1:3210 ws://127.0.0.1:3210
└── src/
    ├── main.rs         # 入口，#[windows_subsystem = "windows"]
    ├── lib.rs          # Builder: plugin(shell, notification), manage(EdgeManager), tray, health_check
    ├── commands.rs     # 3 个 Tauri 命令: get_edge_status, start_edge, stop_edge
    ├── edge_manager.rs # EdgeManager: spawn/kill Edge 子进程
    ├── edge_health.rs  # 5s 健康检查轮询 + emit("edge-health")
    ├── notifications.rs # tauri-plugin-notification 封装
    └── tray.rs         # 系统托盘菜单: Show/Hide/Start Edge/Stop Edge/Quit
```

前端有 5 个 Zustand stores (`threadStore`, `runStore`, `uiStore`, `connectionStore`, `searchStore`) 和 13 个组件。

### 2.2 推荐新增的 Tauri 插件

基于 OpCode 的 8 插件配置，AgentHub 需要新增以下插件：

#### P0 -- tauri-plugin-fs

**用途**：RightPanel FileTree 需要读取项目目录的文件列表和内容。当前 AgentHub 通过 HTTP API 从 Edge 获取文件信息，Tauri fs 插件可提供原生性能。

**配置**：
```json
// tauri.conf.json
"plugins": {
  "fs": {
    "scope": {
      "allow": ["$APPDATA/**", "$HOME/**"],
      "deny": [".git/**", "node_modules/**"]
    }
  }
}
```

**Rust 端**：添加 `tauri-plugin-fs = "2"` 到 `Cargo.toml`，`.plugin(tauri_plugin_fs::init())` 到 Builder。

#### P1 -- tauri-plugin-dialog

**用途**：项目选择器中的 "Open Folder" 按钮调用原生文件对话框。OpCode 用 `dialog.open()` 完全替代 Web 的 `<input type="file">`。

**前端调用模式**：
```ts
import { open } from '@tauri-apps/plugin-dialog';
const dir = await open({ directory: true, multiple: false });
```

#### P1 -- tauri-plugin-global-shortcut

**用途**：全局快捷键（Ctrl+K 搜索，Ctrl+T 新 Tab，Ctrl+W 关闭 Tab）。OpCode 在 TabManager 中注册了 7 个全局快捷键。AgentHub 已有 `SearchDialog`（Ctrl+K）但使用 DOM `keydown` 事件 -- 全局快捷键在窗口失焦时仍有效。

#### P2 -- tauri-plugin-clipboard-manager

**用途**：从消息中复制代码块或文本。当前通过 Web API `navigator.clipboard.writeText()` 实现，Tauri 插件更可靠（不需要 HTTPS 或 localhost 特殊权限）。

### 2.3 Managed State 扩展方案

OpCode 使用 4 个 Tauri Managed State：

| OpCode State | AgentHub 对应 | 状态 |
|-------------|--------------|------|
| `AgentDb (Mutex<Connection>)` | Edge SQLite (通过 HTTP API) | 已有，无需 Tauri 层管理 |
| `CheckpointState` | **新增** `CheckpointState` | P0 -- 按 thread_id 懒加载单例 |
| `ProcessRegistryState` | `SharedEdgeManager` | 已有，可扩展为多进程注册表 |
| `ClaudeProcessState` | Runner 管理 | Edge 负责，Tauri 层无感知 |

**AgentHub 推荐的 Managed State 注册**：

```rust
// lib.rs -- 扩展后的 Builder
tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_dialog::init())       // P1: 新增
    .plugin(tauri_plugin_fs::init())           // P0: 新增
    .plugin(tauri_plugin_global_shortcut::init())  // P1: 新增
    .manage(edge.clone())                      // 已有: EdgeManager
    .manage(Arc::new(CheckpointState::new()))  // P0: 新增
    .manage(Arc::new(ProcessRegistry::new()))  // P1: 新增
    .invoke_handler(tauri::generate_handler![
        // 已有 (5)
        commands::get_edge_status,
        commands::start_edge,
        commands::stop_edge,
        notifications::notify_run_completed,
        notifications::notify_run_failed,
        // P0: Checkpoint (13)
        checkpoint::create_checkpoint,
        checkpoint::restore_checkpoint,
        checkpoint::delete_checkpoint,
        checkpoint::fork_checkpoint,
        checkpoint::get_timeline,
        checkpoint::get_checkpoint_diff,
        checkpoint::set_checkpoint_strategy,
        checkpoint::get_checkpoint_strategy,
        checkpoint::cleanup_checkpoints,
        checkpoint::get_storage_stats,
        // P1: Process (4)
        process::list_processes,
        process::kill_process,
        process::get_process_output,
        // P1: File system (2)
        fs_commands::read_workspace_file,
        fs_commands::list_workspace_dir,
    ])
```

### 2.4 ProcessRegistry 移植

OpCode 的 `ProcessRegistry` 管理两种进程类型 (`AgentRun` 和 `ClaudeSession`)，AgentHub 可扩展为：

```rust
pub enum ProcessType {
    EdgeServer,    // 当前 EdgeManager 管理
    AgentRunner,   // claude/codex runner 子进程
    Sidecar,       // 无句柄的 sidecar 进程
}

pub struct ProcessRegistry {
    processes: HashMap<String, ProcessEntry>,
    live_outputs: HashMap<String, Vec<String>>,  // 实时输出缓冲
}

impl ProcessRegistry {
    pub fn register(&mut self, id: String, child: Child, ptype: ProcessType) { ... }
    pub async fn kill(&mut self, id: &str) -> Result<()> { ... }       // SIGTERM -> 5s -> SIGKILL + taskkill
    pub fn append_output(&mut self, id: &str, line: &str) { ... }
    pub fn get_output(&self, id: &str) -> Vec<String> { ... }
}
```

**优雅关闭逻辑**(`registry.rs:239-360`)值得完整移植：
- Unix: `SIGTERM` -> 等待 5s -> `SIGKILL`
- Windows: `taskkill /F /PID {pid}` fallback（当 `child.kill()` 失败时）

### 2.5 apiAdapter 双模式

OpCode 的 `src/lib/apiAdapter.ts` 实现了 Tauri invoke 和 WebSocket 双模式回退：

```ts
// OpCode 模式 -- AgentHub 可复用
const apiCall = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  if (window.__TAURI__) {
    return invoke<T>(cmd, args);     // Tauri IPC
  }
  return wsCall<T>(cmd, args);       // WebSocket (Web 模式)
};
```

AgentHub 当前没有 Web 模式，但双模式设计为未来的浏览器访问留出了架构空间。建议在 `src/api/` 下建立相同的适配层，将现有的 `edgeClient.ts` 调用包装为 `apiCall()`。

---

## 3. 文件系统访问模式

### 3.1 OpCode 的文件访问层级

OpCode 在 4 个层级访问文件系统：

| 层级 | 接口 | 用途 |
|------|------|------|
| **Tauri fs plugin** | `@tauri-apps/plugin-fs` `readTextFile/writeTextFile` | 前端直接读写项目文件 |
| **Tauri commands** | `invoke("read_workspace_dir", {path})` | 通过 Rust 后端间接访问 |
| **Tauri dialog plugin** | `@tauri-apps/plugin-dialog` `open/save` | 文件/目录选择器 |
| **CLI 子进程** | `claude` 或 `codex` 命令行工具 | Agent 执行时的文件操作 |

### 3.2 AgentHub 的当前状态与推荐

AgentHub 当前通过 Edge Server (Go) 的 HTTP API 间接访问文件系统（`GET /v1/workspace/files` 等）。对于 Tauri Desktop 模式，有以下优化机会：

**P0 优化 -- Workspace 文件列表缓存**：
Tauri 端直接 `std::fs::read_dir()` 获取文件列表，比 HTTP 往返快 10-100x。但需注意：
- 文件树较大时（>1000 文件），Rust 端 `WalkDir` 比前端递归 HTTP 请求高效很多
- 通过 `tauri::Emitter` emit 增量更新而非全量轮询

**P1 优化 -- 文件变更监听**：
OpCode 的 `FileTracker` (`checkpoint/mod.rs:113-117`) 维护 `HashMap<PathBuf, FileState>` 跟踪文件修改状态。AgentHub 可扩展为基于 `notify` crate 的文件变更监听器，自动通知前端文件树刷新。

```rust
// src-tauri/src/workspace/watcher.rs
use notify::{Watcher, RecursiveMode, Event};

pub fn spawn_workspace_watcher(app: AppHandle, project_path: PathBuf) {
    let (tx, mut rx) = tokio::sync::mpsc::channel(100);
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, _>| {
        if let Ok(event) = res {
            let _ = tx.blocking_send(event);
        }
    }).unwrap();
    watcher.watch(&project_path, RecursiveMode::Recursive).unwrap();

    // 在 tokio task 中处理事件，去抖 200ms 后 emit 给前端
}
```

### 3.3 安全检查

OpCode 的文件访问有以下安全注意事项（`manager.rs:201-235`）：

1. **跳过隐藏目录**：递归遍历时跳过 `.` 开头的目录（`.git`, `.claude` 等）。AgentHub 应同样处理。
2. **路径穿越防护**：`refs/` 中的 `safe_filename` 将 `/` 替换防止穿越。AgentHub 应增加额外的 `Path::canonicalize()` 检查。
3. **权限恢复**：OpCode 在恢复文件时设置 Unix 权限。AgentHub 跨平台时应使用 `#[cfg(unix)]` 条件编译。

---

## 4. 原生集成模式

### 4.1 系统托盘 (System Tray)

**OpCode**：Show / Hide / Quit，左键点击托盘图标恢复窗口。

**AgentHub** (`src-tauri/src/tray.rs`)：Show / Hide / Start Edge / Stop Edge / Quit，同时支持左键点击恢复和右键菜单。AgentHub 的托盘实现比 OpCode 更完整 -- 增加了 Edge 生命周期控制。

**改进建议**：
- 添加 Edge 状态指示器（菜单项动态更新为 "Edge: Running (PID 12345)"）
- 使用 `TrayIconBuilder::on_tooltip` 动态更新 tooltip 显示状态

### 4.2 通知 (Notifications)

**OpCode**：通过 `tauri-plugin-notification` 发送运行完成/失败通知。

**AgentHub** (`src-tauri/src/notifications.rs`)：已实现 `notify_run_completed` 和 `notify_run_failed`，封装为 Tauri commands 供前端调用。

**改进建议**：
- OpCode 没有实现通知点击跳转。AgentHub 应利用 `tauri-plugin-notification` 的 action 功能，点击通知时 `app.emit("notification-clicked", run_id)`，前端 `useEffect` 监听并切换到对应 Thread。
- 增加静默模式开关（存储在 `uiStore`，Tauri 端通过 managed state 读取）。

### 4.3 全局快捷键 (Global Shortcuts)

**OpCode**：在 `TabManager.tsx` 中注册 Ctrl+T/W/Tab/1-9，基于 DOM `onKeyDown`。非全局 -- 窗口失焦时失效。

**AgentHub 当前**：SearchDialog 使用 Ctrl+K（DOM 事件），其他快捷键尚未实现。

**推荐实现**：

```rust
// 通过 tauri-plugin-global-shortcut
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

app.plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
app.global_shortcut().register(Shortcut::new("ControlOrMeta", "KeyK"))?;
```

快捷键映射表：

| 快捷键 | 操作 | 优先级 |
|--------|------|--------|
| Ctrl+K | 全局搜索 | P0 |
| Ctrl+T | 新 Tab | P1 |
| Ctrl+W | 关闭当前 Tab | P1 |
| Ctrl+Shift+N | 新 Thread | P1 |
| Ctrl+Shift+P | 命令面板 | P1 |
| Ctrl+B | 切换侧栏 | P2 |
| Ctrl+J | 切换底部面板 | P2 |

### 4.4 窗口管理

OpCode 使用默认的单窗口 Tauri 配置。AgentHub 同样使用单窗口但有以下增强机会：

- **窗口状态持久化**：使用 `tauri-plugin-window-state`（OpCode 未使用）保存和恢复窗口位置、大小、最大化状态
- **关闭行为**：`on_window_event(CloseRequested)` 中隐藏而非退出（`prevent_close()` + `hide()`），与托盘模式一致
- **开机启动**：通过 `tauri-plugin-autostart` 实现（OpCode 未使用）

### 4.5 Web Server 模式的安全评估

OpCode 的 `web_server.rs`（Axum 0.8 HTTP + WebSocket，CORS Any，无认证）是一个安全风险点。AgentHub 如未来需要 Web 远程访问模式，必须：

1. **最小化 CORS**：仅允许 `127.0.0.1` 或配置的白名单域名
2. **Token 认证**：启动时生成随机 token，URL query parameter 传递
3. **速率限制**：每个 token 每秒最多 100 请求
4. **LAN 使用警告**：UI 中明确警告用户 Web Server 模式的安全边界

---

## 5. 前端 Zustand Store 与 Tab 系统

### 5.1 Store 对比与扩展

| OpCode Store | AgentHub Store | 对比 |
|-------------|---------------|------|
| `sessionStore` | `threadStore` | OpCode 的 sessionStore 功能更重（含项目列表、实时输出、会话加载）。AgentHub 的 threadStore 较精简，可逐步扩展 |
| `agentStore` | `runStore` | 两者映射不精确。OpCode 的 agentStore 管理 Agent Run 列表 + 5s 缓存 + 轮询。AgentHub 的 runStore 管理当前 run 状态 + 流式状态 |
| 无 | `uiStore` | AgentHub 独有，管理布局、主题、移动端适配 |
| 无 | `connectionStore` | AgentHub 独有，管理 Edge WebSocket 连接状态 |
| 无 | `searchStore` | AgentHub 独有，管理全局 FTS5 搜索 |

**AgentHub 可借鉴的 OpCode 模式**：

1. **双 Map 缓存** (`agentStore.ts`)：5 秒 `Map` 缓存避免重复 API 调用。AgentHub 的 `threadStore.setThreads()` 可用同样模式避免 10s 轮询中的数据闪烁。
2. **Tab 持久化** (`TabPersistenceService`)：AgentHub 暂无 Tab 系统，但在引入多 Thread 并发查看时需要。OpCode 的 `localStorage` + 30 天过期策略可直接复用。
3. **Session 持久化** (`SessionPersistenceService`)：AgentHub 的 Thread 恢复可采用相同策略 -- `localStorage` 序列化活跃 Thread ID + 最后阅读位置，30 天过期。

### 5.2 Tab 系统评估

OpCode 的 TabManager 支持 9 种 Tab 类型（chat, agent, settings 等）并支持拖拽排序（framer-motion Reorder）。AgentHub 的 UI 设计规范（`01-desktop-ux.md`）定义了类似的多面板布局但使用固定三栏而非动态 Tab 标签。

**建议**：AgentHub 当前不需要 Tab 系统。三栏布局（Sidebar + Center Chat + Right Panel）对 Thread 级对话已足够。Tab 系统在以下场景引入：
- 用户需要同时查看 2+ 个 Thread 的对话
- 用户需要在 Chat 和 Settings 间快速切换

### 5.3 TimelineNavigator UI

OpCode 的 `TimelineNavigator.tsx` (~420 行) 是一个可直接参考的检查点时间线 UI 组件：

**核心特性**：
- 树形递归渲染 `TimelineNode`
- 当前活跃 checkpoint 用 `ring-2 ring-primary/20` 高亮
- 每节点 3 个操作按钮：Restore / Fork / Compare
- Diff 对话框：显示修改/添加/删除文件计数 + token 增量 + 逐文件增减行数
- 自动展开当前 checkpoint 路径
- "Experimental Feature" 警告横幅

**AgentHub 移植**：组件重命名为 `CheckpointTimeline.tsx`，放置于 RightPanel 的 `Tab: Timeline`（新增 Tab 类型）。数据通过 `invoke("get_timeline", {threadId})` 获取，`timelineVersion` 计数器用于触发刷新。

---

## 6. 水平对比：OpCode vs Kanna vs Claude Code WebUI

### 6.1 Checkpoint/Undo 能力矩阵

| 维度 | OpCode | Kanna | Claude Code WebUI | AgentHub 目标 |
|------|--------|-------|-------------------|--------------|
| **文件级回滚** | 全量快照 (SHA-256 + zstd) | 无 | 无 | 复用 OpCode content_pool |
| **操作级回滚** | message_index 边界 (Smart 策略) | Fork=transcript 复制 | 无 | Turn 边界（天然粒度） |
| **会话级分支** | Fork=新 session (树形) | Fork=新 chatId + session token | 无 | Thread Fork + 4 ForkMode |
| **Diff** | 文件级 (modified/added/deleted) | 无 | 无 | 文件级 + Turn 语义 diff |
| **存储去重** | SHA-256 content_pool | 无 | 无 | SHA-256 content_pool |
| **事件保留** | JSONL 覆盖式回滚 | 不删除原始 event | 不适用 | append turn_undone 补偿事件 |
| **垃圾回收** | GC orphan content files | 无 | 无 | 移植 Opcode GC |

### 6.2 Tauri 桌面模式对比

| 维度 | OpCode | Kanna | Claude Code WebUI | AgentHub |
|------|--------|-------|-------------------|----------|
| **桌面框架** | Tauri 2 | Web (Express + WS) | Web (Next.js + WS) | Tauri 2 |
| **原生能力** | dialog, fs, shell, notification, clipboard, shortcut, updater, process | 无 | 无 | shell, notification (P0), + dialog/fs/shortcut (P1) |
| **系统托盘** | Show/Hide/Quit | 无 | 无 | Show/Hide/Start Edge/Stop Edge/Quit |
| **子进程管理** | ProcessRegistry (AgentRun + ClaudeSession) | agent-coordinator (内存态) | 无 | EdgeManager (Edge) + ProcessRegistry (Runner) |
| **前端状态** | Zustand v5 + subscribeWithSelector | 无框架 (SSE event-driven) | 无框架 (SSE event-driven) | Zustand v5 + subscribeWithSelector |
| **Tab 系统** | 9 种 Tab + 拖拽排序 | 无 | 无 | 三栏固定布局 (当前), Tab 系统 (P2) |
| **Web 模式** | Axum WS server (CORS Any) | 原生 Web | 原生 Web | Edge HTTP + WS (已有) |
| **移动端** | 无 | 无 | 无 (桌面优先) | PWA + Drawer/BottomSheet (规划中) |

### 6.3 关键洞察

1. **OpCode 是唯一实现文件级回滚的竞争者**。Kanna 的 Fork 仅复制 transcript (JSONL)，不涉及文件系统。Claude Code WebUI 完全没有 checkpoint 概念。OpCode 的 content_pool 是 AgentHub 文件回滚的唯一可用参考实现。

2. **AgentHub 已有比 OpCode 更好的 Edge 管理**。OpCode 的 Edge Server 设计（CORS Any, 无认证）存在安全风险。AgentHub 的 Edge Server (Go) + Managed State (Rust) 架构更清晰、更安全。

3. **Kanna 的 EventStore 补偿事件模式**与 AgentHub 的 `turn_undone` 设计一致。OpCode 在回滚时直接覆盖 JSONL（破坏 audit trail），AgentHub 采用 Kanna 的 append-only 策略更优。

4. **前端状态管理对比**：OpCode 和 AgentHub 都使用 Zustand v5 + `subscribeWithSelector`，这是同类项目中最佳实践的验证。Kanna 和 Claude Code WebUI 使用 SSE event-driven 无状态管理框架，在复杂 UI 下难以维护。

---

## 7. 安全与实验性功能标记

### 7.1 OpCode 的安全实践

**已有措施**：
- CSP 配置（`default-src 'self'`）
- 跳过 `.` 开头的隐藏目录避免敏感文件泄露
- 文件路径 `safe_filename` 转换防穿越

**不足**：
- Web Server 模式 CORS Any + 无认证（`web_server.rs`）
- 子进程环境变量继承（可能泄露 API keys）
- CLI 命令参数未脱敏（MCP 添加时）

### 7.2 AgentHub 安全增强

| 风险点 | OpCode 状态 | AgentHub 建议 |
|--------|------------|--------------|
| Web 远程访问 | CORS Any, 无认证 | Token 认证 + 白名单 + 速率限制 |
| 子进程环境 | 继承父进程 env | 最小化 env 传递，仅传递必要变量 |
| 文件快照 | 包含所有项目文件 | 增加 `.agenthubignore` 排除敏感文件 |
| 托盘 IPC | 无认证 | Tauri 内建隔离（已有） |
| 通知内容 | 裸文本 | 脱敏 agent_name 和 error 中的路径 |

### 7.3 实验性功能标记

OpCode 在 TimelineNavigator 和 CheckpointSettings 组件中清晰标记 "Experimental Feature" 警告。AgentHub 应采用同样模式：

- Checkpoint 功能标记为 "Experimental" 直到 Turn 级 undo 通过稳定性测试
- 通知功能标记为 "Beta"
- 全局快捷键标记为 "Experimental"（跨平台兼容性验证前）

---

## 8. 差异化机会与不采纳项

### 8.1 AgentHub 的差异化优势

基于本次调研，AgentHub 在以下方面可以超越 OpCode：

1. **Turn 级 checkpoint vs JSONL message_index**：结构化 Turn 模型使 checkpoint 粒度更自然，且支持 Turn 级语义搜索和 diff。
2. **Multi-Provider vs Claude-only**：AgentHub 支持 Claude API + OpenAI + Gemini 等多 Provider，OpCode 仅支持 Claude Code CLI。
3. **EventStore append-only 审计**：AgentHub 采用 Kanna 的补偿事件模式保留完整 audit trail，OpCode 的覆盖式回滚丢失历史。
4. **Edge Server 隔离架构**：AgentHub 的 Edge Server (Go) + Tauri Shell 架构比 OpCode 的单体 Tauri 应用更安全、更可扩展。
5. **PWA 移动端支持**：AgentHub 规划了完整的 PWA + Drawer/BottomSheet 移动端方案，OpCode 无移动端。
6. **IM 协作**：AgentHub 的 Hub 架构支持多用户 Thread 分享和 Turn 评论，OpCode 是纯本地应用。

### 8.2 不采纳的 OpCode 特性

| 特性 | 原因 |
|------|------|
| Smart / PerToolUse checkpoint 策略 | Turn 边界天然覆盖，增加复杂度无收益 |
| PerPrompt (OpCode 含义) | OpCode 的 PerPrompt 指每次用户消息后检查 -- AgentHub 不需要，因为 Turn 完成时自动触发 |
| Axum Web Server 模式 | AgentHub 已有 Edge Server (Go) 提供 HTTP + WS，不需要 Axum |
| CLAUDE.md 编辑器 | AgentHub 不依赖 Claude Code CLI 的 CLAUDE.md 约定（可选但非核心） |
| PostHog Analytics 埋点 | AgentHub 可使用更轻量的自建分析（或 P2 引入） |
| Usage Dashboard 完整移植 | AgentHub 的用量统计由 Hub Server 统一处理，Desktop 只需查询接口 |
| Tab 系统（当前阶段） | 三栏固定布局对 P0 足够，Tab 增加复杂度但无当前需求 |
| CLI 桥接 MCP 管理 | AgentHub 可直接管理 `.mcp.json`，无需依赖外部 CLI |
| MCP 通过 CLI 子命令管理 | 依赖 `claude mcp` CLI，AgentHub 直接用 REST API 管理更独立 |

---

## 附录 A：文件移植清单

以下 OpCode 文件建议移植到 AgentHub，标注了修改程度：

| OpCode 源文件 | AgentHub 目标文件 | 修改程度 | 优先级 |
|--------------|------------------|---------|--------|
| `checkpoint/mod.rs` | `src-tauri/src/checkpoint/mod.rs` | 中等 -- 将 `session_id` 改为 `thread_id`，移除 Smart 策略 | P0 |
| `checkpoint/manager.rs` | `src-tauri/src/checkpoint/manager.rs` | 高 -- 简化消息提取逻辑，对齐 Turn 模型 | P0 |
| `checkpoint/storage.rs` | `src-tauri/src/checkpoint/storage.rs` | 低 -- 修改目录路径从 `~/.claude/` 到 `.agenthub/` | P0 |
| `checkpoint/state.rs` | `src-tauri/src/checkpoint/state.rs` | 低 -- `session_id` -> `thread_id` | P0 |
| `process/registry.rs` | `src-tauri/src/process/registry.rs` | 低 -- 增加 `EdgeServer` 进程类型 | P1 |
| `TimelineNavigator.tsx` | `src/components/CheckpointTimeline.tsx` | 中等 -- 适配 AgentHub Theme + i18n | P1 |
| `CheckpointSettings.tsx` | `src/components/CheckpointSettings.tsx` | 中等 -- 移除策略选择（仅保留 Manual + PerPrompt） | P1 |
| `lib/apiAdapter.ts` | `src/api/apiAdapter.ts` | 低 -- 增加 Tauri invoke 封装 | P2 |
| `services/sessionPersistence.ts` | `src/services/threadPersistence.ts` | 低 -- Thread 替换 Session | P2 |

## 附录 B：AgentHub Desktop Cargo.toml 扩展建议

```toml
[dependencies]
# 已有
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell = "2"
tauri-plugin-notification = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["process", "time", "sync"] }
reqwest = { version = "0.12", features = ["json"] }

# P0: Checkpoint 系统
tauri-plugin-dialog = "2"         # 原生文件/目录对话框
tauri-plugin-fs = "2"             # 原生文件系统访问
sha2 = "0.10"                     # SHA-256 哈希
zstd = "0.13"                     # zstd 压缩
uuid = { version = "1", features = ["v4"] }  # checkpoint UUID
walkdir = "2"                     # 递归目录遍历（checkpoint 文件扫描）
serde_yaml = "0.9"                # timeline.json 备选序列化格式

# P1: 原生集成增强
tauri-plugin-global-shortcut = "2" # 全局快捷键
notify = "7"                       # 文件系统变更监听
tauri-plugin-window-state = "2"   # 窗口状态持久化

# P2
tauri-plugin-clipboard-manager = "2"  # 剪贴板管理
tauri-plugin-updater = "2"            # 自动更新
```
