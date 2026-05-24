# OpCode Source Adoption Map: Checkpoint + Desktop -> AgentHub

> 调研日期：2026-05-24
> 比对范围：OpCode `reference/opcode/src-tauri/src/` vs AgentHub `edge-server/internal/` + `app/desktop/src-tauri/`
> 优先级：P0 = 阻塞性差距/立即采纳，P1 = 季度级规划，P2 = 长期优化

---

## 1. Checkpoint System: OpCode -> AgentHub Rollback/Undo

### 1.1 Data Model: Checkpoint -> Turn-level Snapshot

| # | OpCode source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 1 | `reference/opcode/src-tauri/src/checkpoint/mod.rs:13-30` — `Checkpoint` struct: id, session_id, project_id, message_index, timestamp, description, parent_checkpoint_id, metadata | AgentHub has no checkpoint data model. Create `edge-server/internal/checkpoint/model.go` with `Checkpoint` struct mapping `message_index` -> `TurnID` | 新增 `internal/checkpoint/` 包，Checkpoint 结构体关联 Turn 而非 message_index | **P0** |
| 2 | `reference/opcode/src-tauri/src/checkpoint/mod.rs:34-46` — `CheckpointMetadata`: total_tokens, model_used, user_prompt, file_changes, snapshot_size | `edge-server/internal/runnerctx/session_metrics.go` — token tracking exists but not checkpoint-linked | 将 `CheckpointMetadata` 嵌入 Checkpoint，复用 session_metrics 的 token 统计 | **P1** |
| 3 | `reference/opcode/src-tauri/src/checkpoint/mod.rs:49-66` — `FileSnapshot`: checkpoint_id, file_path, content, hash(SHA-256), is_deleted, permissions, size | AgentHub has no file snapshotting. `store/` only tracks run lifecycle. | 新增 `FileSnapshot` 模型，SHA-256 哈希计算在 `internal/checkpoint/snapshot.go` | **P0** |
| 4 | `reference/opcode/src-tauri/src/checkpoint/mod.rs:69-96` — `TimelineNode` + `SessionTimeline`: tree structure with root_node, children, current_checkpoint_id, auto_checkpoint_enabled, checkpoint_strategy | AgentHub has `Thread` model but no timeline/version tree | 新增 `Timeline` 模型关联到 Thread，支持 fork 分支 | **P1** |
| 5 | `reference/opcode/src-tauri/src/checkpoint/mod.rs:99-110` — `CheckpointStrategy`: Manual, PerPrompt, PerToolUse, Smart | AgentHub has no checkpoint strategy concept | 在 `CheckpointConfig` 中新增策略字段，默认 Smart | **P1** |
| 6 | `reference/opcode/src-tauri/src/checkpoint/mod.rs:144-171` — `CheckpointDiff` + `FileDiff`: modified_files, added_files, deleted_files, token_delta, diff_content | AgentHub has no diff between runs/states | 新增 `CheckpointDiff` 模型，复用 Turn 级对比 | **P2** |

### 1.2 Checkpoint Engine: Manager -> AgentHub Run Executor

| # | OpCode source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 7 | `reference/opcode/src-tauri/src/checkpoint/manager.rs:17-25` — `CheckpointManager`: project_id, session_id, project_path, file_tracker, storage, timeline, current_messages | `edge-server/internal/lifecycle/process_executor.go:32-42` — `ProcessExecutor`: manages run lifecycle but NO checkpoint integration | 在 `ProcessExecutor` 中注入可选的 `CheckpointManager`，在 `run()` 方法中每个 Turn 完成时触发检查点 | **P0** |
| 8 | `reference/opcode/src-tauri/src/checkpoint/manager.rs:188-302` — `create_checkpoint()`: 提取消息元数据 → 递归扫描项目文件 → 对比 file_tracker 找修改 → 创建 FileSnapshot + SHA-256 → 生成 UUID → 构造 Checkpoint → 写入磁盘 → 更新 timeline → 重置 file_tracker | `edge-server/internal/lifecycle/process_executor.go:140-270` — `run()`: 流式输出捕获但没有 Turn 完成后的快照逻辑 | 在 `publishStructuredOutput` 完成后调用 `CheckpointManager.CreateIfNeeded(run, strategy)` | **P0** |
| 9 | `reference/opcode/src-tauri/src/checkpoint/manager.rs:452-599` — `restore_checkpoint()`: 加载检查点 + 快照 → 删除不属于检查点的文件 → 清理空目录 → 逐文件恢复（创建父目录 + 写入 + Unix 权限） → 清空 current_messages → 更新 timeline → 重建 file_tracker | AgentHub 无恢复能力 | 新增 `CheckpointManager.Restore(ctx, checkpointID)` 方法，在 `ProcessExecutor` 中通过 API 暴露 | **P1** |
| 10 | `reference/opcode/src-tauri/src/checkpoint/manager.rs:661-680` — `fork_from_checkpoint()`: 加载基础检查点 → 恢复文件 → 创建新检查点（parent 指向原检查点） → 在 timeline 中作为子节点 | AgentHub 有 `ForkSession` 参数 (`RunProcessContext.ForkSession`) 但只传递到 CLI 参数，无本地 fork 逻辑 | 在 `CheckpointManager` 中实现 `Fork(fromID)` 创建分支检查点 | **P2** |
| 11 | `reference/opcode/src-tauri/src/checkpoint/manager.rs:683-746` — `should_auto_checkpoint()`: PerPrompt 检查消息 type=="user"，PerToolUse 检查 tool_use，Smart 检查工具名在 ["write","edit","multiedit","bash","rm","delete"] | `edge-server/internal/adapters/security_hooks.go:83-98` — `classifyRisk()` 已有工具分类逻辑 | 复用 `classifyRisk` 结果判断 Smart 策略触发（RiskMedium + RiskHigh 触发检查点） | **P1** |

