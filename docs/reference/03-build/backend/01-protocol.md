# AgentHub Protocol Layer -- Complete Type Design

> Generated: 2026-05-21
> Sources: cross-analysis-adapters.md, cross-analysis-orchestration.md, cross-analysis-sandbox-tools.md, cross-analysis-im-ux.md, architecture.md, data-model.md, authority.md, approvals.md, protocol.md
> Target: `packages/protocol/go/generated/` (hand-written reference types for code generation)

---

## Overview

This document defines the complete Go type layer proposed for AgentHub's protocol package before `.proto` files are finalized. The authoritative protocol source is `proto/agenthub/v1`; this document is a design reference for the Go-facing shapes and every field carries a source comment tracing its origin.

Package layout:

```
packages/protocol/
  types.go           // Core data types (AgentEvent, Message, Thread, Turn, Item, Artifact, Memory)
  adapter.go         // AgentAdapter interface + session/stream/permission types
  sync.go            // Hub-Edge sync protocol (EdgeEvent, SyncAck, AuthorityTransfer)
  orchestration.go   // DispatchStrategy, SubagentGraph, CycleDetection, AgentCapability
  approval.go        // ApprovalRequest, ApprovalDecision, RiskLevel, PolicyRule
```

---

## 1. Core Data Types (`types.go`)

### 1.1 Identity Types

```go
package protocol

import "time"

// ============================================================================
// Identity Types -- referenced everywhere
// ============================================================================

// NodeID identifies an Edge node globally.
// 参考 architecture.md "凡是能跑 Runner 的机器都是 Edge Node"
type NodeID string

// ConversationID is the primary key for a conversation.
// 参考 data-model.md Conversation.id
type ConversationID string

// MessageID is the primary key for a single message.
// 参考 data-model.md Message.id
type MessageID string

// ThreadID identifies a task branch within a conversation.
// 参考 data-model.md Thread.id
type ThreadID string

// TurnID identifies one execution round within a thread.
// 参考 data-model.md Turn.id
type TurnID string

// RunID identifies an AgentRun instance.
// 参考 architecture.md RunnerCommand.runId
type RunID string

// ArtifactID identifies a durable output.
// 参考 data-model.md Artifact
type ArtifactID string

// ProjectID identifies a workspace project.
// 参考 data-model.md Project.id
type ProjectID string
```

### 1.2 Conversation Authority Types

```go
// ============================================================================
// Authority Types -- who owns what
// 参考 authority.md "Conversation Authority / Execution Authority / Artifact Authority / Memory Authority"
// ============================================================================

// ConversationAuthority defines who owns the primary message sequence.
// 参考 authority.md ConversationAuthority discriminated union
type ConversationAuthority struct {
	Type   AuthorityType `json:"type"`
	EdgeID string        `json:"edgeId,omitempty"` // when type="edge"
	HubID  string        `json:"hubId,omitempty"`  // when type="hub"
}

// AuthorityType enumerates conversation ownership modes.
type AuthorityType string

const (
	AuthorityEdge  AuthorityType = "edge"  // 参考 authority.md: Desktop UI writes messages only to Edge
	AuthorityHub   AuthorityType = "hub"   // 参考 authority.md: Web/Mobile write messages to Hub
	AuthorityHybrid AuthorityType = "hybrid" // 参考 cross-analysis-im-ux.md: Hub+Edge collaboration
)

// ExecutionAuthority defines where the task actually runs.
// 参考 authority.md ExecutionAuthority
type ExecutionAuthority struct {
	EdgeID      string `json:"edgeId"`
	RunnerID    string `json:"runnerId"`
	WorkspaceID string `json:"workspaceId"`
}

// ArtifactAuthority defines where artifact bytes live.
// 参考 authority.md ArtifactAuthority
type ArtifactAuthority struct {
	Type   ArtifactAuthorityType `json:"type"`
	EdgeID string                `json:"edgeId,omitempty"`
	HubID  string                `json:"hubId,omitempty"`
	Bucket string                `json:"bucket,omitempty"` // for object-storage
}

type ArtifactAuthorityType string

const (
	ArtifactAuthEdge         ArtifactAuthorityType = "edge"
	ArtifactAuthHubCache     ArtifactAuthorityType = "hub-cache"
	ArtifactAuthObjectStorage ArtifactAuthorityType = "object-storage"
)

// MemoryAuthority defines who owns durable memory writes.
// 参考 authority.md MemoryAuthority
type MemoryAuthority struct {
	Type      MemoryAuthorityType `json:"type"`
	EdgeID    string              `json:"edgeId,omitempty"`
	HubID     string              `json:"hubId,omitempty"`
	Scope     string              `json:"scope,omitempty"`     // "team" | "global" for hub type
	ProjectID string              `json:"projectId,omitempty"` // for project-edge type
	AgentID   string              `json:"agentId,omitempty"`   // for agent-edge type
}

type MemoryAuthorityType string

const (
	MemoryAuthProjectEdge MemoryAuthorityType = "project-edge"
	MemoryAuthAgentEdge   MemoryAuthorityType = "agent-edge"
	MemoryAuthHub         MemoryAuthorityType = "hub"
)
```

### 1.3 Project / Conversation / Thread / Turn / Item

```go
// ============================================================================
// Core Data Hierarchy: Project -> Conversation -> Thread -> Turn -> Item
// 参考 data-model.md "Core Shape"
// ============================================================================

// Project is a local or remote workspace root.
// 参考 data-model.md Project
type Project struct {
	ID         ProjectID `json:"id"`
	Name       string    `json:"name"`
	RootPath   string    `json:"rootPath"`
	MemoryPath string    `json:"memoryPath"` // .agenthub/ directory
	// 参考 architecture.md: Project memory under .agenthub/ is owned by Edge
}

// Conversation is the IM shell: direct/group conversation and authority boundary.
// 参考 data-model.md Conversation
// 参考 cross-analysis-im-ux.md Section 2.1 (群聊消息树)
type Conversation struct {
	ID          ConversationID        `json:"id"`
	ProjectID   string                `json:"projectId"`
	Type        ConversationType      `json:"type"`
	Title       string                `json:"title"`
	Authority   ConversationAuthority `json:"authority"`
	Execution   *ExecutionAuthority   `json:"execution,omitempty"`
	Pinned      bool                  `json:"pinned"`
	Archived    bool                  `json:"archived"`
	LastMessageAt time.Time           `json:"lastMessageAt"`
	// 参考 authority.md: authority + executionAuthority fields on every conversation
}

type ConversationType string

const (
	ConversationDirect ConversationType = "direct" // 单聊
	ConversationGroup  ConversationType = "group"  // 群聊
)

// MessageTreeNode is the message tree node used for branching navigation.
// 参考 cross-analysis-im-ux.md Section 2.3: buildTree() from LibreChat
// 参考 cross-analysis-orchestration.md: 消息树 = 编排拓扑的运行时表示
type MessageTreeNode struct {
	Message  Message            `json:"message"`
	Children []*MessageTreeNode `json:"children"` // sibling branches
	// 参考 cross-analysis-im-ux.md: SiblingSwitch when len(Children) > 1
}

// Message represents a single message in the IM flow.
// 参考 data-model.md Message
// 参考 cross-analysis-im-ux.md Section 2.3 (消息流)
type Message struct {
	ID             MessageID     `json:"id"`
	ConversationID ConversationID `json:"conversationId"`
	ThreadID       ThreadID      `json:"threadId"`
	ParentID       *MessageID    `json:"parentId,omitempty"` // tree parent for branching
	// 参考 cross-analysis-im-ux.md: 消息树数据模型 {message, children[]}
	SenderType  SenderType `json:"senderType"`
	SenderID    string     `json:"senderId"`   // user id or agent id
	SenderName  string     `json:"senderName"` // display name
	Content     string     `json:"content"`
	Mentions    []string   `json:"mentions"`   // @mentioned agent/user IDs
	// 参考 cross-analysis-orchestration.md Section 2.5: @mention 直接委派
	Status      MessageStatus `json:"status"`
	Authority   AuthorityType `json:"authority"` // 参考 cross-analysis-im-ux.md: 消息所有权线条颜色区分
	ArtifactIDs []ArtifactID  `json:"artifactIds"`
	CreatedAt   time.Time     `json:"createdAt"`
	UpdatedAt   time.Time     `json:"updatedAt"`
}

type SenderType string

const (
	SenderUser   SenderType = "user"
	SenderAgent  SenderType = "agent"
	SenderSystem SenderType = "system"
	SenderRunner SenderType = "runner"
)

type MessageStatus string

const (
	MessageSending   MessageStatus = "sending"
	MessageStreaming MessageStatus = "streaming"
	MessageDone      MessageStatus = "done"
	MessageFailed    MessageStatus = "failed"
)

// Thread is a task branch inside a conversation.
// 参考 data-model.md Thread
// 参考 architecture.md "Thread = task branch"
type Thread struct {
	ID             ThreadID       `json:"id"`
	ConversationID ConversationID `json:"conversationId"`
	ProjectID      string         `json:"projectId"`
	Title          string         `json:"title"`
	Status         ThreadStatus   `json:"status"`
	RootMessageID  *MessageID     `json:"rootMessageId,omitempty"` // 参考 cross-analysis-orchestration.md: Fork from any message
	CurrentRunID   *RunID         `json:"currentRunId,omitempty"`
	CreatedAt      time.Time      `json:"createdAt"`
	UpdatedAt      time.Time      `json:"updatedAt"`
}

type ThreadStatus string

const (
	ThreadOpen    ThreadStatus = "open"
	ThreadRunning ThreadStatus = "running"
	ThreadBlocked ThreadStatus = "blocked" // awaiting approval or human input
	ThreadDone    ThreadStatus = "done"
	ThreadArchived ThreadStatus = "archived"
)

// Turn is one user/agent execution round.
// 参考 data-model.md Turn
// 参考 architecture.md "Turn = one interaction/execution round"
type Turn struct {
	ID        TurnID     `json:"id"`
	ThreadID  ThreadID   `json:"threadId"`
	RunID     *RunID     `json:"runId,omitempty"`
	Sequence   int        `json:"sequence"` // monotonic within thread
	ActorID   string     `json:"actorId"`   // user or agent ID
	Status    TurnStatus `json:"status"`
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
}

type TurnStatus string

const (
	TurnQueued            TurnStatus = "queued"
	TurnRunning           TurnStatus = "running"
	TurnAwaitingApproval  TurnStatus = "awaiting_approval"
	TurnDone              TurnStatus = "done"
	TurnFailed            TurnStatus = "failed"
	TurnCancelled         TurnStatus = "cancelled"
)

// Item is a streamed event unit inside a turn.
// 参考 data-model.md Item
// 参考 cross-analysis-adapters.md Section 2.2: AgentEvent stream
type Item struct {
	ID        string    `json:"id"`
	ThreadID  ThreadID  `json:"threadId"`
	TurnID    TurnID    `json:"turnId"`
	Type      ItemType  `json:"type"`
	Payload   any       `json:"payload"`   // type-specific payload (AgentEvent or sub-type)
	Seq       int       `json:"seq"`       // monotonic within turn
	CreatedAt time.Time `json:"createdAt"`
}

type ItemType string

const (
	ItemUserMessage       ItemType = "user_message"
	ItemAgentMessage      ItemType = "agent_message"
	ItemReasoningSummary  ItemType = "reasoning_summary"
	ItemShellCommand      ItemType = "shell_command"
	ItemCommandOutput     ItemType = "command_output"
	ItemFileChange        ItemType = "file_change"
	ItemDiff              ItemType = "diff"
	ItemPreview           ItemType = "preview"
	ItemApprovalRequest   ItemType = "approval_request"
	ItemApprovalDecision  ItemType = "approval_decision"
	ItemError             ItemType = "error"
	ItemToolCall          ItemType = "tool_call"
	ItemToolResult        ItemType = "tool_result"
)
```

### 1.4 Unified Agent Event (12 types)

