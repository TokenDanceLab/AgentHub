> 状态: ⏳ 计划中 — 真实 adapter 接入列入 M3，当前仅 mock 实现

# AgentHub Adapter SDK——开发者指南

> 生成日期：2026-05-21
> 来源：cross-analysis-adapters.md, cloudcli.md, opencode.md, kanna.md, langflow.md, flowise.md, design-protocol.md, design-protobuf-schema.md
> 目标读者：构建新 Agent Adapter 的第三方开发者

---

## 1. Adapter 开发流程

### 1.1 从零到可运行 Adapter：分步指南

开发一个新的 Agent Adapter 需要 7 步。最小 adapter（只读、纯文本输出）可以在 4 步内完成。

```
Step 1: 选择 transport 模型           (subprocess vs HTTP vs sidecar)
Step 2: 实现核心接口                  (4 个方法: Metadata, Capabilities, Start, AttachStream)
Step 3: 实现流归一化                  (native events -> AgentEvent)
Step 4: 注册 adapter                  (init() 自注册 或 manifest)
Step 5: 实现可选扩展                  (SessionManager, PermissionBroker, InteractiveControl)
Step 6: 编写 manifest / config        (manifest.yaml 或 Go 代码)
Step 7: 测试与发布                    (针对 AgentHub runner 的集成测试)
```

#### Step 1: 选择 Transport 模型

| Transport | 适用场景 | 示例 Adapter |
|-----------|---------|-------------|
| **Subprocess** | Agent CLI 有无交互模式 (stdin/stdout) | Claude Code (`-p --output-format stream-json`), Codex (`codex exec`) |
| **HTTP + SSE** | Agent 暴露带流式事件的 REST API | OpenCode (Hono server, `POST /session` + SSE) |
| **WebSocket** | Agent 使用持久双向连接 | Kanna wrapper (WS snapshot push) |
| **Sidecar process** | Agent 是有自己协议的长驻守护进程 | Codex App Server (JSON-RPC stdio) |

决策树：

```
Agent 能否 headless 运行 (不需要 TTY)?
  ├─ 能，且 stdout 流式输出  → Subprocess（最简单）
  ├─ 能，有 HTTP API          → HTTP + SSE
  └─ 不能 (需要 TTY)          → 用 pty 包装，或使用 sidecar
```

#### Step 2: 实现核心接口

Adapter **必须**实现的最小接口是 `AgentAdapter`：

```go
// Reference: cross-analysis-adapters.md Section 2.2
type AgentAdapter interface {
    Metadata() AdapterMetadata
    Capabilities() AgentCapabilities
    Start(ctx context.Context, req StartRequest) (*AgentSession, error)
    AttachStream(ctx context.Context, sessionID string) (*EventStream, error)
}
```

**Resume 在 v1 中是可选的**。如果底层 agent 不支持会话复用，返回 `ErrNotSupported`。

四个方法拆解：

| 方法 | 做什么 | 最小实现 |
|--------|-------------|----------------------|
| `Metadata()` | 返回名称、版本和底层 CLI 版本 | 硬编码或调用 `binary --version` |
| `Capabilities()` | 声明支持哪些功能 | 除 `Streaming: true` 外全部返回 `false` |
| `Start()` | 启动 agent 进程/连接，返回 session | 启动 subprocess 或 dial HTTP |
| `AttachStream()` | 返回 `AgentEvent` channel | 启动 goroutine 读取 stdout/SSE 并发送事件 |

**最小 adapter 骨架**（subprocess transport）：

```go
package myagent

import (
    "context"
    "bufio"
    "encoding/json"
    "os/exec"

    "github.com/agenthub/agenthub/packages/protocol"
)

type MyAgentAdapter struct {
    binaryPath string
}

func (a *MyAgentAdapter) Metadata() protocol.AdapterMetadata {
    return protocol.AdapterMetadata{
        Name:    "my-agent",
        Version: "1.0.0",
    }
}

func (a *MyAgentAdapter) Capabilities() protocol.AgentCapabilities {
    return protocol.AgentCapabilities{
        Streaming:     true,
        ThinkingVisible: false,
    }
}

func (a *MyAgentAdapter) Start(ctx context.Context, req protocol.StartRequest) (*protocol.AgentSession, error) {
    cmd := exec.CommandContext(ctx, a.binaryPath, "--prompt", req.Prompt)
    stdoutPipe, _ := cmd.StdoutPipe()
    cmd.Start()

    session := &protocol.AgentSession{
        ID:     generateSessionID(),
        Status: protocol.StatusRunning,
    }
    // Store cmd + stdoutPipe for AttachStream
    sessionStore.Store(session.ID, &sessionState{cmd: cmd, stdout: stdoutPipe})
    return session, nil
}

func (a *MyAgentAdapter) AttachStream(ctx context.Context, sessionID string) (*protocol.EventStream, error) {
    state := sessionStore.Load(sessionID)
    ch := make(chan protocol.AgentEvent, 64)
    ctx, cancel := context.WithCancel(ctx)

    go func() {
        defer close(ch)
        scanner := bufio.NewScanner(state.stdout)
        for scanner.Scan() {
            line := scanner.Bytes()
            event := normalizeToAgentEvent(line)
            ch <- event
        }
        ch <- protocol.AgentEvent{
            Type: protocol.EventResult,
            Payload: protocol.ResultPayload{Subtype: protocol.ResultSuccess},
        }
    }()

    return &protocol.EventStream{C: ch, Cancel: cancel}, nil
}

func (a *MyAgentAdapter) Resume(ctx context.Context, sessionID string) (*protocol.AgentSession, error) {
    return nil, ErrNotSupported
}
```

#### Step 3: 流归一化——Native Events → AgentEvent

每个 adapter 必须将原生输出格式转换为 **12 种统一 AgentEvent 类型**。

参考：cross-analysis-adapters.md Section 2.2 "Unified Agent Event Model" 和 Section 4.1 "Native-to-Unified Event Mapping"

12 种 AgentEvent 类型及其含义：

| AgentEvent Type | 含义 | 必需？ |
|-----------------|---------|-----------|
| `system_init` | 会话初始化：模型、工具、权限 | 强烈推荐 |
| `assistant_text` | 模型输出的文本内容（delta 或 block） | 必需 |
| `reasoning` | 思考/推理内容 | 可选（flag: `ThinkingVisible`） |
| `tool_call` | Agent 请求执行工具 | 必需（如果 agent 使用工具） |
| `tool_result` | 工具执行结果 | 必需（如果 agent 使用工具） |
| `tool_progress` | 工具执行进度更新 | 可选 |
| `tool_use_summary` | 批量工具调用摘要 | 可选 |
| `result` | Turn 完成（成功/错误） | 必需 |
| `system` | 压缩、重试、状态变更 | 可选 |
| `stream_event` | 原始流式 delta | 可选（flag: `IncludePartialEvents`） |
| `approval_request` | Agent 请求权限 | 可选（flag: `PermissionHooks`） |
| `status_change` | 会话状态转换 | 可选 |

**归一化模式**（来自 Kanna 的 `normalizeClaudeStreamMessage()`, kanna.md Section 3.7）：

