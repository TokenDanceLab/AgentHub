package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/agenthub/edge-server/internal/httpserver"
	"github.com/agenthub/edge-server/internal/store"
)

type config struct {
	Addr      string
	StoreFile string
}

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	cfg, err := buildConfig(os.Args[1:])
	if err != nil {
		slog.Error("invalid configuration", "err", err)
		os.Exit(2)
	}

	repository, err := newStoreFromConfig(cfg)
	if err != nil {
		slog.Error("failed to initialize store", "err", err)
		os.Exit(1)
	}

	if err := httpserver.Run(httpserver.Config{Addr: cfg.Addr, Store: repository}); err != nil {
		slog.Error("server exited with error", "err", err)
		os.Exit(1)
	}
}

func buildConfig(args []string) (config, error) {
	fs := flag.NewFlagSet("agenthub-edge", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	cfg := config{}
	fs.StringVar(&cfg.Addr, "addr", "127.0.0.1:3210", "listen address")
	fs.StringVar(&cfg.StoreFile, "store-file", "", "JSON store snapshot file path")
	if err := fs.Parse(args); err != nil {
		return config{}, err
	}
	if fs.NArg() != 0 {
		return config{}, fmt.Errorf("unexpected positional arguments: %v", fs.Args())
	}
	return cfg, nil
}

func newStoreFromConfig(cfg config) (store.Repository, error) {
	if cfg.StoreFile == "" {
		return store.New(), nil
	}
	repository, err := store.NewFile(cfg.StoreFile)
	if err != nil {
		return nil, fmt.Errorf("open store file %q: %w", cfg.StoreFile, err)
	}
	return repository, nil
}
