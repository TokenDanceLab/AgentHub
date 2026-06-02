package httpserver

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/api"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/jwtutil"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/metrics"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/security"
	"github.com/agenthub/edge-server/internal/skills"
	"github.com/agenthub/edge-server/internal/store"
)

// ctxKey is a private context key type for injecting auth identity.
type ctxKey string

const (
	ctxKeyHubUserID   ctxKey = "hub_user_id"
	ctxKeyHubDeviceID ctxKey = "hub_device_id"
)

// HubUserIDFromContext extracts the Hub-authenticated user ID from context.
// Returns empty string if the request was not authenticated via Hub JWT.
func HubUserIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeyHubUserID).(string); ok {
		return v
	}
	return ""
}

// Config holds server configuration.
type Config struct {
	Addr               string
	Store              store.Repository
	ProcessExecutor    lifecycle.ProcessExecutorConfig
	AdapterRegistry    *adapters.Registry // agent adapter registry; nil = none registered
	AgentDefault       string             // default agent adapter ID; empty = raw stdout capture
	LocalAuthToken     string             // optional local bearer token for non-health Edge APIs
	HubJWTSecret       string             // shared secret for validating Hub-issued HS256 JWTs
	HubURL             string             // Hub server base URL for Edge->Hub direct callbacks
	HubToken           string             // JWT bearer token for Hub callback authentication
	RemoteMode         bool               // allow non-loopback bind + remote origins (requires auth)
	Dev                bool               // dev mode disables auto-generated local auth token
	WorkspaceAllowlist []string           // optional roots allowed for request workDir
	SkillsDirs         []string           // optional SKILL.md search dirs; empty = use defaults
	EventLogPath       string             // optional append-only event log path for crash recovery and replay; empty = no persistence (events exist only in-memory)
}

const defaultRESTRequestTimeout = 30 * time.Second

// Run starts the HTTP server and blocks until a shutdown signal is received.
func Run(cfg Config) error {
	if cfg.Addr == "" {
		cfg.Addr = "127.0.0.1:3210"
	}
	if cfg.RemoteMode {
		if err := security.ValidateRemoteListenAddr(cfg.Addr); err != nil {
			return err
		}
	} else {
		if err := security.ValidateLocalListenAddr(cfg.Addr); err != nil {
			return err
		}
	}
	handler, err := newHandlerFromConfig(cfg)
	if err != nil {
		return err
	}

	// Auto-generate a random local auth token when running in non-dev mode
	// without an explicitly configured auth token. This is the primary
	// defense layer between browsers and the local agent runtime: a malicious
	// local process or XSS from a local web app cannot invoke state-changing
	// endpoints (POST/PATCH/DELETE) or subscribe to the live event stream (GET /v1/events with WebSocket upgrade) without the token.
	// Use --dev or AGENTHUB_DEV=1 to disable auto-generated auth for local
	// development. Use --local-auth-token or AGENTHUB_EDGE_AUTH_TOKEN to set
	// a specific token.
	if !cfg.Dev && cfg.LocalAuthToken == "" && cfg.HubJWTSecret == "" {
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			return fmt.Errorf("failed to generate local auth token: %w", err)
		}
		cfg.LocalAuthToken = "aght_" + hex.EncodeToString(tokenBytes)
		slog.Info("auto-generated local auth token for Edge Server API protection; "+
			"pass this token via Authorization: Bearer <token> header or ?access_token=<token> query parameter for WebSocket connections",
			"token_prefix", cfg.LocalAuthToken[:16]+"...")
	}

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	// Expose Prometheus metrics on /metrics for Prometheus scraping.
	mux.Handle("/metrics", handler.Metrics.Handler())

	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: corsMiddleware(restTimeoutMiddleware(localAuthMiddleware(mux, cfg.LocalAuthToken, cfg.HubJWTSecret), defaultRESTRequestTimeout), cfg.RemoteMode),
		// WriteTimeout=0: WebSocket connections are long-lived and manage their
		// own deadlines. REST requests are guarded by restTimeoutMiddleware.
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown on SIGINT/SIGTERM.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		slog.Info("edge server listening", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-stop
	slog.Info("shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		return err
	}

	// Flush and close the event log so no events are lost on shutdown.
	if err := handler.Bus.Close(); err != nil {
		slog.Error("failed to close event bus event log", "err", err)
	}
	return nil
}

