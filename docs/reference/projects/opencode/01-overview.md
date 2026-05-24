# OpenCode 深度调研报告

> 调研对象：`anomalyco/opencode` (MIT), depth=1 clone（2026-05-21）
> 
> 技术栈：Bun workspace monorepo, TypeScript, Effect runtime, SolidJS UI, Hono HTTP, Drizzle ORM
> 
> 源码路径：`D:\Code\AgentHub\reference\opencode`

---

## 1. Plugin/Hook 生命周期系统

### 1.1 核心类型定义

**文件**：`packages/plugin/src/index.ts`

#### Plugin 函数签名 (L74)

```ts
export type Plugin = (
  input: PluginInput,
  options?: PluginOptions,
) => Promise<Hooks>
```

`PluginInput` (L56-66) 包含：
- `client`: OpencodeClient 实例
- `project`: 项目元信息
- `directory` / `worktree`: 工作区路径
- `experimental_workspace`: 工作空间适配器注册入口
- `serverUrl`: 服务端 URL
- `$`: Bun Shell 实例

`PluginModule` (L76-79) 区分 `server` 端 plugin 和 `tui` 端 plugin（`tui?: never` 禁止 TUI 入口导出 server 逻辑）。

#### WorkspaceAdapter 抽象 (L47-54)

```ts
export type WorkspaceAdapter = {
  name: string
  description: string
  configure(config: WorkspaceInfo): WorkspaceInfo | Promise<WorkspaceInfo>
  create(config: WorkspaceInfo, env: Record<string, string | undefined>,
         from?: WorkspaceInfo): Promise<void>
  remove(config: WorkspaceInfo): Promise<void>
  target(config: WorkspaceInfo): WorkspaceTarget | Promise<WorkspaceTarget>
}
```

WorkspaceAdapter 通过 `plugin.experimental_workspace.register(type, adapter)` 注册，向下桥接到 `control-plane/adapters`（`packages/opencode/src/plugin/index.ts` L140-143）。

### 1.2 19 个生命周期钩子 (L222-333)

所有钩子采用统一模式：`(input, output) => Promise<void>`，即**双向修改**——钩子可以读取 input 并修改 output。

| # | 钩子名 | 行号 | 触发时机 | Input 关键字段 | Output 修改能力 |
|---|--------|------|----------|---------------|----------------|
| 1 | `event` | L222-224 | 所有 Bus 事件 | `{ event: Event }` | 无 (void promise) |
| 2 | `config` | L225-227 | 配置加载后 | Config 对象 | 无 (void promise) |
| 3 | `tool` | L228-231 | 注册插件 tool | `{ [key: string]: ToolDefinition }` | 工具字典 |
| 4 | `auth` | L232-233 | 认证注册 | AuthHook 对象 | OAuth/API auth 方法 |
| 5 | `provider` | L234-235 | Provider 注册 | ProviderHook | 动态模型发现 |
| 6 | `chat.message` | L233-242 | 新消息到达 | sessionID, agent, model, messageID, variant | message, parts 修改 |
| 7 | `chat.params` | L246-255 | LLM 参数构造 | sessionID, agent, model, provider, message | temperature, topP, topK, maxOutputTokens, options |
| 8 | `chat.headers` | L256-259 | HTTP 头构造 | sessionID, agent, model, provider, message | headers 字典 |
| 9 | `permission.ask` | L260 | 权限询问 | Permission 对象 | status: "ask"/"deny"/"allow" |
| 10 | `command.execute.before` | L261-264 | 命令执行前 | command, sessionID, arguments | parts (UI 渲染内容) |
| 11 | `tool.execute.before` | L265-268 | Tool 执行前 | tool, sessionID, callID | args (修改工具参数) |
| 12 | `shell.env` | L269-272 | 创建 shell 环境 | cwd, sessionID, callID | env 环境变量 |
| 13 | `tool.execute.after` | L273-280 | Tool 执行后 | tool, sessionID, callID, args | title, output, metadata |
| 14 | `experimental.chat.messages.transform` | L281-289 | 消息发送前 | {} | messages 数组转换 |
| 15 | `experimental.chat.system.transform` | L290-295 | System prompt 构造 | sessionID, model | system 字符串数组 |
| 16 | `experimental.session.compacting` | L303-306 | 会话压缩前 | sessionID | context 补充, prompt 替换 |
| 17 | `experimental.compaction.autocontinue` | L314-324 | 压缩后/auto-continue 前 | sessionID, agent, model, overflow 等 | enabled: boolean |
| 18 | `experimental.text.complete` | L325-328 | 文本补全时 | sessionID, messageID, partID | text 修改 |
| 19 | `tool.definition` | L332 | Tool 描述发送给 LLM 前 | toolID | description, parameters 修改 |