```go
// Parser function: raw_line -> AgentEvent
func normalizeToAgentEvent(raw []byte) protocol.AgentEvent {
    var native map[string]interface{}
    json.Unmarshal(raw, &native)

    switch native["type"] {
    case "text":
        return protocol.AgentEvent{
            Type: protocol.EventAssistantText,
            Payload: protocol.AssistantTextPayload{
                Content: native["content"].(string),
                Phase:   protocol.TextPhaseDelta,
            },
        }
    case "tool_use":
        return protocol.AgentEvent{
            Type: protocol.EventToolCall,
            Payload: protocol.ToolCallPayload{
                ToolCallID: native["id"].(string),
                ToolName:   native["name"].(string),
                ToolInput:  native["input"].(map[string]any),
                Status:     protocol.ToolCallPending,
            },
        }
    case "complete":
        return protocol.AgentEvent{
            Type: protocol.EventResult,
            Payload: protocol.ResultPayload{
                Subtype: protocol.ResultSuccess,
                Content: native["output"].(string),
            },
        }
    }
}
```

#### Step 4: 注册 Adapter

完整注册机制见下方 Section 3。

#### Step 5: 实现可选扩展

三个扩展接口，每个由 capability flag 控制：

| Extension Interface | Required Capability Flag | Methods |
|--------------------|------------------------|---------|
| `SessionManager` | `SessionPersist` or `Fork` | `ForkSession`, `ListSessions`, `GetSessionInfo`, `GetMessages` |
| `PermissionBroker` | `PermissionHooks` | `SetPermissionCallback`, `ResolvePermission` |
| `InteractiveControl` | `Steer` | `Cancel`, `SendSteer`, `Drain` |

参考：cross-analysis-adapters.md Section 2.2 "Extension Interfaces"

#### Step 6: 编写 Manifest / Config

见下方 Section 1.3（Manifest）和 Section 3（Registration）。

#### Step 7: 测试

AgentHub 提供 adapter 测试 harness：

```go
// In adapter_test.go
func TestMyAgentAdapter(t *testing.T) {
    harness := adapters.NewTestHarness(t, &MyAgentAdapter{
        binaryPath: os.Getenv("MY_AGENT_PATH"),
    })
    harness.RunBasicTest()         // Start + stream + result
    harness.RunToolUseTest()       // Tool call + result round-trip
    harness.RunCancellationTest()  // Cancel mid-turn
    harness.RunPermissionTest()    // Approval request/decision
}
```

### 1.2 最小 Adapter Checklist（4 个方法）

**只读、纯文本输出的 agent** 只需要：

1. `Metadata()` -- 返回 adapter 名称 + 版本
2. `Capabilities()` -- 返回 `Streaming: true`
3. `Start()` -- 启动进程或 dial HTTP
4. `AttachStream()` -- 发送 `assistant_text` delta + 最终 `result`

其他一切都是可选的，由 capability flag 控制。

### 1.3 注册机制

AgentHub 支持 **三种注册模式**，适配不同的部署方式。

#### 模式 A：Go init() 自注册（内置 Adapter）

适用于编译进 AgentHub runner 二进制文件的 adapter。

来自 flowise.md Section 3.2.3（Node DLL 自注册）的模式：

```go
// adapter/registry/registry.go
package registry

import "sync"

var (
    mu       sync.RWMutex
    adapters = map[string]AdapterFactory{}
)

type AdapterFactory func(config AdapterConfig) (AgentAdapter, error)

func Register(name string, factory AdapterFactory) {
    mu.Lock()
    defer mu.Unlock()
    if _, exists := adapters[name]; exists {
        panic("adapter already registered: " + name)
    }
    adapters[name] = factory
}

func Get(name string) (AdapterFactory, bool) {
    mu.RLock()
    defer mu.RUnlock()
    f, ok := adapters[name]
    return f, ok
}

func List() []string {
    mu.RLock()
    defer mu.RUnlock()
    names := make([]string, 0, len(adapters))
    for name := range adapters {
        names = append(names, name)
    }
    return names
}
```

在 adapter package 中的用法：

```go
// adapters/myagent/adapter.go
package myagent

import "github.com/agenthub/agenthub/packages/adapter/registry"

func init() {
    registry.Register("my-agent", func(cfg AdapterConfig) (AgentAdapter, error) {
        return &MyAgentAdapter{
            binaryPath: cfg.BinaryPath,
        }, nil
    })
}
```

Runner 启动时加载所有已注册 adapter：

```go
// runner/main.go
import (
    _ "github.com/agenthub/agenthub/adapters/claude-code"   // side-effect import triggers init()
    _ "github.com/agenthub/agenthub/adapters/codex"
    _ "github.com/agenthub/agenthub/adapters/opencode"
    _ "github.com/agenthub/agenthub/adapters/myagent"
)
```

这是 **Flowise NodesPool 模式**——每个 node 文件自注册，server 通过 side-effect import 发现它们。不需要维护中心注册表文件。

#### 模式 B：manifest.yaml（外部插件）

适用于不编译进二进制文件的第三方 adapter。

来自 cloudcli.md Section 2.2（Plugin Manifest）的模式：

```yaml
# my-adapter/manifest.yaml
name: my-agent                  # 必需：^[a-zA-Z0-9_-]+$
displayName: My Agent           # 必需：UI 显示名
version: 1.0.0
description: "Custom agent adapter for MyAgent CLI"
author: "your-name"
icon: Bot                       # Lucide icon name
type: adapter                   # "adapter" | "plugin"（slot 区分）
entry: adapter.go               # Go 入口（内置）或 server.js（sidecar）
server: server.js               # 可选：sidecar 进程入口
transport:
  type: subprocess              # "subprocess" | "http" | "sidecar"
  binary: my-agent               # CLI 二进制名称或路径
  args: ["--output-format", "jsonl"]
capabilities:
  streaming: true
  sessionPersist: false
  permissionHooks: false
  thinkingVisible: false
permissions:
  - fs.read                     # 需要的权限
  - process.spawn
```

Manifest 加载遵循 CloudCLI 模式（cloudcli.md Section 2.2）：

1. 扫描 `~/.agenthub/adapters/` 中包含 `manifest.yaml` 的目录
2. 验证必需字段和 regex 约束
3. 对于 `transport.type: subprocess`：在 PATH 中定位二进制文件
4. 对于 `transport.type: sidecar`：使用 ready-protocol 启动 `node server.js`
5. 注册到 adapter registry

#### 模式 C：配置文件（AgentHub config）

适用于只是已有 CLI 工具薄封装的简单 adapter。

```yaml
# ~/.agenthub/config.yaml
adapters:
  custom-shell-agent:
    type: subprocess
    binary: /usr/local/bin/my-shell-agent
    args_template: "--task {{.Prompt}} --output json"
    event_mapping:
      text: "assistant_text"
      tool: "tool_call"
      done: "result"
```

这适用于零代码 adapter——CLI 已经发出结构化 JSON，AgentHub 可以直接映射字段，不需要 Go adapter。

### 1.4 注册模式对比

| 特性 | init() 自注册 | manifest.yaml | Config File |
|---------|----------------|---------------|-------------|
| 编译进二进制 | 是 | 否 | 否 |
| 热重载 | 否（需重编译） | 是（重新扫描） | 是（重新加载） |
| Sidecar 支持 | N/A | 是（server.js） | 否 |
| 复杂解析逻辑 | 完整 Go 能力 | 通过 sidecar | 仅 JSON 字段映射 |
| 分发方式 | Go module | 目录 + git clone | Config 片段 |
| 适用场景 | 内置 adapter | 第三方 adapter | 简单 CLI wrapper |
| 参考模式 | Flowise NodesPool | CloudCLI plugin-loader | Kanna ProviderCatalog |

