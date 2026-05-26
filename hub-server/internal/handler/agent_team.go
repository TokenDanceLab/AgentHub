package handler

import (
	"context"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
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
	StartTeamRun(ctx context.Context, userID, teamID, triggerMessage string) (*model.AgentTeamRun, error)
	GetTeamRun(ctx context.Context, userID, teamID, runID string) (*model.AgentTeamRun, error)
	GetTeamRunState(ctx context.Context, userID, teamID, runID string) (*model.TeamRunState, error)
	ListTeamRuns(ctx context.Context, userID, teamID string) ([]model.AgentTeamRun, error)
	ListTeamTasks(ctx context.Context, userID, teamID, runID string) ([]model.AgentTeamTask, error)
	ListTeamEvents(ctx context.Context, userID, teamID, runID string) ([]model.AgentTeamEvent, error)
	HandleRouteDecision(ctx context.Context, userID, teamID, runID string, decision model.CoordinatorRouteDecision) (*model.AgentTeamAssignment, error)

	// TeamAssignment
	CreateAssignment(ctx context.Context, userID, teamRunID, fromMemberID, toMemberID, aType, taskPrompt, contextStr string) (*model.AgentTeamAssignment, error)
	DispatchAssignment(ctx context.Context, userID, assignmentID string) error
	CompleteAssignment(ctx context.Context, userID, assignmentID string, result string) error
	FailAssignment(ctx context.Context, userID, assignmentID string, reason string) error
	ListAssignments(ctx context.Context, userID, teamRunID string) ([]model.AgentTeamAssignment, error)
}

type AgentTeamHandler struct {
	service AgentTeamService
}

func NewAgentTeamHandler(s AgentTeamService) *AgentTeamHandler {
	return &AgentTeamHandler{service: s}
}

// --- Request types ---

type createTeamReq struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description,omitempty"`
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
}

// --- Handlers ---

// CreateTeam POST /web/agent-teams
func (h *AgentTeamHandler) CreateTeam(c *gin.Context) {
	var req createTeamReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	team, err := h.service.CreateTeam(c.Request.Context(), userID, req.Name, req.Description)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, team)
}