> 注：`event`/`config`/`tool`/`auth`/`provider` 为顶层注册式钩子，其余 14 个为触发式生命周期钩子。

### 1.3 插件加载流程

**文件**：`packages/opencode/src/plugin/index.ts` + `packages/opencode/src/plugin/loader.ts`

1. **内置插件** (L60-68 of index.ts)：8 个内置 auth/provider 插件直接 `import` 并在启动时调用
2. **外部插件** (L163-233)：通过 `PluginLoader.loadExternal()` 并行加载
   - resolve（目标 + 入口文件） → 兼容性检查 → dynamic import → 执行 server plugin 函数
3. **插件维度**：区分 `server`/`tui` 两种 Kind，通过 `PluginModule` 形状约束
4. **重试机制** (L211-228)：文件型 plugin 安装失败自动重试一次（受 Bun 缓存限制）
5. **配置通知** (L236-243)：加载完成后对所有 hook 调用 `config(cfg)` 同步配置

### 1.4 V2 Plugin 系统 (Effect Service)

**文件**：`packages/core/src/plugin.ts`

独立的 Effect Service 层 plugin 系统，提供 4 个受控钩子：

| Hook | Input | Output |
|------|-------|--------|
| `provider.update` | `{}` | provider Info, cancel flag |
| `model.update` | `{}` | model Info, cancel flag |
| `aisdk.language` | model, sdk, options | language model 替换 |
| `aisdk.sdk` | model, package, options | sdk 替换 |

使用 `immer` 的 `createDraft/finishDraft` 实现不可变 output 修改。内置 boot 系统按序启动 5 类插件：env → auth → provider → models-dev。

---

## 2. 多 Agent 架构与模块拆分

### 2.1 Agent 系统

**文件**：`packages/opencode/src/agent/agent.ts`

#### 内置 Agent (L126-278)

| Agent | 模式 | 用途 | 权限特点 |
|-------|------|------|---------|
| `build` | primary (native) | 默认全功能 agent | question/plan_enter = allow |
| `plan` | primary (native) | 只读规划模式 | 禁止所有 edit，allow plan_exit |
| `general` | subagent (native) | 复杂多步任务执行 | todowrite = deny |
| `explore` | subagent (native) | 快速代码库探索 | 仅 allow 只读工具 (grep/glob/read/bash/webfetch/websearch) |
| `scout` | subagent (native, 实验性) | 文档/依赖源码搜索 | allow repo_clone/repo_overview |
| `compaction` | primary (hidden) | 会话压缩 | 禁止所有工具 |
| `title` | primary (hidden) | 标题生成 | 禁止所有工具，temperature=0.5 |
| `summary` | primary (hidden) | 摘要生成 | 禁止所有工具 |

#### Agent Info Schema (L28-49)

```ts
export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Finite),
  temperature: Schema.optional(Schema.Finite),
  color: Schema.optional(Schema.String),
  permission: Permission.Ruleset,
  model: Schema.optional(Schema.Struct({ modelID: ModelID, providerID: ProviderID })),
  variant: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Finite),
})
```

#### 动态 Agent 生成 (L381-449)

`Agent.generate()` 使用 `generateObject()` (AI SDK) 根据用户自然语言描述自动生成 agent 配置 JSON，返回 `{ identifier, whenToUse, systemPrompt }`。通过 `experimental.chat.system.transform` hook 让插件参与 system prompt 构建。

#### 权限系统 (L93-323)

