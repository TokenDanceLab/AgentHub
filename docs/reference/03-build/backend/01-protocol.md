> 状态: 🔄 进行中 — M1 核心事件类型已实现，完整类型体系随 M2-M4 迭代

# AgentHub 协议层 -- 完整类型设计

> 生成日期：2026-05-21
> 2026-05-22 更新：本文是早期 Go 类型和协议建模参考，不是当前主协议入口。当前主协议采用 REST JSON API + WebSocket typed events，契约入口为 `api/openapi.yaml`、`api/events.md` 和 `api/conventions.md`。
> 来源：cross-analysis-adapters.md, cross-analysis-orchestration.md, cross-analysis-sandbox-tools.md, cross-analysis-im-ux.md, architecture.md, data-model.md, authority.md, approvals.md, protocol.md
> 历史目标：`packages/protocol/go/generated/`（用于代码生成的手写参考类型；当前不再作为目录规划）

---

## 概述

本文件定义了 AgentHub 协议包在 `.proto` 文件定稿前拟采用的完整 Go 类型层。唯一协议源头是 `proto/agenthub/v1`；本文件是 Go 侧类型形态的设计参考，每个字段都带有来源注释。

包布局：

```
packages/protocol/
  types.go           // 核心数据类型（AgentEvent, Message, Thread, Turn, Item, Artifact, Memory）
  adapter.go         // AgentAdapter 接口 + session/stream/permission 类型
  sync.go            // Hub-Edge 同步协议（EdgeEvent, SyncAck, AuthorityTransfer）
  orchestration.go   // DispatchStrategy, SubagentGraph, CycleDetection, AgentCapability
  approval.go        // ApprovalRequest, ApprovalDecision, RiskLevel, PolicyRule
```

---

## 1. 核心数据类型（`types.go`）

### 1.1 标识类型

```go
package protocol

import "time"

// ============================================================================
// 标识类型 -- 被各处引用
// ============================================================================

// NodeID 全局标识一个 Edge 节点。
// 参考 architecture.md "凡是能跑 Runner 的机器都是 Edge Node"
type NodeID string

// ConversationID 是 Conversation 的主键。
// 参考 data-model.md Conversation.id
type ConversationID string

// MessageID 是单条消息的主键。
// 参考 data-model.md Message.id
type MessageID string

// ThreadID 标识 Conversation 内的一个任务分支。
// 参考 data-model.md Thread.id
type ThreadID string

// TurnID 标识 Thread 内的一轮执行。
// 参考 data-model.md Turn.id
type TurnID string

// RunID 标识一个 AgentRun 实例。
// 参考 architecture.md RunnerCommand.runId
type RunID string

// ArtifactID 标识一个持久化产出物。
// 参考 data-model.md Artifact
type ArtifactID string

// ProjectID 标识一个工作区项目。
// 参考 data-model.md Project.id
type ProjectID string
```

### 1.2 Conversation 权属类型

```go
// ============================================================================
// 权属类型 -- 谁拥有什么
// 参考 authority.md "Conversation Authority / Execution Authority / Artifact Authority / Memory Authority"
// ============================================================================

// ConversationAuthority 定义谁拥有主消息序列。
// 参考 authority.md ConversationAuthority 可区分联合类型
type ConversationAuthority struct {
	Type   AuthorityType `json:"type"`
	EdgeID string        `json:"edgeId,omitempty"` // type="edge" 时使用
	HubID  string        `json:"hubId,omitempty"`  // type="hub" 时使用
}

// AuthorityType 枚举 Conversation 的归属模式。
type AuthorityType string

const (
	AuthorityEdge   AuthorityType = "edge"   // 参考 authority.md: Desktop UI 仅向 Edge 写消息
	AuthorityHub    AuthorityType = "hub"    // 参考 authority.md: Web/Mobile 向 Hub 写消息
	AuthorityHybrid AuthorityType = "hybrid" // 参考 cross-analysis-im-ux.md: Hub+Edge 协作
)

// ExecutionAuthority 定义任务实际在哪里运行。
// 参考 authority.md ExecutionAuthority
type ExecutionAuthority struct {
	EdgeID      string `json:"edgeId"`
	RunnerID    string `json:"runnerId"`
	WorkspaceID string `json:"workspaceId"`
}

// ArtifactAuthority 定义 Artifact 的字节数据存放位置。
// 参考 authority.md ArtifactAuthority
type ArtifactAuthority struct {
	Type   ArtifactAuthorityType `json:"type"`
	EdgeID string                `json:"edgeId,omitempty"`
	HubID  string                `json:"hubId,omitempty"`
	Bucket string                `json:"bucket,omitempty"` // 对象存储 bucket
}

type ArtifactAuthorityType string

const (
	ArtifactAuthEdge          ArtifactAuthorityType = "edge"
	ArtifactAuthHubCache      ArtifactAuthorityType = "hub-cache"
	ArtifactAuthObjectStorage ArtifactAuthorityType = "object-storage"
)

// MemoryAuthority 定义谁拥有持久化 Memory 的写入权。
// 参考 authority.md MemoryAuthority
type MemoryAuthority struct {
	Type      MemoryAuthorityType `json:"type"`
	EdgeID    string              `json:"edgeId,omitempty"`
	HubID     string              `json:"hubId,omitempty"`
	Scope     string              `json:"scope,omitempty"`     // hub 类型时为 "team" | "global"
	ProjectID string              `json:"projectId,omitempty"` // project-edge 类型时使用
	AgentID   string              `json:"agentId,omitempty"`   // agent-edge 类型时使用
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
// 核心数据层次：Project -> Conversation -> Thread -> Turn -> Item
// 参考 data-model.md "Core Shape"
// ============================================================================

// Project 是本地或远程工作区根目录。
// 参考 data-model.md Project
type Project struct {
	ID         ProjectID `json:"id"`
	Name       string    `json:"name"`
	RootPath   string    `json:"rootPath"`
	MemoryPath string    `json:"memoryPath"` // .agenthub/ 目录
	// 参考 architecture.md: .agenthub/ 下的 Project memory 由 Edge 拥有
}

// Conversation 是 IM 外壳：单聊/群聊容器及权属边界。
// 参考 data-model.md Conversation
// 参考 cross-analysis-im-ux.md 第 2.1 节（群聊消息树）
type Conversation struct {
	ID           ConversationID        `json:"id"`
	ProjectID    string                `json:"projectId"`
	Type         ConversationType      `json:"type"`
	Title        string                `json:"title"`
	Authority    ConversationAuthority `json:"authority"`
	Execution    *ExecutionAuthority   `json:"execution,omitempty"`
	Pinned       bool                  `json:"pinned"`
	Archived     bool                  `json:"archived"`
	LastMessageAt time.Time            `json:"lastMessageAt"`
	// 参考 authority.md: 每个 conversation 上都有 authority + executionAuthority 字段
}

type ConversationType string

const (
	ConversationDirect ConversationType = "direct" // 单聊
	ConversationGroup  ConversationType = "group"  // 群聊
)

// MessageTreeNode 是用于分支导航的消息树节点。
// 参考 cross-analysis-im-ux.md 第 2.3 节：LibreChat 的 buildTree()
// 参考 cross-analysis-orchestration.md：消息树 = 编排拓扑的运行时表示
type MessageTreeNode struct {
	Message  Message            `json:"message"`
	Children []*MessageTreeNode `json:"children"` // 兄弟分支
	// 参考 cross-analysis-im-ux.md：当 len(Children) > 1 时显示 SiblingSwitch
}

// Message 表示 IM 流中的一条消息。
// 参考 data-model.md Message
// 参考 cross-analysis-im-ux.md 第 2.3 节（消息流）
type Message struct {
	ID             MessageID      `json:"id"`
	ConversationID ConversationID `json:"conversationId"`
	ThreadID       ThreadID       `json:"threadId"`
	ParentID       *MessageID     `json:"parentId,omitempty"` // 分支的树父节点
	// 参考 cross-analysis-im-ux.md：消息树数据模型 {message, children[]}
	SenderType  SenderType    `json:"senderType"`
	SenderID    string        `json:"senderId"`   // 用户 ID 或 Agent ID
	SenderName  string        `json:"senderName"` // 显示名称
	Content     string        `json:"content"`
	Mentions    []string      `json:"mentions"`   // @提及的 Agent/用户 ID
	// 参考 cross-analysis-orchestration.md 第 2.5 节：@mention 直接委派
	Status      MessageStatus `json:"status"`
	Authority   AuthorityType `json:"authority"` // 参考 cross-analysis-im-ux.md：消息权属用线条颜色区分
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

// Thread 是 Conversation 内的任务分支。
// 参考 data-model.md Thread
// 参考 architecture.md "Thread = task branch"
type Thread struct {
	ID             ThreadID       `json:"id"`
	ConversationID ConversationID `json:"conversationId"`
	ProjectID      string         `json:"projectId"`
	Title          string         `json:"title"`
	Status         ThreadStatus   `json:"status"`
	RootMessageID  *MessageID     `json:"rootMessageId,omitempty"` // 参考 cross-analysis-orchestration.md：从任意消息 Fork
	CurrentRunID   *RunID         `json:"currentRunId,omitempty"`
	CreatedAt      time.Time      `json:"createdAt"`
	UpdatedAt      time.Time      `json:"updatedAt"`
}

type ThreadStatus string

const (
	ThreadOpen     ThreadStatus = "open"
	ThreadRunning  ThreadStatus = "running"
	ThreadBlocked  ThreadStatus = "blocked"  // 等待审批或人工输入
	ThreadDone     ThreadStatus = "done"
	ThreadArchived ThreadStatus = "archived"
)

// Turn 是一轮用户/Agent 执行。
// 参考 data-model.md Turn
// 参考 architecture.md "Turn = one interaction/execution round"
type Turn struct {
	ID        TurnID     `json:"id"`
	ThreadID  ThreadID   `json:"threadId"`
	RunID     *RunID     `json:"runId,omitempty"`
	Sequence  int        `json:"sequence"` // Thread 内单调递增
	ActorID   string     `json:"actorId"`  // 用户或 Agent ID
	Status    TurnStatus `json:"status"`
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
}

type TurnStatus string

const (
	TurnQueued           TurnStatus = "queued"
	TurnRunning          TurnStatus = "running"
	TurnAwaitingApproval TurnStatus = "awaiting_approval"
	TurnDone             TurnStatus = "done"
	TurnFailed           TurnStatus = "failed"
	TurnCancelled        TurnStatus = "cancelled"
)

// Item 是 Turn 内的一个流式事件单元。
// 参考 data-model.md Item
// 参考 cross-analysis-adapters.md 第 2.2 节：AgentEvent 流
type Item struct {
	ID        string    `json:"id"`
	ThreadID  ThreadID  `json:"threadId"`
	TurnID    TurnID    `json:"turnId"`
	Type      ItemType  `json:"type"`
	Payload   any       `json:"payload"`   // 类型特定的 payload（AgentEvent 或子类型）
	Seq       int       `json:"seq"`       // Turn 内单调递增
	CreatedAt time.Time `json:"createdAt"`
}

type ItemType string

const (
	ItemUserMessage      ItemType = "user_message"
	ItemAgentMessage     ItemType = "agent_message"
	ItemReasoningSummary ItemType = "reasoning_summary"
	ItemShellCommand     ItemType = "shell_command"
	ItemCommandOutput    ItemType = "command_output"
	ItemFileChange       ItemType = "file_change"
	ItemDiff             ItemType = "diff"
	ItemPreview          ItemType = "preview"
	ItemApprovalRequest  ItemType = "approval_request"
	ItemApprovalDecision ItemType = "approval_decision"
	ItemError            ItemType = "error"
	ItemToolCall         ItemType = "tool_call"
	ItemToolResult       ItemType = "tool_result"
)
```

### 1.4 统一 Agent Event（12 种类型）

