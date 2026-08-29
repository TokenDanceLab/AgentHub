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
	"github.com/agenthub/edge-server/internal/runcontrol"
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

// runRequest is the POST /v1/runs request body.
type runRequest struct {
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
	TraceID                 string                               `json:"trace_id,omitempty"` // Hub dispatch trace correlation id
	Messages                []runnerctx.Message                  `json:"messages,omitempty"`
	PinnedMessages          []runnerctx.Message                  `json:"pinnedMessages,omitempty"`
}

// decodeRunRequest decodes the POST /v1/runs body and enforces the
// structured output schema size limit at the Edge entry point.
func decodeRunRequest(r *http.Request) (runRequest, *errcode.Error) {
	var req runRequest
	if err := decodeOptionalJSON(r, &req); err != nil {
		return req, errcode.ErrBadRequest.WithMessage("invalid json body")
	}
	// Defense-in-depth: validate structured output schema size at the Edge
	// entry point. The Hub already enforces MaxOutputSchemaSize (16 KB) at
	// create/update time, but this check guards against direct Edge POSTs
	// (e.g., via Hub HTTP dispatch or future code paths that skip
	// CustomAgent.OutputSchema validation).
	const maxOutputSchemaSize = 16 << 10
	if len(req.StructuredOutputSchema) > maxOutputSchemaSize {
		return req, errcode.ErrBadRequest.WithMessage("structuredOutputSchema exceeds 16KB limit")
	}
	return req, nil
}

