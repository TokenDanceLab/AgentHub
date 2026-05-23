# Enhanced Adapter Architecture

Date: 2026-05-23
Status: Design (P0 scope)

## 1. Overview

### 1.1 Goals

The current `AgentAdapter` (v1) handles process launch and NDJSON/JSONL stream parsing. It works for single-turn batch runs but is incomplete for:

| Capability | v1 Status | Target |
|---|---|---|
| Multi-turn sessions | SessionID passthrough only | Full Start/Resume/List/Fork |
| Sub-agent management | System prompt only (Orchestrator) | Event interception, lifecycle tracking |
| Permission interception | Auto-approve default handler | Policy engine integration |
| Structured diff tracking | Broken payload shape | Tool-aware diff extraction |
| Interrupt signals | Context cancel + stdin write | Graceful drain before hard kill |
| Bidirectional comms | Permission auto-approve only | Session mgmt, steer, model switch |

### 1.2 Design Principles

1. **Adapter owns protocol, Executor owns lifecycle** — The adapter knows how to speak to the CLI; ProcessExecutor owns the OS process (start/wait/kill). This boundary is correct and preserved.
2. **Event-driven, not callback-driven** — All adapter output flows through the event bus. Control flows are request/response pairs on the bidirectional channel.
3. **Protocol-agnostic event types** — BusEvent constants are already protocol-agnostic. The adapter's ParseStream maps native protocol to these constants. Keep this mapping layer.
4. **Graceful degradation** — When a capability is not supported by the CLI, the adapter returns `false` in Capabilities(). Callers check before using.

---

## 2. Enhanced AgentAdapter Interface (v2)

### 2.1 Core Interface

```go
// AgentAdapter is the unified interface for all Agent CLI backends.
// V2 adds session management, sub-agent coordination, and structured output.
type AgentAdapter interface {
    // --- V1 (preserved) ---
    Metadata() AdapterMetadata
    Capabilities() AgentCapabilities
    BuildCommand(ctx RunProcessContext) (cmdPath string, args []string, env []string, workDir string)
    ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error

    // --- V2: Session management ---
    // ListSessions returns all known sessions for this adapter.
    ListSessions(ctx context.Context) ([]SessionInfo, error)

    // GetSessionMessages replays messages from a session.
    GetSessionMessages(ctx context.Context, sessionID string) ([]AgentMessage, error)

    // ForkSession creates a new session branching from an existing one.
    ForkSession(ctx context.Context, sourceSessionID string, mode ForkMode) (*SessionInfo, error)

    // --- V2: Sub-agent coordination ---
    // OnSubAgentEvent is called by the executor when a sub-agent spawn/complete event
    // is detected in the parent's output. The adapter may respond via stdin.
    OnSubAgentEvent(ctx context.Context, stdin io.Writer, event SubAgentEvent) error

    // --- V2: Interactive control ---
    // BuildInterruptCommand returns the control message to send for graceful interrupt.
    // Returns nil if graceful interrupt is not supported (hard kill only).
    BuildInterruptCommand() *ControlMessage

    // BuildSteerCommand returns the control message to inject a mid-turn message.
    BuildSteerCommand(content string) *ControlMessage
}
```

### 2.2 Extension Interfaces (Optional)

Adapters that support a capability expose it via a checked interface. ProcessExecutor uses type assertions:

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

### 2.3 Capability Matrix

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
    SessionPersist   bool // Sessions survive process exit
    SessionFork      bool // Can fork session history
    MessageReplay    bool // Can replay messages after the fact
    InteractiveSteer bool // Supports mid-turn message injection
    GracefulInterrupt bool // Supports graceful cancel (drain before kill)
    StructuredDiff   bool // Emits structured file change events with path/action/diff
    SubAgentLifecycle bool // Tracks sub-agent start/progress/complete lifecycle
}

// Adapter capability matrix:
//
// | Capability          | Claude Code | Codex      | OpenCode   |
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

## 3. Multi-Turn Session Management

### 3.1 State Machine

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

### 3.2 Session Continuity Flow