```go
// ============================================================================
// 统一 Agent Event -- 12 种事件类型
// 参考 cross-analysis-adapters.md 第 2.2 节 "Unified Agent Event Model"
// 参考 cross-analysis-adapters.md 第 4.1 节 "Native-to-Unified Event Mapping"
// ============================================================================

// AgentEvent 是所有 Adapter 发出的统一事件类型。
// 每个 Adapter 将其原生事件规范化为此结构。
// 参考 cross-analysis-adapters.md 第 2.2 节 设计原则 #3：事件驱动流
type AgentEvent struct {
	// 顺序
	Seq       int    `json:"seq"`       // 参考 cross-analysis-adapters.md AgentEvent.Seq：Session 内单调递增
	SessionID string `json:"sessionId"` // 参考 cross-analysis-adapters.md AgentEvent.SessionID

	// 分类
	Type      AgentEventType `json:"type"`      // 参考 cross-analysis-adapters.md AgentEventType
	Timestamp int64          `json:"timestamp"`  // Unix 毫秒

	// Payload（类型特定）
	Payload any `json:"payload"`

	// 调试
	Raw []byte `json:"raw,omitempty"` // 参考 cross-analysis-adapters.md AgentEvent.Raw：原始 provider 事件
}

type AgentEventType string

const (
	// --- 生命周期事件 ---
	EventSystemInit   AgentEventType = "system_init"   // 参考 cross-analysis-adapters.md：CC system_init → AgentHub system_init
	EventResult       AgentEventType = "result"        // 参考 cross-analysis-adapters.md：CC result → AgentHub result
	EventSystem       AgentEventType = "system"        // 参考 cross-analysis-adapters.md：compaction, retry, status change
	EventStatusChange AgentEventType = "status_change" // 参考 cross-analysis-adapters.md：session 状态转换

	// --- 内容事件 ---
	EventAssistantText AgentEventType = "assistant_text" // 参考 cross-analysis-adapters.md：CC assistant text block → assistant_text
	EventReasoning     AgentEventType = "reasoning"      // 参考 cross-analysis-adapters.md：CC thinking block → reasoning
	EventUserReplay    AgentEventType = "user_replay"    // 参考 cross-analysis-adapters.md：CC user replay → user_replay

	// --- Tool 执行事件 ---
	EventToolCall       AgentEventType = "tool_call"        // 参考 cross-analysis-adapters.md：CC assistant(tool_use) → tool_call
	EventToolResult     AgentEventType = "tool_result"      // 参考 cross-analysis-adapters.md：CC user(tool_result) → tool_result
	EventToolProgress   AgentEventType = "tool_progress"    // 参考 cross-analysis-adapters.md：CC progress → tool_progress
	EventToolUseSummary AgentEventType = "tool_use_summary" // 参考 cross-analysis-adapters.md：CC tool_use_summary → tool_use_summary

	// --- 控制事件 ---
	EventStreamEvent      AgentEventType = "stream_event"      // 参考 cross-analysis-adapters.md：原始流式增量
	EventApprovalRequest  AgentEventType = "approval_request"  // 参考 cross-analysis-adapters.md：工具权限请求
	EventApprovalDecision AgentEventType = "approval_decision" // 参考 cross-analysis-adapters.md：权限决策
)

// ============================================================================
// Event Payload 结构体
// 参考 cross-analysis-adapters.md 第 2.2 节 "Event Payload Structs"
// ============================================================================

// SystemInitPayload 携带 Session 初始化数据。
// 参考 cross-analysis-adapters.md SystemInitPayload
type SystemInitPayload struct {
	Model          string          `json:"model"`
	Tools          []ToolDef       `json:"tools"`
	Commands       []CommandDef    `json:"commands"`    // 参考 cross-analysis-adapters.md：slash 命令
	Agents         []SubAgentDef   `json:"agents"`      // 参考 cross-analysis-adapters.md：子 Agent 定义
	MCPServers     []MCPServerInfo `json:"mcpServers"`  // 参考 cross-analysis-adapters.md：MCP 服务器状态
	PermissionMode string          `json:"permissionMode"`
	SessionID      string          `json:"sessionId"`
}

// AssistantTextPayload 携带模型的文本内容。
// 参考 cross-analysis-adapters.md AssistantTextPayload
type AssistantTextPayload struct {
	Content   string    `json:"content"`
	Phase     TextPhase `json:"phase"`     // "delta" 或 "block_end"
	MessageID string    `json:"messageId"` // Turn 内唯一
}

type TextPhase string

const (
	TextPhaseDelta    TextPhase = "delta"
	TextPhaseBlockEnd TextPhase = "block_end"
)

// ReasoningPayload 携带思考/推理内容。
// 参考 cross-analysis-adapters.md ReasoningPayload
type ReasoningPayload struct {
	Content     string    `json:"content"`
	Phase       TextPhase `json:"phase"`
	BudgetUsed  int       `json:"budgetUsed"`
	BudgetTotal int       `json:"budgetTotal"`
}

// ToolCallPayload 携带工具调用请求。
// 参考 cross-analysis-adapters.md ToolCallPayload
type ToolCallPayload struct {
	ToolCallID string         `json:"toolCallId"`
	ToolName   string         `json:"toolName"`   // 例如 "Bash", "mcp__github__search_repos"
	ToolInput  map[string]any `json:"toolInput"`  // 参考 cross-analysis-adapters.md 第 4.2 节：规范化为 mcp__<server>__<tool>
	Status     ToolCallStatus `json:"status"`
}

type ToolCallStatus string

const (
	ToolCallPending   ToolCallStatus = "pending"
	ToolCallRunning   ToolCallStatus = "running"
	ToolCallCompleted ToolCallStatus = "completed"
	ToolCallFailed    ToolCallStatus = "failed"
	ToolCallDenied    ToolCallStatus = "denied"
)

// ToolResultPayload 携带工具执行的结果。
// 参考 cross-analysis-adapters.md ToolResultPayload
type ToolResultPayload struct {
	ToolCallID string `json:"toolCallId"`
	ToolName   string `json:"toolName"`
	Content    string `json:"content"`  // 渲染后的结果
	IsError    bool   `json:"isError"`
	ExitCode   *int   `json:"exitCode,omitempty"`
	RawOutput  []byte `json:"rawOutput,omitempty"`
}

// ResultPayload 携带 Turn 的最终结果。
// 参考 cross-analysis-adapters.md ResultPayload
type ResultPayload struct {
	Subtype       ResultSubtype `json:"subtype"`
	IsError       bool          `json:"isError"`
	Content       string        `json:"content"`
	DurationMs    int64         `json:"durationMs"`
	DurationAPIMs int64         `json:"durationApiMs"`
	NumTurns      int           `json:"numTurns"`
	StopReason    string        `json:"stopReason"` // "end_turn", "max_tokens", "tool_use" 等
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

// StatusChangePayload 携带 Session 状态转换信息。
// 参考 cross-analysis-adapters.md StatusChangePayload
type StatusChangePayload struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Reason string `json:"reason"` // 例如 "compaction_triggered", "permission_mode_changed"
}

// ============================================================================
// 共享的 Tool/MCP/Usage 类型
// 参考 cross-analysis-adapters.md 第 2.2 节 "Shared Types"
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

// SubAgentDef 描述一个可用的子 Agent。
// 参考 cross-analysis-adapters.md SubAgentDef
// 参考 cross-analysis-orchestration.md 第 2.4 节：子 Agent 配置
type SubAgentDef struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	SystemPrompt string   `json:"systemPrompt"`
	Tools        []string `json:"tools"`
	Mode         string   `json:"mode"`       // 例如 "agent", "plan", "reviewer"
	AllowSelf    bool     `json:"allowSelf"`  // 参考 cross-analysis-orchestration.md 第 3.2 节 第一层：自引用白名单
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

// UsageInfo 追踪跨 provider 的 token 使用量。
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
// AgentRun -- Agent Turn 的运行时执行
// 参考 architecture.md：Runner 执行节点
// 参考 data-model.md："AgentRun = Runtime execution of an agent turn"
// 参考 cross-analysis-adapters.md AgentSession
// ============================================================================

// AgentRun 表示一次 Agent 执行实例。
// 在 Runner 层面映射到 cross-analysis-adapters.md 的 AgentSession。
type AgentRun struct {
	ID          RunID       `json:"id"`
	ThreadID    ThreadID    `json:"threadId"`
	TurnID      TurnID      `json:"turnId"`
	AgentID     string      `json:"agentId"`     // 参考 cross-analysis-adapters.md："claude-code", "codex", "opencode"
	WorkspaceID string      `json:"workspaceId"` // 参考 cross-analysis-sandbox-tools.md WorkspaceInfo.ID
	Status      RunStatus   `json:"status"`
	Model       string      `json:"model"`
	Prompt      string      `json:"prompt"`
	Usage       *UsageInfo  `json:"usage,omitempty"`
	Cost        *CostInfo   `json:"cost,omitempty"`
	StartedAt   time.Time   `json:"startedAt"`
	EndedAt     *time.Time  `json:"endedAt,omitempty"`
	// 参考 cross-analysis-sandbox-tools.md 第 3 节：Checkpoint 关联
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

### 1.6 Artifact 类型

```go
// ============================================================================
// Artifact 类型 -- 可从 UI 访问的持久化产出物
// 参考 data-model.md："Artifact = durable output such as diff, log, preview, file"
// 参考 cross-analysis-im-ux.md 第 2.5 节（产物预览）
// 参考 cross-analysis-sandbox-tools.md 第 3 节（Checkpoint）
// ============================================================================

// Artifact 表示一次 Agent Run 的持久化工作产物。
type Artifact struct {
	ID        ArtifactID        `json:"id"`
	RunID     RunID             `json:"runId"`
	TurnID    TurnID            `json:"turnId"`
	ThreadID  ThreadID          `json:"threadId"`
	Type      ArtifactType      `json:"type"`
	Title     string            `json:"title"`
	MimeType  string            `json:"mimeType"`
	Size      int64             `json:"size"`
	Authority ArtifactAuthority `json:"authority"`     // 参考 authority.md：artifact authority
	URL       string            `json:"url,omitempty"` // 参考 cross-analysis-im-ux.md：下载 artifact
	Tags      []string          `json:"tags,omitempty"`
	Metadata  map[string]any    `json:"metadata,omitempty"` // 类型特定元数据
	CreatedAt time.Time         `json:"createdAt"`
}

type ArtifactType string

const (
	ArtifactDiff    ArtifactType = "diff"    // 参考 cross-analysis-im-ux.md 第 2.4 节（Diff 面板）
	ArtifactLog     ArtifactType = "log"     // 原始 stdout/stderr
	ArtifactPreview ArtifactType = "preview" // 参考 cross-analysis-im-ux.md 第 2.5 节：开发服务器预览
	ArtifactFile    ArtifactType = "file"    // 生成的文件
	ArtifactCode    ArtifactType = "code"    // 参考 cross-analysis-im-ux.md：Sandpack 实时代码编辑
	ArtifactMermaid ArtifactType = "mermaid" // 参考 cross-analysis-im-ux.md：Mermaid 图表渲染
	ArtifactHTML    ArtifactType = "html"    // 交互式 HTML
	ArtifactJSON    ArtifactType = "json"    // 结构化数据
)

// DiffArtifact 是代码变更的专用 Artifact。
// 参考 cross-analysis-im-ux.md 第 2.4 节：DiffViewer + 行级评论
// 参考 cross-analysis-sandbox-tools.md 第 2.5 节：WorkspaceProvider 的 DiffResult
type DiffArtifact struct {
	Artifact
	BaseRef      string       `json:"baseRef"`       // 基准分支/commit
	HeadRef      string       `json:"headRef"`       // 目标分支/commit
	FilesChanged int          `json:"filesChanged"`
	Additions    int          `json:"additions"`
	Deletions    int          `json:"deletions"`
	FileDiffs    []FileDiff   `json:"fileDiffs"`
	AgentID      string       `json:"agentId"`       // 参考 cross-analysis-im-ux.md："Generated by [Edge:us1] Claude"
	ToolCallID   string       `json:"toolCallId"`    // 参考 cross-analysis-im-ux.md：追溯到 tool_use
	CanApply     bool         `json:"canApply"`      // 参考 cross-analysis-sandbox-tools.md：WorkspaceProvider.ApplyPatch
	CanDiscard   bool         `json:"canDiscard"`    // 参考 cross-analysis-sandbox-tools.md：WorkspaceProvider.Discard
}

