# 增强适配器架构

日期：2026-05-23
状态：设计阶段（P0 范围）

## 1. 概述

### 1.1 目标

当前 `AgentAdapter`（v1）处理进程启动和 NDJSON/JSONL 流解析。它适用于单轮批处理运行，但在以下方面不完整：

| 能力 | v1 状态 | 目标 |
|---|---|---|
| 多轮会话 | 仅透传 SessionID | 完整的 Start/Resume/List/Fork |
| 子 Agent 管理 | 仅 system prompt（Orchestrator） | 事件拦截、生命周期追踪 |
| 权限拦截 | 默认自动批准处理器 | 策略引擎集成 |
| 结构化 diff 追踪 | 载荷结构不正确 | 工具感知的 diff 提取 |
| 中断信号 | Context cancel + stdin 写入 | 硬终止前的优雅排空 |
| 双向通信 | 仅权限自动批准 | 会话管理、引导、模型切换 |

### 1.2 设计原则

1. **适配器拥有协议，执行器拥有生命周期** — 适配器知道如何与 CLI 通信；ProcessExecutor 拥有 OS 进程（启动/等待/终止）。此边界是正确的并予以保留。
2. **事件驱动，而非回调驱动** — 所有适配器输出通过事件总线流动。控制流是双向通道上的请求/响应对。
3. **协议无关的事件类型** — BusEvent 常量已是协议无关的。适配器的 ParseStream 将原生协议映射到这些常量。保留此映射层。
4. **优雅降级** — 当 CLI 不支持某项能力时，适配器在 Capabilities() 中返回 `false`。调用方在使用前检查。

---

## 2. 增强的 AgentAdapter 接口（v2）

### 2.1 核心接口

```go
// AgentAdapter is the unified interface for all Agent CLI backends.
// V2 adds session management, sub-agent coordination, and structured output.
type AgentAdapter interface {
    // --- V1（保留）---
    Metadata() AdapterMetadata
    Capabilities() AgentCapabilities
    BuildCommand(ctx RunProcessContext) (cmdPath string, args []string, env []string, workDir string)
    ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error

    // --- V2: 会话管理 ---
    // ListSessions returns all known sessions for this adapter.
    ListSessions(ctx context.Context) ([]SessionInfo, error)

    // GetSessionMessages replays messages from a session.
    GetSessionMessages(ctx context.Context, sessionID string) ([]AgentMessage, error)

    // ForkSession creates a new session branching from an existing one.
    ForkSession(ctx context.Context, sourceSessionID string, mode ForkMode) (*SessionInfo, error)

    // --- V2: 子 Agent 协调 ---
    // OnSubAgentEvent is called by the executor when a sub-agent spawn/complete event
    // is detected in the parent's output. The adapter may respond via stdin.
    OnSubAgentEvent(ctx context.Context, stdin io.Writer, event SubAgentEvent) error

    // --- V2: 交互式控制 ---
    // BuildInterruptCommand returns the control message to send for graceful interrupt.
    // Returns nil if graceful interrupt is not supported (hard kill only).
    BuildInterruptCommand() *ControlMessage

    // BuildSteerCommand returns the control message to inject a mid-turn message.
    BuildSteerCommand(content string) *ControlMessage
}
```

### 2.2 扩展接口（可选）

支持某项能力的适配器通过可检查接口暴露它。ProcessExecutor 使用类型断言：

```go
// SessionLister — CLI persists sessions across invocations.
type SessionLister interface {
    ListSessions(ctx context.Context) ([]SessionInfo, error)
}

// SessionForker — CLI supports forking session history.
type SessionForker interface {
    ForkSession(ctx context.Context, sourceSessionID string, mode ForkMode) (*SessionInfo, error)
}

// MessageReplayer — CLI can replay messages from a session.
type MessageReplayer interface {
    GetSessionMessages(ctx context.Context, sessionID string) ([]AgentMessage, error)
}

// SubAgentCoordinator — adapter intercepts sub-agent lifecycle events.
type SubAgentCoordinator interface {
    OnSubAgentEvent(ctx context.Context, stdin io.Writer, event SubAgentEvent) error
}

// InteractiveController — adapter supports mid-turn steer/interrupt via stdin.
type InteractiveController interface {
    BuildInterruptCommand() *ControlMessage
    BuildSteerCommand(content string) *ControlMessage
}
```

### 2.3 能力矩阵

