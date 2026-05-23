# OpenCode Source Adoption Map → AgentHub

> 从 OpenCode 源码到 AgentHub Go 实现的桥梁映射。
> 每项: OpenCode file:line → AgentHub file:line → Go interface/struct → P0/P1/P2 优先级。

---

## 1. Plugin/Hook System (19-hook → 6-hook)

### 1.1 Hook 接口总览

| OpenCode Hook (19) | AgentHub Hook (6) | 优先级 | 映射路径 |
|---|---|---|---|
| `event` | -- | P2 | 全局事件监听，AgentHub 当前无等价物 |
| `config` | -- | P2 | 配置变换，由 AgentHub server 初始化时处理 |
| `tool` | -- | P0 | 自定义工具注册，AgentHub 缺少此能力 |
| `auth` | -- | P1 | 自定义认证，AgentHub 靠 CLI 环境处理 |
| `provider` | -- | P1 | 自定义模型 Provider，对标 model_config.go |
| `chat.message` | `PrePrompt` (近似) | P1 | 消息到达 → 修改 prompt |
| `chat.params` | -- | P1 | LLM 参数修改，AgentHub 无中间层 |
| `chat.headers` | -- | P2 | HTTP 头修改，CLI 直调不适用 |
| `permission.ask` | `PermissionRequest` | P0 | 权限门控，已有实现 |
| `command.execute.before` | `PreToolUse` (近似) | P1 | 命令执行前拦截 |
| `tool.execute.before` | `PreToolUse` | P0 | 工具执行前拦截，已有实现 |
| `shell.env` | -- | P1 | Shell 环境注入 |
| `tool.execute.after` | `PostToolUse` | P0 | 工具执行后修改，已有实现 |
| `experimental.chat.messages.transform` | -- | P1 | 消息列表变换 |
| `experimental.chat.system.transform` | -- | P1 | 系统提示变换 |
| `experimental.session.compacting` | -- | P2 | Compact 自定义 |
| `experimental.compaction.autocontinue` | -- | P2 | 自动继续控制 |
| `experimental.text.complete` | -- | P2 | 文本补全 |
| `tool.definition` | -- | P1 | 工具定义修改 |

### 1.2 核心源代码对照

```
OpenCode: reference/opencode/packages/plugin/src/index.ts:74
  export type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>

AgentHub: edge-server/internal/adapters/hooks.go:39
  type AgentHook interface {
    PreToolUse(ctx context.Context, toolName string, input map[string]any) (map[string]any, bool, string)
    PostToolUse(ctx context.Context, toolName string, output string) (modifiedOutput string)
    PermissionRequest(ctx context.Context, toolName string, risk RiskLevel) (decision PermDecision)
    OnError(ctx context.Context, err error) (action ErrorAction)
    PrePrompt(ctx context.Context, prompt string) (modifiedPrompt string)
    PostResponse(ctx context.Context, response string) (modifiedResponse string)
  }
```

**差异分析:**

OpenCode 的 `Plugin` 是异步工厂函数，接收 `PluginInput`（包含 SDK client、project info、directory、worktree、shell 等上下文）返回 `Hooks` 对象。Hook 函数签名统一为 `(input, output) => Promise<void>`，采用 input/output 双参数模式让 plugin 可以读取输入并修改输出。

AgentHub 的 `AgentHook` 是 Go interface，每个方法返回修改后的值（函数式风格）。AgentHub 额外提供了 `HookChain` 中间件模式（hooks.go:60-122），支持链式调用和提前终止：

```
OpenCode: reference/opencode/packages/plugin/src/index.ts:222-333
  19 个 hook 方法直接定义在 Hooks 接口上，每个可选

AgentHub: edge-server/internal/adapters/hooks.go:60-122
  type HookChain []AgentHook
  RunPreToolUse  → 第一个 block=true 终止
  RunPermissionRequest → 第一个非 Allow 终止
  RunOnError → 第一个非 Retry 终止
```

### 1.3 OpenCode V2 Hook 系统 (Effect-TS)

