package handler

import (
	"errors"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// --- Team CRUD handlers ---

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
		var e *errcode.Error
		if errors.As(err, &e) {
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
		var e *errcode.Error
		if errors.As(err, &e) {
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
		var e *errcode.Error
		if errors.As(err, &e) {
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
	if err := checkTeamAccess(c, h.db, c.Param("id"), TeamRoleOwner); err != nil {
		return
	}
	var req updateTeamReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	if err := h.service.UpdateTeam(c.Request.Context(), userID, teamID, req.Name, req.Description); err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
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
	if err := checkTeamAccess(c, h.db, c.Param("id"), TeamRoleOwner); err != nil {
		return
	}
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	if err := h.service.DeleteTeam(c.Request.Context(), userID, teamID); err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
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
	if err := checkTeamAccess(c, h.db, c.Param("id"), TeamRoleOwner); err != nil {
		return
	}
	var req addMemberReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	if err := h.service.AddTeamMember(c.Request.Context(), userID, teamID, req.AgentProfileID, req.Role); err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
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
	if err := checkTeamAccess(c, h.db, c.Param("id"), TeamRoleOwner); err != nil {
		return
	}
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	memberID := c.Param("member_id")
	if err := h.service.RemoveTeamMember(c.Request.Context(), userID, teamID, memberID); err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}
