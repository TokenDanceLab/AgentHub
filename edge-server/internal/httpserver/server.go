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
	"github.com/agenthub/edge-server/internal/api"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
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

	srv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      corsMiddleware(mux),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
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

	var executor lifecycle.RunExecutor
	if cfg.ProcessExecutor.Command != "" {
		// Resolve the default agent adapter if configured
		var agentAdapter adapters.AgentAdapter
		if cfg.AdapterRegistry != nil && cfg.AgentDefault != "" {
			if a, ok := cfg.AdapterRegistry.Get(cfg.AgentDefault); ok {
				agentAdapter = a
			}
		}
		processExecutor, err := lifecycle.NewProcessExecutor(bus, cfg.Store, cfg.ProcessExecutor, agentAdapter, cfg.AdapterRegistry)
		if err != nil {
			return nil, err
		}
		executor = processExecutor
	}

	return &api.Handler{
		Bus:             bus,
		Registry:        reg,
		Store:           cfg.Store,
		Executor:        executor,
		AdapterRegistry: cfg.AdapterRegistry,
	}, nil
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
