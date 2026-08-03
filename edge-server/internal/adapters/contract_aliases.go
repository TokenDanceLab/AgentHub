package adapters

// 合同类型唯一权威在 internal/orchestration（A-V1 Step 0, #1526；Step 2, #1566）。
// 以下 alias 保持本包所有现有调用点（其余 adapter 实现、httpserver、api、
// lifecycle、tests）零改动；alias 不复制行为，不是双 SSOT。
import (
	"github.com/agenthub/edge-server/internal/orchestration"
)

type TaskStatus = orchestration.TaskStatus

const (
	TaskPending   = orchestration.TaskPending
	TaskRunning   = orchestration.TaskRunning
	TaskCompleted = orchestration.TaskCompleted
	TaskFailed    = orchestration.TaskFailed
)

type PlanTask = orchestration.PlanTask
type ExecutionPlan = orchestration.ExecutionPlan
type PlanApprovalConfig = orchestration.PlanApprovalConfig
type PendingPlan = orchestration.PendingPlan
type PlanDecision = orchestration.PlanDecision

// ── Adapter-domain contract aliases (A-V1 Step 2, #1566) ─────────────────────

// AgentAdapter / EventEmitter / AdapterMetadata / AgentCapabilities /
// SubAgentTask / SiblingInfo / SubAgentSpawner / RunProcessContext /
// CtxBudgetKey / BusEvent* 的唯一权威定义在 internal/orchestration；
// 本包保留 alias 供既有调用点零改动使用。叶子包 internal/adapters/orchestrator
// 直接依赖 orchestration，不再经过本包。
type AgentAdapter = orchestration.AgentAdapter
type EventEmitter = orchestration.EventEmitter
type AdapterMetadata = orchestration.AdapterMetadata
type AgentCapabilities = orchestration.AgentCapabilities
type SubAgentTask = orchestration.SubAgentTask
type SiblingInfo = orchestration.SiblingInfo
type SubAgentSpawner = orchestration.SubAgentSpawner

// Bus event type strings（与 orchestration 完全一致，防双 SSOT）。
const (
	BusEventTextDelta           = orchestration.BusEventTextDelta
	BusEventTextBlock           = orchestration.BusEventTextBlock
	BusEventThinking            = orchestration.BusEventThinking
	BusEventToolCall            = orchestration.BusEventToolCall
	BusEventToolResult          = orchestration.BusEventToolResult
	BusEventFileChange          = orchestration.BusEventFileChange
	BusEventRouteDecision       = orchestration.BusEventRouteDecision
	BusEventSessionInit         = orchestration.BusEventSessionInit
	BusEventResult              = orchestration.BusEventResult
	BusEventCompactBoundary     = orchestration.BusEventCompactBoundary
	BusEventStatusChange        = orchestration.BusEventStatusChange
	BusEventAPIRetry            = orchestration.BusEventAPIRetry
	BusEventTaskStarted         = orchestration.BusEventTaskStarted
	BusEventTaskDispatched      = orchestration.BusEventTaskDispatched
	BusEventTaskProgress        = orchestration.BusEventTaskProgress
	BusEventTaskNotification    = orchestration.BusEventTaskNotification
	BusEventSubAgentStatus      = orchestration.BusEventSubAgentStatus
	BusEventSessionStateChanged = orchestration.BusEventSessionStateChanged
	BusEventHookStarted         = orchestration.BusEventHookStarted
	BusEventHookProgress        = orchestration.BusEventHookProgress
	BusEventHookResponse        = orchestration.BusEventHookResponse
	BusEventToolUseSummary      = orchestration.BusEventToolUseSummary
	BusEventAuthStatus          = orchestration.BusEventAuthStatus
	BusEventRateLimit           = orchestration.BusEventRateLimit
	BusEventCLIInvocationPlan   = orchestration.BusEventCLIInvocationPlan
	BusEventMCPToolCall         = orchestration.BusEventMCPToolCall
	BusEventPermissionRequested = orchestration.BusEventPermissionRequested
	BusEventPermissionDecided   = orchestration.BusEventPermissionDecided
	BusEventSessionMetrics      = orchestration.BusEventSessionMetrics
	BusEventContextUsage        = orchestration.BusEventContextUsage
	BusEventContextWarning      = orchestration.BusEventContextWarning
	BusEventContextCompaction   = orchestration.BusEventContextCompaction
	BusEventPlanProposed        = orchestration.BusEventPlanProposed
	BusEventPlanApproved        = orchestration.BusEventPlanApproved
	BusEventPlanRejected        = orchestration.BusEventPlanRejected
	BusEventPlanExpired         = orchestration.BusEventPlanExpired
	BusEventToolRejected        = orchestration.BusEventToolRejected
)
