# Claude Agent SDK GA -- AgentHub Architecture Impact Analysis

> Generated: 2026-05-21
> Source: web-research-claude-agent-sdk-2026.md
> Context: cross-analysis-adapters.md, design-protocol.md, design-adapter-sdk.md

---

## Executive Summary

Claude Agent SDK 已 GA（Python v0.1.56 + TypeScript）。这标志着 Claude Code 从"CLI headless subprocess"升级为"SDK library"，对 AgentHub 架构产生五个维度的影响。**核心结论：AgentHub 应新增 Python Sidecar Adapter 模式作为推荐路径，同时保留 CLI headless 作为降级路径，两者通过 `use_sdk: bool` 开关切换，不破坏现有设计。**

---

## 1. 五个关键变化及影响评估

### 1.1 从 CLI headless 到 SDK

**现状**（cross-analysis-adapters.md Section 3.1）：
```
Runner -> exec.CommandContext("claude", "-p", prompt, "--output-format", "stream-json", "--verbose")
       -> stdout NDJSON -> Go parser -> AgentEvent channel
```

**SDK 路径**：
```
Runner -> subprocess("python", "agenthub_claude_bridge.py")
       -> claude_agent_sdk.query(prompt, options)
       -> AsyncIterator[Message] -> JSON-RPC stdout -> Go parser -> AgentEvent channel
```

**差异**：

| 维度 | CLI headless | Agent SDK (Python sidecar) |
|------|-------------|---------------------------|
| 进程模型 | 直接 spawn `claude` | spawn Python script，脚本内部调 SDK |
| 输出格式 | NDJSON（13种消息类型） | Python `Message` 对象序列化为 JSON-RPC |
| 参数传递 | CLI args (`-p`, `--model`, `--max-turns`, ...) | `ClaudeAgentOptions` dict |
| 生命周期 | 进程 exit = 结束 | SDK client context manager 管理 |
| 多轮对话 | 每轮新进程 | `ClaudeSDKClient` 保活多轮 |
| 事件粒度 | NDJSON 每种消息类型独立行 | SDK Message 迭代器统一接口 |

**建议**：ClaudeCodeAdapter 增加 `UseSDK` 选项，两种模式共存：

```go
type ClaudeCodeConfig struct {
    AdapterConfig

    // --- CLI mode (existing) ---
    Verbose                bool   // --verbose, always true for AgentHub
    HeadlessPermissionMode string

    // --- SDK mode (new) ---
    UseSDK               bool   // true = use Python sidecar, false = spawn claude CLI
    PythonBinary         string // default "python" or "python3"
    BridgeScriptPath     string // path to agenthub_claude_bridge.py
    SDKOptions           *ClaudeAgentSDKOptions // ClaudeAgentOptions equivalent

    // --- Common ---
    ForceThinkingEnabled bool
}
```

`ClaudeAgentSDKOptions` 映射 `ClaudeAgentOptions` 的 key fields：

```go
type ClaudeAgentSDKOptions struct {
    Model            string              `json:"model,omitempty"`
    SystemPrompt     string              `json:"system_prompt,omitempty"`
    CWD              string              `json:"cwd,omitempty"`
    MaxTurns         int                 `json:"max_turns,omitempty"`
    PermissionMode   string              `json:"permission_mode,omitempty"`
    AllowedTools     []string            `json:"allowed_tools,omitempty"`
    DisallowedTools  []string            `json:"disallowed_tools,omitempty"`
    MCPServers       map[string]any      `json:"mcp_servers,omitempty"`
    Hooks            map[string][]any    `json:"hooks,omitempty"`
    Agents           map[string]any      `json:"agents,omitempty"`
    Resume           string              `json:"resume,omitempty"`
    OutputFormat     *OutputFormatConfig `json:"output_format,omitempty"`
    SettingSources   []string            `json:"setting_sources,omitempty"`
    EnableFileCheckpointing bool         `json:"enable_file_checkpointing,omitempty"`
    CanUseTool       bool                `json:"can_use_tool,omitempty"` // flag: use callback
}
```

