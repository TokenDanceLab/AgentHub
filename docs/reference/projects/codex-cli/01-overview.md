# Codex CLI 深度调研报告

> 调研日期：2026-05-21
> 源码仓库：`D:\Code\AgentHub\reference\codex`（OpenAI Codex CLI）
> 语言：Rust（`codex-rs/` 为 Rust monorepo，含 ~80+ crate）

---

## 1. CLI 架构与命令体系

### 1.1 入口与命令结构

**入口文件**：`codex-rs/cli/src/main.rs:87-118` — `MultitoolCli` struct，使用 `clap` derive 宏。

**二进制名**：`codex`（用户侧），实际可执行文件名可能带平台后缀（如 `codex-x86_64-unknown-linux-musl`）。

**顶层命令表**（`main.rs:119-199`）：

| 命令 | 别名 | 说明 |
|------|------|------|
| `Exec` | `e` | 非交互式执行（一次性 prompt） |
| `Review` | — | 非交互式代码审查 |
| `Login` | — | 认证管理（API Key / Access Token / ChatGPT / Device Code） |
| `Logout` | — | 清除认证凭证 |
| `Mcp` | — | 管理外部 MCP 服务器 |
| `Plugin` | — | 管理 Codex 插件 |
| `McpServer` | — | 将 Codex 自身作为 MCP server (stdio) 启动 |
| `AppServer` | — | [实验性] App server 及其工具链 |
| `RemoteControl` | — | [实验性] 带远程控制的 app-server daemon |
| `App` | — | 启动 Codex 桌面应用（macOS/Windows） |
| `Completion` | — | 生成 shell 自动补全 |
| `Update` | — | 更新到最新版本 |
| `Doctor` | — | 诊断本地安装、配置、认证、运行时健康 |
| `Sandbox` | — | 在 Codex 沙箱中执行命令（macOS Seatbelt / Linux landlock / Windows 受限 token） |
| `Debug` | — | 调试工具（models、app-server、prompt-input、trace-reduce、clear-memories） |
| `Execpolicy` | — | 执行策略工具 |
| `Apply` | `a` | 将 Codex 产生的最新 diff 应用为 `git apply` |
| `Resume` | — | 恢复之前的交互式会话（picker；`--last` 恢复最近） |
| `Fork` | — | 分叉之前的交互式会话 |
| `Cloud` | `cloud-tasks` | [实验性] 浏览 Codex Cloud 任务并应用变更 |
| `ResponsesApiProxy` | — | 内部：运行 Responses API 代理 |
| `StdioToUds` | — | 内部：stdio 到 Unix domain socket 中继 |
| `ExecServer` | — | [实验性] 独立 exec-server 服务 |
| `Features` | — | 检查功能开关 |

**无子命令时**：进入交互式 TUI 模式（`TuiCli`）。

### 1.2 配置文件格式

**配置格式**：TOML（非 JSON），位于 `$CODEX_HOME/config.toml`。

**配置加载链**（`core/src/config/mod.rs:1-100`）：
1. `CliConfigOverrides` — 命令行 `-c key=value` 覆盖
2. `ConfigLayerStack` — 多层配置合并
3. `ConfigRequirements` — 项目级需求（`.codex/` 目录）
4. `ConfigToml` — 用户级配置文件
5. `ProjectConfig` — 项目级配置文件

**Profile v2**：支持命名配置 profile，通过 `--profile` 或 `PROFILE_V2_NAME` 选择。

**关键配置域**（`config/schema.rs`）：
- `agent_max_threads` / `agent_max_depth` — 多 Agent 限制
- `features` — 功能开关（Feature Toml）
- `model_providers` — 模型提供者配置
- `mcp_servers` — MCP 服务器列表
- `permission_profile` — 权限 profile
- `sandbox_mode` — 沙箱模式
- `approval_policy` — 审批策略 (AskForApproval: Never/Always)

### 1.3 环境变量

关键环境变量：
- `CODEX_HOME` — Codex 配置和数据目录
- `CODEX_ACCESS_TOKEN` — 登录用 access token
- `OPENAI_API_KEY` — API Key 登录
- `CODEX_CONNECTORS_TOKEN` — Codex Apps MCP 的 bearer token
- `CODEX_BETA_FEATURES` — Beta 功能开关
- `OTEL_*` — OpenTelemetry 导出配置