分层合并权限：`defaults → agent 内建权限 → 用户配置权限`。支持的模式：
- `"*"`: 全局默认规则
- `external_directory`: GLOB 模式匹配外部目录访问
- `read/edit/write`: 按文件 GLOB 细化权限
- 特殊控制：`doom_loop`、`question`、`plan_enter`/`plan_exit`、`repo_clone`、`repo_overview`

用户可以通过 `opencode.toml` 的 `[agent.<name>]` section 覆盖任意 agent 配置（L280-307）。

### 2.2 Session 管理

**文件**：`packages/opencode/src/session/session.ts`

核心链路：
- 父/子 session 树形结构（`parent_id`），支持语义 slug
- SQLite 持久化（`SessionTable` + `PartTable`，Drizzle ORM）
- 消息/Part 存储 (MessageV2 体系)
- Session 事件总线 (Session.Event — Error, TitleUpdated, etc.)
- API 操作：create / fork / abort / summarize / diff / share / unshare / children / todo
- Cost tracking（Decimal.js 精确计算）
- Token 使用统计（input / output / reasoning / cache_read / cache_write）
- `SessionID` 以 `ses_` 为前缀的 branded string（`packages/core/src/session.ts`）

### 2.3 SDK 设计

**目录**：`packages/sdk/`

#### 双层架构

| 层 | 文件 | 特性 |
|----|------|------|
| V1 SDK | `js/src/client.ts` | `createOpencodeClient()` 工厂，`x-opencode-directory` header 注入，禁用 fetch timeout |
| V2 SDK | `js/src/v2/client.ts` | 额外支持 `x-opencode-workspace` header，HTML response 检测，content-type 校验 |

#### OpenAPI Codegen 驱动

`packages/sdk/js/src/gen/` 由 `@hey-api/openapi-ts` 从 `packages/sdk/openapi.json` 自动生成：

- `sdk.gen.ts`：类型安全的 `OpencodeClient` 类，暴露 **70+ 方法**（session CRUD、tool list、config、project、pty、instance、global events 等）
- `types.gen.ts`：完整的请求/响应 TypeScript 类型定义
- `client.gen.ts`：底层 HTTP client + request/response/error interceptor 机制
- `core/`：认证、序列化、SSE、query key 序列化等基础设施

#### SDK Entry Points

```
@opencode-ai/sdk          → V1 client (createOpencodeClient)
@opencode-ai/sdk/v2       → V2 client (workspace-aware)
@opencode-ai/sdk/client   → client-only utilities
@opencode-ai/sdk/server   → server-side helpers
```

### 2.4 22 个 Package 模块拆分

| 类别 | Package | 职责 |
|------|---------|------|
| **核心抽象** | `core` | Effect Services、全局常量、Schema 工具、文件系统抽象、GitHub Copilot adapter |
| **LLM 引擎** | `llm` | Provider 工厂、Protocol 协议状态机、Route 路由、Tool 系统 |
| **主应用** | `opencode` | CLI 入口、Hono Server (HTTP + SSE)、Agent、Session、MCP、Config、LSP |
| **UI 层** | `ui` + `app` | SolidJS 组件库 (message 渲染、diff viewer) + 业务逻辑 |
| **呈现层** | `desktop` / `web` | Electron 桌面应用 / Astro 文档站点 |
| **SDK** | `sdk` | OpenAPI spec → codegen → typed JS/TS client |
| **Plugin** | `plugin` | Plugin 开发 SDK（类型 + 工具定义） |
| **扩展** | `extensions/zed` | Zed 编辑器集成 |
| **辅助** | `function` / `script` / `http-recorder` | FaaS 运行时 / 构建脚本 / HTTP 录制 |
| **企业** | `enterprise` / `identity` / `console` / `containers` / `slack` | 企业版 SaaS 功能 |

### 2.5 桌面版 (Electron) vs Web 版 (Astro) 架构差异

**桌面版** (`packages/desktop/`)：
- Electron main process：server 管理、系统菜单、window 管理、自动更新、sidecar 进程
- Renderer：SolidJS WebView (TUI)、i18n、styles
- 内嵌 Hono server 作为本地 API 后端，TUI 通过 `http://localhost:4096` 通信
- IPC 桥接 (`ipc.ts`) 连接 main/renderer