```
OpenCode: reference/opencode/packages/core/src/plugin.ts:49-66
  type Hooks = {
    "provider.update": { input, output: { provider, cancel } }
    "model.update":    { input, output: { model, cancel } }
    "aisdk.language":  { input: { model, sdk, options }, output: { language? } }
    "aisdk.sdk":       { input: { model, package, options }, output: { sdk? } }
  }

AgentHub: 无等价物
  model_config.go 使用静态 map + ResolveModel() 函数，
  没有运行时可拦截的 provider/model 更新机制。
```

**建议:** OpenCode V2 的 Effect-TS hook 系统使用依赖注入 + 触发模式。AgentHub 若需要运行时可扩展的 model/provider 发现，可参考此模式。

### 1.4 Tool 系统对比

```
OpenCode: reference/opencode/packages/plugin/src/tool.ts:45-51
  export function tool<Args extends z.ZodRawShape>(input: {
    description: string
    args: Args               // Zod schema → JSON Schema for LLM
    execute(args, context): Promise<ToolResult>
  })

OpenCode: reference/opencode/packages/llm/src/tool.ts
  Tool 接口有更丰富的类型系统:
  - ToolSchema (Zod/JsonSchema)
  - ToolExecute (execute 函数)
  - ExecutableTool (schema + execute)
  - toDefinitions() → LLM 工具定义格式

AgentHub: 无独立的工具抽象
  工具由 CLI (claude/codex/opencode) 自带，
  AgentHub 不做工具注册/定义修改。
```

**建议 P0:** 在 AgentHub 中增加 `ToolDefinition` 接口，允许插件注册自定义工具。实现路径：
- `edge-server/internal/adapters/tool.go` 新增
- `AgentAdapter` 增加 `RegisterTools()` 方法
- 由 adapter 在 BuildCommand 时注入自定义工具定义

---

## 2. LLM Routing (Protocol/Route → model_config.go)

### 2.1 架构对比

```
OpenCode 四轴路由模型:

  Route.make({
    protocol: Protocol<Body, Frame, Event, State>  // 语义 API 契约
    endpoint: Endpoint<Body>                         // URL 构造
    auth: Auth                                       // 认证策略
    framing: Framing<Frame>                          // 字节流 → 帧
  })
  → Route<Body, Prepared>
  → ModelRef { id, provider, route, baseURL, ... }
  → LLMClient.stream(request)
  → Stream<LLMEvent, LLMError>

AgentHub 直接 CLI 调用模型:

  RunProcessContext.Model → ResolveModel(agentID, model)
  → CLI args: --model xxx
  → CLI stdout 解析 → EventEmitter.Emit()
```

### 2.2 OpenCode Protocol 层 (6 实现)

```
OpenCode: reference/opencode/packages/llm/src/route/protocol.ts:36-63
  interface Protocol<Body, Frame, Event, State> {
    id: ProtocolID
    body: ProtocolBody<Body>      // schema + from(request) → Body
    stream: ProtocolStream<Frame, Event, State>  // 状态机解析
  }

实现:
  reference/opencode/packages/llm/src/protocols/openai-chat.ts     — OpenAI Chat Completions
  reference/opencode/packages/llm/src/protocols/openai-responses.ts — OpenAI Responses API
  reference/opencode/packages/llm/src/protocols/anthropic-messages.ts — Anthropic Messages
  reference/opencode/packages/llm/src/protocols/gemini.ts            — Google Gemini
  reference/opencode/packages/llm/src/protocols/bedrock-converse.ts  — AWS Bedrock Converse
  reference/opencode/packages/llm/src/protocols/openai-compatible-chat.ts — 兼容实现

AgentHub: 无 Protocol 抽象
  模型路由完全是静态 map + 字符串拼接:
  edge-server/internal/adapters/model_config.go:5-24
    var ModelAliases = map[string]map[string]string{...}
```

**建议 P1:** 引入 `ModelProtocol` 接口以支持直接 API 调用（非 CLI）：

```go
// edge-server/internal/adapters/protocol.go (新文件)
type ModelProtocol interface {
    ID() string
    BuildRequest(ctx context.Context, req LLMRequest) (body []byte, endpoint string, headers map[string]string, err error)
    ParseStream(ctx context.Context, stream io.Reader, emitter EventEmitter) error
}
```

### 2.3 OpenCode Route 层 (可组合部署)