---

## 2. Agent 执行模型

### 2.1 整体架构

Codex 的 Agent 系统组织在 `codex-rs/core/src/agent/`：

```
AgentControl (control.rs:154)
  |-- AgentRegistry (registry.rs) — 跟踪活跃 Agent
  |-- ThreadManagerState — 全局线程注册表
  \-- 通过 Weak<ThreadManagerState> 反向引用管理端
```

**关键类型**：
- `AgentControl`（`core/src/agent/control.rs:154`）：多 Agent 操作的 control plane handle，持有 `Weak<ThreadManagerState>` 避免循环引用
- `AgentRegistry`（`registry.rs`）：管理 Agent 命名空间、唯一 nicknames、spawn 槽位限制
- `SessionSource`（`protocol/src/protocol.rs`）：标识 session 来源，是 Agent 谱系的关键字段

### 2.2 Session 与 Thread 模型

Codex 区分 **Session** 和 **Thread**：

| 概念 | 标识符 | 范围 |
|------|--------|------|
| Session | `SessionId` (UUID) | 整个 agent tree 共享一个 session id |
| Thread | `ThreadId` (UUID) | 每个 agent 独立 thread id |

**SessionSource 枚举**（关键，决定 Agent 谱系）：
```rust
// protocol/src/protocol.rs
SessionSource::Cli          // 命令行交互
SessionSource::VSCode       // VS Code 集成
SessionSource::Exec         // 非交互式执行
SessionSource::Mcp          // MCP 协程
SessionSource::SubAgent(SubAgentSource::ThreadSpawn {
    parent_thread_id,  // 父 thread id
    depth,             // 深度 (root=0)
    agent_path,        // 树路径，如 /root/child1
    agent_nickname,    // 昵称
    agent_role,        // 角色
})
SessionSource::Internal(InternalSessionSource::MemoryConsolidation)
SessionSource::Custom(String)
```

**Agent 路径树**：`AgentPath` 是 `/` 分隔的层级路径，如 `/root`、`/root/reviewer`、`/root/builder`。`resolve()` 方法支持相对引用（`../sibling`）。

### 2.3 Agent Loop 工作方式

Codex 不像 Claude Code 那样有显式的 agent loop 文件。它的 loop 隐含在 Thread 模型中：

1. **SQ/EQ 模式**（Submission Queue / Event Queue）— `protocol.rs` 定义
   - `Op` 枚举：`UserInput`, `InterAgentCommunication`, `Interrupt`, `Shutdown`
   - 用户通过 SQ 提交 `Op`，EQ 回调事件

2. **Turn 模型**（`client.rs`）：
   - `ModelClient`：session 级别的 API 客户端（持有 auth、provider、thread_id、window_generation）
   - `ModelClientSession`：每 turn 创建一次（持有 WebSocket 连接、turn_state sticky routing token）
   - `Prompt`：单次模型调用 payload（input items、tools、instructions、output_schema）
   - `ResponseEvent`：模型返回的流式事件

3. **Turn 执行流程**：
   ```
   user input -> context assembly (instructions + environment + skills + tools)
   -> Prompt build -> stream() via WebSocket (preferred) or HTTP
   -> ResponseEvent items (reasoning, function_call, message, etc.)
   -> tool orchestration (approval -> sandbox -> execute -> retry)
   -> output assembly -> next turn or complete
   ```

### 2.4 多 Agent 并行机制

Codex 有**两代**多 Agent 系统：

**V1（legacy）**：`tools/handlers/multi_agents/`
- `spawn` — 创建子 agent
- `send_input` — 向子 agent 发送输入
- `wait` — 等待子 agent 完成
- `close_agent` — 关闭子 agent
- 子 agent 完成后，parent 通过 `inject_user_message_without_turn` 接收通知

**V2（MultiAgentV2 feature flag）**：`tools/handlers/multi_agents_v2/`
- `spawn` — 同上但增加 `agent_path` 分配
- `send_message` — 发送消息
- `followup_task` — 追踪任务
- `list_agents` — 列出子 agent
- `close_agent` / `wait` — 同上
- 使用 `InterAgentCommunication` 消息代替注入用户消息
- 支持 root_agent_usage_hint_text 和 subagent_usage_hint_text 自定义指令