```go
// ============================================================================
// Unified Agent Event -- 12 event types
// 参考 cross-analysis-adapters.md Section 2.2 "Unified Agent Event Model"
// 参考 cross-analysis-adapters.md Section 4.1 "Native-to-Unified Event Mapping"
// ============================================================================

// AgentEvent is the unified event type emitted by all adapters.
// Every adapter normalizes its native events into this structure.
// 参考 cross-analysis-adapters.md Section 2.2 设计原则 #3: Event-driven stream
type AgentEvent struct {
	// Sequence
	Seq       int    `json:"seq"`       // 参考 cross-analysis-adapters.md AgentEvent.Seq: monotonic within session
	SessionID string `json:"sessionId"` // 参考 cross-analysis-adapters.md AgentEvent.SessionID

	// Classification
	Type      AgentEventType `json:"type"`      // 参考 cross-analysis-adapters.md AgentEventType
	Timestamp int64          `json:"timestamp"`  // Unix milliseconds

	// Payload (type-specific)
	Payload any `json:"payload"`

	// Debug
	Raw []byte `json:"raw,omitempty"` // 参考 cross-analysis-adapters.md AgentEvent.Raw: original provider event
}

type AgentEventType string

const (
	// --- Lifecycle events ---
	EventSystemInit   AgentEventType = "system_init"   // 参考 cross-analysis-adapters.md: CC system_init → AgentHub system_init
	EventResult       AgentEventType = "result"        // 参考 cross-analysis-adapters.md: CC result → AgentHub result
	EventSystem       AgentEventType = "system"        // 参考 cross-analysis-adapters.md: compaction, retry, status change
	EventStatusChange AgentEventType = "status_change" // 参考 cross-analysis-adapters.md: session status transition

	// --- Content events ---
	EventAssistantText AgentEventType = "assistant_text" // 参考 cross-analysis-adapters.md: CC assistant text block → assistant_text
	EventReasoning     AgentEventType = "reasoning"      // 参考 cross-analysis-adapters.md: CC thinking block → reasoning
	EventUserReplay    AgentEventType = "user_replay"    // 参考 cross-analysis-adapters.md: CC user replay → user_replay

	// --- Tool execution events ---
	EventToolCall       AgentEventType = "tool_call"        // 参考 cross-analysis-adapters.md: CC assistant(tool_use) → tool_call
	EventToolResult     AgentEventType = "tool_result"      // 参考 cross-analysis-adapters.md: CC user(tool_result) → tool_result
	EventToolProgress   AgentEventType = "tool_progress"    // 参考 cross-analysis-adapters.md: CC progress → tool_progress
	EventToolUseSummary AgentEventType = "tool_use_summary" // 参考 cross-analysis-adapters.md: CC tool_use_summary → tool_use_summary

	// --- Control events ---
	EventStreamEvent      AgentEventType = "stream_event"      // 参考 cross-analysis-adapters.md: raw streaming delta
	EventApprovalRequest  AgentEventType = "approval_request"  // 参考 cross-analysis-adapters.md: tool permission request
	EventApprovalDecision AgentEventType = "approval_decision" // 参考 cross-analysis-adapters.md: permission decision
)

// ============================================================================
// Event Payload Structs
// 参考 cross-analysis-adapters.md Section 2.2 "Event Payload Structs"
// ============================================================================

// SystemInitPayload carries session initialization data.
// 参考 cross-analysis-adapters.md SystemInitPayload
type SystemInitPayload struct {
	Model          string          `json:"model"`
	Tools          []ToolDef       `json:"tools"`
	Commands       []CommandDef    `json:"commands"`    // 参考 cross-analysis-adapters.md: slash commands
	Agents         []SubAgentDef   `json:"agents"`      // 参考 cross-analysis-adapters.md: sub-agent definitions
	MCPServers     []MCPServerInfo `json:"mcpServers"`  // 参考 cross-analysis-adapters.md: MCP server status
	PermissionMode string          `json:"permissionMode"`
	SessionID      string          `json:"sessionId"`
}

// AssistantTextPayload carries text content from the model.
// 参考 cross-analysis-adapters.md AssistantTextPayload
type AssistantTextPayload struct {
	Content   string    `json:"content"`
	Phase     TextPhase `json:"phase"`     // "delta" or "block_end"
	MessageID string    `json:"messageId"` // unique within turn
}

type TextPhase string

const (
	TextPhaseDelta    TextPhase = "delta"
	TextPhaseBlockEnd TextPhase = "block_end"
)

// ReasoningPayload carries thinking/reasoning content.
// 参考 cross-analysis-adapters.md ReasoningPayload
type ReasoningPayload struct {
	Content     string    `json:"content"`
	Phase       TextPhase `json:"phase"`
	BudgetUsed  int       `json:"budgetUsed"`
	BudgetTotal int       `json:"budgetTotal"`
}

// ToolCallPayload carries a tool invocation request.
// 参考 cross-analysis-adapters.md ToolCallPayload
type ToolCallPayload struct {
	ToolCallID string          `json:"toolCallId"`
	ToolName   string          `json:"toolName"`   // e.g., "Bash", "mcp__github__search_repos"
	ToolInput  map[string]any  `json:"toolInput"`  // 参考 cross-analysis-adapters.md Section 4.2: normalize to mcp__<server>__<tool>
	Status     ToolCallStatus  `json:"status"`
}

type ToolCallStatus string

const (
	ToolCallPending   ToolCallStatus = "pending"
	ToolCallRunning   ToolCallStatus = "running"
	ToolCallCompleted ToolCallStatus = "completed"
	ToolCallFailed    ToolCallStatus = "failed"
	ToolCallDenied    ToolCallStatus = "denied"
)

// ToolResultPayload carries the result of a tool execution.
// 参考 cross-analysis-adapters.md ToolResultPayload
type ToolResultPayload struct {
	ToolCallID string `json:"toolCallId"`
	ToolName   string `json:"toolName"`
	Content    string `json:"content"`  // rendered result
	IsError    bool   `json:"isError"`
	ExitCode   *int   `json:"exitCode,omitempty"`
	RawOutput  []byte `json:"rawOutput,omitempty"`
}

// ResultPayload carries the final turn result.
// 参考 cross-analysis-adapters.md ResultPayload
type ResultPayload struct {
	Subtype       ResultSubtype `json:"subtype"`
	IsError       bool          `json:"isError"`
	Content       string        `json:"content"`
	DurationMs    int64         `json:"durationMs"`
	DurationAPIMs int64         `json:"durationApiMs"`
	NumTurns      int           `json:"numTurns"`
	StopReason    string        `json:"stopReason"` // "end_turn", "max_tokens", "tool_use", etc.
	Cost          *CostInfo     `json:"cost,omitempty"`
	Usage         *UsageInfo    `json:"usage,omitempty"`
	Errors        []string      `json:"errors,omitempty"`
}

type ResultSubtype string

const (
	ResultSuccess                  ResultSubtype = "success"                     // 参考 cross-analysis-adapters.md
	ResultErrorExecution           ResultSubtype = "error_during_execution"      // 参考 cross-analysis-adapters.md
	ResultErrorMaxTurns            ResultSubtype = "error_max_turns"             // 参考 cross-analysis-adapters.md
	ResultErrorMaxBudget           ResultSubtype = "error_max_budget_usd"        // 参考 cross-analysis-adapters.md
	ResultErrorMaxStructuredOutput ResultSubtype = "error_max_structured_output_retries"
)

// StatusChangePayload carries session status transitions.
// 参考 cross-analysis-adapters.md StatusChangePayload
type StatusChangePayload struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Reason string `json:"reason"` // e.g., "compaction_triggered", "permission_mode_changed"
}

// ============================================================================
// Shared Tool/MCP/Usage Types
// 参考 cross-analysis-adapters.md Section 2.2 "Shared Types"
// ============================================================================

type ToolDef struct {
	Name          string         `json:"name"`
	Description   string         `json:"description"`
	Parameters    map[string]any `json:"parameters"` // JSON Schema
	IsReadOnly    bool           `json:"isReadOnly"`
	IsDestructive bool           `json:"isDestructive"`
	IsMcp         bool           `json:"isMcp"`
	MCPServer     string         `json:"mcpServer,omitempty"`
}

type CommandDef struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Aliases     []string `json:"aliases,omitempty"`
}

// SubAgentDef describes an available sub-agent.
// 参考 cross-analysis-adapters.md SubAgentDef
// 参考 cross-analysis-orchestration.md Section 2.4: subagent configuration
type SubAgentDef struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	SystemPrompt string   `json:"systemPrompt"`
	Tools        []string `json:"tools"`
	Mode         string   `json:"mode"`       // e.g., "agent", "plan", "reviewer"
	AllowSelf    bool     `json:"allowSelf"`  // 参考 cross-analysis-orchestration.md Section 3.2 Layer 1: 自引用白名单
}

type MCPServerInfo struct {
	Name      string `json:"name"`
	Transport string `json:"transport"` // "stdio", "sse", "http", "ws"
	Status    string `json:"status"`    // "connected", "connecting", "error"
	ToolCount int    `json:"toolCount"`
}

type CostInfo struct {
	TotalUSD     float64            `json:"totalUsd"`
	PerModelCost map[string]float64 `json:"perModelCost"`
}

// UsageInfo tracks token usage across providers.
// 参考 cross-analysis-adapters.md UsageInfo
type UsageInfo struct {
	InputTokens         int64 `json:"inputTokens"`
	OutputTokens        int64 `json:"outputTokens"`
	CacheReadTokens     int64 `json:"cacheReadTokens"`
	CacheCreationTokens int64 `json:"cacheCreationTokens"`
	ReasoningTokens     int64 `json:"reasoningTokens"`
}

type ProviderInfo struct {
	Provider        string   `json:"provider"`
	Model           string   `json:"model"`
	ModelsAvailable []string `json:"modelsAvailable,omitempty"`
}
```

### 1.5 AgentRun

```go
// ============================================================================
// AgentRun -- runtime execution of an agent turn
// 参考 architecture.md: Runner 执行节点
// 参考 data-model.md: "AgentRun = Runtime execution of an agent turn"
// 参考 cross-analysis-adapters.md AgentSession
// ============================================================================

// AgentRun represents a single agent execution instance.
// Maps to cross-analysis-adapters.md AgentSession at the Runner level.
type AgentRun struct {
	ID          RunID       `json:"id"`
	ThreadID    ThreadID    `json:"threadId"`
	TurnID      TurnID      `json:"turnId"`
	AgentID     string      `json:"agentId"`     // 参考 cross-analysis-adapters.md: "claude-code", "codex", "opencode"
	WorkspaceID string      `json:"workspaceId"` // 参考 cross-analysis-sandbox-tools.md WorkspaceInfo.ID
	Status      RunStatus   `json:"status"`
	Model       string      `json:"model"`
	Prompt      string      `json:"prompt"`
	Usage       *UsageInfo  `json:"usage,omitempty"`
	Cost        *CostInfo   `json:"cost,omitempty"`
	StartedAt   time.Time   `json:"startedAt"`
	EndedAt     *time.Time  `json:"endedAt,omitempty"`
	// 参考 cross-analysis-sandbox-tools.md Section 3: Checkpoint关联
	CheckpointID *string `json:"checkpointId,omitempty"`
}

type RunStatus string

const (
	RunStarting        RunStatus = "starting"         // 参考 cross-analysis-adapters.md StatusStarting
	RunRunning         RunStatus = "running"          // 参考 cross-analysis-adapters.md StatusRunning
	RunWaitingApproval RunStatus = "waiting_approval" // 参考 cross-analysis-adapters.md StatusWaitingApproval
	RunDraining        RunStatus = "draining"         // 参考 cross-analysis-adapters.md StatusDraining
	RunDone            RunStatus = "done"             // 参考 cross-analysis-adapters.md StatusDone
	RunFailed          RunStatus = "failed"           // 参考 cross-analysis-adapters.md StatusFailed
	RunCancelled       RunStatus = "cancelled"        // 参考 cross-analysis-adapters.md StatusCancelled
)
```

### 1.6 Artifact Types

