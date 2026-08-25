package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/adapters/orchestrator"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/ccswitch"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/metrics"
	"github.com/agenthub/edge-server/internal/permission"
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
	PreviewRunner      lifecycle.PreviewRunner
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
	// EdgeDeviceID is the local Edge device ID used to validate Hub-issued
	// identity JWTs and capability tokens are scoped to this device.
	EdgeDeviceID string
	// CallbackClient is the optional Edge→Hub callback client (AH-SR-049 journal).
	CallbackClient interface {
		DurableSnapshot(afterSeq uint64) ([]hub.DeliveryJournalEntry, error)
	}

	PermissionRegistry *permission.PermissionRegistry
	PermissionBroker   *adapters.PermissionDecisionBroker

	// PlanApprovalBroker manages pending orchestrator plans and connects
	// them to user approval/rejection decisions (P0 #3: plan confirmation gate).
	PlanApprovalBroker *orchestrator.PlanApprovalBroker

	// MCPConfigStore holds Hub-synced MCP server configs for injection into runs.
	// When non-nil, run creation merges Hub-synced configs into the run's MCPConfig.
	MCPConfigStore *adapters.MCPConfigStore

	// CCSwitchStatus holds the detected cc-switch installation status.
	// nil means cc-switch was not found on this machine.
	CCSwitchStatus *ccswitch.Status

	// CCSwitchReader reads cc-switch database for model alias resolution.
	// nil means cc-switch is not installed or database is not readable.
	CCSwitchReader *ccswitch.Reader

	// SessionHome optionally overrides the home root used by GET /v1/runtime-sessions
	// (sessionindex). Empty = env HOME/USERPROFILE or os.UserHomeDir.
	// Tests inject a temp dir so real foreign session stores are never scanned.
	SessionHome string

	// ShutdownHooks are invoked in order during graceful shutdown (after HTTP
	// Shutdown and before Bus.Close). newHandlerFromConfig appends internal
	// stops (result aggregator, token provider) here; Run() drains the slice
	// at shutdown. Tests read it to assert auto-rotation stop is registered
	// when a HubRefreshToken is configured (#1410 graceful-shutdown contract).
	ShutdownHooks []func()

	permissionRegistryMu      sync.Mutex
	permissionObserverCancel  func()
	permissionBrokerInstalled bool
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
	// CloseCodeEventGap is the WebSocket close code sent when the event bus
	// detects dropped events for this subscriber. The client should reconnect
	// with a known-good cursor to trigger a full resync.
	CloseCodeEventGap = 4001
)

// denyRemoteHubSharedConfig blocks multi-user / Hub JWT callers from reading
// Edge-local shared configuration surfaces that have no per-user owner binding
// (AH-SR-045 / #878). Local single-tenant mode (no Hub JWT secret configured)
// remains allowed; empty userID under multi-user mode fails closed.
func (h *Handler) denyRemoteHubSharedConfig(w http.ResponseWriter, r *http.Request) bool {
	if isLocalSingleTenant(h.ownerUserID(r)) {
		return false
	}
	writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("not found")))
	return true
}

func (h *Handler) validateWorkDirAllowed(workDir string) error {
	// Empty workDir is allowed for non-run endpoints (e.g. optional read paths).
	if workDir == "" {
		return nil
	}
	// Shared REST/MCP allowlist policy (AH-SR-006 / #998): EvalSymlinks + IsPathWithin.
	err := security.ValidateWorkDirAgainstAllowlist(workDir, h.WorkspaceAllowlist)
	if err == nil {
		return nil
	}
	if errors.Is(err, security.ErrWorkspaceAllowlistEmpty) {
		// Fail-closed: empty allowlist rejects any non-empty workDir.
		return fmt.Errorf("workspace allowlist is not configured; configure at least one allowed workspace root to enable file system access")
	}
	if errors.Is(err, security.ErrWorkspaceOutsideAllowlist) {
		return fmt.Errorf("workDir is outside the Edge workspace allowlist")
	}
	return err
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
	_, _ = h.Store.CreateProject("proj_local", "Local Project", "")
	_, _ = h.Store.CreateThread("thread_local", "proj_local", "Local Thread", "direct", "", "")
}

