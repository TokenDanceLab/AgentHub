package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/httpserver"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/store"
)

type config struct {
	Addr          string
	StoreFile     string
	RunnerProfile string
	RunnerCommand string
	RunnerArgs    repeatedString
	RunnerEnv     repeatedString
	RunnerWorkDir string

	// Agent adapter configuration
	AgentDefault   string // default agent adapter ID
	ClaudeCodePath string // path to claude binary
	CodexPath      string // path to codex binary
	OpenCodePath   string // path to opencode binary
	AgentModel     string // model override for the default agent
}

type repeatedString []string

const (
	runnerProfileAgentHubMock = "agenthub-runner-mock"
	runnerProfileClaudeCode   = "claude-code"
	runnerProfileCodex        = "codex"
	runnerProfileOpenCode     = "opencode"
)

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

	adapterReg := buildAdapterRegistry(cfg)

	serverConfig := httpserver.Config{
		Addr:            cfg.Addr,
		Store:           repository,
		AdapterRegistry: adapterReg,
		AgentDefault:    cfg.AgentDefault,
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

func buildConfig(args []string) (config, error) {
	fs := flag.NewFlagSet("agenthub-edge", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	cfg := config{}
	fs.StringVar(&cfg.Addr, "addr", "127.0.0.1:3210", "listen address")
	fs.StringVar(&cfg.StoreFile, "store-file", "", "JSON store snapshot file path")
	fs.StringVar(&cfg.RunnerProfile, "runner-profile", "", "runner profile preset; supported: agenthub-runner-mock, claude-code, codex, opencode")
	fs.StringVar(&cfg.RunnerCommand, "runner-command", "", "local process executable to run for each run; empty uses the built-in mock executor")
	fs.StringVar(&cfg.RunnerWorkDir, "runner-workdir", "", "working directory for --runner-command; empty inherits the edge process working directory")
	fs.Var(&cfg.RunnerArgs, "runner-arg", "argument passed to --runner-command; may be repeated")
	fs.Var(&cfg.RunnerEnv, "runner-env", "environment variable passed to --runner-command as KEY=VALUE; may be repeated")

	fs.StringVar(&cfg.AgentDefault, "agent-default", "", "default agent adapter ID (claude-code, codex, opencode)")
	fs.StringVar(&cfg.ClaudeCodePath, "claude-code-path", "claude", "path to claude binary")
	fs.StringVar(&cfg.CodexPath, "codex-path", "codex", "path to codex binary")
	fs.StringVar(&cfg.OpenCodePath, "opencode-path", "opencode", "path to opencode binary")
	fs.StringVar(&cfg.AgentModel, "agent-model", "", "model override for the default agent (e.g. claude-sonnet-4-6)")

	if err := fs.Parse(args); err != nil {
		return config{}, err
	}
	if err := applyRunnerProfile(&cfg); err != nil {
		return config{}, err
	}
	cfg.RunnerCommand = strings.TrimSpace(cfg.RunnerCommand)
	cfg.AgentDefault = strings.TrimSpace(cfg.AgentDefault)
	if cfg.RunnerCommand == "" && len(cfg.RunnerArgs) > 0 {
		return config{}, fmt.Errorf("--runner-arg requires --runner-command")
	}
	if cfg.RunnerCommand == "" && len(cfg.RunnerEnv) > 0 {
		return config{}, fmt.Errorf("--runner-env requires --runner-command")
	}
	if cfg.RunnerCommand == "" && cfg.RunnerWorkDir != "" {
		return config{}, fmt.Errorf("--runner-workdir requires --runner-command")
	}
	if _, err := lifecycle.NewCommandTemplate(nil, cfg.RunnerEnv); err != nil {
		return config{}, fmt.Errorf("--runner-env: %w", err)
	}
	if fs.NArg() != 0 {
		return config{}, fmt.Errorf("unexpected positional arguments: %v", fs.Args())
	}
	return cfg, nil
}

func applyRunnerProfile(cfg *config) error {
	cfg.RunnerProfile = strings.TrimSpace(cfg.RunnerProfile)
	if cfg.RunnerProfile == "" {
		return nil
	}
	switch cfg.RunnerProfile {
	case runnerProfileAgentHubMock:
		// Mock executor is the default when no runner command is specified.
		// The profile exists for backward compatibility; it no longer sets RunnerCommand.
		if cfg.RunnerCommand == "" && cfg.AgentDefault == "" {
			slog.Debug("using mock executor fallback — no runner command or agent configured")
		}
	case runnerProfileClaudeCode:
		if strings.TrimSpace(cfg.RunnerCommand) == "" {
			cfg.RunnerCommand = cfg.ClaudeCodePath
		}
		if cfg.AgentDefault == "" {
			cfg.AgentDefault = "claude-code"
		}
	case runnerProfileCodex:
		if strings.TrimSpace(cfg.RunnerCommand) == "" {
			cfg.RunnerCommand = cfg.CodexPath
		}
		if cfg.AgentDefault == "" {
			cfg.AgentDefault = "codex"
		}
	case runnerProfileOpenCode:
		if strings.TrimSpace(cfg.RunnerCommand) == "" {
			cfg.RunnerCommand = cfg.OpenCodePath
		}
		if cfg.AgentDefault == "" {
			cfg.AgentDefault = "opencode"
		}
	default:
		return fmt.Errorf("unknown --runner-profile %q; supported values: agenthub-runner-mock, claude-code, codex, opencode", cfg.RunnerProfile)
	}
	return nil
}

func buildAdapterRegistry(cfg config) *adapters.Registry {
	reg := adapters.NewRegistry()

	if cfg.ClaudeCodePath != "" {
		a := adapters.NewClaudeCodeAdapter(cfg.ClaudeCodePath, cfg.AgentModel, "")
		if err := reg.Register(a); err != nil {
			slog.Warn("failed to register claude-code adapter", "err", err)
		} else {
			slog.Info("registered adapter", "id", a.Metadata().ID, "path", cfg.ClaudeCodePath)
		}
	}
	if cfg.CodexPath != "" {
		a := adapters.NewCodexAdapter(cfg.CodexPath, cfg.AgentModel)
		if err := reg.Register(a); err != nil {
			slog.Warn("failed to register codex adapter", "err", err)
		} else {
			slog.Info("registered adapter", "id", a.Metadata().ID, "path", cfg.CodexPath)
		}
	}
	if cfg.OpenCodePath != "" {
		a := adapters.NewOpenCodeAdapter(cfg.OpenCodePath)
		if err := reg.Register(a); err != nil {
			slog.Warn("failed to register opencode adapter", "err", err)
		} else {
			slog.Info("registered adapter", "id", a.Metadata().ID, "path", cfg.OpenCodePath)
		}
	}

	return reg
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
