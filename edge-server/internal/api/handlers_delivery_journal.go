package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/agenthub/edge-server/internal/errcode"
)

// GetDeliveryJournal returns Edge->Hub callback journal entries for reconciliation (AH-SR-049).
// Query: afterSeq (uint64, default 0). Requires same auth as other Edge state APIs.
// Under Hub JWT, entries are filtered to runs owned by the caller (AH-SR-045).
func (h *Handler) GetDeliveryJournal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errcode.Write(w, errcode.ErrMethodNotAllowed)
		return
	}
	if h.CallbackClient == nil {
		errcode.Write(w, errcode.ErrNotConfigured.WithMessage("delivery journal not configured"))
		return
	}
	var afterSeq uint64
	if raw := strings.TrimSpace(r.URL.Query().Get("afterSeq")); raw != "" {
		v, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			errcode.Write(w, errcode.ErrBadRequest.WithMessage("invalid afterSeq"))
			return
		}
		afterSeq = v
	}
	entries, err := h.CallbackClient.DurableSnapshot(afterSeq)
	if err != nil {
		errcode.Write(w, errcode.ErrInternal.WithMessagef("journal snapshot: %v", err))
		return
	}
	userID := h.ownerUserID(r)
	repo := ensureStore(h)
	out := make([]map[string]any, 0, len(entries))
	for _, e := range entries {
		// Local single-tenant bypass sees all rows; empty userID fails closed.
		if !isLocalSingleTenant(userID) {
			if e.RunID == "" || !isRunOwnedBy(repo, e.RunID, userID) {
				continue
			}
		}
		out = append(out, map[string]any{
			"seq":         e.Seq,
			"task_id":     e.TaskID,
			"run_id":      e.RunID,
			"action":      e.Action,
			"ok":          e.OK,
			"error":       e.Error,
			"attempts":    e.Attempts,
			"recorded_at": e.RecordedAt,
		})
	}
	writeSuccess(w, http.StatusOK, map[string]any{
		"after_seq": afterSeq,
		"count":     len(out),
		"entries":   out,
	})
}
