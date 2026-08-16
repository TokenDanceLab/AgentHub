// #1162

package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

// TeamDetail is the response type for getting a team with its members.
type TeamDetail struct {
	*AgentTeam
	Members []AgentTeamMember `json:"members"`
}

// AssignmentType and AssignmentStatus constants.
const (
	AssignmentTypeDelegate = "delegate"
	AssignmentTypeReview   = "review"
	AssignmentTypeApprove  = "approve"
	AssignmentTypeNotify   = "notify"
	AssignmentTypeCompete  = "compete"
)

const (
	AssignmentStatusPending    = "pending"
	AssignmentStatusDispatched = "dispatched"
	AssignmentStatusRunning    = "running"
	AssignmentStatusDone       = "done"
	AssignmentStatusFailed     = "failed"
	AssignmentStatusCancelled  = "cancelled"
)

// AgentTeamAssignment represents a structured delegation from one team member to another.
type AgentTeamAssignment struct {
	ID           string    `gorm:"primaryKey;type:uuid" json:"id"`
	TeamRunID    string    `gorm:"type:uuid;not null;index" json:"team_run_id"`
	FromMemberID string    `gorm:"type:uuid;not null" json:"from_member_id"`
	ToMemberID   string    `gorm:"type:uuid;not null" json:"to_member_id"`
	Type         string    `gorm:"type:varchar(20);not null;default:delegate" json:"type"`
	TaskPrompt   string    `gorm:"type:text;not null" json:"task_prompt"`
	Context      string    `gorm:"type:text" json:"context,omitempty"`
	Status       string    `gorm:"type:varchar(20);not null;default:pending" json:"status"`
	RunID        *string   `gorm:"type:uuid" json:"run_id,omitempty"`
	Result       string    `gorm:"type:text" json:"result,omitempty"`
	Depth        int       `gorm:"not null;default:0" json:"depth"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (a *AgentTeamAssignment) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	a.ID = id
	return nil
}

func (AgentTeamAssignment) TableName() string {
	return "agent_team_assignments"
}

// TeamTask status and risk constants.
const (
	TeamTaskStatusPending    = "pending"
	TeamTaskStatusDispatched = "dispatched"
	TeamTaskStatusRunning    = "running"
	TeamTaskStatusDone       = "done"
	TeamTaskStatusFailed     = "failed"
	TeamTaskStatusCancelled  = "cancelled"
)

const (
	TeamTaskRiskNormal = "normal"
	TeamTaskRiskHigh   = "high"
)

// AgentTeamTask represents a first-class task inside a TeamRun. It can be
// created from a route decision and later bound to a concrete Edge/Hub run.
type AgentTeamTask struct {
	ID               string    `gorm:"primaryKey;type:uuid" json:"id"`
	TeamRunID        string    `gorm:"type:uuid;not null;index" json:"team_run_id"`
	AssignmentID     *string   `gorm:"type:uuid" json:"assignment_id,omitempty"`
	AssigneeMemberID string    `gorm:"type:uuid;not null" json:"assignee_member_id"`
	ParentTaskID     *string   `gorm:"type:uuid" json:"parent_task_id,omitempty"`
	Status           string    `gorm:"type:varchar(20);not null;default:pending" json:"status"`
	Objective        string    `gorm:"type:text;not null" json:"objective"`
	InputRefs        string    `gorm:"type:jsonb;not null;default:'{}'" json:"input_refs"`
	RunID            *string   `gorm:"type:varchar(128)" json:"run_id,omitempty"`
	Attempt          int       `gorm:"not null;default:1" json:"attempt"`
	RiskLevel        string    `gorm:"type:varchar(20);not null;default:normal" json:"risk_level"`
	CreatedAt        time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt        time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (t *AgentTeamTask) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	t.ID = id
	return nil
}

func (AgentTeamTask) TableName() string {
	return "agent_team_tasks"
}

// ── Delegation guardrail constants (ADR-006) ──────────────────────

const (
	MaxDelegationDepth       = 3
	MaxActiveSubAgentsPerRun = 5
	MaxRouteRepeats          = 3
	MaxTasksPerTeamRun       = 20
	DefaultAssignmentTimeout = 30 * time.Minute
	MaxTeamRunBudgetTokens   = int64(200_000)
	MaxTeamRunBudgetUsagePct = 95.0
)

// CoordinatorRouteDecision is the typed output a supervisor agent emits to
// delegate work to another team member. The supervisor writes this as a JSON
// object on its stdout (prefixed so the Edge adapter can route it), and the
// Hub parses it to create a TeamAssignment.
type CoordinatorRouteDecision struct {
	Action string `json:"action"` // delegate | review | approve | finish

	// delegate / review / approve
	NextWorker   string `json:"next_worker,omitempty"`  // AgentTeamMember.ID
	Instructions string `json:"instructions,omitempty"` // task prompt
	Reasoning    string `json:"reasoning,omitempty"`    // why this delegation
	Context      string `json:"context,omitempty"`      // additional context for the worker

	// approve
	Approved bool   `json:"approved,omitempty"`
	Feedback string `json:"feedback,omitempty"`

	// finish
	Summary       string `json:"summary,omitempty"`
	BlockedReason string `json:"blocked_reason,omitempty"`

	Accepted     bool   `json:"accepted,omitempty"`       // true when Hub accepts and queues a subtask
	SubtaskID    string `json:"subtask_id,omitempty"`     // AgentTeamTask.ID queued by Hub
	ParentTaskID string `json:"parent_task_id,omitempty"` // optional parent AgentTeamTask.ID
	AgentID      string `json:"agent_id,omitempty"`       // target AgentTeamMember.ID / agent id
	Reason       string `json:"reason,omitempty"`         // accepted/rejected audit reason

	CorrelationID string `json:"correlation_id,omitempty"` // links route to previous assignment
}

// AgentTeamEvent is an append-only event log entry for a team run.
// TeamRunState is derived by replaying these events in order.
type AgentTeamEvent struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	TeamRunID string    `gorm:"type:uuid;not null;index" json:"team_run_id"`
	Seq       int       `gorm:"not null" json:"seq"`
	Type      string    `gorm:"type:varchar(50);not null" json:"type"`
	Payload   string    `gorm:"type:jsonb;not null" json:"payload"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (e *AgentTeamEvent) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	e.ID = id
	return nil
}