func newHandlerFromConfig(cfg Config) (*api.Handler, error) {
	if cfg.Store == nil {
		cfg.Store = store.New()
	}

	busOpts := []events.BusOption{}
	if cfg.EventLogPath != "" {
		busOpts = append(busOpts, events.WithEventLogPath(cfg.EventLogPath))
	}
	bus := events.NewBus(10000, busOpts...)
	reg := runners.NewRegistry()

	// Prometheus metrics wired to bus depth
	edgeMetrics := metrics.NewWithBusStats(
		func() float64 { return float64(bus.HistoryLen()) },
		func() float64 { return float64(bus.DroppedCount()) },
	)

	var executor lifecycle.RunExecutor
	hasAdapter := cfg.AdapterRegistry != nil && cfg.AgentDefault != ""

	agentReg := agents.NewRegistry()
	msgQueue := agents.NewQueue()

	// Result aggregator collects sub-agent output and routes it back to the parent orchestrator.
	resultAgg := lifecycle.NewResultAggregator(bus, agentReg)
	_ = resultAgg.Start() // stop function; goroutine exits on process shutdown

	if cfg.ProcessExecutor.Command != "" || hasAdapter {
		execCfg := cfg.ProcessExecutor
		if execCfg.Command == "" && hasAdapter {
			// No static command configured; the adapter's BuildCommand supplies the real path.
			// Use a sentinel value so NewProcessExecutor passes the non-empty check.
			execCfg.Command = "agenthub-adapter-sentinel"
		}
		// Resolve the default agent adapter if configured
		var agentAdapter adapters.AgentAdapter
		if cfg.AdapterRegistry != nil && cfg.AgentDefault != "" {
			if a, ok := cfg.AdapterRegistry.Get(cfg.AgentDefault); ok {
				agentAdapter = a
			}
		}
		processExecutor, err := lifecycle.NewProcessExecutor(bus, cfg.Store, execCfg, agentAdapter, cfg.AdapterRegistry)
		if err != nil {
			return nil, err
		}
		processExecutor.SetMetrics(edgeMetrics)
		processExecutor.WithAgentRegistry(agentReg).WithMessageQueue(msgQueue).WithResultAggregator(resultAgg)

		// Wire Hub callback client for Edge-to-Hub direct bridge
		if cfg.HubURL != "" {
			hubClient := hub.NewCallbackClient(cfg.HubURL, cfg.HubToken)
			processExecutor.WithHubCallback(hubClient)
			slog.Info("edge-to-hub direct callback enabled", "hubURL", cfg.HubURL)
		}

		executor = processExecutor
	}
	configureLocalRunner(reg, cfg.ProcessExecutor, agentAdapterForRegistry(cfg.AdapterRegistry, cfg.AgentDefault), executor)

	// Wire orchestrator adapter with runtime dependencies so it can spawn sub-agents.
	wireOrchestrator(cfg.AdapterRegistry, executor, agentReg, msgQueue)

	// Build SkillRegistry from configured directories. Discovery failure is
	// non-fatal — skills injection is purely optional.
	skillsDirs := cfg.SkillsDirs
	if len(skillsDirs) == 0 {
		skillsDirs = skills.DefaultDirs("")
	}
	skillReg := skills.NewSkillRegistry(skillsDirs)
	if err := skillReg.Discover(); err != nil {
		slog.Warn("skill discovery failed; skills will not be injected", "err", err)
	} else if skillReg.Count() > 0 {
		slog.Info("loaded skills", "count", skillReg.Count(), "dirs", skillsDirs)
	}

	h := &api.Handler{
		Bus:                bus,
		Registry:           reg,
		Store:              cfg.Store,
		Executor:           executor,
		AdapterRegistry:    cfg.AdapterRegistry,
		AgentRegistry:      agentReg,
		MessageQueue:       msgQueue,
		Metrics:            edgeMetrics,
		WorkspaceAllowlist: append([]string(nil), cfg.WorkspaceAllowlist...),
		SkillRegistry:      skillReg,
	}
	// Validate security-critical configuration at startup.
	// An empty workspace allowlist means all non-empty workDir values
	// will be rejected (fail-closed).  Warn the operator so they are
	// aware that file-system runs are unavailable until configured.
	if len(cfg.WorkspaceAllowlist) == 0 {
		slog.Warn("workspace allowlist is empty — requests with a non-empty workDir will be rejected; configure --workspace-allowlist or AGENTHUB_WORKSPACE_ALLOWLIST to allow file system access")
	}
	// Create default project/thread fixtures so POST /v1/runs
	// with empty projectId/threadId works out of the box.
	if cfg.Store != nil {
		_, _ = cfg.Store.CreateProject("proj_local", "Local Project")
		_, _ = cfg.Store.CreateThread("thread_local", "proj_local", "Local Thread")
	}
	return h, nil
}