```go
// ============================================================================
// Artifact Types -- durable outputs addressable from UI
// 参考 data-model.md: "Artifact = durable output such as diff, log, preview, file"
// 参考 cross-analysis-im-ux.md Section 2.5 (产物预览)
// 参考 cross-analysis-sandbox-tools.md Section 3 (Checkpoint)
// ============================================================================

// Artifact represents a durable work product from an agent run.
type Artifact struct {
	ID        ArtifactID        `json:"id"`
	RunID     RunID             `json:"runId"`
	TurnID    TurnID            `json:"turnId"`
	ThreadID  ThreadID          `json:"threadId"`
	Type      ArtifactType      `json:"type"`
	Title     string            `json:"title"`
	MimeType  string            `json:"mimeType"`
	Size      int64             `json:"size"`
	Authority ArtifactAuthority `json:"authority"`     // 参考 authority.md: artifact authority
	URL       string            `json:"url,omitempty"` // 参考 cross-analysis-im-ux.md: download artifact
	Tags      []string          `json:"tags,omitempty"`
	Metadata  map[string]any    `json:"metadata,omitempty"` // type-specific metadata
	CreatedAt time.Time         `json:"createdAt"`
}

type ArtifactType string

const (
	ArtifactDiff    ArtifactType = "diff"    // 参考 cross-analysis-im-ux.md Section 2.4 (Diff 面板)
	ArtifactLog     ArtifactType = "log"     // raw stdout/stderr
	ArtifactPreview ArtifactType = "preview" // 参考 cross-analysis-im-ux.md Section 2.5: dev server preview
	ArtifactFile    ArtifactType = "file"    // generated file
	ArtifactCode    ArtifactType = "code"    // 参考 cross-analysis-im-ux.md: Sandpack 实时代码编辑
	ArtifactMermaid ArtifactType = "mermaid" // 参考 cross-analysis-im-ux.md: Mermaid 图表渲染
	ArtifactHTML    ArtifactType = "html"    // interactive HTML
	ArtifactJSON    ArtifactType = "json"    // structured data
)

// DiffArtifact is a specialized artifact for code changes.
// 参考 cross-analysis-im-ux.md Section 2.4: DiffViewer + 行级评论
// 参考 cross-analysis-sandbox-tools.md Section 2.5: DiffResult from WorkspaceProvider
type DiffArtifact struct {
	Artifact
	BaseRef       string       `json:"baseRef"`       // base branch/commit
	HeadRef       string       `json:"headRef"`       // head branch/commit
	FilesChanged  int          `json:"filesChanged"`
	Additions     int          `json:"additions"`
	Deletions     int          `json:"deletions"`
	FileDiffs     []FileDiff   `json:"fileDiffs"`
	AgentID       string       `json:"agentId"`       // 参考 cross-analysis-im-ux.md: "Generated by [Edge:us1] Claude"
	ToolCallID    string       `json:"toolCallId"`    // 参考 cross-analysis-im-ux.md: 追溯到 tool_use
	CanApply      bool         `json:"canApply"`      // 参考 cross-analysis-sandbox-tools.md: WorkspaceProvider.ApplyPatch
	CanDiscard    bool         `json:"canDiscard"`    // 参考 cross-analysis-sandbox-tools.md: WorkspaceProvider.Discard
}

// FileDiff represents changes to a single file.
type FileDiff struct {
	FilePath    string       `json:"filePath"`
	OldPath     string       `json:"oldPath,omitempty"` // for renames
	ChangeType  DiffChangeType `json:"changeType"`       // added, modified, deleted, renamed
	Hunks       []DiffHunk   `json:"hunks"`
	Additions   int          `json:"additions"`
	Deletions   int          `json:"deletions"`
	Comments    []DiffComment `json:"comments,omitempty"` // 参考 cross-analysis-im-ux.md: 行级评论
}

type DiffChangeType string

const (
	DiffAdded    DiffChangeType = "added"
	DiffModified DiffChangeType = "modified"
	DiffDeleted  DiffChangeType = "deleted"
	DiffRenamed  DiffChangeType = "renamed"
)

// DiffHunk represents a contiguous block of changes.
type DiffHunk struct {
	OldStart int      `json:"oldStart"`
	OldLines int      `json:"oldLines"`
	NewStart int      `json:"newStart"`
	NewLines int      `json:"newLines"`
	Lines    []DiffLine `json:"lines"`
}

type DiffLine struct {
	OldLineNo *int   `json:"oldLineNo,omitempty"`
	NewLineNo *int   `json:"newLineNo,omitempty"`
	Content   string `json:"content"`
	Type      DiffLineType `json:"type"` // "context", "addition", "deletion"
}

type DiffLineType string

const (
	DiffLineContext  DiffLineType = "context"
	DiffLineAddition DiffLineType = "addition"
	DiffLineDeletion DiffLineType = "deletion"
)

// DiffComment is an inline comment on a specific diff line.
// 参考 cross-analysis-im-ux.md: CommentButton/CommentForm
type DiffComment struct {
	ID        string    `json:"id"`
	FilePath  string    `json:"filePath"`
	LineNo    int       `json:"lineNo"`    // new file line number
	AuthorID  string    `json:"authorId"`
	Content   string    `json:"content"`
	Resolved  bool      `json:"resolved"`
	CreatedAt time.Time `json:"createdAt"`
}

// PreviewArtifact represents a running dev server preview.
// 参考 architecture.md: Preview port 5100-5199
// 参考 cross-analysis-sandbox-tools.md: ExposedUrl from WorkspaceProvider
type PreviewArtifact struct {
	Artifact
	Port        int    `json:"port"`
	ServiceName string `json:"serviceName"` // e.g., "dev-server", "storybook"
	Status      PreviewStatus `json:"status"`
	AccessURL   string `json:"accessUrl"` // 参考 cross-analysis-sandbox-tools.md: ExposedURLs
}

type PreviewStatus string

const (
	PreviewStarting PreviewStatus = "starting"
	PreviewRunning  PreviewStatus = "running"
	PreviewStopped  PreviewStatus = "stopped"
	PreviewError    PreviewStatus = "error"
)
```

### 1.7 Memory Types

```go
// ============================================================================
// Memory Types
// 参考 architecture.md: "项目 Memory / Context Builder"
// 参考 authority.md: MemoryAuthority
// 参考 cross-analysis-orchestration.md Section 4.3: Summarization reserveRatio + EMA 校准 (from LibreChat)
// ============================================================================

// MemoryDocument is a unit of persistent context for a project, agent, or conversation.
type MemoryDocument struct {
	ID             string          `json:"id"`
	Scope          MemoryScope     `json:"scope"`
	ProjectID      string          `json:"projectId,omitempty"`
	ConversationID string          `json:"conversationId,omitempty"`
	AgentID        string          `json:"agentId,omitempty"`
	Authority      MemoryAuthority `json:"authority"` // 参考 authority.md: Memory Authority
	Title          string          `json:"title"`
	Content        string          `json:"content"`
	Format         string          `json:"format"` // "markdown", "json", "yaml"
	Chunks         []MemoryChunk   `json:"chunks,omitempty"`
	Version        int             `json:"version"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

type MemoryScope string

const (
	MemoryScopeProject      MemoryScope = "project"      // .agenthub/ rules, conventions
	MemoryScopeAgent        MemoryScope = "agent"        // per-agent configuration
	MemoryScopeConversation MemoryScope = "conversation" // conversation-level context
	MemoryScopeTeam         MemoryScope = "team"         // 参考 authority.md: hub team scope
	MemoryScopeGlobal       MemoryScope = "global"       // 参考 authority.md: hub global scope
)

// MemoryChunk is a searchable segment of a memory document.
// 参考 cross-analysis-orchestration.md Section 4.3: context compaction (LibreChat summarization)
type MemoryChunk struct {
	ID            string    `json:"id"`
	DocumentID    string    `json:"documentId"`
	Content       string    `json:"content"`
	EmbeddingHash string    `json:"embeddingHash,omitempty"` // for semantic search
	TokenCount    int       `json:"tokenCount"`
	Seq           int       `json:"seq"` // order within document
	CreatedAt     time.Time `json:"createdAt"`
}

// ContextSummary is a compacted representation of conversation history.
// 参考 cross-analysis-orchestration.md: LibreChat summarization reserveRatio + EMA calibration
type ContextSummary struct {
	ID             string    `json:"id"`
	ConversationID ConversationID `json:"conversationId"`
	ThreadID       ThreadID  `json:"threadId"`
	Content        string    `json:"content"`     // compacted summary text
	TokenCount     int       `json:"tokenCount"`  // tokens consumed by summary
	ReserveRatio   float64   `json:"reserveRatio"` // 参考 cross-analysis-orchestration.md: 预留比例
	CoverStartSeq  int       `json:"coverStartSeq"` // first message covered
	CoverEndSeq    int       `json:"coverEndSeq"`   // last message covered
	CreatedAt      time.Time `json:"createdAt"`
}
```

---

## 2. Agent Adapter Protocol (`adapter.go`)

```go
package protocol

import (
	"context"
)

// ============================================================================
// Agent Adapter Interface
// 参考 cross-analysis-adapters.md Section 2.2 "Core Interface"
// 参考 cross-analysis-adapters.md Section 2.3 "Interface Coverage Map"
// ============================================================================

// AgentAdapter is the unified interface for all Agent CLI backends.
// Each implementation (ClaudeCodeAdapter, CodexAdapter, OpenCodeAdapter)
// must satisfy this interface.
// 参考 cross-analysis-adapters.md: "Provider-agnostic abstract over subprocess and HTTP"
type AgentAdapter interface {
	// Metadata returns static information about this adapter instance.
	// 参考 cross-analysis-adapters.md AdapterMetadata
	Metadata() AdapterMetadata

	// Capabilities returns the feature set this adapter supports.
	// 参考 cross-analysis-adapters.md AgentCapabilities
	Capabilities() AgentCapabilities

	// Start launches an agent session for a new turn.
	// The adapter is responsible for process/connection lifecycle.
	// 参考 cross-analysis-adapters.md AgentAdapter.Start
	Start(ctx context.Context, req StartRequest) (*AgentSession, error)

	// Resume reconnects to an existing agent session.
	// 参考 cross-analysis-adapters.md AgentAdapter.Resume
	// 参考 cross-analysis-adapters.md Section 1.4: Session reuse
	Resume(ctx context.Context, sessionID string) (*AgentSession, error)

	// AttachStream attaches as a consumer of the event stream.
	// Only one stream consumer per session is allowed.
	// 参考 cross-analysis-adapters.md AgentAdapter.AttachStream
	AttachStream(ctx context.Context, sessionID string) (*EventStream, error)
}

// ============================================================================
// Extension Interfaces (optional, capability-gated)
// 参考 cross-analysis-adapters.md Section 2.2 "Extension Interfaces"
// ============================================================================

// SessionManager provides session-level operations beyond start/resume.
// 参考 cross-analysis-adapters.md SessionManager
// 参考 cross-analysis-adapters.md Section 1.4: Fork / List / GetMessages
type SessionManager interface {
	ForkSession(ctx context.Context, req ForkRequest) (*AgentSession, error)
	// 参考 cross-analysis-adapters.md Section 1.4: forkSession → ForkSession
	// 参考 cross-analysis-adapters.md Section 3.2 Workaround 7: ForkMode.LastNTurns recommended

	ListSessions(ctx context.Context, pagination Pagination) ([]SessionInfo, error)
	// 参考 cross-analysis-adapters.md Section 1.4: listSessions → ListSessions

	GetSessionInfo(ctx context.Context, sessionID string) (*SessionInfo, error)
	// 参考 cross-analysis-adapters.md: getSessionInfo

	GetMessages(ctx context.Context, sessionID string) ([]AgentEvent, error)
	// 参考 cross-analysis-adapters.md: getMessages → JSONL replay
}

// PermissionBroker allows AgentHub to intercept tool execution for approval.
// 参考 cross-analysis-adapters.md PermissionBroker
// 参考 cross-analysis-adapters.md Section 1.3: Permission & Approval Model
type PermissionBroker interface {
	// SetPermissionCallback registers a hook called before tool execution.
	// 参考 cross-analysis-adapters.md PermissionBroker.SetPermissionCallback
	// 参考 cross-analysis-adapters.md Section 3.1 Workaround 5: CC stdin control protocol
	SetPermissionCallback(sessionID string, cb PermissionCallback)

	// ResolvePermission is called by the adapter when a tool requires approval.
	// May block until a decision is made (user/admin input).
	// 参考 cross-analysis-adapters.md PermissionBroker.ResolvePermission
	ResolvePermission(ctx context.Context, req ToolPermissionRequest) (*PermissionDecision, error)
}

// InteractiveControl provides mid-turn control: cancel, steer, inject.
// 参考 cross-analysis-adapters.md InteractiveControl
// 参考 cross-analysis-adapters.md Section 3.4: Kanna steer mode pattern
type InteractiveControl interface {
	// Cancel terminates the current turn gracefully.
	// 参考 cross-analysis-adapters.md Cancel: AbortController / Shutdown Op
	Cancel(ctx context.Context, sessionID string) error

	// SendSteer injects a follow-up message into a running turn.
	// 参考 cross-analysis-adapters.md SendSteer: mid-turn message injection
	// 参考 cross-analysis-adapters.md Section 3.4: Kanna steer mechanism
	SendSteer(ctx context.Context, sessionID string, msg SteerMessage) error

	// Drain blocks until background tasks complete after result event.
	// 参考 cross-analysis-adapters.md Section 3.4: Kanna drainingStreams pattern
	Drain(ctx context.Context, sessionID string) error
}

// ============================================================================
// Adapter Metadata & Capabilities
// 参考 cross-analysis-adapters.md Section 2.2
// ============================================================================

// AdapterMetadata identifies the adapter and its version.
// 参考 cross-analysis-adapters.md AdapterMetadata
type AdapterMetadata struct {
	Name         string `json:"name"`         // "claude-code", "codex", "opencode"
	Version      string `json:"version"`      // Adapter implementation version
	AgentVersion string `json:"agentVersion"` // Underlying CLI binary version (from --version)
}

