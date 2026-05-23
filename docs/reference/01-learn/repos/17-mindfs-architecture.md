# mindfs 架构深度调研报告

> 调研日期：2026-05-23
> 源码仓库：`D:\Code\AgentHub\reference\mindfs`（多 Agent 网关）
> 语言：Go（`server/` 为核心后端，`cli/` 为 Windows 桌面隧道客户端）
> 协议参考：ACP (Agent Client Protocol) — Zed Industries 发起，JSON-RPC 2.0 over ndJSON

---

## 1. 项目概述

mindfs 是一个 **Go-based 多 Agent 网关**，其角色与 AgentHub 的 Edge Server 高度相似：作为中间层，统一对外暴露 WebSocket API，对内管理和路由多个 AI Agent 进程，将各自私有的通信协议归一化为统一的事件流。

**核心规模**：
- 支持 **16 个 Agent**，覆盖主流 coding agent CLI
- **14 个**通过 **ACP (Agent Client Protocol)** —— Zed Industries 发起的开放标准协议（JSON-RPC 2.0 over ndJSON）
- **2 个**通过 SDK 专用协议直连：Claude（`claude-agent-sdk-go`）、Codex（`codex-go-sdk`）
- 统一 **Session 接口** 抽象三种完全不同的事件源：`SendMessage` / `AnswerQuestion` / `SetModel` / `SetMode` / `CancelCurrentTurn` / `Close` 等 14 个方法
- 内建 **E2EE 端到端加密**、**外部 session 导入/同步**、**Relay 隧道远程访问**、**配置备份**等生产级特性

**架构定位**：mindfs 是"胖网关"模式——它不只转发字节流，而是深入理解每个协议的事件语义，将 Partials、Chunks、ToolCalls、Thoughts、Todos 等异构消息归一化为统一的 `agenttypes.Event` 流。

---

## 2. 核心架构

### 2.1 Pool 作为协议路由层

mindfs **没有抽象 transport 层**。它不对三种协议做共性的底层抽象（如统一的 pipe/stream/connection）。相反，它采用了**按 Protocol 枚举路由到独立 Runtime 实现**的模式——三种 Runtime 的内部状态管理策略完全不同。

**文件**：`server/internal/agent/pool.go:17-26`

```go
type Pool struct {
    cfg        Config
    processCtx context.Context
    cancel     context.CancelFunc
    mu         sync.Mutex
    sessions   map[string]*sessionEntry
    closed     bool
    acp        *acp.Runtime      // ACP 子进程管理：map[string]*Process
    claude     *claude.Runtime   // Claude SDK 客户端管理：空 struct，每次 OpenSession 新建独立 client
    codex      *codex.Runtime    // Codex SDK 客户端管理：map[string]*codexsdk.Codex，共享 Client + per-session Thread
}
```

**路由分发**（`pool.go:107-151`）：

```go
func (p *Pool) openSession(ctx context.Context, protocol Protocol,
    def Definition, in OpenSessionInput) (Session, error) {
    switch protocol {
    case ProtocolClaudeSDK:
        return p.claude.OpenSession(ctx, claude.OpenOptions{...})
    case ProtocolCodexSDK:
        return p.codex.OpenSession(ctx, codex.OpenOptions{...})
    case ProtocolACP:
        fallthrough
    default:
        return p.acp.OpenSession(ctx, acp.OpenOptions{...})
    }
}
```

**三种 Runtime 的内部状态管理差异**：
- `acp.Runtime` 维护 `map[string]*Process`，每个 agent 对应一个常驻子进程，一个 Process 承载多个 session
- `claude.Runtime` 是一个空 struct（`type Runtime struct{}`），每次 `OpenSession` 都创建新的独立 client（SDK 自身管理连接池）
- `codex.Runtime` 维护 `map[string]*codexsdk.Codex`，每个 agent 共享一个 Client，在 Client 之上创建 per-session Thread

**GetOrCreate 双重检查锁定**：

```go
func (p *Pool) GetOrCreate(ctx context.Context, in OpenSessionInput) (Session, error) {
    // Phase 1: 锁内查缓存
    p.mu.Lock()
    if entry, ok := p.sessions[in.SessionKey]; ok {
        p.mu.Unlock()
        return entry.session, nil  // 快路径：缓存命中
    }
    p.mu.Unlock()

    // Phase 2: 锁外执行慢操作（启动子进程/创建 SDK client）
    sess, err := p.openSession(ctx, protocol, def, in)
    if err != nil { return nil, err }

    // Phase 3: 再次加锁，防止并发创建
    p.mu.Lock()
    if entry, ok := p.sessions[in.SessionKey]; ok {
        existing := entry.session
        p.mu.Unlock()
        if protocol != ProtocolACP { _ = sess.Close() }  // ACP session 不关闭（共享 process）
        return existing, nil
    }
    p.sessions[in.SessionKey] = &sessionEntry{...}
    p.mu.Unlock()
    return sess, nil
}
```

### 2.2 Session 接口：所有协议的唯一抽象

**文件**：`server/internal/agent/types/types.go:11-50`

```go
type Session interface {
    SendMessage(ctx context.Context, content string) error
    AnswerQuestion(ctx context.Context, answer AskUserAnswer) error
    CurrentModel() string
    SetModel(ctx context.Context, model string) error
    ListModels(ctx context.Context) (ModelList, error)
    SetMode(ctx context.Context, mode string) error
    ListModes(ctx context.Context) (ModeList, error)
    ListCommands(ctx context.Context) (CommandList, error)
    CancelCurrentTurn() error
    OnUpdate(onUpdate func(Event))       // 回调注册，而非返回 channel
    SessionID() string
    ContextWindow(ctx context.Context) (ContextWindow, error)
    Close() error
}
```

**14 个方法的设计哲学**：
- `SendMessage` / `AnswerQuestion` — 两个注入路径（普通消息 vs AskUserQuestion 答复）
- `SetModel` / `SetMode` — 运行时动态切换，不需要重建 session
- `ListModels` / `ListModes` / `ListCommands` — 能力发现（从 agent 实时查询或缓存中读取）
- `OnUpdate` — 回调注册模式。上游消费者主动订阅，而不是被动等待 channel
- `CancelCurrentTurn` — 中断当前 turn，由 `types.TurnCanceler` 统一管理（`context.CancelFunc` 模式）
- `ContextWindow` — token 用量实时查询

**三种实现的差异**：
- **ACP**：`AnswerQuestion` 返回 `"not supported"`（ACP 协议层面没有 ask-user-question 机制）
- **Claude**：完整实现 `AnswerQuestion`（通过 `canUseTool` callback + `questionWaits` channel）
- **Codex**：`AnswerQuestion` 返回 `"not supported"`

### 2.3 Protocol 枚举

**文件**：`server/internal/agent/protocol.go:4-25`

```go
type Protocol string

const (
    ProtocolACP       Protocol = "acp"        // Agent Client Protocol
    ProtocolClaudeSDK Protocol = "claude-sdk" // claude-agent-sdk-go
    ProtocolCodexSDK  Protocol = "codex-sdk"  // codex-go-sdk
)

func DefaultProtocol(agentName string) Protocol {
    if agentName == "claude" { return ProtocolClaudeSDK }
    if agentName == "codex"  { return ProtocolCodexSDK }
    return ProtocolACP
}
```