**Web 版** (`packages/web/`)：
- Astro SSG 纯文档站点，20+ 语言 MDX 内容
- 不含任何运行时代码 —— 纯粹的文档/营销导向

---

## 3. LLM Provider 工厂模式

### 3.1 核心设计：Route.make() 四轴组合

**文件**：`packages/llm/src/route/client.ts` (L357-398)

```ts
export function make<Body, Frame, Event, State>(input: {
  id: string              // 路由标识
  protocol: Protocol      // 语义层：API 契约（what）
  endpoint: Endpoint      // 部署层：URL 路径（where）
  auth?: Auth             // 部署层：认证方式（how）
  framing: Framing        // 部署层：流帧分割（transport format）
  headers?: fn            // 跨切面：额外 HTTP 头
  defaults?: RouteDefaults // 模型默认参数
}): Route<Body, HttpPrepared>
```

**设计原则**：Protocol（API 语义）与 Endpoint/Auth/Framing（部署细节）解耦。这是 OpenCode 能支持 20+ LLM provider 而每个协议不需要 fork 300 行的关键架构决策。

### 3.2 Protocol 状态机 (Stream Parser)

**文件**：`packages/llm/src/route/protocol.ts`

```ts
export interface Protocol<Body, Frame, Event, State> {
  readonly id: ProtocolID
  readonly body: ProtocolBody<Body>    // 请求降级：LLMRequest → provider-native body
  readonly stream: ProtocolStream<Frame, Event, State>  // 响应流式状态机
}

export interface ProtocolStream<Frame, Event, State> {
  readonly event: Schema.Codec<Event, Frame>     // 帧解码器
  readonly initial: () => State                   // 初始解析器状态
  readonly step: (state, event) => Effect<[State, LLMEvent[]]>  // 步进函数
  readonly terminal?: (event) => boolean           // 终止条件（SSE [DONE] 等）
  readonly onHalt?: (state) => LLMEvent[]         // 流结束后的尾事件
}
```

### 3.3 已有 Provider 实现 (12 个)

**文件**：`packages/llm/src/providers/index.ts`

| Provider | Protocol/Route | Transport 特点 |
|----------|----------------|---------------|
| Anthropic | `AnthropicMessages` | SSE, cache breakpoint cap=4, extended thinking |
| OpenAI | `OpenAIResponses` + `OpenAIChat` | HTTP + WebSocket dual support |
| Google | `Gemini` | generateContent, URL-as-endpoint |
| Azure | OpenAI-compatible | auth 差异（Entra ID） |
| Amazon Bedrock | `BedrockConverse` | binary event-stream framing |
| Cloudflare | Workers AI + AI Gateway | 两个独立 provider |
| OpenRouter | OpenAI-compatible pass-through | — |
| xAI | OpenAI-compatible pass-through | — |
| GitHub Copilot | 独立实现 | chat + responses 双模式 |
| OpenAI Compatible | 通用协议 | 含 8 个预配置 profile |

**OpenAI Compatible profiles** (8 个，一行代码即可注册): `deepseek`, `cerebras`, `groq`, `fireworks`, `togetherai`, `baseten`, `deepinfra`

### 3.4 协议实现深度案例：Anthropic Messages

**文件**：`packages/llm/src/protocols/anthropic-messages.ts`

完整管线：

1. **Request Lowering** (L357-396)：`fromRequest()` 将通用 `LLMRequest` 转换为 Anthropic Messages body
   - Cache breakpoint 预算管理（4 个上限，优先级：tools > system > messages）
   - Tool choice 降级适配
   - Thinking/Extended Thinking 配置
   - Server tool use/result 编码

2. **Stream Parsing State Machine** (L398-651)：
   - 解析器状态 `ParserState` 包含：`ToolStream.State`, `Usage`, `Lifecycle.State`
   - `step()` 根据 `event.type` 分发到 6 个处理函数：
     - `message_start` → 初始化 usage
     - `content_block_start` → 按 block type 分类处理 (text / tool_use / server_tool_use / thinking)
     - `content_block_delta` → 流式增量文本 / input_json_delta / 推理签名
     - `content_block_stop` → 工具调用完成，触发 tool-call 事件
     - `message_delta` → 最终 usage + finish reason 合并
     - `error` → 转换为 provider-error 事件

