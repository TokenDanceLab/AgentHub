// Command agenthub-runner is the AgentHub Runner CLI.
//
// It manages agent CLI process execution, including mock runs for development.
// In mock mode, it simulates an agent run with fixed output chunks.
package main

import (
	"flag"
	"log/slog"
	"os"

	"github.com/agenthub/runner/internal/run"
)

func main() {
	mock := flag.Bool("mock", false, "Enable mock mode: run a simulated agent execution with fixed output")
	addr := flag.String("addr", "127.0.0.1:3211", "Listen address for the runner HTTP server (not used in mock mode)")
	flag.Parse()

	if !*mock {
		slog.Error("non-mock mode not implemented yet; use --mock to run the mock runner")
		os.Exit(1)
	}

	slog.Info("starting agent runner in mock mode", "addr", *addr)

	m := run.NewMockRun("mock-run-1")
	if err := m.Start(); err != nil {
		slog.Error("mock run failed", "error", err)
		os.Exit(1)
	}

	slog.Info("mock run completed successfully")
}
