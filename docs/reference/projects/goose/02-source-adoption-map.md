# Goose Source Adoption Map: Agent Runtime -> AgentHub AgentAdapter

> 调研日期：2026-05-24
> 比对范围：Goose `reference/goose/crates/goose/src/` vs AgentHub `edge-server/internal/adapters/`
> 优先级：P0 = 阻塞性差距/立即采纳，P1 = 季度级规划，P2 = 长期优化

---

## 1. Provider Architecture: Goose ProviderDef/Provider -> AgentHub AgentAdapter

### 1.1 Double-Layer Abstraction

| # | Goose source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 1 | `reference/goose/crates/goose/src/providers/base.rs:802-866` — `ProviderDef` trait (工厂层): metadata(), from_env(), supports_inventory_refresh() | `edge-server/internal/adapters/adapter.go:23-43` — `AgentAdapter` interface: Metadata(), Capabilities(), BuildCommand(), ParseStream(), NeedsStdin() | AgentHub 的 `AgentAdapter` 已综合了 Goose 的 ProviderDef + Provider 两层。差异：Goose 分离了工厂（编译期）和实例（运行期），AgentHub 是单接口模式 | **P1** — 如需支持热加载 adapter，可分离为 `AgentAdapterFactory` + `AgentAdapter` |
| 2 | `reference/goose/crates/goose/src/providers/base.rs:866-1208` — `Provider` trait (实例层): get_name(), stream(), complete(), complete_fast(), get_model_config(), retry_config(), 15+ 方法 | `edge-server/internal/adapters/adapter.go:23-43` — `AgentAdapter` 无 retry_config、stream vs complete 区分 | `AgentAdapter` 缺少重试配置和 fast-mode fallback | **P1** — 新增 `RetryConfig()` 和 `Complete()` 方法到 `AgentAdapter` |
| 3 | `reference/goose/crates/goose/src/providers/provider_registry.rs:106-310` — `ProviderRegistry`: entries HashMap<name, ProviderEntry>, register(), constructor patterns, ProviderType 分类 | `edge-server/internal/adapters/registry.go:9-91` — `Registry`: adapters map, defaults map, Register/Get/List/SetDefault/Default/Resolve | AgentHub 已实现等效注册表。差异：Goose 有 ProviderType(Preferred/Builtin/Declarative/Custom) 分类 | **P2** — 新增 `AdapterSource` 字段区分 adapter 来源 |
| 4 | `reference/goose/crates/goose/src/providers/provider_registry.rs:56-73` — `register()` 泛型工厂: constructor 闭包将 ModelConfig -> Arc<dyn Provider> | `edge-server/internal/adapters/registry.go:24-36` — `Register()` 直接接收已构造的 `AgentAdapter` 实例 | Goose 的工厂模式支持延迟构造（按需初始化），AgentHub 是预构造 | **P2** — 如需大型 adapter 延迟加载，可引入 factory 模式 |

### 1.2 Model Configuration & Resolution

| # | Goose source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 5 | `reference/goose/crates/goose/src/providers/canonical/` — Canonical Model Registry: JSON 编译进二进制，context_limit, capabilities, pricing, release_date | `edge-server/internal/adapters/model_config.go` — 已有模型解析，但无 bundled registry | 新增 `embed/model_registry.json` (Go embed) 作为 canonical model registry | **P1** |
| 6 | `reference/goose/crates/goose/src/providers/declarative/*.json` — 声明式 Provider: 通过 JSON 声明新 LLM provider，无需编译 Rust 代码 | AgentHub 无声明式 provider 支持 | 支持通过 JSON/YAML 配置新 adapter（兼容 OpenAI API 格式的） | **P2** |
| 7 | `reference/goose/crates/goose/src/config/base.rs:81-99` — 配置优先级: env > ~/.config/goose/config.yaml > /etc/goose/config.yaml > 额外文件 | AgentHub 无统一配置优先级 | 建立 `环境变量 > 配置文件 > 代码默认值` 的优先级链 | **P2** |

---

## 2. Stream Architecture: Goose MessageStream -> AgentHub ParseStream

### 2.1 Stream Types