// ListTeams GET /web/agent-teams
func (h *AgentTeamHandler) ListTeams(c *gin.Context) {
	userID := c.GetString("user_id")
	teams, err := h.service.ListTeams(c.Request.Context(), userID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	if teams == nil {
		teams = []model.AgentTeam{}
	}
	OK(c, teams)
}

// GetTeam GET /web/agent-teams/:id
func (h *AgentTeamHandler) GetTeam(c *gin.Context) {
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	detail, err := h.service.GetTeamWithMembers(c.Request.Context(), userID, teamID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, detail)
}

// UpdateTeam PUT /web/agent-teams/:id
func (h *AgentTeamHandler) UpdateTeam(c *gin.Context) {
	var req updateTeamReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	if err := h.service.UpdateTeam(c.Request.Context(), userID, teamID, req.Name, req.Description); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

// DeleteTeam DELETE /web/agent-teams/:id
func (h *AgentTeamHandler) DeleteTeam(c *gin.Context) {
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	if err := h.service.DeleteTeam(c.Request.Context(), userID, teamID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

// AddMember POST /web/agent-teams/:id/members
func (h *AgentTeamHandler) AddMember(c *gin.Context) {
	var req addMemberReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	if err := h.service.AddTeamMember(c.Request.Context(), userID, teamID, req.AgentProfileID, req.Role); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

// RemoveMember DELETE /web/agent-teams/:id/members/:member_id
func (h *AgentTeamHandler) RemoveMember(c *gin.Context) {
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	memberID := c.Param("member_id")
	if err := h.service.RemoveTeamMember(c.Request.Context(), userID, teamID, memberID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

// StartRun POST /web/agent-teams/:id/runs
func (h *AgentTeamHandler) StartRun(c *gin.Context) {
	var req startRunReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	run, err := h.service.StartTeamRun(c.Request.Context(), userID, teamID, req.TriggerMessage)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, run)
}

// ListRuns GET /web/agent-teams/:id/runs
func (h *AgentTeamHandler) ListRuns(c *gin.Context) {
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	runs, err := h.service.ListTeamRuns(c.Request.Context(), userID, teamID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	if runs == nil {
		runs = []model.AgentTeamRun{}
	}
	OK(c, runs)
}

// GetRun GET /web/agent-teams/:id/runs/:run_id
func (h *AgentTeamHandler) GetRun(c *gin.Context) {
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	runID := c.Param("run_id")
	run, err := h.service.GetTeamRun(c.Request.Context(), userID, teamID, runID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, run)
}

// GetRunState GET /web/agent-teams/:id/runs/:run_id/state
func (h *AgentTeamHandler) GetRunState(c *gin.Context) {
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	runID := c.Param("run_id")
	state, err := h.service.GetTeamRunState(c.Request.Context(), userID, teamID, runID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, state)
}

// ListTeamTasks GET /web/agent-teams/:id/runs/:run_id/tasks
func (h *AgentTeamHandler) ListTeamTasks(c *gin.Context) {
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	runID := c.Param("run_id")
	tasks, err := h.service.ListTeamTasks(c.Request.Context(), userID, teamID, runID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, tasks)
}

// ListTeamEvents GET /web/agent-teams/:id/runs/:run_id/events
func (h *AgentTeamHandler) ListTeamEvents(c *gin.Context) {
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	runID := c.Param("run_id")
	events, err := h.service.ListTeamEvents(c.Request.Context(), userID, teamID, runID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, events)
}

// HandleRouteDecision POST /web/agent-teams/:id/runs/:run_id/route-decisions
func (h *AgentTeamHandler) HandleRouteDecision(c *gin.Context) {
	var req model.CoordinatorRouteDecision
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	runID := c.Param("run_id")
	assignment, err := h.service.HandleRouteDecision(c.Request.Context(), userID, teamID, runID, req)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, assignment)
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

// --- Assignment Handlers ---

// CreateAssignment POST /web/agent-teams/:id/runs/:run_id/assignments
func (h *AgentTeamHandler) CreateAssignment(c *gin.Context) {
	var req createAssignmentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	runID := c.Param("run_id")
	a, err := h.service.CreateAssignment(c.Request.Context(), userID, runID, req.FromMemberID, req.ToMemberID, req.Type, req.TaskPrompt, req.Context)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, a)
}

// DispatchAssignment POST /web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/dispatch
func (h *AgentTeamHandler) DispatchAssignment(c *gin.Context) {
	userID := c.GetString("user_id")
	assignmentID := c.Param("assignment_id")
	if err := h.service.DispatchAssignment(c.Request.Context(), userID, assignmentID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

// CompleteAssignment POST /web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/complete
func (h *AgentTeamHandler) CompleteAssignment(c *gin.Context) {
	var req completeAssignmentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	assignmentID := c.Param("assignment_id")
	if err := h.service.CompleteAssignment(c.Request.Context(), userID, assignmentID, req.Result); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

// FailAssignment POST /web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/fail
func (h *AgentTeamHandler) FailAssignment(c *gin.Context) {
	var req failAssignmentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	assignmentID := c.Param("assignment_id")
	if err := h.service.FailAssignment(c.Request.Context(), userID, assignmentID, req.Reason); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

// ListAssignments GET /web/agent-teams/:id/runs/:run_id/assignments
func (h *AgentTeamHandler) ListAssignments(c *gin.Context) {
	userID := c.GetString("user_id")
	runID := c.Param("run_id")
	as, err := h.service.ListAssignments(c.Request.Context(), userID, runID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	if as == nil {
		as = []model.AgentTeamAssignment{}
	}
	OK(c, as)
}