`DefaultProtocol` 体现了核心设计哲学：claude 和 codex 使用各自的 SDK 以获得最佳体验（ask user question、effort、fast_service 等 SDK 特有功能），其余所有 14 个 agent 走 ACP 通用协议。

---

## 3. ACP 集成：14 个 Agent 的批量化接入路径

### 3.1 ACP 协议概述

ACP（Agent Client Protocol）是 **Zed Industries** 发起的开放标准协议。核心特点：
- **传输**：JSON-RPC 2.0 over ndJSON（Newline-Delimited JSON），通过子进程 stdin/stdout
- **多 session**：一个 agent 进程可以承载多个 ACP session
- **SDK**：mindfs 使用 `github.com/coder/acp-go-sdk` 作为协议实现

ACP 的核心价值：**一次实现 ACP adapter，支持所有实现了 ACP server 的 agent**。这就是 mindfs 能支持 16 个 agent 的关键——14 个走 ACP，每个只需要在 `agents.json` 中声明 command + args。

### 3.2 Process 抽象：一个 Agent 进程 → 多个 Session

**文件**：`server/internal/agent/acp/process.go:29-46`

```go
type Process struct {
    agentName string
    cmd       *exec.Cmd
    conn      *acp.ClientSideConnection
    client    *mindfsClient             // 实现 acp.Client 接口
    waitCh    chan error

    mu           sync.RWMutex
    sessions     map[string]*sessionState   // sessionKey → state（mindfs 内部 key）
    sessionsByID map[string]*sessionState   // ACP SessionId → state（SDK callback 分发）
    capability   CapabilitySnapshot
    models       *acp.SessionModelState
    modes        *acp.SessionModeState
    commands     []acp.AvailableCommand
    stderrHint   stderrHintState
    activePrompt activePromptState
}
```

**dashed-box map 双向索引**：`sessions` 用内部 `sessionKey` 索引（业务层查询），`sessionsByID` 用 ACP 原生 `SessionId` 索引（SDK 事件回调分发）。双向查找覆盖两种使用场景，避免 O(n) 遍历。

**Process 生命周期**：
1. `Start()` — 启动 agent 子进程（`exec.CommandContext`），建立 stdin/stdout/stderr pipe，启动 stderr 监控 goroutine
2. `Initialize()` — JSON-RPC 握手：`conn.Initialize`，获取 `AgentCapabilities`（PromptCapabilities: Audio/Image/Context）
3. `NewSession()` / `ResumeSession()` — 创建或恢复 ACP session，双 map 注册
4. `SendMessage()` — 通过 `conn.Prompt()` 发送文本 prompt，阻塞等待完成
5. `Close()` — 平台相关的进程树 kill（`killProcessTree`），带 10 秒超时

### 3.3 mindfsClient：实现 acp.Client 接口

**文件**：`server/internal/agent/acp/process.go:173-355`

```go
type mindfsClient struct {
    proc *Process
}
```

实现了 `acp.Client` 的全部方法：

| 方法 | 实现策略 |
|------|---------|
| `SessionUpdate` | **核心**：接收 agent 推送的流式事件，通过 `sessionsByID` 分发到 `onUpdate` 回调 |
| `RequestPermission` | Auto-approve + 发出 synthetic tool_call（见下文） |
| `ReadTextFile` / `WriteTextFile` | 返回空/成功——委托给 agent 自行处理文件 |
| `CreateTerminal` / `TerminalOutput` 等 | 桩实现——返回空 |
| `HandleExtensionMethod` | 处理 `_qwencode/slash_command`（Qwen 特有的命令通知） |

### 3.4 SessionUpdate 事件类型映射

**文件**：`server/internal/agent/acp/process.go:779-798`

`wrapSessionUpdate` 将 ACP SDK 的 `SessionUpdate` 映射为 6 种内部 `UpdateType`：

| ACP 原生字段 | 内部 UpdateType | 说明 |
|-------------|----------------|------|
| `AgentMessageChunk` | `message_chunk` | 可见文本增量 |
| `AgentThoughtChunk` | `thought_chunk` | 模型推理增量（thinking） |
| `ToolCall` | `tool_call` | 工具调用开始（含 file locations、content、kind） |
| `ToolCallUpdate` | `tool_update` | 工具调用状态更新（completed/failed） |
| `UserMessageChunk` | `user_message_chunk` | 用户消息回显（被上层过滤，不发送给客户端） |
| （Prompt 返回时手动触发） | `message_done` | Turn 完成信号（含 context window） |

**事件转换**（`session.go:380-502`）在 `convertEvent` 中将 ACP 的深层嵌套结构转换为扁平化的 `types.Event`。关键细节：
- `ToolCall` 从 `raw.ToolCall.Content` 和 `raw.ToolCall.Locations` 提取 diff 和路径信息
- `ToolCallUpdate` 从 `raw.ToolCallUpdate.Status` 判断 completed vs failed
- 非标准更新类型记录 `unhandled` 日志（截断至 1024 字节）用于调试

### 3.5 RequestPermission → Auto-Approve + Synthetic Tool Call

**文件**：`server/internal/agent/acp/process.go:238-300`

这是 mindfs ACP 集成中最精妙的设计：

```go
func (c *mindfsClient) RequestPermission(ctx context.Context,
    params acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error) {
    // 步骤 1：先发出 synthetic tool_call 事件
    // 确保 UI 层能感知到 tool 的执行并关联文件路径
    if session := c.proc.getSessionByID(string(params.SessionId)); session != nil {
        if handler := session.getOnUpdate(); handler != nil {
            toolCall := &acp.SessionUpdateToolCall{
                Content:    params.ToolCall.Content,
                Locations:  params.ToolCall.Locations,
                RawInput:   params.ToolCall.RawInput,
                RawOutput:  params.ToolCall.RawOutput,
                ToolCallId: params.ToolCall.ToolCallId,
                Status:     acp.ToolCallStatusPending,
                Kind:       params.ToolCall.Kind, // fallback ToolKindOther
            }
            handler(SessionUpdate{
                Type:      UpdateTypeToolCall,
                SessionID: string(params.SessionId),
                Raw:       acp.SessionUpdate{ToolCall: toolCall},
            })
        }
    }
    // 步骤 2：自动批准第一个 AllowOnce 或 AllowAlways 选项
    for _, opt := range params.Options {
        if opt.Kind == acp.PermissionOptionKindAllowOnce ||
           opt.Kind == acp.PermissionOptionKindAllowAlways {
            return acp.RequestPermissionResponse{
                Outcome: acp.RequestPermissionOutcome{
                    Selected: &acp.RequestPermissionOutcomeSelected{
                        OptionId: opt.OptionId,
                    },
                },
            }, nil
        }
    }
    // 步骤 3：兜底——取消操作
    return acp.RequestPermissionResponse{
        Outcome: acp.RequestPermissionOutcome{
            Cancelled: &acp.RequestPermissionOutcomeCancelled{},
        },
    }, nil
}
```