| # | Goose source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 8 | `reference/goose/crates/goose/src/providers/base.rs:1213-1215` — `MessageStream = Pin<Box<dyn Stream<Item = Result<(Option<Message>, Option<ProviderUsage>), ProviderError>>>>` | `edge-server/internal/adapters/adapter.go:36` — `ParseStream(ctx, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error` | AgentHub 使用 io.Reader 而非 channel/stream — 更简单但缺少反压控制 | **P2** — 可考虑在 `ParseStream` 使用 channel 实现反压 |
| 9 | `reference/goose/crates/goose/src/providers/base.rs:1223-1272` — `collect_stream()`: 合并连续 Text 块、收集最终 usage | `edge-server/internal/adapters/parser_ndjson.go` — NDJSON 解析器逐行 emit，无合并逻辑 | NDJSON 解析器的 Text 块合并由前端负责，当前设计合理 | 无需变更 |
| 10 | `reference/goose/crates/goose/src/providers/base.rs:40-149` — `ThinkFilter`: 零拷贝流式 `<think>...</think>` 分离，支持大小写不敏感、跨 chunk 标签解析、嵌套深度追踪 | AgentHub 无 think 标签分离（依赖各 adapter 原生输出事件类型） | `OpenCodeAdapter` 和 `CodexAdapter` 已有 `reasoning` 事件类型。`ClaudeCodeAdapter` 依赖 NDJSON 中的 thinking 事件 | **P2** — 如需通用 think 分离，可在 NDJSON 解析器中实现 ThinkFilter |

### 2.2 Event Type Mapping

| # | Goose source | AgentHub event type | Coverage | Priority |
|---|---|---|---|---|
| 11 | `reference/goose/crates/goose/src/conversation/message.rs:260-274` — `MessageContent::Thinking` + `RedactedThinking` | `BusEventThinking` (`adapters/adapter.go:77`) | 已覆盖 | 无需变更 |
| 12 | `reference/goose/crates/goose/src/conversation/message.rs:260-274` — `MessageContent::ToolRequest` + `ToolResponse` | `BusEventToolCall` + `BusEventToolResult` (`adapter.go:78-79`) | 已覆盖 | 无需变更 |
| 13 | `reference/goose/crates/goose/src/conversation/message.rs:260-274` — `MessageContent::ActionRequired` | `BusEventPermissionRequested` (`adapter.go:98`) | 已覆盖 | 无需变更 |
| 14 | `reference/goose/crates/goose/src/conversation/message.rs:260-274` — `MessageContent::FrontendToolRequest` | AgentHub 无对应事件 | 新增 `BusEventFrontendToolRequest` 事件类型 | **P2** |
| 15 | `reference/goose/crates/goose/src/conversation/message.rs:260-274` — `MessageContent::SystemNotification` | AgentHub 无对应事件 | 新增 `BusEventSystemNotification` 事件类型 | **P2** |

---

## 3. Tool Inspection Pipeline: Goose ToolInspector -> AgentHub HookChain

### 3.1 Inspector Chain Architecture

| # | Goose source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 16 | `reference/goose/crates/goose/src/tool_inspection.rs:34-57` — `ToolInspector` trait: name(), inspect(), is_enabled(), as_any() | `edge-server/internal/adapters/hooks.go:39-57` — `AgentHook` interface: PreToolUse, PostToolUse, PermissionRequest, OnError, PrePrompt, PostResponse | AgentHub 的 HookChain 已实现责任链模式。Goose 的 inspector 更聚焦于安全检查，AgentHub 的 hook 更通用 | **P1** — 在 HookChain 中新增 `IsEnabled()` 方法支持动态禁用 |
| 17 | `reference/goose/crates/goose/src/tool_inspection.rs:61-100` — `ToolInspectionManager`: inspectors Vec<Box<dyn ToolInspector>>, add_inspector(), inspect_tools() 按序执行 | `edge-server/internal/adapters/hooks.go:60-122` — `HookChain []AgentHook` + Run* 系列方法 | AgentHub 已实现等效链式调用。差异：Goose 收集所有 inspector 结果后合并，AgentHub 在第一个 block 处停止 | **P1** — 可考虑收集所有 hook 的结果再合并决策（参考 Goose 的 `apply_inspection_results_to_permissions`） |
| 18 | `reference/goose/crates/goose/src/tool_inspection.rs:170-250` — `apply_inspection_results_to_permissions()`: Deny > RequireApproval > Allow 优先级 | `edge-server/internal/adapters/hooks.go:63-73` — `RunPreToolUse`: 第一个 block 即停止 | Goose 的优先级语义更丰富（先收集全部结果再判优），AgentHub 是短路模式 | **P1** — 实现 `MergePermissionDecisions()` 收集所有 hook 决策后按优先级合并 |

