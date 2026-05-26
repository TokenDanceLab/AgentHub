package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// AgentTeam represents a product-level team of AI agents.
type AgentTeam struct {
	ID          string    `gorm:"primaryKey;type:uuid" json:"id"`
	OwnerID     string    `gorm:"type:uuid;not null" json:"owner_id"`
	Name        string    `gorm:"type:varchar(100);not null" json:"name"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	AvatarURL   string    `gorm:"type:varchar(500)" json:"avatar_url,omitempty"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (a *AgentTeam) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	a.ID = id
	return nil
}

func (AgentTeam) TableName() string {
	return "agent_teams"
}

// AgentTeamMember represents a member of an AgentTeam.
type AgentTeamMember struct {
	ID             string    `gorm:"primaryKey;type:uuid" json:"id"`
	TeamID         string    `gorm:"type:uuid;not null" json:"team_id"`
	AgentProfileID *string   `gorm:"type:uuid" json:"agent_profile_id,omitempty"`
	Role           string    `gorm:"type:varchar(20);not null;default:executor" json:"role"`
	Position       int       `gorm:"not null;default:0" json:"position"`
	CreatedAt      time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (a *AgentTeamMember) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	a.ID = id
	return nil
}

func (AgentTeamMember) TableName() string {
	return "agent_team_members"
}

// AgentTeamRun status constants.
const (
	TeamRunStatusQueued    = "queued"
	TeamRunStatusRunning   = "running"
	TeamRunStatusCompleted = "completed"
	TeamRunStatusFailed    = "failed"
	TeamRunStatusCancelled = "cancelled"
)

// AgentTeamMember role constants.
const (
	TeamMemberRoleSupervisor = "supervisor"
	TeamMemberRoleExecutor   = "executor"
	TeamMemberRoleReviewer   = "reviewer"
)

// AgentTeamRun represents a single run of an AgentTeam.
type AgentTeamRun struct {
	ID             string    `gorm:"primaryKey;type:uuid" json:"id"`
	TeamID         string    `gorm:"type:uuid;not null" json:"team_id"`
	SessionID      string    `gorm:"type:uuid;not null" json:"session_id"`
	TriggerUserID  string    `gorm:"type:uuid;not null" json:"trigger_user_id"`
	TriggerMessage string    `gorm:"type:text" json:"trigger_message,omitempty"`
	Status         string    `gorm:"type:varchar(20);not null;default:queued" json:"status"`
	CreatedAt      time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt      time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (a *AgentTeamRun) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	a.ID = id
	return nil
}

func (AgentTeamRun) TableName() string {
	return "agent_team_runs"
}

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
	TeamRunID    string    `gorm:"type:uuid;not null" json:"team_run_id"`
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
	TeamRunID        string    `gorm:"type:uuid;not null" json:"team_run_id"`
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
	MaxTasksPerTeamRun       = 20
	DefaultAssignmentTimeout = 30 * time.Minute
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

	CorrelationID string `json:"correlation_id,omitempty"` // links route to previous assignment
}

// ValidActions returns the set of valid route decision actions.
func ValidActions() map[string]bool {
	return map[string]bool{
		"delegate": true,
		"review":   true,
		"approve":  true,
		"finish":   true,
	}
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
)

// TeamRunState is the materialized view of a team run derived by replaying
// AgentTeamEvent entries. It is computed on demand; not persisted separately.
type TeamRunState struct {
	RunID          string                     `json:"run_id"`
	TeamID         string                     `json:"team_id"`
	Status         string                     `json:"status"`
	Members        []TeamMemberState          `json:"members"`
	Tasks          []TeamTaskState            `json:"tasks"`
	Assignments    []TeamAssignmentState      `json:"assignments"`
	RouteLog       []CoordinatorRouteDecision `json:"route_log"`
	Budget         *TeamBudget                `json:"budget,omitempty"`
	TerminalReason string                     `json:"terminal_reason,omitempty"`
}

// TeamMemberState is a member's status within a team run.
type TeamMemberState struct {
	MemberID       string `json:"member_id"`
	AgentProfileID string `json:"agent_profile_id,omitempty"`
	Role           string `json:"role"`
	ActiveTasks    int    `json:"active_tasks"`
	CompletedTasks int    `json:"completed_tasks"`
}

// TeamTaskState is a recoverable TeamTask projection for TeamRunState.
type TeamTaskState struct {
	TaskID           string `json:"task_id"`
	AssignmentID     string `json:"assignment_id,omitempty"`
	AssigneeMemberID string `json:"assignee_member_id"`
	ParentTaskID     string `json:"parent_task_id,omitempty"`
	Status           string `json:"status"`
	Objective        string `json:"objective"`
	RunID            string `json:"run_id,omitempty"`
	Attempt          int    `json:"attempt"`
	RiskLevel        string `json:"risk_level"`
}

// TeamAssignmentState is a resolved assignment with runtime info.
type TeamAssignmentState struct {
	AssignmentID string `json:"assignment_id"`
	FromMemberID string `json:"from_member_id"`
	ToMemberID   string `json:"to_member_id"`
	Type         string `json:"type"`
	Status       string `json:"status"`
	Depth        int    `json:"depth"`
	RunID        string `json:"run_id,omitempty"`
}

// TeamBudget tracks token/resource usage for a team run.
type TeamBudget struct {
	TotalTokensUsed int64 `json:"total_tokens_used"`
	TokenLimit      int64 `json:"token_limit"`
	RunCount        int   `json:"run_count"`
}
