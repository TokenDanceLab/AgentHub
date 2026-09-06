package api

import (
	"log/slog"
	"net/http"

	"github.com/agenthub/edge-server/internal/deliverydedup"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/store"
)

// beginRunDelivery runs only after request capability validation. A successful
// replay is a receipt for the original run, never an assertion that a process
// is still running or that a rejected request was accepted.
func (h *Handler) beginRunDelivery(w http.ResponseWriter, r *http.Request, req runRequest, repository store.Repository) (*deliverydedup.Claim, bool) {
	if h.DeliveryDedup == nil || req.DeliveryID == "" {
		return nil, false
	}
	admission := h.DeliveryDedup.Begin(req.DeliveryID, deliverydedup.Scope{
		HubTaskID: req.HubTaskID,
		ProjectID: req.ProjectID,
		ThreadID:  req.ThreadID,
	})
	switch admission.State {
	case deliverydedup.Claimed:
		return admission.Claim, false
	case deliverydedup.Busy:
		w.Header().Set("Retry-After", "1")
		errcode.Write(w, errcode.ErrDeliveryBusy)
	case deliverydedup.Conflict:
		errcode.Write(w, errcode.ErrDeliveryConflict)
	case deliverydedup.Accepted:
		run, ok := repository.GetRun(admission.RunID)
		if !ok {
			// Retention/deletion must not turn an old receipt into new execution.
			errcode.Write(w, errcode.ErrNotFound.WithMessage("accepted run is no longer available"))
			return nil, true
		}
		// HTTP and Desktop can use different local thread representations for
		// the same Hub task. Authorize the actual stored scope too: a capability
		// for the incoming representation must not expose a different resource.
		if err := h.validateRunReplay(r, req, run); err != nil {
			errcode.Write(w, err)
			return nil, true
		}
		slog.Info("run.create.dedup", "deliveryId", req.DeliveryID, "hubTaskId", req.HubTaskID, "runId", run.ID, "result", "accepted_replay")
		data := runToResponse(run)
		data["deduplicated"] = true
		data["deliveryId"] = req.DeliveryID
		writeSuccess(w, http.StatusAccepted, acceptedResponse(data))
	default:
		w.Header().Set("Retry-After", "1")
		errcode.Write(w, errcode.ErrDeliveryBusy)
	}
	return nil, true
}

// Cached and durable Hub-task receipts must authorize the actual stored run,
// not only the incoming transport's representation of its scope.
func (h *Handler) validateRunReplay(r *http.Request, req runRequest, run store.Run) *errcode.Error {
	req.ProjectID = run.ProjectID
	req.ThreadID = run.ThreadID
	return h.validateCapabilityRequest(r, &req)
}