### 3.2 Security Inspection

| # | Goose source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 19 | `reference/goose/crates/goose/src/security/mod.rs:53-241` — `SecurityInspector`: pattern-based prompt injection 检测 + ML-enhanced classifier (SECURITY_PROMPT_CLASSIFIER_ENABLED) | `edge-server/internal/adapters/security_hooks.go:17-227` — `SecurityHook`: pattern-based 危险命令检测 (dangerousPatternsRE), 无 ML 分类器 | AgentHub 的 SecurityHook 更聚焦于命令注入；Goose 有 prompt injection 检测和 ML 选项 | **P1** — 新增 `PromptInjectionHook` 检查用户 prompt 中的注入攻击 |
| 20 | `reference/goose/crates/goose/src/security/adversary_inspector.rs` — `AdversaryInspector`: 对抗性输入检测 | AgentHub 无对应 | 新增 `AdversaryHook` 作为可选安全模块 | **P2** |
| 21 | `reference/goose/crates/goose/src/security/egress_inspector.rs` — `EgressInspector`: 数据外泄检查 | AgentHub 无对应 | 新增 `EgressHook` 检查敏感信息在工具输出中泄露 | **P2** |
| 22 | `reference/goose/crates/goose/src/tool_monitor.rs` — `RepetitionInspector`: 循环/重复调用检测 | AgentHub 无对应 | 新增 `RepetitionHook` 检测工具调用循环 | **P2** |
| 23 | `reference/goose/crates/goose/src/agents/extension_malware_check.rs` — 扩展恶意软件检查 | AgentHub 无对应 | 插件/扩展安全扫描（适用 MCP server 注册时） | **P2** |

---

## 4. Extension/MCP Management: Goose ExtensionManager -> AgentHub MCP

### 4.1 Unified Transport Layer

| # | Goose source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 24 | `reference/goose/crates/goose/src/agents/extension_manager.rs:827-1032` — 6 种传输类型: Stdio, StreamableHttp, Builtin (tokio duplex channel), Platform (进程内 factory), InlinePython (uvx), Frontend (UI 注册) | AgentHub 无 MCP 传输抽象层 | 新增 `internal/mcp/transport.go` 定义统一 MCP 传输接口（Stdio + HTTP + Builtin） | **P1** |
| 25 | `reference/goose/crates/goose/src/agents/extension_manager.rs:139-147` — `ExtensionManager`: extensions Mutex<HashMap>, provider SharedProvider, tools_cache Mutex<Option<Arc<Vec<Tool>>>>, tools_cache_version AtomicU64 | AgentHub 无 MCP 管理组件 | 新增 `internal/mcp/manager.go` 实现 `MCPManager`，管理连接生命周期和工具缓存 | **P1** |
| 26 | `reference/goose/crates/goose/src/agents/extension_manager.rs:1277-1302` — 工具前缀: `extension__tool` vs 一等扩展无前缀 | `edge-server/internal/adapters/opencode.go:172` — MCP 工具命名 `mcp__server__tool` | AgentHub 已有 MCP 前缀规范，与 Claude Code / Codex 对齐 | 无需变更 |
| 27 | `reference/goose/crates/goose/src/agents/extension_manager.rs:1056-1099` — `fetch_all_tools()`: 并行调用所有 client.list_tools()，归并结果并注入 `goose_extension` 元数据 | AgentHub 无批量工具获取 | 在 `MCPManager` 中实现 `FetchAllTools()` 并行获取并归并 | **P1** |
| 28 | `reference/goose/crates/goose/src/agents/extension_manager.rs:256-271` — 工具缓存策略: tools_cache_version AtomicU64 + tools_cache Option<Arc<Vec<Tool>>>, 乐观并发控制 | AgentHub 无工具缓存 | 使用 `sync.Mutex` + version counter 实现工具缓存（Go 无 AtomicU64 等效方案用 atomic.Uint64） | **P1** |

### 4.2 Tool Execution

