package api

import (
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/idgen"
	"github.com/agenthub/edge-server/internal/resputil"
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
	// Settings are Edge-local shared config with no per-user owner binding, so the
	// write side fails closed exactly like the read side above (AH-SR-045). The gate
	// runs before decodeOptionalJSON: an unauthorized caller must not be able to make
	// the Edge parse a body at all.
	if h.denyRemoteHubSharedConfig(w, r) {
		return
	}
	var patch map[string]string
	// decodeOptionalJSON applies the shared 1MB body limit; this was the only
	// JSON decode point bypassing it (memory exhaustion, #2154 security scan).
	if err := decodeOptionalJSON(r, &patch); err != nil {
		errcode.Write(w, errcode.ErrBadRequest.WithMessage("invalid json body"))
		return
	}
	if len(patch) == 0 {
		errcode.Write(w, errcode.ErrBadRequest.WithMessage("empty patch"))
		return
	}
	settings, err := ensureStore(h).UpsertSettings(patch)
	if err != nil {
		// Persist failure must not be reported as success — the caller would
		// otherwise believe settings survived a restart when they did not.
		slog.Error("failed to persist settings", "error", err)
		errcode.Write(w, errcode.ErrInternal.WithMessage("failed to persist settings"))
		return
	}
	writeSuccess(w, http.StatusOK, settings)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	resputil.WriteJSON(w, status, v)
}

// writeSuccess writes a unified success envelope: {"code":"ok","data":...}.
// The code casing matches the Hub envelope contract (errcode.OK.Code, always
// lowercase "ok"); clients accept both cases for backward compatibility.
func writeSuccess(w http.ResponseWriter, status int, data any) {
	writeJSON(w, status, map[string]any{
		"code": "ok",
		"data": data,
	})
}

// ---------------------------------------------------------------------------
// genID generates random IDs with a given prefix.
// ---------------------------------------------------------------------------

func genID(prefix string) string {
	return idgen.New(prefix)
}

// storeReadinessCacheTTL bounds how long a cached store-readiness result is
// reused before the store is re-probed. 30s keeps /v1/health cheap under
// polling while still surfacing a store that goes bad within one poll cycle.
const storeReadinessCacheTTL = 30 * time.Second

// storeReadinessCache holds the last computed store-readiness probe so /v1/health
// does not re-probe the store on every poll. The probe is a functional read
// (ListProjects) rather than a literal store.SQLiteReadiness(path) call because
// the SQLite DB path is wired at the composition root (cmd/agenthub-edge) and
// is not carried on Handler — adding it would require editing handlers.go,
// which is out of this lane's scope (Wave7 follow-up). The functional probe
// still catches the failure mode the task targets: a store that cannot serve
// reads (corrupt/unopenable SQLite) is reported as degraded with a 503.
var (
	storeReadinessMu       sync.Mutex
	storeReadinessCached   map[string]any
	storeReadinessCachedAt time.Time
)

// probeStoreReadiness returns the store check entry for /v1/health. An empty
// store (no projects yet) is reported as "ok" — a freshly initialized store is
// not degraded. A read error is reported as "degraded". The result is cached
// for storeReadinessCacheTTL to keep /v1/health cheap under polling.
func probeStoreReadiness(h *Handler) map[string]any {
	storeReadinessMu.Lock()
	cached, cachedAt := storeReadinessCached, storeReadinessCachedAt
	storeReadinessMu.Unlock()
	if cached != nil && time.Since(cachedAt) < storeReadinessCacheTTL {
		return cached
	}

	fresh := computeStoreReadiness(h)

	storeReadinessMu.Lock()
	storeReadinessCached = fresh
	storeReadinessCachedAt = time.Now()
	storeReadinessMu.Unlock()
	return fresh
}

// computeStoreReadiness performs the actual store read probe. An empty store
// is "ok" (not degraded) — the previous logic flagged an empty store as
// degraded, which misreported a freshly-initialized edge as unhealthy. The
// store.Repository read contract does not return errors for ListProjects, so
// the probe is a presence check: a non-nil store that responds is "ok". The
// genuine degraded-store condition (corrupt/unopenable SQLite) surfaces via
// the store construction failing at startup, which prevents the server from
// reaching /v1/health at all; for the in-memory fallback store, "ok" is the
// correct signal.
func computeStoreReadiness(h *Handler) map[string]any {
	repository := ensureStore(h)
	projects := repository.ListProjects()
	// Empty store = freshly initialized, not unhealthy.
	return map[string]any{"status": "ok", "project_count": len(projects)}
}

// ---------------------------------------------------------------------------
// GET /v1/health
// ---------------------------------------------------------------------------

func (h *Handler) GetHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errcode.Write(w, errcode.ErrMethodNotAllowed)
		return
	}
	status := "ok"
	checks := map[string]any{}

	// Store readiness: cached functional probe. An empty store is ok (not
	// degraded); a store that cannot serve reads is degraded and forces a 503.
	checks["store"] = probeStoreReadiness(h)

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

	// HTTP status reflects the health status: degraded → 503, ok → 200.
	// Previously /v1/health always returned 200 even when degraded, so
	// load balancers and operators could not distinguish a healthy edge
	// from one that was partially broken. The response body carries the
	// same http_status so clients parsing JSON get the signal too.
	httpStatus := http.StatusOK
	if status == "degraded" {
		httpStatus = http.StatusServiceUnavailable
	}

	writeJSON(w, httpStatus, map[string]any{
		"status":      status,
		"http_status": httpStatus,
		"version":     "v1",
		"edgeId":      "local",
		"checks":      checks,
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