**关键洞察**：
- ACP 中 `RequestPermission` 是一个阻塞调用——agent 等待 mindfs 的回应才继续执行
- mindfs 的策略是 **先发 synthetic tool_call 让 UI 展示，再 auto-approve**
- 代码注释中提到 "TODO: Forward to frontend for user approval"——当前版本自动批准，未来可接入用户审批弹窗
- 这避免了权限弹窗导致的 turn 超时，同时保留了 UI 中的工具调用可见性

### 3.6 Stderr Hint Capture：从 Agent 错误输出提取信息

**文件**：`server/internal/agent/acp/process.go:800-927`

当 ACP agent 进程（如 gemini/cursor）崩溃时，stderr 中会输出 JSON 格式的错误信息。mindfs 通过 goroutine 持续读取 stderr：

1. `streamProcessStderr` goroutine 逐行扫描 stderr
2. 通过正则 `"message"\s*:\s*"([^"]+)"` 提取 `message` 字段
3. 缓存 5 分钟（`stderrHintState`，使用 `time.Since(messageAt) > 5*time.Minute` 过期）
4. 同时触发 `cancelActivePrompt()`——取消当前正在进行的 prompt 请求，避免无限等待
5. `wrapPromptError` 将底层 OS 错误替换为更有诊断价值的 stderr hint

**价值**：将 `signal: killed` 这类底层 OS 错误替换为更有诊断价值的业务错误（如 API key 无效、模型不存在）。

### 3.7 对 AgentHub 的借鉴意义（P0）

ACP 集成是 **AgentHub 批量接入 14+ agent 的最佳路径**：

1. **一次实现 ACP adapter = 支持所有 ACP-compatible agent**。当前生态中 Claude、Gemini、Codex、Cursor、Cline、Copilot、Qwen、OpenCode、Augment 等均已在支持或开发 ACP 模式
2. **Process/Session dashed-box map** 模式可直接翻译为 AgentHub 的 `Pool.HubSession` 设计
3. **Synthetic tool_call + auto-approve** 模式让 AgentHub 可以在不实现完整权限审批的情况下获得完整的工具调用可见性
4. **Stderr hint capture** 可复用于 AgentHub 的 `HealthCheck` 模块——在健康检查失败时提供更精准的诊断信息

AgentHub 实现要点：
```go
type ACPAdapter struct {
    conn   *acp.ClientSideConnection
    client *agentHubACPClient  // 实现 acp.Client 接口
}
// SessionUpdate → AgentHub Event 流
// RequestPermission → auto-approve + synthetic tool_call
```

---

## 4. Claude Code 集成：claude-agent-sdk-go 直连

### 4.1 使用的 SDK 和配置

**文件**：`server/internal/agent/claude/session.go:1-18`

使用 `github.com/roasbeef/claude-agent-sdk-go`（Go native SDK）。关键选项：

```go
optionList := []claudeagent.Option{
    claudeagent.WithCwd(opts.RootPath),
    claudeagent.WithEnv(opts.Env),
    claudeagent.WithVerbose(true),
    claudeagent.WithIncludePartialMessages(true),   // 启用 PartialAssistantMessage
    claudeagent.WithCanUseTool(s.handleCanUseTool), // 工具回调劫持
    claudeagent.WithCLIPath(opts.Command),           // 指定 claude CLI 路径
    claudeagent.WithResume(opts.ResumeSessionID),    // session 恢复
    claudeagent.WithModel(opts.Model),
    claudeagent.WithEffort(claudeagent.Effort(opts.Effort)),
}
```

Claude session 创建后立即启动 `go s.consumeMessages()` goroutine 消费 SDK 消息流。

### 4.2 6 种消息类型的归一化

**文件**：`server/internal/agent/claude/session.go:445-504`

Claude SDK 的 `stream.Messages()` channel 复用 6 种逻辑消息类型到一个 Go channel：

| SDK 消息类型 | mindfs 处理 | 产生的 Event |
|-------------|------------|-------------|
| `PartialAssistantMessage` | 增量 buffer + coalesce → flush | `message_chunk` / `thought_chunk` |
| `AssistantMessage` | 先 flush 所有 pending delta，再提取 tool_use block | `tool_call` |
| `UserMessage` | 提取 ToolUseResult，从 `pendingToolCalls` 中匹配 | `tool_update` |
| `ToolProgressMessage` | 轻量心跳 | `tool_update` (status=running) |
| `TodoUpdateMessage` | 提取 todo items 列表 | `todo_update` |
| `ResultMessage` | 末次 fallback 文本 + context window 更新 + 触发 completeTurn | `message_done` |

关键处理顺序：**任何 finalized 消息到达前，必须先 flush 所有 pending delta**。这确保 tool_use/tool_result 等结构化 block 不会与之前 buffered 的文本增量交错。

### 4.3 Delta Coalescing：24 字节 + 句边界缓冲

**文件**：`server/internal/agent/claude/session.go:19,558-568`

```go
const chunkFlushThreshold = 24  // 字节

func (s *session) appendDelta(kind deltaType, delta string) {
    if delta == "" { return }
    pending := s.pendingBuilder(kind)
    pending.WriteString(delta)
    // 达到 24 字节阈值，或遇到自然句边界（换行、标点），就 flush
    if pending.Len() >= chunkFlushThreshold ||
       strings.ContainsAny(delta, "\n.!?;:") {
        s.flushDelta(kind)
    }
}
```

**设计要点**：
- **24 字节阈值**：per-token 发射（每个 token 约 4-8 字节）浪费 WebSocket 带宽，24 字节约 3-6 个 token，是 UI 实时性和网络效率的平衡点
- **句边界触发**：遇到 `\n.!?;:` 立即 flush，确保自然语句分割不会跨 flush 边界断裂
- **文本与 thinking 分离**：维护 `pendingText` 和 `pendingThinking` 两个独立 `strings.Builder`，`thinking_delta` 到来时先 flush text buffer（防止 UI 渲染交错），反之亦然
- **Context window 实时更新**：`PartialAssistantMessage` 的 `message_delta` 事件中也可能携带 `usage.input_tokens`，在 handle 中实时更新 `s.context.TotalTokens`

### 4.4 Turn Queue 模式：显式完成信号

**文件**：`server/internal/agent/claude/session.go:162-193,1325-1363`

```go
func (s *session) SendMessage(ctx context.Context, content string) error {
    s.sendMu.Lock()                      // 防止并发 SendMessage
    defer s.sendMu.Unlock()

    waiter := make(chan error, 1)
    s.enqueueTurn(waiter)                // FIFO 入队
    if err := s.stream.Send(turnCtx, content); err != nil {
        s.dequeueTurn(waiter)            // 发送失败则出队
        return err
    }
    // 阻塞等待：ResultMessage 到达 或 context 取消
    select {
    case err := <-waiter:
        return err
    case <-turnCtx.Done():
        s.dequeueTurn(waiter)
        return turnCtx.Err()
    }
}
```