**Spawn 限制**：
- `agent_max_threads`：最多同时活跃的 agent 数
- `agent_max_depth`：最大 spawn 深度（默认 root=0）
- `exceeds_thread_spawn_depth_limit` 检查超深 spawn

**Agent 状态**（`agent/status.rs`）：
- `Running`, `WaitingForUserInput`, `Completed`, `Failed`, `Shutdown`, `NotFound` 等
- 通过 `watch::Receiver<AgentStatus>` 订阅状态变化

**Agent 树管理**：
- `spawn_agent_internal`：核心 spawn 逻辑（`control.rs:213`）
  - 预留 spawn slot
  - 继承 parent 的 shell snapshot 和 exec_policy
  - 创建 thread -> 发送 Op -> 注册 completion watcher
  - 支持 fork（从 parent 历史分叉）
- `close_agent`：关闭 agent 及其所有活跃后代
- `shutdown_agent_tree`：递归关闭 agent 树

### 2.5 Fork 与 Resume

**Fork 模式**（`control.rs:48-52`）：
- `FullHistory`：保留 parent 的完整历史作为初始上下文
- `LastNTurns(n)`：仅保留最近 n 个 turn

**Resume**（`control.rs:499-679`）：
- 从持久化的 rollout 文件恢复
- 递归恢复所有后代 agent
- 恢复后重新注册到 in-memory registry

---

## 3. MCP 与工具权限

### 3.1 MCP 支持程度

Codex 对 MCP 的支持**非常完整**，由 `codex-mcp` crate 实现：

**MCP 传输层**（`mcp/mod.rs`）：
- **Stdio**：子进程 stdin/stdout JSON-RPC
- **Streamable HTTP**：HTTP 传输（含 bearer_token_env_var、http_headers、env_http_headers）
- MCP 服务器配置来自 `config.toml` 的 `[mcp_servers.<name>]`
- 内置 `codex_apps` MCP server（`CODEX_APPS_MCP_SERVER_NAME = "codex_apps"`），通过 ChatGPT backend API 连接

**MCP 工具命名空间**：
- 工具名格式：`mcp__<server>__<tool>`（sanitized for Responses API: `^[a-zA-Z0-9_-]+$`）
- 通过 `qualified_mcp_tool_name_prefix(server_name)` 生成前缀

**MCP 生命周期**（`codex-mcp/src/connection_manager.rs`）：
- `McpConnectionManager`：管理所有 MCP 服务器的连接
- 在 session 开始时连接，auth status 检查（OAuth）
- `list_all_tools()` / `list_all_resources()` / `list_all_resource_templates()`
- 工具调用通过 rmcp client 模型序列化

**Codex 作为 MCP Server**（`mcp-server/src/lib.rs`）：
- `codex mcp-server` 子命令
- 通过 stdin/stdout 接收 JSON-RPC 消息
- 暴露 Codex 自身工具（shell 执行、patch apply 等）给外部客户端
- `message_processor.rs` 实现请求路由

### 3.2 内置工具族

**核心工具注册**（`core/src/tools/handlers/`）：

| 工具族 | 处理器文件 | 工具 |
|--------|-----------|------|
| shell | `shell.rs` | `shell_command` — 执行 shell 命令 |
| unified_exec | `unified_exec.rs` | `exec_command` + `write_stdin` — 统一执行框架 |
| apply_patch | `apply_patch.rs` | 应用文件变更 patch |
| multi_agents | `multi_agents.rs` | spawn / send_input / wait / close_agent |
| multi_agents_v2 | `multi_agents_v2.rs` | spawn / send_message / followup_task / list_agents / close_agent / wait |
| agent_jobs | `agent_jobs.rs` | spawn_agents_on_csv / report_agent_job_result |
| mcp | `mcp.rs` | MCP 工具调用代理（将 Responses API function_call 转发到 MCP server） |
| mcp_resource | `mcp_resource.rs` | list_mcp_resources / list_mcp_resource_templates / read_mcp_resource |
| view_image | `view_image.rs` | 查看图片 |
| plan | `plan.rs` | 规划工具 |
| tool_search | `tool_search.rs` | 工具搜索/发现 |
| request_permissions | `request_permissions.rs` | 请求权限提升 |
| request_user_input | `request_user_input.rs` | 请求用户输入 |
| dynamic | `dynamic.rs` | 动态工具（来自插件/扩展） |
| extension_tools | `extension_tools.rs` | 扩展工具 |