两种方式并存策略：
- **优先 SDK**：Python sidecar 提供更丰富的功能（agents、hooks、resume、output_format）
- **保留 CLI**：作为降级路径，适用于无 Python 环境或 SDK 尚未覆盖的场景
- **切换**：`StartRequest.ProviderExtras["use_sdk"]` 或 `ClaudeCodeConfig.UseSDK`

### 1.2 `agents` 字段：Subagent 管理的两层分工

**SDK 的 `agents` 字段**：
```python
options=ClaudeAgentOptions(
    agents={
        "reviewer": AgentDefinition(
            description="Reviews code changes",
            system_prompt="You are a code reviewer...",
            tools=["Read", "Grep", "Glob"],
        ),
        "greeting-responder": AgentDefinition(
            description="Responds to greetings with a friendly joke",
            system_prompt="...",
        ),
    },
)
```

这是 Claude Code **内部的** subagent 定义，Claude 通过 `Task` tool 调用。生命周期在同一个 Claude Code session 内。

**AgentHub 的 Orchestrator `@agent` 调度**：
- 跨 provider 的顶层调度（可能同时调度 Claude + Codex + OpenCode）
- 每个 agent 有独立的 Runner、Session、权限策略
- 防循环、深度限制、资源限流

**两层分工**：

```
AgentHub Orchestrator (顶层调度)
  |-- 决策：将任务分配给哪些 provider agent
  |-- 治理：权限策略、防循环、资源配额
  |-- 跨 provider：Claude --> Codex / OpenCode 委派
  |
  v
Claude Code SDK (执行层)
  |-- agents["reviewer"]：SDK 内 subagent
  |-- agents["greeting-responder"]：SDK 内 subagent
  |-- 这些 subagent 在同一个 CC session 内，共享上下文
```

**建议**：
- AgentHub 负责**跨 provider 的顶层调度**（Orchestrator DispatchStrategy）
- SDK `agents` 负责**同一 provider 内的执行层优化**（Claude 内部 delegation）
- AgentHub 通过 `ClaudeAgentSDKOptions.Agents` 将 subagent 定义下发给 SDK
- AgentHub 的 `SubAgentDef` 映射到 SDK 的 `AgentDefinition`：

```go
func SubAgentDefToAgentDefinition(def SubAgentDef) AgentDefinition {
    return AgentDefinition{
        Name:         def.Name,
        Description:  def.Description,
        SystemPrompt: def.SystemPrompt,
        Tools:        def.Tools,
        Mode:         def.Mode, // "agent", "plan", "reviewer"
    }
}
```

### 1.3 `hooks` 字段：审批分层的两层配合

**SDK 的 `hooks` 字段**（工具级拦截）：
```python
hooks={
    "PreToolUse": [
        {
            "matcher": "Bash",
            "hooks": [lambda input, tool_use_id, context: {
                "decision": "ask",
            }],
        },
    ],
}
```

这是 SDK 内部的工具级拦截 -- 在执行前阻塞并决定 allow/deny/ask。

**AgentHub 的 PolicyEngine**（策略级决策）：
- 多层规则优先级（9 source priority）
- Pattern matching（`sudo`、`rm -rf`、`curl | sh`）
- Risk-based auto-decision
- 跨 provider 统一策略

**两层配合**：

```
AgentHub PolicyEngine (策略级 -- "这个操作在项目策略里是否允许？")
  |
  |-- PolicyRule 匹配（优先级、scope、pattern）
  |-- 高危操作自动拦截（curl | sh, rm -rf）
  |-- 跨 session 记忆（acceptForSession / acceptForThread）
  |
  v
SDK PreToolUse Hook (工具级 -- "在 SDK 层阻塞执行并等待决策")
  |-- matcher 匹配具体工具
  |-- 调用 AgentHub PermissionBroker callback
  |-- 返回 allow/deny/ask 决策
```

**建议**：
- SDK PreToolUse hook 作为**传输机制**（intercept & block）
- AgentHub PolicyEngine 作为**决策引擎**（evaluate & decide）
- AgentHub 通过 `PermissionBroker.SetPermissionCallback` 注册回调
- Python bridge 脚本在 PreToolUse hook 内通过 JSON-RPC 回调 Go runner 的 PermissionBroker