```
User -> Desktop UI -> Edge REST API -> ProcessExecutor
                                          |
                                          v
                                    BuildCommand(runCtx)
                                          |
                          ┌───────────────┼───────────────┐
                          │               │               │
                    ctx.SessionID    ctx.Continue    (new session)
                          │               │               │
                          v               v               v
                    --resume <id>   --continue      (no flag)
                          │               │               │
                          └───────────────┴───────────────┘
                                          │
                                          v
                                    ParseStream()
                                          │
                              ┌───────────┴───────────┐
                              │                       │
                         run.agent.              run.finished
                         session_init            (store sessionId)
```

### 3.3 Session ID Tracking

The `ParseStream` method must extract the session ID from the CLI's output and return it. Proposed change: ParseStream returns the session ID.

```go
// ParseStream reads from stdout, emits events, and returns the session ID
// assigned by the CLI (if available).
ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) (sessionID string, err error)
```

Claude Code emits the session ID in `system/init` messages. OpenCode emits it in `step_start`. Codex emits it in its JSONL results. The parser already captures this data — it just needs to expose it.

### 3.4 Implementation: ProcessExecutor Changes

```go
// In run():
sessionID, err := adapter.ParseStream(ctx, stdout, stdin, emitter, run)

// Store session ID on the run record for future --resume
if sessionID != "" {
    e.store.SetRunSessionID(run.ID, sessionID)
}
```

---

## 4. Sub-Agent Management

### 4.1 Event Flow

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

### 4.2 OrchestratorAdapter Enhancement

The current `OrchestratorAdapter` only injects a system prompt. The enhanced version intercepts task events:

```go
func (a *OrchestratorAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) (string, error) {
    // Wrap emitter to intercept task_started/task_notification
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
        // Parse the task description to determine which agent to dispatch
        if agentID := e.orchestrator.resolveSubAgent(payload); agentID != "" {
            // Spawn sub-agent run (async)
            go e.orchestrator.spawnSubAgent(e.ctx, agentID, payload, scope)
        }
    }
    e.inner.Emit(eventType, scope, payload)
}
```

### 4.3 Sub-Agent Spawn Protocol