3. **Route Assembly** (L661-681)：`Protocol.make()` + `Route.make()` — SSE framing + x-api-key auth + anthropic-version header

### 3.5 LLMErrorReason：10 变体 Discriminated Union

**文件**：`packages/llm/src/schema/errors.ts` (L156-167)

```ts
export const LLMErrorReason = Schema.Union([
  InvalidRequestReason,         // _tag: "InvalidRequest" — 400/404/409/422
  NoRouteReason,                // _tag: "NoRoute"
  AuthenticationReason,          // _tag: "Authentication" — 401/403
  RateLimitReason,               // _tag: "RateLimit" — 429, retryable
  QuotaExceededReason,           // _tag: "QuotaExceeded" — 429 quota
  ContentPolicyReason,           // _tag: "ContentPolicy" — content filter
  ProviderInternalReason,        // _tag: "ProviderInternal" — 500/503/504/529, retryable
  TransportReason,               // _tag: "Transport" — network/timeout
  InvalidProviderOutputReason,   // _tag: "InvalidProviderOutput" — parse error
  UnknownProviderReason,         // _tag: "UnknownProvider"
]).pipe(Schema.toTaggedUnion("_tag"))
```

每个 variant 通过 `retryable` getter 声明是否可重试。

### 3.6 RouteExecutor 重试策略

**文件**：`packages/llm/src/route/executor.ts` (L334-353)

- 指数退避 + jitter，最多 **2 次重试**
- 基础延迟：500ms，上限：10000ms
- 8 种敏感 header/query/body 自动 redaction（`authorization`, `api-key`, `token`, `secret`, `signature` 等）
- 统一的 `HttpContext` 封装请求/响应详情用于审计

### 3.7 LLMEvent：16 类型 Tagged Union

**文件**：`packages/llm/src/schema/events.ts` (L206-286)

```ts
export const LLMEvent = Schema.Union([
  StepStart, TextStart, TextDelta, TextEnd,
  ReasoningStart, ReasoningDelta, ReasoningEnd,
  ToolInputStart, ToolInputDelta, ToolInputEnd,
  ToolCall, ToolResult, ToolError,
  StepFinish, Finish, ProviderErrorEvent,
]).pipe(Schema.toTaggedUnion("type"))
```

提供 16 个 `is.*` guard 函数 + 对应的工厂方法，支持模式匹配式的流事件消费。

### 3.8 Tool Runtime Orchestration Loop

**文件**：`packages/llm/src/tool-runtime.ts`

`ToolRuntime.stream()` 完整的 tool orchestration：
1. 发送 LLM 请求（带 tool definitions）
2. 累积 assistant content + 识别 tool calls
3. 若 finish reason 为 `tool-calls` 且 `toolExecution !== "none"`：并发执行工具（默认 concurrency=10）
4. 将 tool results 追加到消息历史，继续下一步
5. `stopWhen` 条件控制最大步数，`ToolRuntime.stepCountIs(n)` 提供声明式步数限制

Tool 执行使用 Effect Schema Codec 双向编解码——输入参数验证 (`_decode`) + 输出值编码 (`_encode`)。

---

## 4. MCP Server 状态管理

### 4.1 Discriminated Union 状态机

**文件**：`packages/opencode/src/mcp/index.ts` (L72-96)

```ts
// 5 种状态通过 Schema.Union + discriminator: "status" 区分
export const Status = Schema.Union([
  StatusConnected,                    // { status: "connected" }
  StatusDisabled,                     // { status: "disabled" }
  StatusFailed,                       // { status: "failed", error: string }
  StatusNeedsAuth,                    // { status: "needs_auth" }
  StatusNeedsClientRegistration,      // { status: "needs_client_registration", error: string }
]).annotate({ discriminator: "status" })
```

这 5 个变体通过 `Schema.tag("connected")` / `Schema.Literal("connected")` + `Schema.toTaggedUnion` 实现编译时穷尽检查和运行时类型收紧。