`completeTurn` 在 `ResultMessage` 处理时被调用，从 `turns` 队列头部取出 waiter 并写入结果。`failPendingTurns` 在 stream 意外结束时对所有 pending waiter 写入错误。

**防止竞态的三重保护**：
1. `sendMu` — 同一 session 同时只有一个 `SendMessage` 在发送
2. `turns` FIFO 队列 — 确保 `completeTurn` 总是 resolve 正确的 waiter
3. `TurnCanceler` — `CancelCurrentTurn` 取消 context，`SendMessage` 的 `select` 立即退出

### 4.5 AskUserQuestion：通过 canUseTool callback + questionWaits

**文件**：`server/internal/agent/claude/session.go:231-266,635-678`

AskUserQuestion 通过两个机制协同工作：

1. **`canUseTool` callback**：当 SDK 遇到 `AskUserQuestion` tool 时，拦截并调用 `awaitAskUserQuestion`
2. **`questionWaits` channel map**：`awaitAskUserQuestion` 先 emit synthetic `tool_call` 事件给前端，然后阻塞等待前端通过 `AnswerQuestion` API 传入答案

```go
func (s *session) handleCanUseTool(ctx context.Context,
    req claudeagent.ToolPermissionRequest) claudeagent.PermissionResult {
    if req.ToolName != "AskUserQuestion" {
        return claudeagent.PermissionAllow{}  // 其他 tool 全部自动批准
    }
    // 解析问题，创建 channel，emit tool_call 事件，阻塞等待用户答案
    answers, err := s.awaitAskUserQuestion(ctx, claudeagent.QuestionSet{
        ToolUseID: callID,
        Questions: input.Questions,
        SessionID: req.Context.SessionID,
    })
    // 将答案注入 updatedInput，返回 PermissionAllow
    updatedInput["answers"] = updatedAnswers
    return claudeagent.PermissionAllow{UpdatedInput: updatedInput}
}
```

**取消安全**：`CancelCurrentTurn` 遍历 `questionWaits` 取消所有待处理问题，同时调用 `cancelPendingToolCall` 发出 failed 状态的 tool_update 事件。

### 4.6 工具摘要系统

**文件**：`server/internal/agent/claude/session.go:726-1063`

Claude session 实现了一个完善的 `summarizeToolCall` 函数，根据工具种类从 JSON input 中提取摘要信息，生成 UI 友好的 tool call 卡片数据：

| Tool Kind | 摘要策略 |
|-----------|---------|
| Read/Edit | 提取 `file_path` + diff（`old_string` / `new_string`） |
| Execute | 提取 `command` + `description` |
| Search | 提取 `pattern` / `query` / `path` |
| WebSearch | 提取 `query` + `allowedDomains` / `blockedDomains` |
| Task | 提取 `subagentType` + `description` + `prompt` |
| AskUser | 格式化问题和选项为 Markdown 列表 |
| Todo | 格式化 todo items 为 `- [x] text` / `- [ ] text` 格式 |

---

## 5. Codex 集成：codex-go-sdk TransportAppServer

### 5.1 使用的 SDK 和传输模式

**文件**：`server/internal/agent/codex/session.go:31-34,118-129`

使用 `github.com/fanwenlin/codex-go-sdk/codex`，采用 `TransportAppServer` 模式：

```go
func newClient(opts OpenOptions) *codexsdk.Codex {
    codexOptions := codexsdk.CodexOptions{
        Transport:             codexsdk.TransportAppServer,
        AppServerPathOverride: opts.Command,   // 指定 Codex CLI 路径
        Env:                   opts.Env,
        Verbose:               true,
    }
    if len(opts.Args) > 0 {
        codexOptions.AppServerArgs = append([]string{}, opts.Args...)
    }
    return codexsdk.NewCodex(codexOptions)
}
```

### 5.2 Client/Thread 模型

- **共享 Client**：每个 agent name 只有一个 `*codexsdk.Codex` client（存储在 `Runtime.clients` map 中）
- **Per-Session Thread**：每个 MindFS session 通过 `client.StartThread(threadOptions)` 或 `client.ResumeThread(sessionID, threadOptions)` 创建独立 thread
- **Thread 选项**：包括 `Model`、`ModelReasoningEffort`、`FastService`、`SandboxMode`（`FullAccess`）、`WorkingDirectory`、`ApprovalPolicy`（`ApprovalModeNever`）、`ApprovalHandler`（始终 `Approved`）

### 5.3 文本增量：String Diffing 策略

**文件**：`server/internal/agent/codex/session.go:368-376,485-496`

```go
func (s *session) emitMessageDelta(msg *codexsdk.AgentMessageItem,
    textByID map[string]string) {
    delta := messageDelta(textByID[msg.ID], msg.Text)
    textByID[msg.ID] = msg.Text
    if delta == "" { return }
    s.emit(types.Event{
        Type: types.EventTypeMessageChunk,
        Data: types.MessageChunk{Content: delta},
    })
}

func messageDelta(prev, next string) string {
    if next == "" { return "" }
    if prev == "" { return next }
    if strings.HasPrefix(next, prev) {
        return next[len(prev):]  // 正常流式：前缀 diff
    }
    return next  // 非连续更新（编辑修正）→ 全量发送
}
```

**与 Claude 策略对比**：
- **Claude**：SDK 显式发送 delta token → mindfs 按 24 字节阈值 buffer → flush
- **Codex**：SDK 每次发送完整累积文本 → mindfs 用 `textByID` map 自己计算 diff → 发射增量
- `strings.HasPrefix` 检测连续增量（正常流式场景）；非连续（编辑修正）则全量发送

### 5.4 Runtime Defaults：从 Agent 自身配置文件读取

**文件**：`server/internal/agent/codex/session.go:304-336`

```go
func (s *session) RuntimeDefaults(ctx context.Context) (types.RuntimeDefaults, error) {
    params := codexsdk.ConfigReadParams{
        IncludeLayers: false,
        Cwd:           strings.TrimSpace(s.threadOpts.WorkingDirectory),
    }
    resp, err := s.client.ReadConfig(ctx, params)
    // 从 resp.Config 中提取：
    //   resp.Config.Model → defaults.Model
    //   resp.Config.ModelReasoningEffort → defaults.Effort
    //   resp.Config.ServiceTier == "fast" → defaults.FastService = "on"
    return defaults, nil
}
```

Codex session 实现了可选的 `DefaultsReader` 接口，允许 Prober 从 agent 自身的配置文件（如 `~/.codex/config.toml`）读取运行时的模型/effort/fast_service 默认值。这比 Claude/ACP 集成多了一层动态能力。

### 5.5 事件类型映射和处理

Codex SDK 的事件流通过 `thread.RunStreamed()` 返回的 channel 消费。事件粒度更细：