// AgentCapabilities declares which features this adapter supports.
// 参考 cross-analysis-adapters.md AgentCapabilities
type AgentCapabilities struct {
	Streaming          bool `json:"streaming"`           // 实时事件流
	SessionPersist     bool `json:"sessionPersist"`      // 会话跨进程持久化
	Fork               bool `json:"fork"`                // 会话分叉
	MultiAgent         bool `json:"multiAgent"`          // 子Agent树支持
	PermissionHooks    bool `json:"permissionHooks"`     // PreToolUse 风格权限回调
	Sandbox            bool `json:"sandbox"`             // OS级沙箱
	ThinkingVisible    bool `json:"thinkingVisible"`     // 思考过程对调用方可见
	MCPIntegration     bool `json:"mcpIntegration"`      // MCP工具注册
	StreamingToolExec  bool `json:"streamingToolExec"`   // 流式工具执行
	Compaction         bool `json:"compaction"`          // 自动上下文压缩
	ResumeLast         bool `json:"resumeLast"`          // --resume-last 能力
	Steer              bool `json:"steer"`               // 中段消息注入
}

// ============================================================================
// StartRequest -- all parameters needed to begin an agent turn
// 参考 cross-analysis-adapters.md StartRequest
// ============================================================================

// StartRequest carries all parameters needed to begin an agent turn.
// 参考 cross-analysis-adapters.md StartRequest
type StartRequest struct {
	// User prompt
	Prompt       string `json:"prompt"`
	SystemPrompt string `json:"systemPrompt,omitempty"` // Optional system prompt override

	// Model configuration
	// 参考 cross-analysis-adapters.md: Model, Thinking, MaxTokens, Temperature
	Model       string          `json:"model"`       // e.g., "claude-sonnet-4-6"
	Thinking    *ThinkingConfig `json:"thinking,omitempty"`
	MaxTokens   int             `json:"maxTokens,omitempty"`
	Temperature *float64        `json:"temperature,omitempty"`

	// Workspace
	// 参考 cross-analysis-sandbox-tools.md Section 1: WorkspaceInfo.RootPath
	WorkingDir   string   `json:"workingDir"`
	AllowedDirs  []string `json:"allowedDirs,omitempty"`

	// Tool configuration
	// 参考 cross-analysis-sandbox-tools.md Section 2: ToolRegistry
	AllowedTools []string   `json:"allowedTools,omitempty"` // whitelist
	DeniedTools  []string   `json:"deniedTools,omitempty"`  // blacklist
	MCPConfig    *MCPConfig `json:"mcpConfig,omitempty"`    // 参考 cross-analysis-adapters.md MCPConfig

	// Permission & safety
	// 参考 cross-analysis-adapters.md Section 1.3: Permission modes
	PermissionMode string        `json:"permissionMode"` // "default", "bypassPermissions", "plan", "acceptEdits"
	MaxTurns       int           `json:"maxTurns,omitempty"`
	MaxBudgetUSD   float64       `json:"maxBudgetUsd,omitempty"`
	Sandbox        *SandboxConfig `json:"sandbox,omitempty"`

	// Session continuity
	// 参考 cross-analysis-adapters.md Section 1.4: Session management
	SessionID    string    `json:"sessionId,omitempty"`    // Resume target (empty = new session)
	ForkFrom     string    `json:"forkFrom,omitempty"`     // Fork source session ID
	ForkHistory  *ForkMode `json:"forkHistory,omitempty"`  // 参考 cross-analysis-adapters.md ForkMode

	// Output control
	// 参考 cross-analysis-adapters.md Section 3.1 Workaround 6: thinking visibility
	IncludeThinking      bool `json:"includeThinking"`
	IncludePartialEvents bool `json:"includePartialEvents"`

	// AgentHub context injection
	// 参考 cross-analysis-orchestration.md Section 2: context passed to agent
	ConversationID string              `json:"conversationId,omitempty"`
	ThreadID       string              `json:"threadId,omitempty"`
	TurnID         string              `json:"turnId,omitempty"`
	Authority      ConversationAuthority `json:"authority,omitempty"`
	// 参考 cross-analysis-orchestration.md Section 3.2: delegation context
	DelegationDepth int `json:"delegationDepth,omitempty"`
	DelegationPath  []string `json:"delegationPath,omitempty"` // 委派链
	MaxDelegationDepth int `json:"maxDelegationDepth,omitempty"` // 参考 cross-analysis-orchestration.md: MAX_DELEGATION_DEPTH = 5

	// Provider-specific extras (opaque to AgentHub core)
	ProviderExtras map[string]any `json:"providerExtras,omitempty"`
}

// ThinkingConfig mirrors CC/Codex/OpenCode thinking parameters.
// 参考 cross-analysis-adapters.md ThinkingConfig
type ThinkingConfig struct {
	Type   string `json:"type"`   // "disabled", "adaptive", "enabled"
	Budget *int   `json:"budget"` // Token budget (when Type=enabled)
}

// MCPConfig describes MCP servers to connect.
// 参考 cross-analysis-adapters.md MCPConfig
// 参考 cross-analysis-sandbox-tools.md Section 2.3.4: MCP integration
type MCPConfig struct {
	Servers []MCPServerDef `json:"servers"`
}

type MCPServerDef struct {
	Name      string            `json:"name"`
	Transport string            `json:"transport"` // "stdio", "sse", "http", "ws"
	Command   string            `json:"command,omitempty"`
	Args      []string          `json:"args,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	URL       string            `json:"url,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	Timeout   int               `json:"timeout,omitempty"` // connection timeout seconds
}

// SandboxConfig describes sandbox restrictions.
// 参考 cross-analysis-sandbox-tools.md Section 1.2: 三级沙箱策略
// 参考 cross-analysis-adapters.md SandboxConfig
type SandboxConfig struct {
	Enabled    bool              `json:"enabled"`
	FileSystem *FSSandboxConfig  `json:"fileSystem,omitempty"`
	Network    *NetSandboxConfig `json:"network,omitempty"`
}

type FSSandboxConfig struct {
	ReadPaths  []string `json:"readPaths,omitempty"`
	WritePaths []string `json:"writePaths,omitempty"`
	DenyPaths  []string `json:"denyPaths,omitempty"`
}

type NetSandboxConfig struct {
	AllowedHosts []string `json:"allowedHosts,omitempty"`
	DeniedHosts  []string `json:"deniedHosts,omitempty"`
	AllowLocal   bool     `json:"allowLocal"`
}

// ForkMode defines how much conversation history to carry on fork.
// 参考 cross-analysis-adapters.md ForkMode
type ForkMode struct {
	Mode     string `json:"mode"`     // "full", "last_n_turns"
	NumTurns int    `json:"numTurns"` // Only used when Mode="last_n_turns"
}

// ============================================================================
// Session & Event Types
// 参考 cross-analysis-adapters.md Section 2.2
// ============================================================================

// AgentSession represents a running agent session.
// 参考 cross-analysis-adapters.md AgentSession
type AgentSession struct {
	ID           string       `json:"id"` // Adapter-specific session identifier
	Status       AgentStatus  `json:"status"`
	StartRequest StartRequest `json:"startRequest"` // Original request for resume/reconnect

	// Usage accumulates across the session.
	Usage *UsageInfo `json:"usage,omitempty"`

	// Provider info populated after system_init.
	ProviderInfo *ProviderInfo `json:"providerInfo,omitempty"`

	// Events is the stream of agent events.
	Events *EventStream `json:"-"` // Channel-based; not serialized
}

// AgentStatus tracks the current state of a session.
// 参考 cross-analysis-adapters.md AgentStatus
type AgentStatus string

const (
	StatusIdle            AgentStatus = "idle"
	StatusStarting        AgentStatus = "starting"
	StatusRunning         AgentStatus = "running"
	StatusWaitingApproval AgentStatus = "waiting_approval"
	StatusDraining        AgentStatus = "draining" // 参考 cross-analysis-adapters.md Section 3.4: Kanna draining
	StatusDone            AgentStatus = "done"
	StatusFailed          AgentStatus = "failed"
	StatusCancelled       AgentStatus = "cancelled"
)

// EventStream wraps a channel of AgentEvents with lifecycle controls.
// 参考 cross-analysis-adapters.md EventStream
type EventStream struct {
	C      <-chan AgentEvent  // 参考 cross-analysis-adapters.md: event channel
	Cancel context.CancelFunc  // Cancels the underlying agent process/turn
	Err    error              // Set on abnormal termination
}

// ============================================================================
// Session Info & Fork Types
// 参考 cross-analysis-adapters.md Section 2.2
// ============================================================================

type ForkRequest struct {
	SourceSessionID string   `json:"sourceSessionId"`
	ForkMode        ForkMode `json:"forkMode"`
	Title           string   `json:"title,omitempty"`
}

type SessionInfo struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Project      string    `json:"project"`
	CreatedAt    int64     `json:"createdAt"`
	UpdatedAt    int64     `json:"updatedAt"`
	MessageCount int       `json:"messageCount"`
	Model        string    `json:"model"`
}

type Pagination struct {
	Cursor string `json:"cursor,omitempty"`
	Limit  int    `json:"limit"`
}

// SteerMessage injects a user message into a running turn.
// 参考 cross-analysis-adapters.md SteerMessage
type SteerMessage struct {
	Content     string `json:"content"`
	ReplaceLast bool   `json:"replaceLast"` // 参考 cross-analysis-adapters.md: Kanna steer ReplaceLast flag
}

// ============================================================================
// Permission Types (adapter-level)
// 参考 cross-analysis-adapters.md Section 2.2 "Permission Callback Types"
// ============================================================================

// ToolPermissionRequest is sent by the adapter to AgentHub's approval engine.
// 参考 cross-analysis-adapters.md ToolPermissionRequest
type ToolPermissionRequest struct {
	SessionID     string         `json:"sessionId"`
	TurnID        string         `json:"turnId"`
	ToolCallID    string         `json:"toolCallId"`
	ToolName      string         `json:"toolName"`
	ToolInput     map[string]any `json:"toolInput"`
	IsReadOnly    bool           `json:"isReadOnly"`
	IsDestructive bool           `json:"isDestructive"`
	Context       string         `json:"context"` // human-readable description
}

// PermissionDecision is the response from AgentHub's approval engine.
// 参考 cross-analysis-adapters.md PermissionDecision
type PermissionDecision struct {
	Behavior     string         `json:"behavior"`     // "allow", "deny", "ask_user"
	UpdatedInput map[string]any `json:"updatedInput,omitempty"`
	Reason       string         `json:"reason"`
}

// PermissionCallback is the function signature adapters call to check permissions.
// 参考 cross-analysis-adapters.md PermissionCallback
type PermissionCallback func(req ToolPermissionRequest) (*PermissionDecision, error)

// ============================================================================
// Adapter Configuration
// 参考 cross-analysis-adapters.md AdapterConfig
// ============================================================================

// AdapterConfig holds all provider-specific configuration.
type AdapterConfig struct {
	// Binary path
	BinaryPath string `json:"binaryPath"`

	// Environment
	Env map[string]string `json:"env,omitempty"`

	// Config file paths
	SettingsPath  string `json:"settingsPath,omitempty"`  // CC: settings.json
	ConfigPath    string `json:"configPath,omitempty"`    // Codex: config.toml
	MCPConfigPath string `json:"mcpConfigPath,omitempty"` // CC: .mcp.json

	// API keys / authentication
	APIKey       string `json:"apiKey,omitempty"`
	APIKeyEnvVar string `json:"apiKeyEnvVar,omitempty"`

	// Home directories
	DataDir string `json:"dataDir"` // ~/.claude, $CODEX_HOME, etc.

	// Streaming
	StreamTimeoutMs int `json:"streamTimeoutMs,omitempty"`

	// Provider extras (passthrough)
	Extras map[string]any `json:"extras,omitempty"`
}

// ============================================================================
// Per-Agent Special Configuration
// 参考 cross-analysis-adapters.md Section 3 "Per-Agent Special Handling & Workarounds"
// ============================================================================

// ClaudeCodeConfig is the CC-specific adapter configuration.
// 参考 cross-analysis-adapters.md Section 3.1
type ClaudeCodeConfig struct {
	AdapterConfig
	// 参考 Section 3.1 Workaround 3: --verbose mandatory for full events
	Verbose bool `json:"verbose"` // ALWAYS true for AgentHub

	// 参考 Section 3.1 Workaround 5: permission mode for headless
	// Use "bypassPermissions" or stdin control protocol can_use_tool
	HeadlessPermissionMode string `json:"headlessPermissionMode"`

	// 参考 Section 3.1 Workaround 6: thinking visibility requires Type=enabled
	ForceThinkingEnabled bool `json:"forceThinkingEnabled"`
}