func ensureBus(h *Handler) *events.Bus {
	if h.Bus == nil {
		h.Bus = events.NewBus(10000)
	}
	return h.Bus
}

func ensurePreviewRunner(h *Handler, repository store.Repository) lifecycle.PreviewRunner {
	if h.PreviewRunner == nil {
		h.PreviewRunner = lifecycle.NewFakePreviewRunner(repository)
	}
	return h.PreviewRunner
}

func (h *Handler) ensurePermissionRegistry() *permission.PermissionRegistry {
	h.permissionRegistryMu.Lock()
	defer h.permissionRegistryMu.Unlock()
	if h.PermissionRegistry == nil {
		h.PermissionRegistry = permission.NewPermissionRegistry(0)
	}
	if h.PermissionBroker == nil {
		h.PermissionBroker = adapters.NewPermissionDecisionBroker()
	}
	h.installPermissionBrokerLocked()
	if h.permissionObserverCancel == nil {
		h.permissionObserverCancel = ensureBus(h).AddObserver(h.PermissionRegistry.ObserveEvent)
	}
	return h.PermissionRegistry
}

type permissionBrokerConfigurer interface {
	SetPermissionBroker(*adapters.PermissionDecisionBroker)
}

func (h *Handler) ensurePermissionBroker() *adapters.PermissionDecisionBroker {
	h.permissionRegistryMu.Lock()
	defer h.permissionRegistryMu.Unlock()
	if h.PermissionBroker == nil {
		h.PermissionBroker = adapters.NewPermissionDecisionBroker()
	}
	h.installPermissionBrokerLocked()
	return h.PermissionBroker
}

func (h *Handler) installPermissionBrokerLocked() {
	if h.permissionBrokerInstalled || h.PermissionBroker == nil || h.AdapterRegistry == nil {
		return
	}
	for _, metadata := range h.AdapterRegistry.List() {
		adapter, ok := h.AdapterRegistry.Get(metadata.ID)
		if !ok {
			continue
		}
		if configurable, ok := adapter.(permissionBrokerConfigurer); ok {
			configurable.SetPermissionBroker(h.PermissionBroker)
		}
	}
	h.permissionBrokerInstalled = true
}

// ── Settings handlers ──────────────────────────────────────

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	ensureStore(h)
	h.ensurePermissionRegistry()
	mux.HandleFunc("/v1/health", h.GetHealth)
	mux.HandleFunc("/v1/delivery-journal", h.GetDeliveryJournal)
	mux.HandleFunc("/v1/runners", h.GetRunners)
	mux.HandleFunc("/v1/agents", h.GetAgents)
	mux.HandleFunc("/v1/model-catalog", h.GetModelCatalog)
	h.registerProjectRoutes(mux)
	h.registerThreadRoutes(mux)
	h.registerItemRoutes(mux)
	h.registerRunRoutes(mux)
	h.registerArtifactRoutes(mux)
	h.registerPreviewRoutes(mux)
	mux.HandleFunc("/v1/metrics", h.GetMetrics)
	mux.HandleFunc("/v1/events", h.GetEvents)
	h.registerAgentInstanceRoutes(mux)
	h.registerPlanRoutes(mux)
	h.registerUserRoutes(mux)
	h.registerAgentProfileRoutes(mux)
	h.registerSettingsRoutes(mux)
	h.registerDeploymentAndMemoryRoutes(mux)
}

// registerProjectRoutes wires the /v1/projects and /v1/projects/ handlers.
func (h *Handler) registerProjectRoutes(mux *http.ServeMux) {
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
}