实现流程：
```
1. Go runner 启动 Python bridge，传递 sessionID + JSON-RPC pipe
2. bridge 脚本设置 PreToolUse hook
3. 当 SDK 触发 PreToolUse hook：
   a. bridge 通过 JSON-RPC 发送 ToolPermissionRequest 到 Go
   b. Go PolicyEngine.Evaluate() -> PermissionDecision
   c. bridge 将决策返回给 SDK hook
```

### 1.4 `resume` 字段：Session 续传升级

**现状**（cross-analysis-adapters.md Section 3.1，未明写但有 Workaround 8 提及）：
- 需要从 `~/.claude/sessions/<id>.jsonl` 读取历史并重放
- 或通过 CLI `--resume <sessionId>` + `--continue` 标志
- 恢复逻辑复杂，容易丢失上下文

**SDK 方式**：
```python
options=ClaudeAgentOptions(
    resume="session-123",  # 字符串 session ID
)
```
SDK 内部处理所有续传逻辑 -- 上下文恢复、消息重放、session 状态。

**建议**：
- SDK 模式下，Adapter `Resume()` 直接通过 `ClaudeAgentSDKOptions.Resume` 传递 session ID
- 不再需要手动读取 JSONL 文件
- CLI 降级模式下，保留现有的 `--resume` + JSONL 方案
- AgentHub `StartRequest.SessionID` 映射到 SDK 的 `resume` 字段

```go
func (a *ClaudeCodeAdapter) Resume(ctx context.Context, sessionID string) (*AgentSession, error) {
    if a.config.UseSDK {
        // SDK mode: pass session ID directly
        req := StartRequest{
            SessionID: sessionID,
            ProviderExtras: map[string]any{
                "use_sdk": true,
                "resume":  sessionID, // maps to ClaudeAgentOptions.resume
            },
        }
        return a.Start(ctx, req)
    }
    // CLI mode: existing logic with --resume flag
    // ...
}
```

### 1.5 `output_format` 字段：结构化输出替代 NDJSON 后处理

**现状**（cross-analysis-adapters.md Section 3.1 Workaround 2, 7, 8）：
- NDJSON 流需要 Go parser 逐行解析
- 需要处理 stdout guard interference
- 需要处理 streaming tool execution 导致的乱序事件
- Artifact 解析需要后处理 `result.content` 文本

**SDK 方式**：
```python
options=ClaudeAgentOptions(
    output_format={
        "type": "json_schema",
        "schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "files_changed": {"type": "array", "items": {"type": "string"}},
                "diff": {"type": "string"},
            },
            "required": ["summary", "files_changed", "diff"],
        },
    },
)
```
SDK 保证输出符合 JSON Schema，AgentHub 直接反序列化到 `Artifact`。

**建议**：
- AgentHub Artifact 解析不再需要解析 NDJSON 流的 final result content
- 通过 `StartRequest.ProviderExtras["output_format"]` 传递 JSON Schema
- 适用于：DiffArtifact、JSON Artifact、Code Artifact
- 注意：不是所有场景都适合结构化输出（自由对话不适合），按需使用

---

## 2. 文件更新建议

### 2.1 cross-analysis-adapters.md -- Section 3.1 扩展

在现有 8 个 Workaround 之后，新增 SDK 相关的 5 项：

