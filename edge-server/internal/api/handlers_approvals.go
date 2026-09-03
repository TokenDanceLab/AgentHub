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
		errcode.Write(w, errcode.ErrMethodNotAllowed)
		return
	}

	var req struct {
		RunID     string `json:"runId"`
		RequestID string `json:"requestId"`
		Decision  string `json:"decision"`
		Reason    string `json:"reason,omitempty"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		errcode.Write(w, errcode.ErrInvalidJSON)
		return
	}
	req.RunID = strings.TrimSpace(req.RunID)
	req.RequestID = strings.TrimSpace(req.RequestID)
	req.Decision = strings.TrimSpace(req.Decision)
	if req.RunID == "" {
		errcode.Write(w, errcode.ErrRunIDRequired)
		return
	}
	if req.RequestID == "" {
		errcode.Write(w, errcode.ErrRequestIDRequired)
		return
	}
	if req.Decision != "allow" && req.Decision != "deny" {
		errcode.Write(w, errcode.ErrInvalidDecision)
		return
	}

	// Ownership gate, resolved before any state change (broker decide / registry
	// consume / event publish): without it any caller past the Edge's coarse auth
	// could allow or deny a live tool call of somebody else's run, i.e. make the
	// victim's agent perform the call. The 404 body is byte-identical to the
	// "no such request" path below (same errcode, no distinguishing message) so a
	// foreign runId and a nonexistent runId stay indistinguishable — this endpoint
	// must not become a runId existence oracle. Local single-tenant mode resolves
	// to the documented bypass sentinel and is unaffected; an empty principal under
	// Hub JWT fails closed (AH-SR-045).
	if !isRunOwnedBy(ensureStore(h), req.RunID, h.ownerUserID(r)) {
		errcode.Write(w, errcode.ErrPermissionRequestNotFound)
		return
	}

	registry := h.ensurePermissionRegistry()
	permission, ok := pendingPermissionFromBroker(h.ensurePermissionBroker(), req.RunID, req.RequestID, req.Decision, req.Reason)
	if ok {
		_, _ = registry.Consume(req.RunID, req.RequestID)
	} else {
		permission, ok = registry.Consume(req.RunID, req.RequestID)
		if !ok {
			errcode.Write(w, errcode.ErrPermissionRequestNotFound)
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
		errcode.Write(w, errcode.ErrMethodNotAllowed)
		return
	}

	var req struct {
		RunID    string `json:"runId"`
		Decision string `json:"decision"` // "approve" or "reject"
		Reason   string `json:"reason,omitempty"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		errcode.Write(w, errcode.ErrInvalidJSON)
		return
	}
	req.RunID = strings.TrimSpace(req.RunID)
	req.Decision = strings.TrimSpace(req.Decision)
	if req.RunID == "" {
		errcode.Write(w, errcode.ErrRunIDRequired)
		return
	}
	if req.Decision != "approve" && req.Decision != "reject" {
		errcode.Write(w, errcode.ErrInvalidPlanDecision)
		return
	}

	// Ownership gate, resolved before broker.Decide mutates the pending plan:
	// approving or rejecting a plan drives the victim's agent dispatches, so a
	// non-owner must never reach the broker. The 404 body is byte-identical to the
	// "no pending plan" paths below (same errcode, no distinguishing message) so a
	// foreign runId and a nonexistent runId stay indistinguishable. Local
	// single-tenant mode is unaffected; an empty principal fails closed.
	if !isRunOwnedBy(ensureStore(h), req.RunID, h.ownerUserID(r)) {
		errcode.Write(w, errcode.ErrPlanNotFound)
		return
	}

	broker := h.PlanApprovalBroker
	if broker == nil {
		errcode.Write(w, errcode.ErrPlanNotFound)
		return
	}

	approved := req.Decision == "approve"
	_, ok := broker.Decide(req.RunID, adapters.PlanDecision{
		Approved: approved,
		Reason:   req.Reason,
	})
	if !ok {
		errcode.Write(w, errcode.ErrPlanNotFound)
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
		errcode.Write(w, errcode.ErrMethodNotAllowed)
		return
	}

	broker := h.PlanApprovalBroker
	if broker == nil {
		writeSuccess(w, http.StatusOK, []any{})
		return
	}

	// List endpoints filter instead of rejecting (same shape as GetArtifacts /
	// GetPreviews / GetDeliveryJournal): a Hub user sees only the plans of runs
	// they own, the local single-tenant sentinel sees all of them, and an empty
	// principal under Hub JWT sees an empty list (fail closed, AH-SR-045). A 404
	// here would be a behaviour regression for the Desktop poller.
	plans := filterPendingPlansByOwner(broker.ListPending(), ensureStore(h), h.ownerUserID(r))
	writeSuccess(w, http.StatusOK, plans)
}

// ---------------------------------------------------------------------------
// GET /v1/agent-instances
// ---------------------------------------------------------------------------

// GetAgentInstances returns all registered agent instances from the runtime registry.