---

## 2. Adapter 文件 Checklist

### 2.1 标准目录布局

```
my-adapter/
├── adapter.go             # AgentAdapter 接口实现
├── manifest.yaml           # Adapter 元数据（模式 B 注册用）
├── config.go               # AgentConfig struct + StartRequest 验证
├── executor.go             # 进程启动/管理（subprocess 或 HTTP）
├── parser.go               # 流输出归一化（native -> AgentEvent）
├── events.go               # 事件类型定义（原生事件 struct）
├── permissions.go          # PermissionBroker 扩展（可选）
├── sessions.go             # SessionManager 扩展（可选）
├── control.go              # InteractiveControl 扩展（可选）
├── adapter_test.go         # 使用 test harness 的集成测试
├── go.mod                  # Go module 文件
├── go.sum
└── README.md               # 开发文档
```

### 2.2 文件职责

#### `adapter.go`——核心接口

```go
package myagent

// adapter.go: implements protocol.AgentAdapter
// 职责：
//   - Metadata()     -> 静态 adapter 信息
//   - Capabilities() -> 功能标志
//   - Start()        -> 启动 agent，返回 session
//   - AttachStream() -> 事件 channel 消费者
//   - Resume()       -> 重新连接 session（可选）
```

必须嵌入每个 agent 的 workaround struct（cross-analysis-adapters.md Section 3 模式）：

```go
type MyAgentAdapter struct {
    config      AdapterConfig
    // 每个 agent 的特殊处理
    workaround1 bool  // 例如："stdout guard interference" 等价处理
    workaround2 bool  // 例如："exit code interpretation" 等价处理
}
```

#### `manifest.yaml`——元数据

完整 schema 见 Section 1.3 模式 B。

#### `config.go`——配置

```go
// config.go: Adapter 特定配置 + 验证
// 参考：cross-analysis-adapters.md Section 2.2 "AdapterConfig"
// 参考：cross-analysis-adapters.md Section 3 每个 agent 的特殊配置

type MyAgentConfig struct {
    BinaryPath      string            `json:"binaryPath" yaml:"binaryPath"`
    OutputFormat    string            `json:"outputFormat" yaml:"outputFormat"`    // "jsonl", "plain"
    Env             map[string]string `json:"env,omitempty" yaml:"env,omitempty"`
    TimeoutSec      int               `json:"timeoutSec" yaml:"timeoutSec"`
    // Provider 特定的额外配置
    Extras          map[string]any    `json:"extras,omitempty" yaml:"extras,omitempty"`
}

func (c *MyAgentConfig) Validate() error {
    if c.BinaryPath == "" {
        return fmt.Errorf("binaryPath is required")
    }
    if c.OutputFormat != "jsonl" && c.OutputFormat != "plain" {
        return fmt.Errorf("outputFormat must be jsonl or plain")
    }
    return nil
}
```

来自 opencode.md Section 1.2 的模式：OpenCode 有 `OpenCodeConfig`，包含 `Port`、`AutoStart`、`HealthTimeout`——每个 adapter 定义自己的 config struct，扩展基础 `AdapterConfig`。

#### `executor.go`——进程生命周期

```go
// executor.go: 启动/管理 agent 进程或 HTTP 连接
// 两种模式：

// 模式 A：Subprocess（Claude Code, Codex）
func (a *MyAgentAdapter) startSubprocess(ctx context.Context, req StartRequest) (*exec.Cmd, io.ReadCloser, error) {
    cmd := exec.CommandContext(ctx, a.config.BinaryPath,
        "--prompt", req.Prompt,
        "--output-format", a.config.OutputFormat,
    )
    stdout, _ := cmd.StdoutPipe()
    cmd.Stderr = &stderrBuf
    if err := cmd.Start(); err != nil {
        return nil, nil, err
    }
    return cmd, stdout, nil
}

// 模式 B：HTTP Client（OpenCode）
func (a *MyAgentAdapter) startHTTP(ctx context.Context, req StartRequest) (*http.Response, error) {
    url := fmt.Sprintf("http://localhost:%d/api/session", a.config.Port)
    body, _ := json.Marshal(req)
    return http.Post(url, "application/json", bytes.NewReader(body))
}
```

对于 sidecar adapter（如 CloudCLI 插件），实现 **ready protocol**（cloudcli.md Section 2.5）：
- 启动子进程
- 等待 stdout JSON 行 `{"ready":true,"port":<number>}`
- 超时 10s，然后 SIGTERM（5s grace）→ SIGKILL

#### `parser.go`——流归一化

```go
// parser.go: 将原始 agent 输出转换为统一 AgentEvent 流
// 参考：cross-analysis-adapters.md Section 4.1 event mapping table
// 参考：kanna.md Section 3.7 TranscriptEntry normalization

// EventParser is a stateful parser that reads raw lines and emits AgentEvents.
type EventParser struct {
    sessionID string
    seq       int
    state     parserState  // 如果需要，跟踪 parser FSM 状态
}

func (p *EventParser) ParseLine(line []byte) (*AgentEvent, error) {
    p.seq++
    // 按 native event type 分发
    // 映射到 12 种 AgentEvent type 之一
    // 在 AgentEvent.Raw 中保留原始事件以用于调试
}
```

关键归一化规则（来自 cross-analysis-adapters.md Section 4）：

1. **MCP tool 命名**：始终归一化为 `mcp__<server>__<tool>` 格式（Section 4.2）
2. **Tool call 状态生命周期**：`pending -> running -> completed/failed/denied`
3. **Text phase**：流式 delta 标记为 `delta`，最终 block 标记为 `block_end`
4. **Result 永远最后**：`result` 事件必须是最后发出的事件，即使流继续 drain
5. **Raw 保留**：设置 `AgentEvent.Raw = line` 以启用调试

#### `events.go`——原生事件类型

```go
// events.go: agent 原生事件格式的 Go struct 定义
// 由 parser.go 使用以反序列化原始输出

type MyAgentNativeEvent struct {
    Type      string          `json:"type"`      // "text", "tool_use", "complete", "error"
    ID        string          `json:"id,omitempty"`
    Content   string          `json:"content,omitempty"`
    ToolName  string          `json:"tool_name,omitempty"`
    ToolInput map[string]any  `json:"tool_input,omitempty"`
    Timestamp int64           `json:"timestamp,omitempty"`
}
```

来自 cross-analysis-adapters.md Section 3 的模式：每个 adapter 章节在归一化代码之前分别定义原生 CLI 参数和原生事件结构。

#### `permissions.go`——PermissionBroker（可选）

```go
// permissions.go: implements protocol.PermissionBroker
// 参考：cross-analysis-adapters.md Section 2.2 "PermissionBroker"
// 参考：cross-analysis-adapters.md Section 3.1 Workaround 5（CC stdin control protocol）

func (a *MyAgentAdapter) SetPermissionCallback(sessionID string, cb PermissionCallback) {
    // 为此 session 存储 callback
    // 由 AgentHub 的 approval engine 调用
}

func (a *MyAgentAdapter) ResolvePermission(ctx context.Context, req ToolPermissionRequest) (*PermissionDecision, error) {
    // 由 adapter 的事件循环在工具调用需要审批时调用
    // 阻塞直到做出决定（用户/管理员输入）
}
```

Kanna 模式（kanna.md Section 3.5）：只 gate 特定工具（`AskUserQuestion`、`ExitPlanMode`），自动允许其他一切。AgentHub 将此推广到任意工具。