**工具元数据**：
- `ToolSpec` 枚举：`Standard`、`Namespace`（MCP 命名空间）、`Dynamic`
- `ToolRouter`：按 `ToolName`（`namespace::name`）路由
- `ToolOrchestrator`：统一的工具执行编排器

### 3.3 沙箱与权限模型

**权限体系**（`protocol/src/permissions.rs`）：

```
PermissionProfile:
  - Disabled       // 禁用沙箱
  - Managed {      // 受控沙箱
      file_system: FileSystemSandboxPolicy,
      network: NetworkSandboxPolicy,
  }
  - External { .. }  // 外部定义
```

**文件系统沙箱**：
- `FileSystemSandboxPolicy`：可配置的读写路径集合
- `SandboxEnforcement`：`Strict` | `Permissive` | `Disabled`
- 每个路径可设 `FileSystemAccessMode`: `ReadOnly` | `ReadWrite`

**网络沙箱**：
- `NetworkSandboxPolicy`：网络访问策略
- `NetworkPolicyRuleAction`：`Allow` | `Deny` | `Ask`

**审批流程**（`tools/orchestrator.rs`）：
```
ToolOrchestrator.run:
  1. 权限检查 → approval (AskForApproval policy)
  2. Hook: run_permission_request_hooks()
  3. 选择沙箱级别 → SandboxAttempt
  4. 执行工具
  5. 失败时升级沙箱策略重试 (escalated sandbox strategy)
  6. Guardian 审查（高风险命令）
```

**Guardian 系统**：
- 对高风险 shell 命令进行安全审查
- 路由到 Guardian approval 或直接显示给用户
- 支持 reviewer role（`ApprovalsReviewer`）

**平台沙箱**：
- macOS：Seatbelt (`cli/src/debug_sandbox/seatbelt.rs`)
- Linux：Landlock + bubblewrap (`linux-sandbox/`)
- Windows：Restricted token + WFP (`windows-sandbox-rs/`)

### 3.4 与 Claude Code 的 MCP 对比

| 维度 | Codex CLI | Claude Code |
|------|-----------|-------------|
| MCP 传输 | stdio + Streamable HTTP | stdio (+ SSE pending) |
| 配置方式 | `config.toml` `[mcp_servers]` | `.mcp.json` 或 `--mcp-config` |
| OAuth 支持 | 是（`McpOAuthLoginConfig`） | 否 |
| 内置 MCP | codex_apps（ChatGPT backend 驱动） | 无内置 MCP |
| 自身作为 MCP server | `codex mcp-server` | 不支持 |
| 工具 namespace | `mcp__<server>__<tool>` | `mcp__<server>__<tool>` |
| 工具发现 | `tool_search` 工具 | 自动列出 |
| resource/resourceTemplate | 完整支持 | 不支持 |
| elicitation | 支持（`ElicitationCapability`） | 不支持 |
| sandbox integration | 深度集成（MCP 工具可在沙箱中运行） | 无 |

---

## 4. 流式事件格式（与 Claude Code 对比）

### 4.1 Codex 的流式架构

Codex 的流式管道是**多层转换**的：

```
OpenAI API (SSE/WebSocket bytes)
  -> ResponsesStreamEvent (codex-api/src/sse/responses.rs)
  -> ResponseEvent (codex-api/src/common/)  // 统一事件类型
  -> map_response_events (core/src/client.rs:1743)
  -> TurnItem (protocol/src/items.rs)  // TUI-oriented item
  -> EventMsg (legacy, protocol/src/protocol.rs)  // legacy event format
  -> StreamController (tui/src/streaming/controller.rs)  // UI rendering
  -> HistoryCell (ratatui widget)
```

### 4.2 ResponseEvent 类型

`ResponseEvent`（`codex-api` crate，由 `client_common.rs` 重新导出）：

关键事件包括：
- `OutputItemAdded(item)` — 模型产生新输出项
- `OutputItemDone(item)` — 输出项完成
- `OutputTextDelta(item_id, delta)` — 文本增量
- `ReasoningTextDelta(item_id, delta)` — 推理过程增量
- `Completed { response_id, token_usage, end_turn }` — 请求完成的终端事件
- `ServerModel(model)` — 实际使用的模型名
- `RateLimits(snapshot)` — 速率限制信息
- `ModelsEtag(etag)` — 模型列表 etag