```
OpenCode: reference/opencode/packages/llm/src/route/client.ts:358-398
  Route.make({
    id: "openai-gpt-5",
    provider: "openai",
    protocol: OpenAIChat.protocol,   // 可替换
    endpoint: Endpoint.path("/chat/completions"),
    auth: Auth.bearer(Auth.config("OPENAI_API_KEY")),
    framing: Framing.sse,
    defaults: { baseURL: "https://api.openai.com/v1", ... }
  })

  关键特性:
  - Route.with(patch) → 派生新路由 (不改原路由)
  - Route.model(input) → 生成 ModelRef (绑定 provider/route/baseURL)
  - 全局 routeRegistry (client.ts:64) → 运行时可查找

AgentHub: 无 Route 抽象
  每个 adapter 的 BuildCommand 硬编码 CLI 参数:
  edge-server/internal/adapters/claude_code.go:54-119
  edge-server/internal/adapters/codex.go:44-87
  edge-server/internal/adapters/opencode.go:44-99
```

**建议 P1:** 将模型路由信息从 BuildCommand 中提取为 `ModelRoute` 结构：

```go
// 对标 OpenCode RouteID + ModelRef
type ModelRoute struct {
    ID        string            // "claude-code/sonnet"
    Provider  string            // "anthropic"
    ModelID   string            // "claude-sonnet-4-6"
    BaseURL   string            // API endpoint (若绕过 CLI)
    AuthKey   string            // 认证密钥引用
    Defaults  ModelDefaults     // 对标 RouteDefaults
}
```

### 2.4 OpenCode Auth 层

```
OpenCode: reference/opencode/packages/llm/src/route/auth.ts:32-37
  interface Auth {
    apply: (input: AuthInput) => Effect<Headers, AuthError>
    andThen: (that: Auth) => Auth    // 链式组合
    orElse: (that: Auth) => Auth     // 降级策略
  }

  interface Credential {
    load: Effect<Redacted<string>, CredentialError>
    bearer: () => Auth
    header: (name: string) => Auth
  }

  构造方式: Auth.value(secret) | Auth.config(envName) | Auth.bearer() | Auth.none
  错误类型: MissingCredentialError, AuthenticationReason (missing/invalid/expired/...)

AgentHub: 无 Auth 抽象
  CLI 从环境变量读取 API key，AgentHub 不参与认证。
  edge-server/internal/adapters/claude_code.go:119 env=nil (靠 CLI 自带)
```

**建议 P2:** 若 AgentHub 需要直接调用 LLM API (绕过 CLI)，需引入 Auth 抽象。当前 CLI 模式不需要。

### 2.5 OpenCode Endpoint/Framing 层

```
OpenCode Endpoint: reference/opencode/packages/llm/src/route/endpoint.ts:22-24
  interface Endpoint<Body> {
    path: string | ((input: EndpointInput<Body>) => string)
  }
  职责: 仅管理路径，host 在 ModelRef.baseURL

OpenCode Framing: reference/opencode/packages/llm/src/route/framing.ts:19-22
  interface Framing<Frame> {
    id: string
    frame: (bytes: Stream<Uint8Array>) => Stream<Frame>
  }
  实现: Framing.sse (默认), 可扩展 AWS event stream 等

AgentHub: 无等价抽象
  Framing 职责被分散在各 adapter 的 ParseStream 中:
  - ClaudeCode: NDJSON 行解析
  - OpenCode: JSON 行解析 (bufio.Scanner)
  - Codex: JSONL 解析 + fallback 纯文本
```

### 2.6 OpenCode LLMEvent 统一事件流

```
OpenCode: reference/opencode/packages/llm/src/schema/events.ts:238-287
  17 种标准化事件:
  step-start, text-start, text-delta, text-end,
  reasoning-start, reasoning-delta, reasoning-end,
  tool-input-start, tool-input-delta, tool-input-end,
  tool-call, tool-result, tool-error,
  step-finish, finish, provider-error

AgentHub: edge-server/internal/adapters/adapter.go:73-102
  20 种 BusEvent 事件:
  run.agent.text_delta, run.agent.text_block, run.agent.thinking,
  run.agent.tool_call, run.agent.tool_result, run.agent.file_change,
  run.agent.session_init, run.agent.result, run.agent.compact_boundary,
  run.agent.status_change, run.agent.api_retry, run.agent.task_started,
  run.agent.task_dispatched, run.agent.task_progress, ...等
```

**对照表:**

