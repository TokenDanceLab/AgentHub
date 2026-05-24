package httpserver

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/agenthub/hub-server/internal/api"
	"github.com/agenthub/hub-server/internal/auth"
)

type Config struct {
	Addr          string
	JWTSecret     string
	AuthSkipPaths []string
}

func Run(cfg Config) error {
	if cfg.Addr == "" {
		cfg.Addr = "127.0.0.1:4210"
	}

	h := &api.Handler{}
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	// Wrap mux with auth middleware. Health check always skips auth.
	skipPaths := append([]string{"/v1/health"}, cfg.AuthSkipPaths...)
	authMiddleware := auth.NewMiddleware(cfg.JWTSecret, skipPaths...)
	wrappedHandler := authMiddleware.Authenticate(mux)

	srv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      wrappedHandler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // WebSocket compatible
		IdleTimeout:  60 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		slog.Info("hub server listening", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("hub server listen error", "err", err)
		}
	}()

	<-stop
	slog.Info("hub server shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(ctx)
}