func agentAdapterForRegistry(adapterReg *adapters.Registry, agentDefault string) adapters.AgentAdapter {
	if adapterReg == nil || agentDefault == "" {
		return nil
	}
	agentAdapter, ok := adapterReg.Get(agentDefault)
	if !ok {
		return nil
	}
	return agentAdapter
}

func configureLocalRunner(reg *runners.Registry, execCfg lifecycle.ProcessExecutorConfig, agentAdapter adapters.AgentAdapter, executor lifecycle.RunExecutor) {
	if reg == nil || executor == nil {
		return
	}
	if agentAdapter != nil {
		metadata := agentAdapter.Metadata()
		reg.Upsert(runners.RunnerInfo{
			ID:           "runner_local_1",
			Name:         metadata.Name + " Runner (local)",
			Status:       "online",
			Capabilities: runnerCapabilitiesForAdapter(metadata.ID, agentAdapter.Capabilities()),
		})
		return
	}
	if execCfg.Command != "" {
		reg.Upsert(runners.RunnerInfo{
			ID:           "runner_local_1",
			Name:         "Process Runner (local)",
			Status:       "online",
			Capabilities: []string{"process", "shell"},
		})
	}
}

func runnerCapabilitiesForAdapter(adapterID string, caps adapters.AgentCapabilities) []string {
	capabilities := []string{adapterID}
	if caps.Streaming {
		capabilities = append(capabilities, "streaming")
	}
	if caps.ToolCalls {
		capabilities = append(capabilities, "tool_calls")
	}
	if caps.FileChanges {
		capabilities = append(capabilities, "file_changes")
	}
	if caps.PermissionHooks {
		capabilities = append(capabilities, "permission_hooks")
	}
	if caps.ThinkingVisible {
		capabilities = append(capabilities, "thinking_visible")
	}
	if caps.MultiTurn {
		capabilities = append(capabilities, "multi_turn")
	}
	if caps.MCPIntegration {
		capabilities = append(capabilities, "mcp_integration")
	}
	if caps.SubAgentSpawn {
		capabilities = append(capabilities, "sub_agent_spawn")
	}
	return capabilities
}

// wireOrchestrator sets the SubAgentSpawner, AgentRegistry, and MessageQueue on
// the orchestrator adapter so it can spawn sub-agent runs during ParseStream.
func wireOrchestrator(adapterReg *adapters.Registry, executor lifecycle.RunExecutor, agentReg *agents.Registry, msgQueue *agents.Queue) {
	if adapterReg == nil || executor == nil {
		return
	}
	orch, ok := adapterReg.Get("orchestrator")
	if !ok {
		return
	}
	orchAdapter, ok := orch.(*adapters.OrchestratorAdapter)
	if !ok {
		return
	}
	// Wire runtime dependencies into the orchestrator adapter.
	if spawner, ok := executor.(adapters.SubAgentSpawner); ok {
		orchAdapter.WithSpawner(spawner)
	}
	orchAdapter.WithAgentRegistry(agentReg)
	orchAdapter.WithMessageQueue(msgQueue)
}

