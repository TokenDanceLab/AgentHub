# Claude Code SDK 深度调研报告

> 源码：`D:\Code\Projects\study\ClaudeCode\claude-code-lite\src\`（TypeScript 源码，~1200 个 .ts 文件）
> 主包：`claude-code-lite`，WSL 部署产物：`claude-code-wsl-deploy`
> 已有分析：`ClaudeCodeAnalysis/`（101 份分模块文档）
> 生成时间：2026-05-21

## 1. Agent SDK 架构

### 1.1 架构全景

```
entrypoints/cli.tsx (bootstrap -> main.tsx -> main loop)
  +-- 交互模式 (REPL)：screens/REPL.tsx (Ink/React TUI)
  +-- 非交互模式 (-p)：cli/print.ts -> QueryEngine.ask()
         +-- stdin -> StructuredIO -> SDKMessage 流
         +-- QueryEngine -> async generator -> SDKMessages -> stdout NDJSON

核心调用链：
  print.ts:runHeadlessStreaming()
    -> QueryEngine:ask()          (QueryEngine.ts:1186-1295)
      -> engine.submitMessage()   (QueryEngine.ts:209-1156)
        -> query()                (query.ts:219-1729)  -- API 循环
          -> deps.callModel()     -- 调用 Anthropic Messages API
          -> runTools()           -- tools/toolOrchestration.ts
