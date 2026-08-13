package api

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/permission"
)

// Handler holds dependencies for HTTP and WebSocket handlers.
func (h *Handler) PostPermissionDecide(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		return
	}

	var req struct {
		RunID     string `json:"runId"`
		RequestID string `json:"requestId"`
		Decision  string `json:"decision"`
		Reason    string `json:"reason,omitempty"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidJSON))
		return
	}
	req.RunID = strings.TrimSpace(req.RunID)
	req.RequestID = strings.TrimSpace(req.RequestID)
	req.Decision = strings.TrimSpace(req.Decision)
	if req.RunID == "" {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrRunIDRequired))
		return
	}
	if req.RequestID == "" {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrRequestIDRequired))
		return
	}
	if req.Decision != "allow" && req.Decision != "deny" {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidDecision))
		return
	}

	registry := h.ensurePermissionRegistry()
	permission, ok := pendingPermissionFromBroker(h.ensurePermissionBroker(), req.RunID, req.RequestID, req.Decision, req.Reason)
	if ok {
		_, _ = registry.Consume(req.RunID, req.RequestID)
	} else {
		permission, ok = registry.Consume(req.RunID, req.RequestID)
		if !ok {
			writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrPermissionRequestNotFound))
			return
		}
	}

	scope := map[string]any{"runId": permission.RunID}
	if permission.ProjectID != "" {
		scope["projectId"] = permission.ProjectID
	}
	if permission.ThreadID != "" {
		scope["threadId"] = permission.ThreadID
	}
	ensureBus(h).Publish(adapters.BusEventPermissionDecided, scope, map[string]any{
		"runId":     req.RunID,
		"requestId": req.RequestID,
		"toolName":  permission.ToolName,
		"toolUseId": permission.ToolUseID,
		"decision":  req.Decision,
		"reason":    req.Reason,
	})

	slog.Info("permission decided by Desktop", "requestId", req.RequestID, "decision", req.Decision)
	writeSuccess(w, http.StatusOK, map[string]any{"status": "ok"})
}

func pendingPermissionFromBroker(broker *adapters.PermissionDecisionBroker, runID, requestID, decision, reason string) (permission.PendingPermission, bool) {
	pending, ok := broker.Decide(runID, requestID, adapters.PermissionDecision{
		Behavior: decision,
		Message:  reason,
	})
	if !ok {
		return permission.PendingPermission{}, false
	}
	return permission.PendingPermission{
		ProjectID: pending.ProjectID,
		ThreadID:  pending.ThreadID,
		RunID:     pending.RunID,
		RequestID: pending.RequestID,
		ToolName:  pending.ToolName,
		ToolUseID: pending.ToolUseID,
	}, true
}

// ---------------------------------------------------------------------------
// POST /v1/plans/decide  (Plan confirmation gate - P0 #3)
// ---------------------------------------------------------------------------

func (h *Handler) PostPlanDecide(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		return
	}

	var req struct {
		RunID    string `json:"runId"`
		Decision string `json:"decision"` // "approve" or "reject"
		Reason   string `json:"reason,omitempty"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidJSON))
		return
	}
	req.RunID = strings.TrimSpace(req.RunID)
	req.Decision = strings.TrimSpace(req.Decision)
	if req.RunID == "" {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrRunIDRequired))
		return
	}
	if req.Decision != "approve" && req.Decision != "reject" {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidPlanDecision))
		return
	}

	broker := h.PlanApprovalBroker
	if broker == nil {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrPlanNotFound))
		return
	}

	approved := req.Decision == "approve"
	_, ok := broker.Decide(req.RunID, adapters.PlanDecision{
		Approved: approved,
		Reason:   req.Reason,
	})
	if !ok {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrPlanNotFound))
		return
	}

	// Note: the plan_approved/plan_rejected event is emitted by the
	// dispatchInterceptor in awaitPlanApproval after the broker decision
	// resolves. We do not emit a duplicate here.

	slog.Info("plan decided by user", "runId", req.RunID, "decision", req.Decision)
	writeSuccess(w, http.StatusOK, map[string]any{"status": "ok"})
}

// ---------------------------------------------------------------------------
// GET /v1/plans/pending  (Plan confirmation gate - P0 #3)
// ---------------------------------------------------------------------------

func (h *Handler) GetPlansPending(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		return
	}

	broker := h.PlanApprovalBroker
	if broker == nil {
		writeSuccess(w, http.StatusOK, []any{})
		return
	}

	plans := broker.ListPending()
	writeSuccess(w, http.StatusOK, plans)
}

// ---------------------------------------------------------------------------
// GET /v1/agent-instances
// ---------------------------------------------------------------------------

// GetAgentInstances returns all registered agent instances from the runtime registry.
