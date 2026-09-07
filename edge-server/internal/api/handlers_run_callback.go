package api

import (
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/store"
)

func (h *Handler) directHubCallbacksConfigured() bool {
	configured, ok := h.CallbackClient.(interface{ Configured() bool })
	return ok && configured.Configured()
}

func (h *Handler) resolveRunCallbackOwner(req *runRequest) *errcode.Error {
	switch req.CallbackOwner {
	case "", "edge", "desktop":
	default:
		return errcode.ErrBadRequest.WithMessage("callbackOwner must be edge or desktop")
	}
	if req.HubTaskID == "" {
		if req.CallbackOwner != "" {
			return errcode.ErrBadRequest.WithMessage("callbackOwner requires hubTaskId")
		}
		return nil
	}
	// Every new Hub run records one owner. Modern transports send it explicitly.
	if req.CallbackOwner == "" {
		req.CallbackOwner = "desktop"
		if h.directHubCallbacksConfigured() {
			req.CallbackOwner = "edge"
		}
	}
	return nil
}

func (h *Handler) validateCallbackAdmission(req runRequest) *errcode.Error {
	if req.CallbackOwner == "edge" && !h.directHubCallbacksConfigured() {
		return errcode.ErrCallbackUnavailable
	}
	return nil
}

// Never guess legacy ownership during replay: it could leave no output owner
// or produce two independent reporters for the same execution.
func validateReplayCallbackOwner(req runRequest, run store.Run) *errcode.Error {
	if req.CallbackOwner != "" && run.CallbackOwner != "edge" && run.CallbackOwner != "desktop" {
		return errcode.ErrAdmissionUncertain.WithMessagef("callback ownership for run %s requires reconciliation", run.ID)
	}
	return nil
}

func (h *Handler) runCallbackCapabilities() map[string]bool {
	return map[string]bool{
		"runCallbackOwnership": true,
		"directHubCallbacks":   h.directHubCallbacksConfigured(),
	}
}
