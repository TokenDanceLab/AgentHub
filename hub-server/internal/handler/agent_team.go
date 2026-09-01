package handler

import (
	"context"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/agentteam"
)

// AgentTeamService is the subset of *service.AgentTeamService used by AgentTeamHandler.
type AgentTeamService interface {
	CreateTeam(ctx context.Context, userID, name, description string) (*model.AgentTeam, error)
	GetTeam(ctx context.Context, userID, teamID string) (*model.AgentTeam, error)
	GetTeamWithMembers(ctx context.Context, userID, teamID string) (*model.TeamDetail, error)
	ListTeams(ctx context.Context, userID string) ([]model.AgentTeam, error)
	UpdateTeam(ctx context.Context, userID, teamID, name, description string) error
	DeleteTeam(ctx context.Context, userID, teamID string) error
	AddTeamMember(ctx context.Context, userID, teamID, agentProfileID, role string) error
	RemoveTeamMember(ctx context.Context, userID, teamID, memberID string) error
	StartTeamRun(ctx context.Context, userID, teamID, triggerMessage, targetID string) (*model.AgentTeamRun, error)
	GetTeamRun(ctx context.Context, userID, teamID, runID string) (*model.AgentTeamRun, error)
	GetTeamRunState(ctx context.Context, userID, teamID, runID string) (*model.TeamRunState, error)
	ListTeamRuns(ctx context.Context, userID, teamID string) ([]model.AgentTeamRun, error)
	ListTeamTasks(ctx context.Context, userID, teamID, runID string) ([]model.AgentTeamTask, error)
	ListTeamEvents(ctx context.Context, userID, teamID, runID string, afterSeq, limit int) (agentteam.TeamEventsPage, error)
	HandleRouteDecision(ctx context.Context, userID, teamID, runID string, decision model.CoordinatorRouteDecision) (*model.AgentTeamAssignment, error)
	DecideApproval(ctx context.Context, userID, teamID, runID, approvalID string, decision model.TeamApprovalDecision) (*model.TeamApprovalState, error)
	ResolveConflict(ctx context.Context, userID, teamID, runID string, resolution model.TeamConflictResolution) (*model.TeamConflictState, error)

	// TeamAssignment
	CreateAssignment(ctx context.Context, userID, teamRunID, fromMemberID, toMemberID, aType, taskPrompt, contextStr string) (*model.AgentTeamAssignment, error)
	DispatchAssignment(ctx context.Context, userID, assignmentID string) error
	CompleteAssignment(ctx context.Context, userID, assignmentID string, result string) error
	FailAssignment(ctx context.Context, userID, assignmentID string, reason string) error
	ListAssignments(ctx context.Context, userID, teamRunID string) ([]model.AgentTeamAssignment, error)

	// Compete mode
	GenerateCompeteSummary(ctx context.Context, userID, runID string, req model.CompeteSummaryRequest) (*model.CompeteSummaryResponse, error)

	// Human review gate
	ReviewDagPlan(ctx context.Context, userID, runID string, decision model.HumanReviewDecision) (*model.HumanReviewState, error)

	// Authorization (layering: handler delegates to service, no repository import)
	CheckTeamAccess(ctx context.Context, userID, teamID string, minRole agentteam.TeamRole) error
	ResolveTeamIDFromRun(ctx context.Context, runID string) (string, error)
	ResolveTeamIDFromAssignment(ctx context.Context, assignmentID string) (string, error)
}

type AgentTeamHandler struct {
	service AgentTeamService
}

func NewAgentTeamHandler(s AgentTeamService) *AgentTeamHandler {
	return &AgentTeamHandler{service: s}
}

// --- Request types ---

type createTeamReq struct {
	Name        string `json:"name" binding:"required,max=128"`
	Description string `json:"description,omitempty" binding:"max=1024"`
}

type updateTeamReq struct {
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
}

type addMemberReq struct {
	AgentProfileID string `json:"agent_profile_id" binding:"required"`
	Role           string `json:"role,omitempty"`
}

type startRunReq struct {
	TriggerMessage string `json:"trigger_message" binding:"required"`
	TargetID       string `json:"target_id,omitempty"`
}

// --- Assignment Request types ---

type createAssignmentReq struct {
	FromMemberID string `json:"from_member_id" binding:"required"`
	ToMemberID   string `json:"to_member_id" binding:"required"`
	Type         string `json:"type,omitempty"`
	TaskPrompt   string `json:"task_prompt" binding:"required"`
	Context      string `json:"context,omitempty"`
}

type completeAssignmentReq struct {
	Result string `json:"result" binding:"required"`
}

type failAssignmentReq struct {
	Reason string `json:"reason" binding:"required"`
}

type resolveConflictReq struct {
	Path                string `json:"path,omitempty"`
	Resolution          string `json:"resolution" binding:"required"`
	SelectedAgentTaskID string `json:"selected_agent_task_id,omitempty"`
	Reason              string `json:"reason,omitempty"`
}

type decideApprovalReq struct {
	Decision string `json:"decision" binding:"required"`
	Reason   string `json:"reason,omitempty"`
}