```go
type AgentCapabilities struct {
    // V1
    Streaming       bool
    ToolCalls       bool
    FileChanges     bool
    PermissionHooks bool
    ThinkingVisible bool
    MultiTurn       bool
    MCPIntegration  bool
    SubAgentSpawn   bool

    // V2
    SessionPersist   bool // 会话在进程退出后仍然存在
    SessionFork      bool // 可以分叉会话历史
    MessageReplay    bool // 可以在事后重放消息
    InteractiveSteer bool // 支持中间轮次消息注入
    GracefulInterrupt bool // 支持优雅取消（先排空再终止）
    StructuredDiff   bool // 发出带 path/action/diff 的结构化文件变更事件
    SubAgentLifecycle bool // 追踪子 Agent 启动/进度/完成生命周期
}

// 适配器能力矩阵：
//
// | 能力                | Claude Code | Codex      | OpenCode   |
// |---------------------|-------------|------------|------------|
// | SessionPersist      | true        | true       | true       |
// | SessionFork         | true        | false (P2) | false (P2) |
// | MessageReplay       | true        | false (P2) | false (P2) |
// | InteractiveSteer    | true        | false      | false      |
// | GracefulInterrupt   | true        | true       | true       |
// | StructuredDiff      | true        | false      | false      |
// | SubAgentLifecycle   | true        | false      | false      |
```

---

## 3. 多轮会话管理

### 3.1 状态机

```
                    ┌──────────┐
                    │  IDLE    │
                    └────┬─────┘
                         │ Start(prompt)
                         v
                    ┌──────────┐
              ┌────>│ RUNNING  │<────┐
              │     └────┬─────┘     │
              │          │           │
              │   Resume │           │ Steer
              │   (--resume)         │ (control_request)
              │          │           │
              │     ┌────v─────┐     │
              │     │ DRAINING │     │
              │     └────┬─────┘     │
              │          │           │
              │          │ Cancel    │
              │          v           │
              │     ┌──────────┐     │
              └─────│CANCELLED │     │
                    └──────────┘     │
                                     │
                    ┌──────────┐     │
                    │ FAILED   │<────┘ (error)
                    └──────────┘
                    ┌──────────┐
                    │ FINISHED │
                    └──────────┘
```

### 3.2 会话连续性流程

```
User -> Desktop UI -> Edge REST API -> ProcessExecutor
                                          |
                                          v
                                    BuildCommand(runCtx)
                                          |
                          ┌───────────────┼───────────────┐
                          │               │               │
                    ctx.SessionID    ctx.Continue    (新会话)
                          │               │               │
                          v               v               v
                    --resume <id>   --continue      (无标志)
                          │               │               │
                          └───────────────┴───────────────┘
                                          │
                                          v
                                    ParseStream()
                                          │
                              ┌───────────┴───────────┐
                              │                       │
                         run.agent.              run.finished
                         session_init            (存储 sessionId)
```

### 3.3 Session ID 追踪

`ParseStream` 方法必须从 CLI 输出中提取 session ID 并返回。建议变更：ParseStream 返回 session ID。

```go
// ParseStream reads from stdout, emits events, and returns the session ID
// assigned by the CLI (if available).
ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) (sessionID string, err error)
```

Claude Code 在 `system/init` 消息中发出 session ID。OpenCode 在 `step_start` 中发出。Codex 在其 JSONL 结果中发出。解析器已经捕获了这些数据 — 只需将其暴露即可。

### 3.4 实现：ProcessExecutor 变更

```go
// 在 run() 中：
sessionID, err := adapter.ParseStream(ctx, stdout, stdin, emitter, run)

// 将 session ID 存储到 run 记录上以供未来 --resume 使用
if sessionID != "" {
    e.store.SetRunSessionID(run.ID, sessionID)
}
```

---

## 4. 子 Agent 管理

### 4.1 事件流

```
Claude Code Task tool invocation
          |
          v
NDJSON: system/subtype=task_started { taskId, toolUseId, description, taskType }
          |
          v
Parser emits: run.agent.task_started -> Bus
          |
          v
ProcessExecutor intercepts: spawns sub-process via Registry
          |
          v
NDJSON: system/subtype=task_progress { taskId, description, lastToolName, usage }
          |
          v
Parser emits: run.agent.task_progress -> Bus
          |
          v
NDJSON: system/subtype=task_notification { taskId, status: "completed"/"failed", summary, usage }
          |
          v
Parser emits: run.agent.task_notification -> Bus
```

### 4.2 OrchestratorAdapter 增强

当前 `OrchestratorAdapter` 仅注入 system prompt。增强版拦截任务事件：