### 1.3 Content-Addressable Storage

| # | OpCode source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 12 | `reference/opcode/src-tauri/src/checkpoint/storage.rs:13-23` — `CheckpointStorage`: claude_dir, compression_level=3 (zstd) | AgentHub 无持久化检查点存储 | 新增 `internal/checkpoint/storage.go`，使用 SHA-256 + zstd + content_pool + refs 架构 | **P0** |
| 13 | `reference/opcode/src-tauri/src/checkpoint/storage.rs:98-116` — 内容寻址存储: `content_pool/{sha256_hash}` 存 zstd 压缩内容，`refs/{checkpoint_id}/{safe_filename}.json` 存引用 | AgentHub 无此架构 | 直接移植内容寻址设计到 Go，使用 `compress/zstd` + `crypto/sha256` | **P0** |
| 14 | `reference/opcode/src-tauri/src/checkpoint/storage.rs:337-377` — `cleanup_old_checkpoints()`: 按时间排序 → 保留最近 keep_count 个 → 删除旧检查点 | AgentHub 无清理逻辑 | 在 `CheckpointManager` 中新增 `Cleanup(keepCount int)` 方法 | **P1** |
| 15 | `reference/opcode/src-tauri/src/checkpoint/storage.rs:409-459` — `garbage_collect_orphan_files()`: 遍历所有 refs 收集引用 hash → 删除 content_pool 中未引用文件 | AgentHub 无 GC | 在 cleanup 后自动触发 GC | **P2** |

### 1.4 Global Checkpoint State Pool

| # | OpCode source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 16 | `reference/opcode/src-tauri/src/checkpoint/state.rs:52-82` — `CheckpointState.get_or_create_manager()`: 按 session_id 懒加载单例，已存在复用 Arc | `edge-server/internal/lifecycle/process_executor.go:39-41` — `ProcessExecutor.running` map 只管理运行状态 | 新增 `CheckpointState` 管理多个 CheckpointManager 生命周期 | **P1** |
| 17 | `reference/opcode/src-tauri/src/checkpoint/state.rs:96-99` — `remove_manager()`: 会话结束清理 | AgentHub 无对应清理 | 在 Run 完成/取消时调用 `CheckpointState.RemoveManager(threadID)` | **P1** |

---

## 2. Process Lifecycle: OpCode ProcessRegistry -> AgentHub ProcessExecutor

### 2.1 Process Management

