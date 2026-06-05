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
)

// TeamRunState is the materialized view of a team run derived by replaying
// AgentTeamEvent entries. It is computed on demand; not persisted separately.
type TeamRunState struct {
	RunID          string                     `json:"run_id"`
	TeamID         string                     `json:"team_id"`
	Status         string                     `json:"status"`
	Members        []TeamMemberState          `json:"members"`
	Tasks          []TeamTaskState            `json:"tasks"`
	Dependencies   []TeamTaskDependencyState  `json:"dependencies"`
	Assignments    []TeamAssignmentState      `json:"assignments"`
	Approvals      []TeamApprovalState        `json:"approvals"`
	Artifacts      []TeamArtifactState        `json:"artifacts"`
	Conflicts      []TeamConflictState        `json:"conflicts"`
	RunEvents      []TeamRunEventState        `json:"run_events"`
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
	AgentTaskID      string `json:"agent_task_id,omitempty"`
	EdgeRunID        string `json:"edge_run_id,omitempty"`
	Attempt          int    `json:"attempt"`
	RiskLevel        string `json:"risk_level"`
}

// TeamTaskDependencyState is a recoverable dependency edge between TeamTasks.
type TeamTaskDependencyState struct {
	TaskID          string `json:"task_id"`
	DependsOnTaskID string `json:"depends_on_task_id"`
	Kind            string `json:"kind"`
}

// TeamApprovalState summarizes approval requests and decisions in a TeamRun.
type TeamApprovalState struct {
	ApprovalID   string                   `json:"approval_id"`
	AgentTaskID  string                   `json:"agent_task_id"`
	TeamTaskID   string                   `json:"team_task_id,omitempty"`
	AssignmentID string                   `json:"assignment_id,omitempty"`
	MemberID     string                   `json:"member_id,omitempty"`
	EdgeRunID    string                   `json:"edge_run_id,omitempty"`
	RequestID    string                   `json:"request_id"`
	ToolName     string                   `json:"tool_name,omitempty"`
	ToolUseID    string                   `json:"tool_use_id,omitempty"`
	Status       string                   `json:"status"`
	Reason       string                   `json:"reason,omitempty"`
	DecidedBy    string                   `json:"decided_by,omitempty"`
	CreatedAt    time.Time                `json:"created_at"`
	DecidedAt    *time.Time               `json:"decided_at,omitempty"`
	EdgeControl  *TeamApprovalEdgeControl `json:"edge_control,omitempty"`
}

// TeamApprovalDecision records a human approval decision for a TeamRun approval
// and carries the Edge control payload that a Desktop/Edge bridge can deliver.
type TeamApprovalDecision struct {
	ApprovalID   string                   `json:"approval_id,omitempty"`
	AgentTaskID  string                   `json:"agent_task_id,omitempty"`
	TeamTaskID   string                   `json:"team_task_id,omitempty"`
	AssignmentID string                   `json:"assignment_id,omitempty"`
	MemberID     string                   `json:"member_id,omitempty"`
	EdgeRunID    string                   `json:"edge_run_id,omitempty"`
	RequestID    string                   `json:"request_id,omitempty"`
	ToolName     string                   `json:"tool_name,omitempty"`
	ToolUseID    string                   `json:"tool_use_id,omitempty"`
	Decision     string                   `json:"decision"`
	Reason       string                   `json:"reason,omitempty"`
	DecidedBy    string                   `json:"decided_by,omitempty"`
	DecidedAt    time.Time                `json:"decided_at,omitempty"`
	EdgeControl  *TeamApprovalEdgeControl `json:"edge_control,omitempty"`
}

// TeamApprovalEdgeControl is shaped as the JSON body accepted by Edge
// POST /v1/permissions/decide, with the local Edge run id as runId.
type TeamApprovalEdgeControl struct {
	RunID     string `json:"runId"`
	RequestID string `json:"requestId"`
	Decision  string `json:"decision"`
	Reason    string `json:"reason,omitempty"`
}