```go
func (a *OrchestratorAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) (string, error) {
    // 包装 emitter 以拦截 task_started/task_notification
    interceptEmitter := &subAgentInterceptEmitter{
        inner:      emitter,
        orchestrator: a,
        stdin:      stdin,
        ctx:        ctx,
    }
    parser := NewNDJSONStreamParser(interceptEmitter, run)
    if stdin != nil {
        parser.WithControlHandler(a.permissionHandler, stdin)
    }
    err := parser.Parse(ctx, stdout)
    return parser.SessionID(), err
}

// subAgentInterceptEmitter intercepts task events and spawns sub-agents.
type subAgentInterceptEmitter struct {
    inner        EventEmitter
    orchestrator *OrchestratorAdapter
    stdin        io.Writer
    ctx          context.Context
}

func (e *subAgentInterceptEmitter) Emit(eventType string, scope map[string]any, payload any) {
    if eventType == BusEventTaskStarted {
        // 解析任务描述以确定调度哪个 agent
        if agentID := e.orchestrator.resolveSubAgent(payload); agentID != "" {
            // 派生子 Agent 运行（异步）
            go e.orchestrator.spawnSubAgent(e.ctx, agentID, payload, scope)
        }
    }
    e.inner.Emit(eventType, scope, payload)
}
```

### 4.3 子 Agent 派生协议

```go
type SubAgentEvent struct {
    EventType   string // "started"、"progress"、"completed"、"failed"
    TaskID      string
    ToolUseID   string
    AgentID     string // 从任务描述/类型解析
    Description string
    Status      string
    Summary     string
    Usage       any
}

type SubAgentRunRequest struct {
    ParentRunID    string
    TaskID         string
    AgentID        string
    Description    string
    Model          string
    PermissionMode string
    WorkDir        string
    DelegationDepth int
}
```

### 4.4 循环检测集成

```go
// 在 ProcessExecutor.Start() 中 — 派生子 Agent 之前：
func (e *ProcessExecutor) spawnSubAgent(ctx context.Context, req SubAgentRunRequest) error {
    // 检查委托深度
    if req.DelegationDepth >= MaxDelegationDepth {
        return ErrMaxDelegationDepth
    }

    // 检查委托路径中的循环
    if e.cycleGuard.HasCycle(req.AgentID, req.ParentRunID) {
        return ErrDelegationCycle
    }

    // 创建子 run
    run, err := e.store.CreateRun(/*...*/)
    // 启动子进程
    return e.Start(run, RunProcessContext{
        Prompt:           req.Description,
        AgentID:          req.AgentID,
        Model:            req.Model,
        PermissionMode:   req.PermissionMode,
        WorkDir:          req.WorkDir,
        DelegationDepth:  req.DelegationDepth + 1,
    })
}
```

---

## 5. 权限拦截

### 5.1 架构

```
CLI stdout: control_request (can_use_tool)
          |
          v
NDJSON Parser detects type="control_request"
          |
          v
ControlHandler.HandleControlRequest()
          |
          v
┌─────────────────────────────────────────┐
│         PolicyEngine（新增）            │
│                                         │
│  优先级链：                             │
│  1. 会话规则（用户决策）                │
│  2. Agent 规则（agent 配置）            │
│  3. 项目规则（.agenthub/）             │
│  4. 系统默认值                          │
│                                         │
│  决策：allow | deny | escalate          │
└──────────────┬──────────────────────────┘
               |
               v (如 escalate)
┌──────────────────────────────────────────┐
│  事件总线：approval.requested            │
│  Desktop UI：显示批准对话框              │
│  用户：accept/acceptForThread/decline    │
│  Desktop -> Edge：POST /v1/approvals     │
│  Edge -> stdin：control_response         │
└──────────────────────────────────────────┘
```

### 5.2 PolicyEngine 接口

```go
// PolicyEngine evaluates permission requests against configured rules.
type PolicyEngine interface {
    // Evaluate determines the decision for a tool permission request.
    // Returns the first matching rule's action.
    Evaluate(ctx context.Context, req PermissionRequest) (*PermissionDecision, error)

    // RecordDecision stores a user decision for future requests in this session.
    RecordDecision(ctx context.Context, req PermissionRequest, decision *PermissionDecision) error

    // AddRule adds or updates a policy rule.
    AddRule(rule PolicyRule) error

    // RemoveRule removes a policy rule by ID.
    RemoveRule(ruleID string) error
}

// PermissionRequest carries the tool call context.
type PermissionRequest struct {
    SessionID     string
    RunID         string
    ThreadID       string
    AgentID       string
    ToolName      string
    ToolCallID    string
    ToolInput     map[string]any
    RiskLevel     RiskLevel
    IsDestructive bool
}

// 工具风险等级分类：
//
// | 工具      | 风险  | 破坏性    |
// |-----------|---------|-------------|
// | Read      | low     | false       |
// | Grep      | low     | false       |
// | Glob      | low     | false       |
// | Bash(*)   | dynamic | dynamic     |
// | Write     | high    | true        |
// | Edit      | high    | true        |
// | Task      | medium  | false       |
// | WebFetch  | medium  | false       |
// | WebSearch | low     | false       |

// Bash 命令的预定义风险模式：
var BashRiskPatterns = []RiskPattern{
    {Pattern: `\brm\s+.*-rf?\b`, Level: RiskHigh, Destructive: true},
    {Pattern: `\bgit\s+push\b`, Level: RiskHigh, Destructive: true},
    {Pattern: `\bcurl.*\|.*sh\b`, Level: RiskHigh, Destructive: true},
    {Pattern: `\bsudo\b`, Level: RiskHigh, Destructive: true},
    {Pattern: `\bnpm\s+(publish|deploy)\b`, Level: RiskHigh, Destructive: true},
    {Pattern: `\bgit\s+(status|log|diff|branch)\b`, Level: RiskLow, Destructive: false},
    {Pattern: `\bnpm\s+(test|run|install)\b`, Level: RiskMedium, Destructive: true},
}
```