// CodexConfig is the Codex-specific adapter configuration.
// 参考 cross-analysis-adapters.md Section 3.2
type CodexConfig struct {
	AdapterConfig
	// 参考 Section 3.2 Workaround 4: config.toml auto-generation
	AutoGenerateConfig bool `json:"autoGenerateConfig"`

	// 参考 Section 3.2 Workaround 1: rollout trace replay
	RolloutTracePath string `json:"rolloutTracePath,omitempty"`

	// 参考 Section 3.2 Workaround 2: SessionId + ThreadId duality
	SessionID string `json:"sessionId"`
	ThreadID  string `json:"threadId"`
}

// OpenCodeConfig is the OpenCode-specific adapter configuration.
// 参考 cross-analysis-adapters.md Section 3.3
type OpenCodeConfig struct {
	AdapterConfig
	// 参考 Section 3.3 Workaround 1: server lifecycle management
	Port          int  `json:"port"` // default 4096
	AutoStart     bool `json:"autoStart"`
	HealthTimeout int  `json:"healthTimeout"` // ms to wait for /health

	// 参考 Section 3.3 Workaround 4: agent info hardcoding
	AgentID string `json:"agentId"`
}
```

---

## 3. Hub-Edge Sync Protocol (`sync.go`)

```go
package protocol

import "time"

// ============================================================================
// Hub-Edge Sync Protocol
// 参考 architecture.md: "Hub <-> Edge 同步协议"
// 参考 cross-analysis-orchestration.md Section 2: Edge-Hub relay
// 参考 protocol.md: EdgeEvent / EdgeToHubEvent / HubToEdgeCommand
// ============================================================================

// ============================================================================
// Edge Registration & Heartbeat
// 参考 architecture.md: edge.register, edge.heartbeat
// ============================================================================

// RegisterRequest is sent by Edge to Hub on initial connection.
// 参考 architecture.md: "Edge -> Hub: edge.register (edgeId, deviceName)"
// 参考 protocol.md: EdgeToHubEvent type "edge.register"
type RegisterRequest struct {
	EdgeID       string   `json:"edgeId"`
	DeviceName   string   `json:"deviceName"`
	Capabilities []string `json:"capabilities"` // supported operations: "runner", "agent-claude", "agent-codex"
	Hostname     string   `json:"hostname"`
	OS           string   `json:"os"`
	Arch         string   `json:"arch"`
	Version      string   `json:"version"` // edge-server version
}

// RegisterResponse is Hub's acknowledgment of registration.
type RegisterResponse struct {
	HubID     string `json:"hubId"`
	Accepted  bool   `json:"accepted"`
	SessionID string `json:"sessionId"` // Hub-assigned session token for this WSS
	Message   string `json:"message,omitempty"`
}

// Heartbeat is sent periodically from Edge to Hub.
// 参考 architecture.md: "Edge -> Hub: edge.heartbeat"
type Heartbeat struct {
	EdgeID      string        `json:"edgeId"`
	Seq         int64         `json:"seq"`          // 参考 cross-analysis-orchestration.md: monotonic seq
	Runners     []RunnerStatus `json:"runners"`     // active runner statuses
	SentAt      time.Time     `json:"sentAt"`
}

// RunnerStatus is a snapshot of a Runner's health.
// 参考 architecture.md: Runner
type RunnerStatus struct {
	RunnerID      string    `json:"runnerId"`
	EdgeID        string    `json:"edgeId"`
	Status        string    `json:"status"` // "idle", "running", "error"
	CurrentRunID  *RunID    `json:"currentRunId,omitempty"`
	ActiveSessions int      `json:"activeSessions"`
	LastHeartbeat time.Time `json:"lastHeartbeat"`
}

// ============================================================================
// EdgeEvent -- the unit of sync
// 参考 protocol.md: EdgeEvent
// 参考 architecture.md: "conversation.synced", "run.status", "artifact.created"
// ============================================================================

// EdgeEvent is the unit of synchronization between Edge and Hub.
// 参考 protocol.md EdgeEvent
// 参考 architecture.md: Hub ↔ Edge sync protocol sequence
type EdgeEvent struct {
	ID        string          `json:"id"`
	EdgeID    string          `json:"edgeId"`
	Seq       int64           `json:"seq"`       // 参考 cross-analysis-orchestration.md: monotonic sequence
	Type      EdgeEventType   `json:"type"`
	Payload   any             `json:"payload"`
	CreatedAt time.Time       `json:"createdAt"`
	SyncStatus SyncStatus     `json:"syncStatus"` // 参考 protocol.md: "pending", "synced", "failed"
}

type EdgeEventType string

const (
	EdgeMessageCreated   EdgeEventType = "message.created"    // 参考 protocol.md
	EdgeRunStarted       EdgeEventType = "run.started"         // 参考 protocol.md
	EdgeRunStatusChanged EdgeEventType = "run.status.changed"  // 参考 protocol.md
	EdgeArtifactCreated  EdgeEventType = "artifact.created"    // 参考 protocol.md
	EdgeMemoryUpdated    EdgeEventType = "memory.updated"      // 参考 protocol.md
	EdgeSummaryUpdated   EdgeEventType = "summary.updated"     // 参考 protocol.md
	EdgeThreadCreated    EdgeEventType = "thread.created"      // 参考 cross-analysis-orchestration.md
	EdgeApprovalRequired EdgeEventType = "approval.required"   // 参考 cross-analysis-sandbox-tools.md Section 2.4
	EdgeApprovalResolved EdgeEventType = "approval.resolved"   // 参考 cross-analysis-sandbox-tools.md Section 2.4
	EdgeCheckpointCreated EdgeEventType = "checkpoint.created" // 参考 cross-analysis-sandbox-tools.md Section 3
)

type SyncStatus string

const (
	SyncPending SyncStatus = "pending"
	SyncSynced  SyncStatus = "synced"
	SyncFailed  SyncStatus = "failed"
)

// ============================================================================
// Sync Batch & Ack
// ============================================================================

// SyncBatch is a batch of EdgeEvents sent together.
// 参考 architecture.md: "conversation.synced (消息批量)"
type SyncBatch struct {
	EdgeID     string      `json:"edgeId"`
	Events     []EdgeEvent `json:"events"`
	FirstSeq   int64       `json:"firstSeq"`
	LastSeq    int64       `json:"lastSeq"`
	BatchSize  int         `json:"batchSize"`
	SentAt     time.Time   `json:"sentAt"`
}

// SyncAck acknowledges receipt of a sync batch.
// 参考 protocol.md: HubToEdgeCommand type "sync.ack"
// 参考 architecture.md: "Hub -> Edge: sync.ack"
type SyncAck struct {
	EdgeID      string    `json:"edgeId"`
	LastSeq     int64     `json:"lastSeq"`     // 参考 cross-analysis-orchestration.md: last synced seq
	Accepted    bool      `json:"accepted"`
	FailedSeqs  []int64   `json:"failedSeqs,omitempty"` // failed sequence numbers for selective retry
	Message     string    `json:"message,omitempty"`
	AckedAt     time.Time `json:"ackedAt"`
}

// SyncState tracks synchronization progress between Edge and Hub.
// 参考 cross-analysis-orchestration.md: Seq management
type SyncState struct {
	EdgeID        string    `json:"edgeId"`
	LastLocalSeq  int64     `json:"lastLocalSeq"`  // last event seq on Edge
	LastSyncedSeq int64     `json:"lastSyncedSeq"` // last seq acknowledged by Hub
	PendingCount  int       `json:"pendingCount"`  // unsynced events
	LastSyncedAt  time.Time `json:"lastSyncedAt"`
	Status        string    `json:"status"`        // "synced", "syncing", "lagging", "disconnected"
}

// ============================================================================
// Authority Transfer
// 参考 architecture.md: ConversationAuthority
// 参考 authority.md: Authority ownership rules
// ============================================================================

// AuthorityTransfer changes the ownership of a conversation or artifact.
// 参考 authority.md: "Conversation Authority owns message append order"
type AuthorityTransfer struct {
	ID             string                 `json:"id"`
	ObjectType     string                 `json:"objectType"` // "conversation", "artifact", "memory"
	ObjectID       string                 `json:"objectId"`
	FromAuthority  ConversationAuthority   `json:"fromAuthority"`
	ToAuthority    ConversationAuthority   `json:"toAuthority"`
	Reason         string                 `json:"reason"`      // "user_migration", "edge_offline", "manual"
	RequestedBy    string                 `json:"requestedBy"` // user or system
	Status         TransferStatus         `json:"status"`
	CreatedAt      time.Time              `json:"createdAt"`
	CompletedAt    *time.Time             `json:"completedAt,omitempty"`
}

type TransferStatus string

const (
	TransferRequested TransferStatus = "requested"
	TransferAccepted  TransferStatus = "accepted"
	TransferCompleted TransferStatus = "completed"
	TransferRejected  TransferStatus = "rejected"
)

// ============================================================================
// Hub-to-Edge Commands
// 参考 architecture.md: Hub -> Edge relay commands
// 参考 protocol.md: HubToEdgeCommand
// ============================================================================

// HubToEdgeCommand is a command sent from Hub to Edge.
// 参考 protocol.md: HubToEdgeCommand discriminated union
type HubToEdgeCommand struct {
	Type    HubToEdgeCommandType `json:"type"`
	Payload any                  `json:"payload"`
	TraceID string               `json:"traceId,omitempty"`   // 参考 protocol.md: ProtocolEnvelope traceId
	SentAt  time.Time            `json:"sentAt"`
}

type HubToEdgeCommandType string

const (
	HubCmdRunStart       HubToEdgeCommandType = "run.start"        // 参考 architecture.md: "Hub -> Edge: run.start"
	HubCmdRunStop        HubToEdgeCommandType = "run.stop"         // 参考 protocol.md
	HubCmdMessageDeliver HubToEdgeCommandType = "message.deliver"  // 参考 architecture.md: "Hub -> Edge: message.deliver"
	HubCmdSyncAck        HubToEdgeCommandType = "sync.ack"         // 参考 protocol.md
	HubCmdPreviewRequest HubToEdgeCommandType = "preview.request"  // 参考 protocol.md
	HubCmdMemorySync     HubToEdgeCommandType = "memory.sync.request" // 参考 architecture.md: "Hub -> Edge: memory.sync.request"
	HubCmdAuthorityTransfer HubToEdgeCommandType = "authority.transfer" // authority transfer command
)

// EdgeToHubEvent is an event sent from Edge to Hub.
// 参考 protocol.md: EdgeToHubEvent discriminated union
type EdgeToHubEvent struct {
	Type    EdgeToHubEventType `json:"type"`
	Payload any                `json:"payload"`
	TraceID string             `json:"traceId,omitempty"`
	SentAt  time.Time          `json:"sentAt"`
}

type EdgeToHubEventType string

const (
	EdgeToHubRegister        EdgeToHubEventType = "edge.register"        // 参考 protocol.md
	EdgeToHubHeartbeat       EdgeToHubEventType = "edge.heartbeat"       // 参考 protocol.md
	EdgeToHubSyncEvents      EdgeToHubEventType = "sync.events"          // 参考 protocol.md
	EdgeToHubRunEvent        EdgeToHubEventType = "run.event"            // 参考 protocol.md
	EdgeToHubArtifactMetadata EdgeToHubEventType = "artifact.metadata"   // 参考 protocol.md
	EdgeToHubSyncState       EdgeToHubEventType = "sync.state"           // sync state report
)

// ============================================================================
// Relay Command (for Hub-relayed execution)
// 参考 architecture.md: "Hub Relay 中继"
// ============================================================================

// RelayCommand wraps a command being relayed through Hub to a remote Edge.
type RelayCommand struct {
	ID             string             `json:"id"`
	SourceNodeID   NodeID             `json:"sourceNodeId"`   // who sent it
	TargetEdgeID   string             `json:"targetEdgeId"`   // where it goes
	TargetRunnerID string             `json:"targetRunnerId,omitempty"` // specific runner
	Command        RunnerCommand      `json:"command"`
	TraceID        string             `json:"traceId,omitempty"`
	CreatedAt      time.Time          `json:"createdAt"`
	ExpiresAt      *time.Time         `json:"expiresAt,omitempty"`
}

// RunnerCommand is a command dispatched to a Runner to manage agent execution.
// 参考 protocol.md RunnerCommand
// 参考 architecture.md: Edge -> Runner commands
type RunnerCommand struct {
	Type    RunnerCommandType `json:"type"`
	Payload any               `json:"payload"`
}

type RunnerCommandType string