#### `sessions.go`——SessionManager（可选）

```go
// sessions.go: implements protocol.SessionManager
// 参考：cross-analysis-adapters.md Section 2.2 "SessionManager"

func (a *MyAgentAdapter) ForkSession(ctx context.Context, req ForkRequest) (*AgentSession, error) { ... }
func (a *MyAgentAdapter) ListSessions(ctx context.Context, pagination Pagination) ([]SessionInfo, error) { ... }
func (a *MyAgentAdapter) GetSessionInfo(ctx context.Context, sessionID string) (*SessionInfo, error) { ... }
func (a *MyAgentAdapter) GetMessages(ctx context.Context, sessionID string) ([]AgentEvent, error) { ... }
```

#### `control.go`——InteractiveControl（可选）

```go
// control.go: implements protocol.InteractiveControl
// 参考：cross-analysis-adapters.md Section 2.2 "InteractiveControl"
// 参考：kanna.md Section 3.4 steer mode pattern

func (a *MyAgentAdapter) Cancel(ctx context.Context, sessionID string) error { ... }
func (a *MyAgentAdapter) SendSteer(ctx context.Context, sessionID string, msg SteerMessage) error { ... }
func (a *MyAgentAdapter) Drain(ctx context.Context, sessionID string) error { ... }
```

---

## 3. 注册机制设计

### 3.1 架构

AgentHub 的 adapter 注册是一个 **三层系统**，灵感来自多个参考实现：

```
Layer 1: Registry（全局单例，线程安全 Map）
         参考：Flowise NodesPool 模式（flowise.md Section 3.2.3）
         位置：packages/adapter/registry/

Layer 2: Discovery（adapter 如何被发现和加载）
         参考：CloudCLI plugin-loader（cloudcli.md Section 2.2）
         位置：packages/adapter/discovery/

Layer 3: Lifecycle（进程 start/stop/health）
         参考：CloudCLI process-manager（cloudcli.md Section 2.5）
              + OpenCode server lifecycle（opencode.md Section 5.1 Workaround 1）
         位置：packages/adapter/lifecycle/
```

### 3.2 Layer 1：Registry

Flowise 的 node 注册模式（flowise.md Section 3.2.3）：

```
Flowise:  nodeClass: XXX → module.exports = { nodeClass: XXX }
          NodesPool 通过 dynamic import() 懒加载

AgentHub: factory: func → registry.Register("name", factory)
          Runner 通过 side-effect import 导入 adapter package 触发 init()
```

实现：

```go
// packages/adapter/registry/registry.go

package registry

import (
    "fmt"
    "sync"
)

// AdapterFactory creates an adapter instance from configuration.
// 参考：Flowise NodesPool 从 nodeClass 创建 node 实例
type AdapterFactory func(config AdapterConfig) (AgentAdapter, error)

// AdapterEntry holds a registered adapter.
type AdapterEntry struct {
    Name        string
    Factory     AdapterFactory
    Manifest    *AdapterManifest   // 内置为 nil，外部设置
    Source      RegistrationSource
}

type RegistrationSource string

const (
    SourceBuiltin RegistrationSource = "builtin"   // 编译进二进制（init()）
    SourceExternal RegistrationSource = "external"  // 从 manifest.yaml 加载
    SourceConfig  RegistrationSource = "config"     // 在 AgentHub config 中定义
)

type Registry struct {
    mu       sync.RWMutex
    entries  map[string]*AdapterEntry
    loadOrder []string  // 保留注册顺序以确定优先级
}

var global = &Registry{entries: make(map[string]*AdapterEntry)}

// Register is called by adapter packages in their init() function.
// 重复注册时 panic（fail-fast，同 Flowise NodesPool）。
func Register(name string, factory AdapterFactory) {
    global.mu.Lock()
    defer global.mu.Unlock()
    if _, exists := global.entries[name]; exists {
        panic(fmt.Sprintf("adapter %q already registered", name))
    }
    global.entries[name] = &AdapterEntry{
        Name:    name,
        Factory: factory,
        Source:  SourceBuiltin,
    }
    global.loadOrder = append(global.loadOrder, name)
}

// RegisterExternal is called by the manifest loader for external adapters.
// 冲突时不 panic；返回 error 以便 loader 跳过。
func RegisterExternal(name string, factory AdapterFactory, manifest *AdapterManifest) error {
    global.mu.Lock()
    defer global.mu.Unlock()
    if _, exists := global.entries[name]; exists {
        return fmt.Errorf("adapter %q conflicts with existing registration", name)
    }
    global.entries[name] = &AdapterEntry{
        Name:     name,
        Factory:  factory,
        Manifest: manifest,
        Source:   SourceExternal,
    }
    global.loadOrder = append(global.loadOrder, name)
    return nil
}

func Get(name string) (*AdapterEntry, bool) {
    global.mu.RLock()
    defer global.mu.RUnlock()
    e, ok := global.entries[name]
    return e, ok
}

func List() []*AdapterEntry {
    global.mu.RLock()
    defer global.mu.RUnlock()
    result := make([]*AdapterEntry, 0, len(global.entries))
    for _, name := range global.loadOrder {
        if e, ok := global.entries[name]; ok {
            result = append(result, e)
        }
    }
    return result
}
```

### 3.3 Layer 2：Discovery

灵感来自 CloudCLI 的 `scanPlugins`（cloudcli.md Section 2.2）和 OpenCode 的 `PluginLoader.loadExternal`（opencode.md Section 1.3）。

```go
// packages/adapter/discovery/discovery.go

// DiscoverExternal scans directories for manifest.yaml files and registers them.
// 参考：CloudCLI scanPlugins() 跳过 tmp- 前缀目录（原子安装模式）
func DiscoverExternal(adaptersDir string) ([]string, error) {
    entries, err := os.ReadDir(adaptersDir)
    if err != nil {
        return nil, err
    }

    var registered []string
    for _, entry := range entries {
        if !entry.IsDir() {
            continue
        }
        // 跳过临时目录（CloudCLI 原子安装模式）
        if strings.HasPrefix(entry.Name(), ".tmp-") {
            continue
        }

        manifestPath := filepath.Join(adaptersDir, entry.Name(), "manifest.yaml")
        manifest, err := LoadManifest(manifestPath)
        if err != nil {
            log.Printf("skipping %s: invalid manifest: %v", entry.Name(), err)
            continue
        }

        // 根据 transport type 确定加载策略
        var factory AdapterFactory
        switch manifest.Transport.Type {
        case "subprocess":
            factory = NewSubprocessAdapterFactory(manifest)
        case "sidecar":
            factory = NewSidecarAdapterFactory(manifest)
        case "http":
            factory = NewHTTPAdapterFactory(manifest)
        default:
            log.Printf("skipping %s: unknown transport type %q", entry.Name(), manifest.Transport.Type)
            continue
        }

        if err := registry.RegisterExternal(entry.Name(), factory, manifest); err != nil {
            log.Printf("skipping %s: %v", entry.Name(), err)
            continue
        }
        registered = append(registered, entry.Name())
    }
    return registered, nil
}
```

### 3.4 Layer 3：Lifecycle