### 5.3 PermissionHandler v2

```go
// PolicyAwarePermissionHandler replaces DefaultPermissionHandler.
type PolicyAwarePermissionHandler struct {
    engine     PolicyEngine
    emitter    EventEmitter
    pendingReq map[string]*PermissionRequest // requestID -> request（等待 UI 决策）
    mu         sync.Mutex
}

func (h *PolicyAwarePermissionHandler) HandleControlRequest(ctx context.Context, stdin io.Writer, msg ControlMessage) error {
    var inner ControlRequestInner
    json.Unmarshal(msg.Request, &inner)

    switch inner.Subtype {
    case "can_use_tool":
        return h.handleCanUseTool(ctx, stdin, msg.RequestID, &inner)
    case "initialize":
        return nil // 确认会话初始化
    case "interrupt":
        return nil // CLI 正在确认我们的中断
    default:
        return nil
    }
}

func (h *PolicyAwarePermissionHandler) handleCanUseTool(ctx context.Context, stdin io.Writer, requestID string, inner *ControlRequestInner) error {
    req := PermissionRequest{
        ToolName:   inner.ToolName,
        ToolCallID: inner.ToolUseID,
        ToolInput:  inner.Input,
    }

    decision, err := h.engine.Evaluate(ctx, req)
    if err != nil || decision.Behavior == "ask_user" {
        // 升级到 UI
        h.mu.Lock()
        h.pendingReq[requestID] = &req
        h.mu.Unlock()

        h.emitter.Emit(BusEventPermissionRequested, scope, map[string]any{
            "requestId": requestID,
            "toolName":  inner.ToolName,
            "toolInput": inner.Input,
            "riskLevel": decision.RiskLevel,
        })
        // UI 将通过 REST API 响应 -> writeDecisionResponse()
        return nil // 暂时不响应
    }

    return h.writeDecision(stdin, requestID, inner.ToolUseID, decision)
}

// writeDecisionResponse is called when the UI sends a decision via REST.
func (h *PolicyAwarePermissionHandler) WriteDecisionResponse(stdin io.Writer, requestID string, decision PermissionDecision) error {
    return h.writeDecision(stdin, requestID, decision.ToolUseID, &decision)
}
```

---

## 6. 结构化 Diff 追踪

### 6.1 问题

当前 NDJSON 解析器发出的 `file_change` 事件使用了错误的载荷结构：

```json
// 当前（错误 — 来自 parser_ndjson.go:264-270）：
{
  "type": "run.agent.file_change",
  "payload": {
    "runId": "run_1",
    "callId": "toolu_xxx",
    "toolName": "Write",
    "content": "<write-tool-output-string>",
    "isError": false
  }
}

// 目标（匹配 events.md:145 和 shared types events.ts:120-129）：
{
  "type": "run.agent.file_change",
  "payload": {
    "runId": "run_1",
    "path": "src/app.ts",
    "action": "modified",
    "diff": "@@ -1,3 +1,4 @@\n ..."
  }
}
```

### 6.2 解决方案：工具感知的 Diff 提取

```go
// FileChangeExtractor parses tool output to extract structured file change info.
type FileChangeExtractor struct {
    toolNames map[string]string // toolUseID -> toolName
}

// Extract attempts to extract structured file change info from a tool result.
func (e *FileChangeExtractor) Extract(toolUseID, toolName, content string, isError bool) *FileChangePayload {
    if isError || !isFileModifyingTool(toolName) {
        return nil
    }

    switch toolName {
    case "Write":
        return e.extractWrite(content)
    case "Edit":
        return e.extractEdit(content)
    default:
        return nil
    }
}

func (e *FileChangeExtractor) extractWrite(content string) *FileChangePayload {
    // Claude Code Write 工具输出格式：
    // "Wrote contents to /path/to/file"
    // 或
    // "File created: /path/to/file"
    path := extractFilePath(content)
    if path == "" {
        return nil
    }
    action := "modified"
    if strings.Contains(content, "created") || strings.Contains(content, "Wrote new") {
        action = "created"
    }
    return &FileChangePayload{
        Path:   path,
        Action: action,
    }
}

func (e *FileChangeExtractor) extractEdit(content string) *FileChangePayload {
    // Claude Code Edit 工具输出格式：
    // "The file /path/to/file has been updated.\nWhen you're done..."
    path := extractFilePath(content)
    if path == "" {
        return nil
    }
    return &FileChangePayload{
        Path:   path,
        Action: "modified",
    }
}
```

