// Package orchestration holds the neutral, side-effect-free contract types
// shared between the adapters root package and the orchestrator sub-domain
// (A-V1 Step 0, #1526).
//
// Dependency direction: orchestration imports nothing from adapters;
// adapters (and the future adapters/orchestrator leaf package) import this
// package. This keeps the orchestrator extraction import-cycle-free:
//
//	adapters/orchestrator → adapters → orchestration
//
// (never orchestration → adapters).
package orchestration

import "time"

// TaskStatus represents the execution status of a plan task.
type TaskStatus string

const (
	TaskPending   TaskStatus = "pending"
	TaskRunning   TaskStatus = "running"
	TaskCompleted TaskStatus = "completed"
	TaskFailed    TaskStatus = "failed"
)

// PlanTask represents a single task within an execution plan.
type PlanTask struct {
	ID             string     `json:"id"`
	Agent          string     `json:"agent"`
	Description    string     `json:"description"`
	Mode           string     `json:"mode,omitempty"` // "parallel" or "sequential" execution hint for this task
	TargetFiles    []string   `json:"targetFiles,omitempty"`
	DependsOn      []string   `json:"dependsOn,omitempty"`
	ExpectedOutput string     `json:"expectedOutput,omitempty"`
	Status         TaskStatus `json:"status"`
}

// ExecutionPlan represents a structured plan output by the orchestrator.
type ExecutionPlan struct {
	Summary string     `json:"summary,omitempty"` // one-line description of the overall plan
	Mode    string     `json:"mode"`              // "parallel", "sequential", "pipeline"
	Tasks   []PlanTask `json:"tasks"`
}

// PlanApprovalConfig controls the plan approval gate behavior.
type PlanApprovalConfig struct {
	// Enabled controls whether the plan approval gate is active.
	// When false, dispatches proceed immediately without waiting for approval.
	Enabled bool `json:"enabled"`

	// AutoApproveTimeout is the duration after which a pending plan is
	// denied if no user decision arrives (timeout = deny, not approve).
	// Zero means wait indefinitely (not recommended). Default: 60 seconds.
	AutoApproveTimeout time.Duration `json:"autoApproveTimeout"`
}

// PendingPlan represents a plan proposed by the orchestrator that is awaiting
// user approval before sub-agent dispatches proceed.
type PendingPlan struct {
	RunID     string     `json:"runId"`
	ProjectID string     `json:"projectId,omitempty"`
	ThreadID  string     `json:"threadId,omitempty"`
	Tasks     []PlanTask `json:"tasks"`
	Mode      string     `json:"mode"` // "parallel" or "sequential"
	CreatedAt time.Time  `json:"createdAt"`
	Status    string     `json:"status"` // "pending", "approved", "rejected", "expired"
}

// PlanDecision is the user's decision on a proposed plan.
type PlanDecision struct {
	Approved bool   `json:"approved"`
	Reason   string `json:"reason,omitempty"`
}
