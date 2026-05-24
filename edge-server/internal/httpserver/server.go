package httpserver

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
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
}

// Run starts the HTTP server and blocks until a shutdown signal is received.
func Run(cfg Config) error {
	if cfg.Addr == "" {
		cfg.Addr = "127.0.0.1:3210"
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
		Handler: corsMiddleware(mux),
		// WriteTimeout=0: WebSocket connections are long-lived and manage their
		// own deadlines. HTTP handlers are short-lived REST calls.
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

	return &api.Handler{
		Bus:             bus,
		Registry:        reg,
		Store:           cfg.Store,
		Executor:        executor,
		AdapterRegistry: cfg.AdapterRegistry,
		AgentRegistry:   agentReg,
		MessageQueue:    msgQueue,
		Metrics:         edgeMetrics,
	}, nil
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
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
