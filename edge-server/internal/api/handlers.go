package api

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/ccswitch"
	"github.com/agenthub/edge-server/internal/edgeidentity"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/metrics"
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

	PermissionRegistry *PermissionRegistry
	PermissionBroker   *adapters.PermissionDecisionBroker

	// PlanApprovalBroker manages pending orchestrator plans and connects
	// them to user approval/rejection decisions (P0 #3: plan confirmation gate).
	PlanApprovalBroker *adapters.PlanApprovalBroker

	// MCPConfigStore holds Hub-synced MCP server configs for injection into runs.
	// When non-nil, run creation merges Hub-synced configs into the run's MCPConfig.
	MCPConfigStore *adapters.MCPConfigStore

	// CCSwitchStatus holds the detected cc-switch installation status.
	// nil means cc-switch was not found on this machine.
	CCSwitchStatus *ccswitch.CCSwitchStatus

	// CCSwitchReader reads cc-switch database for model alias resolution.
	// nil means cc-switch is not installed or database is not readable.
	CCSwitchReader *ccswitch.Reader

	runCreateMu               sync.Mutex
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

// hubUserFromRequest extracts the Hub-authenticated user ID from the request context.
// Returns empty string if the request was not authenticated via Hub JWT.
func hubUserFromRequest(r *http.Request) string {
	return edgeidentity.FromContext(r.Context()).UserID
}

// filterProjectsByOwner filters a list of projects to those owned by the given user,
// or all projects when userID is empty (local auth / unowned access).
func filterProjectsByOwner(projects []store.Project, userID string) []store.Project {
	if userID == "" {
		return projects
	}
	filtered := make([]store.Project, 0, len(projects))
	for _, p := range projects {
		if p.OwnerID == "" || p.OwnerID == userID {
			filtered = append(filtered, p)
		}
	}
	return filtered
}

// filterThreadsByOwner filters threads to those whose parent project is owned by the
// given user (or is unowned). Pass userID="" to skip filtering (local auth).
func filterThreadsByOwner(threads []store.Thread, repo store.Reader, userID string) []store.Thread {
	if userID == "" {
		return threads
	}
	filtered := make([]store.Thread, 0, len(threads))
	for _, t := range threads {
		proj, ok := repo.GetProject(t.ProjectID)
		if !ok {
			continue
		}
		if proj.OwnerID == "" || proj.OwnerID == userID {
			filtered = append(filtered, t)
		}
	}
	return filtered
}

// filterRunsByOwner filters runs to those whose parent project (via thread) is owned
// by the given user (or is unowned). Pass userID="" to skip filtering (local auth).
func filterRunsByOwner(runs []store.Run, repo store.Reader, userID string) []store.Run {
	if userID == "" {
		return runs
	}
	filtered := make([]store.Run, 0, len(runs))
	for _, r := range runs {
		proj, ok := repo.GetProject(r.ProjectID)
		if !ok {
			continue
		}
		if proj.OwnerID == "" || proj.OwnerID == userID {
			filtered = append(filtered, r)
		}
	}
	return filtered
}

// isProjectOwnedBy checks if the project with the given ID is owned by the user.
// Returns true if userID is empty (local auth), the project is unowned, or the project
// is owned by the user.
func isProjectOwnedBy(repo store.Reader, projectID, userID string) bool {
	if userID == "" {
		return true
	}
	proj, ok := repo.GetProject(projectID)
	if !ok {
		return false
	}
	return proj.OwnerID == "" || proj.OwnerID == userID
}

// isThreadOwnedBy checks if the thread with the given ID is accessible to the user.
func isThreadOwnedBy(repo store.Reader, threadID, userID string) bool {
	if userID == "" {
		return true
	}
	thread, ok := repo.GetThread(threadID)
	if !ok {
		return false
	}
	return isProjectOwnedBy(repo, thread.ProjectID, userID)
}

// isRunOwnedBy checks if the run with the given ID is accessible to the user.
func isRunOwnedBy(repo store.Reader, runID, userID string) bool {
	if userID == "" {
		return true
	}
	run, ok := repo.GetRun(runID)
	if !ok {
		return false
	}
	return isProjectOwnedBy(repo, run.ProjectID, userID)
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
	_, _ = h.Store.CreateProject("proj_local", "Local Project", "")
	_, _ = h.Store.CreateThread("thread_local", "proj_local", "Local Thread", "direct", "", "")
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

func ensurePreviewRunner(h *Handler, repository store.Repository) lifecycle.PreviewRunner {
	if h.PreviewRunner == nil {
		h.PreviewRunner = lifecycle.NewFakePreviewRunner(repository)
	}
	return h.PreviewRunner
}

func (h *Handler) ensurePermissionRegistry() *PermissionRegistry {
	h.permissionRegistryMu.Lock()
	defer h.permissionRegistryMu.Unlock()
	if h.PermissionRegistry == nil {
		h.PermissionRegistry = NewPermissionRegistry(0)
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
		if r.Method == http.MethodGet {
			runID := strings.TrimPrefix(r.URL.Path, "/v1/runs/")
			repo := ensureStore(h)
			userID := hubUserFromRequest(r)
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
	})
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
	// Plan approval gate (P0 #3: Plan confirmation gate)
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
	// User profiles
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
	// Agent profiles
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
	// Settings
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
	// cc-switch integration
	mux.HandleFunc("/v1/ccswitch/status", h.GetCCSwitchStatus)
	mux.HandleFunc("/v1/ccswitch/providers", h.GetCCSwitchProviders)
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
