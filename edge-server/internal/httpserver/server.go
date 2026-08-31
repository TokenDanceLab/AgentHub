package httpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/adapters/claude"
	"github.com/agenthub/edge-server/internal/adapters/orchestrator"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/api"
	"github.com/agenthub/edge-server/internal/ccswitch"
	"github.com/agenthub/edge-server/internal/deliverydedup"
	"github.com/agenthub/edge-server/internal/edgehttp"
	"github.com/agenthub/edge-server/internal/edgeidentity"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/mcp"
	"github.com/agenthub/edge-server/internal/metrics"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/security"
	"github.com/agenthub/edge-server/internal/skills"
	"github.com/agenthub/edge-server/internal/store"
	debugpkg "github.com/agenthub/pkg/debug"
	"github.com/agenthub/pkg/reqlog"
	"github.com/prometheus/client_golang/prometheus"
)

// HubUserIDFromContext extracts the Hub-authenticated user ID from context.
// Returns empty string if the request was not authenticated via Hub JWT.
func HubUserIDFromContext(ctx context.Context) string {
	return edgeidentity.FromContext(ctx).UserID
}

// Config holds server configuration.
type Config struct {
	Addr                   string
	Store                  store.Repository
	ProcessExecutor        lifecycle.ProcessExecutorConfig
	AdapterRegistry        *adapters.Registry       // agent adapter registry; nil = none registered
	AgentDefault           string                   // default agent adapter ID; empty = raw stdout capture
	LocalAuthToken         string                   // optional local bearer token for non-health Edge APIs
	HubJWTSecret           string                   // shared secret for validating Hub-issued HS256 JWTs
	EdgeDeviceID           string                   // local Edge device ID expected in Edge-scoped Hub JWTs
	HubURL                 string                   // Hub server base URL for Edge->Hub direct callbacks
	HubToken               string                   // JWT bearer token for Hub callback authentication
	HubRefreshToken        string                   // Hub session refresh token; enables token auto-rotation
	HubCallbackTimeout     time.Duration            // per-request timeout for Edge→Hub callbacks; 0 = default (30s)
	HubCallbackBudget      time.Duration            // total wall-clock retry budget for callbacks; 0 = default (10s)
	HubCallbackMaxAttempts int                      // total attempts per callback; 0 = default (3)
	RemoteMode             bool                     // allow non-loopback bind + remote origins (requires auth)
	AllowedOrigins         []string                 // explicit remote-mode browser origins allowed by CORS
	Dev                    bool                     // dev mode disables auto-generated local auth token
	WorkspaceAllowlist     []string                 // optional roots allowed for request workDir
	SkillsDirs             []string                 // optional SKILL.md search dirs; empty = use defaults
	EventLogPath           string                   // optional append-only event log path for crash recovery and replay; empty = no persistence (events exist only in-memory)
	EventLogMaxSize        int64                    // event log truncation threshold in bytes; 0 = default (50 MiB)
	MCPConfigStore         *adapters.MCPConfigStore // optional Hub-synced MCP server configs for injection into runs
	ShutdownHooks          []func()                 // called in order during graceful shutdown, before bus.Close()
}

const defaultRESTRequestTimeout = 30 * time.Second