| # | Goose source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 29 | `reference/goose/crates/goose/src/agents/tool_execution.rs:16-24` — `ToolCallContext`: session_id, working_dir, tool_call_request_id | `edge-server/internal/lifecycle/process_executor.go:157-172` — `RunProcessContext` 通过 `adapter.BuildCommand()` 传递 | AgentHub 的 tool execution 由 CLI 子进程执行，不直接在 Go 侧执行工具 | 架构差异：AgentHub 是 CLI 包装器，Goose 是原生执行 — 无需对齐 |
| 30 | `reference/goose/crates/goose/src/agents/tool_execution.rs:63-74` — `DECLINED_RESPONSE` + `CHAT_MODE_TOOL_SKIPPED_RESPONSE`: 标准化的拒绝/跳过响应模板 | AgentHub 无标准化响应模板（由各 CLI 自行控制） | 在 `SecurityHook.PermissionRequest` 中返回标准化拒绝消息 | **P2** |

---

## 5. Hooks System: Goose Hooks -> AgentHub HookChain

### 5.1 Hook Events & Lifecycle

| # | Goose source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 31 | `reference/goose/crates/goose/src/hooks/mod.rs:48-63` — 13 个 HookEvent: PreToolUse, PostToolUse, PostToolUseFailure, SessionStart, SessionEnd, UserPromptSubmit, BeforeReadFile, AfterFileEdit, BeforeShellExecution, AfterShellExecution, Stop, SubagentStart, SubagentStop | `edge-server/internal/adapters/hooks.go:39-57` — 6 个 AgentHook 方法: PreToolUse, PostToolUse, PermissionRequest, OnError, PrePrompt, PostResponse | AgentHub 的 6 核心 hooks 覆盖了 Goose 13 事件中的 8 个。缺失: SessionStart/End, BeforeReadFile, AfterFileEdit, BeforeShellExecution, Stop | **P1** — 新增 `SessionStart/End`, `BeforeToolExec`, `AfterToolExec` 到 `AgentHook` |
| 32 | `reference/goose/crates/goose/src/hooks/mod.rs:514-526` — `emit()` (fire-and-forget, non-blocking) | `edge-server/internal/adapters/hooks.go:76-82` — `RunPostToolUse`: 链式修改输出但不阻塞 | AgentHub 的 PostToolUse/PostResponse 是非阻塞的 | 已覆盖 |
| 33 | `reference/goose/crates/goose/src/hooks/mod.rs:528-536` — `emit_blocking()`: 支持 deny 决策 (exit code 2=Deny) | `edge-server/internal/adapters/hooks.go:63-73` — `RunPreToolUse`: 第一个 block 即停止 | AgentHub 的 PreToolUse 是阻塞的 | 已覆盖 |
| 34 | `reference/goose/crates/goose/src/hooks/mod.rs:543-555` — 配置格式: Open Plugins 规范, matcher 正则过滤工具名, command shell 命令, ${PLUGIN_ROOT} 展开, timeout 默认 30s | AgentHub 无外部 hook 配置格式 | 实现 Open Plugins 兼容的 hook 配置格式（JSON），支持 shell command 类型的 action | **P2** |
| 35 | `reference/goose/crates/goose/src/hooks/mod.rs:556-565` — exit code 语义: 0=成功, 2=拒绝, 其他=错误不阻塞 | AgentHub 无外部命令 hook 支持 | 在实现外部 hook 时采用相同 exit code 语义 | **P2** |

---

## 6. Visibility & Thinking Content: Goose MessageContent -> AgentHub Events

### 6.1 Per-Role Message Filtering

| # | Goose source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 36 | `reference/goose/crates/goose/src/conversation/message.rs:260-274` — `MessageContent` 枚举: Text, Image, ToolRequest, ToolResponse, ToolConfirmationRequest, ActionRequired, FrontendToolRequest, Thinking, RedactedThinking, SystemNotification | `edge-server/internal/adapters/adapter.go:73-102` — 20 个 BusEvent 类型 | AgentHub 的事件类型基本覆盖 Goose 的 MessageContent 变体。缺失: RedactedThinking, SystemNotification | **P2** — 新增 `BusEventRedactedThinking` + `BusEventSystemNotification` |
| 37 | `reference/goose/crates/goose/src/providers/base.rs:1097-1113` — `get_preprompt_context()`: 过滤出仅对 assistant 可见的内容块 | AgentHub 无 per-role 可见性标记 | 在事件 payload 中新增 `audience: [User, Assistant, System]` 字段 | **P2** |
| 38 | `reference/goose/crates/goose/src/providers/base.rs:453-475` — `ThinkingContent` vs `RedactedThinkingContent`: 推理过程分离 + 脱敏版本 | AgentHub 的 `BusEventThinking` 无脱敏变体 | 新增脱敏 thinking 事件类型 | **P2** |