// registerThreadRoutes wires the /v1/threads and /v1/threads/ handlers,
// including the /items, /pins, /messages and :archive sub-routes.
func (h *Handler) registerThreadRoutes(mux *http.ServeMux) {
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
	mux.HandleFunc("/v1/threads/", h.handleThreadSubRoute)
}

// handleThreadSubRoute dispatches /v1/threads/{threadId}... sub-routes.
func (h *Handler) handleThreadSubRoute(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/items") && r.Method == http.MethodGet {
		threadID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/threads/"), "/items")
		h.GetThreadItems(w, r, threadID)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/pins") {
		threadID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/threads/"), "/pins")
		switch r.Method {
		case http.MethodGet:
			h.GetThreadPins(w, r, threadID)
		case http.MethodPost:
			h.PostThreadPin(w, r, threadID)
		case http.MethodDelete:
			h.DeleteThreadPin(w, r, threadID)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		}
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
}

// registerItemRoutes wires the /v1/items/ handler.
func (h *Handler) registerItemRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/v1/items/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			h.GetItem(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
}

// registerRunRoutes wires the /v1/runs and /v1/runs/ handlers, including the
// :cancel, /diff, /apply and /apply-all sub-routes.
func (h *Handler) registerRunRoutes(mux *http.ServeMux) {
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
	mux.HandleFunc("/v1/runs/", h.handleRunSubRoute)
}

// handleRunSubRoute dispatches /v1/runs/{runId}... sub-routes.
func (h *Handler) handleRunSubRoute(w http.ResponseWriter, r *http.Request) {
	// Routes with runId suffix: /v1/runs/{runId}:cancel
	if strings.HasSuffix(r.URL.Path, ":cancel") && r.Method == http.MethodPost {
		h.PostCancelRun(w, r)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/diff") && r.Method == http.MethodGet {
		runID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/runs/"), "/diff")
		h.GetRunDiff(w, r, runID)
		return
	}
	// POST /v1/runs/{runId}/apply — apply a single hunk decision
	if strings.HasSuffix(r.URL.Path, "/apply") && r.Method == http.MethodPost {
		runID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/runs/"), "/apply")
		h.PostApplyRunDiff(w, r, runID)
		return
	}
	// POST /v1/runs/{runId}/apply-all — batch apply multiple hunk decisions
	if strings.HasSuffix(r.URL.Path, "/apply-all") && r.Method == http.MethodPost {
		runID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/runs/"), "/apply-all")
		h.PostApplyAllRunDiffs(w, r, runID)
		return
	}
	// GET /v1/runs/{runId}/checkpoint/file — single checkpoint file preview (#1968)
	if strings.HasSuffix(r.URL.Path, "/checkpoint/file") && r.Method == http.MethodGet {
		runID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/runs/"), "/checkpoint/file")
		h.GetRunCheckpointFile(w, r, runID)
		return
	}
	// GET /v1/runs/{runId}/checkpoint — checkpoint metadata + inventory (#1968)
	if strings.HasSuffix(r.URL.Path, "/checkpoint") && r.Method == http.MethodGet {
		runID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/runs/"), "/checkpoint")
		h.GetRunCheckpoint(w, r, runID)
		return
	}
	if r.Method == http.MethodGet {
		runID := strings.TrimPrefix(r.URL.Path, "/v1/runs/")
		repo := ensureStore(h)
		userID := h.ownerUserID(r)
		if run, ok := repo.GetRun(runID); ok {
			if !isRunOwnedBy(repo, run.ID, userID) {
				writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("run not found")))
				return
			}
			writeSuccess(w, http.StatusOK, runToResponse(run))
			return
		}
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("run not found")))
		return
	}
	writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound))
}

// registerArtifactRoutes wires the /v1/artifacts and /v1/artifacts/ handlers.
func (h *Handler) registerArtifactRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/v1/artifacts", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			h.GetArtifacts(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
	mux.HandleFunc("/v1/artifacts/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			artifactID := strings.TrimPrefix(r.URL.Path, "/v1/artifacts/")
			h.GetArtifact(w, r, artifactID)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
}