```

### 1.2 SDK 公开 API 类型

**入口文件**: `src/entrypoints/agentSdkTypes.ts`（446 行）

导出策略：核心类型（coreTypes）+ 运行态类型（runtimeTypes）+ 控制协议类型（controlTypes，向 SDK builder 单独开放）。所有 `throw new Error('not implemented')` 仅在外部 SDK 包中有实际实现。

**核心函数**（行号来自 `agentSdkTypes.ts`）：

| 函数 | 行号 | 说明 |
|------|------|------|
| `query()` | 112-122 | 单次查询，返回 `Query` 异步迭代器 |
| `unstable_v2_createSession()` | 129-133 | 创建持久 session |
| `unstable_v2_resumeSession()` | 140-145 | 恢复已有 session |
| `unstable_v2_prompt()` | 160-165 | 一次性便捷 prompt |
| `getSessionMessages()` | 178-183 | 读取 session JSONL 对话记录 |
| `listSessions()` | 204-208 | 列出 sessions（支持 pagination） |
| `getSessionInfo()` | 219-224 | 单 session 元信息 |
| `forkSession()` | 268-273 | Fork session 到新分支 |
| `createSdkMcpServer()` | 103-107 | 注册 SDK 侧 MCP server（同进程工具） |
| `tool()` | 73-86 | 声明 SDK 自定义工具（Zod schema） |
| `connectRemoteControl()` | 439-443 | Daemon 侧 claude.ai bridge |
| `watchScheduledTasks()` | 350-356 | Cron 任务调度（daemon 模式） |

### 1.3 QueryEngine — Agent 生命周期核心

**文件**: `src/QueryEngine.ts`（1295 行）

- `class QueryEngine` (`:184`) — 单 conversation 生命周期控制器。持有 `mutableMessages`、`readFileState`、`totalUsage`、`permissionDenials` 等跨 turn 状态。
- `constructor(config: QueryEngineConfig)` (`:200-207`) — 注入 **tools**、**commands**、**mcpClients**、**canUseTool**、**getAppState / setAppState** 等依赖。
- `async *submitMessage(prompt, options)` (`:209-1156`) — **核心 async generator**，单次用户输入处理全流程：
  1. 组装 system prompt（`fetchSystemPromptParts`，`:292`）
  2. 处理 slash commands + orphaned permissions（`:410-408`）
  3. 写入 transcript（`recordTranscript`，`:451`）
  4. 发射 `system_init` 消息（`:540`）
  5. 进入 `query()` 循环（`:675`），消费 SDK 消息流
  6. yield 各类消息：`assistant` / `user` / `stream_event` / `system`(compact_boundary / api_retry) / `tool_use_summary`
  7. 检查 `maxTurns` (`:843`)、`maxBudgetUsd` (`:972`)、`max_structured_output_retries` (`:1005`)
  8. 最终发射 `result` 消息（subtype = `success` | `error_during_execution` | `error_max_turns` | `error_max_budget_usd` | `error_max_structured_output_retries`）

- `ask()` 函数 (`:1186-1295`) — QueryEngine 的便捷封装。用于 headless/SDK/print 模式。

**SDK 消息类型**（`entrypoints/sdk/coreTypes.generated.ts:97-107`）：

```typescript
SDKMessage          = { type: string; ... }           // 联合类型的根
SDKUserMessage      = { type: "user"; content; uuid }  // 用户消息
SDKAssistantMessage = { type: "assistant"; content }   // 助手消息
SDKResultMessage    = { type: "result"; ... }          // 结果消息
SDKSystemMessage    = { type: "system"; subtype }      // 系统消息
SDKStatusMessage    = { type: "status"; ... }          // 状态变更
```

### 1.4 Session 管理

- Session ID：`src/bootstrap/state.ts` 的 `getSessionId()`
- Transcript：`src/utils/sessionStorage.ts` 的 `recordTranscript()`（JSONL 格式）
- Resume：`src/utils/conversationRecovery.ts` 的 `loadConversationForResume()`
- Session 持久化开关：`src/bootstrap/state.ts` 的 `isSessionPersistenceDisabled()`
- Session 表：`~/.claude/sessions/` 目录，通过 `listSessions` / `getSessionInfo` API 查询

### 1.5 Tool 注册与构建模式

**文件**: `src/Tool.ts` (`:362-695`)，`src/tools.ts` (`:193-251`)

**核心接口** `Tool<Input, Output, P>` (`Tool.ts:362-695`) 约 40 个方法：
- 执行生命周期：`call()`、`validateInput()`、`checkPermissions()`、`isEnabled()`、`isReadOnly()`、`isConcurrencySafe()`
- 渲染：`renderToolUseMessage()`、`renderToolResultMessage()`、`renderToolUseErrorMessage()`
- 权限：`preparePermissionMatcher()`、`checkPermissions()`、`toAutoClassifierInput()`、`backfillObservableInput()`
- 描述：`prompt()`、`userFacingName()`、`description()`、`getToolUseSummary()`
- MCP 元数据：`isMcp`、`mcpInfo`、`shouldDefer`、`alwaysLoad`、`aliases`

**构建器模式**：`buildTool(def)` (`Tool.ts:783-792`) 自动填充安全默认值：
- `isEnabled` -> `true`
- `isConcurrencySafe` -> `false`
- `isReadOnly` -> `false`
- `isDestructive` -> `false`
- `checkPermissions` -> `{ behavior: 'allow', updatedInput }`
- `toAutoClassifierInput` -> `''`（skip classifier）

**工具注册**：`tools.ts:getAllBaseTools()` (`:193-251`) 返回完整工具池（30+ built-in）：
- Core：`AgentTool`, `BashTool`, `FileReadTool`, `FileEditTool`, `FileWriteTool`, `GlobTool`, `GrepTool`
- Web：`WebFetchTool`, `WebSearchTool`
- Structured：`NotebookEditTool`, `TodoWriteTool`, `ExitPlanModeV2Tool`
- Interaction：`AskUserQuestionTool`, `SkillTool`, `TaskCreateTool/Get/Update/List`
- Ant-only（feature-gated）：`REPLTool`, `TungstenTool`, `ConfigTool`
- Beta：`WebBrowserTool`, `LSPTool`, `WorkflowTool`, `TeamCreateTool/TeamDeleteTool`

**工具合并**：`assembleToolPool(permissionContext, mcpTools)` (`tools.ts:345-367`) — built-in 优先，按名排序，MCP 工具追尾，`uniqBy('name')` 去重。

---

## 2. 非交互模式 (`-p`) 流式事件格式

### 2.1 入口与路由

**文件**: `src/main.tsx`

- `-p` flag 检测 (`:800`): `const hasPrintFlag = cliArgs.includes('-p') || cliArgs.includes('--print')`
- 非交互判定 (`:803`): `hasPrintFlag || hasInitOnlyFlag || hasSdkUrl || !process.stdout.isTTY`
- 在 main.tsx action handler (`:2557`) 中，非交互走 `runHeadless()` 调用路径
- Print mode 时旁路 commander 子命令解析 (`:3883-3889`)

### 2.2 print.ts — runHeadless 核心

**文件**: `src/cli/print.ts`（5200+ 行）

- `runHeadless()` (`:455-973`) — headless 模式整体调度器
- 参数 options (`:464-491`)：`outputFormat`（`'text' | 'json' | 'stream-json'`）、`verbose`、`maxTurns`、`maxBudgetUsd`、`jsonSchema`、`thinkingConfig` 等
- `installStreamJsonStdoutGuard()` (`:594`) — 在 `stream-json` 下安装 stdout 守护
- 消息消费 (`:848-890`) — 三种输出模式：
  - `streamlined`（`CLAUDE_CODE_STREAMLINED_OUTPUT=true` + stream-json）-> 经 `StreamlinedTransformer` 变换
  - `stream-json` + verbose -> 直接 yield 每条消息
  - `stream-json` + non-verbose -> `text` 模式（仅 result 文本）
- **Exit code** (`:971-973`): `lastMessage?.type === 'result' && lastMessage?.is_error ? 1 : 0`

### 2.3 stream-json 事件格式（NDJSON）

**文件**: `src/cli/structuredIO.ts`（818 行）、`src/cli/ndjsonSafeStringify.ts`（33 行）

- 输出格式：**NDJSON**（每行一个完整 JSON 对象，`\n` 分隔）
- `ndjsonSafeStringify()` 转义 U+2028 / U+2029 防止 JavaScript line-terminator split 截断
- stdout 守护 (`src/utils/streamJsonStdoutGuard.ts:49-109`)：拦截所有 `process.stdout.write`，非 JSON 行重定向到 stderr 并打 `[stdout-guard]` 标签

**完整事件类型**：

| 事件 type | 说明 | 何时出现 |
|-----------|------|---------|
| `system_init` | 会话初始化：tools、model、permissionMode | 每次 prompt 开始 |
| `user` | 用户消息 replay（`isReplay: true`） | `replayUserMessages=true` |
| `stream_event` | 流式 API 原始事件（JSON payload） | `includePartialMessages=true` |
| `assistant` | 助手消息（text / tool_use / thinking blocks） | 每个 content block |
| `progress` | 工具执行进度 | 工具运行时 |
| `user` (tool_result) | 工具执行结果 | 工具完成后 |
| `system` / `compact_boundary` | compact 边界 + metadata | auto / manual compact |
| `system` / `api_retry` | API 重试信息（attempt、retry_delay_ms） | 重试时 |
| `system` / `hook_started/progress/response` | Hook 生命周期 | verbose + stream-json |
| `system` / `status` | 权限模式变更 | permissionMode 改变时 |
| `tool_use_summary` | 工具调用摘要（Haiku 模型生成） | 批次工具调用后 |
| `attachment` | 附件（文件变更、structured_output、queued_command） | 每轮后 |
| `result` | **最终结果** | **每条 prompt 结束** |

**result 消息结构**（关键字段，来自 `QueryEngine.ts:1135-1155`）：
```json
{
  "type": "result",
  "subtype": "success | error_during_execution | error_max_turns | error_max_budget_usd | error_max_structured_output_retries",
  "is_error": boolean,
  "duration_ms": number,
  "duration_api_ms": number,
  "num_turns": number,
  "result": string,
  "stop_reason": "end_turn | max_tokens | tool_use | ...",
  "session_id": "uuid",
  "total_cost_usd": number,
  "usage": { "input_tokens": N, "output_tokens": N, "cache_read_input_tokens": N, "cache_creation_input_tokens": N },
  "modelUsage": { "[modelName]": { "input_tokens": N, "output_tokens": N, ... } },
  "permission_denials": [{ "tool_name": string, "tool_use_id": string, "tool_input": object }],
  "structured_output": unknown,
  "errors": string[]
}
```

### 2.4 Streamlined Transformer

**文件**: `src/utils/streamlinedTransform.ts`

当 `CLAUDE_CODE_STREAMLINED_OUTPUT=true` + `stream-json` 时启用：
- 保留 text 消息不变
- 工具调用合并为累积计数（searches / reads / writes / commands / other）
- 省略 thinking 内容
- system_init 中剥离工具列表和模型信息

### 2.5 stdin 控制协议（SDK transport）

**文件**: `src/cli/structuredIO.ts`（`StructuredIO` class, `:135`）

- `structuredInput` — 读取 stdin JSON lines 的 async generator
- `write(message: StdoutMessage)` — 写 NDJSON 到 stdout
- `sendRequest<T>(request, schema?)` — 发 control_request / permission 请求，返回 Promise
- `canUseToolCallback()` — 将 SDK permission prompt 转发为 `can_use_tool` control_request
- `createSandboxAskCallback()` — 将沙箱网络权限转发到 SDK host
- 支持 `prependUserMessage()` 注入用户 turn（如 hook 的阻塞错误消息）

---

## 3. Hook 系统与权限引擎

### 3.1 Hook 事件（28 个）

**文件**: `src/entrypoints/sdk/coreTypes.ts:25-52`

```
PreToolUse        PostToolUse         PostToolUseFailure
Notification      UserPromptSubmit    SessionStart
SessionEnd        Stop                StopFailure
SubagentStart     SubagentStop        PreCompact
PostCompact       PermissionRequest   PermissionDenied
Setup             TeammateIdle        TaskCreated
TaskCompleted     Elicitation         ElicitationResult
ConfigChange      InstructionsLoaded  WorktreeCreate
WorktreeRemove    CwdChanged          FileChanged
```

### 3.2 Hook 配置格式

**文件**: `src/utils/hooks/hooksConfigManager.ts`（402 行）、`src/schemas/hooks.ts`（223 行）

四种 Hook 类型（`HookCommandSchema`，`schemas/hooks.ts:176-188`）：
1. **command**（shell 命令）：`type: 'command'`，支持 `timeout`、`shell`、`async`、`asyncRewake`、`statusMessage`
2. **prompt**（LLM 评估）：`type: 'prompt'`，支持 `model`、`$ARGUMENTS` placeholder
3. **agent**（agentic 验证）：`type: 'agent'`，支持 `model`、`timeout`、`$ARGUMENTS`
4. **http**（HTTP POST）：`type: 'http'`，支持 `headers`、`allowedEnvVars`

Hooks 配置在 `settings.json` 的 `hooks` 字段（`HooksSchema`，`schemas/hooks.ts:211-213`）：
```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "..." }] },
      { "matcher": "Write", "hooks": [{ "type": "prompt", "prompt": "...", "model": "claude-sonnet-4-6" }] }
    ],
    "PostToolUse": [ ... ]
  }
}
```

**Matcher** 使用 permission rule 语法（`IfConditionSchema`），如 `"Bash(git *)"` 只在匹配的 tool call 时触发。

### 3.3 Hook 退出码语义

| 事件 | exit 0 | exit 2 | 其他退出码 |
|------|--------|--------|-----------|
| PreToolUse | stdout/stderr 不显示 | stderr 发给模型 + **阻止工具调用** | stderr 仅给用户 |
| PostToolUse | stdout 在 transcript 模式显示(ctrl+o) | stderr 立即发给模型 | stderr 仅给用户 |
| Stop | stdout/stderr 不显示 | stderr 发给模型并**继续对话** | stderr 仅给用户 |
| UserPromptSubmit | stdout 给 Claude | **阻止处理**，清原 prompt | stderr 仅给用户 |
| SessionStart | stdout 给 Claude（阻塞错误忽略） | N/A | stderr 仅给用户 |
| PermissionRequest | 使用 hook 输出的 decision | N/A | stderr 仅给用户 |

### 3.4 Hook 分组与注册

**文件**: `src/utils/hooks/hooksConfigManager.ts`

- `groupHooksByEventAndMatcher()` (`:270-365`) — hooks 按 event + matcher 三级分组（来源：settings 文件、plugin hooks、built-in hooks）
- `getSortedMatchersForEvent()` (`:368-377`) — 按优先级排序 matcher
- `getHooksForMatcher()` (`:380-392`) — 获取特定 event + matcher 的 hooks

Hook 注册来源（3 层）：
1. **settings 文件**（`settings.json` 的 `hooks` 字段）— 用户/项目/本地级
2. **plugin hooks**（`getRegisteredHooks()`）— Plugin 注册的 `HookCallbackMatcher` / `PluginHookMatcher`
3. **built-in hooks**（ant-only）— 如 `attributionHooks`、`sessionFileAccessHooks`

### 3.5 权限引擎

**文件**: `src/utils/permissions/`（30 个文件）

#### 权限模式（`PermissionMode.ts`）
```
'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'auto' | 'dontAsk'
```

#### 权限规则格式（`permissionRuleParser.ts:93-100`）
```
"ToolName" 或 "ToolName(content)" -> { toolName: string, ruleContent?: string }
```
转义规则：`\(` / `\)` 表示 content 中的字面括号

#### 权限上下文（`Tool.ts:123-138`）
```typescript
ToolPermissionContext = {
  mode: PermissionMode
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>
  alwaysAllowRules: ToolPermissionRulesBySource  // per-source allow 规则
  alwaysDenyRules: ToolPermissionRulesBySource   // per-source deny 规则
  alwaysAskRules: ToolPermissionRulesBySource    // per-source 总是询问
  isBypassPermissionsModeAvailable: boolean
  isAutoModeAvailable?: boolean
  shouldAvoidPermissionPrompts?: boolean       // 后台 agent（无 UI）
  awaitAutomatedChecksBeforeDialog?: boolean   // coordinator worker
  prePlanMode?: PermissionMode                 // plan mode 前的模式
  localDenialTracking?: DenialTrackingState    // subagent
}
```

#### 权限检查优先级（`permissions.ts`）
1. **Rule check** — `alwaysAllowRules` / `alwaysDenyRules` / `alwaysAskRules`（按 source 优先级）
2. **Mode check** — `bypassPermissions` -> 全部 allow（除非 deny rule）
3. **Auto classifier**（feature-gated `TRANSCRIPT_CLASSIFIER`）— `yoloClassifier.ts` 自动判断 Bash 安全
4. **PermissionRequest hooks** — `structuredIO.ts:561-650` 并行执行 hooks + SDK 弹窗
5. **Denial tracking** — 拒绝逐次累计，达阈值 fallback 到用户 prompt

#### 权限规则来源（`permissions.ts:109-114`）
```typescript
const PERMISSION_RULE_SOURCES = [
  ...SETTING_SOURCES,  // 'user', 'project', 'local', 'enterprise', 'managed'
  'cliArg',
  'command',
  'session',
]
```

### 3.6 Plugin 系统

**文件**: `src/plugins/builtinPlugins.ts`（160 行）、`src/utils/plugins/pluginLoader.ts`

- Plugin ID 格式：`{name}@{marketplace}`，built-in 为 `{name}@builtin`
- Plugin 可提供：skills（转为 slash commands）、hooks（注册到 hook 系统）、MCP servers
- 安装：`/plugin install` -> 从 marketplace下载 -> 注册 hooks/MCP
- Plugin hooks 通过 `getRegisteredHooks()`（`bootstrap/state.ts`）注入

---

## 4. MCP 与工具系统

### 4.1 MCP Server 配置

**文件**: `src/services/mcp/types.ts`

8 种 transport 类型（`TransportSchema`，`:23-26`）：
- `stdio` — 本地子进程（`command + args + env`）
- `sse` / `sse-ide` — HTTP SSE
- `http` — HTTP POST
- `ws` / `ws-ide` — WebSocket
- `sdk` — 同进程 SDK MCP server
- `claudeai-proxy` — Claude.ai 代理

**配置作用域**（`ConfigScopeSchema`，`:10-20`）：
```
'local' | 'user' | 'project' | 'dynamic' | 'enterprise' | 'claudeai' | 'managed'
```

**OAuth 支持**（`McpOAuthConfigSchema`，`:43-56`）：
```typescript
{ clientId, callbackPort, authServerMetadataUrl, xaa }
```

**XAA (Cross-App Access)**：`McpXaaConfigSchema` -> 布尔标记，连接细节统一来自 `settings.xaaIdp`。

### 4.2 MCP 连接生命周期

**文件**: `src/services/mcp/client.ts`

`connectToServer()` -> 建立传输层 -> `client.connect()` -> `fetchToolsForClient()` -> 注册工具到 `appState.mcp.tools`

**工具合并**（`tools.ts:345-367` `assembleToolPool()`）：
1. 获取 built-in 工具（经 `permissionContext` 过滤 deny rules）
2. 过滤 MCP 工具 by deny rules
3. 分别排序后拼接（built-in 在前，MCP 在后）
4. `uniqBy('name')` 去重（built-in 优先）

**MCP 工具命名**：默认 `mcp__serverName__toolName`；`CLAUDE_AGENT_SDK_MCP_NO_PREFIX` 时去前缀。

### 4.3 Built-in 工具实现模式

**BashTool**（`src/tools/BashTool/`，15 个文件）：
- `bashSecurity.ts` — 命令安全检查
- `bashPermissions.ts` — 权限验证
- `commandSemantics.ts` — 语义分析（isSearchOrReadCommand）
- `readOnlyValidation.ts` / `sedValidation.ts` / `pathValidation.ts` — 输入验证
- `shouldUseSandbox.ts` — 沙箱判定
- `destructiveCommandWarning.ts` — 危险命令警告
- `modeValidation.ts` — 模式限制（只读/sandbox）

**FileEditTool**（`src/tools/FileEditTool/FileEditTool.ts`）：
- 精确文本替换：`old_string` -> `new_string`
- `isConcurrencySafe: false`（文件工具均为非并发安全）
- `isDestructive: true`（编辑操作不可逆）

**AgentTool**（`src/tools/AgentTool/`，8 个核心文件）：
- 5 个 built-in agents：`generalPurposeAgent`、`exploreAgent`、`planAgent`、`claudeCodeGuideAgent`、`verificationAgent`
- `runAgent.ts` -> `forkSubagent.ts` -> 复用 `query()` 循环
- `resumeAgent.ts` -> 恢复后台 agent session
- `agentMemory.ts` -> agent 间 memory 共享

### 4.4 Streaming Tool Executor

**文件**: `src/services/tools/StreamingToolExecutor.ts`

- GrowthBook gate `streamingToolExecution` 控制
- 在 API streaming 期间**同步执行工具**（不等所有 content block 完成）
- `addTool()` 添加待执行工具 -> `getCompletedResults()` 获取已完成结果
- `getRemainingResults()` 获取剩余（含 synthetic tool_result for abort）

### 4.5 MCP CLI 子命令

**文件**: `src/entrypoints/mcp.ts:35-196`

`claude mcp serve` — 将 Claude Code built-in tools 暴露为 MCP server：
- `ListToolsRequestSchema` -> 返回所有工具 + descriptions
- `CallToolRequestSchema` -> `findToolByName` -> `validateInput` -> `tool.call`
- 工具 schemas 通过 `zodToJsonSchema()` 转换为 MCP JSON Schema

### 4.6 Tool 发现与延迟加载

- `ToolSearchTool`（`src/tools/ToolSearchTool/`）— 工具数超阈值时启用，允许模型按关键词搜索
- `shouldDefer: true` — 延迟加载（不出现于 initial prompt）
- `alwaysLoad: true` — 永不延迟
- `toolMatchesName()`（`Tool.ts:348-353`）— 支持 primary name + aliases

---

## 5. 对 AgentHub ClaudeCodeAdapter 的具体实现建议

### 5.1 最小可行集成路径（子进程模式）

```
AgentHub
  +-- spawn('claude', ['-p', prompt, '--output-format', 'stream-json', '--verbose'])
  |      stdin:  JSON lines（user messages / control requests）
  |      stdout: NDJSON lines（assistant / system / result）
  |      stderr: non-JSON + hook output + [stdout-guard] lines
  +-- 逐行 parse stdout NDJSON -> 构建 AgentHub Message 对象