---

## 7. Conversation Management: Goose Session/Conversation -> AgentHub Store/Thread

### 7.1 Session Model

| # | Goose source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 39 | `reference/goose/crates/goose/src/session/session_manager.rs` — `SessionManager`: SQLite 持久化 + LRU 内存缓存 + SessionUpdateBuilder 批量更新 API | `edge-server/internal/store/store.go` + `file_store.go` — 简单内存/file store | AgentHub 的 store 更轻量。如需持久化，可参考 Goose 的 SQLite + LRU cache 模式 | **P1** — 升级 store 支持 SQLite 持久化 |
| 40 | `reference/goose/crates/goose/src/session/session_manager.rs` — `Session`: id, session_type (Chat/Task/Subagent), model_config, total_tokens, created_at, updated_at | AgentHub 的 `store.Run` 有 status/timestamps 但无 session_type 区分 | 在 `store.Run` 中新增 `SessionType` 字段 | **P2** |
| 41 | `reference/goose/crates/goose/src/context_mgmt/mod.rs` — `check_if_compaction_needed()`, `compact_messages()`, `DEFAULT_COMPACTION_THRESHOLD` | `edge-server/internal/runnerctx/context_budget.go` — 上下文预算跟踪 | AgentHub 的 context budget 仅跟踪 token 消耗，无自动压缩 | **P1** — 实现 context compaction 策略：达到阈值时触发消息摘要 |
| 42 | `reference/goose/crates/goose/src/agents/agent.rs:36` — `fix_conversation()` + `debug_conversation_fix()`: 对话修复函数 | AgentHub 无对话修复 | 在 adapter 层面由各 CLI 自行处理，无需 AgentHub 介入 | 无需变更 |

### 7.2 Subagent / Task Delegation

| # | Goose source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 43 | `reference/goose/crates/goose/src/agents/subagent_execution_tool/mod.rs` — 子 agent 执行工具: 创建隔离 session、传递 prompt、收集结果 | `edge-server/internal/adapters/codex.go:535-557` — `emitTaskStarted`: collab_tool_call → BusEventTaskStarted | AgentHub 已通过事件系统支持子 agent 通知，但无子 agent lifecycle 管理 | **P1** — 在 `ProcessExecutor` 中支持嵌套 Run（parent run spawns child runs） |
| 44 | `reference/goose/crates/goose/src/agents/subagent_execution_tool/notification_events.rs` — 子 agent 通知事件 | `edge-server/internal/adapters/adapter.go:85-88` — `BusEventTaskStarted/Dispatched/Progress/Notification` | AgentHub 已有 task 事件类型，需在 adapter 中正确映射子 agent 通知 | **P1** |
| 45 | `reference/goose/crates/goose/src/agents/subagent_handler.rs` — `SubagentHandler`: 管理子 agent 会话、消息路由、结果合并 | AgentHub 无对应组件 | 新增 `internal/agents/subagent.go` 实现子 agent 会话管理 | **P1** |

---

## 8. Permission System: Goose PermissionManager -> AgentHub SecurityHook + ControlProtocol

### 8.1 Permission Decisions

