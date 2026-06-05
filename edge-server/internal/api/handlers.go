package api

import (
	"crypto/rand"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/metrics"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/security"
	"github.com/agenthub/edge-server/internal/skills"
	"github.com/agenthub/edge-server/internal/store"
)

// Handler holds dependencies for HTTP and WebSocket handlers.
type Handler struct {
	Bus                *events.Bus
	Registry           *runners.Registry
	Store              store.Repository
	Executor           lifecycle.RunExecutor
	AdapterRegistry    *adapters.Registry // nil if no agent adapters configured
	AgentRegistry      *agents.Registry   // runtime agent instance registry
	MessageQueue       *agents.Queue      // inter-agent message queue
	Metrics            *metrics.EdgeMetrics
	WorkspaceAllowlist []string              // optional absolute/relative roots allowed for request workDir
	SkillRegistry      *skills.SkillRegistry // optional SKILL.md registry; nil = no skills injection

	// LocalAuthToken is the pre-shared bearer token required on all state-
	// changing endpoints (POST/PATCH/DELETE).  It is auto-generated when the
	// server starts in non-dev mode without an explicit token.
	LocalAuthToken string
	// HubJWTSecret is the shared key for validating Hub-issued HS256 JWTs.
	// When configured, Hub-issued tokens are accepted in addition to (or instead
	// of) the local auth token.
	HubJWTSecret string

	PermissionRegistry *PermissionRegistry

	runCreateMu              sync.Mutex
	permissionRegistryMu     sync.Mutex
	permissionObserverCancel func()
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if security.IsTrustedLocalOrigin(origin) {
			return true
		}
		// Allow non-browser WebSocket clients that do not send an Origin
		// header (e.g. Node.js ws, test clients) when connecting to localhost.
		if origin == "" && security.IsTrustedLocalHost(r.Host) {
			return true
		}
		return false
	},
}

const (
	defaultRunCleanupTerminalTTL              = 24 * time.Hour
	defaultRunCleanupMaxTerminalRunsPerThread = 50

	// CloseCodeEventGap is the WebSocket close code sent when the event bus
	// detects dropped events for this subscriber. The client should reconnect
	// with a known-good cursor to trigger a full resync.
	CloseCodeEventGap = 4001
)

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

func normalizedRealPath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	realPath, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	return filepath.Clean(realPath), nil
}

func isPathWithin(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel))
}

func (h *Handler) validateWorkDirAllowed(workDir string) error {
	// Empty workDir is allowed (no workspace path specified).
	if workDir == "" {
		return nil
	}
	// Fail-closed: an empty or nil allowlist rejects any non-empty workDir.
	// This prevents accidental "allow all" when the operator forgets to configure
	// the workspace allowlist (AH-SR-006).
	if len(h.WorkspaceAllowlist) == 0 {
		return fmt.Errorf("workspace allowlist is not configured; configure at least one allowed workspace root to enable file system access")
	}
	candidate, err := normalizedRealPath(workDir)
	if err != nil {
		return err
	}
	for _, root := range h.WorkspaceAllowlist {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		allowedRoot, err := normalizedRealPath(root)
		if err != nil {
			continue
		}
		if isPathWithin(allowedRoot, candidate) {
			return nil
		}
	}
	return fmt.Errorf("workDir is outside the Edge workspace allowlist")
}

func ensureStore(h *Handler) store.Repository {
	if h.Store == nil {
		h.Store = store.New()
	}
	h.ensureDefaults()
	return h.Store
}

func (h *Handler) ensureDefaults() {
	if h.Store == nil {
		return
	}
	_, _ = h.Store.CreateProject("proj_local", "Local Project")
	_, _ = h.Store.CreateThread("thread_local", "proj_local", "Local Thread")
}

func acceptedResponse(data map[string]any) map[string]any {
	return data
}

func ensureBus(h *Handler) *events.Bus {
	if h.Bus == nil {
		h.Bus = events.NewBus(10000)
	}
	return h.Bus
}