```go
// packages/adapter/lifecycle/manager.go

// ProcessManager handles subprocess/sidecar lifecycle.
// 参考：CloudCLI plugin-process-manager（cloudcli.md Section 2.5）
// 关键模式：ready protocol, timeout, SIGTERM->SIGKILL 两阶段关闭
type ProcessManager struct {
    processes map[string]*ManagedProcess
    mu        sync.Mutex
}

type ManagedProcess struct {
    Name    string
    Cmd     *exec.Cmd
    Port    int            // for HTTP/sidecar adapters
    Status  ProcessStatus
    ReadyCh chan struct{}   // ready signal 收到后关闭
}

// Start spawns the adapter process and waits for ready signal.
// 参考：CloudCLI startPluginServer() -- spawn + JSON ready line + 10s timeout
func (pm *ProcessManager) Start(name string, config ProcessConfig) (*ManagedProcess, error) {
    cmd := exec.Command(config.Command, config.Args...)
    cmd.Env = sanitizeEnv(config.Env) // CloudCLI 模式：只注入 PATH, HOME, NODE_ENV
    stdout, _ := cmd.StdoutPipe()
    cmd.Start()

    mp := &ManagedProcess{
        Name:    name,
        Cmd:     cmd,
        Status:  ProcessStarting,
        ReadyCh: make(chan struct{}),
    }

    // Ready protocol：从 stdout 读取 JSON ready signal
    go func() {
        scanner := bufio.NewScanner(stdout)
        if scanner.Scan() {
            var ready ReadySignal
            if json.Unmarshal(scanner.Bytes(), &ready) == nil && ready.Ready {
                mp.Port = ready.Port
                close(mp.ReadyCh)
            }
        }
    }()

    // Timeout: 10s（CloudCLI 模式）
    select {
    case <-mp.ReadyCh:
        mp.Status = ProcessRunning
    case <-time.After(10 * time.Second):
        pm.Stop(name)
        return nil, fmt.Errorf("adapter %s: ready timeout after 10s", name)
    }

    pm.mu.Lock()
    pm.processes[name] = mp
    pm.mu.Unlock()
    return mp, nil
}

// Stop gracefully terminates: SIGTERM (5s) -> SIGKILL.
// 参考：CloudCLI two-phase shutdown
func (pm *ProcessManager) Stop(name string) error {
    // ... SIGTERM, wait 5s, SIGKILL
}

// ReadySignal 是 sidecar 进程在 stdout 上发出的 JSON 对象，
// 表示它已准备好接受请求。
// 参考：CloudCLI: {"ready": true, "port": <number>}
type ReadySignal struct {
    Ready bool `json:"ready"`
    Port  int  `json:"port"`
}
```

### 3.5 端到端注册流程

```
AgentHub Runner 启动
│
├─ 1. 内置 adapter（init() side-effect import）
│      import _ "adapters/claude-code"   → registry.Register("claude-code", factory)
│      import _ "adapters/codex"         → registry.Register("codex", factory)
│      import _ "adapters/opencode"      → registry.Register("opencode", factory)
│
├─ 2. 外部 adapter（manifest.yaml 扫描）
│      discovery.DiscoverExternal("~/.agenthub/adapters/")
│        → skip .tmp-* dirs（原子安装保护）
│        → LoadManifest() + validate
│        → NewAdapterFactory() from transport type
│        → registry.RegisterExternal()
│
├─ 3. Config adapter（AgentHub config YAML）
│      config.LoadAdapterConfigs()
│        → parse adapters: section
│        → registry.RegisterConfig()
│
└─ 4. 运行时解析
       adapter := registry.Get(requestedAgentID)
       session := adapter.Factory(config).Start(ctx, req)
```

---

## 4. 内置 Adapter vs 外部 Adapter

### 4.1 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    AgentHub Runner                       │
│                                                          │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │ 内置 Adapter      │    │   外部 Adapter             │   │
│  │ (编译进二进制)     │    │   (sidecar / MCP / plugin)  │   │
│  │                  │    │                            │   │
│  │ Claude Code      │    │  ┌──────────────────────┐ │   │
│  │ Codex            │    │  │ Sidecar Process      │ │   │
│  │ OpenCode         │    │  │ (node server.js)     │ │   │
│  │                  │    │  │ ready protocol       │ │   │
│  │ 直接 Go 调用     │    │  │ HTTP/gRPC bridge     │ │   │
│  │ 共享内存         │    │  └──────────────────────┘ │   │
│  │                  │    │                            │   │
│  └──────────────────┘    │  ┌──────────────────────┐ │   │
│                          │  │ MCP Server           │ │   │
│  扩展接口               │  │ (tools/list +        │ │   │
│  SessionManager         │  │  tools/call)          │ │   │
│  PermissionBroker       │  │ AgentHub 作为 MCP 客户端│ │   │
│  InteractiveControl     │  └──────────────────────┘ │   │
│                          │                            │   │
│                          │  ┌──────────────────────┐ │   │
│                          │  │ CloudCLI-style Plugin│ │   │
│                          │  │ manifest.yaml        │ │   │
│                          │  │ RPC proxy (HTTP)     │ │   │
│                          │  └──────────────────────┘ │   │
│                          └──────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 4.2 对比表

| 维度 | 内置 Adapter | 外部 Adapter（Sidecar） | 外部 Adapter（MCP） |
|-----------|-----------------|---------------------------|----------------------|
| **语言** | Go | 任意（Node.js, Python, Rust） | MCP 协议（任意） |
| **分发** | 编译进 runner 二进制 | 独立进程，单独安装 | MCP server，通过 config 发现 |
| **注册** | `init()` 自注册 | `manifest.yaml` + ready protocol | MCP `tools/list` |
| **通信** | 直接函数调用 | HTTP/gRPC via RPC proxy | MCP `tools/call` |
| **性能** | 零开销 | 子进程开销 | MCP 协议开销 |
| **热重载** | 否（重编译） | 是（重启进程） | 是（重连） |
| **流式** | Native Go channel | HTTP SSE / WebSocket | MCP notifications |
| **并发** | 共享内存 | 进程级隔离 | 连接级 |
| **安全** | 同一进程 | 进程隔离（SIGTERM/SIGKILL） | MCP auth |
| **权限** | 函数级 | manifest `permissions: []` | MCP capabilities |
| **更新** | 重编译 runner | `git pull` + 重启 | MCP server 更新 |
| **参考** | Flowise NodesPool | CloudCLI plugin-process-manager | langflow MCP Composer |

### 4.3 内置 Adapter 开发模式

内置 adapter 位于 AgentHub monorepo：

```
packages/adapter/
├── registry/           # 全局 registry（共享）
├── discovery/          # 外部 adapter 发现（共享）
├── lifecycle/          # 进程管理（共享）
├── claude-code/        # 内置：Claude Code
│   ├── adapter.go
│   ├── parser.go       # NDJSON -> AgentEvent
│   ├── permissions.go  # can_use_tool control protocol
│   └── ...
├── codex/              # 内置：Codex
│   ├── adapter.go
│   ├── parser.go       # Rollout trace -> AgentEvent
│   └── ...
└── opencode/           # 内置：OpenCode
    ├── adapter.go
    ├── parser.go       # SSE -> AgentEvent
    └── ...
```

每个内置 adapter 是一个独立的 Go package，包含调用 `registry.Register()` 的 `init()`。Runner 通过 blank import 导入所有内置 adapter。

来自 cross-analysis-adapters.md Section 5（Next Steps）：
> P0: 先实现 ClaudeCodeAdapter——NDJSON 协议最成熟。
> P1: 实现 CodexAdapter，含 rollout replay。
> P1: 实现 OpenCodeAdapter，含 HTTP server 生命周期管理。