| OpenCode LLMEvent | AgentHub BusEvent | 覆盖 |
|---|---|---|
| `text-start` | `text_block` (批量) | 部分 — AgentHub 不区分 start/delta/end |
| `text-delta` | `text_delta` | 有 |
| `text-end` | -- | 无 |
| `reasoning-start/delta/end` | `thinking` | 部分 — 无生命周期边界 |
| `tool-call` | `tool_call` | 有 |
| `tool-result` | `tool_result` | 有 |
| `tool-error` | -- (混在 tool_result 中) | 无独立事件 |
| `step-start/finish` | `session_state_changed` | 部分 — 无步骤编号 |
| `finish` | `result` | 有 |
| `provider-error` | `api_retry` | 部分 — 无结构化错误 |
| -- | `permission_requested/decided` | AgentHub 特有 |
| -- | `task_started/progress/notification` | AgentHub 特有 |
| -- | `file_change` | AgentHub 特有 |

### 2.7 OpenCode ModelRef vs AgentHub ResolveModel

```
OpenCode: reference/opencode/packages/llm/src/schema/options.ts:138-169
  class ModelRef {
    id: ModelID              // 模型 ID (branded string)
    provider: ProviderID     // Provider ID (branded string)
    route: RouteID           // Route ID (branded string)
    baseURL: string          // API 端点
    apiKey?: string          // 便捷 API key
    auth?: Auth              // 认证策略 (opaque)
    headers?: Record         // 额外 HTTP 头
    queryParams?: Record     // URL 查询参数
    limits: ModelLimits      // { context, output }
    generation?: GenerationOptions  // { maxTokens, temperature, topP, topK, ... }
    providerOptions?: Record // Provider 特有选项
    http?: HttpOptions       // { body, headers, query }
    native?: Record          // Provider 私有选项
  }

AgentHub: edge-server/internal/adapters/model_config.go:60-70
  func ResolveModel(agentID, model string) string {
    // 仅做字符串替换，无结构化模型信息
  }
  func ResolveModelWithDefault(agentID, model string) string {
    // 增加默认值回退
  }
```

**建议 P0:** 引入 `ModelSpec` 结构体替代纯字符串模型标识：

```go
// edge-server/internal/adapters/model_spec.go (新文件)
type ModelSpec struct {
    ModelID      string            // "claude-sonnet-4-6"
    ProviderID   string            // "anthropic"
    RouteID      string            // "anthropic-messages"
    BaseURL      string            // API endpoint (optional, for direct API)
    MaxTokens    int               // generation config
    Temperature  float64
    TopP         float64
    ContextLimit int               // model limits
    OutputLimit  int
    Native       map[string]any    // provider-specific
}
```

### 2.8 OpenCode Error 分类系统

```
OpenCode: reference/opencode/packages/llm/src/schema/errors.ts:31-168
  10 种 LLMErrorReason:
  InvalidRequestReason, NoRouteReason, AuthenticationReason,
  RateLimitReason (retryable), QuotaExceededReason,
  ContentPolicyReason, ProviderInternalReason (retryable),
  TransportReason, InvalidProviderOutputReason,
  UnknownProviderReason

  每个 error 带: retryable, retryAfterMs, http context, providerMetadata

AgentHub: edge-server/internal/adapters/hooks.go:28-35
  3 种 ErrorAction: retry / abort / fallback
  无结构化错误分类
```

**建议 P2:** 增加结构化 LLM 错误类型，对标 OpenCode 的 ErrorReason。

---

## 3. 架构决策总结

### 3.1 已对齐 (无需改动)

| 能力 | OpenCode | AgentHub |
|---|---|---|
| 权限门控 | `permission.ask` hook | `PermissionRequest` + `SecurityHook` |
| 工具执行拦截 | `tool.execute.before/after` | `PreToolUse` + `PostToolUse` |
| 事件总线 | Effect Stream | EventEmitter interface |
| 多 CLI 适配 | 多 Provider (静态) | 多 AgentAdapter (Registry) |
| 流式解析 | Protocol.stream 状态机 | NDJSON/JSONL Scanner |
| 子 Agent 派发 | task_start/finish events | `task_started/progress/notification` |

### 3.2 P0 优先级 (本周)