### 6.3 Diff 提取策略

| 工具 | Diff 来源 | 提取方法 |
|---|---|---|
| Write | 写入后执行 `git diff` | WorkspaceProvider.GetDiff(path) |
| Edit | 编辑后执行 `git diff` | WorkspaceProvider.GetDiff(path) |
| Bash (git) | stdout | 从输出中解析 unified diff |

对于 P0 实现，从工具输出字符串中提取 `path` 和 `action`。完整的 diff 内容由 Desktop UI 通过 REST 端点按需获取（如 `GET /v1/runs/:runId/files/:path/diff`），该端点在 workspace 中运行 `git diff`。

### 6.4 实现：NDJSON 解析器变更

```go
// 在 emitToolResult（parser_ndjson.go:252-274）中：
func (p *NDJSONStreamParser) emitToolResult(scope map[string]any, msg *claudeSDKMessage) {
    if msg.Message == nil { return }
    for _, block := range msg.Message.Content {
        if block.Type == "tool_result" {
            p.emit(scope, BusEventToolResult, map[string]any{
                "callId":  block.ToolUseID,
                "toolName": p.toolNames[block.ToolUseID],
                "output":   block.Content, // 修复：使用 "output" 而非 "content"
                "isError": block.IsError,
            })

            // 发出带 path/action 的结构化 file_change
            if fc := p.fileChangeExtractor.Extract(
                block.ToolUseID,
                p.toolNames[block.ToolUseID],
                block.Content,
                block.IsError,
            ); fc != nil {
                p.emit(scope, BusEventFileChange, map[string]any{
                    "path":   fc.Path,
                    "action": fc.Action,
                })
            }
        }
    }
}
```

---

## 7. 中断信号协议

### 7.1 两阶段取消

```
User clicks "Stop" in Desktop
          |
          v
Desktop -> Edge: POST /v1/runs/:id/cancel
          |
          v
Edge ProcessExecutor.Cancel(runID)
          |
          ┌──────────────────────────┐
          │ 阶段 1：优雅排空          │
          │（如支持 GracefulInterrupt）│
          │                          │
          │ WriteInterrupt(stdin)    │
          │ 最多等待 5s：            │
          │  - run.agent.result      │
          │  - 进程退出              │
          │  - 排空超时              │
          └──────────┬───────────────┘
                     │
                     │ 超时或不支持优雅中断
                     v
          ┌──────────────────────────┐
          │ 阶段 2：硬终止             │
          │                          │
          │ ctx.Cancel()             │
          │ 进程收到 SIGTERM          │
          │ 最多等待 3s               │
          │ 如卡住则 Process.Kill()   │
          └──────────────────────────┘
                     │
                     v
          Store status -> "cancelled"
          Emit run.cancelled -> Bus
```

### 7.2 实现

```go
func (e *ProcessExecutor) Cancel(runID string) CancelResult {
    // ... 现有验证 ...

    // 尝试通过适配器进行优雅中断
    if controller, ok := e.adapter.(InteractiveController); ok {
        if interrupt := controller.BuildInterruptCommand(); interrupt != nil {
            e.mu.Lock()
            stdin := e.stdins[runID]
            e.mu.Unlock()

            if stdin != nil {
                WriteInterrupt(stdin, "interrupt-"+runID)

                // 等待优雅排空（最多 GracefulDrainTimeout）
                select {
                case <-e.drainCh[runID]:
                    // 干净退出 — 继续状态更新
                case <-time.After(GracefulDrainTimeout):
                    // 超时 — 回退到硬终止
                }
            }
        }
    }

    // 硬终止
    if cancel, ok := e.running[runID]; ok {
        cancel()
    }

    // ... 状态更新并发出 run.cancelled ...
}
```

### 7.3 GracefulDrainTimeout

| 适配器 | 优雅中断 | 预计排空时间 |
|---|---|---|
| Claude Code | 是（control_request: interrupt） | 完成当前 API 调用 + 刷新状态（约 5s） |
| Codex | 否（仅 context cancel） | 不适用 — 硬终止 |
| OpenCode | 否（仅 context cancel） | 不适用 — 硬终止 |

---

## 8. 双向通信模型

### 8.1 当前状态（v1）

```
CLI stdout  ────> NDJSON Parser ────> Event Bus
CLI stdin   <──── ControlHandler（仅权限自动批准）
```

