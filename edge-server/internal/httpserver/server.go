package httpserver

import (
	"context"
	"crypto/subtle"
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
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/metrics"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/security"
	"github.com/agenthub/edge-server/internal/store"
)

// Config holds server configuration.
type Config struct {
	Addr            string
	Store           store.Repository
	ProcessExecutor lifecycle.ProcessExecutorConfig
	AdapterRegistry *adapters.Registry // agent adapter registry; nil = none registered
	AgentDefault    string             // default agent adapter ID; empty = raw stdout capture
	LocalAuthToken  string             // optional local bearer token for non-health Edge APIs
}

const defaultRESTRequestTimeout = 30 * time.Second

// Run starts the HTTP server and blocks until a shutdown signal is received.
func Run(cfg Config) error {
	if cfg.Addr == "" {
		cfg.Addr = "127.0.0.1:3210"
	}
	if err := security.ValidateLocalListenAddr(cfg.Addr); err != nil {
		return err
	}
	handler, err := newHandlerFromConfig(cfg)
	if err != nil {
		return err
	}

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	// Expose Prometheus metrics on /metrics for Prometheus scraping.
	mux.Handle("/metrics", handler.Metrics.Handler())

	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: corsMiddleware(restTimeoutMiddleware(localAuthMiddleware(mux, cfg.LocalAuthToken), defaultRESTRequestTimeout)),
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

	return srv.Shutdown(ctx)
}

func newHandlerFromConfig(cfg Config) (*api.Handler, error) {
	if cfg.Store == nil {
		cfg.Store = store.New()
	}

	bus := events.NewBus(10000)
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
		executor = processExecutor
	}
	configureLocalRunner(reg, cfg.ProcessExecutor, agentAdapterForRegistry(cfg.AdapterRegistry, cfg.AgentDefault), executor)

	// Wire orchestrator adapter with runtime dependencies so it can spawn sub-agents.
	wireOrchestrator(cfg.AdapterRegistry, executor, agentReg, msgQueue)

	h := &api.Handler{
		Bus:             bus,
		Registry:        reg,
		Store:           cfg.Store,
		Executor:        executor,
		AdapterRegistry: cfg.AdapterRegistry,
		AgentRegistry:   agentReg,
		MessageQueue:    msgQueue,
		Metrics:         edgeMetrics,
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

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !security.IsTrustedLocalOrigin(origin) {
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

func localAuthMiddleware(next http.Handler, token string) http.Handler {
	token = strings.TrimSpace(token)
	if token == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isLocalAuthExempt(r) || requestHasLocalAuthToken(r, token) {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("WWW-Authenticate", `Bearer realm="agenthub-edge"`)
		http.Error(w, "unauthorized\n", http.StatusUnauthorized)
	})
}

func isLocalAuthExempt(r *http.Request) bool {
	return r.Method == http.MethodOptions || (r.Method == http.MethodGet && r.URL.Path == "/v1/health")
}

func requestHasLocalAuthToken(r *http.Request, want string) bool {
	candidates := []string{
		bearerToken(r.Header.Get("Authorization")),
		strings.TrimSpace(r.Header.Get("X-AgentHub-Edge-Token")),
	}
	if isWebSocketUpgrade(r) && r.URL.Path == "/v1/events" {
		candidates = append(candidates, strings.TrimSpace(r.URL.Query().Get("access_token")))
	}
	for _, got := range candidates {
		if constantTimeEqual(got, want) {
			return true
		}
	}
	return false
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