// Run starts the HTTP server and blocks until a shutdown signal is received.
func Run(cfg Config) error {
	if cfg.Addr == "" {
		cfg.Addr = "127.0.0.1:3210"
	}
	if cfg.RemoteMode {
		if err := security.ValidateRemoteListenAddr(cfg.Addr); err != nil {
			slog.Error("invalid remote listen address", "error", err)
			return err
		}
	} else {
		if err := security.ValidateLocalListenAddr(cfg.Addr); err != nil {
			slog.Error("invalid local listen address", "error", err)
			return err
		}
	}
	handler, err := newHandlerFromConfig(cfg)
	if err != nil {
		slog.Error("failed to create handler from config", "error", err)
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
			slog.Error("failed to generate local auth token", "error", err)
			return fmt.Errorf("failed to generate local auth token: %w", err)
		}
		cfg.LocalAuthToken = "aght_" + hex.EncodeToString(tokenBytes)
		slog.Debug("auto-generated local auth token for Edge Server API protection; " +
			"pass this token via Authorization: Bearer <token>, X-AgentHub-Edge-Token, or Sec-WebSocket-Protocol (agenthub.edge.bearer.v1, <token>) for WebSocket connections")
	}

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	// Register debug endpoints (health, pprof, metrics, config, state).
	debugAuth := debugAuthFunc(cfg)
	debugpkg.RegisterEndpoints(mux, debugpkg.MuxConfig{
		HealthCheckers: map[string]debugpkg.HealthChecker{
			"store": func(_ context.Context) error {
				if handler.Store == nil {
					return fmt.Errorf("store not initialized")
				}
				return nil
			},
			"bus": func(_ context.Context) error {
				if handler.Bus == nil {
					return fmt.Errorf("event bus not initialized")
				}
				return nil
			},
		},
		EnablePprof:    true,
		MetricsHandler: handler.Metrics.Handler(),
		Auth:           debugAuth,
		ConfigDumper:   edgeConfigDumper(cfg),
		StateDumper:    edgeStateDumper(handler),
	})

	// Register MCP (Model Context Protocol) endpoint for external AI clients.
	// This exposes project/thread/run capabilities as standard MCP tools.
	// MCP-level auth mirrors the global local auth token for defense-in-depth:
	// even if a request bypasses the middleware chain, the MCP handler itself
	// enforces the same bearer token.
	mcpServer := mcp.NewServer(handler.Store, handler.Executor, handler.Bus, handler.PermissionRegistry)
	mcpServer.SetWorkspaceAllowlist(cfg.WorkspaceAllowlist)
	mcpServer.SetAuthToken(cfg.LocalAuthToken)
	mux.Handle("/mcp", mcpServer)
	slog.Info("mcp server endpoint registered at /mcp")

	// Wrap the whole middleware chain with panic recovery as the OUTERMOST
	// layer so a panic in any handler or middleware is recovered instead of
	// crashing the Edge process. net/http does not install a default recover
	// for connected-request handlers. The counter feeds
	// edge_http_panic_recoveries_total.
	var panicCounter prometheus.Counter
	if handler.Metrics != nil {
		panicCounter = handler.Metrics.EdgeHTTPPanicRecoveries
	}
	chain := reqlog.AccessLog(corsMiddleware(restTimeoutMiddleware(localAuthMiddleware(mux, cfg.LocalAuthToken, cfg.HubJWTSecret, cfg.EdgeDeviceID), defaultRESTRequestTimeout), cfg.RemoteMode, cfg.AllowedOrigins))

	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: recoveryHTTPHandler(chain, panicCounter),
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
			slog.Error("server error", "error", err)
			stop <- syscall.SIGTERM
		}
	}()

	<-stop
	slog.Info("shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), shutdownTotalBudget)
	defer cancel()

	// Cancel in-flight agent runs BEFORE srv.Shutdown so child processes are
	// terminated while we still have time budget. Without this, a Hub stop /
	// SIGINT leaves spawned agent processes orphaned (notably on Windows,
	// where CREATE_NEW_PROCESS_GROUP children are not killed by parent exit).
	if pe, ok := handler.Executor.(*lifecycle.ProcessExecutor); ok && pe != nil {
		pe.CancelAll(ctx)
	}

	if err := srv.Shutdown(ctx); err != nil {
		return err
	}

	// Flush and close the event log so no events are lost on shutdown.
	// newHandlerFromConfig appends internal stops (result aggregator, token
	// provider) to the same slice header that main.go pre-populated with
	// mcpSyncer.Stop, so handler.ShutdownHooks is the single source of truth.
	runShutdownHooks(handler.ShutdownHooks)
	if err := closeBusWithTimeout(handler.Bus.Close, shutdownBusCloseBudget); err != nil {
		slog.Error("failed to close event bus event log", "error", err)
	}
	return nil
}