```
### 3.1 Claude Code Adapter (continued)

**Workaround 9 -- SDK sidecar process management**:
Python bridge script must be managed as a child process with its own lifecycle.
The bridge starts the SDK client, enters an async event loop, and communicates
via JSON-RPC over stdin/stdout. Go adapter must:

- Spawn `python agenthub_claude_bridge.py` with JSON-RPC protocol
- Handle bridge crash/restart independently of the Go adapter
- Implement ready protocol: bridge emits `{"ready":true}` on stdout before accepting requests
- Two-phase shutdown: send `{"method":"shutdown"}` via JSON-RPC, SIGTERM (5s), SIGKILL

**Workaround 10 -- SDK mode event mapping**:
SDK's Python Message objects have a different structure from NDJSON.
The normalization pipeline shifts from Go-side parser to Python-side bridge:

- Bridge converts SDK `Message` -> unified JSON-RPC event format
- Go adapter receives already-normalized events (reduced Go-side complexity)
- Bridge handles `tool_use`, `tool_result`, `assistant_text`, `reasoning` mapping
- Go adapter only needs to translate JSON-RPC events to `AgentEvent` channel

**Workaround 11 -- SDK session state lives in Python process**:
Unlike CLI mode where each turn is a fresh process, SDK mode keeps the
`ClaudeSDKClient` alive across turns. Session state (context, history) is in
the Python process memory. If the bridge process restarts, all sessions are lost.
The adapter should:

- Track which sessions are active in each bridge process
- Re-establish sessions on bridge restart (using `resume` if available)
- Route to the correct bridge process by session ID

**Workaround 12 -- SDK hooks auto-approval trap**:
When `permission_mode="bypassPermissions"` is set on SDK options, it overrides
PreToolUse hooks. AgentHub's approval system cannot intercept tools. Use
`permission_mode="default"` and rely entirely on the PreToolUse hook for
AgentHub approval integration.

**Workaround 13 -- SDK MCP server configuration format differs from CLI**:
SDK's `mcp_servers` dict format differs from `.mcp.json` and CLI `--mcp-config`.
The bridge script must translate AgentHub's `MCPConfig` (Go struct) to SDK's
`mcp_servers` format. Example mapping:

CLI .mcp.json:              SDK mcp_servers dict:
{                           {
  "mcpServers": {             "github": {
    "github": {                 "type": "stdio",
      "command": "npx",         "command": "npx",
      "args": [...]             "args": [...]
    }                         }
  }                         }
}                           }
```

### 2.2 design-protocol.md -- ClaudeCodeConfig 更新

在 `ClaudeCodeConfig` struct（design-protocol.md 第 1169 行）增加 `UseSDK` 及 SDK 相关字段：

```go
// ClaudeCodeConfig is the CC-specific adapter configuration.
// 参考 cross-analysis-adapters.md Section 3.1
type ClaudeCodeConfig struct {
    AdapterConfig

    // --- CLI mode (existing) ---
    // 参考 Section 3.1 Workaround 3: --verbose mandatory for full events
    Verbose bool `json:"verbose"` // ALWAYS true for AgentHub

    // 参考 Section 3.1 Workaround 5: permission mode for headless
    HeadlessPermissionMode string `json:"headlessPermissionMode"`

    // --- SDK mode (new) ---
    // 参考 impact-analysis-claude-sdk-ga.md Section 1.1
    UseSDK           bool   `json:"useSdk"`           // true = Python sidecar, false = CLI subprocess
    PythonBinary     string `json:"pythonBinary"`     // default "python" or "python3"
    BridgeScriptPath string `json:"bridgeScriptPath"` // path to agenthub_claude_bridge.py

    // SDK options passed through to ClaudeAgentOptions
    // 参考 web-research-claude-agent-sdk-2026.md Section 2: ClaudeAgentOptions 完整字段
    SDKOptions *SDKOptions `json:"sdkOptions,omitempty"`

    // --- Common ---
    // 参考 Section 3.1 Workaround 6: thinking visibility requires Type=enabled
    ForceThinkingEnabled bool `json:"forceThinkingEnabled"`
}

// SDKOptions mirrors ClaudeAgentOptions fields relevant to AgentHub.
// 参考 web-research-claude-agent-sdk-2026.md Section 2
type SDKOptions struct {
    Model            string              `json:"model,omitempty"`
    SystemPrompt     string              `json:"systemPrompt,omitempty"`
    MaxTurns         int                 `json:"maxTurns,omitempty"`
    PermissionMode   string              `json:"permissionMode,omitempty"` // 'default'/'acceptEdits'/'bypassPermissions'/'plan'
    AllowedTools     []string            `json:"allowedTools,omitempty"`
    DisallowedTools  []string            `json:"disallowedTools,omitempty"`
    MCPServers       map[string]any      `json:"mcpServers,omitempty"`
    Hooks            map[string][]any    `json:"hooks,omitempty"`
    Agents           map[string]any      `json:"agents,omitempty"`
    SettingSources   []string            `json:"settingSources,omitempty"`
    EnableFileCheckpointing bool         `json:"enableFileCheckpointing,omitempty"`

    // 参考 impact-analysis-claude-sdk-ga.md Section 1.5
    OutputFormat     *OutputFormatConfig `json:"outputFormat,omitempty"`
}

// OutputFormatConfig mirrors SDK output_format field.
// 参考 web-research-claude-agent-sdk-2026.md Section 2
// 参考 impact-analysis-claude-sdk-ga.md Section 1.5
type OutputFormatConfig struct {
    Type   string         `json:"type"`   // "json_schema"
    Schema map[string]any `json:"schema"` // JSON Schema
}
```