// FileDiff 表示单个文件的变更。
type FileDiff struct {
	FilePath   string         `json:"filePath"`
	OldPath    string         `json:"oldPath,omitempty"` // 重命名时使用
	ChangeType DiffChangeType `json:"changeType"`        // added, modified, deleted, renamed
	Hunks      []DiffHunk     `json:"hunks"`
	Additions  int            `json:"additions"`
	Deletions  int            `json:"deletions"`
	Comments   []DiffComment  `json:"comments,omitempty"` // 参考 cross-analysis-im-ux.md：行级评论
}

type DiffChangeType string

const (
	DiffAdded    DiffChangeType = "added"
	DiffModified DiffChangeType = "modified"
	DiffDeleted  DiffChangeType = "deleted"
	DiffRenamed  DiffChangeType = "renamed"
)

// DiffHunk 表示一个连续的变更块。
type DiffHunk struct {
	OldStart int        `json:"oldStart"`
	OldLines int        `json:"oldLines"`
	NewStart int        `json:"newStart"`
	NewLines int        `json:"newLines"`
	Lines    []DiffLine `json:"lines"`
}

type DiffLine struct {
	OldLineNo *int         `json:"oldLineNo,omitempty"`
	NewLineNo *int         `json:"newLineNo,omitempty"`
	Content   string       `json:"content"`
	Type      DiffLineType `json:"type"` // "context", "addition", "deletion"
}

type DiffLineType string

const (
	DiffLineContext  DiffLineType = "context"
	DiffLineAddition DiffLineType = "addition"
	DiffLineDeletion DiffLineType = "deletion"
)

// DiffComment 是对特定 diff 行的内联评论。
// 参考 cross-analysis-im-ux.md：CommentButton/CommentForm
type DiffComment struct {
	ID        string    `json:"id"`
	FilePath  string    `json:"filePath"`
	LineNo    int       `json:"lineNo"`    // 新文件行号
	AuthorID  string    `json:"authorId"`
	Content   string    `json:"content"`
	Resolved  bool      `json:"resolved"`
	CreatedAt time.Time `json:"createdAt"`
}

// PreviewArtifact 表示一个运行中的开发服务器预览。
// 参考 architecture.md：Preview 端口 5100-5199
// 参考 cross-analysis-sandbox-tools.md：WorkspaceProvider 的 ExposedUrl
type PreviewArtifact struct {
	Artifact
	Port        int           `json:"port"`
	ServiceName string        `json:"serviceName"` // 例如 "dev-server", "storybook"
	Status      PreviewStatus `json:"status"`
	AccessURL   string        `json:"accessUrl"` // 参考 cross-analysis-sandbox-tools.md：ExposedURLs
}

type PreviewStatus string

const (
	PreviewStarting PreviewStatus = "starting"
	PreviewRunning  PreviewStatus = "running"
	PreviewStopped  PreviewStatus = "stopped"
	PreviewError    PreviewStatus = "error"
)
```

### 1.7 Memory 类型

```go
// ============================================================================
// Memory 类型
// 参考 architecture.md："项目 Memory / Context Builder"
// 参考 authority.md：MemoryAuthority
// 参考 cross-analysis-orchestration.md 第 4.3 节：Summarization reserveRatio + EMA 校准（来自 LibreChat）
// ============================================================================

// MemoryDocument 是项目、Agent 或 Conversation 的持久上下文单元。
type MemoryDocument struct {
	ID             string          `json:"id"`
	Scope          MemoryScope     `json:"scope"`
	ProjectID      string          `json:"projectId,omitempty"`
	ConversationID string          `json:"conversationId,omitempty"`
	AgentID        string          `json:"agentId,omitempty"`
	Authority      MemoryAuthority `json:"authority"` // 参考 authority.md：Memory Authority
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
	MemoryScopeProject      MemoryScope = "project"      // .agenthub/ 规则、约定
	MemoryScopeAgent        MemoryScope = "agent"        // 按 Agent 配置
	MemoryScopeConversation MemoryScope = "conversation" // Conversation 级上下文
	MemoryScopeTeam         MemoryScope = "team"         // 参考 authority.md：hub team scope
	MemoryScopeGlobal       MemoryScope = "global"       // 参考 authority.md：hub global scope
)

// MemoryChunk 是 Memory Document 中一个可搜索的片段。
// 参考 cross-analysis-orchestration.md 第 4.3 节：上下文压缩（LibreChat summarization）
type MemoryChunk struct {
	ID            string    `json:"id"`
	DocumentID    string    `json:"documentId"`
	Content       string    `json:"content"`
	EmbeddingHash string    `json:"embeddingHash,omitempty"` // 语义搜索用
	TokenCount    int       `json:"tokenCount"`
	Seq           int       `json:"seq"` // Document 内顺序
	CreatedAt     time.Time `json:"createdAt"`
}

// ContextSummary 是 Conversation 历史的压缩表示。
// 参考 cross-analysis-orchestration.md：LibreChat summarization reserveRatio + EMA 校准
type ContextSummary struct {
	ID             string         `json:"id"`
	ConversationID ConversationID `json:"conversationId"`
	ThreadID       ThreadID       `json:"threadId"`
	Content        string         `json:"content"`      // 压缩后的摘要文本
	TokenCount     int            `json:"tokenCount"`   // 摘要消耗的 token 数
	ReserveRatio   float64        `json:"reserveRatio"` // 参考 cross-analysis-orchestration.md：预留比例
	CoverStartSeq  int            `json:"coverStartSeq"` // 覆盖的第一条消息
	CoverEndSeq    int            `json:"coverEndSeq"`   // 覆盖的最后一条消息
	CreatedAt      time.Time      `json:"createdAt"`
}
```

---

## 2. Agent Adapter 协议（`adapter.go`）

```go
package protocol

import (
	"context"
)

// ============================================================================
// Agent Adapter 接口
// 参考 cross-analysis-adapters.md 第 2.2 节 "Core Interface"
// 参考 cross-analysis-adapters.md 第 2.3 节 "Interface Coverage Map"
// ============================================================================

// AgentAdapter 是所有 Agent CLI 后端的统一接口。
// 每个实现（ClaudeCodeAdapter, CodexAdapter, OpenCodeAdapter）
// 都必须满足此接口。
// 参考 cross-analysis-adapters.md："Provider-agnostic abstract over subprocess and HTTP"
type AgentAdapter interface {
	// Metadata 返回此 Adapter 实例的静态信息。
	// 参考 cross-analysis-adapters.md AdapterMetadata
	Metadata() AdapterMetadata

	// Capabilities 返回此 Adapter 支持的功能集。
	// 参考 cross-analysis-adapters.md AgentCapabilities
	Capabilities() AgentCapabilities

	// Start 启动一个新 Turn 的 Agent Session。
	// Adapter 负责进程/连接的生命周期。
	// 参考 cross-analysis-adapters.md AgentAdapter.Start
	Start(ctx context.Context, req StartRequest) (*AgentSession, error)

	// Resume 重连到一个已有的 Agent Session。
	// 参考 cross-analysis-adapters.md AgentAdapter.Resume
	// 参考 cross-analysis-adapters.md 第 1.4 节：Session 复用
	Resume(ctx context.Context, sessionID string) (*AgentSession, error)

	// AttachStream 作为事件流的消费者进行挂载。
	// 每个 Session 只允许一个流消费者。
	// 参考 cross-analysis-adapters.md AgentAdapter.AttachStream
	AttachStream(ctx context.Context, sessionID string) (*EventStream, error)
}

// ============================================================================
// 扩展接口（可选，按 capability 门槛开放）
// 参考 cross-analysis-adapters.md 第 2.2 节 "Extension Interfaces"
// ============================================================================

// SessionManager 提供 start/resume 之外的 Session 级操作。
// 参考 cross-analysis-adapters.md SessionManager
// 参考 cross-analysis-adapters.md 第 1.4 节：Fork / List / GetMessages
type SessionManager interface {
	ForkSession(ctx context.Context, req ForkRequest) (*AgentSession, error)
	// 参考 cross-analysis-adapters.md 第 1.4 节：forkSession → ForkSession
	// 参考 cross-analysis-adapters.md 第 3.2 节 Workaround 7：推荐 ForkMode.LastNTurns

	ListSessions(ctx context.Context, pagination Pagination) ([]SessionInfo, error)
	// 参考 cross-analysis-adapters.md 第 1.4 节：listSessions → ListSessions

	GetSessionInfo(ctx context.Context, sessionID string) (*SessionInfo, error)
	// 参考 cross-analysis-adapters.md：getSessionInfo

	GetMessages(ctx context.Context, sessionID string) ([]AgentEvent, error)
	// 参考 cross-analysis-adapters.md：getMessages → JSONL 重放
}

// PermissionBroker 允许 AgentHub 拦截工具执行以进行审批。
// 参考 cross-analysis-adapters.md PermissionBroker
// 参考 cross-analysis-adapters.md 第 1.3 节：Permission & Approval Model
type PermissionBroker interface {
	// SetPermissionCallback 注册一个在工具执行前调用的钩子。
	// 参考 cross-analysis-adapters.md PermissionBroker.SetPermissionCallback
	// 参考 cross-analysis-adapters.md 第 3.1 节 Workaround 5：CC stdin 控制协议
	SetPermissionCallback(sessionID string, cb PermissionCallback)

	// ResolvePermission 在工具需要审批时由 Adapter 调用。
	// 可能阻塞直到做出决策（用户/管理员输入）。
	// 参考 cross-analysis-adapters.md PermissionBroker.ResolvePermission
	ResolvePermission(ctx context.Context, req ToolPermissionRequest) (*PermissionDecision, error)
}

// InteractiveControl 提供中段控制：cancel, steer, inject。
// 参考 cross-analysis-adapters.md InteractiveControl
// 参考 cross-analysis-adapters.md 第 3.4 节：Kanna steer mode 模式
type InteractiveControl interface {
	// Cancel 优雅终止当前 Turn。
	// 参考 cross-analysis-adapters.md Cancel：AbortController / Shutdown Op
	Cancel(ctx context.Context, sessionID string) error

	// SendSteer 向运行中的 Turn 注入一条后续消息。
	// 参考 cross-analysis-adapters.md SendSteer：中段消息注入
	// 参考 cross-analysis-adapters.md 第 3.4 节：Kanna steer 机制
	SendSteer(ctx context.Context, sessionID string, msg SteerMessage) error

	// Drain 阻塞直到 result 事件后的后台任务完成。
	// 参考 cross-analysis-adapters.md 第 3.4 节：Kanna drainingStreams 模式
	Drain(ctx context.Context, sessionID string) error
}

// ============================================================================
// Adapter 元数据与 Capabilities
// 参考 cross-analysis-adapters.md 第 2.2 节
// ============================================================================

// AdapterMetadata 标识 Adapter 及其版本。
// 参考 cross-analysis-adapters.md AdapterMetadata
type AdapterMetadata struct {
	Name         string `json:"name"`         // "claude-code", "codex", "opencode"
	Version      string `json:"version"`      // Adapter 实现版本
	AgentVersion string `json:"agentVersion"` // 底层 CLI 二进制版本（来自 --version）
}

// AgentCapabilities 声明此 Adapter 支持哪些功能。
// 参考 cross-analysis-adapters.md AgentCapabilities
type AgentCapabilities struct {
	Streaming          bool `json:"streaming"`           // 实时事件流
	SessionPersist     bool `json:"sessionPersist"`      // 会话跨进程持久化
	Fork               bool `json:"fork"`                // 会话分叉
	MultiAgent         bool `json:"multiAgent"`          // 子 Agent 树支持
	PermissionHooks    bool `json:"permissionHooks"`     // PreToolUse 风格权限回调
	Sandbox            bool `json:"sandbox"`             // OS 级沙箱
	ThinkingVisible    bool `json:"thinkingVisible"`     // 思考过程对调用方可见
	MCPIntegration     bool `json:"mcpIntegration"`      // MCP 工具注册
	StreamingToolExec  bool `json:"streamingToolExec"`   // 流式工具执行
	Compaction         bool `json:"compaction"`          // 自动上下文压缩
	ResumeLast         bool `json:"resumeLast"`          // --resume-last 能力
	Steer              bool `json:"steer"`               // 中段消息注入
}