func (h *Handler) ensurePermissionRegistry() *PermissionRegistry {
	h.permissionRegistryMu.Lock()
	defer h.permissionRegistryMu.Unlock()
	if h.PermissionRegistry == nil {
		h.PermissionRegistry = NewPermissionRegistry(0)
	}
	if h.permissionObserverCancel == nil {
		h.permissionObserverCancel = ensureBus(h).AddObserver(h.PermissionRegistry.ObserveEvent)
	}
	return h.PermissionRegistry
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("failed to write json response", "err", err)
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

	writeSuccess(w, http.StatusOK, map[string]any{
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

func (h *Handler) GetProjects(w http.ResponseWriter, r *http.Request) {
	writeSuccess(w, http.StatusOK, listResponse(ensureStore(h).ListProjects()))
}

func (h *Handler) PostProjects(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProjectID string `json:"projectId"`
		Name      string `json:"name"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidJSON))
		return
	}
	if req.ProjectID == "" {
		req.ProjectID = genID("proj_")
	}
	project, err := ensureStore(h).CreateProject(req.ProjectID, req.Name)
	if errors.Is(err, store.ErrProjectExists) {
		writeSuccess(w, http.StatusOK, project)
		return
	}
	h.Bus.Publish("project.created", map[string]any{"projectId": project.ID}, project)
	writeSuccess(w, http.StatusCreated, project)
}

func (h *Handler) GetProject(w http.ResponseWriter, r *http.Request) {
	projectID := strings.TrimPrefix(r.URL.Path, "/v1/projects/")
	if project, ok := ensureStore(h).GetProject(projectID); ok {
		writeSuccess(w, http.StatusOK, project)
		return
	}
	writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("project not found")))
}

func (h *Handler) GetThreads(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("projectId")
	writeSuccess(w, http.StatusOK, listResponse(ensureStore(h).ListThreads(projectID)))
}

func (h *Handler) PostThreads(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ThreadID  string `json:"threadId"`
		ProjectID string `json:"projectId"`
		Title     string `json:"title"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidJSON))
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
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("project not found")))
		return
	}
	h.Bus.Publish("thread.created", map[string]any{
		"projectId": thread.ProjectID,
		"threadId":  thread.ID,
	}, thread)
	writeSuccess(w, http.StatusCreated, thread)
}

func (h *Handler) GetThread(w http.ResponseWriter, r *http.Request) {
	threadID := strings.TrimPrefix(r.URL.Path, "/v1/threads/")
	if thread, ok := ensureStore(h).GetThread(threadID); ok {
		writeSuccess(w, http.StatusOK, thread)
		return
	}
	writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("thread not found")))
}

func (h *Handler) PatchThread(w http.ResponseWriter, r *http.Request, threadID string) {
	var req struct {
		Title  *string `json:"title"`
		Status *string `json:"status"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidJSON))
		return
	}
	if req.Status != nil {
		normalized := strings.ToLower(strings.TrimSpace(*req.Status))
		if normalized != "active" && normalized != "archived" {
			writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage("status must be active or archived")))
			return
		}
		req.Status = &normalized
	}
	if req.Title != nil {
		trimmed := strings.TrimSpace(*req.Title)
		req.Title = &trimmed
	}
	thread, ok := ensureStore(h).UpdateThread(threadID, req.Title, req.Status)
	if !ok {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("thread not found")))
		return
	}
	h.Bus.Publish("thread.updated", map[string]any{
		"projectId": thread.ProjectID,
		"threadId":  thread.ID,
	}, thread)
	writeSuccess(w, http.StatusOK, thread)
}

func (h *Handler) DeleteThread(w http.ResponseWriter, r *http.Request, threadID string) {
	if ok := ensureStore(h).DeleteThread(threadID); !ok {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("thread not found")))
		return
	}
	h.Bus.Publish("thread.deleted", map[string]any{"threadId": threadID}, map[string]any{"threadId": threadID})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ArchiveThread(w http.ResponseWriter, r *http.Request, threadID string) {
	status := "archived"
	thread, ok := ensureStore(h).UpdateThread(threadID, nil, &status)
	if !ok {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("thread not found")))
		return
	}
	h.Bus.Publish("thread.updated", map[string]any{
		"projectId": thread.ProjectID,
		"threadId":  thread.ID,
	}, thread)
	writeSuccess(w, http.StatusAccepted, thread)
}

func (h *Handler) GetThreadItems(w http.ResponseWriter, r *http.Request, threadID string) {
	repository := ensureStore(h)
	if _, ok := repository.GetThread(threadID); !ok {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("thread not found")))
		return
	}
	writeSuccess(w, http.StatusOK, listResponse(repository.ListThreadItems(threadID)))
}

func (h *Handler) PostThreadMessage(w http.ResponseWriter, r *http.Request, threadID string) {
	var req struct {
		Content string `json:"content"`
		Role    string `json:"role"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidJSON))
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrContentRequired))
		return
	}

	item, err := ensureStore(h).CreateThreadMessage(genID("item_"), threadID, req.Role, req.Content)
	if err != nil {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("thread not found")))
		return
	}
	scope := map[string]any{
		"projectId": item.ProjectID,
		"threadId":  item.ThreadID,
		"itemId":    item.ID,
	}
	h.Bus.Publish("message.created", scope, item)
	h.Bus.Publish("item.created", scope, item)
	writeSuccess(w, http.StatusCreated, item)
}