func corsMiddleware(next http.Handler, remoteMode bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !security.IsTrustedOrigin(origin, remoteMode) {
				http.Error(w, "forbidden origin", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-AgentHub-Edge-Token")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func localAuthMiddleware(next http.Handler, localAuthToken string, hubJWTSecret string) http.Handler {
	localAuthToken = strings.TrimSpace(localAuthToken)
	hubJWTSecret = strings.TrimSpace(hubJWTSecret)

	// Local dev mode: no auth configured.
	if localAuthToken == "" && hubJWTSecret == "" {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isLocalAuthExempt(r) {
			next.ServeHTTP(w, r)
			return
		}

		for _, got := range authTokenCandidates(r) {
			// Skip TokenDance bearer tokens (td_ prefix) — they are NOT Edge sessions.
			if strings.HasPrefix(got, "td_") {
				continue
			}

			// 1. Try Hub JWT validation (TokenDance ID → Hub → Edge trust chain).
			if hubJWTSecret != "" {
				if claims, err := jwtutil.ValidateHubToken(got, []byte(hubJWTSecret)); err == nil {
					ctx := context.WithValue(r.Context(), ctxKeyHubUserID, claims.UserID)
					ctx = context.WithValue(ctx, ctxKeyHubDeviceID, claims.DeviceID)
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
			}

			// 2. Fallback to pre-shared local auth token.
			if localAuthToken != "" && constantTimeEqual(got, localAuthToken) {
				next.ServeHTTP(w, r)
				return
			}
		}

		w.Header().Set("WWW-Authenticate", `Bearer realm="agenthub-edge"`)
		http.Error(w, "unauthorized\n", http.StatusUnauthorized)
	})
}

// isLocalAuthExempt reports whether a request is exempt from local auth checks.
// Read-only methods (GET, HEAD, OPTIONS) are generally exempt — they expose
// project/thread/run metadata but cannot mutate state or execute commands.
// Only POST/PATCH/DELETE endpoints require authentication because they can
// create runs, send messages, approve tool calls, or delete threads.
//
// WebSocket upgrade requests (GET to /v1/events) are NOT exempt even though
// they use the GET method, because the live event stream exposes real-time
// agent output, tool-call permission prompts, and file-change notifications —
// the same class of sensitive data that mutation endpoints protect.
func isLocalAuthExempt(r *http.Request) bool {
	if isWebSocketUpgrade(r) {
		return false
	}
	return r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions
}

// authTokenCandidates extracts all possible auth tokens from a request.
func authTokenCandidates(r *http.Request) []string {
	candidates := []string{
		bearerToken(r.Header.Get("Authorization")),
		strings.TrimSpace(r.Header.Get("X-AgentHub-Edge-Token")),
	}
	if isWebSocketUpgrade(r) && r.URL.Path == "/v1/events" {
		candidates = append(candidates, strings.TrimSpace(r.URL.Query().Get("access_token")))
	}
	return candidates
}

func bearerToken(header string) string {
	header = strings.TrimSpace(header)
	if len(header) < len("Bearer ") || !strings.EqualFold(header[:len("Bearer ")], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(header[len("Bearer "):])
}

func constantTimeEqual(got, want string) bool {
	if got == "" || want == "" || len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func restTimeoutMiddleware(next http.Handler, timeout time.Duration) http.Handler {
	if timeout <= 0 {
		return next
	}
	timeoutHandler := http.TimeoutHandler(next, timeout, "request timeout\n")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isWebSocketUpgrade(r) {
			next.ServeHTTP(w, r)
			return
		}
		timeoutHandler.ServeHTTP(w, r)
	})
}

func isWebSocketUpgrade(r *http.Request) bool {
	return headerContainsToken(r.Header, "Connection", "upgrade") &&
		headerContainsToken(r.Header, "Upgrade", "websocket")
}

func headerContainsToken(header http.Header, key, want string) bool {
	for _, value := range header.Values(key) {
		for _, token := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(token), want) {
				return true
			}
		}
	}
	return false
}