// ============================================================================
// StartRequest -- 启动 Agent Turn 所需的全部参数
// 参考 cross-analysis-adapters.md StartRequest
// ============================================================================

// StartRequest 携带启动 Agent Turn 所需的全部参数。
// 参考 cross-analysis-adapters.md StartRequest
type StartRequest struct {
	// 用户提示
	Prompt       string `json:"prompt"`
	SystemPrompt string `json:"systemPrompt,omitempty"` // 可选系统提示覆盖

	// 模型配置
	// 参考 cross-analysis-adapters.md：Model, Thinking, MaxTokens, Temperature
	Model       string          `json:"model"`       // 例如 "claude-sonnet-4-6"
	Thinking    *ThinkingConfig `json:"thinking,omitempty"`
	MaxTokens   int             `json:"maxTokens,omitempty"`
	Temperature *float64        `json:"temperature,omitempty"`

	// 工作区
	// 参考 cross-analysis-sandbox-tools.md 第 1 节：WorkspaceInfo.RootPath
	WorkingDir  string   `json:"workingDir"`
	AllowedDirs []string `json:"allowedDirs,omitempty"`

	// 工具配置
	// 参考 cross-analysis-sandbox-tools.md 第 2 节：ToolRegistry
	AllowedTools []string   `json:"allowedTools,omitempty"` // 白名单
	DeniedTools  []string   `json:"deniedTools,omitempty"`  // 黑名单
	MCPConfig    *MCPConfig `json:"mcpConfig,omitempty"`    // 参考 cross-analysis-adapters.md MCPConfig

	// 权限与安全
	// 参考 cross-analysis-adapters.md 第 1.3 节：Permission modes
	PermissionMode string        `json:"permissionMode"` // "default", "bypassPermissions", "plan", "acceptEdits"
	MaxTurns       int           `json:"maxTurns,omitempty"`
	MaxBudgetUSD   float64       `json:"maxBudgetUsd,omitempty"`
	Sandbox        *SandboxConfig `json:"sandbox,omitempty"`

	// Session 连续性
	// 参考 cross-analysis-adapters.md 第 1.4 节：Session management
	SessionID   string    `json:"sessionId,omitempty"`    // Resume 目标（空 = 新 session）
	ForkFrom    string    `json:"forkFrom,omitempty"`     // Fork 源 session ID
	ForkHistory *ForkMode `json:"forkHistory,omitempty"`  // 参考 cross-analysis-adapters.md ForkMode

	// 输出控制
	// 参考 cross-analysis-adapters.md 第 3.1 节 Workaround 6：thinking visibility
	IncludeThinking      bool `json:"includeThinking"`
	IncludePartialEvents bool `json:"includePartialEvents"`

	// AgentHub 上下文注入
	// 参考 cross-analysis-orchestration.md 第 2 节：传递给 Agent 的上下文
	ConversationID string                `json:"conversationId,omitempty"`
	ThreadID       string                `json:"threadId,omitempty"`
	TurnID         string                `json:"turnId,omitempty"`
	Authority      ConversationAuthority `json:"authority,omitempty"`
	// 参考 cross-analysis-orchestration.md 第 3.2 节：委派上下文
	DelegationDepth    int      `json:"delegationDepth,omitempty"`
	DelegationPath     []string `json:"delegationPath,omitempty"`     // 委派链
	MaxDelegationDepth int      `json:"maxDelegationDepth,omitempty"` // 参考 cross-analysis-orchestration.md：MAX_DELEGATION_DEPTH = 5

	// Provider 特定扩展（AgentHub 核心不感知）
	ProviderExtras map[string]any `json:"providerExtras,omitempty"`
}

// ThinkingConfig 映射 CC/Codex/OpenCode 的 thinking 参数。
// 参考 cross-analysis-adapters.md ThinkingConfig
type ThinkingConfig struct {
	Type   string `json:"type"`   // "disabled", "adaptive", "enabled"
	Budget *int   `json:"budget"` // Token 预算（Type=enabled 时）
}

// MCPConfig 描述要连接的 MCP 服务器。
// 参考 cross-analysis-adapters.md MCPConfig
// 参考 cross-analysis-sandbox-tools.md 第 2.3.4 节：MCP 集成
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
	Timeout   int               `json:"timeout,omitempty"` // 连接超时秒数
}

// SandboxConfig 描述沙箱限制。
// 参考 cross-analysis-sandbox-tools.md 第 1.2 节：三级沙箱策略
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

// ForkMode 定义 Fork 时携带多少对话历史。
// 参考 cross-analysis-adapters.md ForkMode
type ForkMode struct {
	Mode     string `json:"mode"`     // "full", "last_n_turns"
	NumTurns int    `json:"numTurns"` // 仅在 Mode="last_n_turns" 时使用
}

// ============================================================================
// Session 与 Event 类型
// 参考 cross-analysis-adapters.md 第 2.2 节
// ============================================================================

// AgentSession 表示一个运行中的 Agent Session。
// 参考 cross-analysis-adapters.md AgentSession
type AgentSession struct {
	ID           string       `json:"id"` // Adapter 特定的 session 标识符
	Status       AgentStatus  `json:"status"`
	StartRequest StartRequest `json:"startRequest"` // 原始请求，用于 resume/reconnect

	// Usage 在 Session 期间累计。
	Usage *UsageInfo `json:"usage,omitempty"`

	// Provider 信息在 system_init 后填充。
	ProviderInfo *ProviderInfo `json:"providerInfo,omitempty"`

	// Events 是 Agent 事件流。
	Events *EventStream `json:"-"` // 基于 Channel；不序列化
}

// AgentStatus 追踪 Session 的当前状态。
// 参考 cross-analysis-adapters.md AgentStatus
type AgentStatus string

const (
	StatusIdle            AgentStatus = "idle"
	StatusStarting        AgentStatus = "starting"
	StatusRunning         AgentStatus = "running"
	StatusWaitingApproval AgentStatus = "waiting_approval"
	StatusDraining        AgentStatus = "draining" // 参考 cross-analysis-adapters.md 第 3.4 节：Kanna draining
	StatusDone            AgentStatus = "done"
	StatusFailed          AgentStatus = "failed"
	StatusCancelled       AgentStatus = "cancelled"
)

// EventStream 封装 AgentEvent Channel 及生命周期控制。
// 参考 cross-analysis-adapters.md EventStream
type EventStream struct {
	C      <-chan AgentEvent  // 参考 cross-analysis-adapters.md：事件 channel
	Cancel context.CancelFunc  // 取消底层 Agent 进程/Turn
	Err    error               // 异常终止时设置
}

// ============================================================================
// Session Info 与 Fork 类型
// 参考 cross-analysis-adapters.md 第 2.2 节
// ============================================================================

type ForkRequest struct {
	SourceSessionID string   `json:"sourceSessionId"`
	ForkMode        ForkMode `json:"forkMode"`
	Title           string   `json:"title,omitempty"`
}

type SessionInfo struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Project      string `json:"project"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
	MessageCount int    `json:"messageCount"`
	Model        string `json:"model"`
}

type Pagination struct {
	Cursor string `json:"cursor,omitempty"`
	Limit  int    `json:"limit"`
}

// SteerMessage 向运行中的 Turn 注入一条用户消息。
// 参考 cross-analysis-adapters.md SteerMessage
type SteerMessage struct {
	Content     string `json:"content"`
	ReplaceLast bool   `json:"replaceLast"` // 参考 cross-analysis-adapters.md：Kanna steer ReplaceLast 标志
}

// ============================================================================
// Permission 类型（Adapter 层）
// 参考 cross-analysis-adapters.md 第 2.2 节 "Permission Callback Types"
// ============================================================================

// ToolPermissionRequest 由 Adapter 发送给 AgentHub 的审批引擎。
// 参考 cross-analysis-adapters.md ToolPermissionRequest
type ToolPermissionRequest struct {
	SessionID     string         `json:"sessionId"`
	TurnID        string         `json:"turnId"`
	ToolCallID    string         `json:"toolCallId"`
	ToolName      string         `json:"toolName"`
	ToolInput     map[string]any `json:"toolInput"`
	IsReadOnly    bool           `json:"isReadOnly"`
	IsDestructive bool           `json:"isDestructive"`
	Context       string         `json:"context"` // 人类可读的描述
}

// PermissionDecision 是 AgentHub 审批引擎的响应。
// 参考 cross-analysis-adapters.md PermissionDecision
type PermissionDecision struct {
	Behavior     string         `json:"behavior"`     // "allow", "deny", "ask_user"
	UpdatedInput map[string]any `json:"updatedInput,omitempty"`
	Reason       string         `json:"reason"`
}

// PermissionCallback 是 Adapter 调用来检查权限的函数签名。
// 参考 cross-analysis-adapters.md PermissionCallback
type PermissionCallback func(req ToolPermissionRequest) (*PermissionDecision, error)

// ============================================================================
// Adapter 配置
// 参考 cross-analysis-adapters.md AdapterConfig
// ============================================================================

// AdapterConfig 持有所有 provider 特定的配置。
type AdapterConfig struct {
	// 二进制路径
	BinaryPath string `json:"binaryPath"`

	// 环境变量
	Env map[string]string `json:"env,omitempty"`

	// 配置文件路径
	SettingsPath  string `json:"settingsPath,omitempty"`  // CC：settings.json
	ConfigPath    string `json:"configPath,omitempty"`    // Codex：config.toml
	MCPConfigPath string `json:"mcpConfigPath,omitempty"` // CC：.mcp.json

	// API 密钥 / 认证
	APIKey       string `json:"apiKey,omitempty"`
	APIKeyEnvVar string `json:"apiKeyEnvVar,omitempty"`

	// Home 目录
	DataDir string `json:"dataDir"` // ~/.claude, $CODEX_HOME 等

	// 流
	StreamTimeoutMs int `json:"streamTimeoutMs,omitempty"`

	// Provider 扩展（透传）
	Extras map[string]any `json:"extras,omitempty"`
}

// ============================================================================
// 按 Agent 的特殊配置
// 参考 cross-analysis-adapters.md 第 3 节 "Per-Agent Special Handling & Workarounds"
// ============================================================================

// ClaudeCodeConfig 是 CC 特定的 Adapter 配置。
// 参考 cross-analysis-adapters.md 第 3.1 节
type ClaudeCodeConfig struct {
	AdapterConfig
	// 参考第 3.1 节 Workaround 3：--verbose 对完整事件是必需的
	Verbose bool `json:"verbose"` // AgentHub 中始终为 true

	// 参考第 3.1 节 Workaround 5：headless 模式下的 permission mode
	// 使用 "bypassPermissions" 或 stdin 控制协议 can_use_tool
	HeadlessPermissionMode string `json:"headlessPermissionMode"`

	// 参考第 3.1 节 Workaround 6：thinking visibility 需要 Type=enabled
	ForceThinkingEnabled bool `json:"forceThinkingEnabled"`
}

// CodexConfig 是 Codex 特定的 Adapter 配置。
// 参考 cross-analysis-adapters.md 第 3.2 节
type CodexConfig struct {
	AdapterConfig
	// 参考第 3.2 节 Workaround 4：config.toml 自动生成
	AutoGenerateConfig bool `json:"autoGenerateConfig"`

	// 参考第 3.2 节 Workaround 1：rollout trace 重放
	RolloutTracePath string `json:"rolloutTracePath,omitempty"`

	// 参考第 3.2 节 Workaround 2：SessionId + ThreadId 双重性
	SessionID string `json:"sessionId"`
	ThreadID  string `json:"threadId"`
}

// OpenCodeConfig 是 OpenCode 特定的 Adapter 配置。
// 参考 cross-analysis-adapters.md 第 3.3 节
type OpenCodeConfig struct {
	AdapterConfig
	// 参考第 3.3 节 Workaround 1：服务器生命周期管理
	Port          int  `json:"port"` // 默认 4096
	AutoStart     bool `json:"autoStart"`
	HealthTimeout int  `json:"healthTimeout"` // 等待 /health 的毫秒数

	// 参考第 3.3 节 Workaround 4：agent info 硬编码
	AgentID string `json:"agentId"`
}
```