1. **ModelSpec 结构体** — 替代 model_config.go 的纯字符串映射
   - `model_config.go:60` → 新增 `model_spec.go`
   - 对标 OpenCode `ModelRef` (`schema/options.ts:138`)

2. **ToolDefinition 接口** — 支持自定义工具
   - 对标 OpenCode `tool()` 函数 (`plugin/src/tool.ts:45`)
   - 新增 `edge-server/internal/adapters/tool.go`

3. **chat.message / chat.params hook** — 消息到达时修改 prompt 和参数
   - 对标 OpenCode `Hooks["chat.message"]` 和 `Hooks["chat.params"]` (`plugin/src/index.ts:233-255`)
   - 扩展 `AgentHook` 接口 (`hooks.go:39`)

### 3.3 P1 优先级 (本月)

4. **ModelProtocol 接口** — 直接 API 调用能力（绕过 CLI）
   - 对标 OpenCode `Protocol` (`route/protocol.ts:36`)
   - 新增 `edge-server/internal/adapters/protocol.go`

5. **ModelRoute 结构体** — 从 BuildCommand 提取路由信息
   - 对标 OpenCode `Route` (`route/client.ts:41`)
   - 重构 `claude_code.go:54`, `codex.go:44`, `opencode.go:44`

6. **shell.env hook** — Shell 环境变量注入
   - 对标 OpenCode `Hooks["shell.env"]` (`plugin/src/index.ts:269`)

7. **system.transform hook** — 系统提示变换
   - 对标 OpenCode `Hooks["experimental.chat.system.transform"]` (`plugin/src/index.ts:290`)

8. **tool.definition hook** — 工具定义修改
   - 对标 OpenCode `Hooks["tool.definition"]` (`plugin/src/index.ts:332`)

### 3.4 P2 优先级 (下月)

9. **结构化 LLM 错误** — 对标 OpenCode 10 ErrorReason
10. **FinishingReason 标准化** — stop/length/tool-calls/content-filter/error
11. **Auth 抽象** — 对标 OpenCode Credential/Auth 链
12. **Framework/Protocol 注册机制** — 对标 OpenCode 的全局 routeRegistry
13. **config hook** — 配置变换
14. **Compaction 自定义** — 对标 compacting/autocontinue hooks

---

## 4. 文件映射速查表

| OpenCode 源文件 | AgentHub 目标文件 | 用途 |
|---|---|---|
| `packages/plugin/src/index.ts:74-333` | `internal/adapters/hooks.go:39-57` | Hook 接口定义 |
| `packages/plugin/src/tool.ts:45-51` | `internal/adapters/tool.go` (新) | 自定义工具注册 |
| `packages/llm/src/route/protocol.ts:36-63` | `internal/adapters/protocol.go` (新) | Model Protocol 抽象 |
| `packages/llm/src/route/client.ts:41-56` | `internal/adapters/model_spec.go` (新) | Model Spec 结构体 |
| `packages/llm/src/route/client.ts:358-398` | `internal/adapters/registry.go:8-13` | 路由注册 |
| `packages/llm/src/route/auth.ts:32-37` | (P2, 当前不需要) | Auth 抽象 |
| `packages/llm/src/route/endpoint.ts:22-24` | (P2, CLI 模式不需要) | Endpoint 抽象 |
| `packages/llm/src/route/framing.ts:19-22` | (P2, CLI 模式不需要) | Framing 抽象 |
| `packages/llm/src/schema/events.ts:238-287` | `internal/adapters/adapter.go:73-102` | Event 事件定义 |
| `packages/llm/src/schema/errors.ts:31-168` | `internal/adapters/hooks.go:28-35` | Error 分类 |
| `packages/llm/src/schema/options.ts:138-169` | `internal/adapters/model_config.go:60-70` | Model 配置 |
| `packages/core/src/plugin.ts:49-66` | (暂无) | V2 Effect-TS Hook 系统 |
| `packages/core/src/plugin/boot.ts:24-65` | `cmd/agenthub-edge/main.go` | 启动注册 |
| `packages/llm/src/schema/ids.ts:3-43` | `internal/adapters/adapter.go:52-57` | ID 类型定义 |
| `packages/llm/src/schema/options.ts:75-123` | (P1) | GenerationOptions |
| `packages/plugin/src/shell.ts:10-43` | (P1) | Shell 环境接口 |
