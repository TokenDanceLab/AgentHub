package api

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// Handler holds dependencies for HTTP and WebSocket handlers.
func (h *Handler) GetAgentInstances(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errcode.Write(w, errcode.ErrMethodNotAllowed)
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

	// Multi-user / Hub JWT: only expose instances bound to an owned run/thread.
	// Empty userID fails closed; local single-tenant bypass sees all.
	userID := h.ownerUserID(r)
	if !isLocalSingleTenant(userID) {
		repo := ensureStore(h)
		filtered := make([]agents.AgentInstance, 0, len(instances))
		for _, inst := range instances {
			if agentInstanceVisibleToUser(repo, inst, userID) {
				filtered = append(filtered, inst)
			}
		}
		instances = filtered
	}

	writeSuccess(w, http.StatusOK, listResponse(instances))
}

// GetAgentInstance returns a single agent instance by ID.
func (h *Handler) GetAgentInstance(w http.ResponseWriter, r *http.Request, instanceID string) {
	if r.Method != http.MethodGet {
		errcode.Write(w, errcode.ErrMethodNotAllowed)
		return
	}
	if h.AgentRegistry == nil {
		errcode.Write(w, errcode.ErrAgentRegistryNotConfigured)
		return
	}
	inst, ok := h.AgentRegistry.Get(instanceID)
	if !ok {
		errcode.Write(w, errcode.ErrAgentInstanceNotFound)
		return
	}
	userID := h.ownerUserID(r)
	if !agentInstanceVisibleToUser(ensureStore(h), *inst, userID) {
		errcode.Write(w, errcode.ErrAgentInstanceNotFound)
		return
	}
	writeSuccess(w, http.StatusOK, inst)
}

// agentInstanceVisibleToUser reports whether a runtime instance is owned by userID.
// Local single-tenant bypass allows; empty userID fails closed.
// Instances without run/thread anchors are fail-closed under Hub JWT.
func agentInstanceVisibleToUser(repo store.Reader, inst agents.AgentInstance, userID string) bool {
	if isLocalSingleTenant(userID) {
		return true
	}
	if userID == "" {
		return false
	}
	if inst.RunID != "" {
		return isRunOwnedBy(repo, inst.RunID, userID)
	}
	if inst.ThreadID != "" {
		return isThreadOwnedBy(repo, inst.ThreadID, userID)
	}
	return false
}

// ---------------------------------------------------------------------------
// GET /v1/ccswitch/status
// ---------------------------------------------------------------------------

func (h *Handler) GetCCSwitchStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errcode.Write(w, errcode.ErrMethodNotAllowed)
		return
	}
	if h.CCSwitchStatus == nil {
		writeSuccess(w, http.StatusOK, map[string]any{
			"installed":     false,
			"routingActive": false,
		})
		return
	}
	writeSuccess(w, http.StatusOK, h.CCSwitchStatus)
}

// ---------------------------------------------------------------------------
// GET /v1/ccswitch/providers
// ---------------------------------------------------------------------------

func (h *Handler) GetCCSwitchProviders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errcode.Write(w, errcode.ErrMethodNotAllowed)
		return
	}
	if h.CCSwitchReader == nil {
		writeSuccess(w, http.StatusOK, listResponse([]any{}))
		return
	}

	appType := r.URL.Query().Get("appType")
	if appType == "" {
		appType = "claude" // default to claude app type
	}

	providers, err := h.CCSwitchReader.ReadProviders(appType)
	if err != nil {
		slog.Warn("cc-switch: failed to read providers", "error", err)
		errcode.Write(w, errcode.ErrInternal.WithMessage("failed to read cc-switch providers"))
		return
	}

	writeSuccess(w, http.StatusOK, listResponse(providers))
}

// ---------------------------------------------------------------------------
// GET/POST /v1/memory — read/write AgentHub memory files
// ---------------------------------------------------------------------------

func (h *Handler) GetMemory(w http.ResponseWriter, r *http.Request) {
	workDir := r.URL.Query().Get("workDir")
	threadID := r.URL.Query().Get("threadId")
	agentID := r.URL.Query().Get("agentId")

	if err := h.validateWorkDirAllowed(workDir); err != nil {
		slog.Error("workdir not allowed", "workDir", workDir, "error", err)
		errcode.Write(w, errcode.ErrWorkspaceNotAllowed)
		return
	}

	result := runnerctx.ReadMemory(workDir, threadID, agentID)
	writeSuccess(w, http.StatusOK, result)
}

func (h *Handler) PostMemory(w http.ResponseWriter, r *http.Request) {
	var req struct {
		WorkDir   string   `json:"workDir"`
		ThreadID  string   `json:"threadId"`
		AgentID   string   `json:"agentId"`
		ID        string   `json:"id"`
		Content   string   `json:"content"`
		Source    string   `json:"source"`
		Tags      []string `json:"tags"`
		Overwrite bool     `json:"overwrite"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		errcode.Write(w, errcode.ErrInvalidJSON)
		return
	}
	if req.WorkDir == "" {
		errcode.Write(w, errcode.ErrBadRequest.WithMessage("workDir is required"))
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		errcode.Write(w, errcode.ErrBadRequest.WithMessage("content is required"))
		return
	}
	if err := h.validateWorkDirAllowed(req.WorkDir); err != nil {
		slog.Error("workdir not allowed", "workDir", req.WorkDir, "error", err)
		errcode.Write(w, errcode.ErrWorkspaceNotAllowed)
		return
	}
	if req.ID == "" {
		req.ID = genID("mem_")
	}

	entry, err := runnerctx.WriteMemoryEntry(runnerctx.MemoryWriteRequest{
		WorkDir:  req.WorkDir,
		ThreadID: req.ThreadID,
		AgentID:  req.AgentID,
		Entry: runnerctx.MemoryEntry{
			ID:      req.ID,
			Content: req.Content,
			Source:  req.Source,
			Tags:    req.Tags,
		},
		Overwrite: req.Overwrite,
	})
	if err != nil {
		slog.Error("memory write failed", "workDir", req.WorkDir, "threadId", req.ThreadID, "error", err)
		errcode.Write(w, errcode.ErrInternal)
		return
	}
	writeSuccess(w, http.StatusCreated, entry)
}

// ---------------------------------------------------------------------------
// RegisterRoutes registers all routes on the given mux.
// ---------------------------------------------------------------------------
