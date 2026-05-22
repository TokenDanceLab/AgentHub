package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/agenthub/edge-server/internal/httpserver"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/store"
)

type config struct {
	Addr          string
	StoreFile     string
	RunnerCommand string
	RunnerArgs    repeatedString
	RunnerWorkDir string
}

type repeatedString []string

func (v *repeatedString) String() string {
	return fmt.Sprint([]string(*v))
}

func (v *repeatedString) Set(value string) error {
	*v = append(*v, value)
	return nil
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

	serverConfig := httpserver.Config{Addr: cfg.Addr, Store: repository}
	if cfg.RunnerCommand != "" {
		serverConfig.ProcessExecutor = lifecycle.ProcessExecutorConfig{
			Command: cfg.RunnerCommand,
			Args:    append([]string(nil), cfg.RunnerArgs...),
			WorkDir: cfg.RunnerWorkDir,
		}
	}

	if err := httpserver.Run(serverConfig); err != nil {
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
	fs.StringVar(&cfg.RunnerCommand, "runner-command", "", "local process command to execute for each run; empty uses the mock executor")
	fs.StringVar(&cfg.RunnerWorkDir, "runner-workdir", "", "working directory for --runner-command; empty inherits the edge process working directory")
	fs.Var(&cfg.RunnerArgs, "runner-arg", "argument passed to --runner-command; may be repeated")
	if err := fs.Parse(args); err != nil {
		return config{}, err
	}
	cfg.RunnerCommand = strings.TrimSpace(cfg.RunnerCommand)
	if cfg.RunnerCommand == "" && len(cfg.RunnerArgs) > 0 {
		return config{}, fmt.Errorf("--runner-arg requires --runner-command")
	}
	if cfg.RunnerCommand == "" && cfg.RunnerWorkDir != "" {
		return config{}, fmt.Errorf("--runner-workdir requires --runner-command")
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