同时在 `StartRequest.ProviderExtras` 文档注释中增加 SDK 使用指引：

```
// Provider-specific extras (opaque to AgentHub core)
// Claude Code SDK 模式下可传递：
//   "use_sdk": true
//   "sdk_options": { "output_format": { "type": "json_schema", "schema": {...} } }
// 参考 impact-analysis-claude-sdk-ga.md
ProviderExtras map[string]any `json:"providerExtras,omitempty"`
```

### 2.3 design-adapter-sdk.md -- 新增 "Python Sidecar Adapter" Section

在 design-adapter-sdk.md 末尾（Appendix C 之后）新增 Section 6：

```
## 6. Python Sidecar Adapter Pattern (New)

> Reference: impact-analysis-claude-sdk-ga.md
> This section describes a new transport model for adapters that wrap
> Python (or other-language) SDKs rather than CLI binaries.

### 6.1 When to Use Sidecar

| Transport | When to Use |
|-----------|-------------|
| **Subprocess (CLI)** | Agent has a headless CLI binary |
| **HTTP + SSE** | Agent exposes REST API |
| **Python Sidecar (new)** | Agent provides a Python/TS SDK with richer API than CLI |
| **WebSocket** | Agent uses persistent bidirectional connection |

Python Sidecar is specifically for Claude Agent SDK, but the pattern
generalizes to any agent that offers an SDK with more features than
its CLI mode.

### 6.2 Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    AgentHub Runner (Go)                   │
│                                                           │
│  ┌──────────────────────┐                                │
│  │  ClaudeCodeAdapter   │                                │
│  │                      │                                │
│  │  UseSDK: true  ──────┼──> spawn python bridge         │
│  │  UseSDK: false ──────┼──> spawn claude CLI            │
│  │                      │                                │
│  └──────────────────────┘                                │
│           │                                               │
│           │ JSON-RPC over stdin/stdout                    │
│           v                                               │
│  ┌──────────────────────────────────────┐                │
│  │  agenthub_claude_bridge.py           │                │
│  │                                       │                │
│  │  import claude_agent_sdk              │                │
│  │                                       │                │
│  │  loop:                                │                │
│  │    read JSON-RPC request from stdin   │                │
│  │    dispatch to query() or ClaudeSDKClient │            │
│  │    write JSON-RPC response to stdout  │                │
│  └──────────────────────────────────────┘                │
│           │                                               │
│           │ claude_agent_sdk API calls                    │
│           v                                               │
│  ┌──────────────────────────────────────┐                │
│  │  Claude Agent SDK (Python)           │                │
│  │  query(prompt, options)              │                │
│  └──────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────┘
```

### 6.3 JSON-RPC Protocol

The bridge communicates with Go via a simple JSON-RPC 2.0 protocol
over stdin/stdout. Each message is a single JSON line:

**Request (Go -> Python)**:
```json
{"id":1,"method":"start","params":{"prompt":"Fix bug","options":{...}}}
{"id":2,"method":"send","params":{"session_id":"s1","prompt":"Continue"}}
{"id":3,"method":"cancel","params":{"session_id":"s1"}}
{"id":4,"method":"shutdown","params":{}}
```

**Response (Python -> Go)**:
```json
{"id":1,"result":{"session_id":"s1","status":"running"}}
{"id":null,"method":"event","params":{"session_id":"s1","event":{...}}}
```

**Event types emitted by bridge**:
```json
{"id":null,"method":"event","params":{"session_id":"s1","event":{"type":"system_init","payload":{...}}}}
{"id":null,"method":"event","params":{"session_id":"s1","event":{"type":"assistant_text","payload":{"content":"...","phase":"delta"}}}}
{"id":null,"method":"event","params":{"session_id":"s1","event":{"type":"tool_call","payload":{...}}}}
{"id":null,"method":"event","params":{"session_id":"s1","event":{"type":"result","payload":{...}}}}
{"id":null,"method":"event","params":{"session_id":"s1","event":{"type":"approval_request","payload":{...}}}}
```