| Codex Event | mindfs 映射 | 关键细节 |
|-------------|------------|---------|
| `ThreadStartedEvent` | 更新 `threadID` | — |
| `ItemStartedEvent` | `CommandExecutionItem` → `tool_call` (execute)；`FileChangeItem` → `tool_call` (edit)；`McpToolCallItem` → `tool_call` (other)；`CollabToolCallItem` → `tool_call` (other) | status 通过 `normalizeStatus(v.Status, true)` 映射 |
| `ItemUpdatedEvent` | tool item 则 `tool_update`；`AgentMessageItem` 则 string diff → `message_chunk` | 累积文本增量 |
| `ItemCompletedEvent` | tool/AgentMessage/ReasoningItem 同 ItemUpdated；`ReasoningItem.Summary` → `thought_chunk` | 额外处理 thought 内容 |
| `TurnCompletedEvent` | `message_done` + context window | — |
| `TurnFailedEvent` / `ThreadErrorEvent` | error return | 含错误消息 |
| `RawEvent` (`thread.tokenUsage.updated`) | `parseContextWindow` 提取 `last.totalTokens` / `modelContextWindow` | 实时 token 用量 |

**Tool item 映射**（`mapToolItem`）将 4 种 Codex item 类型归一化为 `types.ToolCall`：

```go
func mapToolItem(item codexsdk.ThreadItem, started bool) (types.ToolCall, bool) {
    switch v := item.(type) {
    case *codexsdk.CommandExecutionItem:
        // Kind: ToolKindExecute, Meta: command/exitCode/source
    case *codexsdk.FileChangeItem:
        // Kind: ToolKindEdit, Locations: all change paths
    case *codexsdk.McpToolCallItem:
        // Kind: ToolKindOther, Meta: server/tool
    case *codexsdk.CollabToolCallItem:
        // Kind: ToolKindOther
    }
}
```

---

## 6. Stream Hub：WebSocket 广播引擎

### 6.1 架构概览

**文件**：`server/internal/api/stream_hub.go:17-27`

```go
type StreamHub struct {
    mu              sync.RWMutex
    e2eeManager     *e2ee.Manager
    clients         map[string]*websocket.Conn           // clientID → WebSocket 连接
    connLocks       map[*websocket.Conn]*sync.Mutex       // 每个连接独立的写锁
    sessionClients  map[string]map[string]struct{}        // sessionKey → 订阅的 clientIDs
    pendingSessions map[string]*SessionPendingState       // 当前正在回复的 session 状态
    replayStates    map[string]*ClientReplayState         // 客户端 replay 进度
    completed       map[string]*CompletedSessionState     // 已完成的 session（供 replay 补发）
}
```

### 6.2 Per-Connection Write Lock

**文件**：`server/internal/api/stream_hub.go:474-517`

```go
func (h *StreamHub) WriteJSON(clientID string, conn *websocket.Conn, value any) error {
    if conn == nil { return nil }
    lock := h.getConnLock(conn)
    lock.Lock()              // 每个连接独立的 sync.Mutex
    defer lock.Unlock()
    // E2EE 加密层集成在写入层（对外部调用者透明）
    if h.e2eeManager != nil && h.e2eeManager.Enabled() {
        if resp, ok := value.(WSResponse); ok && resp.Type == "e2ee.error" {
            return conn.WriteJSON(resp)  // E2EE 错误消息本身不加密
        }
        sess, err := h.e2eeManager.SessionForClient(clientID)
        if err != nil { return nil }
        payload, _ := json.Marshal(value)
        envelope, _ := e2ee.EncryptBytes(sess.Key, payload)
        return conn.WriteJSON(envelope)
    }
    return conn.WriteJSON(value)
}
```

**关键设计**：
- `connLocks map[*websocket.Conn]*sync.Mutex` 为每个连接分配独立锁（`getConnLock` 使用双重检查锁定）
- gorilla/websocket 的 `WriteJSON` 不是并发安全的（会损坏帧），per-conn lock 是标准解决方案
- E2EE 加密透明集成在 write lock 内部——调用者不感知加密，但加密和写入之间也不会有竞态

### 6.3 Session-Client Binding：广播仅发给绑定客户端

**文件**：`server/internal/api/stream_hub.go:225-263`

```go
func (h *StreamHub) BindSessionClient(sessionKey, clientID string) {
    clientSet := h.sessionClients[sessionKey]
    if clientSet == nil {
        clientSet = make(map[string]struct{})
        h.sessionClients[sessionKey] = clientSet
    }
    clientSet[clientID] = struct{}{}
}

func (h *StreamHub) BroadcastSessionStream(rootID, sessionKey string,
    event *StreamEvent) {
    if event == nil { return }
    h.AppendReplyEvent(sessionKey, *event)  // 追加到 pending
    for _, clientID := range h.GetSessionClientIDs(sessionKey, true) {
        // liveOnly=true：跳过正在 replay 的客户端
        resp := buildSessionStreamResponse(rootID, sessionKey, event)
        h.SendToClient(clientID, resp)
    }
}
```

广播只发送给 bind 了该 session 的客户端（而非全体广播），多设备同时访问不同 session 不会互相干扰。`liveOnly=true` 过滤掉正在 replay 的客户端，防止双重广播。

### 6.4 Replay 系统：断线重连/导航到 Session 时重放缓冲事件

**文件**：`server/internal/api/stream_hub.go:354-371`

```go
func (h *StreamHub) ReplayPending(rootID, clientID, sessionKey string) {
    h.mu.Lock()
    h.replayStates[pendingClientKey(clientID, sessionKey)] = &ClientReplayState{
        Status:      ClientStreamStatusReplay,
        ReplayIndex: 0,
    }
    h.mu.Unlock()

    for {
        step := h.collectReplayStep(clientID, sessionKey)
        h.replayStepToClient(rootID, clientID, sessionKey, step.events)
        if step.live {  // ReplayIndex 追赶上 ReplyingList 长度
            h.replayCompletionToClient(rootID, clientID, sessionKey)
            return
        }
    }
}
```

**Replay 工作流程**：
1. 客户端发送 `session.ready` 消息时调用 `ReplayPending`
2. 循环从 `pendingSessions[sessionKey].ReplyingList[ReplayIndex:]` 取事件 batch
3. 逐条发送给客户端
4. 当 `replay.ReplayIndex >= len(ReplyingList)` 时切换到 `live` 模式
5. 检查 `completed` map（缓存 2 分钟内的完成的 session）是否需要补发 `session.done`

**核心数据结构**：
```go
type ClientReplayState struct {
    Status      ClientStreamStatus  // "replay" | "live"
    ReplayIndex int                 // 已重放到的索引
}
```

### 6.5 Pending State：缓冲当前 Turn 的所有事件

```go
type SessionPendingState struct {
    RootID       string
    SessionTitle string
    User         *PendingUserMessage      // 用户输入（含 agent/model/mode 等）
    ReplyingList []StreamEvent            // 当前 turn 所有 AI 回复事件
    Summary      string                   // 最后 50 个 rune 的文本摘要（用于列表预览）
    UpdatedAt    time.Time
}
```

- `SetPendingUser` 在用户发送消息时调用，重置 `ReplyingList` 并清除该 session 的所有 replay states
- `AppendReplyEvent` 在线程安全的环境中追加事件（含 `message_chunk` 的 summary 更新）
- `ClearSessionPending` 在 turn 结束后清理，**会等待所有 replay 客户端追赶完成**（`for h.HasReplayClients(...) { time.Sleep(10ms) }`）

