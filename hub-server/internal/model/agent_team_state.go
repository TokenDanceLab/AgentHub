// #1162

package model

import (
	"time"
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
	RouteAuditLog  []TeamRouteAuditState      `json:"route_audit_log"`
	Reviews        []HumanReviewState         `json:"reviews,omitempty"`
	Budget         *TeamBudget                `json:"budget,omitempty"`
	TerminalReason string                     `json:"terminal_reason,omitempty"`
}

// TeamRouteAuditState is a replay-friendly route decision audit entry. It keeps
// accepted and rejected route decisions queryable without reinterpreting raw
// event payloads.
type TeamRouteAuditState struct {
	Status        string    `json:"status"` // accepted | rejected
	Action        string    `json:"action,omitempty"`
	SubtaskID     string    `json:"subtask_id,omitempty"`
	ParentTaskID  string    `json:"parent_task_id,omitempty"`
	AgentID       string    `json:"agent_id,omitempty"`
	Reason        string    `json:"reason,omitempty"`
	CorrelationID string    `json:"correlation_id,omitempty"`
	CreatedAt     time.Time `json:"created_at,omitempty"`
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

// ── Compete mode types ────────────────────────────────────────────

// CompeteSummaryRequest is the request body for POST /client/team-runs/{id}/compete-summary.
type CompeteSummaryRequest struct {
	// Prompt is an optional user-supplied prompt for the comparison LLM.
	Prompt string `json:"prompt,omitempty"`
}

// CompeteSummaryResponse is the response for a compete-mode comparison summary.
type CompeteSummaryResponse struct {
	TeamRunID string                `json:"team_run_id"`
	Summary   string                `json:"summary"`
	Entries   []CompeteSummaryEntry `json:"entries"`
	CreatedAt time.Time             `json:"created_at"`
}

// CompeteSummaryEntry represents one agent's result within a compete comparison.
type CompeteSummaryEntry struct {
	MemberID     string `json:"member_id"`
	AssignmentID string `json:"assignment_id"`
	TaskID       string `json:"task_id,omitempty"`
	AgentTaskID  string `json:"agent_task_id,omitempty"`
	Result       string `json:"result"`
	Status       string `json:"status"`
}

// Compete aggregate event type constants.
const (
	TeamEventCompeteDispatched = "team.compete.dispatched"
	TeamEventCompeteAggregated = "team.compete.aggregated"
)

// ── Human Review Gate (ADR-008) ──────────────────────────────────

// HumanReviewDecision is the request body for POST /client/team-runs/{id}/review-decision.
type HumanReviewDecision struct {
	Action  string              `json:"action"` // "approve" | "discuss" | "modify"
	Comment string              `json:"comment,omitempty"`
	Changes []HumanReviewChange `json:"changes,omitempty"`
}

// HumanReviewChange represents a single modification in a "modify" review decision.
type HumanReviewChange struct {
	Field string `json:"field"` // e.g. "instructions", "next_worker"
	Value string `json:"value"`
}

// HumanReviewState is a replay-friendly human review record in TeamRunState.
type HumanReviewState struct {
	ReviewID  string              `json:"review_id"`
	RunID     string              `json:"run_id"`
	Action    string              `json:"action"` // "approve" | "discuss" | "modify"
	Comment   string              `json:"comment,omitempty"`
	Changes   []HumanReviewChange `json:"changes,omitempty"`
	DecidedBy string              `json:"decided_by,omitempty"`
	CreatedAt time.Time           `json:"created_at"`
	DecidedAt *time.Time          `json:"decided_at,omitempty"`
}

// ValidActions returns the set of valid route decision actions.
func ValidActions() map[string]bool {
	return map[string]bool{
		"delegate": true,
		"review":   true,
		"approve":  true,
		"compete":  true,
		"finish":   true,
	}
}

// ValidReviewActions returns the set of valid human review decision actions.
func ValidReviewActions() map[string]bool {
	return map[string]bool{
		ReviewActionApprove: true,
		ReviewActionDiscuss: true,
		ReviewActionModify:  true,
	}
}