| # | Goose source | AgentHub target | Change | Priority |
|---|---|---|---|---|
| 46 | `reference/goose/crates/goose/src/permission/permission_inspector.rs` — `PermissionInspector`: 权限规则匹配 (allow/deny/ask) | `edge-server/internal/adapters/control_protocol.go:74-144` — `DefaultPermissionHandler`: auto-approve 所有工具 | AgentHub 需要实现真正的权限判断逻辑（替换默认全通过） | **P0** — 实现 `PermissionInspector` 基于规则的权限判断 |
| 47 | `reference/goose/crates/goose/src/permission/permission_judge.rs` — `PermissionCheckResult`: approved, denied, needs_approval 三个列表 | `edge-server/internal/adapters/control_protocol.go:64-68` — `PermissionDecision`: Behavior("allow"/"deny") + Message | AgentHub 的 PermissionDecision 是二元的；需扩展为三态 | **P1** — `PermissionDecision` 新增 `NeedsApproval` 状态 |
| 48 | `reference/goose/crates/goose/src/agents/tool_confirmation_router.rs` — `ToolConfirmationRouter`: 路由工具确认请求到 UI | `edge-server/internal/adapters/control_protocol.go:96-105` — `handleCanUseTool`: emit `permission_requested` 事件到 EventEmitter | AgentHub 的事件通知模式已支持 UI 审批路由 | 已覆盖 |
| 49 | `reference/goose/crates/goose/src/config/permission.rs` — `PermissionManager` + `PermissionLevel`: 持久化权限规则 | AgentHub 无持久化权限规则 | 新增 `internal/permission/store.go` 持久化用户权限规则 | **P1** |

---

## 9. Complete Feature Matrix

| Feature | Goose | AgentHub Current | Gap | Priority |
|---------|-------|-----------------|-----|----------|
| ProviderDef/Provider 双层抽象 | Yes | 单层 AgentAdapter | 无热加载 | **P1** |
| Canonical Model Registry | Yes (bundled JSON) | No | 模型发现和定价 | **P1** |
| Declarative Provider | Yes (JSON config) | No | 用户快速接入新 LLM | **P2** |
| ThinkFilter (stream thinking sep) | Yes (零拷贝) | Partial (事件级) | 通用 think 分离 | **P2** |
| Tool Inspection Pipeline | 5 inspectors 责任链 | SecurityHook + HookChain | 链式合并 vs 短路 | **P1** |
| ExtensionManager / MCP | 6 transport types | 无 MCP 管理层 | MCP 连接生命周期 | **P1** |
| Tool Cache (versioned) | Yes (AtomicU64) | No | 工具获取性能 | **P1** |
| Hooks (13 events) | Yes (Open Plugins spec) | 6 core hooks | 外部 hook 命令 | **P2** |
| Session Persistence (SQLite) | Yes + LRU cache | Memory/File store | 持久化 | **P1** |
| Context Compaction | Yes (threshold-based) | Budget tracking only | 自动压缩 | **P1** |
| Subagent Lifecycle | Yes (full management) | Partial (events only) | 子 agent 管理 | **P1** |
| Permission Persistence | Yes (PermissionManager) | No | 用户规则持久化 | **P1** |
| Per-Role Visibility | Yes (audience filtering) | No | 消息可见性控制 | **P2** |
| Redacted Thinking | Yes | No | 脱敏 reasoning | **P2** |
| Fast Model Fallback | Yes (complete_fast) | No | 降级模型支持 | **P2** |
| Retry Config | Yes (RetryConfig) | No | 自动重试 | **P2** |

---

## 10. Key Architectual Differences & Design Decisions

### 10.1 CLI Wrapper vs Native Agent Runtime

AgentHub is a **CLI wrapper** (ProcessExecutor spawns claude/codex/opencode as subprocesses and parses their output), while Goose is a **native agent runtime** (executes LLM calls, tools, and MCP extensions directly in-process). This fundamental difference means:

- **Goose's Provider traits (stream/complete)** map to AgentHub's **CLI invocation patterns** (BuildCommand + ParseStream)
- **Goose's in-process tool execution** maps to AgentHub's **subprocess tool delegation** (tools run inside the CLI subprocess)
- **Goose's extension manager** is akin to AgentHub's potential **MCP server manager** (managing external MCP servers rather than in-process extensions)

### 10.2 Where Goose Patterns Apply Directly

Despite the architectural difference, these Goose patterns map directly to AgentHub:

| Goose Pattern | AgentHub Application |
|--------------|---------------------|
| `ToolInspector` chain | `HookChain` pre/post tool use hooks |
| `ExtensionManager` transport abstraction | MCP server connection management |
| `Canonical Model Registry` | Model pricing + capability lookup |
| `Hooks` (Open Plugins spec) | External hook config format |
| `PermissionManager` approval rules | User-specified permission rules |
| `Tool Cache` with versioning | MCP tool list caching |
| `Context Compaction` | Auto-summarization before context overflow |
| `SessionType` (Chat/Task/Subagent) | Run classification |
