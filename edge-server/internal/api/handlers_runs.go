package api

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/edgeidentity"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/jwtutil"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/router"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// Handler holds dependencies for HTTP and WebSocket handlers.
func (h *Handler) GetRuns(w http.ResponseWriter, r *http.Request) {
	threadID := r.URL.Query().Get("threadId")
	repo := ensureStore(h)
	userID := h.ownerUserID(r)
	writeSuccess(w, http.StatusOK, listResponse(filterRunsByOwner(repo.ListRuns(threadID), repo, userID)))
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
		ProfileID               string                               `json:"profileId"`
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
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage("invalid json body")))
		return
	}

	// Defense-in-depth: validate structured output schema size at the Edge
	// entry point. The Hub already enforces MaxOutputSchemaSize (16 KB) at
	// create/update time, but this check guards against direct Edge POSTs
	// (e.g., via Hub HTTP dispatch or future code paths that skip
	// CustomAgent.OutputSchema validation).
	const maxOutputSchemaSize = 16 << 10
	if len(req.StructuredOutputSchema) > maxOutputSchemaSize {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage("structuredOutputSchema exceeds 16KB limit")))
		return
	}

	// Merge profile defaults: profile fields fill in blanks, request fields win.
	if req.ProfileID != "" {
		if profile, ok := ensureStore(h).GetAgentProfile(req.ProfileID); ok {
			if req.AgentID == "" {
				req.AgentID = profile.AdapterID
			}
			if req.Model == "" {
				req.Model = profile.Model
			}
			if req.Provider == "" {
				req.Provider = profile.Provider
			}
			if req.ReasoningEffort == "" {
				req.ReasoningEffort = profile.ReasoningEffort
			}
			if req.ThinkingMode == "" {
				req.ThinkingMode = profile.ThinkingMode
			}
			if req.MaxThinkingTokens == 0 {
				req.MaxThinkingTokens = profile.MaxThinkingTokens
			}
			if req.PermissionMode == "" {
				req.PermissionMode = profile.PermissionMode
			}
			if req.SystemPrompt == "" {
				req.SystemPrompt = profile.SystemPrompt
			}
			if len(req.AllowedTools) == 0 && len(profile.AllowedTools) > 0 {
				req.AllowedTools = profile.AllowedTools
			}
			if req.MCPConfig == "" {
				req.MCPConfig = profile.MCPConfig
			}
		}
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

	// Dual-token auth (AH-SR-046): when HubJWTSecret is configured, PostRuns
	// requires BOTH a valid identity JWT (checked by middleware) AND a
	// per-run capability token that binds user/device/target/project.
	if h.HubJWTSecret != "" {
		capToken := strings.TrimSpace(r.Header.Get("X-AgentHub-Capability-Token"))
		if capToken == "" {
			writeJSON(w, http.StatusForbidden, errcode.ErrorBody(errcode.ErrCapabilityTokenInvalid.WithMessage("missing capability token; dual-token auth requires X-AgentHub-Capability-Token header")))
			return
		}
		capClaims, err := jwtutil.ValidateCapabilityToken(capToken, []byte(h.HubJWTSecret), h.EdgeDeviceID)
		if err != nil {
			writeJSON(w, http.StatusForbidden, errcode.ErrorBody(errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token validation failed: %v", err)))
			return
		}
		if strings.TrimSpace(capClaims.Purpose) != "run-start" {
			writeJSON(w, http.StatusForbidden, errcode.ErrorBody(errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token purpose %q must be run-start", capClaims.Purpose)))
			return
		}
		// Action binding: when set, must match purpose (run-start for PostRuns).
		if action := strings.TrimSpace(capClaims.Action); action != "" && action != "run-start" {
			writeJSON(w, http.StatusForbidden, errcode.ErrorBody(errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token action %q must be run-start", action)))
			return
		}
		// Cross-check capability claims against the request.
		if capClaims.ProjectID != req.ProjectID {
			writeJSON(w, http.StatusForbidden, errcode.ErrorBody(errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token project_id %q does not match request project %q", capClaims.ProjectID, req.ProjectID)))
			return
		}
		// Thread/workspace binding when capability includes thread_id.
		if threadID := strings.TrimSpace(capClaims.ThreadID); threadID != "" && threadID != req.ThreadID {
			writeJSON(w, http.StatusForbidden, errcode.ErrorBody(errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token thread_id %q does not match request thread %q", threadID, req.ThreadID)))
			return
		}
		// Target binding when capability includes target_id (header or query).
		if targetID := strings.TrimSpace(capClaims.TargetID); targetID != "" {
			reqTarget := strings.TrimSpace(r.Header.Get("X-AgentHub-Target-Id"))
			if reqTarget == "" {
				reqTarget = strings.TrimSpace(r.URL.Query().Get("targetId"))
			}
			if reqTarget == "" || reqTarget != targetID {
				writeJSON(w, http.StatusForbidden, errcode.ErrorBody(errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token target_id %q does not match request target %q", targetID, reqTarget)))
				return
			}
		}
		// Cross-check identity: if the middleware injected Hub identity into the
		// context, verify the capability token binds the same user.
		if id := edgeidentity.FromContext(r.Context()); id.UserID != "" {
			if capClaims.UserID != id.UserID {
				writeJSON(w, http.StatusForbidden, errcode.ErrorBody(errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token user_id %q does not match identity user %q", capClaims.UserID, id.UserID)))
				return
			}
		}
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
	req.WorkDir = strings.TrimSpace(req.WorkDir)
	if err := h.validateRunWorkDir(req.WorkDir); err != nil {
		h.runCreateMu.Unlock()
		if errors.Is(err, errcode.ErrWorkDirRequired) {
			writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrWorkDirRequired))
			return
		}
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
	// Auto-detect continue: when the thread has prior assistant messages,
	// set ContinueLast = true so adapters can resume the conversation.
	if !req.Continue && threadHasAssistantHistory(repository, req.ThreadID) {
		req.Continue = true
	}
	// Each run creates a fresh CC conversation via --session-id.

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

	// Classify prompt complexity for execution strategy selection.
	// Complex tasks may benefit from orchestration/TeamRun; Simple tasks
	// can dispatch directly to a single agent.
	promptComplexity := router.ClassifyComplexity(req.Prompt)
	slog.Debug("run.complexity", "runId", runID, "complexity", promptComplexity,
		"promptLen", len(req.Prompt), "agentId", req.AgentID)
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
		// Inject AgentHub memory from .agenthub/memory/ files into the system prompt.
		// Memory is read from the workspace directory and prepended to SkillsPrompt
		// so agents have persistent context across runs.
		// Ensure the memory directory exists on first use (seeds project.md if new).
		if req.WorkDir != "" {
			if err := runnerctx.EnsureMemoryDir(req.WorkDir); err != nil {
				slog.Warn("memory: failed to ensure memory directory", "workDir", req.WorkDir, "error", err)
			}
		}
		if memPrompt := runnerctx.BuildMemoryPrompt(req.WorkDir, req.ThreadID, req.AgentID); memPrompt != "" {
			if runCtx.SkillsPrompt != "" {
				runCtx.SkillsPrompt = memPrompt + "\n\n" + runCtx.SkillsPrompt
			} else {
				runCtx.SkillsPrompt = memPrompt
			}
		}
		// Merge Hub-synced MCP server configs into the run's MCPConfig.
		// Run-level config wins on key conflicts; Hub configs fill in the gaps.
		if h.MCPConfigStore != nil {
			runCtx.MCPConfig = adapters.MergeConfigJSON(runCtx.MCPConfig, h.MCPConfigStore)
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