---

## 3. Hub-Edge 同步协议（`sync.go`）

```go
package protocol

import "time"

// ============================================================================
// Hub-Edge 同步协议
// 参考 architecture.md："Hub <-> Edge 同步协议"
// 参考 cross-analysis-orchestration.md 第 2 节：Edge-Hub relay
// 参考 protocol.md：EdgeEvent / EdgeToHubEvent / HubToEdgeCommand
// ============================================================================

// ============================================================================
// Edge 注册与心跳
// 参考 architecture.md：edge.register, edge.heartbeat
// ============================================================================

// RegisterRequest 在初始连接时由 Edge 发送给 Hub。
// 参考 architecture.md："Edge -> Hub: edge.register (edgeId, deviceName)"
// 参考 protocol.md：EdgeToHubEvent type "edge.register"
type RegisterRequest struct {
	EdgeID       string   `json:"edgeId"`
	DeviceName   string   `json:"deviceName"`
	Capabilities []string `json:"capabilities"` // 支持的操作："runner", "agent-claude", "agent-codex"
	Hostname     string   `json:"hostname"`
	OS           string   `json:"os"`
	Arch         string   `json:"arch"`
	Version      string   `json:"version"` // edge-server 版本
}

// RegisterResponse 是 Hub 对注册的确认。
type RegisterResponse struct {
	HubID     string `json:"hubId"`
	Accepted  bool   `json:"accepted"`
	SessionID string `json:"sessionId"` // Hub 分配的 session token
	Message   string `json:"message,omitempty"`
}

// Heartbeat 由 Edge 定期发送给 Hub。
// 参考 architecture.md："Edge -> Hub: edge.heartbeat"
type Heartbeat struct {
	EdgeID  string         `json:"edgeId"`
	Seq     int64          `json:"seq"`     // 参考 cross-analysis-orchestration.md：单调递增 seq
	Runners []RunnerStatus `json:"runners"` // 活跃 Runner 状态
	SentAt  time.Time      `json:"sentAt"`
}

// RunnerStatus 是 Runner 健康状况的快照。
// 参考 architecture.md：Runner
type RunnerStatus struct {
	RunnerID       string    `json:"runnerId"`
	EdgeID         string    `json:"edgeId"`
	Status         string    `json:"status"` // "idle", "running", "error"
	CurrentRunID   *RunID    `json:"currentRunId,omitempty"`
	ActiveSessions int       `json:"activeSessions"`
	LastHeartbeat  time.Time `json:"lastHeartbeat"`
}

// ============================================================================
// EdgeEvent -- 同步的基本单位
// 参考 protocol.md：EdgeEvent
// 参考 architecture.md："conversation.synced", "run.status", "artifact.created"
// ============================================================================

// EdgeEvent 是 Edge 与 Hub 之间同步的基本单位。
// 参考 protocol.md EdgeEvent
// 参考 architecture.md：Hub ↔ Edge sync protocol sequence
type EdgeEvent struct {
	ID         string        `json:"id"`
	EdgeID     string        `json:"edgeId"`
	Seq        int64         `json:"seq"`        // 参考 cross-analysis-orchestration.md：单调序列
	Type       EdgeEventType `json:"type"`
	Payload    any           `json:"payload"`
	CreatedAt  time.Time     `json:"createdAt"`
	SyncStatus SyncStatus    `json:"syncStatus"` // 参考 protocol.md："pending", "synced", "failed"
}

type EdgeEventType string

const (
	EdgeMessageCreated    EdgeEventType = "message.created"    // 参考 protocol.md
	EdgeRunStarted        EdgeEventType = "run.started"         // 参考 protocol.md
	EdgeRunStatusChanged  EdgeEventType = "run.status.changed"  // 参考 protocol.md
	EdgeArtifactCreated   EdgeEventType = "artifact.created"    // 参考 protocol.md
	EdgeMemoryUpdated     EdgeEventType = "memory.updated"      // 参考 protocol.md
	EdgeSummaryUpdated    EdgeEventType = "summary.updated"     // 参考 protocol.md
	EdgeThreadCreated     EdgeEventType = "thread.created"      // 参考 cross-analysis-orchestration.md
	EdgeApprovalRequired  EdgeEventType = "approval.required"   // 参考 cross-analysis-sandbox-tools.md 第 2.4 节
	EdgeApprovalResolved  EdgeEventType = "approval.resolved"   // 参考 cross-analysis-sandbox-tools.md 第 2.4 节
	EdgeCheckpointCreated EdgeEventType = "checkpoint.created" // 参考 cross-analysis-sandbox-tools.md 第 3 节
)

type SyncStatus string

const (
	SyncPending SyncStatus = "pending"
	SyncSynced  SyncStatus = "synced"
	SyncFailed  SyncStatus = "failed"
)

// ============================================================================
// Sync Batch 与 Ack
// ============================================================================

// SyncBatch 是一批一起发送的 EdgeEvent。
// 参考 architecture.md："conversation.synced (消息批量)"
type SyncBatch struct {
	EdgeID    string      `json:"edgeId"`
	Events    []EdgeEvent `json:"events"`
	FirstSeq  int64       `json:"firstSeq"`
	LastSeq   int64       `json:"lastSeq"`
	BatchSize int         `json:"batchSize"`
	SentAt    time.Time   `json:"sentAt"`
}

// SyncAck 确认收到一个同步批次。
// 参考 protocol.md：HubToEdgeCommand type "sync.ack"
// 参考 architecture.md："Hub -> Edge: sync.ack"
type SyncAck struct {
	EdgeID     string    `json:"edgeId"`
	LastSeq    int64     `json:"lastSeq"`               // 参考 cross-analysis-orchestration.md：最后同步的 seq
	Accepted   bool      `json:"accepted"`
	FailedSeqs []int64   `json:"failedSeqs,omitempty"` // 失败的序列号，用于选择性重试
	Message    string    `json:"message,omitempty"`
	AckedAt    time.Time `json:"ackedAt"`
}

// SyncState 追踪 Edge 和 Hub 之间的同步进度。
// 参考 cross-analysis-orchestration.md：Seq 管理
type SyncState struct {
	EdgeID        string    `json:"edgeId"`
	LastLocalSeq  int64     `json:"lastLocalSeq"`  // Edge 上最后的事件 seq
	LastSyncedSeq int64     `json:"lastSyncedSeq"` // Hub 确认的最后 seq
	PendingCount  int       `json:"pendingCount"`  // 未同步事件数
	LastSyncedAt  time.Time `json:"lastSyncedAt"`
	Status        string    `json:"status"`        // "synced", "syncing", "lagging", "disconnected"
}

// ============================================================================
// 权属转移
// 参考 architecture.md：ConversationAuthority
// 参考 authority.md：Authority ownership rules
// ============================================================================

// AuthorityTransfer 变更 Conversation 或 Artifact 的归属。
// 参考 authority.md："Conversation Authority owns message append order"
type AuthorityTransfer struct {
	ID            string                `json:"id"`
	ObjectType    string                `json:"objectType"` // "conversation", "artifact", "memory"
	ObjectID      string                `json:"objectId"`
	FromAuthority ConversationAuthority `json:"fromAuthority"`
	ToAuthority   ConversationAuthority `json:"toAuthority"`
	Reason        string                `json:"reason"`      // "user_migration", "edge_offline", "manual"
	RequestedBy   string                `json:"requestedBy"` // 用户或系统
	Status        TransferStatus        `json:"status"`
	CreatedAt     time.Time             `json:"createdAt"`
	CompletedAt   *time.Time            `json:"completedAt,omitempty"`
}

type TransferStatus string

const (
	TransferRequested TransferStatus = "requested"
	TransferAccepted  TransferStatus = "accepted"
	TransferCompleted TransferStatus = "completed"
	TransferRejected  TransferStatus = "rejected"
)

// ============================================================================
// Hub 到 Edge 的命令
// 参考 architecture.md：Hub -> Edge relay commands
// 参考 protocol.md：HubToEdgeCommand
// ============================================================================

// HubToEdgeCommand 是从 Hub 发送到 Edge 的命令。
// 参考 protocol.md：HubToEdgeCommand 可区分联合类型
type HubToEdgeCommand struct {
	Type    HubToEdgeCommandType `json:"type"`
	Payload any                  `json:"payload"`
	TraceID string               `json:"traceId,omitempty"` // 参考 protocol.md：ProtocolEnvelope traceId
	SentAt  time.Time            `json:"sentAt"`
}

type HubToEdgeCommandType string

const (
	HubCmdRunStart          HubToEdgeCommandType = "run.start"             // 参考 architecture.md："Hub -> Edge: run.start"
	HubCmdRunStop           HubToEdgeCommandType = "run.stop"              // 参考 protocol.md
	HubCmdMessageDeliver    HubToEdgeCommandType = "message.deliver"       // 参考 architecture.md："Hub -> Edge: message.deliver"
	HubCmdSyncAck           HubToEdgeCommandType = "sync.ack"              // 参考 protocol.md
	HubCmdPreviewRequest    HubToEdgeCommandType = "preview.request"       // 参考 protocol.md
	HubCmdMemorySync        HubToEdgeCommandType = "memory.sync.request"   // 参考 architecture.md："Hub -> Edge: memory.sync.request"
	HubCmdAuthorityTransfer HubToEdgeCommandType = "authority.transfer"    // 权属转移命令
)

// EdgeToHubEvent 是从 Edge 发送到 Hub 的事件。
// 参考 protocol.md：EdgeToHubEvent 可区分联合类型
type EdgeToHubEvent struct {
	Type    EdgeToHubEventType `json:"type"`
	Payload any                `json:"payload"`
	TraceID string             `json:"traceId,omitempty"`
	SentAt  time.Time          `json:"sentAt"`
}

type EdgeToHubEventType string

const (
	EdgeToHubRegister         EdgeToHubEventType = "edge.register"        // 参考 protocol.md
	EdgeToHubHeartbeat        EdgeToHubEventType = "edge.heartbeat"       // 参考 protocol.md
	EdgeToHubSyncEvents       EdgeToHubEventType = "sync.events"          // 参考 protocol.md
	EdgeToHubRunEvent         EdgeToHubEventType = "run.event"            // 参考 protocol.md
	EdgeToHubArtifactMetadata EdgeToHubEventType = "artifact.metadata"    // 参考 protocol.md
	EdgeToHubSyncState        EdgeToHubEventType = "sync.state"           // 同步状态报告
)

// ============================================================================
// 中继命令（用于 Hub 中转执行）
// 参考 architecture.md："Hub Relay 中继"
// ============================================================================

// RelayCommand 包装通过 Hub 中继到远程 Edge 的命令。
type RelayCommand struct {
	ID             string        `json:"id"`
	SourceNodeID   NodeID        `json:"sourceNodeId"`             // 发送者
	TargetEdgeID   string        `json:"targetEdgeId"`             // 目标 Edge
	TargetRunnerID string        `json:"targetRunnerId,omitempty"` // 特定 Runner
	Command        RunnerCommand `json:"command"`
	TraceID        string        `json:"traceId,omitempty"`
	CreatedAt      time.Time     `json:"createdAt"`
	ExpiresAt      *time.Time    `json:"expiresAt,omitempty"`
}

// RunnerCommand 是分发给 Runner 以管理 Agent 执行的命令。
// 参考 protocol.md RunnerCommand
// 参考 architecture.md：Edge -> Runner commands
type RunnerCommand struct {
	Type    RunnerCommandType `json:"type"`
	Payload any               `json:"payload"`
}

type RunnerCommandType string

const (
	RunnerCmdRunStart         RunnerCommandType = "run.start"          // 参考 protocol.md：{ type: "run.start"; runId; agentId; workspaceId; prompt }
	RunnerCmdRunCancel        RunnerCommandType = "run.cancel"         // 参考 protocol.md：{ type: "run.cancel"; runId }
	RunnerCmdArtifactRead     RunnerCommandType = "artifact.read"      // 参考 protocol.md：{ type: "artifact.read"; artifactId }
	RunnerCmdCheckpointCreate RunnerCommandType = "checkpoint.create"  // 参考 cross-analysis-sandbox-tools.md 第 3.5 节
	RunnerCmdCheckpointRestore RunnerCommandType = "checkpoint.restore"
)

// RunnerEvent 是从 Runner 发送到 Edge 的事件。
// 参考 protocol.md RunnerEvent
// 参考 architecture.md："Runner -> Edge 事件流"
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
	RunnerEventRunStarted      RunnerEventType = "run.started"        // 参考 protocol.md
	RunnerEventRunOutput       RunnerEventType = "run.output"         // 参考 protocol.md：stdout/stderr text
	RunnerEventArtifactCreated RunnerEventType = "artifact.created"   // 参考 protocol.md
	RunnerEventRunFinished     RunnerEventType = "run.finished"       // 参考 protocol.md
	RunnerEventPermissionReq   RunnerEventType = "permission.request" // 参考 cross-analysis-sandbox-tools.md 第 2.4 节
	RunnerEventCheckpointDone  RunnerEventType = "checkpoint.created" // 参考 cross-analysis-sandbox-tools.md 第 3 节
	RunnerEventAgentEvent      RunnerEventType = "agent.event"        // 来自 Adapter 的包装后 AgentEvent
)

// ============================================================================
// 协议信封（Edge-Hub 传输）
// 参考 protocol.md：ProtocolEnvelope<T>
// ============================================================================

// ProtocolEnvelope 包装任何协议消息用于传输。
// 参考 protocol.md："Every protocol message should eventually carry version, id, traceId, sentAt"
type ProtocolEnvelope struct {
	Version string    `json:"version"` // "v1"
	ID      string    `json:"id"`
	TraceID string    `json:"traceId,omitempty"`
	SentAt  time.Time `json:"sentAt"`
	Payload any       `json:"payload"`
}
```