// buildEventBusAndMetrics creates the event bus (optionally persisted to the
// event log) and the bus-stats wired Prometheus metrics.
func buildEventBusAndMetrics(cfg Config) (*events.Bus, *metrics.EdgeMetrics) {
	busOpts := []events.BusOption{}
	if cfg.EventLogPath != "" {
		busOpts = append(busOpts, events.WithEventLogPath(cfg.EventLogPath))
	}
	if cfg.EventLogMaxSize > 0 {
		busOpts = append(busOpts, events.WithEventLogMaxSize(cfg.EventLogMaxSize))
	}
	bus := events.NewBus(10000, busOpts...)

	// Prometheus metrics wired to bus depth
	edgeMetrics := metrics.NewWithBusStats(
		func() float64 { return float64(bus.HistoryLen()) },
		func() float64 { return float64(bus.DroppedCount()) },
	)
	return bus, edgeMetrics
}

// wireRunEventTracker installs the per-run event counter observer that
// debugs event counts at run completion. OFF by default (slog.Debug).
// Observers are NOT in the hot path — the bus fans out concurrently.
func wireRunEventTracker(bus *events.Bus) {
	var mu sync.Mutex
	type runEventTracker struct {
		count int64
		types map[string]int64
	}
	trackers := make(map[string]*runEventTracker)
	bus.AddObserver(func(evt events.EventEnvelope) {
		runID, _ := evt.Scope["runId"].(string)
		if runID == "" {
			return
		}
		mu.Lock()
		t, ok := trackers[runID]
		if !ok {
			t = &runEventTracker{types: make(map[string]int64)}
			trackers[runID] = t
		}
		t.count++
		t.types[evt.Type]++
		switch evt.Type {
		case "run.finished", "run.failed", "run.cancelled":
			typeStrs := make([]string, 0, len(t.types))
			for k, v := range t.types {
				typeStrs = append(typeStrs, fmt.Sprintf("%s=%d", k, v))
			}
			slog.Debug("ws.run.events", "runId", runID, "eventCount", t.count, "eventTypes", typeStrs)
			delete(trackers, runID)
		}
		mu.Unlock()
	})
}

// buildProcessExecutor wires the process executor, agent adapter, and the
// Hub callback client (including the durable delivery journal). When neither
// a runner command nor an agent default is configured it falls back to the
// mock executor so the run lifecycle stays usable (the agenthub-runner-mock
// profile).
func buildProcessExecutor(cfg Config, bus *events.Bus, agentReg *agents.Registry, msgQueue *agents.Queue, resultAgg *lifecycle.ResultAggregator, edgeMetrics *metrics.EdgeMetrics) (lifecycle.RunExecutor, *hub.CallbackClient, func(), error) {
	hasAdapter := cfg.AdapterRegistry != nil && cfg.AgentDefault != ""
	if cfg.ProcessExecutor.Command == "" && !hasAdapter {
		// No runner command and no default agent adapter: fall back to the
		// mock executor so the run lifecycle still works and the runner
		// registry reflects a mock runner (the agenthub-runner-mock profile
		// contract — "mock executor is the default when no runner command is
		// specified"). Previously this returned a nil executor, leaving the
		// edge degraded (no executor, no runners).
		return lifecycle.NewMockExecutor(bus, cfg.Store), nil, nil, nil
	}
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
		return nil, nil, nil, err
	}
	processExecutor.SetMetrics(edgeMetrics)
	processExecutor.WithAgentRegistry(agentReg).WithMessageQueue(msgQueue).WithResultAggregator(resultAgg)

	var hubCallbackClient *hub.CallbackClient
	// tokenProviderStop stops the background rotation goroutine (buffered via
	// the provider's stopWG) during graceful shutdown (#1410 completion).
	var tokenProviderStop func()
	// Wire Hub callback client for Edge-to-Hub direct bridge
	if cfg.HubURL != "" {
		// Transport policy assembled here at the composition root (#1564):
		// timeout / retry budget / attempts are operator-configurable with
		// fail-closed defaults inside hub.CallbackConfig; the http.Client
		// (connection reuse, redirect refusal) is built here too and injected.
		callbackCfg := hub.DefaultCallbackConfig()
		if cfg.HubCallbackTimeout > 0 {
			callbackCfg.Timeout = cfg.HubCallbackTimeout
		}
		if cfg.HubCallbackBudget > 0 {
			callbackCfg.RetryBudget = cfg.HubCallbackBudget
		}
		if cfg.HubCallbackMaxAttempts > 0 {
			callbackCfg.MaxAttempts = cfg.HubCallbackMaxAttempts
		}
		hubClient := hub.NewCallbackClient(cfg.HubURL, cfg.HubToken, edgehttp.NewClient(callbackCfg.Timeout), callbackCfg)
		// Unified outbound metrics contract (#1595): record every callback
		// attempt on the Edge metrics registry.
		hubClient = hubClient.WithMetrics(edgeMetrics.Outbound)
		hubCallbackClient = hubClient
		// Token auto-rotation (#1410): with a refresh token the provider
		// rotates the bearer before expiry and every outbound callback reads
		// the live token, so a long-lived Edge never starts 401ing.
		if cfg.HubRefreshToken != "" {
			tokenProvider := hub.NewTokenProvider(cfg.HubURL, cfg.HubToken, cfg.HubRefreshToken, edgehttp.NewClient(30*time.Second))
			tokenProvider.StartAutoRefresh()
			tokenProviderStop = tokenProvider.Stop
			hubClient.SetTokenSource(tokenProvider.AccessToken)
			slog.Info("hub token auto-rotation enabled", "hubURL", cfg.HubURL)
		}
		// Optional durable journal path: AGENTHUB_DELIVERY_JOURNAL_DB (AH-SR-049 / #445).
		// Falls back to in-memory journal on open failure so callback path never blocks startup.
		if journalPath := strings.TrimSpace(os.Getenv("AGENTHUB_DELIVERY_JOURNAL_DB")); journalPath != "" {
			if err := hubClient.EnableSQLiteJournal(journalPath); err != nil {
				slog.Warn("durable delivery journal unavailable; using memory journal", "path", journalPath, "error", err)
			} else {
				slog.Info("durable delivery journal enabled", "path", journalPath)
			}
		}
		processExecutor.WithHubCallback(hubClient)
		slog.Info("edge-to-hub direct callback enabled", "hubURL", cfg.HubURL)
	}
	return processExecutor, hubCallbackClient, tokenProviderStop, nil
}