```

**关键**：必须 `--output-format stream-json --verbose` 同时使用。non-verbose 只输出 result 文本。

### 5.2 stdout NDJSON 消息处理映射

| SDK Message | 含义 | AgentHub 处理 |
|-------------|------|--------------|
| `system_init` | 会话初始化 | 记录 session_id、tools、model |
| `assistant` | 模型输出（text/tool_use/thinking） | 流式推送 + 提取 tool_use 执行 |
| `user` (isReplay:true) | 消息确认 | 忽略或记录 |
| `user` (tool_result) | 工具执行结果 | 作为 tool result 传回 |
| `stream_event` | 流式 API 原事件 | `include_partial_messages` 时才出现 |
| `system/compact_boundary` | 上下文压缩 | 可选记录 metadata |
| `system/api_retry` | API 重试 | 日志记录 |
| `system/status` | 权限模式变更 | 记录到 AgentHub state |
| `result` | **最终结果** | 提取 result/cost/usage/errors |
| `tool_use_summary` | 工具调用摘要 | 可选 UI 汇总 |

### 5.3 Exit Code 判断

```python
exit_code = process.exit_code
if exit_code == 0:
    # result.is_error == false，正常完成
elif exit_code == 1:
    # result.is_error == true
    # 检查 last_result.errors[] 获取错误详情
