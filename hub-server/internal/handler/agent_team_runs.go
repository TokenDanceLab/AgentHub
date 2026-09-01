package handler

import (
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// --- Team Run handlers ---

// StartRun POST /web/agent-teams/:id/runs
func (h *AgentTeamHandler) StartRun(c *gin.Context) {
	var req startRunReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	run, err := h.service.StartTeamRun(c.Request.Context(), userID, teamID, req.TriggerMessage, req.TargetID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
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
		var e *errcode.Error
		if errors.As(err, &e) {
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
		var e *errcode.Error
		if errors.As(err, &e) {
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
		var e *errcode.Error
		if errors.As(err, &e) {
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
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, tasks)
}

// ListTeamEvents GET /web/agent-teams/:id/runs/:run_id/events
// Cursor pagination (#2154 perf lane): afterSeq is the seq of the last seen
// event; the response page.nextCursor carries the seq to pass next.
func (h *AgentTeamHandler) ListTeamEvents(c *gin.Context) {
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	runID := c.Param("run_id")

	afterSeq, _ := strconv.Atoi(c.DefaultQuery("afterSeq", "0"))
	if afterSeq < 0 {
		afterSeq = 0
	}
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", strconv.Itoa(config.DefaultPaginationLimit)))
	if pageSize <= 0 {
		pageSize = config.DefaultPaginationLimit
	}
	if pageSize > config.MaxPageLimit {
		pageSize = config.MaxPageLimit
	}

	page, err := h.service.ListTeamEvents(c.Request.Context(), userID, teamID, runID, afterSeq, pageSize)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, gin.H{
		"items": page.Items,
		"page":  gin.H{"nextCursor": strconv.Itoa(page.NextSeq), "hasMore": page.HasMore},
	})
}

// HandleRouteDecision POST /web/agent-teams/:id/runs/:run_id/route-decisions
func (h *AgentTeamHandler) HandleRouteDecision(c *gin.Context) {
	if err := checkTeamAccess(c, h.service, c.Param("id"), TeamRoleOwner); err != nil {
		return
	}
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
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, assignment)
}

// --- Client endpoint handlers ---

// CompeteSummary POST /client/team-runs/:id/compete-summary
func (h *AgentTeamHandler) CompeteSummary(c *gin.Context) {
	var req model.CompeteSummaryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Allow empty body.
		req = model.CompeteSummaryRequest{}
	}
	userID := c.GetString("user_id")
	runID := c.Param("id")
	resp, err := h.service.GenerateCompeteSummary(c.Request.Context(), userID, runID, req)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, resp)
}

// ReviewDecision POST /client/team-runs/:id/review-decision
func (h *AgentTeamHandler) ReviewDecision(c *gin.Context) {
	if err := resolveTeamIDFromRun(c, h.service, c.Param("id"), TeamRoleMember); err != nil {
		return
	}
	var req model.HumanReviewDecision
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	runID := c.Param("id")
	state, err := h.service.ReviewDagPlan(c.Request.Context(), userID, runID, req)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, state)
}
