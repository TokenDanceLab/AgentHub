package main

import (
	"context"
	"github.com/agenthub/edge-server/internal/adapters/sdk"
	"log/slog"
	"os"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/edgehttp"
	"github.com/agenthub/edge-server/internal/httpserver"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/store"
)

func main() {
	if runtimeManifestFixtureReplayRequested(os.Args[1:]) {
		return
	}

	setupLogging()
	applyMemoryLimit()

	cfg, err := buildConfig(os.Args[1:])
	if err != nil {
		slog.Error("invalid configuration", "err", err)
		os.Exit(2)
	}

	if cfg.StoreReadiness {
		if err := runStoreReadiness(cfg, os.Stdout); err != nil {
			slog.Error("store readiness failed", "err", err)
			os.Exit(1)
		}
		return
	}

	repository, err := newStoreFromConfig(cfg)
	if err != nil {
		slog.Error("failed to initialize store", "err", err)
		os.Exit(1)
	}
	// Demo seed is OFF by default to keep production stores clean. Set
	// AGENTHUB_DEMO_SEED=1 (or any non-empty value) to inject the demo
	// dataset into an empty store during local/dev runs.
	if os.Getenv("AGENTHUB_DEMO_SEED") != "" {
		if seedErr := store.SeedIfEmpty(repository); seedErr != nil {
			slog.Warn("seed failed", "error", seedErr)
		}
	}

	adapterReg := buildAdapterRegistry(cfg)

	// Start MCP config syncer if configured. The syncer fetches MCP server
	// definitions from the Hub server's /web/mcp-servers endpoint periodically
	// and stores them in an in-memory MCPConfigStore for injection into runs.
	var mcpConfigStore *adapters.MCPConfigStore
	var mcpSyncer *adapters.HubMCPSyncer
	if cfg.HubMCPSyncURL != "" {
		mcpConfigStore = adapters.NewMCPConfigStore()
		syncInterval := parseDurationOrDefault(cfg.HubMCPSyncInterval, 5*time.Minute)
		// Shared outbound client built here at the composition root (#1593):
		// 15s per-request timeout keeps the historical syncer semantics, and
		// edgehttp.NewClient refuses redirects so the Hub MCP config endpoint
		// is answered at the exact configured URL.
		mcpSyncer = adapters.NewHubMCPSyncer(cfg.HubMCPSyncURL, cfg.HubToken, mcpConfigStore, edgehttp.NewClient(15*time.Second))
		go mcpSyncer.Run(context.Background(), syncInterval)
		slog.Info("mcp hub sync enabled", "url", cfg.HubMCPSyncURL, "interval", syncInterval)
	}

	serverConfig := httpserver.Config{
		Addr:               cfg.Addr,
		Store:              repository,
		AdapterRegistry:    adapterReg,
		AgentDefault:       cfg.AgentDefault,
		LocalAuthToken:     cfg.LocalAuthToken,
		HubJWTSecret:       cfg.HubJWTSecret,
		EdgeDeviceID:       cfg.EdgeDeviceID,
		HubURL:             cfg.HubURL,
		HubToken:           cfg.HubToken,
		HubRefreshToken:    cfg.HubRefreshToken,
		HubCallbackTimeout: parseDurationOrDefault(cfg.HubCallbackTimeout, 0),
		HubCallbackBudget:  parseDurationOrDefault(cfg.HubCallbackBudget, 0),
		RemoteMode:         cfg.RemoteMode,
		AllowedOrigins:     append([]string(nil), cfg.AllowedOrigins...),
		Dev:                cfg.Dev,
		WorkspaceAllowlist: append([]string(nil), cfg.WorkspaceAllowlist...),
		SkillsDirs:         append([]string(nil), cfg.SkillsDirs...),
		EventLogPath:       cfg.EventLogPath,
		MCPConfigStore:     mcpConfigStore,
	}
	if cfg.HubCallbackMaxAttempts != "" {
		if n, err := strconv.Atoi(strings.TrimSpace(cfg.HubCallbackMaxAttempts)); err == nil && n > 0 {
			serverConfig.HubCallbackMaxAttempts = n
		} else {
			slog.Warn("invalid hub-callback-max-attempts, using default",
				"input", cfg.HubCallbackMaxAttempts,
				"err", err,
			)
		}
	}
	if mcpSyncer != nil {
		serverConfig.ShutdownHooks = append(serverConfig.ShutdownHooks, mcpSyncer.Stop)
	}
	if cfg.RunnerCommand != "" {
		serverConfig.ProcessExecutor = lifecycle.ProcessExecutorConfig{
			Command:  cfg.RunnerCommand,
			Args:     append([]string(nil), cfg.RunnerArgs...),
			ExtraEnv: append([]string(nil), cfg.RunnerEnv...),
			WorkDir:  cfg.RunnerWorkDir,
		}
	}

	if err := httpserver.Run(serverConfig); err != nil {
		slog.Error("server exited with error", "err", err)
		os.Exit(1)
	}
}

func runtimeManifestFixtureReplayRequested(args []string) bool {
	return len(args) == 1 && args[0] == sdk.RuntimeManifestFixtureReplayFlag
}

// setupLogging configures the default slog logger from AGENTHUB_LOG_LEVEL
// (debug/info/warn/error) and AGENTHUB_LOG_FORMAT (text/json). Extracted from
// main to keep the composition root under the gocyclo threshold (#1840).
func setupLogging() {
	logLevel := slog.LevelInfo
	switch strings.ToLower(getEnv("AGENTHUB_LOG_LEVEL", "info")) {
	case "debug":
		logLevel = slog.LevelDebug
	case "info":
		logLevel = slog.LevelInfo
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	}

	var handler slog.Handler
	if strings.ToLower(getEnv("AGENTHUB_LOG_FORMAT", "text")) == "json" {
		handler = slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: logLevel, AddSource: true})
	} else {
		handler = slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: logLevel, AddSource: true})
	}
	slog.SetDefault(slog.New(handler))
}

// applyMemoryLimit applies a soft memory limit to prevent unbounded heap
// growth on long-running Edge processes. The Go runtime will trigger GC more
// aggressively when the heap approaches this limit and return unused memory to
// the OS. Default: 512 MiB. Set AGENTHUB_MEMORY_LIMIT_MB to override
// (0 = disable). Extracted from main to keep the composition root under the
// gocyclo threshold (#1840).
func applyMemoryLimit() {
	memLimitMB := parseIntEnv("AGENTHUB_MEMORY_LIMIT_MB", 512)
	if memLimitMB <= 0 {
		return
	}
	limitBytes := int64(memLimitMB) * 1024 * 1024
	debug.SetMemoryLimit(limitBytes)
	debug.SetGCPercent(50) // more frequent GC to stay well under the limit
	slog.Info("memory limit configured", "limit_mb", memLimitMB)
}