### 4.4 外部 Adapter 开发模式

外部 adapter 遵循 CloudCLI 插件模式（cloudcli.md Section 2）：

**Sidecar process adapter：**

```
my-external-adapter/
├── manifest.yaml         # 插件元数据
├── package.json          # Node.js package
├── server.js             # Sidecar 入口（ready protocol）
├── adapter.js            # 归一化逻辑
└── README.md
```

`server.js` 实现 **ready protocol**：

```javascript
// server.js -- Sidecar process for AgentHub
// 参考：CloudCLI startPluginServer（cloudcli.md Section 2.5）
import http from 'http';

const port = process.env.AGENTHUB_PORT || 0; // 0 = OS 分配
const server = http.createServer(handleRequest);
server.listen(port, () => {
    // Ready signal: stdout 上的 JSON 行
    const addr = server.address();
    process.stdout.write(JSON.stringify({ ready: true, port: addr.port }) + '\n');
});

async function handleRequest(req, res) {
    // RPC proxy endpoint
    if (req.url.startsWith('/rpc/')) {
        // 处理 AgentHub RPC 调用
    }
}
```

**MCP server adapter**（来自 langflow.md Section 4——三级 MCP）：

Adapter 本身是一个 MCP server。AgentHub 是 MCP **客户端**。

```json
// .agenthub/mcp.json
{
  "mcpServers": {
    "my-agent-adapter": {
      "transport": "stdio",
      "command": "node",
      "args": ["my-agent-mcp-server.js"]
    }
  }
}
```

MCP server 暴露：
- `tools/list`——返回可用工具定义
- `tools/call`——执行工具并返回结果

这是 langflow 的 "Path C"（外部 MCP Server），adapter 的能力通过 MCP 协议在运行时发现，而不是在 manifest 中声明。

### 4.5 如何选择

```
Adapter 会在 AgentHub monorepo 中维护吗？
  ├─ 会 → 内置（Go, init() 注册）
  └─ 不会 → Agent 是带结构化输出的简单 CLI 吗？
            ├─ 是 → 基于 Config（AgentHub config YAML）
            └─ 否 → Agent 需要复杂逻辑或状态吗？
                      ├─ 是 → 外部 Sidecar（manifest.yaml + ready protocol）
                      └─ 否 → Agent 能通过 MCP 暴露工具吗？
                                ├─ 能 → MCP Server adapter
                                └─ 不能 → 外部 Sidecar
```

---

## 5. Adapter 开发 Checklist

灵感来自 opencode.md Section 1（19 个 plugin hook）、cloudcli.md Section 2.2（manifest 验证）和 cross-analysis-adapters.md Section 2.3（Interface Coverage Map）。

### 5.1 开发前

- [ ] **研究目标 agent 的 CLI/API**
  - [ ] 记录调用命令（无交互模式）
  - [ ] 记录输出格式（JSON, NDJSON, plain text, SSE）
  - [ ] 识别完成信号（exit code? final event?）
  - [ ] 列出所有原生事件类型及其结构
  - [ ] 记录任何已知 quirks 或陷阱（示例见 cross-analysis-adapters.md Section 3）
  - 参考：cross-analysis-adapters.md Section 1.1 "Startup & Process Model"

- [ ] **映射原生事件到 AgentEvent 类型**
  - [ ] 创建事件映射表（见 cross-analysis-adapters.md Section 4.1）
  - [ ] 识别哪些 AgentEvent 类型是必需的 vs 可选的
  - [ ] 确定 MCP tool 命名规范（`mcp__<server>__<tool>` 归一化）
  - 参考：cross-analysis-adapters.md Section 4.2 "Tool Name Normalization"

- [ ] **选择注册模式**
  - [ ] 内置（Go, init()）——如果在 AgentHub monorepo 中维护
  - [ ] 外部 Sidecar（manifest.yaml）——如果独立仓库，复杂逻辑
  - [ ] MCP Server——如果 agent 工具可以通过 MCP 暴露
  - [ ] 基于 Config——如果是带结构化输出的简单 CLI wrapper

### 5.2 核心实现

- [ ] **`Metadata()`**
  - [ ] 返回 `Name`（kebab-case 标识符，例如 `"my-agent"`）
  - [ ] 返回 `Version`（adapter 实现版本，semver）
  - [ ] 返回 `AgentVersion`（底层 CLI 版本，通过 `--version`）
  - 参考：cross-analysis-adapters.md Section 2.2 "AdapterMetadata"

- [ ] **`Capabilities()`**
  - [ ] 显式设置所有 boolean 字段（避免零值歧义）
  - [ ] `Streaming`——agent 是否支持实时事件流？
  - [ ] `SessionPersist`——session 在进程重启后是否存活？
  - [ ] `Fork`——agent 是否支持 session fork？
  - [ ] `MultiAgent`——agent 是否支持子 agent 生成？
  - [ ] `PermissionHooks`——adapter 能否拦截工具执行？
  - [ ] `Sandbox`——agent 是否支持 OS 级沙箱？
  - [ ] `ThinkingVisible`——思考内容是否暴露在流中？
  - [ ] `MCPIntegration`——能否注册 MCP 工具？
  - [ ] `StreamingToolExec`——工具能否在 API 流式传输期间执行？
  - [ ] `Compaction`——agent 是否自动压缩上下文？
  - [ ] `ResumeLast`——agent 是否支持 `--resume-last`？
  - [ ] `Steer`——agent 是否支持中途注入消息？
  - 参考：cross-analysis-adapters.md Section 2.2 "AgentCapabilities"

- [ ] **`Start(ctx, req)`**
  - [ ] 验证 `StartRequest` 参数
  - [ ] 将 `StartRequest` 映射到原生 CLI args 或 HTTP body
  - [ ] 启动 subprocess 或 dial HTTP 连接
  - [ ] 返回带唯一 session ID 的 `AgentSession`
  - [ ] 设置初始 `Status = StatusStarting`
  - [ ] 优雅处理启动错误（超时、找不到二进制文件）
  - 参考：cross-analysis-adapters.md Section 2.2 "StartRequest", "Start()"

- [ ] **`AttachStream(ctx, sessionID)`**
  - [ ] 创建缓冲 channel（`make(chan AgentEvent, 64)`）
  - [ ] 启动 goroutine 消费流
  - [ ] 解析原始输出行/事件
  - [ ] 归一化为 AgentEvent（调用 parser.go）
  - [ ] **首先**发出 `system_init`（如果可用）
  - [ ] 按顺序发出内容和工具事件
  - [ ] **最后**发出 `result`（始终）
  - [ ] 流结束时关闭 channel
  - [ ] 通过 `EventStream.Cancel` 处理 context 取消
  - [ ] 处理异常终止：设置 `EventStream.Err`
  - 参考：cross-analysis-adapters.md Section 2.2 "EventStream"

- [ ] **`Resume(ctx, sessionID)`**（可选）
  - [ ] 如果 agent 不支持 session 复用，返回 `ErrNotSupported`
  - 否则：重新连接到已有 session，返回 `AgentSession`

### 5.3 流解析

- [ ] **Parser 实现（`parser.go`）**
  - [ ] 定义用于反序列化的原生事件 struct
  - [ ] 如果 agent 有多行事件，实现状态机
  - [ ] 处理部分/不完整行（缓冲 scanner）
  - [ ] 将每个原生事件类型映射到正确的 AgentEventType
  - [ ] 跟踪单调递增的序列号（`Seq`）
  - [ ] 在 `AgentEvent.Raw` 中保留原始事件以用于调试
  - [ ] 单独处理 stderr 输出（不作为 AgentEvent 发出）
  - 参考：kanna.md Section 3.7（normalizeClaudeStreamMessage 模式）
  - 参考：cross-analysis-adapters.md Section 3 每个 agent 的 workaround

