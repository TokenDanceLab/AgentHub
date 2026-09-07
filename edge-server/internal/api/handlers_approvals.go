package api

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/permission"
)

// permissionDecideRequest is the POST /v1/permissions/decide payload. controlId
// and hubTaskId are optional together: when either is present both are required,
// and the request is modern and idempotent; when both are absent the existing
// one-shot receiver semantics are unchanged.
type permissionDecideRequest struct {
	ControlID string `json:"controlId"`
	HubTaskID string `json:"hubTaskId"`
	RunID     string `json:"runId"`
	RequestID string `json:"requestId"`
	Decision  string `json:"decision"`
	Reason    string `json:"reason,omitempty"`
}

func (h *Handler) PostPermissionDecide(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errcode.Write(w, errcode.ErrMethodNotAllowed)
		return
	}

	var req permissionDecideRequest
	if err := decodeOptionalJSON(r, &req); err != nil {
		errcode.Write(w, errcode.ErrInvalidJSON)
		return
	}
	req.RunID = strings.TrimSpace(req.RunID)
	req.RequestID = strings.TrimSpace(req.RequestID)
	req.Decision = strings.TrimSpace(req.Decision)
	req.ControlID = strings.TrimSpace(req.ControlID)
	req.HubTaskID = strings.TrimSpace(req.HubTaskID)
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
	if (req.ControlID == "") != (req.HubTaskID == "") {
		errcode.Write(w, errcode.ErrBadRequest.WithMessage("controlId and hubTaskId must be provided together"))
		return
	}

	// Ownership and task binding are resolved before any state change:
	// broker decide, registry consume, event publish, and receipt storage all
	// happen only for the real run owner and the exact stored Hub task. The
	// 404 body is byte-identical for a foreign runId, a missing runId, a
	// wrong hubTaskId, and a missing pending request so this endpoint is not an
	// existence oracle. Local single-tenant mode resolves to the documented
	// bypass sentinel; empty principal under Hub JWT fails closed (AH-SR-045).
	repo := ensureStore(h)
	owner := h.ownerUserID(r)
	if !isRunOwnedBy(repo, req.RunID, owner) {
		errcode.Write(w, errcode.ErrPermissionRequestNotFound)
		return
	}
	if req.ControlID != "" {
		run, ok := repo.GetRun(req.RunID)
		if !ok || run.HubTaskID != req.HubTaskID {
			errcode.Write(w, errcode.ErrPermissionRequestNotFound)
			return
		}
	}

	registry := h.ensurePermissionRegistry()
	if req.ControlID == "" {
		h.decideLegacyPermission(w, registry, req)
		return
	}
	h.decideModernPermission(w, registry, req)
}

func (h *Handler) decideLegacyPermission(w http.ResponseWriter, registry *permission.PermissionRegistry, req permissionDecideRequest) {
	pending, ok := h.resolvePendingPermission(registry, req)
	if !ok {
		errcode.Write(w, errcode.ErrPermissionRequestNotFound)
		return
	}
	h.publishPermissionDecision(pending, req)
	slog.Info("permission decided by Desktop", "requestId", req.RequestID, "decision", req.Decision)
	writeSuccess(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (h *Handler) decideModernPermission(w http.ResponseWriter, registry *permission.PermissionRegistry, req permissionDecideRequest) {
	receipt := permissionReceipt{
		ControlID: req.ControlID,
		HubTaskID: req.HubTaskID,
		RunID:     req.RunID,
		RequestID: req.RequestID,
		Decision:  req.Decision,
		Reason:    req.Reason,
	}
	result := h.ensurePermissionReceipts().apply(receipt, func() bool {
		pending, ok := h.resolvePendingPermission(registry, req)
		if !ok {
			return false
		}
		h.publishPermissionDecision(pending, req)
		return true
	})
	switch {
	case result.Conflict:
		errcode.Write(w, errcode.ErrConflict.WithMessage("permission decision conflict"))
		return
	case result.Full:
		errcode.Write(w, errcode.ErrTooManyRequests.WithMessage("permission decision receipt cache is full"))
		return
	case !result.Applied:
		errcode.Write(w, errcode.ErrPermissionRequestNotFound)
		return
	}
	slog.Info("permission decision applied by Desktop", "requestId", req.RequestID, "controlId", req.ControlID, "decision", req.Decision)
	writeSuccess(w, http.StatusOK, map[string]any{
		"status":       "ok",
		"controlId":    result.Receipt.ControlID,
		"hubTaskId":    result.Receipt.HubTaskID,
		"runId":        result.Receipt.RunID,
		"requestId":    result.Receipt.RequestID,
		"decision":     result.Receipt.Decision,
		"applied":      true,
		"deduplicated": result.Deduplicated,
	})
}

func (h *Handler) resolvePendingPermission(registry *permission.PermissionRegistry, req permissionDecideRequest) (permission.PendingPermission, bool) {
	pending, ok := pendingPermissionFromBroker(h.ensurePermissionBroker(), req.RunID, req.RequestID, req.Decision, req.Reason)
	if ok {
		_, _ = registry.Consume(req.RunID, req.RequestID)
		return pending, true
	}
	return registry.Consume(req.RunID, req.RequestID)
}

func (h *Handler) publishPermissionDecision(pending permission.PendingPermission, req permissionDecideRequest) {
	scope := map[string]any{"runId": pending.RunID}
	if pending.ProjectID != "" {
		scope["projectId"] = pending.ProjectID
	}
	if pending.ThreadID != "" {
		scope["threadId"] = pending.ThreadID
	}
	ensureBus(h).Publish(adapters.BusEventPermissionDecided, scope, map[string]any{
		"runId":     req.RunID,
		"requestId": req.RequestID,
		"toolName":  pending.ToolName,
		"toolUseId": pending.ToolUseID,
		"decision":  req.Decision,
		"reason":    req.Reason,
	})
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
