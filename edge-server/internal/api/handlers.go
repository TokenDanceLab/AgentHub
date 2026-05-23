package api

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/security"
	"github.com/agenthub/edge-server/internal/store"
)

// Handler holds dependencies for HTTP and WebSocket handlers.
type Handler struct {
	Bus             *events.Bus
	Registry        *runners.Registry
	Store           store.Repository
	Executor        lifecycle.RunExecutor
	AdapterRegistry *adapters.Registry // nil if no agent adapters configured
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return security.IsTrustedLocalOrigin(r.Header.Get("Origin"))
	},
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

func listResponse(items any) map[string]any {
	return map[string]any{
		"items": items,
		"page": map[string]any{
			"hasMore": false,
		},
	}
}

func errorResponse(code, message string) map[string]any {
	return map[string]any{
		"error": map[string]any{
			"code":    code,
			"message": message,
			"traceId": genID("trace_"),
		},
	}
}

func ensureStore(h *Handler) store.Repository {
	if h.Store == nil {
		h.Store = store.New()
	}
	h.ensureDefaults()
	h.ensureExecutor()
	return h.Store
}

func (h *Handler) ensureDefaults() {
	if h.Store == nil {
		return
	}
	h.Store.CreateProject("proj_local", "Local Project")
	_, _ = h.Store.CreateThread("thread_local", "proj_local", "Local Thread")
}

func (h *Handler) ensureExecutor() {
	if h.Executor == nil && h.Bus != nil && h.Store != nil {
		h.Executor = lifecycle.NewMockExecutor(h.Bus, h.Store)
	}
}

func acceptedResponse(data map[string]any) map[string]any {
	return data
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("failed to write json response", "err", err)
	}
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
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("method_not_allowed", "method not allowed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"version": "v1",
		"edgeId":  "local",
	})
}

// ---------------------------------------------------------------------------
// GET /v1/runners
// ---------------------------------------------------------------------------

func (h *Handler) GetRunners(w http.ResponseWriter, r *http.Request) {
	list := h.Registry.List()
	writeJSON(w, http.StatusOK, listResponse(list))
}

// ---------------------------------------------------------------------------
// Project / Thread / Item local data APIs
// ---------------------------------------------------------------------------

func (h *Handler) GetProjects(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, listResponse(ensureStore(h).ListProjects()))
}

func (h *Handler) PostProjects(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProjectID string `json:"projectId"`
		Name      string `json:"name"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse("bad_request", "invalid json body"))
		return
	}
	if req.ProjectID == "" {
		req.ProjectID = genID("proj_")
	}
	project := ensureStore(h).CreateProject(req.ProjectID, req.Name)
	h.Bus.Publish("project.created", map[string]any{"projectId": project.ID}, project)
	writeJSON(w, http.StatusCreated, project)
}

func (h *Handler) GetProject(w http.ResponseWriter, r *http.Request) {
	projectID := strings.TrimPrefix(r.URL.Path, "/v1/projects/")
	if project, ok := ensureStore(h).GetProject(projectID); ok {
		writeJSON(w, http.StatusOK, project)
		return
	}
	writeJSON(w, http.StatusNotFound, errorResponse("not_found", "project not found"))
}

func (h *Handler) GetThreads(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("projectId")
	writeJSON(w, http.StatusOK, listResponse(ensureStore(h).ListThreads(projectID)))
}

func (h *Handler) PostThreads(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ThreadID  string `json:"threadId"`
		ProjectID string `json:"projectId"`
		Title     string `json:"title"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse("bad_request", "invalid json body"))
		return
	}
	if req.ProjectID == "" {
		req.ProjectID = "proj_local"
	}
	if req.ThreadID == "" {
		req.ThreadID = genID("thread_")
	}
	thread, err := ensureStore(h).CreateThread(req.ThreadID, req.ProjectID, req.Title)
	if err != nil {
		writeJSON(w, http.StatusNotFound, errorResponse("not_found", "project not found"))
		return
	}
	h.Bus.Publish("thread.created", map[string]any{
		"projectId": thread.ProjectID,
		"threadId":  thread.ID,
	}, thread)
	writeJSON(w, http.StatusCreated, thread)
}

func (h *Handler) GetThread(w http.ResponseWriter, r *http.Request) {
	threadID := strings.TrimPrefix(r.URL.Path, "/v1/threads/")
	if thread, ok := ensureStore(h).GetThread(threadID); ok {
		writeJSON(w, http.StatusOK, thread)
		return
	}
	writeJSON(w, http.StatusNotFound, errorResponse("not_found", "thread not found"))
}

func (h *Handler) GetThreadItems(w http.ResponseWriter, r *http.Request, threadID string) {
	repository := ensureStore(h)
	if _, ok := repository.GetThread(threadID); !ok {
		writeJSON(w, http.StatusNotFound, errorResponse("not_found", "thread not found"))
		return
	}
	writeJSON(w, http.StatusOK, listResponse(repository.ListThreadItems(threadID)))
}

