package api

import (
	"errors"
	"net/http"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/store"
)

// Handler holds dependencies for HTTP and WebSocket handlers.
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
// Agent Profile CRUD: GET/POST /v1/agent-profiles, GET/PATCH/DELETE /v1/agent-profiles/{id}
// ---------------------------------------------------------------------------

func (h *Handler) GetAgentProfiles(w http.ResponseWriter, r *http.Request) {
	// Agent profiles are Edge-local shared config (no OwnerID). Fail closed under Hub JWT.
	if denyRemoteHubSharedConfig(w, r) {
		return
	}
	adapterID := r.URL.Query().Get("adapterId")
	profiles := ensureStore(h).ListAgentProfiles(adapterID)
	writeSuccess(w, http.StatusOK, listResponse(profiles))
}

func (h *Handler) PostAgentProfiles(w http.ResponseWriter, r *http.Request) {
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
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage(err.Error())))
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
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage(err.Error())))
		return
	}
	writeSuccess(w, http.StatusCreated, created)
}

func (h *Handler) GetAgentProfile(w http.ResponseWriter, r *http.Request, profileID string) {
	if denyRemoteHubSharedConfig(w, r) {
		return
	}
	profile, ok := ensureStore(h).GetAgentProfile(profileID)
	if !ok {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound))
		return
	}
	writeSuccess(w, http.StatusOK, profile)
}

func (h *Handler) PatchAgentProfile(w http.ResponseWriter, r *http.Request, profileID string) {
	var patch map[string]any
	if err := decodeOptionalJSON(r, &patch); err != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage(err.Error())))
		return
	}
	profile, err := ensureStore(h).UpdateAgentProfile(profileID, patch)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound))
			return
		}
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage(err.Error())))
		return
	}
	writeSuccess(w, http.StatusOK, profile)
}

func (h *Handler) DeleteAgentProfile(w http.ResponseWriter, r *http.Request, profileID string) {
	if err := ensureStore(h).DeleteAgentProfile(profileID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound))
			return
		}
		writeJSON(w, http.StatusInternalServerError, errcode.ErrorBody(errcode.ErrInternal.WithMessage(err.Error())))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// GET /v1/runs
// ---------------------------------------------------------------------------