### 6.6 E2EE 集成

E2EE 加密层完全集成在 StreamHub 的写入层。加密密钥通过 E2EE handshake 协商后存储在 `e2ee.Manager` 中（`clientIDs[clientID] → sessionID → Session{Key, ...}`）。Session 有 24 小时 idle TTL，每小时自动清理过期 session。

---

## 7. 配置系统：4 层合并策略

### 7.1 加载优先级

**文件**：`server/internal/agent/config.go:55-80`

```
优先级（高→低）：
1. MINDFS_AGENTS_CONFIG 环境变量 → 指定路径
2. 工作目录 agents.json（当 os.Args[0] 以 "./" 或 ".\" 开头时优先——开发模式）
3. ~/.mindfs/agents.json（用户配置文件）
4. 安装目录 agents.json（安装默认）
5. 代码内置默认值（claude/gemini/codex 三个基础 agent 定义）
```

**合并策略**（`mergeConfigs`，`config.go:121-143`）：
```go
func mergeConfigs(base Config, override Config) Config {
    merged := Config{
        Agents:       append([]Definition(nil), base.Agents...),
        RelayBaseURL: base.RelayBaseURL,
    }
    if override.RelayBaseURL != "" {
        merged.RelayBaseURL = override.RelayBaseURL
    }
    // 用户配置的 agent 覆盖同名安装默认；新增的追加在列表末尾
    for _, agent := range override.Agents {
        if index, ok := agentIndexes[agent.Name]; ok {
            merged.Agents[index] = agent  // 覆盖
        } else {
            merged.Agents = append(merged.Agents, agent)  // 新增
        }
    }
    return merged
}
```

### 7.2 Definition 结构

**文件**：`server/internal/agent/config.go:22-48`

```go
type Definition struct {
    Name         string              `json:"name"`
    Command      string              `json:"command"`
    Protocol     Protocol            `json:"protocol,omitempty"`
    Args         []string            `json:"args,omitempty"`
    Env          map[string]string   `json:"env,omitempty"`
    ConfigBackup ConfigBackupDefaults `json:"configBackup,omitempty"`
    CwdTemplate  string              `json:"cwdTemplate,omitempty"`
    ProbeArgs    []string            `json:"probeArgs,omitempty"`
}

type ConfigBackupDefaults struct {
    FileSources []string `json:"fileSources,omitempty"` // 需备份的配置文件路径
    EnvKeys     []string `json:"envKeys,omitempty"`     // 需备份的环境变量 key
}
```

### 7.3 运行时 Hot-Reload Env

```go
func (p *Pool) SetAgentEnv(agentName string, env map[string]string) error {
    // 直接更新 p.cfg.Agents[i].Env，锁内安全
}
```

注意这是**内存更新**——不重启已运行的子进程。新 session 创建时读取更新后的 env。

### 7.4 内置默认配置

```go
func defaultConfig() Config {
    return Config{
        Agents: []Definition{
            {Name: "claude", Command: "claude", Protocol: ProtocolClaudeSDK},
            {Name: "gemini", Command: "gemini", Protocol: ProtocolACP,
             Args: []string{"--experimental-acp"}},
            {Name: "codex",  Command: "codex",  Protocol: ProtocolCodexSDK},
        },
    }
}
```

即使用户没有任何配置文件，这 3 个 agent 也已内置可用。

---

## 8. 外部 Session 导入

### 8.1 ExternalSessionImporter 接口

**文件**：`server/internal/agent/types/types.go:125-133`

```go
type ExternalSessionImporter interface {
    AgentName() string
    ListExternalSessions(ctx context.Context, in ListExternalSessionsInput) (
        ListExternalSessionsResult, error)
    ImportExternalSession(ctx context.Context, in ImportExternalSessionInput) (
        ImportedExternalSession, error)
}

type StreamingExternalSessionImporter interface {
    ExternalSessionImporter
    ScanExternalSessions(ctx context.Context, in ListExternalSessionsInput,
        visit ExternalSessionVisitFunc) error
}
```

### 8.2 工厂模式按 Protocol 路由

**文件**：`server/internal/agent/importers.go:15-46`

```go
func NewExternalSessionImporter(def Definition) (
    agenttypes.ExternalSessionImporter, error) {
    switch protocol {
    case ProtocolClaudeSDK:
        return claude.NewImporter(claude.ImporterOptions{AgentName: agentName}), nil
    case ProtocolCodexSDK:
        return codex.NewImporter(codex.ImporterOptions{AgentName: agentName}), nil
    case ProtocolACP:
        return acp.NewImporter(acp.ImporterOptions{
            AgentName: agentName,
            Command:   def.Command,
            Args:      def.Args,
            Env:       def.Env,
            ResolveCwd: func(rootPath string) string {
                return def.ResolveCwd(rootPath)
            },
        }), nil
    }
}
```

### 8.3 双策略实现

| Protocol | 数据源 | 扫描方式 | 导入方式 |
|----------|--------|---------|---------|
| `claude-sdk` | `~/.claude/projects/<project>/<session>.jsonl` | `filepath.WalkDir` 扫描 `.jsonl`，按 mtime 降序 | 完整读取 JSONL，过滤 `user`/`assistant` 角色 |
| `codex-sdk` | `~/.codex/sessions/<session>.jsonl` + `session_index.jsonl` | 同上，额外读取 title index | 完整读取 JSONL，提取 `response_item` |
| `acp` | ACP `UnstableListSessions` 协议查询 | 启动临时 ACP 进程，RPC 调用 | `LoadSession` + `importCollector` 监听事件 |

**文件系统策略（Claude/Codex）的核心操作**：

1. `scanSessionFiles` — 扫描目录，按时间排序，limit 限制
2. `inspectSessionFile` — 读取文件头部，提前退出提取 `sessionId`、`cwd`、`firstUserText`
3. `ImportExternalSession` — 完整读取 JSONL 文件，按 role 提取消息交换

**使用 `errStopJSONL` 提前终止扫描**：当提取到 sessionId、cwd、firstUserText 后立即返回 `errStopJSONL` 错误，`forEachJSONLLine` 检测到后停止继续读取。

**消息过滤**：`isMeaningfulClaudeUserText` 过滤掉 `<local-command-caveat>`、`<command-message>` 等系统注入消息；`isMeaningfulCodexUserText` 过滤掉 `# AGENTS.md instructions`、`<environment_context>` 等前缀。

**ACP 策略**：
1. 临时启动一个 ACP 子进程
2. 调用 `conn.UnstableListSessions` 获取 session 列表（支持 cursor 分页）
3. 按 `cwd` 过滤（仅显示当前项目的 session）
4. 调用 `conn.LoadSession` 并附加 `importCollector` 监听 `SessionUpdate`
5. 如果 ACP 不支持 `list_sessions`（code -32601），静默降级（返回空列表）

---

## 9. 其他重要子系统

### 9.1 Agent Prober（可用性探测）

**文件**：`server/internal/agent/probe.go`