### 8.2 目标状态（v2）

```
CLI stdout  ────> NDJSON Parser ────> Event Bus
                      │
                      │ 检测到 control_request
                      v
               ControlDispatcher
                      │
          ┌───────────┼───────────────┐
          │           │               │
          v           v               v
    Permission    Session        SubAgent
    Handler       Handler        Handler
          │           │               │
          └───────────┴───────────────┘
                      │
                      │ control_response
                      v
CLI stdin   <──── ControlDispatcher
```

### 8.3 控制消息类型

| 子类型 | 方向 | 用途 | 阶段 |
|---|---|---|---|
| `can_use_tool` | CLI -> Edge | 工具执行前的权限请求 | P0 |
| `initialize` | CLI -> Edge | 会话初始化握手 | P0 |
| `interrupt` | Edge -> CLI | 优雅停止请求 | P0 |
| `set_model` | Edge -> CLI | 会话中切换模型 | P1 |
| `set_permission_mode` | Edge -> CLI | 会话中变更权限模式 | P1 |
| `stop_task` | Edge -> CLI | 取消正在运行的子 Agent 任务 | P1 |
| `steer_message` | Edge -> CLI | 注入中间轮次用户消息 | P2 |

### 8.4 通过控制协议的 Session Manager

```go
// SessionManager provides session-level operations via stdin control.
type SessionManager struct {
    stdin io.Writer
    mu    sync.Mutex
}

func (m *SessionManager) SetModel(model string) error {
    return WriteSetModel(m.stdin, genRequestID(), model)
}

func (m *SessionManager) SetPermissionMode(mode string) error {
    return WriteSetPermissionMode(m.stdin, genRequestID(), mode)
}

func (m *SessionManager) StopTask(taskID string) error {
    return WriteStopTask(m.stdin, genRequestID(), taskID)
}
```

---

## 9. 事件总线完整性

### 9.1 所有适配器发出的事件

| 事件 | 发出者 | 解析器位置 | Desktop 消费 | 优先级 |
|---|---|---|---|---|
| `run.agent.text_delta` | 全部 3 个 | 各适配器 | 是 | — |
| `run.agent.text_block` | NDJSON | parseAssistantMessage | 是 | — |
| `run.agent.thinking` | NDJSON, OpenCode | parseAssistantMessage, dispatch | 是 | — |
| `run.agent.tool_call` | 全部 3 个 | 各适配器 | 是（状态修复待完成） | P0 |
| `run.agent.tool_result` | NDJSON, Codex | emitToolResult, dispatchCodexEvent | 是（字段名修复） | P0 |
| `run.agent.file_change` | NDJSON | emitToolResult | 是（**载荷损坏**） | P0 |
| `run.agent.session_init` | NDJSON, OpenCode | emitSessionInit, dispatch | 是 | — |
| `run.agent.result` | 全部 3 个 | parseResult, dispatch | 是（**tokenUsage 修复**） | P0 |
| `run.agent.compact_boundary` | NDJSON | emitCompactBoundary | **否** | P1 |
| `run.agent.status_change` | NDJSON | emitStatusChange | **否** | P1 |
| `run.agent.api_retry` | NDJSON | emitAPIRetry | **否** | P1 |
| `run.agent.task_started` | NDJSON | emitTaskStarted | **否** | P1 |
| `run.agent.task_progress` | NDJSON | emitTaskProgress | **否** | P1 |
| `run.agent.task_notification` | NDJSON | emitTaskNotification | **否** | P1 |
| `run.agent.session_state_changed` | NDJSON, OpenCode | emitSessionStateChanged, dispatch | **否** | P1 |
| `run.agent.hook_started` | NDJSON | emitHookStarted | **否** | P2 |
| `run.agent.hook_progress` | NDJSON | emitHookProgress | **否** | P2 |
| `run.agent.hook_response` | NDJSON | emitHookResponse | **否** | P2 |
| `run.agent.tool_use_summary` | NDJSON | tool_use_summary case | **否** | P2 |
| `run.agent.auth_status` | NDJSON | auth_status case | **否** | P2 |
| `run.agent.rate_limit` | NDJSON | rate_limit_event case | **否** | P2 |
| `run.agent.permission_requested` | PolicyEngine | PermissionHandler | **否**（新增） | P1 |

### 9.2 待添加的新事件

```go
const (
    // 新增：权限事件
    BusEventPermissionRequested = "run.agent.permission_requested" // P0
    BusEventPermissionDecided   = "run.agent.permission_decided"   // P0

    // 新增：子 Agent 生命周期（已定义但尚未完全发出）
    // BusEventTaskStarted、BusEventTaskProgress、BusEventTaskNotification — 已存在
)
```

---

## 10. 实施路线图

### 阶段 0：修复阻塞性 Bug（1-2 天）