---

## 4. Orchestrator 协议（`orchestration.go`）

```go
package protocol

import "time"

// ============================================================================
// Orchestrator 协议
// 参考 cross-analysis-orchestration.md：三层调度架构 + 四种调度策略 + 四层防循环
// ============================================================================

// ============================================================================
// Dispatch 策略
// 参考 cross-analysis-orchestration.md 第 2.4 节：调度策略混合模式
// ============================================================================

// DispatchStrategy 定义一条进入的消息如何路由到 Agent。
// 参考 cross-analysis-orchestration.md 第 2.4 节：四种策略
type DispatchStrategy struct {
	// 参考第 2.4 节 策略 A：@mention 直接委派（默认模式）
	DirectMention *DirectMentionStrategy `json:"directMention,omitempty"`

	// 参考第 2.4 节 策略 B：Supervisor 自动路由（多 Agent 协作模式）
	Supervisor *SupervisorStrategy `json:"supervisor,omitempty"`

	// 参考第 2.4 节 策略 C：YAML Template 预定义（复杂工作流模式）
	Template *TemplateStrategy `json:"template,omitempty"`

	// 参考第 2.4 节 策略 D：Fork 并行探索（多方案对比模式）
	Fork *ForkStrategy `json:"fork,omitempty"`

	// 参考第 2.5 节：调度决策流程图
	// 优先级：DirectMention > Supervisor > Template > Fork
}

// DirectMentionStrategy：@mention 即委派
// 参考 cross-analysis-orchestration.md 第 2.4 节 策略 A
type DirectMentionStrategy struct {
	// 为 true 时，Agent 回复对所有群组成员可见
	PublicResponse bool `json:"publicResponse"`

	// 无显式 @mention 时自动路由前的延迟
	AutoRouteDelayMs int `json:"autoRouteDelayMs,omitempty"`
}

// SupervisorStrategy：LLM 作为路由器
// 参考 cross-analysis-orchestration.md 第 2.4 节 策略 B
// 参考 cross-analysis-orchestration.md 第 1.1 节：Flowise Supervisor/Worker
type SupervisorStrategy struct {
	// Supervisor Agent ID（例如 "coordinator-agent"）
	SupervisorID string `json:"supervisorId"`

	// Supervisor 可以路由到的可用 Worker Agent
	Workers []string `json:"workers"`

	// 参考 cross-analysis-orchestration.md 第 3.2 节 第三层：recursionLimit
	MaxIterations int `json:"maxIterations"` // 默认 15-25（AgentHub 比 Flowise 的 100 更保守）

	// 参考 cross-analysis-orchestration.md 第 3.2 节 第三层：Worker 历史黑名单
	MaxSameWorkerRetries int `json:"maxSameWorkerRetries"` // 连续路由到同一 Worker 的上限（默认 2）

	// 参考 cross-analysis-orchestration.md：多模型适配
	// LLM 路由工具策略："function_calling" | "prompt_injection" | "tool_choice_any"
	RoutingStrategy string `json:"routingStrategy"`
}

// TemplateStrategy：YAML 工作流模板
// 参考 cross-analysis-orchestration.md 第 2.4 节 策略 C
// 参考 cross-analysis-orchestration.md 第 1.2 节：ChatDev YAML + Edge 条件路由
type TemplateStrategy struct {
	TemplateID    string `json:"templateId"`
	Version       string `json:"version"`        // 模板版本
	MaxIterations int    `json:"maxIterations"`  // 参考 cross-analysis-orchestration.md：每个模板的 max_iterations

	// 参考 cross-analysis-orchestration.md：Edge 条件路由
	// 条件在模板中定义，运行时求值
}

// ForkStrategy：并行探索
// 参考 cross-analysis-orchestration.md 第 2.4 节 策略 D
// 参考 cross-analysis-im-ux.md 第 2.3 节：Fork 四种模式
type ForkStrategy struct {
	// 参考 cross-analysis-im-ux.md：ForkMode DIRECT_PATH / INCLUDE_BRANCHES / TARGET_LEVEL / DEFAULT
	ForkMode ForkBranchMode `json:"forkMode"`
	// 要并行 Fork 到的 Agent ID
	TargetAgents []string `json:"targetAgents"`
	// 参考 cross-analysis-orchestration.md：MAX_FORK_BRANCHES_PER_MESSAGE = 5
	MaxBranches int `json:"maxBranches"`
}

// ForkBranchMode 映射 LibreChat 的 fork 模式。
// 参考 cross-analysis-im-ux.md 第 2.3 节：Fork 四种模式
type ForkBranchMode string

const (
	ForkDirectPath      ForkBranchMode = "direct_path"      // 仅目标路径
	ForkIncludeBranches ForkBranchMode = "include_branches"  // 目标路径 + 兄弟分支
	ForkTargetLevel     ForkBranchMode = "target_level"      // 目标层级的所有消息
	ForkDefault         ForkBranchMode = "default"           // 系统默认
)

// ============================================================================
// Subagent 图与循环检测
// 参考 cross-analysis-orchestration.md 第 3 节：四层防护
// ============================================================================

// SubagentGraph 表示委派拓扑。
// 参考 cross-analysis-orchestration.md 第 3.2 节：运行时祖先追踪
// 参考 cross-analysis-orchestration.md 第 3.1 节：循环产生场景
type SubagentGraph struct {
	ID        string         `json:"id"`
	Nodes     []SubagentNode `json:"nodes"`
	Edges     []SubagentEdge `json:"edges"`
	RootID    string         `json:"rootId"`    // 入口 Agent/用户
	MaxDepth  int            `json:"maxDepth"`  // 参考 cross-analysis-orchestration.md：MAX_DELEGATION_DEPTH = 5
	CreatedAt time.Time      `json:"createdAt"`
}

// SubagentNode 是委派图中的一个节点。
type SubagentNode struct {
	ID           string           `json:"id"`        // Agent ID 或用户 ID
	Type         SubagentNodeType `json:"type"`
	Role         string           `json:"role"`      // Agent 角色描述
	Capabilities []string         `json:"capabilities,omitempty"`
	Status       string           `json:"status"`    // "idle", "busy", "error"
}

type SubagentNodeType string

const (
	SubagentNodeUser  SubagentNodeType = "user"
	SubagentNodeAgent SubagentNodeType = "agent"
)

// SubagentEdge 表示从一个节点到另一个节点的委派。
// 参考 cross-analysis-orchestration.md 第 3.2 节：DelegationContext.path
type SubagentEdge struct {
	From       string `json:"from"`       // 委派方
	To         string `json:"to"`         // 被委派方
	Breadcrumb string `json:"breadcrumb"` // 参考 cross-analysis-orchestration.md：委派原因摘要（审计）
	Depth      int    `json:"depth"`      // 参考 cross-analysis-orchestration.md：委派深度
}

// ============================================================================
// 四层循环检测
// 参考 cross-analysis-orchestration.md 第 3.2 节：综合防循环方案（四层防护）
// ============================================================================

// CycleDetectionResult 是循环检测的结果。
// 参考 cross-analysis-orchestration.md 第 3.2 节
type CycleDetectionResult struct {
	HasCycle    bool               `json:"hasCycle"`
	CyclePath   []string           `json:"cyclePath,omitempty"`    // 形成循环的委派路径
	DetectedAt  CycleDetectionLayer `json:"detectedAt"`
	Reason      string             `json:"reason"`                 // 人类可读的解释
	Remediation string             `json:"remediation,omitempty"`  // 建议修复
}

type CycleDetectionLayer string

const (
	CycleLayerStatic     CycleDetectionLayer = "static"     // 第一层：预执行静态检测
	CycleLayerRuntime    CycleDetectionLayer = "runtime"    // 第二层：运行时祖先追踪
	CycleLayerSupervisor CycleDetectionLayer = "supervisor" // 第三层：LLM 路由安全网
	CycleLayerSystem     CycleDetectionLayer = "system"     // 第四层：全局资源限流
)

// CycleGuard 封装所有循环防护层。
// 参考 cross-analysis-orchestration.md 第 3.2 节 防循环机制总览
type CycleGuard struct {
	// 第一层：静态分析
	// 参考 cross-analysis-orchestration.md 第 3.2 节 第一层
	// 参考 Langflow graph/graph/base.py build_graph_maps
	AllowSelfDelegation bool `json:"allowSelfDelegation"` // 默认 false
	MaxDeclaredDepth    int  `json:"maxDeclaredDepth"`    // 参考：MAX_DECLARED_DEPTH

	// 第二层：运行时路径追踪
	// 参考 cross-analysis-orchestration.md 第 3.2 节 第二层
	// 参考 LibreChat buildSubagentConfigs ancestors: Set<string>
	MaxDepth      int `json:"maxDepth"`      // 参考：MAX_DELEGATION_DEPTH = 5
	MaxDurationMs int `json:"maxDurationMs"` // 参考：MAX_DELEGATION_CHAIN_DURATION = 300000（5 分钟）

	// 第三层：Supervisor 护栏
	// 参考 cross-analysis-orchestration.md 第 3.2 节 第三层
	// 参考 Flowise recursionLimit + ChatDev Loop Counter
	RecursionLimit       int `json:"recursionLimit"`       // 参考：15-25
	MaxSameWorkerRoutes  int `json:"maxSameWorkerRoutes"`  // 连续路由同 Worker 上限

	// 第四层：系统级限制
	// 参考 cross-analysis-orchestration.md 第 3.2 节 第四层
	// 参考 LibreChat MAX_SUBAGENT_RUN_CONFIGS
	MaxActiveSubagentsPerGroup int `json:"maxActiveSubagentsPerGroup"` // 参考：10
	MaxTotalSubagentsGlobal    int `json:"maxTotalSubagentsGlobal"`    // 参考：100
	MaxForkBranchesPerMessage  int `json:"maxForkBranchesPerMessage"`  // 参考：5
	RateLimitDelegationsPerAgent int `json:"rateLimitDelegationsPerAgent"` // 参考：20/min
}

// DelegationContext 追踪运行时委派状态。
// 参考 cross-analysis-orchestration.md 第 3.2 节 第二层：DelegationContext
type DelegationContext struct {
	Path          []string  `json:"path"`          // 委派链：["user", "CodeAgent", "ReviewAgent"]
	Depth         int       `json:"depth"`         // 当前深度
	StartTime     time.Time `json:"startTime"`     // 委派链起始时间
	MaxDepth      int       `json:"maxDepth"`      // 配置的最大深度
	MaxDurationMs int       `json:"maxDurationMs"` // 时间预算
	Breadcrumbs   []string  `json:"breadcrumbs"`   // 委派原因链（审计）
}

// ValidateDelegation 检查循环、深度和时间预算。
// 参考 cross-analysis-orchestration.md 第 3.2 节：validateDelegation()
func (d *DelegationContext) ValidateDelegation(targetID string) *CycleDetectionResult {
	// 第二层：循环检测
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

	// 第二层：深度检查
	if d.Depth >= d.MaxDepth {
		return &CycleDetectionResult{
			HasCycle:   true, // treated as cycle for blocking purposes
			DetectedAt: CycleLayerRuntime,
			Reason:     "max delegation depth exceeded",
		}
	}

	// 第二层：时间预算
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
// Agent Capability 注册表
// 参考 cross-analysis-orchestration.md 第 2.3 节 第二层：Agent Capability Registry
// 参考 cross-analysis-orchestration.md 第 4.3 节：Agent Capability 的输出自动暴露为 MCP tool
// ============================================================================

// AgentCapability 描述一个 Agent 能做什么，用于路由决策。
// 参考 cross-analysis-orchestration.md 第 2.3 节 第二层
type AgentCapability struct {
	AgentID      string   `json:"agentId"`
	AgentName    string   `json:"agentName"`
	DisplayName  string   `json:"displayName"`
	Provider     string   `json:"provider"`     // "claude-code", "codex", "opencode"
	Role         string   `json:"role"`         // "Full-stack developer", "Code reviewer" 等
	ModelDefault string   `json:"modelDefault"` // 默认模型
	Models       []string `json:"models"`       // 可用模型

	// 工具
	// 参考 cross-analysis-sandbox-tools.md 第 2 节：ToolRegistry
	Tools    []string `json:"tools"`    // 内置工具
	MCPTools []string `json:"mcpTools"` // MCP 提供的工具

	// Skills（更高级的组合能力）
	// 参考 cross-analysis-orchestration.md 第 4.3 节：Agent output → MCP tool
	Skills []string `json:"skills"` // 已注册 skills

	// 此 Agent 可以生成的子 Agent
	// 参考 cross-analysis-orchestration.md 第 3 节：subagent delegation
	SubAgents []string `json:"subAgents"`

	// 权限
	AllowedDirs []string     `json:"allowedDirs,omitempty"`
	Sandbox     SandboxLevel `json:"sandbox"`

	// 状态
	Status      AgentStatus `json:"status"`      // idle, busy, offline, error
	CurrentLoad int         `json:"currentLoad"` // 活跃任务数
	LastSeen    time.Time   `json:"lastSeen"`

	// UI 显示用元数据
	Icon  string `json:"icon,omitempty"`
	Color string `json:"color,omitempty"`
}

// SandboxLevel 映射到三级沙箱策略。
// 参考 cross-analysis-sandbox-tools.md 第 1.2 节：三级沙箱策略
type SandboxLevel string

const (
	SandboxWorktree SandboxLevel = "worktree" // 第一级：git worktree 隔离（默认）
	SandboxProcess  SandboxLevel = "process"  // 第二级：子进程隔离
	SandboxDocker   SandboxLevel = "docker"   // 第三级：容器隔离
)

// ============================================================================
// Tool Registry
// 参考 cross-analysis-sandbox-tools.md 第 2.3 节：AgentHub Tool Registry
// 参考 cross-analysis-sandbox-tools.md 第 2.2 节：Dify Tool Provider 模式
// ============================================================================

// ToolDescriptor 描述一个已注册的工具。
// 参考 cross-analysis-sandbox-tools.md 第 2.3.2 节：ToolDescriptor
type ToolDescriptor struct {
	Name             string          `json:"name"`
	DisplayName      string          `json:"displayName"`
	Description      string          `json:"description"`   // LLM 可读的描述
	Provider         ToolProviderType `json:"provider"`
	Schema           ToolSchema      `json:"schema"`        // 参数的 JSON Schema
	RiskLevel        RiskLevel       `json:"riskLevel"`
	RequiresApproval bool            `json:"requiresApproval"`
	ApprovalKind     ApprovalKind    `json:"approvalKind"`  // "once" | "per_thread" | "per_session"
	Enabled          bool            `json:"enabled"`
}

// ToolProviderType 匹配 Dify 的 provider 类别。
// 参考 cross-analysis-sandbox-tools.md 第 2.2 节：Dify 6 种 Provider 类型
// 参考 cross-analysis-sandbox-tools.md 第 2.3.3 节：ToolProviderType
type ToolProviderType string

const (
	ToolBuiltin   ToolProviderType = "builtin"   // CLI 原生工具（bash/read/write/edit/glob/grep）
	ToolMCP       ToolProviderType = "mcp"       // MCP 协议工具
	ToolAPI       ToolProviderType = "api"       // REST API 封装工具
	ToolPlugin    ToolProviderType = "plugin"    // 插件系统工具
	ToolComposite ToolProviderType = "composite" // 组合工具（pipeline）
)

// ToolSchema 定义工具参数的 JSON Schema。
type ToolSchema struct {
	Type       string              `json:"type"`       // "object"
	Properties map[string]ToolParam `json:"properties"`
	Required   []string            `json:"required,omitempty"`
}

type ToolParam struct {
	Type        string              `json:"type"`        // "string", "number", "boolean", "array", "object"
	Description string              `json:"description"`
	Enum        []string            `json:"enum,omitempty"`
	Default     any                 `json:"default,omitempty"`
	Items       *ToolParam          `json:"items,omitempty"`     // 数组类型时使用
	Properties  map[string]ToolParam `json:"properties,omitempty"` // 对象类型时使用
}

// ToolConfigSchema 是变体配置驱动的工具元数据。
// 参考 cross-analysis-sandbox-tools.md 第 2.5 节：ChatDev FIELD_SPECS 模式
type ToolConfigSchema struct {
	ToolName string            `json:"toolName"`
	Fields   []ToolConfigField `json:"fields"` // 参考 ChatDev FIELD_SPECS：动态表单渲染
}

type ToolConfigField struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Type        string   `json:"type"`        // "text", "number", "select", "toggle", "path"
	Required    bool     `json:"required"`
	Default     any      `json:"default,omitempty"`
	Options     []string `json:"options,omitempty"` // select 类型时使用
	Description string   `json:"description,omitempty"`
}

// ToolInstance 表示一个带有运行时上下文的实例化工具。
// 参考 cross-analysis-sandbox-tools.md 第 2.3.1 节：ToolRuntime
type ToolInstance struct {
	Descriptor  ToolDescriptor    `json:"descriptor"`
	WorkspaceID string            `json:"workspaceId"`
	RunID       RunID             `json:"runId"`
	TurnID      TurnID            `json:"turnId"`
	WorkingDir  string            `json:"workingDir"`
	Env         map[string]string `json:"env,omitempty"`
	Credentials map[string]string `json:"credentials,omitempty"` // 参考 cross-analysis-sandbox-tools.md：加密注入
}

// ToolResult 是工具调用的统一结果。
// 参考 cross-analysis-sandbox-tools.md 第 2.3.1 节：ToolEngine.Dispatch
type ToolResult struct {
	ToolCallID  string       `json:"toolCallId"`
	ToolName    string       `json:"toolName"`
	Content     string       `json:"content"`
	IsError     bool         `json:"isError"`
	ExitCode    *int         `json:"exitCode,omitempty"`
	IsDenied    bool         `json:"isDenied"`    // 参考 cross-analysis-sandbox-tools.md 第 2.4 节
	DenyReason  string       `json:"denyReason,omitempty"`
	DurationMs  int64        `json:"durationMs"`
	ArtifactIDs []ArtifactID `json:"artifactIds,omitempty"` // 产生的 Artifact
}

// ToolEvent 是工具执行期间的流式事件。
// 参考 cross-analysis-sandbox-tools.md 第 2.3.1 节：ToolEngine.Stream
type ToolEvent struct {
	ToolCallID string        `json:"toolCallId"`
	Type       ToolEventType `json:"type"`
	Data       string        `json:"data"`     // 增量输出
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

## 5. Approval 协议（`approval.go`）

```go
package protocol

