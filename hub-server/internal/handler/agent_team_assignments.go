package handler

import (
	"errors"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// --- Assignment handlers ---

// CreateAssignment POST /web/agent-teams/:id/runs/:run_id/assignments
func (h *AgentTeamHandler) CreateAssignment(c *gin.Context) {
	if err := resolveTeamIDFromRun(c, h.db, c.Param("run_id"), TeamRoleMember); err != nil {
		return
	}
	var req createAssignmentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	runID := c.Param("run_id")
	a, err := h.service.CreateAssignment(c.Request.Context(), userID, runID, req.FromMemberID, req.ToMemberID, req.Type, req.TaskPrompt, req.Context)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
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
	if err := resolveTeamIDFromAssignment(c, h.db, c.Param("assignment_id"), TeamRoleMember); err != nil {
		return
	}
	userID := c.GetString("user_id")
	assignmentID := c.Param("assignment_id")
	if err := h.service.DispatchAssignment(c.Request.Context(), userID, assignmentID); err != nil {
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

// CompleteAssignment POST /web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/complete
func (h *AgentTeamHandler) CompleteAssignment(c *gin.Context) {
	if err := resolveTeamIDFromAssignment(c, h.db, c.Param("assignment_id"), TeamRoleMember); err != nil {
		return
	}
	var req completeAssignmentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	assignmentID := c.Param("assignment_id")
	if err := h.service.CompleteAssignment(c.Request.Context(), userID, assignmentID, req.Result); err != nil {
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

// FailAssignment POST /web/agent-teams/:id/runs/:run_id/assignments/:assignment_id/fail
func (h *AgentTeamHandler) FailAssignment(c *gin.Context) {
	if err := resolveTeamIDFromAssignment(c, h.db, c.Param("assignment_id"), TeamRoleMember); err != nil {
		return
	}
	var req failAssignmentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	assignmentID := c.Param("assignment_id")
	if err := h.service.FailAssignment(c.Request.Context(), userID, assignmentID, req.Reason); err != nil {
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

// ListAssignments GET /web/agent-teams/:id/runs/:run_id/assignments
func (h *AgentTeamHandler) ListAssignments(c *gin.Context) {
	userID := c.GetString("user_id")
	runID := c.Param("run_id")
	as, err := h.service.ListAssignments(c.Request.Context(), userID, runID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
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

// ResolveConflict POST /web/agent-teams/:id/runs/:run_id/conflicts/:conflict_id/resolve
func (h *AgentTeamHandler) ResolveConflict(c *gin.Context) {
	if err := checkTeamAccess(c, h.db, c.Param("id"), TeamRoleOwner); err != nil {
		return
	}
	var req resolveConflictReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	runID := c.Param("run_id")
	conflict, err := h.service.ResolveConflict(c.Request.Context(), userID, teamID, runID, model.TeamConflictResolution{
		ConflictID:          c.Param("conflict_id"),
		Path:                req.Path,
		Resolution:          req.Resolution,
		SelectedAgentTaskID: req.SelectedAgentTaskID,
		Reason:              req.Reason,
	})
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, conflict)
}

// DecideApproval POST /web/agent-teams/:id/runs/:run_id/approvals/:approval_id/decide
func (h *AgentTeamHandler) DecideApproval(c *gin.Context) {
	if err := checkTeamAccess(c, h.db, c.Param("id"), TeamRoleOwner); err != nil {
		return
	}
	var req decideApprovalReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	teamID := c.Param("id")
	runID := c.Param("run_id")
	approval, err := h.service.DecideApproval(c.Request.Context(), userID, teamID, runID, c.Param("approval_id"), model.TeamApprovalDecision{
		Decision: req.Decision,
		Reason:   req.Reason,
	})
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, approval)
}