// wireCCSwitch detects cc-switch and wires it into the handler for API
// endpoints and model catalog enrichment. Non-fatal: missing cc-switch is
// normal.
func wireCCSwitch(cfg Config, h *api.Handler) {
	ccStatus := ccswitch.Detect()
	if !ccStatus.Installed {
		slog.Debug("cc-switch not detected")
		return
	}
	ccReader := ccswitch.NewReader()
	h.CCSwitchStatus = &ccStatus
	h.CCSwitchReader = ccReader

	// Consume cc-switch model aliases into the static config so all
	// adapters benefit from dynamic model resolution (not just
	// Claude Code). Graceful degradation: on error, static config
	// only — never crash because cc-switch is unavailable.
	if _, err := adapters.ConsumeCCSwitchModels(ccStatus.DBPath); err != nil {
		slog.Warn("cc-switch model alias consumption failed, using static config only", "error", err)
	}

	// Wire cc-switch dynamic model resolver into Claude Code adapter
	// so model aliases are resolved through the transparent proxy mapping.
	if cfg.AdapterRegistry != nil && ccReader != nil {
		if a, ok := cfg.AdapterRegistry.Get("claude-code"); ok {
			if claudeAdapter, ok := a.(interface {
				SetCCSwitchResolver(claude.SwitchModelResolver)
			}); ok {
				claudeAdapter.SetCCSwitchResolver(ccReader)
				slog.Debug("cc-switch model resolver wired into claude-code adapter")
			}
		}
	}

	if ccStatus.RoutingActive {
		slog.Info("cc-switch detected and routing is active",
			"db", ccStatus.DBPath,
			"port", ccStatus.ProxyPort,
			"appTypes", ccStatus.ActiveAppTypes)
	} else {
		slog.Info("cc-switch detected but routing is inactive", "db", ccStatus.DBPath)
	}
}