import "time"

// ============================================================================
// Approval 协议
// 参考 approvals.md
// 参考 cross-analysis-sandbox-tools.md 第 2.4 节：Tool 审批门控设计
// 参考 cross-analysis-adapters.md 第 1.3 节：Permission & Approval Model
// ============================================================================

// ============================================================================
// Approval Request 与 Decision
// 参考 approvals.md：ApprovalRequest, ApprovalDecision
// ============================================================================

// ApprovalRequest 在工具/操作需要用户或管理员审批时发出。
// 参考 approvals.md ApprovalRequest
// 参考 cross-analysis-sandbox-tools.md 第 2.4 节：审批流
type ApprovalRequest struct {
	ID          string         `json:"id"`
	TurnID      TurnID         `json:"turnId"`
	RunID       RunID          `json:"runId"`
	ToolCallID  string         `json:"toolCallId,omitempty"` // 参考 cross-analysis-sandbox-tools.md：ToolCallID
	Kind        ApprovalKind   `json:"kind"`     // 参考 approvals.md："shell_command", "file_write", "network", "deploy"
	Title       string         `json:"title"`    // 人类可读的摘要
	Detail      string         `json:"detail"`   // 完整命令或操作描述
	RiskLevel   RiskLevel      `json:"riskLevel"` // 参考 approvals.md："low", "medium", "high"
	ToolInput   map[string]any `json:"toolInput,omitempty"` // 参考 cross-analysis-adapters.md：ToolPermissionRequest.ToolInput
	Context     string         `json:"context,omitempty"`   // 参考 cross-analysis-adapters.md：人类可读描述
	Status      ApprovalStatus `json:"status"`
	RequestedBy string         `json:"requestedBy"` // Agent ID
	CreatedAt   time.Time      `json:"createdAt"`
	ExpiresAt   *time.Time     `json:"expiresAt,omitempty"` // 到期自动拒绝
}

// ApprovalKind 分类需要审批的操作类型。
// 参考 approvals.md：shell_command / file_write / network / deploy
// 参考 cross-analysis-sandbox-tools.md 第 2.4 节：风险分类映射
type ApprovalKind string

const (
	ApprovalShellCommand   ApprovalKind = "shell_command"   // bash/shell 执行
	ApprovalFileWrite      ApprovalKind = "file_write"      // write/edit/multiedit 工具
	ApprovalNetwork        ApprovalKind = "network"         // web_fetch/web_search 等
	ApprovalDeploy         ApprovalKind = "deploy"          // git push / CI 触发
	ApprovalSensitiveRead  ApprovalKind = "sensitive_read"  // 读取 .env, ~/.ssh 等
	ApprovalAdmin          ApprovalKind = "admin"           // 管理操作
)

// ApprovalStatus 追踪审批请求的生命周期。
type ApprovalStatus string

const (
	ApprovalPending   ApprovalStatus = "pending"
	ApprovalAccepted  ApprovalStatus = "accepted"
	ApprovalDeclined  ApprovalStatus = "declined"
	ApprovalCancelled ApprovalStatus = "cancelled"
	ApprovalExpired   ApprovalStatus = "expired"
)