func (h *Handler) PostThreadMessage(w http.ResponseWriter, r *http.Request, threadID string) {
	var req struct {
		Content string `json:"content"`
		Role    string `json:"role"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse("bad_request", "invalid json body"))
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse("bad_request", "content is required"))
		return
	}

	item, err := ensureStore(h).CreateThreadMessage(genID("item_"), threadID, req.Role, req.Content)
	if err != nil {
		writeJSON(w, http.StatusNotFound, errorResponse("not_found", "thread not found"))
		return
	}
	scope := map[string]any{
		"projectId": item.ProjectID,
		"threadId":  item.ThreadID,
		"itemId":    item.ID,
	}
	h.Bus.Publish("message.created", scope, item)
	h.Bus.Publish("item.created", scope, item)
	writeJSON(w, http.StatusCreated, item)
}

func (h *Handler) GetItem(w http.ResponseWriter, r *http.Request) {
	itemID := strings.TrimPrefix(r.URL.Path, "/v1/items/")
	if item, ok := ensureStore(h).GetItem(itemID); ok {
		writeJSON(w, http.StatusOK, item)
		return
	}
	writeJSON(w, http.StatusNotFound, errorResponse("not_found", "item not found"))
}

// ---------------------------------------------------------------------------
// GET /v1/agents
// ---------------------------------------------------------------------------

func (h *Handler) GetAgents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("method_not_allowed", "method not allowed"))
		return
	}
	if h.AdapterRegistry == nil {
		writeJSON(w, http.StatusOK, listResponse([]any{}))
		return
	}
	metadataList := h.AdapterRegistry.List()
	agents := make([]map[string]any, 0, len(metadataList))
	for _, m := range metadataList {
		info := map[string]any{
			"id":          m.ID,
			"name":        m.Name,
			"description": m.Description,
			"version":     m.Version,
			"status":      "available",
		}
		if a, ok := h.AdapterRegistry.Get(m.ID); ok {
			info["capabilities"] = a.Capabilities()
		}
		agents = append(agents, info)
	}
	writeJSON(w, http.StatusOK, listResponse(agents))
}

// ---------------------------------------------------------------------------
// GET /v1/runs
// ---------------------------------------------------------------------------

func (h *Handler) GetRuns(w http.ResponseWriter, r *http.Request) {
	threadID := r.URL.Query().Get("threadId")
	writeJSON(w, http.StatusOK, listResponse(ensureStore(h).ListRuns(threadID)))
}

// ---------------------------------------------------------------------------
// POST /v1/runs  (mock run)
// ---------------------------------------------------------------------------

func (h *Handler) PostRuns(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("method_not_allowed", "method not allowed"))
		return
	}

	var req struct {
		ProjectID string `json:"projectId"`
		ThreadID  string `json:"threadId"`
		Prompt    string `json:"prompt"`
		AgentID   string `json:"agentId"`
		Model     string `json:"model"`
		SessionID string `json:"sessionId"`
		Continue  bool   `json:"continue"`
		Fork      bool   `json:"fork"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse("bad_request", "invalid json body"))
		return
	}
	if req.ProjectID == "" {
		req.ProjectID = "proj_local"
	}
	if req.ThreadID == "" {
		req.ThreadID = "thread_local"
	}

	runID := genID("run_")
	run, err := ensureStore(h).CreateRun(runID, req.ProjectID, req.ThreadID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, errorResponse("not_found", "project or thread not found"))
		return
	}
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}

	// Emit run.queued
	h.Bus.Publish("run.queued", scope, run)
	_, _ = ensureStore(h).CreateItem(store.Item{
		ID:        genID("item_"),
		ProjectID: run.ProjectID,
		ThreadID:  run.ThreadID,
		RunID:     run.ID,
		Type:      "run",
		Status:    "queued",
		Content:   "Run queued",
	})

	if h.Executor == nil {
		h.ensureExecutor()
	}
	if h.Executor != nil {
		runCtx := lifecycle.RunProcessContext{
			Run:          run,
			Prompt:       req.Prompt,
			AgentID:      req.AgentID,
			Model:        req.Model,
			SessionID:    req.SessionID,
			ContinueLast: req.Continue,
			ForkSession:  req.Fork,
		}
		if err := h.Executor.Start(run, runCtx); err != nil {
			writeJSON(w, http.StatusInternalServerError, errorResponse("executor_start_failed", "failed to start run executor"))
			return
		}
	}

	writeJSON(w, http.StatusAccepted, acceptedResponse(runToResponse(run)))
}

// ---------------------------------------------------------------------------
// POST /v1/runs/{runId}:cancel
// ---------------------------------------------------------------------------

func (h *Handler) PostCancelRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("method_not_allowed", "method not allowed"))
		return
	}
	// Extract runId from path: /v1/runs/{runId}:cancel
	runID := extractRunID(r.URL.Path, ":cancel")
	if h.Executor == nil {
		ensureStore(h)
	}
	if h.Executor != nil {
		result := h.Executor.Cancel(runID)
		if result.Found {
			writeJSON(w, http.StatusAccepted, acceptedResponse(map[string]any{
				"runId":  runID,
				"status": result.Status,
			}))
			return
		}
	}
	if repository := ensureStore(h); repository != nil {
		if run, ok := repository.GetRun(runID); ok {
			writeJSON(w, http.StatusAccepted, acceptedResponse(map[string]any{
				"runId":  runID,
				"status": run.Status,
			}))
			return
		}
	}
	writeJSON(w, http.StatusAccepted, acceptedResponse(map[string]any{
		"runId":  runID,
		"status": "cancelling",
	}))
}