| # | 变更 | 文件 | 影响 |
|---|---|---|---|
| P0.1 | 修复 `file_change` 载荷：发出 `{path, action, diff?}` | `parser_ndjson.go:264-270`、`events.ts:120-129` | 解除文件变更卡片阻塞 |
| P0.2 | 修复 `result` 载荷：同时发出 `tokenUsage` 和 `usage` | `parser_ndjson.go:223-239`、`codex.go:207-222`、`opencode.go:158-177`、`events.ts:142-154` | 解除 Token 显示阻塞 |
| P0.3 | 修复 `tool_result` 载荷：发出 `output` 而非 `content` | `parser_ndjson.go:258-262`、`events.ts:109-118` | 解除工具输出显示阻塞 |
| P0.4 | 将 `run.cancelled` 添加到 RunLifecycleEvent 联合类型；在 Desktop 中处理 | `events.ts:30-40`、`useChatMessages.ts` | 修复取消后的流式游标 |
| P0.5 | 添加 `tool_call` 状态值：`"started"`、`"in_progress"` | `events.ts:104`、`useChatMessages.ts:171` | 修复工具状态显示 |

### 阶段 1：核心架构（3-5 天）

| # | 变更 | 文件 | 影响 |
|---|---|---|---|
| P1.1 | 重构 `AgentAdapter` 接口：添加 `ListSessions`、`ForkSession`、`GetSessionMessages` | `adapter.go`、全部 3 个适配器 | 多轮会话 |
| P1.2 | 实现 `PolicyAwarePermissionHandler` + `PolicyEngine` | 新文件：`permission.go`、`policy_engine.go` | 权限拦截 |
| P1.3 | 实现 `FileChangeExtractor` | `parser_ndjson.go`（修改）、新文件 `file_change.go` | 结构化 diff |
| P1.4 | 实现两阶段取消（`GracefulInterrupt` + 硬终止） | `process_executor.go`、`adapter.go` | 中断信号 |
| P1.5 | 实现 `ControlDispatcher` 用于路由控制消息 | `control_protocol.go`（增强）、新文件 `control_dispatcher.go` | 双向通信 |
| P1.6 | 在 Desktop 中处理 `run.agent.session_state_changed` + `task_*` 事件 | `useChatMessages.ts`、`ChatView.types.ts`、`ChatView.tsx` | 子 Agent 可视化 |

### 阶段 2：子 Agent 编排（3-5 天）

| # | 变更 | 文件 | 影响 |
|---|---|---|---|
| P2.1 | 实现 `SubAgentCoordinator` 接口 + `subAgentInterceptEmitter` | `orchestrator.go`（增强）、新文件 `subagent_coordinator.go` | 子 Agent 拦截 |
| P2.2 | 实现 `CycleGuard` + `DelegationContext` | 新文件：`cycle_guard.go` | 循环检测 |
| P2.3 | 在 `ProcessExecutor` 中实现子 Agent 派生 | `process_executor.go` | 子 Agent 执行 |
| P2.4 | 在 Desktop 中处理 `hook_*` + `compact_boundary` + `auth_status` + `rate_limit` | `useChatMessages.ts`、`ChatView.tsx` | 全覆盖事件 |

### 阶段 3：打磨（2-3 天）

| # | 变更 | 文件 | 影响 |
|---|---|---|---|
| P3.1 | 为 Claude Code 适配器添加 `InteractiveController` | `claude_code.go` | 引导 + 会话中模型切换 |
| P3.2 | 会话重放 API 端点 | `handlers.go`、新文件 `session_handler.go` | 通过 REST 获取会话历史 |
| P3.3 | 所有 v2 能力的集成测试 | `*_integration_test.go` | 质量保证 |

---

## 11. 迁移策略

### 11.1 向后兼容

v1 `AgentAdapter` 接口是 v2 的子集。所有现有适配器无需修改即可通过 v2 编译。新方法返回合理默认值：

```go
// 默认实现（可覆盖）：
func (a *BaseAdapter) ListSessions(ctx context.Context) ([]SessionInfo, error) {
    return nil, ErrNotSupported
}
func (a *BaseAdapter) ForkSession(ctx context.Context, sourceSessionID string, mode ForkMode) (*SessionInfo, error) {
    return nil, ErrNotSupported
}
func (a *BaseAdapter) OnSubAgentEvent(ctx context.Context, stdin io.Writer, event SubAgentEvent) error {
    return nil // 空操作
}
```

### 11.2 能力检测

调用方在使用功能前检查能力：

```go
if cap := adapter.Capabilities(); cap.SessionPersist {
    sessions, _ := adapter.ListSessions(ctx)
}
```

### 11.3 ParseStream 签名变更

