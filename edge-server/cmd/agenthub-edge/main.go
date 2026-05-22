package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/agenthub/agenthub/edge-server/internal/edgeserver"
	"github.com/agenthub/agenthub/internal/serviceconfig"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	base, err := serviceconfig.FromEnv(serviceconfig.Options{
		ServiceName: "edge-server",
		EnvPrefix:   "AGENTHUB_EDGE",
		DefaultAddr: ":8081",
	})
	if err != nil {
		slog.Error("load edge config", "error", err)
		os.Exit(1)
	}

	server := edgeserver.New(edgeserver.Config{
		Addr:              base.Addr,
		Version:           versionFromEnv(),
		EdgeID:            edgeIDFromEnv(),
		ReadHeaderTimeout: base.ReadHeaderTimeout,
	})

	slog.Info("starting edge server", "addr", base.Addr)
	if err := server.Run(ctx); err != nil {
		slog.Error("edge server stopped with error", "error", err)
		os.Exit(1)
	}
}

func versionFromEnv() string {
	if version := os.Getenv("AGENTHUB_VERSION"); version != "" {
		return version
	}
	return "dev"
}

func edgeIDFromEnv() string {
	if edgeID := os.Getenv("AGENTHUB_EDGE_ID"); edgeID != "" {
		return edgeID
	}
	return "edge_local"
}