func (h *Handler) GetItem(w http.ResponseWriter, r *http.Request) {
	itemID := strings.TrimPrefix(r.URL.Path, "/v1/items/")
	if item, ok := ensureStore(h).GetItem(itemID); ok {
		writeSuccess(w, http.StatusOK, item)
		return
	}
	writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("item not found")))
}

// ---------------------------------------------------------------------------
// GET /v1/agents
// ---------------------------------------------------------------------------

func (h *Handler) GetAgents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		return
	}
	if h.AdapterRegistry == nil {
		writeSuccess(w, http.StatusOK, listResponse([]any{}))
		return
	}
	metadataList := h.AdapterRegistry.List()
	agents := make([]map[string]any, 0, len(metadataList))
	for _, m := range metadataList {
		status := "available"
		if a, ok := h.AdapterRegistry.Get(m.ID); ok {
			if !a.Available() {
				status = "unavailable"
			}
		}
		info := map[string]any{
			"id":          m.ID,
			"name":        m.Name,
			"description": m.Description,
			"version":     m.Version,
			"status":      status,
		}
		if a, ok := h.AdapterRegistry.Get(m.ID); ok {
			info["capabilities"] = a.Capabilities()
		}
		agents = append(agents, info)
	}
	writeSuccess(w, http.StatusOK, listResponse(agents))
}

// ---------------------------------------------------------------------------
// GET /v1/runs
// ---------------------------------------------------------------------------

func (h *Handler) GetRuns(w http.ResponseWriter, r *http.Request) {
	threadID := r.URL.Query().Get("threadId")
	writeSuccess(w, http.StatusOK, listResponse(ensureStore(h).ListRuns(threadID)))
}

// ---------------------------------------------------------------------------
// POST /v1/runs
// ---------------------------------------------------------------------------