### 4.2 Effect Service 接口

MCP 模块通过 `Context.Service` 暴露 19 个 Effect 方法 (L238-263)：

| 类别 | 方法 | 功能 |
|------|------|------|
| 状态查询 | `status()` / `tools()` / `prompts()` / `resources()` / `clients()` | 运行时状态获取 |
| 生命周期 | `add()` / `connect()` / `disconnect()` | MCP server 启停 |
| prompt/resource | `getPrompt()` / `readResource()` | 按需获取 |
| OAuth | `startAuth()` / `authenticate()` / `finishAuth()` / `removeAuth()` | 完整认证流程 |
| 认证状态 | `supportsOAuth()` / `hasStoredTokens()` / `getAuthStatus()` | 状态查询 |

### 4.3 Transport 双模式

| Transport | 适用场景 | 实现 |
|-----------|---------|------|
| `local` | 本地 MCP server 进程 | `StdioClientTransport` (spawn command + args + env) |
| `remote` | HTTP/SSE 远端 | 优先 `StreamableHTTPClientTransport`，失败 fallback `SSEClientTransport` |

连接策略 (L330-409)：对 remote server 按序尝试两种 transport，第一种成功即停止；Auth 错误（`UnauthorizedError`）立即停止后续 transport 尝试并设置为 `needs_auth` 状态。

### 4.4 OAuth 2.0 完整流程

**文件**：`packages/opencode/src/mcp/index.ts` (L759-897) + `packages/opencode/src/mcp/oauth-provider.ts` + `packages/opencode/src/mcp/oauth-callback.ts`

1. `startAuth()` — 创建 `McpOAuthProvider` + `StreamableHTTPClientTransport`，触发 OAuth metadata 发现，获取 authorization URL
2. `authenticate()` — 打开系统浏览器引导用户授权，启动本地 `McpOAuthCallback` HTTP server 接收 redirect
3. `finishAuth()` — 用 authorization code 调用 `transport.finishAuth()` 完成 token 交换，重新创建并存储 client
4. **CSRF 防护**：32 字节随机 `oauthState`，校验 redirect callback 与存储的 state 一致性

### 4.5 MCP Tool → AI SDK Tool 转换

**文件**：`packages/opencode/src/mcp/index.ts` (L154-182)

```ts
function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Tool {
  // 1. 确保 inputSchema 为 object 类型
  // 2. 强制 additionalProperties: false
  // 3. 包装为 AI SDK dynamicTool
  // 4. execute handler 调用 client.callTool()
}
```

输出 schema 兼容：MCP server 返回无效 `outputSchema` JSON Schema references 时自动回退到 tolerance 模式（`TolerantListToolsResultSchema`），仅解析 name/description/inputSchema。

### 4.6 工具列表热重载

**文件**：`packages/opencode/src/mcp/index.ts` (L499-511)

```ts
client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
  // 重新 listTools → 更新缓存 → 发布 ToolsChanged bus event
})
```

MCP server 发送 `notifications/tools/list_changed` 时自动刷新，通过 Bus Event 通知 UI。

### 4.7 进程清理

关闭时自动清理本地 MCP server 子进程树（非 Windows 平台使用 `pgrep` 递归查找子进程并 SIGTERM）。windows 平台跳过子进程清理（L475-497）。

---

## 5. 对 AgentHub 的具体建议

### 5.1 架构借鉴优先级

