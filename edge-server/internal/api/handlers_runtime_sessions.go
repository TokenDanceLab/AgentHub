package api

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/sessionindex"
)

// listRuntimeSessions is the discover function used by GET /v1/runtime-sessions.
// Overridable in tests; default scans the process home via env overrides.
var listRuntimeSessions = sessionindex.ListRecentFromEnv

// GetRuntimeSessions lists observed local Agent Runtime session summaries
// for Desktop import UI. Read-only; never mutates third-party stores.
//
// GET /v1/runtime-sessions?limit=50&runtime=claude-code,codex
func (h *Handler) GetRuntimeSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errcode.Write(w, errcode.ErrMethodNotAllowed)
		return
	}
	// Local filesystem index — shared machine surface; Hub multi-user fail closed.
	if h.denyRemoteHubSharedConfig(w, r) {
		return
	}

	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 500 {
			errcode.Write(w, errcode.ErrBadRequest.WithMessage("limit must be 1-500"))
			return
		}
		limit = n
	}

	var runtimes []sessionindex.RuntimeID
	if raw := strings.TrimSpace(r.URL.Query().Get("runtime")); raw != "" {
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			runtimes = append(runtimes, sessionindex.RuntimeID(part))
		}
	}

	items, err := listRuntimeSessions(limit, runtimes)
	if err != nil {
		slog.Error("runtime session list failed", "limit", limit, "error", err)
		errcode.Write(w, errcode.ErrInternal)
		return
	}
	if items == nil {
		items = []sessionindex.SessionSummary{}
	}
	writeSuccess(w, http.StatusOK, listResponse(items))
}