// registerPreviewRoutes wires the /v1/previews and /v1/previews/ handlers.
func (h *Handler) registerPreviewRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/v1/previews", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetPreviews(w, r)
		case http.MethodPost:
			h.PostPreview(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		}
	})
	mux.HandleFunc("/v1/previews/", func(w http.ResponseWriter, r *http.Request) {
		previewPath := strings.TrimPrefix(r.URL.Path, "/v1/previews/")
		if strings.HasSuffix(previewPath, ":stop") {
			if r.Method == http.MethodPost {
				h.PostPreviewStop(w, r, strings.TrimSuffix(previewPath, ":stop"))
				return
			}
			writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
			return
		}
		if r.Method == http.MethodGet {
			h.GetPreview(w, r, previewPath)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
}

// registerAgentInstanceRoutes wires the /v1/agent-instances handlers.
func (h *Handler) registerAgentInstanceRoutes(mux *http.ServeMux) {
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
}

// registerPlanRoutes wires the permission and plan approval endpoints
// (P0 #3: plan confirmation gate).
func (h *Handler) registerPlanRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/v1/permissions/decide", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			h.PostPermissionDecide(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
	mux.HandleFunc("/v1/plans/decide", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			h.PostPlanDecide(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
	mux.HandleFunc("/v1/plans/pending", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			h.GetPlansPending(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
}

// registerUserRoutes wires the user profile endpoints.
func (h *Handler) registerUserRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/v1/users", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			writeSuccess(w, http.StatusOK, listResponse(ensureStore(h).ListUserProfiles()))
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
	mux.HandleFunc("/v1/users/current", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			if profile, ok := ensureStore(h).GetCurrentUser(); ok {
				writeSuccess(w, http.StatusOK, profile)
				return
			}
			writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("no current user")))
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
}

// registerAgentProfileRoutes wires the /v1/agent-profiles handlers.
func (h *Handler) registerAgentProfileRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/v1/agent-profiles", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetAgentProfiles(w, r)
		case http.MethodPost:
			h.PostAgentProfiles(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		}
	})
	mux.HandleFunc("/v1/agent-profiles/", func(w http.ResponseWriter, r *http.Request) {
		profileID := strings.TrimPrefix(r.URL.Path, "/v1/agent-profiles/")
		if profileID == "" {
			writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage("profile id required")))
			return
		}
		switch r.Method {
		case http.MethodGet:
			h.GetAgentProfile(w, r, profileID)
		case http.MethodPatch:
			h.PatchAgentProfile(w, r, profileID)
		case http.MethodDelete:
			h.DeleteAgentProfile(w, r, profileID)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		}
	})
}

// registerSettingsRoutes wires the settings, runtime session and cc-switch
// endpoints.
func (h *Handler) registerSettingsRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/v1/settings", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetSettings(w, r)
		case http.MethodPatch:
			h.PatchSettings(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		}
	})
	// Local runtime session aggregation index (read-only import discover)
	mux.HandleFunc("/v1/runtime-sessions", h.GetRuntimeSessions)
	// cc-switch integration
	mux.HandleFunc("/v1/ccswitch/status", h.GetCCSwitchStatus)
	mux.HandleFunc("/v1/ccswitch/providers", h.GetCCSwitchProviders)
}

// registerDeploymentAndMemoryRoutes wires the deployments and memory endpoints.
func (h *Handler) registerDeploymentAndMemoryRoutes(mux *http.ServeMux) {
	// Deployments (static site deploy to *.example.agenthub.dev)
	mux.HandleFunc("/v1/deployments", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			h.PostDeployments(w, r)
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
	})
	// Memory
	mux.HandleFunc("/v1/memory", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetMemory(w, r)
		case http.MethodPost:
			h.PostMemory(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		}
	})
}