| 优先级 | 借鉴点 | 理由 |
|--------|--------|------|
| **P0** | LLM Route 四轴分离 (Protocol / Endpoint / Auth / Framing) | 整个系统最精巧的架构决策——DeepSeek/TogetherAI/Cerebras 等 20+ provider 复用同一套 Protocol，新增 provider 只需组合 Endpoint/Auth 差异，无需 fork 300 行协议实现 |
| **P0** | Discriminated Union 错误/状态/事件管理 | LLMErrorReason 10 变体、MCP Status 5 状态、LLMEvent 16 类型——全部用 `Schema.toTaggedUnion()` 实现编译时穷尽检查和运行时类型收紧 |
| **P1** | Plugin Hook 双向修改模式 | `(input, output) => Promise<void>` 统一 19 个生命周期钩子签名，output 对象被 hook 原地修改——比 event emitter 更安全 |
| **P1** | Effect Service + Layer 注入 | agent/session/MCP/plugin 初始化均为纯 Effect，通过 Layer 组合依赖——测试隔离和模块组合天然支持 |
| **P2** | OpenAPI Codegen 驱动 SDK | `openapi.json` → `@hey-api/openapi-ts` → 70+ 类型安全方法——AgentHub 应从 Day 1 采用 OpenAPI-first |
| **P2** | Tool Runtime orchestration loop | 通用的 tool-use 循环——输入验证 → 并发执行 → 结果追加 → 继续——AgentHub 的 agent loop 可复用此算法 |

### 5.2 需要规避的设计

| 风险点 | 说明 | AgentHub 对策 |
|--------|------|--------------|
| **Plugin 双系统** | V1 (`@opencode-ai/plugin`) 和 V2 (`core/plugin.ts`) 两套 plugin 并存，维护成本高 | 从一开始统一 Plugin API |
| **Agent 硬编码** | 内置 agent (build/plan/general/explore 等) 在代码中 hardcode | 配置驱动，agent 定义从 YAML/TOML 读取 |
| **Tool 定义分散** | Tool 定义同时在 V1 plugin hooks 和 V2 `llm/src/tool.ts` 中 | 统一 Tool Registry |

### 5.3 可直接复用参考的模块

| OpenCode 模块 | AgentHub 对应需求 | 复用程度 |
|---------------|------------------|---------|
| `llm/src/route/` (Route + Protocol 四轴分离) | AI Provider 抽象层 | 借鉴架构范式 |
| `llm/src/tool-runtime.ts` (tool orchestration loop) | Agent 工具调用循环 | 借鉴核心算法 |
| `llm/src/schema/errors.ts` (10-variant error model) | 统一错误处理 | 可直接复制 tagged union 模式 |
| `opencode/src/mcp/` (MCP 状态机 + OAuth) | MCP 集成 | 借鉴 5 状态 union + OAuth 流程 |
| `plugin/src/index.ts` (19 hooks + PluginInput) | AgentHub 插件系统 | 借鉴 hook 命名和双向签名 |
| `core/src/plugin.ts` (V2 Effect Service plugin) | AgentHub 插件运行时 | 借鉴 Layer 注入 + immer draft 模式 |

### 5.4 关键发现总结

1. **Effect 是整个架构的骨架**——不是"用了下 Effect"，而是整个运行时（stream/context/layer/deferred/scope）都是 Effect-native。AgentHub 如果采用 TypeScript 栈，需要评估这一深度依赖。

2. **Protocol/Route 分离是最大的复用杠杆**——20+ provider 全共享同一套协议实现（`OpenAIChat.protocol`, `OpenAIResponses.protocol`, `AnthropicMessages.protocol`, `Gemini.protocol`, `BedrockConverse.protocol`），新增 provider 只是 `Endpoint + Auth + Framing` 的组合变化。

3. **MCP 是"一等公民"**——不是简单的 protocol adapter，有完整 OAuth 流程、5 状态 discriminated union、tool 安全转换、`tools/list_changed` 热重载、超时/错误/输出 schema 容错。AgentHub 对 MCP 的支持应达到同等深度。

4. **Tool/Runtime 分离得非常干净**——`packages/llm/src/tool.ts` 定义纯数据 tool（description + codecs + definition），`packages/llm/src/tool-runtime.ts` 负责编排执行。两者通过 `Tools` record 接口连接。AgentHub 的 Agent/Tool 系统应采纳同样的关注点分离。

5. **Repo 结构：22 packages 的 monorepo**——按职责清晰分层，最低层是 `core`（通用工具），中间层 `llm`（协议引擎），上层 `opencode`（应用逻辑），最上层 `desktop`/`web`（呈现）。这种分层对 AgentHub 有直接参考价值。

---

*报告完成：2026-05-21 | 基于 `anomalyco/opencode` depth-1 clone*