| # | OpCode source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 18 | `reference/opcode/src-tauri/src/process/registry.rs:9-37` — `ProcessRegistry`: processes HashMap<run_id, ProcessHandle> + next_id 自增 | `edge-server/internal/lifecycle/process_executor.go:39-41` — `ProcessExecutor.running map[string]context.CancelFunc` + `stdins map[string]io.Writer` | AgentHub 已有等效实现。差异：OpCode 区分 AgentRun/ClaudeSession 两种 ProcessType | **P2** |
| 19 | `reference/opcode/src-tauri/src/process/registry.rs:57-82` — `register_process()`: 注册 tokio::process::Child 句柄 | `edge-server/internal/lifecycle/process_executor.go:79-101` — `Start()`: 通过 context.WithCancel 管理子进程 | AgentHub 使用 Go context 而非直接持有 Child 句柄，设计等效但更简洁 | 无需变更 |
| 20 | `reference/opcode/src-tauri/src/process/registry.rs:239-360` — `kill_process()`: 优雅关闭 SIGTERM → 5s 超时 → SIGKILL + taskkill fallback | `edge-server/internal/lifecycle/process_executor.go:103-138` — `Cancel()`: 先写 stdin interrupt → context.Cancel() → 子进程被 SIGKILL | AgentHub 缺少 Windows taskkill fallback | 在 `Cancel()` 中加入平台相关的强制终止逻辑 | **P2** |
| 21 | `reference/opcode/src-tauri/src/process/registry.rs:472-491` — `append_live_output()` / `get_live_output()`: 实时输出缓冲区 | `edge-server/internal/lifecycle/process_executor.go:272-294` — `publishOutput()`: 直接推送事件总线，不缓冲 | AgentHub 的 event bus 模式更优（无缓冲延迟），无需变更 | 无需变更 |

### 2.2 Tauri Desktop -> AgentHub Desktop

| # | OpCode source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 22 | `reference/opcode/src-tauri/src/main.rs:58-61` — Tauri plugin 注册: dialog, shell, fs, process, updater, notification, clipboard-manager, global-shortcut, http | `app/desktop/src-tauri/tauri.conf.json:24-28` — 仅注册 shell plugin | 注册 dialog（文件选择器）和 notification（系统通知）plugins | **P1** |
| 23 | `reference/opcode/src-tauri/src/main.rs:119-148` — Tauri Managed State: AgentDb, CheckpointState, ProcessRegistryState, ClaudeProcessState | AgentHub desktop 无对应全局状态管理 | 在 Tauri setup 中注册 `AppState`（含 store 连接和 event bus 引用） | **P1** |
| 24 | `reference/opcode/src-tauri/src/main.rs:186-292` — 60+ Tauri 命令注册，7 大类 | AgentHub desktop 命令未定义 | 按需暴露：Run CRUD、Thread 列表、Session 管理、权限审批 | **P1** |
| 25 | `reference/opcode/src-tauri/src/web_server.rs` — Axum WebSocket 服务器，支持浏览器远程访问，CORS Any | `edge-server/internal/httpserver/server.go` — 已有 HTTP+WS 服务器 | OpCode 的远程访问模式可作为 AgentHub Desktop 的"无后端"模式参考 | **P2** |

---

## 3. Desktop UI Architecture: OpCode React Frontend -> AgentHub Desktop

### 3.1 Tab System & State Management

| # | OpCode source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 26 | `reference/opcode/src/components/TabManager.tsx` — 9 种 Tab 类型，framer-motion 拖拽排序，Ctrl+T/W/Tab 快捷键 | AgentHub desktop 无前端实现 | 参考 OpCode Tab 系统设计 AgentHub Desktop 的 Thread/Turn 多标签页 | **P1** |
| 27 | `reference/opcode/src/stores/sessionStore.ts` + `agentStore.ts` — Zustand v5 + subscribeWithSelector + 5秒缓存 | AgentHub 无前端状态管理 | 使用 Zustand + subscribeWithSelector 管理 Thread 列表和实时事件 | **P1** |
| 28 | `reference/opcode/src/lib/apiAdapter.ts` — Tauri invoke / WebSocket 双模式 | AgentHub Desktop 可通过相同模式实现 Tauri invoke 或 WebSocket 回退 | 复用双模式 API 适配器设计 | **P1** |
| 29 | `reference/opcode/src/services/sessionPersistence.ts` — localStorage 30 天过期清理 | AgentHub 可用相同策略持久化 Thread 恢复状态 | 复用 localStorage 持久化 + 30 天过期策略 | **P2** |

### 3.2 Checkpoint UI

| # | OpCode source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 30 | `reference/opcode/src/components/TimelineNavigator.tsx` — 树形时间线可视化，递归渲染 TimelineNode，Restore/Fork/Compare 按钮，Diff 对话框 | AgentHub 无时间线 UI | 基于 AgentHub 的 Checkpoint 模型设计 Web UI 时间线组件 | **P1** |
| 31 | `reference/opcode/src/components/CheckpointSettings.tsx` — 自动检查点开关 + 4 策略下拉 + 存储管理 + 清理按钮 | AgentHub 无检查点设置 UI | 设计 Project Settings 中的 Checkpoint 配置面板 | **P2** |
| 32 | `reference/opcode/src/components/claude-code-session/useCheckpoints.ts` — create/restore/delete/fork hook + timelineVersion 计数器 | AgentHub 无前端 checkpoint hooks | 实现 `useCheckpoints` hook（React/Vue composable） | **P1** |