- [ ] **文本内容处理**
  - [ ] 流式 delta 标记为 `TextPhaseDelta`
  - [ ] 最终 block 标记为 `TextPhaseBlockEnd`
  - [ ] 每个 turn 分配唯一的 `MessageID`
  - 参考：cross-analysis-adapters.md "AssistantTextPayload"

- [ ] **工具调用处理**
  - [ ] 映射 `tool_call` 事件，状态为 `ToolCallPending`
  - [ ] 映射 `tool_result` 事件，状态为 `ToolCallCompleted`/`ToolCallFailed`
  - [ ] 将 MCP tool 名称归一化为 `mcp__<server>__<tool>`
  - [ ] 跟踪 tool call ID 以匹配 call/result
  - 参考：cross-analysis-adapters.md "ToolCallPayload", "ToolResultPayload"

- [ ] **Result 处理**
  - [ ] 检测最终/终止事件
  - [ ] 映射到正确的 `ResultSubtype`（success, error_during_execution, error_max_turns 等）
  - [ ] 提取 cost 和 usage 信息（如果可用）
  - [ ] 提取错误消息（如果 turn 失败）
  - [ ] 始终将 `result` 作为 channel 上的最后事件发出
  - 参考：cross-analysis-adapters.md "ResultPayload"

### 5.4 扩展接口（可选，由 Capability 控制）

- [ ] **SessionManager**（如果 `SessionPersist` 或 `Fork` capability）
  - [ ] `ForkSession`——复制 transcript + 创建新 session
  - [ ] `ListSessions`——枚举已存储的 session
  - [ ] `GetSessionInfo`——返回 session 的元数据
  - [ ] `GetMessages`——从持久化的 transcript 重放事件
  - 参考：cross-analysis-adapters.md Section 2.2 "SessionManager"

- [ ] **PermissionBroker**（如果 `PermissionHooks` capability）
  - [ ] `SetPermissionCallback`——注册 AgentHub 的 approval hook
  - [ ] `ResolvePermission`——在执行工具之前阻塞，直到做出决定
  - [ ] 在执行任何工具之前调用 callback
  - [ ] 处理 "allow"/"deny"/"ask_user" 行为
  - [ ] 支持来自 approval engine 的修改后的输入
  - 参考：cross-analysis-adapters.md Section 2.2 "PermissionBroker"
  - 参考：kanna.md Section 3.5（tool gating 模式）

- [ ] **InteractiveControl**（如果 `Steer` capability）
  - [ ] `Cancel`——优雅终止当前 turn
  - [ ] `SendSteer`——中途注入消息（带 ReplaceLast flag）
  - [ ] `Drain`——在 result 之后等待后台任务完成
  - 参考：cross-analysis-adapters.md Section 2.2 "InteractiveControl"
  - 参考：kanna.md Section 3.4（steer mode + drainingStreams 模式）

### 5.5 注册与打包

- [ ] **对于内置 Adapter：**
  - [ ] 添加 `init()` 调用 `registry.Register("name", factory)`
  - [ ] 在 runner 的 `main.go` 中添加 blank import
  - [ ] 确保没有与 registry package 的 import cycle
  - 参考：Section 3.2 Layer 1

- [ ] **对于外部 Sidecar Adapter：**
  - [ ] 创建包含所有必需字段的 `manifest.yaml`
  - [ ] 对照 manifest schema 验证：
    - [ ] `name`：regex `^[a-zA-Z0-9_-]+$`
    - [ ] `displayName`：非空
    - [ ] `transport.type`："subprocess" | "http" | "sidecar"
    - [ ] `entry` / `server`：无路径穿越（`..`）
  - [ ] 实现 ready protocol（stdout `{"ready":true,"port":<number>}`）
  - [ ] 优雅处理 SIGTERM（清理、关闭连接）
  - 参考：cloudcli.md Section 2.2（manifest schema + 验证）

- [ ] **对于 MCP Server Adapter：**
  - [ ] 实现返回工具定义的 MCP `tools/list`
  - [ ] 实现执行工具的 MCP `tools/call`
  - [ ] 将 server 添加到 AgentHub 的 MCP config
  - 参考：langflow.md Section 4（三级 MCP 模式）

### 5.6 文档

- [ ] **README.md**
  - [ ] adapter 做什么、包装哪个 agent
  - [ ] 前置条件（CLI 二进制版本、环境变量）
  - [ ] 配置选项（所有字段、默认值）
  - [ ] 已知限制或 workaround
  - [ ] Transport 模型说明（subprocess / HTTP / sidecar）
  - [ ] MCP tool 命名规范（如适用）
  - [ ] 来自 AgentHub config 的简单使用示例
  - 参考：cross-analysis-adapters.md Section 3（每个 agent workaround 的格式）

- [ ] **manifest.yaml**（对于外部 adapter）
  - [ ] 所有必需字段准确填写
  - [ ] `description` 字段可供 AgentHub UI 使用
  - [ ] `capabilities` 匹配 adapter 实际实现的功能
  - [ ] `permissions` 列表（fs.read, process.spawn, network.http 等）

### 5.7 测试

- [ ] **单元测试**
  - [ ] 使用 fixture 数据测试原生事件解析
  - [ ] 测试每个原生到统一的 event mapping
  - [ ] 测试错误处理（格式错误的输出、超时、崩溃）
  - [ ] 测试 result 提取（success、error subtype、usage）
  - [ ] 测试 MCP tool 名称归一化
  - [ ] 测试部分行缓冲（如适用）

- [ ] **集成测试**（使用 AgentHub test harness）
  - [ ] `TestBasic`——prompt -> text response -> success result
  - [ ] `TestToolUse`——tool call -> tool result -> final response
  - [ ] `TestCancellation`——中途 cancel，验证流关闭
  - [ ] `TestPermission`——approval request -> allow/deny -> continue
  - [ ] `TestStreaming`——验证 delta 事件在 result 之前到达
  - [ ] `TestError`——无效 prompt、二进制崩溃、网络错误

- [ ] **端到端测试**
  - [ ] Adapter 在 AgentHub runner 中注册
  - [ ] 用户可以在 UI/config 中选择 adapter
  - [ ] 完整 turn：start -> streaming events -> result
  - [ ] Session resume 工作（如果支持）
  - [ ] 并发 session 不互相干扰

### 5.8 生产就绪

- [ ] **错误处理**
  - [ ] 找不到二进制：清晰的错误消息，包含路径
  - [ ] 二进制崩溃：捕获 stderr，设置 `EventStream.Err`
  - [ ] 超时：context deadline exceeded，清理进程
  - [ ] 无效输出：记录警告，跳过格式错误的行，继续
  - [ ] Stderr vs stdout：分离的日志 channel（CC stdout-guard 模式）
  - 参考：cross-analysis-adapters.md Section 3.1 Workaround 1（stdout guard）

- [ ] **进程生命周期**
  - [ ] Context 取消时清理进程
  - [ ] Session 关闭时清理进程
  - [ ] 僵尸进程预防（等待退出）
  - [ ] 两阶段关闭：SIGTERM（5s grace）-> SIGKILL
  - 参考：cloudcli.md Section 2.5（process-manager shutdown）