```go
// V1: ParseStream(ctx, stdout, stdin, emitter, run) error
// V2: ParseStream(ctx, stdout, stdin, emitter, run) (string, error)
//
// 迁移：ProcessExecutor 如不需要可忽略 sessionID 返回值。
// 多返回值对于使用 `_` 的调用方是向后兼容的。
```

---

## 12. 文件变更摘要

### 新增文件

| 文件 | 内容 |
|---|---|
| `edge-server/internal/adapters/permission.go` | `PolicyEngine` 接口 + 默认实现 |
| `edge-server/internal/adapters/policy_engine.go` | 基于规则的权限决策引擎 |
| `edge-server/internal/adapters/file_change.go` | `FileChangeExtractor` 用于结构化 diff 追踪 |
| `edge-server/internal/adapters/control_dispatcher.go` | `ControlDispatcher` 将控制消息路由到处理器 |
| `edge-server/internal/adapters/session_manager.go` | `SessionManager` 通过 stdin 进行会话中控制 |
| `edge-server/internal/adapters/subagent_coordinator.go` | `SubAgentCoordinator` 接口 + 拦截 emitter |
| `edge-server/internal/adapters/cycle_guard.go` | `CycleGuard` 用于委托循环检测 |

### 修改文件

| 文件 | 变更 |
|---|---|
| `adapter.go` | V2 接口：添加会话管理、子 Agent、交互式控制方法；新增扩展接口 |
| `parser_ndjson.go` | 修复 `file_change` 载荷（P0.1）、修复 `tool_result` 载荷（P0.3）、修复 `result` 载荷（P0.2）、添加 `FileChangeExtractor`、暴露 `SessionID()` |
| `process_executor.go` | 两阶段取消（P1.4）、子 Agent 派生（P2.3）、session ID 追踪（P3.2） |
| `claude_code.go` | 实现 `InteractiveController`、`SessionManager` |
| `codex.go` | 修复 `result` 载荷（P0.2）、如可用则实现 SessionLister |
| `opencode.go` | 修复 `result` 载荷（P0.2）、如可用则实现 SessionLister |
| `orchestrator.go` | 子 Agent 拦截（P2.1） |
| `control_protocol.go` | 添加 `steer_message` 子类型 |

### 共享类型变更（Desktop）

| 文件 | 变更 |
|---|---|
| `app/shared/src/events.ts` | 添加 `run.cancelled`、修复 `file_change` 载荷、添加 `usage` 回退、添加 `started`/`in_progress` 状态、添加新事件类型 |
| `app/shared/src/types.ts` | 添加 `SessionInfo`、`ForkRequest` 类型 |
| `app/desktop/src/hooks/useChatMessages.ts` | 处理 `run.cancelled`、`run.queued`、修复 `tokenUsage`、修复 `tool_result` 输出 |
| `app/desktop/src/components/ChatView.types.ts` | 添加 `task_*`、`compact_boundary`、`tool_use_summary` 块类型 |

---

## 附录 A：关键类型定义

### A.1 RunProcessContext（增强版）

```go
type RunProcessContext struct {
    Run               store.Run
    Prompt            string
    AgentID           string
    AgentName         string
    Model             string
    WorkDir           string
    SessionID         string
    ContinueLast      bool
    ForkSession       bool
    ReasoningEffort   string
    MaxThinkingTokens int
    PermissionMode    string
    IncludePartial    bool
    FastMode          bool

    // V2 新增
    DelegationDepth    int      // 当前委托深度（0 = 用户请求）
    DelegationPath     []string // 委托到此 run 的 agent ID 链
    ParentRunID        string   // 父 run ID（用于子 Agent）
    ParentTaskID      string   // 编排器中的父任务 ID
    CycleGuard         *CycleGuard // 委托循环检测守卫
}
```

### A.2 SessionInfo

```go
type SessionInfo struct {
    ID           string    `json:"id"`
    Title        string    `json:"title"`
    Project      string    `json:"project"`
    CreatedAt    int64     `json:"createdAt"`
    UpdatedAt    int64     `json:"updatedAt"`
    MessageCount int       `json:"messageCount"`
    Model        string    `json:"model"`
    Status       string    `json:"status"` // "active"、"completed"、"cancelled"
}
```

### A.3 ForkMode

```go
type ForkMode struct {
    Mode     string `json:"mode"`     // "full"、"last_n_turns"
    NumTurns int    `json:"numTurns"` // 仅在 Mode="last_n_turns" 时使用
}
```

### A.4 AgentMessage

```go
type AgentMessage struct {
    ID        string `json:"id"`
    SessionID string `json:"sessionId"`
    Role      string `json:"role"` // "user"、"assistant"、"system"
    Content   string `json:"content"`
    Type      string `json:"type"`
    Seq       int    `json:"seq"`
    Timestamp int64  `json:"timestamp"`
}
```
