package main

import (
	"flag"
	"log/slog"
	"os"

	"github.com/agenthub/edge-server/internal/httpserver"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:3210", "listen address")
	flag.Parse()

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	if err := httpserver.Run(httpserver.Config{Addr: *addr}); err != nil {
		slog.Error("server exited with error", "err", err)
		os.Exit(1)
	}
}