// ---------------------------------------------------------------------------
// GET /v1/events  (WebSocket)
// ---------------------------------------------------------------------------

func (h *Handler) GetEvents(w http.ResponseWriter, r *http.Request) {
	// Parse cursor from query.
	cursorStr := r.URL.Query().Get("cursor")
	if cursorStr == "" {
		cursorStr = r.URL.Query().Get("pageCursor")
	}

	var cursor int64
	if cursorStr != "" {
		if n, err := strconv.ParseInt(cursorStr, 10, 64); err == nil {
			cursor = n
		}
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "err", err)
		return
	}
	defer conn.Close()

	slog.Info("websocket connected", "cursor", cursor)

	subID, ch, replay := h.Bus.Subscribe(cursor)
	defer h.Bus.Unsubscribe(subID)

	// Send replayed events.
	for _, evt := range replay {
		if err := conn.WriteJSON(evt); err != nil {
			slog.Info("websocket write error during replay", "err", err)
			return
		}
	}

	// Heartbeat ticker: every 30 seconds.
	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	// Read goroutine to detect close and handle pong.
	go func() {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			return nil
		})
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				break
			}
		}
	}()

	// Write loop: push events and heartbeats.
	for {
		select {
		case evt, ok := <-ch:
			if !ok {
				return
			}
			if err := conn.WriteJSON(evt); err != nil {
				slog.Info("websocket write error", "err", err)
				return
			}
		case <-heartbeat.C:
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				slog.Info("websocket heartbeat error", "err", err)
				return
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// extractRunID extracts the run ID from paths like
// "/v1/runs/{runId}:cancel" by stripping the prefix and suffix.
func extractRunID(path, suffix string) string {
	trimmed := strings.TrimPrefix(path, "/v1/runs/")
	trimmed = strings.TrimSuffix(trimmed, suffix)
	return trimmed
}

func decodeOptionalJSON(r *http.Request, dst any) error {
	if r.Body == nil || r.Body == http.NoBody {
		return nil
	}
	defer r.Body.Close()
	if r.ContentLength == 0 {
		return nil
	}
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	return nil
}

func runToResponse(run store.Run) map[string]any {
	return lifecycle.RunResponse(run)
}

// RegisterRoutes registers all routes on the given mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	ensureStore(h)
	mux.HandleFunc("/v1/health", h.GetHealth)
	mux.HandleFunc("/v1/runners", h.GetRunners)
	mux.HandleFunc("/v1/agents", h.GetAgents)
	mux.HandleFunc("/v1/projects", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetProjects(w, r)
		case http.MethodPost:
			h.PostProjects(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errorResponse("method_not_allowed", "method not allowed"))
		}
	})
	mux.HandleFunc("/v1/projects/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			h.GetProject(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("method_not_allowed", "method not allowed"))
	})
	mux.HandleFunc("/v1/threads", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetThreads(w, r)
		case http.MethodPost:
			h.PostThreads(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errorResponse("method_not_allowed", "method not allowed"))
		}
	})
	mux.HandleFunc("/v1/threads/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/items") && r.Method == http.MethodGet {
			threadID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/threads/"), "/items")
			h.GetThreadItems(w, r, threadID)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/messages") && r.Method == http.MethodPost {
			threadID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/threads/"), "/messages")
			h.PostThreadMessage(w, r, threadID)
			return
		}
		if r.Method == http.MethodGet {
			h.GetThread(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("method_not_allowed", "method not allowed"))
	})
	mux.HandleFunc("/v1/items/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			h.GetItem(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("method_not_allowed", "method not allowed"))
	})
	mux.HandleFunc("/v1/runs", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetRuns(w, r)
		case http.MethodPost:
			h.PostRuns(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errorResponse("method_not_allowed", "method not allowed"))
		}
	})
	mux.HandleFunc("/v1/runs/", func(w http.ResponseWriter, r *http.Request) {
		// Routes with runId suffix: /v1/runs/{runId}:cancel
		if strings.HasSuffix(r.URL.Path, ":cancel") && r.Method == http.MethodPost {
			h.PostCancelRun(w, r)
			return
		}
		if r.Method == http.MethodGet {
			runID := strings.TrimPrefix(r.URL.Path, "/v1/runs/")
			if run, ok := ensureStore(h).GetRun(runID); ok {
				writeJSON(w, http.StatusOK, runToResponse(run))
				return
			}
			writeJSON(w, http.StatusNotFound, errorResponse("not_found", "run not found"))
			return
		}
		writeJSON(w, http.StatusNotFound, errorResponse("not_found", "not found"))
	})
	mux.HandleFunc("/v1/events", h.GetEvents)
}