// applyProfileDefaults merges agent profile defaults into the run request:
// profile fields fill in blanks, request fields win.
func (h *Handler) applyProfileDefaults(req *runRequest) {
	if req.ProfileID == "" {
		return
	}
	profile, ok := ensureStore(h).GetAgentProfile(req.ProfileID)
	if !ok {
		return
	}
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

// validateCapabilityRequest enforces the dual-token capability policy
// (AH-SR-046): when a Hub user identity is present on the request, PostRuns
// requires BOTH that identity (middleware) AND a per-run capability token
// that binds user/device/target/project. Pure local-auth (no Hub identity)
// remains allowed without capability when HubJWTSecret is empty. If Hub
// identity is present but the secret is empty/misconfigured, fail closed —
// never soft-skip capability. Returns nil when the request passes.
func (h *Handler) validateCapabilityRequest(r *http.Request, req *runRequest) *errcode.Error {
	hubUserID := hubUserFromRequest(r)
	if hubUserID != "" && h.HubJWTSecret == "" {
		return errcode.ErrNotConfigured.WithMessage("Hub JWT secret not configured; dual-token capability validation required when Hub identity is present")
	}
	if h.HubJWTSecret == "" {
		return nil
	}
	capToken := strings.TrimSpace(r.Header.Get("X-AgentHub-Capability-Token"))
	if capToken == "" {
		return errcode.ErrCapabilityTokenInvalid.WithMessage("missing capability token; dual-token auth requires X-AgentHub-Capability-Token header")
	}
	capClaims, err := jwtutil.ValidateCapabilityToken(capToken, []byte(h.HubJWTSecret), h.EdgeDeviceID)
	if err != nil {
		return errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token validation failed: %v", err)
	}
	if strings.TrimSpace(capClaims.Purpose) != "run-start" {
		return errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token purpose %q must be run-start", capClaims.Purpose)
	}
	// Action binding: when set, must match purpose (run-start for PostRuns).
	if action := strings.TrimSpace(capClaims.Action); action != "" && action != "run-start" {
		return errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token action %q must be run-start", action)
	}
	// Cross-check capability claims against the request.
	if capClaims.ProjectID != req.ProjectID {
		return errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token project_id %q does not match request project %q", capClaims.ProjectID, req.ProjectID)
	}
	// Thread/workspace binding when capability includes thread_id.
	if threadID := strings.TrimSpace(capClaims.ThreadID); threadID != "" && threadID != req.ThreadID {
		return errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token thread_id %q does not match request thread %q", threadID, req.ThreadID)
	}
	// Target binding when capability includes target_id (header or query).
	if targetID := strings.TrimSpace(capClaims.TargetID); targetID != "" {
		reqTarget := strings.TrimSpace(r.Header.Get("X-AgentHub-Target-Id"))
		if reqTarget == "" {
			reqTarget = strings.TrimSpace(r.URL.Query().Get("targetId"))
		}
		if reqTarget == "" || reqTarget != targetID {
			return errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token target_id %q does not match request target %q", targetID, reqTarget)
		}
	}
	// Cross-check identity: if the middleware injected Hub identity into the
	// context, verify the capability token binds the same user.
	if id := edgeidentity.FromContext(r.Context()); id.UserID != "" {
		if capClaims.UserID != id.UserID {
			return errcode.ErrCapabilityTokenInvalid.WithMessagef("capability token user_id %q does not match identity user %q", capClaims.UserID, id.UserID)
		}
	}
	return nil
}

// validateRunCreateState previously performed pre-create validation here; the
// shared run-creation core (internal/runcontrol.Create) now owns the entire
// validation + creation + executor sequence for both REST and MCP.

// publishRunPromptItem stores the run prompt as a user_message item and
// publishes message.created / item.created events. Failure is non-fatal.
func publishRunPromptItem(h *Handler, run store.Run, prompt string) {
	if strings.TrimSpace(prompt) == "" {
		return
	}
	item, err := ensureStore(h).CreateItem(store.Item{
		ID:        genID("item_"),
		ProjectID: run.ProjectID,
		ThreadID:  run.ThreadID,
		RunID:     run.ID,
		Type:      "user_message",
		Role:      "user",
		Status:    "created",
		Content:   prompt,
	})
	if err != nil {
		return
	}
	itemScope := map[string]any{
		"projectId": item.ProjectID,
		"threadId":  item.ThreadID,
		"runId":     item.RunID,
		"itemId":    item.ID,
	}
	h.Bus.Publish("message.created", itemScope, item)
	h.Bus.Publish("item.created", itemScope, item)
}

// publishRunQueuedItem records the queued run marker item in the timeline.
func publishRunQueuedItem(h *Handler, run store.Run) {
	_, _ = ensureStore(h).CreateItem(store.Item{
		ID:        genID("item_"),
		ProjectID: run.ProjectID,
		ThreadID:  run.ThreadID,
		RunID:     run.ID,
		Type:      "run",
		Status:    "queued",
		Content:   "Run queued",
	})
}

// buildRunContext builds the run process context (skills, memory, MCP
// config) for the shared run-creation core. The executor start and the
// failure state transition live in runcontrol.Create.
func (h *Handler) buildRunContext(run store.Run, req *runRequest) lifecycle.RunProcessContext {
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
		TraceID:                req.TraceID,
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
	return runCtx
}

func (h *Handler) PostRuns(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		return
	}

	req, decodeErr := decodeRunRequest(r)
	if decodeErr != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(decodeErr))
		return
	}

	// Merge profile defaults: profile fields fill in blanks, request fields win.
	h.applyProfileDefaults(&req)

	if req.ProjectID == "" {
		req.ProjectID = "proj_local"
	}
	if req.ThreadID == "" {
		req.ThreadID = "thread_local"
	}
	if (req.SessionID == "" || req.SessionID == req.ThreadID) && !req.Ephemeral {
		req.SessionID = runtimeSessionIDForThread(req.ThreadID)
	}

	// Dual-token auth (AH-SR-046): see validateCapabilityRequest for the
	// full policy. Failures are always 403.
	if err := h.validateCapabilityRequest(r, &req); err != nil {
		writeJSON(w, http.StatusForbidden, errcode.ErrorBody(err))
		return
	}

	repository := ensureStore(h)

	// Auto-detect continue: when the thread has prior assistant messages,
	// set ContinueLast = true so adapters can resume the conversation.
	// Each run creates a fresh CC conversation via --session-id.
	if !req.Continue && threadHasAssistantHistory(repository, req.ThreadID) {
		req.Continue = true
	}
	// WorkDir normalization previously happened inside validateRunCreateState;
	// the shared core also trims, this keeps the context builder consistent.
	req.WorkDir = strings.TrimSpace(req.WorkDir)

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

	// Classify prompt complexity for execution strategy selection.
	// Complex tasks may benefit from orchestration/TeamRun; Simple tasks
	// can dispatch directly to a single agent.
	promptComplexity := router.ClassifyComplexity(req.Prompt)
	slog.Debug("run.complexity", "complexity", promptComplexity,
		"promptLen", len(req.Prompt), "agentId", req.AgentID)

	// The shared run-creation core (internal/runcontrol) owns validation,
	// active-run guarding, run record creation, run.queued publication, and
	// the executor start/failure state machine — REST and MCP share it. REST
	// contributes the timeline policy and the adapter context builder.
	run, err := runcontrol.Create(repository, h.Executor, h.Bus, runcontrol.CreateParams{
		ProjectID:          req.ProjectID,
		ThreadID:           req.ThreadID,
		Prompt:             req.Prompt,
		AgentID:            req.AgentID,
		Model:              req.Model,
		PermissionMode:     req.PermissionMode,
		SessionID:          req.SessionID,
		ContinueLast:       req.Continue,
		WorkDir:            req.WorkDir,
		HubTaskID:          req.HubTaskID,
		WorkspaceAllowlist: h.WorkspaceAllowlist,
		AgentExists: func(agentID string) bool {
			if h.AdapterRegistry == nil {
				return true // no registry in scope; skip the #175 check
			}
			_, ok := h.AdapterRegistry.Get(agentID)
			return ok
		},
		Cleanup: true,
		Timeline: func(run store.Run) {
			publishRunPromptItem(h, run, req.Prompt)
			publishRunQueuedItem(h, run)
		},
		BuildContext: func(run store.Run) lifecycle.RunProcessContext {
			return h.buildRunContext(run, &req)
		},
	})
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			// Enrich the active-run conflict with the conflicting run,
			// preserving the historical response body shape.
			if errors.Is(err, errcode.ErrActiveRunExists) {
				if active, found := runcontrol.ActiveRunForThread(repository.ListRuns(req.ThreadID)); found {
					writeJSON(w, http.StatusConflict, activeRunExistsResponse(active))
					return
				}
			}
			writeJSON(w, e.HTTPStatus, errcode.ErrorBody(e))
			return
		}
		writeJSON(w, http.StatusInternalServerError, errcode.ErrorBody(errcode.ErrInternal.WithMessagef("%v", err)))
		return
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