```go
type SubAgentEvent struct {
    EventType   string // "started", "progress", "completed", "failed"
    TaskID      string
    ToolUseID   string
    AgentID     string // resolved from task description/type
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

### 4.4 Cycle Detection Integration

```go
// In ProcessExecutor.Start() — before spawning sub-agent:
func (e *ProcessExecutor) spawnSubAgent(ctx context.Context, req SubAgentRunRequest) error {
    // Check delegation depth
    if req.DelegationDepth >= MaxDelegationDepth {
        return ErrMaxDelegationDepth
    }

    // Check for cycles in delegation path
    if e.cycleGuard.HasCycle(req.AgentID, req.ParentRunID) {
        return ErrDelegationCycle
    }

    // Create sub-run
    run, err := e.store.CreateRun(/*...*/)
    // Start sub-process
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

## 5. Permission Interception

### 5.1 Architecture

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
│         PolicyEngine (new)              │
│                                         │
│  Priority chain:                        │
│  1. Session rules (user decisions)      │
│  2. Agent rules (agent config)          │
│  3. Project rules (.agenthub/)          │
│  4. System defaults                     │
│                                         │
│  Decision: allow | deny | escalate      │
└──────────────┬──────────────────────────┘
               |
               v (if escalate)
┌──────────────────────────────────────────┐
│  Event Bus: approval.requested           │
│  Desktop UI: show approval dialog        │
│  User: accept/acceptForThread/decline    │
│  Desktop -> Edge: POST /v1/approvals     │
│  Edge -> stdin: control_response         │
└──────────────────────────────────────────┘
```

### 5.2 PolicyEngine Interface

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

// Risk level classification for tools:
//
// | Tool      | Risk    | Destructive |
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

// Predefined risk patterns for Bash commands:
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
    pendingReq map[string]*PermissionRequest // requestID -> request (awaiting UI decision)
    mu         sync.Mutex
}

func (h *PolicyAwarePermissionHandler) HandleControlRequest(ctx context.Context, stdin io.Writer, msg ControlMessage) error {
    var inner ControlRequestInner
    json.Unmarshal(msg.Request, &inner)

    switch inner.Subtype {
    case "can_use_tool":
        return h.handleCanUseTool(ctx, stdin, msg.RequestID, &inner)
    case "initialize":
        return nil // acknowledge session init
    case "interrupt":
        return nil // CLI is acknowledging our interrupt
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
        // Escalate to UI
        h.mu.Lock()
        h.pendingReq[requestID] = &req
        h.mu.Unlock()

        h.emitter.Emit(BusEventPermissionRequested, scope, map[string]any{
            "requestId": requestID,
            "toolName":  inner.ToolName,
            "toolInput": inner.Input,
            "riskLevel": decision.RiskLevel,
        })
        // The UI will respond via REST API -> writeDecisionResponse()
        return nil // Don't respond yet
    }

    return h.writeDecision(stdin, requestID, inner.ToolUseID, decision)
}

// writeDecisionResponse is called when the UI sends a decision via REST.
func (h *PolicyAwarePermissionHandler) WriteDecisionResponse(stdin io.Writer, requestID string, decision PermissionDecision) error {
    return h.writeDecision(stdin, requestID, decision.ToolUseID, &decision)
}
```

---

## 6. Structured Diff Tracking

### 6.1 Problem

The current `file_change` event emitted by the NDJSON parser uses the wrong payload shape:

```json
// Current (WRONG — from parser_ndjson.go:264-270):
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

// Target (MATCHES events.md:145 and shared types events.ts:120-129):
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

### 6.2 Solution: Tool-Aware Diff Extraction

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
    // Claude Code Write tool output format:
    // "Wrote contents to /path/to/file"
    // or
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
    // Claude Code Edit tool output format:
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

### 6.3 Diff Extraction Strategy

| Tool | Diff Available From | Extraction Method |
|---|---|---|
| Write | After write, `git diff` | WorkspaceProvider.GetDiff(path) |
| Edit | After edit, `git diff` | WorkspaceProvider.GetDiff(path) |
| Bash (git) | stdout | Parse unified diff from output |

For a P0 implementation, extract `path` and `action` from tool output strings. Full diff content is fetched on-demand by the Desktop UI via a REST endpoint (e.g., `GET /v1/runs/:runId/files/:path/diff`), which runs `git diff` in the workspace.

### 6.4 Implementation: NDJSON Parser Changes

```go
// In emitToolResult (parser_ndjson.go:252-274):
func (p *NDJSONStreamParser) emitToolResult(scope map[string]any, msg *claudeSDKMessage) {
    if msg.Message == nil { return }
    for _, block := range msg.Message.Content {
        if block.Type == "tool_result" {
            p.emit(scope, BusEventToolResult, map[string]any{
                "callId":  block.ToolUseID,
                "toolName": p.toolNames[block.ToolUseID],
                "output":   block.Content, // FIXED: use "output" not "content"
                "isError": block.IsError,
            })

            // Emit structured file_change with path/action
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

## 7. Interrupt Signal Protocol

### 7.1 Two-Phase Cancel

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
          │ Phase 1: Graceful Drain  │
          │ (if GracefulInterrupt)   │
          │                          │
          │ WriteInterrupt(stdin)    │
          │ Wait up to 5s for:       │
          │  - run.agent.result      │
          │  - process exit          │
          │  - drain timeout         │
          └──────────┬───────────────┘
                     │
                     │ timeout or no graceful support
                     v
          ┌──────────────────────────┐
          │ Phase 2: Hard Kill       │
          │                          │
          │ ctx.Cancel()             │
          │ Process receives SIGTERM │
          │ Wait up to 3s            │
          │ Process.Kill() if stuck  │
          └──────────────────────────┘
                     │
                     v
          Store status -> "cancelled"
          Emit run.cancelled -> Bus
```

### 7.2 Implementation

```go
func (e *ProcessExecutor) Cancel(runID string) CancelResult {
    // ... existing validation ...

    // Try graceful interrupt via adapter
    if controller, ok := e.adapter.(InteractiveController); ok {
        if interrupt := controller.BuildInterruptCommand(); interrupt != nil {
            e.mu.Lock()
            stdin := e.stdins[runID]
            e.mu.Unlock()

            if stdin != nil {
                WriteInterrupt(stdin, "interrupt-"+runID)

                // Wait for graceful drain (up to GracefulDrainTimeout)
                select {
                case <-e.drainCh[runID]:
                    // Clean exit — proceed to status update
                case <-time.After(GracefulDrainTimeout):
                    // Timeout — fall through to hard kill
                }
            }
        }
    }

    // Hard kill
    if cancel, ok := e.running[runID]; ok {
        cancel()
    }

    // ... status update and emit run.cancelled ...
}
```

### 7.3 GracefulDrainTimeout

| Adapter | Graceful Interrupt | Expected Drain Time |
|---|---|---|
| Claude Code | Yes (control_request: interrupt) | Finishes current API call + flushes state (~5s) |
| Codex | No (context cancel only) | N/A — hard kill |
| OpenCode | No (context cancel only) | N/A — hard kill |

---

## 8. Bidirectional Communication Model

### 8.1 Current State (v1)

```
CLI stdout  ────> NDJSON Parser ────> Event Bus
CLI stdin   <──── ControlHandler (permission auto-approve only)
```

### 8.2 Target State (v2)

```
CLI stdout  ────> NDJSON Parser ────> Event Bus
                      │
                      │ control_request detected
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

### 8.3 Control Message Types

| Subtype | Direction | Purpose | Phase |
|---|---|---|---|
| `can_use_tool` | CLI -> Edge | Permission request before tool execution | P0 |
| `initialize` | CLI -> Edge | Session init handshake | P0 |
| `interrupt` | Edge -> CLI | Graceful stop request | P0 |
| `set_model` | Edge -> CLI | Mid-session model switch | P1 |
| `set_permission_mode` | Edge -> CLI | Mid-session permission change | P1 |
| `stop_task` | Edge -> CLI | Cancel a running sub-agent task | P1 |
| `steer_message` | Edge -> CLI | Inject mid-turn user message | P2 |

### 8.4 Session Manager via Control Protocol

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

## 9. Event Bus Completeness

### 9.1 All Adapter-Emitted Events

| Event | Emitter | Parser Location | Desktop Consumed | Priority |
|---|---|---|---|---|
| `run.agent.text_delta` | All 3 | Each adapter | Yes | — |
| `run.agent.text_block` | NDJSON | parseAssistantMessage | Yes | — |
| `run.agent.thinking` | NDJSON, OpenCode | parseAssistantMessage, dispatch | Yes | — |
| `run.agent.tool_call` | All 3 | Each adapter | Yes (status fix needed) | P0 |
| `run.agent.tool_result` | NDJSON, Codex | emitToolResult, dispatchCodexEvent | Yes (field name fix) | P0 |
| `run.agent.file_change` | NDJSON | emitToolResult | Yes (**broken payload**) | P0 |
| `run.agent.session_init` | NDJSON, OpenCode | emitSessionInit, dispatch | Yes | — |
| `run.agent.result` | All 3 | parseResult, dispatch | Yes (**tokenUsage fix**) | P0 |
| `run.agent.compact_boundary` | NDJSON | emitCompactBoundary | **No** | P1 |
| `run.agent.status_change` | NDJSON | emitStatusChange | **No** | P1 |
| `run.agent.api_retry` | NDJSON | emitAPIRetry | **No** | P1 |
| `run.agent.task_started` | NDJSON | emitTaskStarted | **No** | P1 |
| `run.agent.task_progress` | NDJSON | emitTaskProgress | **No** | P1 |
| `run.agent.task_notification` | NDJSON | emitTaskNotification | **No** | P1 |
| `run.agent.session_state_changed` | NDJSON, OpenCode | emitSessionStateChanged, dispatch | **No** | P1 |
| `run.agent.hook_started` | NDJSON | emitHookStarted | **No** | P2 |
| `run.agent.hook_progress` | NDJSON | emitHookProgress | **No** | P2 |
| `run.agent.hook_response` | NDJSON | emitHookResponse | **No** | P2 |
| `run.agent.tool_use_summary` | NDJSON | tool_use_summary case | **No** | P2 |
| `run.agent.auth_status` | NDJSON | auth_status case | **No** | P2 |
| `run.agent.rate_limit` | NDJSON | rate_limit_event case | **No** | P2 |
| `run.agent.permission_requested` | PolicyEngine | PermissionHandler | **No** (new) | P1 |

### 9.2 New Events to Add

```go
const (
    // New: Permission events
    BusEventPermissionRequested = "run.agent.permission_requested" // P0
    BusEventPermissionDecided   = "run.agent.permission_decided"   // P0

    // New: Sub-agent lifecycle (already defined but not fully emitted)
    // BusEventTaskStarted, BusEventTaskProgress, BusEventTaskNotification — existing
)
```

---

## 10. Implementation Roadmap

### Phase 0: Fix Blocking Bugs (1-2 days)

| # | Change | Files | Impact |
|---|---|---|---|
| P0.1 | Fix `file_change` payload: emit `{path, action, diff?}` | `parser_ndjson.go:264-270`, `events.ts:120-129` | Unblocks file change cards |
| P0.2 | Fix `result` payload: emit `tokenUsage` alongside `usage` | `parser_ndjson.go:223-239`, `codex.go:207-222`, `opencode.go:158-177`, `events.ts:142-154` | Unblocks token display |
| P0.3 | Fix `tool_result` payload: emit `output` not `content` | `parser_ndjson.go:258-262`, `events.ts:109-118` | Unblocks tool output display |
| P0.4 | Add `run.cancelled` to RunLifecycleEvent union; handle in Desktop | `events.ts:30-40`, `useChatMessages.ts` | Fixes streaming cursor after cancel |
| P0.5 | Add `tool_call` status values: `"started"`, `"in_progress"` | `events.ts:104`, `useChatMessages.ts:171` | Fixes tool status display |

### Phase 1: Core Architecture (3-5 days)

| # | Change | Files | Impact |
|---|---|---|---|
| P1.1 | Refactor `AgentAdapter` interface: add `ListSessions`, `ForkSession`, `GetSessionMessages` | `adapter.go`, all 3 adapters | Multi-turn sessions |
| P1.2 | Implement `PolicyAwarePermissionHandler` + `PolicyEngine` | New files: `permission.go`, `policy_engine.go` | Permission interception |
| P1.3 | Implement `FileChangeExtractor` | `parser_ndjson.go` (modify), new `file_change.go` | Structured diffs |
| P1.4 | Implement two-phase cancel (`GracefulInterrupt` + hard kill) | `process_executor.go`, `adapter.go` | Interrupt signals |
| P1.5 | Implement `ControlDispatcher` for routing control messages | `control_protocol.go` (enhance), new `control_dispatcher.go` | Bidirectional comms |
| P1.6 | Handle `run.agent.session_state_changed` + `task_*` events in Desktop | `useChatMessages.ts`, `ChatView.types.ts`, `ChatView.tsx` | Sub-agent visualization |

### Phase 2: Sub-Agent Orchestration (3-5 days)

| # | Change | Files | Impact |
|---|---|---|---|
| P2.1 | Implement `SubAgentCoordinator` interface + `subAgentInterceptEmitter` | `orchestrator.go` (enhance), new `subagent_coordinator.go` | Sub-agent interception |
| P2.2 | Implement `CycleGuard` + `DelegationContext` | New file: `cycle_guard.go` | Cycle detection |
| P2.3 | Implement sub-agent spawn in `ProcessExecutor` | `process_executor.go` | Sub-agent execution |
| P2.4 | Handle `hook_*` + `compact_boundary` + `auth_status` + `rate_limit` in Desktop | `useChatMessages.ts`, `ChatView.tsx` | Full event coverage |

### Phase 3: Polish (2-3 days)

| # | Change | Files | Impact |
|---|---|---|---|
| P3.1 | Add `InteractiveController` to Claude Code adapter | `claude_code.go` | Steer + mid-session model switch |
| P3.2 | Session replay API endpoint | `handlers.go`, new `session_handler.go` | Session history via REST |
| P3.3 | Integration tests for all v2 capabilities | `*_integration_test.go` | Quality assurance |

---

## 11. Migration Strategy

### 11.1 Backward Compatibility

The v1 `AgentAdapter` interface is a subset of v2. All existing adapters compile against v2 without changes. New methods return sensible defaults:

```go
// Default implementations (can be overridden):
func (a *BaseAdapter) ListSessions(ctx context.Context) ([]SessionInfo, error) {
    return nil, ErrNotSupported
}
func (a *BaseAdapter) ForkSession(ctx context.Context, sourceSessionID string, mode ForkMode) (*SessionInfo, error) {
    return nil, ErrNotSupported
}
func (a *BaseAdapter) OnSubAgentEvent(ctx context.Context, stdin io.Writer, event SubAgentEvent) error {
    return nil // No-op
}
```

### 11.2 Feature Detection

Callers check capabilities before using features:

```go
if cap := adapter.Capabilities(); cap.SessionPersist {
    sessions, _ := adapter.ListSessions(ctx)
}
```

### 11.3 ParseStream Signature Change

```go
// V1: ParseStream(ctx, stdout, stdin, emitter, run) error
// V2: ParseStream(ctx, stdout, stdin, emitter, run) (string, error)
//
// Migration: ProcessExecutor ignores the sessionID return if not needed.
// The multi-return is backward compatible for callers that use `_`.
```

---

## 12. File Changes Summary

### New Files

| File | Content |
|---|---|
| `edge-server/internal/adapters/permission.go` | `PolicyEngine` interface + default implementation |
| `edge-server/internal/adapters/policy_engine.go` | Rule-based permission decision engine |
| `edge-server/internal/adapters/file_change.go` | `FileChangeExtractor` for structured diff tracking |
| `edge-server/internal/adapters/control_dispatcher.go` | `ControlDispatcher` routing control messages to handlers |
| `edge-server/internal/adapters/session_manager.go` | `SessionManager` for mid-session control via stdin |
| `edge-server/internal/adapters/subagent_coordinator.go` | `SubAgentCoordinator` interface + intercept emitter |
| `edge-server/internal/adapters/cycle_guard.go` | `CycleGuard` for delegation cycle detection |

### Modified Files

| File | Changes |
|---|---|
| `adapter.go` | V2 interface: add session mgmt, sub-agent, interactive control methods; new extension interfaces |
| `parser_ndjson.go` | Fix `file_change` payload (P0.1), fix `tool_result` payload (P0.3), fix `result` payload (P0.2), add `FileChangeExtractor`, expose `SessionID()` |
| `process_executor.go` | Two-phase cancel (P1.4), sub-agent spawn (P2.3), session ID tracking (P3.2) |
| `claude_code.go` | Implement `InteractiveController`, `SessionManager` |
| `codex.go` | Fix `result` payload (P0.2), implement SessionLister if available |
| `opencode.go` | Fix `result` payload (P0.2), implement SessionLister if available |
| `orchestrator.go` | Sub-agent interception (P2.1) |
| `control_protocol.go` | Add `steer_message` subtype |

### Shared Type Changes (Desktop)

| File | Changes |
|---|---|
| `app/shared/src/events.ts` | Add `run.cancelled`, fix `file_change` payload, add `usage` fallback, add `started`/`in_progress` statuses, add new event types |
| `app/shared/src/types.ts` | Add `SessionInfo`, `ForkRequest` types |
| `app/desktop/src/hooks/useChatMessages.ts` | Handle `run.cancelled`, `run.queued`, fix `tokenUsage`, fix `tool_result` output |
| `app/desktop/src/components/ChatView.types.ts` | Add `task_*`, `compact_boundary`, `tool_use_summary` block types |

---

## Appendix A: Key Type Definitions

### A.1 RunProcessContext (Enhanced)

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

    // V2 additions
    DelegationDepth    int      // Current delegation depth (0 = user request)
    DelegationPath     []string // Chain of agent IDs that delegated to this run
    ParentRunID        string   // Parent run ID (for sub-agents)
    ParentTaskID      string   // Parent task ID in the orchestrator
    CycleGuard         *CycleGuard // Guard for delegation cycle detection
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
    Status       string    `json:"status"` // "active", "completed", "cancelled"
}
```

### A.3 ForkMode

```go
type ForkMode struct {
    Mode     string `json:"mode"`     // "full", "last_n_turns"
    NumTurns int    `json:"numTurns"` // only used when Mode="last_n_turns"
}
```

### A.4 AgentMessage

```go
type AgentMessage struct {
    ID        string `json:"id"`
    SessionID string `json:"sessionId"`
    Role      string `json:"role"` // "user", "assistant", "system"
    Content   string `json:"content"`
    Type      string `json:"type"`
    Seq       int    `json:"seq"`
    Timestamp int64  `json:"timestamp"`
}
```
