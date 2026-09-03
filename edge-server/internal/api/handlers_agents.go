package api

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/store"
)

// Handler holds dependencies for HTTP and WebSocket handlers.
func (h *Handler) GetAgents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errcode.Write(w, errcode.ErrMethodNotAllowed)
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
// Agent Profile CRUD: GET/POST /v1/agent-profiles, GET/PATCH/DELETE /v1/agent-profiles/{id}
// ---------------------------------------------------------------------------

func (h *Handler) GetAgentProfiles(w http.ResponseWriter, r *http.Request) {
	// Agent profiles are Edge-local shared config (no OwnerID). Fail closed under Hub JWT / multi-user.
	if h.denyRemoteHubSharedConfig(w, r) {
		return
	}
	adapterID := r.URL.Query().Get("adapterId")
	profiles := ensureStore(h).ListAgentProfiles(adapterID)
	writeSuccess(w, http.StatusOK, listResponse(profiles))
}

func (h *Handler) PostAgentProfiles(w http.ResponseWriter, r *http.Request) {
	// Agent profiles are Edge-local shared config (no OwnerID): fail closed under
	// Hub JWT / multi-user, before the request body is decoded.
	if h.denyRemoteHubSharedConfig(w, r) {
		return
	}
	var body struct {
		Name              string   `json:"name"`
		Description       string   `json:"description"`
		AdapterID         string   `json:"adapterId"`
		Model             string   `json:"model"`
		Provider          string   `json:"provider"`
		ReasoningEffort   string   `json:"reasoningEffort"`
		ThinkingMode      string   `json:"thinkingMode"`
		MaxThinkingTokens int      `json:"maxThinkingTokens"`
		PermissionMode    string   `json:"permissionMode"`
		SystemPrompt      string   `json:"systemPrompt"`
		AllowedTools      []string `json:"allowedTools"`
		MCPConfig         string   `json:"mcpConfig"`
		Skills            []string `json:"skills"`
		AvatarRef         string   `json:"avatarRef"`
	}
	if err := decodeOptionalJSON(r, &body); err != nil {
		slog.Error("agent profile decode failed", "error", err)
		errcode.Write(w, errcode.ErrBadRequest)
		return
	}
	profile := store.AgentProfile{
		ID:                genID("profile_"),
		Name:              body.Name,
		Description:       body.Description,
		AdapterID:         body.AdapterID,
		Model:             body.Model,
		Provider:          body.Provider,
		ReasoningEffort:   body.ReasoningEffort,
		ThinkingMode:      body.ThinkingMode,
		MaxThinkingTokens: body.MaxThinkingTokens,
		PermissionMode:    body.PermissionMode,
		SystemPrompt:      body.SystemPrompt,
		AllowedTools:      body.AllowedTools,
		MCPConfig:         body.MCPConfig,
		Skills:            body.Skills,
		AvatarRef:         body.AvatarRef,
	}
	created, err := ensureStore(h).CreateAgentProfile(profile)
	if err != nil {
		slog.Error("create agent profile failed", "error", err)
		errcode.Write(w, errcode.ErrBadRequest)
		return
	}
	writeSuccess(w, http.StatusCreated, created)
}

func (h *Handler) GetAgentProfile(w http.ResponseWriter, r *http.Request, profileID string) {
	if h.denyRemoteHubSharedConfig(w, r) {
		return
	}
	profile, ok := ensureStore(h).GetAgentProfile(profileID)
	if !ok {
		errcode.Write(w, errcode.ErrNotFound)
		return
	}
	writeSuccess(w, http.StatusOK, profile)
}

func (h *Handler) PatchAgentProfile(w http.ResponseWriter, r *http.Request, profileID string) {
	// Same shared-config gate as the read paths above; a denied caller must not
	// reach decodeOptionalJSON (shared 1MB body limit, #2154).
	if h.denyRemoteHubSharedConfig(w, r) {
		return
	}
	var patch map[string]any
	if err := decodeOptionalJSON(r, &patch); err != nil {
		slog.Error("agent profile patch decode failed", "profileId", profileID, "error", err)
		errcode.Write(w, errcode.ErrBadRequest)
		return
	}
	profile, err := ensureStore(h).UpdateAgentProfile(profileID, patch)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			errcode.Write(w, errcode.ErrNotFound)
			return
		}
		slog.Error("update agent profile failed", "profileId", profileID, "error", err)
		errcode.Write(w, errcode.ErrBadRequest)
		return
	}
	writeSuccess(w, http.StatusOK, profile)
}

func (h *Handler) DeleteAgentProfile(w http.ResponseWriter, r *http.Request, profileID string) {
	// Deleting a profile every local run resolves through is a shared-config write.
	if h.denyRemoteHubSharedConfig(w, r) {
		return
	}
	if err := ensureStore(h).DeleteAgentProfile(profileID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			errcode.Write(w, errcode.ErrNotFound)
			return
		}
		slog.Error("delete agent profile failed", "profileId", profileID, "error", err)
		errcode.Write(w, errcode.ErrInternal)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// GET /v1/runs
// ---------------------------------------------------------------------------