// ApprovalDecision 是对审批请求的响应。
// 参考 approvals.md ApprovalDecision
type ApprovalDecision struct {
	ID        string        `json:"id"`
	RequestID string        `json:"requestId"`
	Type      DecisionType  `json:"type"` // 参考 approvals.md：accept, acceptForThread, acceptForSession, decline, cancel
	Reason    string        `json:"reason,omitempty"` // 参考 approvals.md：decline reason
	DecidedBy string        `json:"decidedBy"` // 用户或系统
	Scope     DecisionScope `json:"scope"`     // once（默认）, thread, session
	DecidedAt time.Time     `json:"decidedAt"`
}

// DecisionType 映射到原始审批类型。
// 参考 approvals.md："accept", "acceptForThread", "acceptForSession", "decline", "cancel"
type DecisionType string

const (
	DecisionAccept           DecisionType = "accept"
	DecisionAcceptForThread  DecisionType = "acceptForThread"   // 参考 approvals.md："Allow for Thread"
	DecisionAcceptForSession DecisionType = "acceptForSession"  // 参考 approvals.md："Allow for Session"
	DecisionDecline          DecisionType = "decline"            // 参考 approvals.md："Decline"
	DecisionCancel           DecisionType = "cancel"             // 参考 approvals.md："Cancel"
)

// DecisionScope 控制审批决策的有效时长。
// 参考 cross-analysis-sandbox-tools.md：ToolDescriptor.ApprovalKind
type DecisionScope string

const (
	ScopeOnce    DecisionScope = "once"    // 仅本次执行有效
	ScopeThread  DecisionScope = "thread"  // 本 Thread 期间有效
	ScopeSession DecisionScope = "session" // 整个 Agent Session 期间有效
)

// RiskLevel 分类操作的严重程度。
// 参考 approvals.md："low", "medium", "high"
// 参考 cross-analysis-sandbox-tools.md 第 2.4 节：ToolDescriptor.RiskLevel
type RiskLevel string

const (
	RiskLow    RiskLevel = "low"
	RiskMedium RiskLevel = "medium"
	RiskHigh   RiskLevel = "high"
)

// ============================================================================
// Policy 规则引擎
// 参考 cross-analysis-adapters.md 第 1.3 节：rule sources and priority
// 参考 cross-analysis-sandbox-tools.md 第 2.4 节：审批流
// ============================================================================

// PolicyRule 定义一条用于自动决策的审批规则。
// 参考 cross-analysis-adapters.md 第 1.3 节：CC 9-source rule priority
// 参考 cross-analysis-sandbox-tools.md 第 2.4 节：白名单 / per-thread / per-session
type PolicyRule struct {
	ID          string       `json:"id"`
	Priority    int          `json:"priority"`    // 参考 cross-analysis-adapters.md：9 sources with priority
	Source      PolicySource `json:"source"`      // 规则来源
	Name        string       `json:"name"`        // 人类可读名称
	Description string       `json:"description,omitempty"`

	// 匹配条件
	Match  PolicyMatch  `json:"match"`  // 匹配什么
	Action PolicyAction `json:"action"` // 匹配后做什么
	Scope  PolicyScope  `json:"scope"`  // 规则适用范围

	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// PolicySource 指示规则的来源。
// 参考 cross-analysis-adapters.md 第 1.3 节：Claude Code 的 9 个来源
type PolicySource string

const (
	PolicyUser       PolicySource = "user"       // 用户设置
	PolicyProject    PolicySource = "project"    // .agenthub/ 规则
	PolicyAgent      PolicySource = "agent"      // Agent 特定规则
	PolicyTeam       PolicySource = "team"       // 团队级规则
	PolicyEnterprise PolicySource = "enterprise" // 企业策略
	PolicySession    PolicySource = "session"    // 仅当前 Session
	PolicyCLI        PolicySource = "cli"        // 命令行参数
	PolicySystem     PolicySource = "system"     // 系统默认值
)

// PolicyMatch 定义规则的匹配条件。
// 参考 cross-analysis-adapters.md 第 1.3 节：per-tool + 可选 content match
type PolicyMatch struct {
	// 工具匹配（例如 "Bash", "Bash(git *)", "Write"）
	ToolPattern    string `json:"toolPattern,omitempty"`    // 工具名的 glob 模式
	ToolInputKey   string `json:"toolInputKey,omitempty"`   // 按特定输入 key 匹配
	ToolInputValue string `json:"toolInputValue,omitempty"` // 按特定输入值匹配（regex）

	// 路径匹配
	PathPattern string `json:"pathPattern,omitempty"` // 文件路径的 glob 模式
	DirPattern  string `json:"dirPattern,omitempty"`  // 目录的 glob 模式

	// 风险匹配
	RiskLevel *RiskLevel `json:"riskLevel,omitempty"` // 按风险级别匹配

	// Agent 匹配
	AgentID      string `json:"agentId,omitempty"`      // 匹配特定 Agent
	ProviderType string `json:"providerType,omitempty"` // 匹配 Agent provider 类型
}

// PolicyAction 定义规则匹配后执行的操作。
type PolicyAction string

const (
	PolicyAllow    PolicyAction = "allow"     // 自动批准
	PolicyDeny     PolicyAction = "deny"      // 自动拒绝
	PolicyAskUser  PolicyAction = "ask_user"  // 总是询问用户
	PolicyEscalate PolicyAction = "escalate"  // 升级到管理员
)

// PolicyScope 定义规则的适用范围。
type PolicyScope string

const (
	PolicyScopeAgent   PolicyScope = "agent"   // 按 Agent
	PolicyScopeProject PolicyScope = "project" // 按项目
	PolicyScopeTeam    PolicyScope = "team"    // 按团队
	PolicyScopeGlobal  PolicyScope = "global"  // 系统全局
)

// ============================================================================
// Policy Engine 接口
// 参考 cross-analysis-sandbox-tools.md 第 2.4 节：审批策略评估
// ============================================================================

// PolicyEngine 根据已配置的规则评估审批请求。
// 参考 cross-analysis-sandbox-tools.md 第 2.4 节：审批流
//   Agent CLI 请求 tool 执行 → Runner ToolEngine 拦截 → Edge 审批策略评估
type PolicyEngine interface {
	// Evaluate 确定审批请求的决策。
	// 按优先级遍历规则；首个匹配生效。
	Evaluate(ctx Context, req *ApprovalRequest) (*ApprovalDecision, error)

	// RegisterRule 添加或更新一条策略规则。
	RegisterRule(rule *PolicyRule) error

	// RemoveRule 按 ID 删除一条策略规则。
	RemoveRule(ruleID string) error

	// ListRules 返回指定 scope 下按优先级排序的所有规则。
	ListRules(scope PolicyScope, scopeID string) ([]*PolicyRule, error)

	// RecordDecision 存储审批决策以备将来参考。
	RecordDecision(decision *ApprovalDecision) error
}

// ============================================================================
// 高风险模式检测
// 参考 approvals.md："High-risk actions include"
// ============================================================================

// HighRiskPattern 定义一个预定义的高风险操作模式。
// 参考 approvals.md：sudo, rm -rf, curl | sh, 读取 .env, 读取 ~/.ssh, git push, deploy, 写入工作区外
type HighRiskPattern struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Pattern     string       `json:"pattern"`     // regex 或命令模式
	Category    ApprovalKind `json:"category"`
	RiskLevel   RiskLevel    `json:"riskLevel"`   // 这些模式始终为 "high"
	Description string       `json:"description"` // 为什么有风险
	AutoDeny    bool         `json:"autoDeny"`    // 为 true 时无需用户提示直接自动拒绝
}

// HighRiskPatterns 返回默认的高风险模式集合。
// 参考 approvals.md："High-risk actions include"
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
// 群组级权限管理
// 参考 cross-analysis-orchestration.md 第 2.6 节：IM 群聊特有的调度能力 #4
// 参考 cross-analysis-im-ux.md：Authority 可视化
// ============================================================================

// PermissionVisibility 控制哪些群组成员可以看到消息/Thread 子树。
// 参考 cross-analysis-orchestration.md 第 2.6 节："基于消息树的权限隔离"
type PermissionVisibility struct {
	ConversationID ConversationID `json:"conversationId"`
	MessageID      MessageID      `json:"messageId"`      // 子树根
	VisibleTo      []string       `json:"visibleTo"`      // 可以看到此子树的用户/Agent ID
	Inherited      bool           `json:"inherited"`      // 为 true 时，子节点继承此可见性
	SetBy          string         `json:"setBy"`          // 谁设置了此限制
	SetAt          time.Time      `json:"setAt"`
}
```

---

## 附录：类型生成参考

本文件中的每个类型映射到以下生成产物：

```
packages/protocol/
  schema/
    common/conversation.schema.json    ← Conversation, Thread, Turn, Item
    common/agent-event.schema.json     ← AgentEvent, 所有 payload
    common/artifact.schema.json        ← Artifact, DiffArtifact, PreviewArtifact
    common/memory.schema.json          ← MemoryDocument, MemoryChunk, ContextSummary
    adapter/start-request.schema.json  ← StartRequest, AgentSession, EventStream
    adapter/agent-adapter.schema.json  ← AgentAdapter 接口规范
    sync/edge-event.schema.json        ← EdgeEvent, SyncBatch, SyncAck
    sync/authority.schema.json         ← ConversationAuthority, ExecutionAuthority 等
    orchestration/dispatch.schema.json ← DispatchStrategy, SubagentGraph, CycleGuard
    orchestration/capability.schema.json ← AgentCapability, ToolDescriptor
    approval/request.schema.json       ← ApprovalRequest, ApprovalDecision, PolicyRule
  go/
    generated/types.go                 ← 上述所有 Go 结构体
    generated/adapter.go               ← Adapter 接口
    generated/sync.go                  ← 同步类型
    generated/orchestration.go         ← 编排类型
    generated/approval.go              ← 审批类型
  ts/
    generated/types.ts                 ← 所有 TypeScript 类型（供 UI 使用）
```

---

## 交叉引用索引

| 本文件章节 | 主要来源 | 次要来源 |
|---|---|---|
| 1.1 标识类型 | protocol.md, data-model.md | architecture.md |
| 1.2 权属类型 | authority.md | architecture.md |
| 1.3 核心层次 | data-model.md | cross-analysis-im-ux.md |
| 1.4 AgentEvent（12 种类型） | cross-analysis-adapters.md 第 2.2 节 | 第 4.1 节 event mapping |
| 1.5 AgentRun | data-model.md | cross-analysis-adapters.md AgentSession |
| 1.6 Artifact 类型 | cross-analysis-im-ux.md 第 2.4/2.5 节 | cross-analysis-sandbox-tools.md 第 3 节 |
| 1.7 Memory 类型 | authority.md | cross-analysis-orchestration.md 第 4.3 节 |
| 2. AgentAdapter 接口 | cross-analysis-adapters.md 第 2.2 节 | 第 2.3 节 coverage map |
| 2. 按 Agent 配置 | cross-analysis-adapters.md 第 3 节 | 第 3.1-3.4 节 workarounds |
| 3. 同步协议 | architecture.md | protocol.md, cross-analysis-orchestration.md |
| 3. AuthorityTransfer | authority.md | architecture.md |
| 4. DispatchStrategy | cross-analysis-orchestration.md 第 2.4 节 | 第 2.5 节 decision flow |
| 4. CycleDetection | cross-analysis-orchestration.md 第 3 节 | 第 3.2 节 four layers |
| 4. AgentCapability | cross-analysis-orchestration.md 第 2.3 节 | cross-analysis-sandbox-tools.md |
| 4. ToolRegistry | cross-analysis-sandbox-tools.md 第 2.3 节 | 第 2.2 节 Dify pattern |
| 5. ApprovalRequest/Decision | approvals.md | cross-analysis-sandbox-tools.md 第 2.4 节 |
| 5. PolicyRule | cross-analysis-adapters.md 第 1.3 节 | approvals.md risk rules |
| 5. HighRiskPatterns | approvals.md | cross-analysis-sandbox-tools.md |