---

## 4. MCP Management: OpCode -> AgentHub

| # | OpCode source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 33 | `reference/opcode/src-tauri/src/commands/mcp.rs:99-117` — 通过 `claude mcp <subcommand>` CLI 间接管理 MCP | AgentHub 无 MCP 管理 | 不采用 CLI 桥接：直接解析/写入 `.mcp.json` 或 `claude_desktop_config.json` | **P1** |
| 34 | `reference/opcode/src-tauri/src/commands/mcp.rs:25-44` — `MCPServer` 模型: name, transport(stdio/sse), command, args, env, url, scope, is_active, status | AgentHub 无 MCP 模型 | 新增 `MCPServer` 模型和 CRUD API | **P1** |
| 35 | `reference/opcode/src-tauri/src/commands/mcp.rs:121-209` — `mcp_add`: 支持 stdio/sse transport, scope, env 配置 | AgentHub 无 MCP 添加端点 | 新增 `POST /api/mcp/servers` 端点 | **P1** |

---

## 5. Usage Analytics: OpCode -> AgentHub

| # | OpCode source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 36 | `reference/opcode/src-tauri/src/commands/usage.rs:67-76` — Claude 4 定价常量表（Opus 4: $15/$75, Sonnet 4: $3/$15） | AgentHub 无定价模型 | 新增 `internal/usage/pricing.go`，维护多模型定价表（Claude/GPT/Gemini） | **P1** |
| 37 | `reference/opcode/src-tauri/src/commands/usage.rs:78-102` — JSONL 解析引擎：解析 `~/.claude/projects/*/` 下的 JSONL 文件提取 token/cost | `edge-server/internal/runnerctx/session_metrics.go` — 已有 session 指标但无成本计算 | 新增 `UsageCalculator` 基于 session_metrics 计算成本 | **P1** |
| 38 | `reference/opcode/src/lib/analytics/` — 50+ 事件 + eventBuilders + sanitizers + consent | AgentHub 无分析埋点 | 可选集成 PostHog 埋点框架，参考 OpCode 的 sanitizers 设计 | **P2** |
| 39 | `reference/opcode/src/lib/analytics/events.ts:648-700` — PII 脱敏: sanitizeFilePath, sanitizeProjectPath, sanitizeErrorMessage, sanitizeAgentName | AgentHub 无脱敏 | 将 sanitizers 逻辑移植为 Go 工具函数 | **P2** |

---

## 6. API Adapter Double-Mode: OpCode -> AgentHub

| # | OpCode source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 40 | `reference/opcode/src/lib/apiAdapter.ts:33-60` — `apiCall()` 检测 `window.__TAURI__` 决定 invoke() 或 WebSocket | AgentHub Desktop 无此适配层 | 在 Desktop 前端实现 `apiAdapter` 双模式 | **P1** |
| 41 | `reference/opcode/src/lib/api.ts:44-60` — `initializeWebMode()` 检测运行模式 | AgentHub Desktop 可通过环境变量 `VITE_RUN_MODE` 区分 | 实现运行模式检测 | **P1** |

---

## 7. Differences & AgentHub Advantages

| 维度 | OpCode | AgentHub (现状 + 规划) | 差异化优势 |
|------|--------|----------------------|----------|
| **会话模型** | Session = JSONL 流，无结构化分段 | Thread/Turn 结构化的请求-响应边界 | Turn 级回滚、Turn Diff、Turn 搜索 |
| **Provider** | 仅 Claude Code CLI | Claude Code + Codex + OpenCode（已实现 3 个 adapter） | 多 Provider 原生支持 |
| **检查点粒度** | message_index 级别 | Turn 级别（更自然、更粗粒度） | 减少检查点数量，增加语义化 |
| **协议** | Tauri invoke / WebSocket | HTTP+WS event bus + NDJSON 流 | 事件驱动架构更解耦 |
| **权限** | CLI 原生权限模式 | SecurityHook + HookChain + 控制协议 | 可组合的权限管道 |
| **部署** | 纯桌面 | Edge Server + Desktop 分离 | 支持 headless 部署 |
| **安全** | Web Server 无认证 (CORS Any) | JWT middleware 路由跳过 | 生产级安全 |