`Prober` 负责定期检测 agent 的可用性：
- **探测阶段**：`initial`（启动时全量，45s session timeout）、`background`（定时只重试未安装的，5 分钟间隔）、`recovery`（用户按需触发，30s timeout）
- **Probe session 复用**：通过 `probeSessionStore`（持久化到 `probe-sessions.json`）复用 probe session，避免每次探测都创建新 session。超过 100 次探测或 24 小时后自动 rotate → 创建新 runtime session
- **探测内容**：检查 command 是否可执行（`exec.LookPath`）→ 创建 session（支持 resume probe session）→ 验证交互（发送 "hello" 并检查响应含文本）→ 获取 model/mode/command 列表 → 读取 runtime defaults
- **状态变更通知**：通过 listener 模式广播到 WebSocket（`broadcastAgentStatusChange`）
- **并发安全**：`inFlight map[string]struct{}` 防止同一 agent 并发探测

### 9.2 Session Manager（会话持久化）

**文件**：`server/internal/session/manager.go`

- **存储**：SQLite（session 元数据：id/name/agent/model/mode/status/created_at/updated_at）+ JSONL（exchange 内容 + 工具调用详情）
- **Exchange 追加**：每次 `AddExchange` 直接追加一行 JSON 到 JSONL 文件（append-only，无需读-改-写）
- **Aux 独立存储**：工具调用详情（ToolCall、Thought）存储在 `transcripts/<id>.aux.jsonl` 中，支持内容截断（最大 128KB）
- **Idle 清理**：可配置的空闲关闭策略（默认 7 天未活动自动关闭 session）

### 9.3 项目路径发现

**文件**：`server/internal/agent/discovery.go`

`DiscoverExternalProjectPaths` 通过扫描 Claude/Codex 的本地文件发现用户的已有项目路径：
- **Codex**：读取 `.codex-global-state.json`（`project-order`、`electron-saved-workspace-roots`）→ `config.toml`（`[projects.<path>]` TOML 段）→ `sessions/*.jsonl`（从 session meta/turn_context 中提取 cwd）
- **Claude**：读取 `.claude/projects/<projectDir>/sessions-index.json`（`originalPath` + `entries.projectPath`）→ 回退到 `.jsonl` 文件中的 `cwd` 字段
- 路径去重通过 `NormalizeComparablePath`（Clean + EvalSymlinks + Abs）实现

### 9.4 工作目录隔离

**文件**：`server/internal/agent/workdir.go`

`EnsureStableWorkDir(kind, agentName)` 在系统临时目录下创建隔离的工作目录（`/tmp/mindfs-<kind>/<agentName>`），供 probe 等不需要真实项目目录的场景使用。

### 9.5 Relay 远程访问

**文件**：`server/internal/relay/`

MindFS 支持通过 `a9gent.com` Relay 服务进行远程访问，使用加密隧道（类似 Tailscale Funnel），无需开放防火墙端口。Relay 模块管理设备身份、凭证轮换和 WebSocket 隧道连接。

---

## 10. 对 AgentHub 的借鉴意义

按实现优先级从高到低排列：

### 10.1 ACP Adapter 批量接入（P0 — ROI 最高）

**问题**：AgentHub 当前为每个 agent 写特定适配代码（Claude SDK、Codex SDK 各一套），扩展新 agent 成本高。

**mindfs 方案**：实现一个 ACP adapter = 支持 14 个 agent（gemini、cursor、augment、cline、copilot、kimi、kiro、openclaw、opencode、qwen、qoder、omp、pi、hermes），外加正在适配 ACP 的新 agent。ROI 极高。

**AgentHub 实现要点**：
```go
// 使用 github.com/coder/acp-go-sdk
type ACPAdapter struct {
    conn   *acp.ClientSideConnection
    client *agentHubACPClient  // 实现 acp.Client 接口
}
// SessionUpdate → AgentHub 统一 Event 流
// RequestPermission → auto-approve + synthetic tool_call
```

### 10.2 Delta Coalescing（P1）

**问题**：AgentHub 当前以 per-token 粒度通过 WebSocket 发射 `message_chunk`，每个 token 4-8 字节，高频输出下浪费带宽和 CPU（每个 `conn.WriteJSON` 都有锁和序列化开销）。

**mindfs 方案**：
- **Claude**：24 字节阈值 + 句边界（`\n.!?;:`）flush
- **Codex**：string diffing（`strings.HasPrefix` 计算增量）

**AgentHub 实现**：
```go
type deltaBuffer struct {
    pending strings.Builder
    onFlush func(string)
}

func (b *deltaBuffer) Append(delta string, threshold int) {
    b.pending.WriteString(delta)
    if b.pending.Len() >= threshold || strings.ContainsAny(delta, "\n.!?;:") {
        b.onFlush(b.pending.String())
        b.pending.Reset()
    }
}
```

### 10.3 Stream Hub Replay（P1）

**问题**：AgentHub 当前没有断线重连后的事件重放机制。客户端重连后错过的事件无法恢复。

**mindfs 方案**：
- `pendingSessions[sessionKey].ReplyingList` 保存当前 turn 的所有事件
- `replayStates[clientID::sessionKey]` 跟踪每个 client 的重放进度
- 客户端发送 `session.ready` 时启动重放，逐 batch 追赶至 live 状态
- `liveOnly=true` 过滤防止双重广播
- `completed` map 缓存完成的 session，补发 `session.done`

这是一个相对独立的功能模块，可以增量添加到现有 StreamHub。

### 10.4 Turn Queue 防止竞态（P1）

**问题**：`SendMessage → ResultMessage 到达 → 下一个 SendMessage 启动` 之间存在竞态窗口。如果 ResultMessage 到来后 UI 立即发送新消息，而上一个 SendMessage 尚未 return，可能导致 turn 顺序混乱。

**mindfs 方案**：FIFO waiter 队列——`SendMessage` 入队后阻塞等待 `completeTurn` 信号。

```go
type turnQueue struct {
    mu    sync.Mutex
    turns []chan error
}

func (q *turnQueue) Enqueue() chan error {
    q.mu.Lock()
    defer q.mu.Unlock()
    waiter := make(chan error, 1)
    q.turns = append(q.turns, waiter)
    return waiter
}

func (q *turnQueue) Complete(err error) {
    q.mu.Lock()
    if len(q.turns) == 0 { q.mu.Unlock(); return }
    waiter := q.turns[0]
    q.turns = q.turns[1:]
    q.mu.Unlock()
    waiter <- err
}
```

### 10.5 Config Merge 4 层策略（P2）

**问题**：AgentHub 当前配置管理较简单，多环境部署（开发/测试/生产）需要更灵活的覆盖策略。

**mindfs 方案**：内置默认 → 安装默认 → 环境变量 → 用户文件，逐层合并。用户配置覆盖同名安装默认，新增 agent 追加到列表末尾。

### 10.6 Per-Connection Write Lock（P2）

**问题**：多个 goroutine 向同一个 WebSocket 连接并发写入会导致帧损坏。

**mindfs 方案**：`connLocks map[*websocket.Conn]*sync.Mutex`——每个连接独立锁，避免全局锁竞争。

### 10.7 External Session Import（P2）