- [ ] **并发安全**
  - [ ] 多个 session 不共享可变状态
  - [ ] Registry 访问是线程安全的（sync.RWMutex）
  - [ ] Channel 操作正确同步
  - [ ] 无 goroutine 泄漏（所有 goroutine 在流关闭时退出）

- [ ] **可观测性**
  - [ ] 记录 adapter 启动及版本信息
  - [ ] 记录每个 turn 启动及 session ID
  - [ ] 记录流错误和异常终止
  - [ ] 记录权限决策（allow/deny, reason）
  - [ ] 在 `AgentEvent.Raw` 中保留原始事件以用于调试

### 5.9 提交 Checklist（对于第三方 Adapter）

- [ ] `manifest.yaml` 通过验证
- [ ] 所有 4 个核心方法已实现（`Metadata`、`Capabilities`、`Start`、`AttachStream`）
- [ ] `Resume()` 返回 `ErrNotSupported` 或正确工作
- [ ] 所有适用的 12 种 AgentEvent 类型正确映射
- [ ] `result` 事件始终是最后发出的事件
- [ ] MCP 工具使用 `mcp__<server>__<tool>` 命名规范
- [ ] 进程清理在 cancel/timeout/crash 时工作
- [ ] Stderr 不混入 AgentEvent 流
- [ ] README.md 涵盖前置条件和配置
- [ ] 单元测试使用 fixture 数据通过
- [ ] 集成测试使用 AgentHub test harness 通过
- [ ] Adapter 名称唯一（不与内置 adapter 冲突）

---

## Appendix A：快速启动骨架

```go
// my-adapter/adapter.go -- Minimum viable adapter
package myadapter

import (
    "context"
    "bufio"
    "encoding/json"
    "os/exec"
    "sync"

    "github.com/agenthub/agenthub/packages/protocol"
    "github.com/agenthub/agenthub/packages/adapter/registry"
)

func init() {
    registry.Register("my-agent", func(cfg protocol.AdapterConfig) (protocol.AgentAdapter, error) {
        return &Adapter{binaryPath: cfg.BinaryPath}, nil
    })
}

type Adapter struct {
    binaryPath string
    mu         sync.Mutex
    sessions   map[string]*sessionState
}

type sessionState struct {
    cmd    *exec.Cmd
    stdout io.ReadCloser
}

func (a *Adapter) Metadata() protocol.AdapterMetadata {
    return protocol.AdapterMetadata{Name: "my-agent", Version: "0.1.0"}
}

func (a *Adapter) Capabilities() protocol.AgentCapabilities {
    return protocol.AgentCapabilities{Streaming: true}
}

func (a *Adapter) Start(ctx context.Context, req protocol.StartRequest) (*protocol.AgentSession, error) {
    cmd := exec.CommandContext(ctx, a.binaryPath, "--prompt", req.Prompt)
    stdout, _ := cmd.StdoutPipe()
    cmd.Start()

    sessionID := generateID()
    a.sessions[sessionID] = &sessionState{cmd: cmd, stdout: stdout}

    return &protocol.AgentSession{ID: sessionID, Status: protocol.StatusRunning}, nil
}

func (a *Adapter) Resume(ctx context.Context, sessionID string) (*protocol.AgentSession, error) {
    return nil, fmt.Errorf("resume not supported")
}

func (a *Adapter) AttachStream(ctx context.Context, sessionID string) (*protocol.EventStream, error) {
    state := a.sessions[sessionID]
    ch := make(chan protocol.AgentEvent, 64)
    ctx, cancel := context.WithCancel(ctx)

    go func() {
        defer close(ch)
        defer state.cmd.Wait()
        scanner := bufio.NewScanner(state.stdout)
        seq := 0
        for scanner.Scan() {
            seq++
            var native map[string]any
            json.Unmarshal(scanner.Bytes(), &native)
            // Normalize native -> AgentEvent ...
            ch <- protocol.AgentEvent{Seq: seq, SessionID: sessionID, Type: protocol.EventAssistantText, ...}
        }
        ch <- protocol.AgentEvent{Type: protocol.EventResult, ...}
    }()

    return &protocol.EventStream{C: ch, Cancel: cancel}, nil
}
```

## Appendix B：事件映射模板

设计原生到 AgentEvent 映射时使用此模板：

| Native Event Type | AgentHub AgentEvent | Payload Struct | 说明 |
|------------------|--------------------|---------------|-------|
| `init`           | `system_init`     | `SystemInitPayload` | 模型、工具、权限 |
| `text_start`     | `assistant_text`  | `AssistantTextPayload` (delta) | |
| `text_delta`     | `assistant_text`  | `AssistantTextPayload` (delta) | |
| `text_end`       | `assistant_text`  | `AssistantTextPayload` (block_end) | |
| `thinking`       | `reasoning`       | `ReasoningPayload` | 仅在 thinking 可见时 |
| `tool_call`      | `tool_call`       | `ToolCallPayload` (pending) | |
| `tool_output`    | `tool_result`     | `ToolResultPayload` | 按 ToolCallID 匹配 |
| `tool_error`     | `tool_result`     | `ToolResultPayload` (IsError: true) | |
| `done`           | `result`          | `ResultPayload` | 始终是最后一个事件 |
| `error`          | `result`          | `ResultPayload` (IsError: true) | |
| `status`         | `status_change`   | `StatusChangePayload` | 可选 |

## Appendix C：交叉引用索引

| 本文档章节 | 主要来源 | 次要来源 |
|---|---|---|
| 1.1 分步流程 | cross-analysis-adapters.md Section 2 | Section 5 (Next Steps) |
| 1.2 最小 adapter | cross-analysis-adapters.md Section 2.2 | Section 2.3 (coverage map) |
| 1.3 注册模式 | flowise.md Section 3.2.3 (NodesPool) | cloudcli.md Section 2.2 (manifest) |
| 1.4 注册对比 | flowise.md + cloudcli.md | kanna.md (ProviderCatalog) |
| 2.1 目录布局 | cross-analysis-adapters.md Section 3 (per-agent) | opencode.md Section 1 (plugin layout) |
| 2.2 文件职责 | cross-analysis-adapters.md Section 2.2 | Section 3 workarounds |
| 3.1 Registry Layer 1 | flowise.md Section 3.2.3 | kanna.md Section 3.1 (Node DLL) |
| 3.2 Registry Layer 2 | cloudcli.md Section 2.2 | opencode.md Section 1.3 (loader) |
| 3.3 Registry Layer 3 | cloudcli.md Section 2.5 | opencode.md Section 5.1 Workaround 1 |
| 4. 内置 vs 外部 | flowise.md Section 3.2 (monorepo) | cloudcli.md Section 2 (plugin system) |
| 4.4 Sidecar ready protocol | cloudcli.md Section 2.5 | kanna.md Section 3.6 (AsyncMessageQueue) |
| 4.4 MCP server adapter | langflow.md Section 4 (three-tier MCP) | opencode.md Section 4 (MCP management) |
| 5. Checklist | opencode.md Section 1 (19 hooks) | cross-analysis-adapters.md Section 2.3 (coverage) |
| App A. 骨架 | cross-analysis-adapters.md Section 2.2 | kanna.md Section 3.7 (normalization) |
| App B. 事件映射模板 | cross-analysis-adapters.md Section 4.1 | kanna.md Section 3.7 |

---

*设计完成。2026-05-21。*
