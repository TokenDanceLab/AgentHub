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
	ListTeamRuns(ctx context.Context, userID, teamID string) ([]model.AgentTeamRun, error)
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