### 4.3 TurnItem 类型（面向 TUI）

`TurnItem`（`protocol/src/items.rs:38-54`）：

| 变体 | 说明 |
|------|------|
| `UserMessage` | 用户输入（文本、图片、skills、mentions） |
| `HookPrompt` | hook 触发的提示词片段 |
| `AgentMessage` | agent 输出的 markdown 文本（带 phase: Stream/End） |
| `Plan` | 计划文本 |
| `Reasoning` | 推理过程（summary + raw content） |
| `WebSearch` | 网络搜索结果 |
| `ImageView` | 查看图片 |
| `ImageGeneration` | 图片生成结果 |
| `FileChange` | 文件变更（patch apply 结果） |
| `McpToolCall` | MCP 工具调用（含 InProgress/Completed/Failed 状态） |
| `ContextCompaction` | 上下文压缩通知 |

### 4.4 TUI 流式渲染

**StreamController**（`tui/src/streaming/controller.rs`）：
- 两区域模型：**stable region**（已提交到 scrollback）+ **tail region**（可变，显示在 active-cell 插槽）
- 新行到达时排队，commit tick 按策略释放到 stable
- **表格 holdback**：检测 pipe-table 模式（header + delimiter），保持整个表格区为 tail 直到不再变化
- Unicode 表格渲染（`┌───┬───┐` 等 box-drawing 字符）

### 4.5 与 Claude Code stream-json 的对比

| 维度 | Codex CLI | Claude Code |
|------|-----------|-------------|
| 流式协议 | 内部 `ResponseEvent` 枚举（非公开） | `stream-json`（每行一条 JSON） |
| 事件类型 | 模型驱动（OutputItemDone, Completed） | 语义驱动（assistant, content_block_delta, tool_use） |
| 工具调用 | `ResponseItem::FunctionCall` → dispatch | `content_block_start/stop` → tool_use |
| 上下文压缩 | `ResponseItem::Compaction` | `system` message (compaction notification) |
| 外部可消费性 | 否（TUI 内部专用） | 是（stream-json 是公开协议） |
| MCP 工具事件 | `McpToolCallItem` (InProgress/Completed/Failed) | 标准 tool_use/tool_result |
| UI 渲染 | 内置 TUI (ratatui + markdown + streaming) | 外部 consumer 自行渲染 |
| 流式文本 | `OutputTextDelta`（增量） | `content_block_delta` → `text_delta` |

**关键差异总结**：
1. Codex 的流式事件是**内部实现细节**，不对外暴露协议；Claude Code 的 `stream-json` 是公开的 machine-readable protocol
2. Codex 是"fat client"（TUI 内嵌），Claude Code 是"thin client + protocol"（consumer 自行决定 UI）
3. Codex 没有类似 CC 的 `system` / `user` / `assistant` / `result` 顶层消息分类
4. Codex 的 TurnItem 体系更关注 UI 渲染（文件变更、MCP 调用状态、图片生成）

---

## 5. 对 AgentHub CodexAdapter 的具体实现建议

### 5.1 Adapter 定位

AgentHub 的 CodexAdapter 需要将 Codex CLI 的**内部事件流**适配到 AgentHub 的统一消息协议。由于 Codex 没有公开的 machine-readable stream 协议，Adapter 需要：

**方案 A：Exec 模式 + JSON 解析**
- 调用 `codex exec --json`（如果有）或解析 stdout
- 缺点：Codex 目前没有 `--json` 输出模式，exec 只返回最终文本

**方案 B：从 state/rollout 文件读取**
- Codex 将所有 session 持久化到 `$CODEX_HOME/state/` 下的 rollout 文件
- `codex-rs/rollout-trace/src/` 提供了 replay 和 reduce 工具
- 可以通过 `RolloutItem` 反序列化完整对话历史
- 优点：数据完整，包含所有 TurnItem 事件

**方案 C：MCP Server 模式**
- Codex 支持 `codex mcp-server` 模式，通过 stdio JSON-RPC 暴露自身工具
- AgentHub 可以作为 MCP client 连接 Codex
- 但此模式主要是让外部调用 Codex 的工具，不是 agent loop

**推荐**：**方案 B（state/rollout 读取）+ 方案 A 变体（exec 模式触发）**

### 5.2 核心适配点

#### 5.2.1 消息映射