**问题**：用户从 CLI agent 迁移到 AgentHub WebUI 时，不希望丢失历史对话。

**mindfs 方案**：`ExternalSessionImporter` 接口 + 双策略（文件系统扫描 Claude/Codex JSONL + ACP 协议查询）。支持增量同步（`AfterTimestamp` 参数）。

### 10.8 Stderr Hint Capture（P3）

**问题**：agent 进程崩溃时，`exit status 1` 等底层错误信息没有诊断价值。

**mindfs 方案**：从 agent stderr 中通过正则提取 JSON 错误消息，缓存 5 分钟，替换底层错误。这是一个小而美的功能，实现成本低但用户体验提升明显。

---

## 11. 代理配置参考

### 11.1 完整 agents.json 结构

从 `reference/mindfs/agents.json` 提取的实际配置（16 个 agent）：

```json
{
  "agents": [
    {
      "name": "gemini",
      "command": "gemini",
      "protocol": "acp",
      "args": ["--experimental-acp"],
      "configBackup": {
        "fileSources": ["~/.gemini/.env", "~/.gemini/settings.json"],
        "envKeys": ["GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL", "GEMINI_MODEL"]
      }
    },
    {
      "name": "codex",
      "command": "codex",
      "protocol": "codex-sdk",
      "configBackup": {
        "fileSources": ["~/.codex/auth.json", "~/.codex/config.toml"]
      }
    },
    {
      "name": "claude",
      "command": "claude",
      "protocol": "claude-sdk",
      "configBackup": {
        "envKeys": [
          "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY",
          "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
          "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "AUTH_MODE"
        ]
      }
    },
    {
      "name": "cursor",   "command": "agent",     "protocol": "acp", "args": ["acp"]
    },
    {
      "name": "augment",  "command": "auggie",    "protocol": "acp", "args": ["--acp"]
    },
    {
      "name": "cline",    "command": "cline",     "protocol": "acp", "args": ["--acp"]
    },
    {
      "name": "copilot",  "command": "copilot",   "protocol": "acp", "args": ["--acp"]
    },
    {
      "name": "kimi",     "command": "kimi",      "protocol": "acp", "args": ["acp"]
    },
    {
      "name": "kiro",     "command": "kiro-cli",  "protocol": "acp", "args": ["acp"]
    },
    {
      "name": "openclaw", "command": "openclaw",  "protocol": "acp", "args": ["acp"],
      "configBackup": { "fileSources": ["~/.openclaw/openclaw.json"] }
    },
    {
      "name": "opencode", "command": "opencode",  "protocol": "acp", "args": ["acp"],
      "configBackup": {
        "fileSources": [
          "~/.config/opencode/opencode.json",
          "~/.local/share/opencode/auth.json"
        ]
      }
    },
    {
      "name": "qwen",     "command": "qwen",      "protocol": "acp", "args": ["--acp"]
    },
    {
      "name": "qoder",    "command": "qodercli",  "protocol": "acp", "args": ["--acp"]
    },
    {
      "name": "omp",      "command": "omp",       "protocol": "acp", "args": ["acp"],
      "configBackup": {
        "fileSources": [
          "~/.omp/agent/.env", "~/.omp/.env",
          "~/.omp/agent/config.yml", "~/.omp/agent/models.yml",
          "~/.omp/agent/mcp.json", "~/.omp/agent/agent.db"
        ],
        "envKeys": [
          "PI_CONFIG_DIR", "PI_CODING_AGENT_DIR",
          "OMP_AUTH_BROKER_URL", "OMP_AUTH_BROKER_TOKEN"
        ]
      }
    },
    {
      "name": "pi",       "command": "pi-acp",    "protocol": "acp"
    },
    {
      "name": "hermes",   "command": "hermes",    "protocol": "acp", "args": ["acp"],
      "configBackup": {
        "fileSources": ["~/.hermes/auth.json", "~/.hermes/config.yaml"]
      }
    }
  ],
  "relayBaseURL": "https://relay.a9gent.com"
}
```

### 11.2 Agent 接入模式分类

| 模式 | Agent 列表 | Protocol | 命令行模式 |
|------|-----------|----------|-----------|
| **SDK 直连** | claude, codex | `claude-sdk` / `codex-sdk` | Go native SDK，无需子进程参数 |
| **ACP `--acp` 标志** | augment, cline, copilot, qwen, qoder | `acp` | `command --acp` |
| **ACP 子命令** | cursor, kimi, kiro, openclaw, opencode, omp, hermes | `acp` | `command acp` |
| **ACP 实验性标志** | gemini | `acp` | `command --experimental-acp` |
| **ACP 专用包装器** | pi | `acp` | 独立命令 `pi-acp` |

### 11.3 ConfigBackup 字段说明

`configBackup` 定义了两个字段，用于配置备份/迁移场景：

- **`fileSources`**：需备份的配置文件路径（支持 `~` 展开为用户主目录）。例如 OMP 包含了 `.env`、`config.yml`、`models.yml`、`mcp.json`、`agent.db` 共 6 个文件
- **`envKeys`**：需备份的环境变量 key。例如 Claude 包含了 8 个 `ANTHROPIC_*` 环境变量

Gemini 和 OMP 同时使用了两种备份策略；Claude 仅使用 envKeys；Codex 仅使用 fileSources；其他 agent 的 configBackup 为空对象 `{}`（配置由 CLI 自身管理，无需 mindfs 介入备份）。

---

## 附录：关键文件索引

| 用途 | 文件路径 |
|------|---------|
| Pool 路由层 | `server/internal/agent/pool.go` |
| Protocol 枚举 | `server/internal/agent/protocol.go` |
| Session 接口 + Event/ToolCall 类型 | `server/internal/agent/types/types.go` |
| ACP Runtime + Session | `server/internal/agent/acp/session.go` |
| ACP Process 管理 + stderr hint | `server/internal/agent/acp/process.go` |
| ACP Importer（协议策略） | `server/internal/agent/acp/importer.go` |
| Claude Runtime + delta coalescing + tool summary | `server/internal/agent/claude/session.go` |
| Claude Importer（文件系统策略） | `server/internal/agent/claude/importer.go` |
| Codex Runtime + string diffing | `server/internal/agent/codex/session.go` |
| Codex Importer（文件系统策略） | `server/internal/agent/codex/importer.go` |
| Stream Hub（WebSocket 广播引擎） | `server/internal/api/stream_hub.go` |
| WebSocket Handler | `server/internal/api/ws.go` |
| Config 加载 + 4 层合并 | `server/internal/agent/config.go` |
| Agent 发现（Codex/Claude 项目扫描） | `server/internal/agent/discovery.go` |
| Agent 探测（Prober） | `server/internal/agent/probe.go` |
| External Session Import 工厂 | `server/internal/agent/importers.go` |
| 16 个 agent 完整配置 | `agents.json` |
| E2EE Manager | `server/internal/e2ee/manager.go` |
| E2EE 加密工具 | `server/internal/e2ee/crypto.go` |
| Session 管理器（SQLite + JSONL） | `server/internal/session/manager.go` |
| Debug 日志 | `server/internal/agent/logs/agentlog.go` |
