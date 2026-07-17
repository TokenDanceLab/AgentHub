package api

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/runners"
)

// Handler holds dependencies for HTTP and WebSocket handlers.
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	// Settings are Edge-local shared config with no per-user owner binding.
	// Hub JWT / multi-user remote reads fail closed (AH-SR-045); local single-tenant keeps access.
	if h.denyRemoteHubSharedConfig(w, r) {
		return
	}
	settings := ensureStore(h).GetSettings()
	writeSuccess(w, http.StatusOK, settings)
}

func (h *Handler) PatchSettings(w http.ResponseWriter, r *http.Request) {
	var patch map[string]string
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage("invalid json body")))
		return
	}
	if len(patch) == 0 {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage("empty patch")))
		return
	}
	settings := ensureStore(h).UpsertSettings(patch)
	writeSuccess(w, http.StatusOK, settings)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("failed to write json response", "error", err)
	}
}

// writeSuccess writes a unified success envelope: {"code":"OK","data":...}
// This aligns Edge Server success responses with the Hub Server format.
func writeSuccess(w http.ResponseWriter, status int, data any) {
	writeJSON(w, status, map[string]any{
		"code": "OK",
		"data": data,
	})
}

// ---------------------------------------------------------------------------
// genID generates random IDs with a given prefix.
// ---------------------------------------------------------------------------

func genID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s%016x", prefix, b)
}

// ---------------------------------------------------------------------------
// GET /v1/health
// ---------------------------------------------------------------------------

func (h *Handler) GetHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		return
	}
	status := "ok"
	checks := map[string]any{}

	// Verify store is readable
	repository := ensureStore(h)
	if len(repository.ListProjects()) == 0 {
		checks["store"] = map[string]any{"status": "degraded", "detail": "no projects found"}
	} else {
		checks["store"] = map[string]any{"status": "ok"}
	}

	checks["runners"] = runnerHealthCheck(h.Registry)

	// Verify adapter registry (optional)
	if h.AdapterRegistry != nil {
		if len(h.AdapterRegistry.List()) == 0 {
			checks["adapters"] = map[string]any{"status": "degraded", "detail": "no adapters registered"}
		} else {
			checks["adapters"] = map[string]any{"status": "ok"}
		}
	}

	// Verify executor
	if h.Executor == nil {
		checks["executor"] = map[string]any{"status": "degraded", "detail": "no executor configured"}
		status = "degraded"
	} else {
		checks["executor"] = map[string]any{"status": "ok"}
	}

	// Aggregate: overall is degraded if any check is degraded
	for _, v := range checks {
		if c, ok := v.(map[string]any); ok && c["status"] == "degraded" {
			if status == "ok" {
				status = "degraded"
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":  status,
		"version": "v1",
		"edgeId":  "local",
		"checks":  checks,
	})
}

// ---------------------------------------------------------------------------
// GET /v1/runners
// ---------------------------------------------------------------------------

func (h *Handler) GetRunners(w http.ResponseWriter, r *http.Request) {
	list := h.Registry.List()
	writeSuccess(w, http.StatusOK, listResponse(list))
}

func runnerHealthCheck(registry *runners.Registry) map[string]any {
	check := map[string]any{
		"status":      "degraded",
		"total":       0,
		"available":   0,
		"unavailable": 0,
		"statuses":    map[string]int{},
		"items":       []map[string]any{},
	}
	if registry == nil {
		check["detail"] = "no runner registry configured"
		return check
	}

	list := registry.List()
	sort.SliceStable(list, func(i, j int) bool {
		return list[i].ID < list[j].ID
	})

	statuses := map[string]int{}
	items := make([]map[string]any, 0, len(list))
	available := 0
	unavailable := 0
	for _, runner := range list {
		status := normalizeRunnerStatus(runner.Status)
		statuses[status]++
		if isAvailableRunnerStatus(status) {
			available++
		} else {
			unavailable++
		}
		items = append(items, map[string]any{
			"id":           runner.ID,
			"name":         runner.Name,
			"status":       status,
			"capabilities": append([]string(nil), runner.Capabilities...),
		})
	}

	check["total"] = len(list)
	check["available"] = available
	check["unavailable"] = unavailable
	check["statuses"] = statuses
	check["items"] = items
	if len(list) == 0 {
		check["detail"] = "no runners registered"
		return check
	}
	if available == 0 {
		check["detail"] = "no available runners"
		return check
	}
	check["status"] = "ok"
	return check
}

func normalizeRunnerStatus(status string) string {
	status = strings.ToLower(strings.TrimSpace(status))
	if status == "" {
		return "unknown"
	}
	return status
}

func isAvailableRunnerStatus(status string) bool {
	switch status {
	case "available", "busy", "idle", "online", "ready", "running":
		return true
	default:
		return false
	}
}

// ---------------------------------------------------------------------------
// Project / Thread / Item local data APIs
// ---------------------------------------------------------------------------