### 6.4 Bridge Lifecycle

```python
# agenthub_claude_bridge.py (skeleton)
import sys, json, asyncio
from claude_agent_sdk import query, ClaudeAgentOptions, ClaudeSDKClient

async def main():
    # Ready signal
    print(json.dumps({"ready": True}), flush=True)

    sessions = {}  # session_id -> ClaudeSDKClient

    for line in sys.stdin:
        request = json.loads(line)
        method = request.get("method")
        req_id = request.get("id")

        if method == "start":
            options = ClaudeAgentOptions(**request["params"]["options"])
            session_id = request["params"].get("session_id") or generate_id()

            if options.resume:
                client = await ClaudeSDKClient.resume(options.resume)
            else:
                client = ClaudeSDKClient(options=options)

            sessions[session_id] = client

            # Send system_init
            send_event(session_id, "system_init", {...})
            print_response(req_id, {"session_id": session_id, "status": "running"})

            # Stream events
            await client.query(request["params"]["prompt"])
            async for msg in client.receive_response():
                event = normalize_sdk_message(msg)
                send_event(session_id, event.type, event.payload)

            send_event(session_id, "result", {...})

        elif method == "cancel":
            session = sessions.get(request["params"]["session_id"])
            if session:
                await session.interrupt()

        elif method == "shutdown":
            for s in sessions.values():
                await s.close()
            break

asyncio.run(main())
```

### 6.5 Go Adapter Implementation

```go
func (a *ClaudeCodeAdapter) Start(ctx context.Context, req StartRequest) (*AgentSession, error) {
    if a.config.UseSDK {
        return a.startSDK(ctx, req)
    }
    return a.startCLI(ctx, req)
}

func (a *ClaudeCodeAdapter) startSDK(ctx context.Context, req StartRequest) (*AgentSession, error) {
    bridge := exec.CommandContext(ctx, a.config.PythonBinary, a.config.BridgeScriptPath)
    stdin, _ := bridge.StdinPipe()
    stdout, _ := bridge.StdoutPipe()
    bridge.Start()

    // Read ready signal
    scanner := bufio.NewScanner(stdout)
    if !scanner.Scan() {
        return nil, fmt.Errorf("bridge failed to send ready signal")
    }
    var ready struct{ Ready bool }
    json.Unmarshal(scanner.Bytes(), &ready)
    if !ready.Ready {
        return nil, fmt.Errorf("bridge not ready")
    }

    // Build SDK options from StartRequest
    sdkOpts := buildSDKOptions(req)

    // Send start request via JSON-RPC
    rpcReq := jsonrpcRequest{
        ID:     1,
        Method: "start",
        Params: map[string]any{
            "prompt":     req.Prompt,
            "options":    sdkOpts,
            "session_id": req.SessionID,
        },
    }
    json.NewEncoder(stdin).Encode(rpcReq)

    // Read response
    scanner.Scan()
    var rpcResp jsonrpcResponse
    json.Unmarshal(scanner.Bytes(), &rpcResp)

    session := &AgentSession{
        ID:     rpcResp.Result.SessionID,
        Status: StatusRunning,
    }
    return session, nil
}
```

### 6.6 Sidecar Pattern Generalization

This pattern is not Claude-specific. Any Agent SDK that:

1. Has a Python or Node.js SDK with richer API than CLI
2. The SDK supports streaming events
3. The SDK can be driven programmatically (not just TUI)

...can use the same sidecar pattern. The JSON-RPC protocol is the
stabilizing interface between Go runner and language-specific bridge.

Future candidates: Codex SDK (if released), OpenCode SDK, Gemini CLI SDK.

### 6.7 Checklist for Building a Sidecar Adapter