```

### 5.4 关键 CLI 参数

| 参数 | 用途 | 推荐值 |
|------|------|--------|
| `--output-format stream-json` | **必须** — NDJSON 输出 | stream-json |
| `--verbose` | **推荐** — 完整消息流 | enabled |
| `--max-turns N` | API 轮次限制 | 按需（默认无限） |
| `--max-budget-usd N` | API 费用上限 | 按需 |
| `--model <model>` | 指定模型 | Claude Sonnet/Opus |
| `--system-prompt <text>` | 自定义 system prompt | 透传 AgentHub |
| `--append-system-prompt <text>` | 追加 system prompt | AgentHub 追加策略 |
| `--allowed-tools <tools>` | 限制可用工具 | 安全管控 |
| `--permission-mode <mode>` | 权限模式 | `bypassPermissions` / `default` |
| `--add-dir <path>` | 额外工作目录 | 项目上下文 |
| `--thinking-config <json>` | Thinking 配置 | `{"type":"adaptive"}` |
| `--mcp-config <file>` | MCP server 配置文件 | 文件路径 |

### 5.5 深度嵌入集成（复用 QueryEngine）

不走 CLI 子进程，直接嵌入 QueryEngine 的核心依赖注入清单：

```typescript
import { QueryEngine } from './QueryEngine.js'
import { getTools } from './tools.js'

