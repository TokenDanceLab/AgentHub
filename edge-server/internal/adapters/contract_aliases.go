package adapters

// 合同类型唯一权威在 internal/orchestration（A-V1 Step 1, #1526）。
// 以下 alias 保持本包所有现有调用点（orchestrator*.go、plan_approval.go、
// 测试、外部 handlers）零改动；alias 不复制行为，不是双 SSOT。
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