const (
	RunnerCmdRunStart    RunnerCommandType = "run.start"    // 参考 protocol.md: { type: "run.start"; runId; agentId; workspaceId; prompt }
	RunnerCmdRunCancel   RunnerCommandType = "run.cancel"   // 参考 protocol.md: { type: "run.cancel"; runId }
	RunnerCmdArtifactRead RunnerCommandType = "artifact.read" // 参考 protocol.md: { type: "artifact.read"; artifactId }
	RunnerCmdCheckpointCreate RunnerCommandType = "checkpoint.create" // 参考 cross-analysis-sandbox-tools.md Section 3.5
	RunnerCmdCheckpointRestore RunnerCommandType = "checkpoint.restore"
)

// RunnerEvent is an event emitted from Runner to Edge.
// 参考 protocol.md RunnerEvent
// 参考 architecture.md: "Runner -> Edge 事件流"
type RunnerEvent struct {
	Type      RunnerEventType `json:"type"`
	RunID     RunID           `json:"runId"`
	RunnerID  string          `json:"runnerId"`
	Payload   any             `json:"payload"`
	Seq       int64           `json:"seq"`
	CreatedAt time.Time       `json:"createdAt"`
}

type RunnerEventType string

const (
	RunnerEventRunStarted      RunnerEventType = "run.started"       // 参考 protocol.md
	RunnerEventRunOutput       RunnerEventType = "run.output"        // 参考 protocol.md: stdout/stderr text
	RunnerEventArtifactCreated RunnerEventType = "artifact.created"   // 参考 protocol.md
	RunnerEventRunFinished     RunnerEventType = "run.finished"      // 参考 protocol.md
	RunnerEventPermissionReq   RunnerEventType = "permission.request" // 参考 cross-analysis-sandbox-tools.md Section 2.4
	RunnerEventCheckpointDone  RunnerEventType = "checkpoint.created" // 参考 cross-analysis-sandbox-tools.md Section 3
	RunnerEventAgentEvent      RunnerEventType = "agent.event"       // wrapped AgentEvent from adapter
)

// ============================================================================
// Protocol Envelope (Edge-Hub transport)
// 参考 protocol.md: ProtocolEnvelope<T>
// ============================================================================

// ProtocolEnvelope wraps any protocol message for transport.
// 参考 protocol.md: "Every protocol message should eventually carry version, id, traceId, sentAt"
type ProtocolEnvelope struct {
	Version string    `json:"version"` // "v1"
	ID      string    `json:"id"`
	TraceID string    `json:"traceId,omitempty"`
	SentAt  time.Time `json:"sentAt"`
	Payload any       `json:"payload"`
}
```

---

## 4. Orchestrator Protocol (`orchestration.go`)

```go
package protocol

import "time"

// ============================================================================
// Orchestrator Protocol
// 参考 cross-analysis-orchestration.md: 三层调度架构 + 四种调度策略 + 四层防循环
// ============================================================================

// ============================================================================
// Dispatch Strategy
// 参考 cross-analysis-orchestration.md Section 2.4: 调度策略混合模式
// ============================================================================

// DispatchStrategy defines how an incoming message is routed to agents.
// 参考 cross-analysis-orchestration.md Section 2.4: 四种策略
type DispatchStrategy struct {
	// 参考 Section 2.4 策略 A: @mention 直接委派（默认模式）
	DirectMention *DirectMentionStrategy `json:"directMention,omitempty"`

	// 参考 Section 2.4 策略 B: Supervisor 自动路由（多 Agent 协作模式）
	Supervisor *SupervisorStrategy `json:"supervisor,omitempty"`

	// 参考 Section 2.4 策略 C: YAML Template 预定义（复杂工作流模式）
	Template *TemplateStrategy `json:"template,omitempty"`

	// 参考 Section 2.4 策略 D: Fork 并行探索（多方案对比模式）
	Fork *ForkStrategy `json:"fork,omitempty"`

	// 参考 Section 2.5: 调度决策流程图
	// Priority order: DirectMention > Supervisor > Template > Fork
}

// DirectMentionStrategy: @mention 即委派
// 参考 cross-analysis-orchestration.md Section 2.4 策略A
type DirectMentionStrategy struct {
	// If true, agent responses are visible to all group members
	PublicResponse bool `json:"publicResponse"`

	// Delay before auto-routing when no explicit @mention
	AutoRouteDelayMs int `json:"autoRouteDelayMs,omitempty"`
}

// SupervisorStrategy: LLM as router
// 参考 cross-analysis-orchestration.md Section 2.4 策略B
// 参考 cross-analysis-orchestration.md Section 1.1: Flowise Supervisor/Worker
type SupervisorStrategy struct {
	// Supervisor agent ID (e.g., "coordinator-agent")
	SupervisorID string `json:"supervisorId"`

	// Available worker agents the supervisor can route to
	Workers []string `json:"workers"`

	// 参考 cross-analysis-orchestration.md Section 3.2 Layer 3: recursionLimit
	MaxIterations int `json:"maxIterations"` // default 15-25 (AgentHub more conservative than Flowise 100)

	// 参考 cross-analysis-orchestration.md Section 3.2 Layer 3: Worker 历史黑名单
	MaxSameWorkerRetries int `json:"maxSameWorkerRetries"` // 连续路由到同一 Worker 上限 (default 2)

	// 参考 cross-analysis-orchestration.md: multi-model adaptation
	// LLM routing tool strategy: "function_calling" | "prompt_injection" | "tool_choice_any"
	RoutingStrategy string `json:"routingStrategy"`
}

// TemplateStrategy: YAML workflow template
// 参考 cross-analysis-orchestration.md Section 2.4 策略C
// 参考 cross-analysis-orchestration.md Section 1.2: ChatDev YAML + Edge 条件路由
type TemplateStrategy struct {
	TemplateID string `json:"templateId"`
	Version    string `json:"version"`     // template version
	MaxIterations int `json:"maxIterations"` // 参考 cross-analysis-orchestration.md: max_iterations per template

	// 参考 cross-analysis-orchestration.md: Edge condition routing
	// conditions are defined in the template, evaluated at runtime
}

// ForkStrategy: parallel exploration
// 参考 cross-analysis-orchestration.md Section 2.4 策略D
// 参考 cross-analysis-im-ux.md Section 2.3: Fork 四种模式
type ForkStrategy struct {
	// 参考 cross-analysis-im-ux.md: ForkMode DIRECT_PATH / INCLUDE_BRANCHES / TARGET_LEVEL / DEFAULT
	ForkMode ForkBranchMode `json:"forkMode"`
	// Agent IDs to fork to in parallel
	TargetAgents []string `json:"targetAgents"`
	// 参考 cross-analysis-orchestration.md: MAX_FORK_BRANCHES_PER_MESSAGE = 5
	MaxBranches int `json:"maxBranches"`
}

// ForkBranchMode mirrors LibreChat's fork modes.
// 参考 cross-analysis-im-ux.md Section 2.3: Fork 四种模式
type ForkBranchMode string

const (
	ForkDirectPath      ForkBranchMode = "direct_path"      // Only the target path
	ForkIncludeBranches ForkBranchMode = "include_branches"  // Target path + sibling branches
	ForkTargetLevel     ForkBranchMode = "target_level"      // All messages at target level
	ForkDefault         ForkBranchMode = "default"           // System default
)

// ============================================================================
// Subagent Graph & Cycle Detection
// 参考 cross-analysis-orchestration.md Section 3: 四层防护
// ============================================================================

// SubagentGraph represents the delegation topology.
// 参考 cross-analysis-orchestration.md Section 3.2: 运行时祖先追踪
// 参考 cross-analysis-orchestration.md Section 3.1: 循环产生场景
type SubagentGraph struct {
	ID        string            `json:"id"`
	Nodes     []SubagentNode    `json:"nodes"`
	Edges     []SubagentEdge    `json:"edges"`
	RootID    string            `json:"rootId"`    // entry point agent/user
	MaxDepth  int               `json:"maxDepth"`  // 参考 cross-analysis-orchestration.md: MAX_DELEGATION_DEPTH = 5
	CreatedAt time.Time         `json:"createdAt"`
}

// SubagentNode is a node in the delegation graph.
type SubagentNode struct {
	ID        string `json:"id"`        // agent ID or user ID
	Type      SubagentNodeType `json:"type"`
	Role      string `json:"role"`      // agent role description
	Capabilities []string `json:"capabilities,omitempty"`
	Status    string `json:"status"`    // "idle", "busy", "error"
}

type SubagentNodeType string

const (
	SubagentNodeUser  SubagentNodeType = "user"
	SubagentNodeAgent SubagentNodeType = "agent"
)

// SubagentEdge represents a delegation from one node to another.
// 参考 cross-analysis-orchestration.md Section 3.2: DelegationContext.path
type SubagentEdge struct {
	From     string `json:"from"`     // delegator
	To       string `json:"to"`       // delegatee
	Breadcrumb string `json:"breadcrumb"` // 参考 cross-analysis-orchestration.md: 委派原因摘要（审计）
	Depth    int    `json:"depth"`    // 参考 cross-analysis-orchestration.md: delegation depth
}

// ============================================================================
// Four-Layer Cycle Detection
// 参考 cross-analysis-orchestration.md Section 3.2: 综合防循环方案（四层防护）
// ============================================================================

// CycleDetectionResult is the outcome of cycle checking.
// 参考 cross-analysis-orchestration.md Section 3.2
type CycleDetectionResult struct {
	HasCycle    bool              `json:"hasCycle"`
	CyclePath   []string          `json:"cyclePath,omitempty"`    // delegation path forming the cycle
	DetectedAt  CycleDetectionLayer `json:"detectedAt"`
	Reason      string            `json:"reason"`                 // human-readable explanation
	Remediation string            `json:"remediation,omitempty"`  // suggested fix
}

type CycleDetectionLayer string

const (
	CycleLayerStatic     CycleDetectionLayer = "static"     // Layer 1: 预执行静态检测
	CycleLayerRuntime    CycleDetectionLayer = "runtime"    // Layer 2: 运行时祖先追踪
	CycleLayerSupervisor CycleDetectionLayer = "supervisor" // Layer 3: LLM 路由安全网
	CycleLayerSystem     CycleDetectionLayer = "system"     // Layer 4: 全局资源限流
)

// CycleGuard encapsulates all cycle prevention layers.
// 参考 cross-analysis-orchestration.md Section 3.2 防循环机制总览
type CycleGuard struct {
	// Layer 1: Static analysis
	// 参考 cross-analysis-orchestration.md Section 3.2 Layer 1
	// 参考 Langflow graph/graph/base.py build_graph_maps
	AllowSelfDelegation bool `json:"allowSelfDelegation"` // default false
	MaxDeclaredDepth    int  `json:"maxDeclaredDepth"`    // 参考: MAX_DECLARED_DEPTH

	// Layer 2: Runtime path tracking
	// 参考 cross-analysis-orchestration.md Section 3.2 Layer 2
	// 参考 LibreChat buildSubagentConfigs ancestors: Set<string>
	MaxDepth       int `json:"maxDepth"`       // 参考: MAX_DELEGATION_DEPTH = 5
	MaxDurationMs  int `json:"maxDurationMs"`  // 参考: MAX_DELEGATION_CHAIN_DURATION = 300000 (5min)

	// Layer 3: Supervisor guardrails
	// 参考 cross-analysis-orchestration.md Section 3.2 Layer 3
	// 参考 Flowise recursionLimit + ChatDev Loop Counter
	RecursionLimit      int `json:"recursionLimit"`      // 参考: 15-25
	MaxSameWorkerRoutes int `json:"maxSameWorkerRoutes"` // 连续路由同Worker上限

	// Layer 4: System-wide limits
	// 参考 cross-analysis-orchestration.md Section 3.2 Layer 4
	// 参考 LibreChat MAX_SUBAGENT_RUN_CONFIGS
	MaxActiveSubagentsPerGroup  int `json:"maxActiveSubagentsPerGroup"`  // 参考: 10
	MaxTotalSubagentsGlobal     int `json:"maxTotalSubagentsGlobal"`     // 参考: 100
	MaxForkBranchesPerMessage   int `json:"maxForkBranchesPerMessage"`   // 参考: 5
	RateLimitDelegationsPerAgent int `json:"rateLimitDelegationsPerAgent"` // 参考: 20/min
}

// DelegationContext tracks the runtime delegation state.
// 参考 cross-analysis-orchestration.md Section 3.2 Layer 2: DelegationContext
type DelegationContext struct {
	Path          []string  `json:"path"`          // 委派链: ["user", "CodeAgent", "ReviewAgent"]
	Depth         int       `json:"depth"`         // 当前深度
	StartTime     time.Time `json:"startTime"`     // 委派链起始时间
	MaxDepth      int       `json:"maxDepth"`      // 配置的最大深度
	MaxDurationMs int       `json:"maxDurationMs"` // 时间预算
	Breadcrumbs   []string  `json:"breadcrumbs"`   // 委派原因链（审计）
}

