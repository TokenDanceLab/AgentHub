package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/agenthub/agenthub/hub-server/internal/hubserver"
	"github.com/agenthub/agenthub/internal/serviceconfig"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	base, err := serviceconfig.FromEnv(serviceconfig.Options{
		ServiceName: "hub-server",
		EnvPrefix:   "AGENTHUB_HUB",
		DefaultAddr: ":8080",
	})
	if err != nil {
		slog.Error("load hub config", "error", err)
		os.Exit(1)
	}

	server := hubserver.New(hubserver.Config{
		Addr:              base.Addr,
		Version:           versionFromEnv(),
		ReadHeaderTimeout: base.ReadHeaderTimeout,
	})

	slog.Info("starting hub server", "addr", base.Addr)
	if err := server.Run(ctx); err != nil {
		slog.Error("hub server stopped with error", "error", err)
		os.Exit(1)
	}
}

func versionFromEnv() string {
	if version := os.Getenv("AGENTHUB_VERSION"); version != "" {
		return version
	}
	return "dev"
}