func newHandlerFromConfig(cfg Config) (*api.Handler, error) {
	if cfg.Store == nil {
		cfg.Store = store.New()
	}

	bus, edgeMetrics := buildEventBusAndMetrics(cfg)
	reg := runners.NewRegistry()

	agentReg := agents.NewRegistry()
	msgQueue := agents.NewQueue()

	// Result aggregator collects sub-agent output and routes it back to the parent orchestrator.
	// Attach the timeout-based result collector so a parent orchestrator is
	// finalized (with partial results) if a sub-agent never reports terminal
	// state instead of hanging forever on a lossy subscriber drop.
	resultAgg := lifecycle.NewResultAggregator(bus, agentReg).
		WithCollector(lifecycle.NewSubAgentResultCollector(lifecycle.DefaultSubAgentTimeout))
	resultAggStop := resultAgg.Start()
	// Wire the aggregator's stop function into shutdown hooks so its goroutine
	// exits cleanly instead of being orphaned on process exit (#988 shutdown gap).
	cfg.ShutdownHooks = append(cfg.ShutdownHooks, func() {
		if resultAggStop != nil {
			resultAggStop()
		}
	})

	// Per-run event counter: tracks event counts per run and debugs at
	// completion time (see wireRunEventTracker).
	wireRunEventTracker(bus)

	executor, hubCallbackClient, tokenProviderStop, err := buildProcessExecutor(cfg, bus, agentReg, msgQueue, resultAgg, edgeMetrics)
	if err != nil {
		return nil, err
	}
	// Wire the rotation goroutine's stop into shutdown hooks so a token refresh
	// in flight drains cleanly instead of leaking live HTTP requests on exit
	// (#1410 / #1688 graceful shutdown contract). cfg.ShutdownHooks is the
	// same slice header caller-pre-populated (e.g. mcpSyncer.Stop) and the
	// one Run() drains at shutdown.
	if tokenProviderStop != nil {
		cfg.ShutdownHooks = append(cfg.ShutdownHooks, tokenProviderStop)
	}
	// Orchestration finalize bridge: an orchestrator parent whose terminal
	// finish is parked (waiting on sub-agents) is finalized by the aggregator
	// when all children complete or the collector timeout fires.
	if processExecutor, ok := executor.(*lifecycle.ProcessExecutor); ok {
		resultAgg.WithParentFinalizer(processExecutor.FinalizeParentRun)
	}
	configureLocalRunner(reg, cfg.ProcessExecutor, agentAdapterForRegistry(cfg.AdapterRegistry, cfg.AgentDefault), executor)

	// Wire orchestrator adapter with runtime dependencies so it can spawn sub-agents.
	// Plan approval gate (P0 #3): create broker and wire into both orchestrator and handler.
	planBroker := orchestrator.NewPlanApprovalBroker(orchestrator.DefaultPlanApprovalConfig())
	wireOrchestrator(cfg.AdapterRegistry, executor, agentReg, msgQueue, planBroker)

	// Build SkillRegistry from configured directories. Discovery failure is
	// non-fatal — skills injection is purely optional.
	skillsDirs := cfg.SkillsDirs
	if len(skillsDirs) == 0 {
		skillsDirs = skills.DefaultDirs("")
	}
	skillReg := skills.NewSkillRegistry(skillsDirs)
	if err := skillReg.Discover(); err != nil {
		slog.Warn("skill discovery failed; skills will not be injected", "error", err)
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
		MCPConfigStore:     cfg.MCPConfigStore,
		PlanApprovalBroker: planBroker,
		LocalAuthToken:     cfg.LocalAuthToken,
		HubJWTSecret:       cfg.HubJWTSecret,
		EdgeDeviceID:       cfg.EdgeDeviceID,
		CallbackClient:     hubCallbackClient,
		DeliveryDedup:      deliverydedup.New(deliverydedup.DefaultCapacity, deliverydedup.DefaultTTL),
		ShutdownHooks:      cfg.ShutdownHooks,
	}

	// Detect cc-switch and wire into handler for API endpoints and model
	// catalog enrichment. Non-fatal: missing cc-switch is normal.
	wireCCSwitch(cfg, h)

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
		_, _ = cfg.Store.CreateProject("proj_local", "Local Project", "")
		_, _ = cfg.Store.CreateThread("thread_local", "proj_local", "Local Thread", "direct", "", "")
	}
	return h, nil
}