// ValidateDelegation checks for cycles, depth, and time budget.
// 参考 cross-analysis-orchestration.md Section 3.2: validateDelegation()
func (d *DelegationContext) ValidateDelegation(targetID string) *CycleDetectionResult {
	// Layer 2: cycle detection
	for _, id := range d.Path {
		if id == targetID {
			return &CycleDetectionResult{
				HasCycle:   true,
				CyclePath:  append(d.Path, targetID),
				DetectedAt: CycleLayerRuntime,
				Reason:     "delegation cycle detected",
			}
		}
	}

	// Layer 2: depth check
	if d.Depth >= d.MaxDepth {
		return &CycleDetectionResult{
			HasCycle:   true, // treated as cycle for blocking purposes
			DetectedAt: CycleLayerRuntime,
			Reason:     "max delegation depth exceeded",
		}
	}

	// Layer 2: time budget
	elapsed := time.Since(d.StartTime).Milliseconds()
	if elapsed > int64(d.MaxDurationMs) {
		return &CycleDetectionResult{
			HasCycle:   true,
			DetectedAt: CycleLayerRuntime,
			Reason:     "delegation chain time budget exceeded",
		}
	}

	return &CycleDetectionResult{HasCycle: false}
}

// ============================================================================
// Agent Capability Registry
// 参考 cross-analysis-orchestration.md Section 2.3 Layer 2: Agent Capability Registry
// 参考 cross-analysis-orchestration.md Section 4.3: Agent Capability 的输出自动暴露为 MCP tool
// ============================================================================

// AgentCapability describes what an agent can do, used for routing decisions.
// 参考 cross-analysis-orchestration.md Section 2.3 Layer 2
type AgentCapability struct {
	AgentID      string           `json:"agentId"`
	AgentName    string           `json:"agentName"`
	DisplayName  string           `json:"displayName"`
	Provider     string           `json:"provider"`     // "claude-code", "codex", "opencode"
	Role         string           `json:"role"`         // "Full-stack developer", "Code reviewer", etc.
	ModelDefault string           `json:"modelDefault"` // default model
	Models       []string         `json:"models"`       // available models

	// Tools
	// 参考 cross-analysis-sandbox-tools.md Section 2: ToolRegistry
	Tools        []string         `json:"tools"`        // built-in tools
	MCPTools     []string         `json:"mcpTools"`     // MCP-provided tools

	// Skills (higher-level composed capabilities)
	// 参考 cross-analysis-orchestration.md Section 4.3: Agent output → MCP tool
	Skills       []string         `json:"skills"`       // registered skills

	// Sub-agents this agent can spawn
	// 参考 cross-analysis-orchestration.md Section 3: subagent delegation
	SubAgents    []string         `json:"subAgents"`

	// Permissions
	AllowedDirs  []string         `json:"allowedDirs,omitempty"`
	Sandbox      SandboxLevel     `json:"sandbox"`

	// Status
	Status       AgentStatus      `json:"status"`       // idle, busy, offline, error
	CurrentLoad  int              `json:"currentLoad"`  // active task count
	LastSeen     time.Time        `json:"lastSeen"`

	// Metadata for UI display
	Icon         string           `json:"icon,omitempty"`
	Color        string           `json:"color,omitempty"`
}

// SandboxLevel maps to the three-tier sandbox strategy.
// 参考 cross-analysis-sandbox-tools.md Section 1.2: 三级沙箱策略
type SandboxLevel string

const (
	SandboxWorktree SandboxLevel = "worktree" // Level 1: git worktree 隔离 (default)
	SandboxProcess  SandboxLevel = "process"  // Level 2: 子进程隔离
	SandboxDocker   SandboxLevel = "docker"   // Level 3: 容器隔离
)

// ============================================================================
// Tool Registry
// 参考 cross-analysis-sandbox-tools.md Section 2.3: AgentHub Tool Registry
// 参考 cross-analysis-sandbox-tools.md Section 2.2: Dify Tool Provider 模式
// ============================================================================

// ToolDescriptor describes a registered tool.
// 参考 cross-analysis-sandbox-tools.md Section 2.3.2: ToolDescriptor
type ToolDescriptor struct {
	Name             string          `json:"name"`
	DisplayName      string          `json:"displayName"`
	Description      string          `json:"description"`   // LLM-readable description
	Provider         ToolProviderType `json:"provider"`
	Schema           ToolSchema      `json:"schema"`        // JSON Schema for parameters
	RiskLevel        RiskLevel       `json:"riskLevel"`
	RequiresApproval bool            `json:"requiresApproval"`
	ApprovalKind     ApprovalKind    `json:"approvalKind"`  // "once" | "per_thread" | "per_session"
	Enabled          bool            `json:"enabled"`
}

// ToolProviderType matches Dify's provider categories.
// 参考 cross-analysis-sandbox-tools.md Section 2.2: Dify 6 Provider types
// 参考 cross-analysis-sandbox-tools.md Section 2.3.3: ToolProviderType
type ToolProviderType string

const (
	ToolBuiltin  ToolProviderType = "builtin"   // CLI 原生工具 (bash/read/write/edit/glob/grep)
	ToolMCP      ToolProviderType = "mcp"       // MCP 协议工具
	ToolAPI      ToolProviderType = "api"       // REST API 封装工具
	ToolPlugin   ToolProviderType = "plugin"    // 插件系统工具
	ToolComposite ToolProviderType = "composite" // 组合工具（pipeline）
)

// ToolSchema defines the JSON Schema for tool parameters.
type ToolSchema struct {
	Type       string              `json:"type"`       // "object"
	Properties map[string]ToolParam `json:"properties"`
	Required   []string            `json:"required,omitempty"`
}

type ToolParam struct {
	Type        string   `json:"type"`        // "string", "number", "boolean", "array", "object"
	Description string   `json:"description"`
	Enum        []string `json:"enum,omitempty"`
	Default     any      `json:"default,omitempty"`
	Items       *ToolParam `json:"items,omitempty"`     // for array types
	Properties  map[string]ToolParam `json:"properties,omitempty"` // for object types
}

// ToolConfigSchema is the variant-configuration-driven tool metadata.
// 参考 cross-analysis-sandbox-tools.md Section 2.5: ChatDev FIELD_SPECS pattern
type ToolConfigSchema struct {
	ToolName string           `json:"toolName"`
	Fields   []ToolConfigField `json:"fields"` // 参考 ChatDev FIELD_SPECS: dynamic form rendering
}

type ToolConfigField struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Type        string `json:"type"`        // "text", "number", "select", "toggle", "path"
	Required    bool   `json:"required"`
	Default     any    `json:"default,omitempty"`
	Options     []string `json:"options,omitempty"` // for select type
	Description string `json:"description,omitempty"`
}

// ToolInstance represents an instantiated tool with runtime context.
// 参考 cross-analysis-sandbox-tools.md Section 2.3.1: ToolRuntime
type ToolInstance struct {
	Descriptor  ToolDescriptor `json:"descriptor"`
	WorkspaceID string         `json:"workspaceId"`
	RunID       RunID          `json:"runId"`
	TurnID      TurnID         `json:"turnId"`
	WorkingDir  string         `json:"workingDir"`
	Env         map[string]string `json:"env,omitempty"`
	Credentials map[string]string `json:"credentials,omitempty"` // 参考 cross-analysis-sandbox-tools.md: 加密注入
}

// ToolResult is the unified result of a tool invocation.
// 参考 cross-analysis-sandbox-tools.md Section 2.3.1: ToolEngine.Dispatch
type ToolResult struct {
	ToolCallID  string `json:"toolCallId"`
	ToolName    string `json:"toolName"`
	Content     string `json:"content"`
	IsError     bool   `json:"isError"`
	ExitCode    *int   `json:"exitCode,omitempty"`
	IsDenied    bool   `json:"isDenied"`    // 参考 cross-analysis-sandbox-tools.md Section 2.4
	DenyReason  string `json:"denyReason,omitempty"`
	DurationMs  int64  `json:"durationMs"`
	ArtifactIDs []ArtifactID `json:"artifactIds,omitempty"` // produced artifacts
}

// ToolEvent is a streaming event during tool execution.
// 参考 cross-analysis-sandbox-tools.md Section 2.3.1: ToolEngine.Stream
type ToolEvent struct {
	ToolCallID string        `json:"toolCallId"`
	Type       ToolEventType `json:"type"`
	Data       string        `json:"data"`     // incremental output
	Progress   float64       `json:"progress"` // 0.0-1.0
}

type ToolEventType string

const (
	ToolEventOutput   ToolEventType = "output"
	ToolEventProgress ToolEventType = "progress"
	ToolEventError    ToolEventType = "error"
	ToolEventComplete ToolEventType = "complete"
)
```

---

## 5. Approval Protocol (`approval.go`)

```go
package protocol

import "time"

// ============================================================================
// Approval Protocol
// 参考 approvals.md
// 参考 cross-analysis-sandbox-tools.md Section 2.4: Tool 审批门控设计
// 参考 cross-analysis-adapters.md Section 1.3: Permission & Approval Model
// ============================================================================

// ============================================================================
// Approval Request & Decision
// 参考 approvals.md: ApprovalRequest, ApprovalDecision
// ============================================================================

// ApprovalRequest is emitted when a tool/action requires user or admin approval.
// 参考 approvals.md ApprovalRequest
// 参考 cross-analysis-sandbox-tools.md Section 2.4: 审批流
type ApprovalRequest struct {
	ID       string           `json:"id"`
	TurnID   TurnID           `json:"turnId"`
	RunID    RunID            `json:"runId"`
	ToolCallID string         `json:"toolCallId,omitempty"` // 参考 cross-analysis-sandbox-tools.md: ToolCallID
	Kind     ApprovalKind     `json:"kind"`     // 参考 approvals.md: "shell_command", "file_write", "network", "deploy"
	Title    string           `json:"title"`    // human-readable summary
	Detail   string           `json:"detail"`   // full command or action description
	RiskLevel RiskLevel       `json:"riskLevel"` // 参考 approvals.md: "low", "medium", "high"
	ToolInput map[string]any  `json:"toolInput,omitempty"` // 参考 cross-analysis-adapters.md: ToolPermissionRequest.ToolInput
	Context   string           `json:"context,omitempty"`  // 参考 cross-analysis-adapters.md: human-readable description
	Status    ApprovalStatus   `json:"status"`
	RequestedBy string         `json:"requestedBy"` // agent ID
	CreatedAt time.Time        `json:"createdAt"`
	ExpiresAt *time.Time       `json:"expiresAt,omitempty"` // auto-deny after expiry
}

// ApprovalKind classifies what kind of action needs approval.
// 参考 approvals.md: shell_command / file_write / network / deploy
// 参考 cross-analysis-sandbox-tools.md Section 2.4: 风险分类映射
type ApprovalKind string

const (
	ApprovalShellCommand ApprovalKind = "shell_command" // bash/shell execution
	ApprovalFileWrite    ApprovalKind = "file_write"    // write/edit/multiedit tools
	ApprovalNetwork      ApprovalKind = "network"       // web_fetch/web_search etc.
	ApprovalDeploy       ApprovalKind = "deploy"        // git push / CI trigger
	ApprovalSensitiveRead ApprovalKind = "sensitive_read" // reading .env, ~/.ssh, etc.
	ApprovalAdmin        ApprovalKind = "admin"         // administrative actions
)

// ApprovalStatus tracks the lifecycle of an approval request.
type ApprovalStatus string

const (
	ApprovalPending   ApprovalStatus = "pending"
	ApprovalAccepted  ApprovalStatus = "accepted"
	ApprovalDeclined  ApprovalStatus = "declined"
	ApprovalCancelled ApprovalStatus = "cancelled"
	ApprovalExpired   ApprovalStatus = "expired"
)

// ApprovalDecision is the response to an approval request.
// 参考 approvals.md ApprovalDecision
type ApprovalDecision struct {
	ID        string           `json:"id"`
	RequestID string           `json:"requestId"`
	Type      DecisionType     `json:"type"` // 参考 approvals.md: accept, acceptForThread, acceptForSession, decline, cancel
	Reason    string           `json:"reason,omitempty"` // 参考 approvals.md: decline reason
	DecidedBy string           `json:"decidedBy"` // user or system
	Scope     DecisionScope    `json:"scope"`     // once (default), thread, session
	DecidedAt time.Time        `json:"decidedAt"`
}

// DecisionType maps to the original approval types.
// 参考 approvals.md: "accept", "acceptForThread", "acceptForSession", "decline", "cancel"
type DecisionType string