func (AgentTeamEvent) TableName() string {
	return "agent_team_events"
}

// AgentTeamArtifact is a durable index for file/artifact-producing runtime
// events inside a TeamRun. The source of truth remains AgentRunEvent; this
// table makes team/member/task/tool provenance queryable without replaying.
type AgentTeamArtifact struct {
	ID             string    `gorm:"primaryKey;type:uuid" json:"id"`
	TeamRunID      string    `gorm:"type:uuid;not null;index" json:"team_run_id"`
	TeamTaskID     *string   `gorm:"type:uuid;index" json:"team_task_id,omitempty"`
	AssignmentID   *string   `gorm:"type:uuid;index" json:"assignment_id,omitempty"`
	MemberID       *string   `gorm:"type:uuid;index" json:"member_id,omitempty"`
	AgentTaskID    *string   `gorm:"type:uuid;index" json:"agent_task_id,omitempty"`
	EdgeRunID      string    `gorm:"type:varchar(128);index" json:"edge_run_id,omitempty"`
	SourceEventID  *string   `gorm:"type:uuid;index" json:"source_event_id,omitempty"`
	EventSeq       int64     `gorm:"not null;default:0" json:"event_seq"`
	Path           string    `gorm:"type:text;not null" json:"path"`
	NormalizedPath string    `gorm:"type:text;not null;index" json:"normalized_path"`
	Action         string    `gorm:"type:varchar(64)" json:"action,omitempty"`
	ToolName       string    `gorm:"type:varchar(128)" json:"tool_name,omitempty"`
	Status         string    `gorm:"type:varchar(64)" json:"status,omitempty"`
	ConflictID     string    `gorm:"type:text;index" json:"conflict_id,omitempty"`
	CreatedAt      time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt      time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (a *AgentTeamArtifact) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	a.ID = id
	return nil
}

func (AgentTeamArtifact) TableName() string {
	return "agent_team_artifacts"
}

// Event type constants for AgentTeamEvent.
const (
	TeamEventAssignmentCreated    = "assignment.created"
	TeamEventAssignmentDispatched = "assignment.dispatched"
	TeamEventAssignmentCompleted  = "assignment.completed"
	TeamEventAssignmentFailed     = "assignment.failed"
	TeamEventAssignmentCancelled  = "assignment.cancelled"
	TeamEventTaskCreated          = "team.task.created"
	TeamEventRouteDecided         = "team.route.decided"
	TeamEventRouteRejected        = "team.route.rejected"
	TeamEventRunStarted           = "team.run.started"
	TeamEventRunCompleted         = "team.run.completed"
	TeamEventRunFailed            = "team.run.failed"
	TeamEventAgentMessage         = "agent.message"
	TeamEventApprovalDecided      = "team.approval.decided"
	TeamEventConflictResolved     = "team.conflict.resolved"
	TeamEventReviewPending        = "team.review.pending"
	TeamEventReviewDecided        = "team.review.decided"
)