- [ ] Choose bridge language (Python for Claude SDK, Node for TypeScript SDK)
- [ ] Define JSON-RPC methods: `start`, `send`, `cancel`, `shutdown`
- [ ] Implement ready protocol: bridge emits `{"ready":true}` on stdout
- [ ] Map SDK events to unified AgentEvent types in bridge (not in Go)
- [ ] Implement PreToolUse hook -> JSON-RPC approval request -> Go PermissionBroker
- [ ] Handle bridge crash: restart with resume, or fail session
- [ ] Two-phase shutdown: JSON-RPC `shutdown` + SIGTERM + SIGKILL
- [ ] Track sessions per bridge process; route to correct bridge
```

---

## 3. 改动的优先级与风险

### 新增 Capability Flag

`AgentCapabilities` 新增两个 flag：

```go
type AgentCapabilities struct {
    // ... existing flags ...
    SDKIntegration     bool `json:"sdkIntegration"`     // NEW: supports SDK mode (richer API than CLI)
    StructuredOutput   bool `json:"structuredOutput"`   // NEW: supports output_format JSON Schema
}
```

Claude Code adapter in SDK mode sets both to `true`; CLI mode sets `false`.

### 风险矩阵

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| Python 依赖（SDK 需要 Python 环境） | Medium | CLI 降级路径保留；Runner 检测 Python 可用性后自动降级 |
| Bridge 进程崩溃 | Medium | 两阶段关闭 + session resume 恢复 + 健康检查 |
| SDK 版本不兼容 | Low | `pip install claude-agent-sdk` 固定版本；CI 测试矩阵 |
| SDK hooks 与 AgentHub PolicyEngine 循环调用 | Medium | PreToolUse 回调超时（10s）；深度限制（max 3 round-trips） |
| SDK 模式 event 格式与 CLI 模式不一致 | Low | Bridge 统一标准化为 AgentHub 12 种 AgentEvent 类型 |
| SDK credit 配额独立计费（2026-06-15 起） | Medium | 成本追踪需区分 CLI API credit 与 SDK credit |

### 实施优先级

| 优先级 | 任务 | 依赖 |
|--------|------|------|
| P1 | `ClaudeCodeConfig` 增加 `UseSDK` + `SDKOptions` 字段 | design-protocol.md 更新 |
| P1 | `cross-analysis-adapters.md` Section 3.1 增加 Workaround 9-13 | 本文 |
| P1 | `design-adapter-sdk.md` 增加 Section 6 "Python Sidecar Adapter" | 本文 |
| P1 | `AgentCapabilities` 增加 `SDKIntegration` + `StructuredOutput` | design-protocol.md 更新 |
| P2 | 实现 `agenthub_claude_bridge.py` | P1 设计完成后 |
| P2 | ClaudeCodeAdapter SDK 模式 `startSDK()` | bridge 就绪后 |
| P2 | PreToolUse hook -> PermissionBroker 集成 | bridge + SDK hooks 可用后 |
| P3 | SDK `output_format` -> Artifact 自动解析 | 结构化输出场景明确后 |
| P3 | SDK `agents` -> AgentHub SubAgentDef 双向映射 | 多 agent 场景明确后 |

---

## 4. 不改变的部分

以下设计保持不变：

1. **AgentAdapter 核心接口** -- `Metadata()`, `Capabilities()`, `Start()`, `AttachStream()`, `Resume()` 不变。SDK 模式下 `Start()` 内部实现不同，但接口签名相同。
2. **12 种统一 AgentEvent 类型** -- 不变。Bridge 负责标准化，Go 侧收到的仍然是 `AgentEvent`。
3. **PermissionBroker 接口** -- 不变。SDK hooks 是新的传输机制，但 AgentHub 的 PolicyEngine 决策逻辑不变。
4. **EventStream 模型** -- 不变。Go channel-based event stream 保持不变，只是事件来源从 Go parser 变成 bridge JSON-RPC。
5. **SessionManager / InteractiveControl 接口** -- 不变。SDK `resume` 和 `cancel` 映射到现有接口方法。
6. **CodexAdapter 和 OpenCodeAdapter** -- 不受影响。只有 Claude Code 需要 SDK 适配。
7. **Hub-Edge Sync 协议** -- 不变。事件标准化后，上层 sync 逻辑透明。
8. **Orchestrator 调度策略** -- 不变。SDK `agents` 是执行层优化，不影响 DispatchStrategy。

---

*Analysis complete. 2026-05-21.*