const (
	DecisionAccept           DecisionType = "accept"
	DecisionAcceptForThread  DecisionType = "acceptForThread"   // 参考 approvals.md: "Allow for Thread"
	DecisionAcceptForSession DecisionType = "acceptForSession"  // 参考 approvals.md: "Allow for Session"
	DecisionDecline          DecisionType = "decline"            // 参考 approvals.md: "Decline"
	DecisionCancel           DecisionType = "cancel"             // 参考 approvals.md: "Cancel"
)

// DecisionScope controls how long an approval decision is valid.
// 参考 cross-analysis-sandbox-tools.md: ToolDescriptor.ApprovalKind
type DecisionScope string

const (
	ScopeOnce    DecisionScope = "once"    // valid for this single execution
	ScopeThread  DecisionScope = "thread"  // valid for the duration of this thread
	ScopeSession DecisionScope = "session" // valid for the entire agent session
)

// RiskLevel classifies the severity of an action.
// 参考 approvals.md: "low", "medium", "high"
// 参考 cross-analysis-sandbox-tools.md Section 2.4: ToolDescriptor.RiskLevel
type RiskLevel string

const (
	RiskLow    RiskLevel = "low"
	RiskMedium RiskLevel = "medium"
	RiskHigh   RiskLevel = "high"
)

// ============================================================================
// Policy Rule Engine
// 参考 cross-analysis-adapters.md Section 1.3: rule sources and priority
// 参考 cross-analysis-sandbox-tools.md Section 2.4: 审批流
// ============================================================================

// PolicyRule defines a single approval rule for auto-decision.
// 参考 cross-analysis-adapters.md Section 1.3: CC 9-source rule priority
// 参考 cross-analysis-sandbox-tools.md Section 2.4: 白名单 / per-thread / per-session
type PolicyRule struct {
	ID          string          `json:"id"`
	Priority    int             `json:"priority"`    // 参考 cross-analysis-adapters.md: 9 sources with priority
	Source      PolicySource    `json:"source"`      // where the rule came from
	Name        string          `json:"name"`        // human-readable name
	Description string          `json:"description,omitempty"`

	// Match conditions
	Match       PolicyMatch     `json:"match"`       // what to match against
	Action      PolicyAction    `json:"action"`      // what to do when matched
	Scope       PolicyScope     `json:"scope"`       // where the rule applies

	Enabled     bool            `json:"enabled"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

// PolicySource indicates where a rule originated.
// 参考 cross-analysis-adapters.md Section 1.3: 9 sources from Claude Code
type PolicySource string

const (
	PolicyUser        PolicySource = "user"        // user settings
	PolicyProject     PolicySource = "project"     // .agenthub/ rules
	PolicyAgent       PolicySource = "agent"       // agent-specific rules
	PolicyTeam        PolicySource = "team"        // team-level rules
	PolicyEnterprise  PolicySource = "enterprise"  // enterprise policy
	PolicySession     PolicySource = "session"     // current session only
	PolicyCLI         PolicySource = "cli"         // command-line argument
	PolicySystem      PolicySource = "system"      // system defaults
)

// PolicyMatch defines the matching criteria for a rule.
// 参考 cross-analysis-adapters.md Section 1.3: per-tool + optional content match
type PolicyMatch struct {
	// Tool matching (e.g., "Bash", "Bash(git *)", "Write")
	ToolPattern   string `json:"toolPattern,omitempty"`   // glob pattern for tool name
	ToolInputKey  string `json:"toolInputKey,omitempty"`  // match on specific input key
	ToolInputValue string `json:"toolInputValue,omitempty"` // match on specific input value (regex)

	// Path matching
	PathPattern   string `json:"pathPattern,omitempty"`   // glob pattern for file path
	DirPattern    string `json:"dirPattern,omitempty"`    // glob pattern for directory

	// Risk matching
	RiskLevel     *RiskLevel `json:"riskLevel,omitempty"` // match by risk level

	// Agent matching
	AgentID       string `json:"agentId,omitempty"`       // match specific agent
	ProviderType  string `json:"providerType,omitempty"`  // match agent provider type
}

// PolicyAction defines what happens when a rule matches.
type PolicyAction string

const (
	PolicyAllow    PolicyAction = "allow"     // auto-approve
	PolicyDeny     PolicyAction = "deny"      // auto-deny
	PolicyAskUser  PolicyAction = "ask_user"  // always ask user
	PolicyEscalate PolicyAction = "escalate"  // escalate to admin
)

// PolicyScope defines where a rule applies.
type PolicyScope string

const (
	PolicyScopeAgent    PolicyScope = "agent"    // per-agent
	PolicyScopeProject  PolicyScope = "project"  // per-project
	PolicyScopeTeam     PolicyScope = "team"     // per-team
	PolicyScopeGlobal   PolicyScope = "global"   // system-wide
)

// ============================================================================
// Policy Engine Interface
// 参考 cross-analysis-sandbox-tools.md Section 2.4: 审批策略评估
// ============================================================================

// PolicyEngine evaluates approval requests against configured rules.
// 参考 cross-analysis-sandbox-tools.md Section 2.4: 审批流
//   Agent CLI 请求 tool 执行 → Runner ToolEngine 拦截 → Edge 审批策略评估
type PolicyEngine interface {
	// Evaluate determines the decision for an approval request.
	// Walks rules by priority; first match wins.
	Evaluate(ctx Context, req *ApprovalRequest) (*ApprovalDecision, error)

	// RegisterRule adds or updates a policy rule.
	RegisterRule(rule *PolicyRule) error

	// RemoveRule removes a policy rule by ID.
	RemoveRule(ruleID string) error

	// ListRules returns all rules in priority order for a given scope.
	ListRules(scope PolicyScope, scopeID string) ([]*PolicyRule, error)

	// RecordDecision stores an approval decision for future reference.
	RecordDecision(decision *ApprovalDecision) error
}

// ============================================================================
// High-Risk Pattern Detection
// 参考 approvals.md: "High-risk actions include"
// ============================================================================

// HighRiskPattern defines a pre-defined high-risk action pattern.
// 参考 approvals.md: sudo, rm -rf, curl | sh, reading .env, reading ~/.ssh, git push, deploy, write outside workspace
type HighRiskPattern struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Pattern     string       `json:"pattern"`     // regex or command pattern
	Category    ApprovalKind `json:"category"`
	RiskLevel   RiskLevel    `json:"riskLevel"`   // always "high" for these patterns
	Description string       `json:"description"` // why this is risky
	AutoDeny    bool         `json:"autoDeny"`    // if true, auto-deny without user prompt
}

// HighRiskPatterns returns the default set of high-risk patterns.
// 参考 approvals.md: "High-risk actions include"
func DefaultHighRiskPatterns() []HighRiskPattern {
	return []HighRiskPattern{
		{ID: "sudo", Name: "sudo", Pattern: `\bsudo\b`, Category: ApprovalShellCommand, RiskLevel: RiskHigh, Description: "Superuser command execution", AutoDeny: false},
		{ID: "rm-rf", Name: "rm -rf", Pattern: `\brm\s+.*-rf?\b`, Category: ApprovalShellCommand, RiskLevel: RiskHigh, Description: "Recursive force deletion", AutoDeny: false},
		{ID: "curl-pipe-sh", Name: "curl | sh", Pattern: `curl.*\|.*(sh|bash)`, Category: ApprovalShellCommand, RiskLevel: RiskHigh, Description: "Piped remote script execution", AutoDeny: true},
		{ID: "read-env", Name: "Read .env", Pattern: `\.env`, Category: ApprovalSensitiveRead, RiskLevel: RiskHigh, Description: "Reading environment secrets", AutoDeny: false},
		{ID: "read-ssh", Name: "Read SSH keys", Pattern: `\.ssh`, Category: ApprovalSensitiveRead, RiskLevel: RiskHigh, Description: "Reading SSH private keys", AutoDeny: true},
		{ID: "git-push", Name: "git push", Pattern: `git\s+push`, Category: ApprovalDeploy, RiskLevel: RiskHigh, Description: "Pushing to remote repository", AutoDeny: false},
		{ID: "deploy-cmd", Name: "Deploy command", Pattern: `\b(deploy|release|publish)\b`, Category: ApprovalDeploy, RiskLevel: RiskHigh, Description: "Deployment-related command", AutoDeny: false},
		{ID: "write-outside-workspace", Name: "Write outside workspace", Pattern: `^/[^w]`, Category: ApprovalFileWrite, RiskLevel: RiskHigh, Description: "Writing outside workspace root", AutoDeny: true},
	}
}

// ============================================================================
// Group-Level Permission Management
// 参考 cross-analysis-orchestration.md Section 2.6: IM 群聊特有的调度能力 #4
// 参考 cross-analysis-im-ux.md: Authority 可视化
// ============================================================================

// PermissionVisibility controls which group members can see a message/thread subtree.
// 参考 cross-analysis-orchestration.md Section 2.6: "基于消息树的权限隔离"
type PermissionVisibility struct {
	ConversationID ConversationID `json:"conversationId"`
	MessageID      MessageID      `json:"messageId"`      // subtree root
	VisibleTo      []string       `json:"visibleTo"`      // user/agent IDs that can see this subtree
	Inherited      bool           `json:"inherited"`      // if true, children inherit this visibility
	SetBy          string         `json:"setBy"`          // who set this restriction
	SetAt          time.Time      `json:"setAt"`
}
```

---

## Appendix: Type Generation Reference

Every type in this document maps to the following generated artifacts:

```
packages/protocol/
  schema/
    common/conversation.schema.json    ← Conversation, Thread, Turn, Item
    common/agent-event.schema.json     ← AgentEvent, all payloads
    common/artifact.schema.json        ← Artifact, DiffArtifact, PreviewArtifact
    common/memory.schema.json          ← MemoryDocument, MemoryChunk, ContextSummary
    adapter/start-request.schema.json  ← StartRequest, AgentSession, EventStream
    adapter/agent-adapter.schema.json  ← AgentAdapter interface spec
    sync/edge-event.schema.json        ← EdgeEvent, SyncBatch, SyncAck
    sync/authority.schema.json         ← ConversationAuthority, ExecutionAuthority, etc.
    orchestration/dispatch.schema.json ← DispatchStrategy, SubagentGraph, CycleGuard
    orchestration/capability.schema.json ← AgentCapability, ToolDescriptor
    approval/request.schema.json       ← ApprovalRequest, ApprovalDecision, PolicyRule
  go/
    generated/types.go                 ← All Go structs above
    generated/adapter.go               ← Adapter interfaces
    generated/sync.go                  ← Sync types
    generated/orchestration.go         ← Orchestration types
    generated/approval.go              ← Approval types
  ts/
    generated/types.ts                 ← All TypeScript types (for UI)
```

---

## Cross-Reference Index

| This Document Section | Primary Source | Secondary Sources |
|---|---|---|
| 1.1 Identity Types | protocol.md, data-model.md | architecture.md |
| 1.2 Authority Types | authority.md | architecture.md |
| 1.3 Core Hierarchy | data-model.md | cross-analysis-im-ux.md |
| 1.4 AgentEvent (12 types) | cross-analysis-adapters.md Section 2.2 | Section 4.1 event mapping |
| 1.5 AgentRun | data-model.md | cross-analysis-adapters.md AgentSession |
| 1.6 Artifact Types | cross-analysis-im-ux.md Section 2.4/2.5 | cross-analysis-sandbox-tools.md Section 3 |
| 1.7 Memory Types | authority.md | cross-analysis-orchestration.md Section 4.3 |
| 2. AgentAdapter interface | cross-analysis-adapters.md Section 2.2 | Section 2.3 coverage map |
| 2. Per-agent configs | cross-analysis-adapters.md Section 3 | Section 3.1-3.4 workarounds |
| 3. Sync protocol | architecture.md | protocol.md, cross-analysis-orchestration.md |
| 3. AuthorityTransfer | authority.md | architecture.md |
| 4. DispatchStrategy | cross-analysis-orchestration.md Section 2.4 | Section 2.5 decision flow |
| 4. CycleDetection | cross-analysis-orchestration.md Section 3 | Section 3.2 four layers |
| 4. AgentCapability | cross-analysis-orchestration.md Section 2.3 | cross-analysis-sandbox-tools.md |
| 4. ToolRegistry | cross-analysis-sandbox-tools.md Section 2.3 | Section 2.2 Dify pattern |
| 5. ApprovalRequest/Decision | approvals.md | cross-analysis-sandbox-tools.md Section 2.4 |
| 5. PolicyRule | cross-analysis-adapters.md Section 1.3 | approvals.md risk rules |
| 5. HighRiskPatterns | approvals.md | cross-analysis-sandbox-tools.md |