// TeamArtifactState summarizes file/artifact-producing runtime events.
type TeamArtifactState struct {
	AgentTaskID   string    `json:"agent_task_id"`
	TeamTaskID    string    `json:"team_task_id,omitempty"`
	AssignmentID  string    `json:"assignment_id,omitempty"`
	MemberID      string    `json:"member_id,omitempty"`
	EdgeRunID     string    `json:"edge_run_id,omitempty"`
	SourceEventID string    `json:"source_event_id,omitempty"`
	EventSeq      int64     `json:"event_seq,omitempty"`
	Path          string    `json:"path"`
	Action        string    `json:"action,omitempty"`
	ToolName      string    `json:"tool_name,omitempty"`
	Status        string    `json:"status,omitempty"`
	ConflictID    string    `json:"conflict_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// TeamConflictState summarizes a file-level conflict detected from multiple
// task/member file-change events in one TeamRun.
type TeamConflictState struct {
	ConflictID    string     `json:"conflict_id"`
	Path          string     `json:"path"`
	Status        string     `json:"status"`
	AgentTaskIDs  []string   `json:"agent_task_ids"`
	TeamTaskIDs   []string   `json:"team_task_ids,omitempty"`
	AssignmentIDs []string   `json:"assignment_ids,omitempty"`
	MemberIDs     []string   `json:"member_ids,omitempty"`
	EdgeRunIDs    []string   `json:"edge_run_ids,omitempty"`
	Actions       []string   `json:"actions,omitempty"`
	FirstSeenAt   time.Time  `json:"first_seen_at"`
	LastSeenAt    time.Time  `json:"last_seen_at"`
	Resolution    string     `json:"resolution,omitempty"`
	ResolvedBy    string     `json:"resolved_by,omitempty"`
	ResolvedAt    *time.Time `json:"resolved_at,omitempty"`
	Reason        string     `json:"reason,omitempty"`
	SelectedTask  string     `json:"selected_agent_task_id,omitempty"`
}

const (
	TeamConflictStatusPending  = "pending"
	TeamConflictStatusResolved = "resolved"
)

const (
	TeamConflictResolutionAcceptAgentTask = "accept_agent_task"
	TeamConflictResolutionManualMerge     = "manual_merge"
	TeamConflictResolutionKeepAll         = "keep_all"
	TeamConflictResolutionDiscardAll      = "discard_all"
	TeamConflictResolutionBlocked         = "blocked"
)

type TeamConflictResolution struct {
	ConflictID          string    `json:"conflict_id"`
	Path                string    `json:"path,omitempty"`
	Resolution          string    `json:"resolution"`
	SelectedAgentTaskID string    `json:"selected_agent_task_id,omitempty"`
	Reason              string    `json:"reason,omitempty"`
	ResolvedBy          string    `json:"resolved_by,omitempty"`
	ResolvedAt          time.Time `json:"resolved_at,omitempty"`
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
	AgentTaskID  string `json:"agent_task_id,omitempty"`
	EdgeRunID    string `json:"edge_run_id,omitempty"`
}

// TeamRunEventState is a runtime event projected into TeamRunState.
type TeamRunEventState struct {
	AgentTaskID string    `json:"agent_task_id"`
	EdgeRunID   string    `json:"edge_run_id,omitempty"`
	EventSeq    int64     `json:"event_seq"`
	EventType   string    `json:"event_type"`
	Payload     string    `json:"payload"`
	CreatedAt   time.Time `json:"created_at"`
}

// TeamBudget tracks token/resource usage for a team run.
type TeamBudget struct {
	TotalTokensUsed int64   `json:"total_tokens_used"`
	InputTokens     int64   `json:"input_tokens,omitempty"`
	OutputTokens    int64   `json:"output_tokens,omitempty"`
	TokenLimit      int64   `json:"token_limit"`
	RemainingTokens int64   `json:"remaining_tokens,omitempty"`
	UsagePercent    float64 `json:"usage_percent,omitempty"`
	RunCount        int     `json:"run_count"`
	ContextWarnings int     `json:"context_warnings,omitempty"`
	Compactions     int     `json:"compactions,omitempty"`
}