const engine = new QueryEngine({
  cwd: projectDir,
  tools: getTools(permissionContext),      // Tool[] — built-in tools
  commands: commands,                       // Command[] — slash commands
  mcpClients: mcpConnections,               // MCPServerConnection[]
  agents: agentDefinitions,                 // AgentDefinition[]
  canUseTool: hasPermissionsToUseTool,      // CanUseToolFn
  getAppState: () => appState,              // () => AppState
  setAppState: fn => { /* ... */ },         // (AppState) => void
  readFileCache: fileStateCache,            // LRU FileStateCache (100项/25MB)
  customSystemPrompt: '...',
  maxTurns: 100,
  maxBudgetUsd: 10,
  thinkingConfig: { type: 'adaptive' },
})

for await (const msg of engine.submitMessage(userPrompt)) {
  // 处理 SDKMessage stream
}
```

5 个核心依赖注入需求：
1. **AppState**（`src/state/AppStateStore.ts`）— 含 `toolPermissionContext`、`mcp.tools`、`mcp.clients`、`fileHistory`、`attribution`
2. **FileStateCache**（`src/utils/fileStateCache.ts`）— LRU 文件读写缓存
3. **CanUseToolFn**（`src/hooks/useCanUseTool.ts`）— 权限检查函数签名
4. **MCPServerConnection[]** — MCP 客户端连接池
5. **Command[]** — slash command 定义（`src/commands.ts`）

### 5.6 架构关键约束与陷阱

1. **stdout 守护**：`stream-json` 下自动安装 `streamJsonStdoutGuard`，非 JSON stdout 会重定向到 stderr。**不要在 stdout 输出调试信息**。
2. **Session 持久化**：每轮 transcript 自动写入 `~/.claude/sessions/` 的 JSONL 文件。`--resume` 可恢复。
3. **Abort 控制**：`QueryEngine.interrupt()` 通过 `AbortController` 中止查询。子进程可用 SIGINT。
4. **工具权限**：非交互模式下权限检查仍执行，`--permission-mode bypassPermissions` 可跳过。
5. **MCP 启动开销**：MCP server 异步连接，首轮查询可能未完全就绪。通过 `refreshTools` 回调更新。
6. **Compact / Context Collapse**：长对话自动触发 compaction，消息被 summary 替换。`compact_boundary` 事件标记。
7. **Feature Gates**：大量功能由 `bun:bundle` 的 `feature()` 宏 + GrowthBook 远程配置控制。外部构建不含 ant-only 功能。
8. **Zod vs JSON Schema**：Tool 内部用 Zod schema，输出到 MCP/SDK 时经 `zodToJsonSchema()` 转换。