将 Codex 的 `TurnItem` / `RolloutItem` 映射到 AgentHub 统一消息：

| Codex TurnItem | AgentHub Message |
|----------------|-----------------|
| `UserMessage` | `user` role message |
| `AgentMessage` (phase=Stream) | `assistant` streaming content |
| `AgentMessage` (phase=FinalAnswer) | `assistant` final message |
| `Reasoning` | `thinking` content |
| `WebSearch` | `tool_call` + `tool_result` (web_search) |
| `McpToolCall` | `tool_call` (mcp__...) + `tool_result` |
| `FileChange` | `tool_call` (apply_patch) + `tool_result` |
| `ImageGeneration` | `tool_call` + image output |
| `ContextCompaction` | `system` compaction notification |
| `Plan` | `tool_call` (plan) + content |

#### 5.2.2 MCP 工具命名适配

Codex 和 Claude Code 使用相同的 MCP 工具命名约定：
```
mcp__<server_name>__<tool_name>
```
这是**可直接互通的**。AgentHub 的 MCP 管理逻辑可复用。

#### 5.2.3 Config 配置适配

Codex 使用 TOML 配置（`config.toml`），AgentHub 可以：
- 为 Codex backend 自动生成 `config.toml`
- 关键字段映射：`model_providers` → AgentHub 的 provider 配置，`mcp_servers` → AgentHub 的 MCP registry

#### 5.2.4 多 Agent 抽象

Codex 的多 Agent 树（spawn/wait/close）是独有的，Claude Code 没有等价物。AgentHub 可以：
- 将 Codex 的 agent tree 映射为 AgentHub 的 "sub-conversation" 或 "task 委托" 概念
- `spawn_agent` 工具调用 → AgentHub 创建 subtask
- `wait_agent` → 等待 subtask 完成
- 子 agent 的执行结果 → subtask 返回值

#### 5.2.5 Auth 适配

Codex 支持多种认证模式：
- `ApiKey` — `OPENAI_API_KEY`
- `Chatgpt` — ChatGPT 登录（含 refresh token 恢复）
- `AccessToken` — `CODEX_ACCESS_TOKEN`
- `AgentIdentity` — Agent 身份证明

AgentHub 可以为 Codex 管理这些凭据，类似 MetAPI 的 credential 管理。

### 5.3 具体实现路线图

1. **Phase 1：非交互模式（exec）**
   - `codex exec <prompt>` 获取最终输出
   - 从 state DB 读取完整对话历史用于展示
   - 映射到 AgentHub message list

2. **Phase 2：Rollout Trace 消费**
   - 解析 `RolloutItem` / `TurnItem` 序列 → AgentHub event stream
   - 实现模拟的 streaming（将 TurnItem 按序转换）

3. **Phase 3：MCP 管理集成**
   - 在 AgentHub 中配置 Codex 的 MCP servers
   - 双向同步 MCP 工具列表

4. **Phase 4：多 Agent 集成**
   - 将 Codex 的 spawn/wait 操作映射到 AgentHub 的 subtask 模型
   - 实现 agent tree 的可视化

### 5.4 关键文件索引（实现参考）

| 用途 | 文件路径 |
|------|---------|
| CLI 入口 | `codex-rs/cli/src/main.rs` |
| Exec 子命令 | `codex-rs/exec/src/` |
| Session/Thread 模型 | `codex-rs/core/src/session/` |
| Agent 控制 | `codex-rs/core/src/agent/control.rs` |
| 协议定义 | `codex-rs/protocol/src/protocol.rs` |
| TurnItem 定义 | `codex-rs/protocol/src/items.rs` |
| Rollout trace | `codex-rs/rollout-trace/src/` |
| MCP 体系 | `codex-rs/codex-mcp/src/` |
| MCP Server 模式 | `codex-rs/mcp-server/src/lib.rs` |
| 工具注册 | `codex-rs/core/src/tools/handlers/` |
| 配置 schema | `codex-rs/core/src/config/schema.rs` |
| State DB | `codex-rs/state/src/` |
| Thread store | `codex-rs/thread-store/src/` |
| 流式事件 | `codex-rs/codex-api/src/sse/responses.rs` |
| TUI 流式控制器 | `codex-rs/tui/src/streaming/controller.rs` |
| Model client | `codex-rs/core/src/client.rs` |