func (h *Handler) PostRuns(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		return
	}

	var req struct {
		ProjectID               string                               `json:"projectId"`
		ThreadID                string                               `json:"threadId"`
		Prompt                  string                               `json:"prompt"`
		AgentID                 string                               `json:"agentId"`
		Model                   string                               `json:"model"`
		Provider                string                               `json:"provider"`
		ModelAlias              string                               `json:"modelAlias"`
		ModelMappingEnabled     bool                                 `json:"modelMappingEnabled"`
		ProviderFallbackEnabled bool                                 `json:"providerFallbackEnabled"`
		SessionID               string                               `json:"sessionId"`
		Continue                bool                                 `json:"continue"`
		Fork                    bool                                 `json:"fork"`
		ReasoningEffort         string                               `json:"reasoningEffort"`
		ThinkingMode            string                               `json:"thinkingMode"`
		MaxThinkingTokens       int                                  `json:"maxThinkingTokens"`
		PermissionMode          string                               `json:"permissionMode"`
		WorkDir                 string                               `json:"workDir"`
		IncludePartial          bool                                 `json:"includePartial"`
		StructuredOutputSchema  string                               `json:"structuredOutputSchema"`
		SystemPrompt            string                               `json:"systemPrompt"`
		AppendSystemPrompt      string                               `json:"appendSystemPrompt"`
		AllowedTools            []string                             `json:"allowedTools"`
		ConfigOverrides         map[string]string                    `json:"configOverrides"`
		AgentDefinitions        map[string]runnerctx.AgentDefinition `json:"agentDefinitions"`
		MCPConfig               string                               `json:"mcpConfig"`
		Ephemeral               bool                                 `json:"ephemeral"`
		HubTaskID               string                               `json:"hubTaskId"` // Edge-to-Hub direct callback task ID
		Messages                []runnerctx.Message                  `json:"messages,omitempty"`
		PinnedMessages          []runnerctx.Message                  `json:"pinnedMessages,omitempty"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidJSON))
		return
	}
	if req.ProjectID == "" {
		req.ProjectID = "proj_local"
	}
	if req.ThreadID == "" {
		req.ThreadID = "thread_local"
	}
	if (req.SessionID == "" || req.SessionID == req.ThreadID) && !req.Ephemeral {
		req.SessionID = runtimeSessionIDForThread(req.ThreadID)
	}

	repository := ensureStore(h)
	h.runCreateMu.Lock()
	cleanupRuns(repository)
	thread, ok := repository.GetThread(req.ThreadID)
	if !ok || thread.ProjectID != req.ProjectID {
		h.runCreateMu.Unlock()
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("project or thread not found")))
		return
	}
	if _, ok := repository.GetProject(req.ProjectID); !ok {
		h.runCreateMu.Unlock()
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("project or thread not found")))
		return
	}
	if err := h.validateWorkDirAllowed(req.WorkDir); err != nil {
		h.runCreateMu.Unlock()
		writeJSON(w, http.StatusForbidden, errcode.ErrorBody(errcode.ErrWorkspaceNotAllowed.WithMessage(err.Error())))
		return
	}
	if err := validatePermissionMode(req.PermissionMode); err != nil {
		h.runCreateMu.Unlock()
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidPermissionMode.WithMessage(err.Error())))
		return
	}
	if active, ok := activeRunForThread(repository.ListRuns(req.ThreadID)); ok {
		h.runCreateMu.Unlock()
		writeJSON(w, http.StatusConflict, activeRunExistsResponse(active))
		return
	}
	if !req.Continue && req.SessionID != "" && threadHasAssistantHistory(repository.ListThreadItems(req.ThreadID)) {
		req.Continue = true
	}

	if h.Executor == nil {
		h.runCreateMu.Unlock()
		writeJSON(w, http.StatusServiceUnavailable, errcode.ErrorBody(errcode.ErrExecutorUnavailable.WithMessage("no Agent Runtime executor configured")))
		return
	}

	// #175: Reject unknown agentId — do not fall back to default adapter.
	if req.AgentID != "" && h.AdapterRegistry != nil {
		if _, ok := h.AdapterRegistry.Get(req.AgentID); !ok {
			h.runCreateMu.Unlock()
			writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidAgentID.WithMessagef("unknown agent adapter: %q", req.AgentID)))
			return
		}
	}

	// Resolve adapter label for debug logging.
	resolvedAdapterID := req.AgentID
	if resolvedAdapterID == "" {
		if h.AdapterRegistry != nil {
			resolvedAdapterID = "default"
		} else {
			resolvedAdapterID = "none"
		}
	}
	slog.Debug("run.create", "agentId", req.AgentID, "threadId", req.ThreadID, "model", req.Model, "adapterResolved", resolvedAdapterID, "hasExecutor", h.Executor != nil)

	runID := genID("run_")
	run, err := repository.CreateRun(runID, req.ProjectID, req.ThreadID)
	h.runCreateMu.Unlock()
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("project or thread not found")))
		} else {
			writeJSON(w, http.StatusInternalServerError, errcode.ErrorBody(errcode.ErrInternal.WithMessagef("failed to create run: %v", err)))
		}
		return
	}
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}

	// Emit run.queued
	h.Bus.Publish("run.queued", scope, run)
	slog.Debug("run.queued", "runId", runID, "agentId", req.AgentID)
	if strings.TrimSpace(req.Prompt) != "" {
		if item, err := ensureStore(h).CreateItem(store.Item{
			ID:        genID("item_"),
			ProjectID: run.ProjectID,
			ThreadID:  run.ThreadID,
			RunID:     run.ID,
			Type:      "user_message",
			Role:      "user",
			Status:    "created",
			Content:   req.Prompt,
		}); err == nil {
			itemScope := map[string]any{
				"projectId": item.ProjectID,
				"threadId":  item.ThreadID,
				"runId":     item.RunID,
				"itemId":    item.ID,
			}
			h.Bus.Publish("message.created", itemScope, item)
			h.Bus.Publish("item.created", itemScope, item)
		}
	}
	_, _ = ensureStore(h).CreateItem(store.Item{
		ID:        genID("item_"),
		ProjectID: run.ProjectID,
		ThreadID:  run.ThreadID,
		RunID:     run.ID,
		Type:      "run",
		Status:    "queued",
		Content:   "Run queued",
	})

	if h.Executor != nil {
		runCtx := lifecycle.RunProcessContext{
			Run:                    run,
			Prompt:                 req.Prompt,
			AgentID:                req.AgentID,
			Model:                  req.Model,
			SessionID:              req.SessionID,
			ContinueLast:           req.Continue,
			ForkSession:            req.Fork,
			ReasoningEffort:        req.ReasoningEffort,
			ThinkingMode:           req.ThinkingMode,
			MaxThinkingTokens:      req.MaxThinkingTokens,
			PermissionMode:         req.PermissionMode,
			WorkDir:                req.WorkDir,
			IncludePartial:         req.IncludePartial,
			StructuredOutputSchema: req.StructuredOutputSchema,
			SystemPrompt:           req.SystemPrompt,
			AppendSystemPrompt:     req.AppendSystemPrompt,
			AllowedTools:           req.AllowedTools,
			ConfigOverrides:        req.ConfigOverrides,
			AgentDefinitions:       req.AgentDefinitions,
			MCPConfig:              req.MCPConfig,
			Ephemeral:              req.Ephemeral,
			HubTaskID:              req.HubTaskID,
			Messages:               req.Messages,
			PinnedMessages:         req.PinnedMessages,
		}
		// Inject Skills directory context (SKILL.md discovery) into the system prompt.
		// The SkillRegistry is shared across runs and lazily lists name+description.
		if h.SkillRegistry != nil {
			runCtx.SkillsPrompt = h.SkillRegistry.SystemPromptContext()
		}
		if err := h.Executor.Start(run, runCtx); err != nil {
			if failed, ok := repository.SetRunStatusIf(run.ID, "failed", "queued"); ok {
				h.Bus.Publish("run.failed", scope, map[string]any{
					"runId":  failed.ID,
					"status": failed.Status,
					"error":  err.Error(),
				})
			}
			if errors.Is(err, lifecycle.ErrTooManyConcurrentRuns) {
				writeJSON(w, http.StatusTooManyRequests, errcode.ErrorBody(errcode.ErrTooManyConcurrentRuns.WithMessage(err.Error())))
				return
			}
			writeJSON(w, http.StatusInternalServerError, errcode.ErrorBody(errcode.ErrExecutorStartFailed.WithMessagef("failed to start run executor: %v", err)))
			return
		}
	}
	writeSuccess(w, http.StatusAccepted, acceptedResponse(runToResponse(run)))
}

// ---------------------------------------------------------------------------
// POST /v1/runs/{runId}:cancel
// ---------------------------------------------------------------------------

func (h *Handler) PostCancelRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
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
			// #108: align cancel response with OpenAPI spec
			// Terminal runs (finished/failed/cancelled) are already done; return OK with current status
			if isTerminalRunStatus(result.Status) {
				writeSuccess(w, http.StatusOK, acceptedResponse(map[string]any{
					"runId":  runID,
					"status": result.Status,
				}))
				return
			}
			writeSuccess(w, http.StatusAccepted, acceptedResponse(map[string]any{
				"runId":  runID,
				"status": result.Status,
			}))
			return
		}
	}
	// #108: check store as fallback; return 404 for missing run instead of silently accepting
	if repository := ensureStore(h); repository != nil {
		if run, ok := repository.GetRun(runID); ok {
			writeSuccess(w, http.StatusOK, acceptedResponse(map[string]any{
				"runId":  runID,
				"status": run.Status,
			}))
			return
		}
	}
	writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("run not found")))
}

func isTerminalRunStatus(status string) bool {
	switch status {
	case "finished", "failed", "cancelled":
		return true
	default:
		return false
	}
}

// ---------------------------------------------------------------------------
// GET /v1/events  (WebSocket)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /v1/metrics  (Prometheus text format)
// ---------------------------------------------------------------------------

func (h *Handler) GetMetrics(w http.ResponseWriter, r *http.Request) {
	if h.Metrics == nil {
		writeJSON(w, http.StatusServiceUnavailable, errcode.ErrorBody(errcode.ErrNotConfigured.WithMessage("metrics not configured")))
		return
	}
	h.Metrics.Handler().ServeHTTP(w, r)
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

	if h.Metrics != nil {
		h.Metrics.RecordWSConnect()
		defer h.Metrics.RecordWSDisconnect()
	}

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

	clientControl := make(chan map[string]any, 8)

	// Read goroutine to detect close and handle pong timeout.
	// When the read deadline expires (no pong within 60s), the connection
	// is closed to force the write loop to exit.
	done := make(chan struct{})
	readDone := make(chan struct{})
	defer close(done)
	go func() {
		defer close(readDone)
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		conn.SetPongHandler(func(string) error {
			_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			return nil
		})
		for {
			select {
			case <-done:
				return
			default:
			}
			_, message, err := conn.ReadMessage()
			if err != nil {
				break
			}
			if response, ok := websocketClientControlResponse(message); ok {
				select {
				case clientControl <- response:
				case <-done:
					return
				}
			}
		}
	}()

	// Write loop: push events and heartbeats.
	for {
		select {
		case <-readDone:
			return
		case response := <-clientControl:
			if err := conn.WriteJSON(response); err != nil {
				slog.Info("websocket control write error", "err", err)
				return
			}
		case evt, ok := <-ch:
			if !ok {
				return
			}
			if evt.Type == events.GapEventType {
				slog.Warn("event bus gap detected, closing websocket to force client resync",
					"subscriber", subID)
				closeMsg := websocket.FormatCloseMessage(CloseCodeEventGap,
					"event gap: dropped events detected, reconnect to resync")
				_ = conn.WriteMessage(websocket.CloseMessage, closeMsg)
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

func websocketClientControlResponse(message []byte) (map[string]any, bool) {
	var frame struct {
		Type string `json:"type"`
		Ts   any    `json:"ts,omitempty"`
	}
	if err := json.Unmarshal(message, &frame); err != nil || frame.Type != "ping" {
		return nil, false
	}
	response := map[string]any{"type": "pong"}
	if frame.Ts != nil {
		response["ts"] = frame.Ts
	}
	return response, true
}

func runtimeSessionIDForThread(threadID string) string {
	seed := sha1.Sum([]byte("agenthub-runtime-session:" + threadID))
	session := make([]byte, 16)
	copy(session, seed[:16])
	session[6] = (session[6] & 0x0f) | 0x50
	session[8] = (session[8] & 0x3f) | 0x80
	return strings.Join([]string{
		hex.EncodeToString(session[0:4]),
		hex.EncodeToString(session[4:6]),
		hex.EncodeToString(session[6:8]),
		hex.EncodeToString(session[8:10]),
		hex.EncodeToString(session[10:16]),
	}, "-")
}

func threadHasAssistantHistory(items []store.Item) bool {
	for _, item := range items {
		if item.Type == "agent_message" && (item.Role == "agent" || item.Role == "assistant") && strings.TrimSpace(item.Content) != "" {
			return true
		}
	}
	return false
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
	// Limit request body to 1MB to prevent memory exhaustion.
	// Use io.LimitReader instead of http.MaxBytesReader to avoid needing a ResponseWriter.
	r.Body = io.NopCloser(io.LimitReader(r.Body, 1<<20))
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	return nil
}

func runToResponse(run store.Run) map[string]any {
	return lifecycle.RunResponse(run)
}

func activeRunExistsResponse(run store.Run) map[string]any {
	body := errcode.ErrorBody(errcode.ErrActiveRunExists)
	body["runId"] = run.ID
	body["projectId"] = run.ProjectID
	body["threadId"] = run.ThreadID
	body["status"] = run.Status
	return body
}

func activeRunForThread(runs []store.Run) (store.Run, bool) {
	for _, run := range runs {
		if isActiveRunStatus(run.Status) {
			return run, true
		}
	}
	return store.Run{}, false
}

func isActiveRunStatus(status string) bool {
	switch status {
	case "queued", "started", "cancelling":
		return true
	default:
		return false
	}
}

// validatePermissionMode returns an error if mode is not a recognised
// Claude Code --permission-mode value. An empty mode is allowed and means
// "use the adapter default".
func validatePermissionMode(mode string) error {
	if mode == "" {
		return nil
	}
	// SEC-02: Reject 'bypassPermissions' — it disables ALL security hooks at
	// the CLI level, giving the agent unrestricted shell access regardless
	// of SecurityHook settings. Only the whitelist modes are allowed.
	switch mode {
	case "default", "acceptEdits", "plan", "dontAsk":
		return nil
	default:
		return fmt.Errorf("unknown permission mode %q: valid values are default, acceptEdits, plan, dontAsk", mode)
	}
}

func cleanupRuns(repository store.Repository) store.RunCleanupResult {
	cleaner, ok := repository.(store.RunCleaner)
	if !ok {
		return store.RunCleanupResult{}
	}
	return cleaner.CleanupRuns(store.RunCleanupOptions{
		TerminalTTL:              defaultRunCleanupTerminalTTL,
		MaxTerminalRunsPerThread: defaultRunCleanupMaxTerminalRunsPerThread,
	})
}

// ---------------------------------------------------------------------------
// POST /v1/permissions/decide  (Desktop permission gate)
// ---------------------------------------------------------------------------

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

	permission, ok := h.ensurePermissionRegistry().Consume(req.RunID, req.RequestID)
	if !ok {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrPermissionRequestNotFound))
		return
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

// ---------------------------------------------------------------------------
// GET /v1/agent-instances
// ---------------------------------------------------------------------------

// GetAgentInstances returns all registered agent instances from the runtime registry.
func (h *Handler) GetAgentInstances(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		return
	}
	if h.AgentRegistry == nil {
		writeSuccess(w, http.StatusOK, listResponse([]any{}))
		return
	}
	statusFilter := r.URL.Query().Get("status")
	parentFilter := r.URL.Query().Get("parentId")

	var instances []agents.AgentInstance
	switch {
	case statusFilter != "":
		instances = h.AgentRegistry.ListByStatus(agents.Status(statusFilter))
	case parentFilter != "":
		instances = h.AgentRegistry.ListByParent(parentFilter)
	default:
		instances = h.AgentRegistry.List()
	}

	writeSuccess(w, http.StatusOK, listResponse(instances))
}

// GetAgentInstance returns a single agent instance by ID.
func (h *Handler) GetAgentInstance(w http.ResponseWriter, r *http.Request, instanceID string) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		return
	}
	if h.AgentRegistry == nil {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrAgentRegistryNotConfigured))
		return
	}
	inst, ok := h.AgentRegistry.Get(instanceID)
	if !ok {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrAgentInstanceNotFound))
		return
	}
	writeSuccess(w, http.StatusOK, inst)
}

// ---------------------------------------------------------------------------
// RegisterRoutes registers all routes on the given mux.
// ---------------------------------------------------------------------------
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	ensureStore(h)
	h.ensurePermissionRegistry()
	mux.HandleFunc("/v1/health", h.GetHealth)
	mux.HandleFunc("/v1/runners", h.GetRunners)
	mux.HandleFunc("/v1/agents", h.GetAgents)
	mux.HandleFunc("/v1/model-catalog", h.GetModelCatalog)
	mux.HandleFunc("/v1/projects", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetProjects(w, r)
		case http.MethodPost:
			h.PostProjects(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		}
	})
	mux.HandleFunc("/v1/projects/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			h.GetProject(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
	mux.HandleFunc("/v1/threads", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetThreads(w, r)
		case http.MethodPost:
			h.PostThreads(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
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
		if strings.HasSuffix(r.URL.Path, ":archive") && r.Method == http.MethodPost {
			threadID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/threads/"), ":archive")
			h.ArchiveThread(w, r, threadID)
			return
		}
		if r.Method == http.MethodGet {
			h.GetThread(w, r)
			return
		}
		threadID := strings.TrimPrefix(r.URL.Path, "/v1/threads/")
		switch r.Method {
		case http.MethodPatch:
			h.PatchThread(w, r, threadID)
		case http.MethodDelete:
			h.DeleteThread(w, r, threadID)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		}
	})
	mux.HandleFunc("/v1/items/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			h.GetItem(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
	mux.HandleFunc("/v1/runs", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetRuns(w, r)
		case http.MethodPost:
			h.PostRuns(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
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
				writeSuccess(w, http.StatusOK, runToResponse(run))
				return
			}
			writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("run not found")))
			return
		}
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound))
	})
	mux.HandleFunc("/v1/metrics", h.GetMetrics)
	mux.HandleFunc("/v1/events", h.GetEvents)
	mux.HandleFunc("/v1/agent-instances", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			h.GetAgentInstances(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
	mux.HandleFunc("/v1/agent-instances/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			instanceID := strings.TrimPrefix(r.URL.Path, "/v1/agent-instances/")
			h.GetAgentInstance(w, r, instanceID)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
	mux.HandleFunc("/v1/permissions/decide", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			h.PostPermissionDecide(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
}
