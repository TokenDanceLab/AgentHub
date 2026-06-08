package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/httpserver"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/security"
	"github.com/agenthub/edge-server/internal/store"
)

type config struct {
	Addr               string
	StoreFile          string
	StoreBackend       string
	StoreDB            string
	RunnerProfile      string
	RunnerCommand      string
	RunnerArgs         repeatedString
	RunnerEnv          repeatedString
	RunnerWorkDir      string
	WorkspaceAllowlist repeatedString
	LocalAuthToken     string
	HubJWTSecret       string // shared secret for validating Hub-issued HS256 JWTs
	RemoteMode         bool   // allow non-loopback bind + remote origins (requires auth)
	AllowedOrigins     repeatedString
	Dev                bool // disable auto-generated local auth token for development

	// Hub callback configuration (Edge→Hub direct bridge)
	HubURL   string // Hub server base URL for Edge callback reporting
	HubToken string // JWT bearer token for authenticating with Hub

	// Tailscale mode (implies --remote-mode, registers with Hub via tailscale identity)
	Tailscale   bool   // enable tailscale mode
	TailscaleIP string // tailscale IP for Hub registration identity

	// Agent adapter configuration
	AgentDefault   string // default agent adapter ID
	ClaudeCodePath string // path to claude binary
	CodexPath      string // path to codex binary
	OpenCodePath   string // path to opencode binary
	AgentModel     string // model override for the default agent

	// SKILL.md discovery
	SkillsDirs repeatedString // additional dirs to search for SKILL.md files

	// Event log persistence for crash recovery and replay
	EventLogPath string // append-only JSON-lines event log path; empty = no persistence
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
		handler = slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: logLevel})
	} else {
		handler = slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: logLevel})
	}
	slog.SetDefault(slog.New(handler))

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
		Addr:               cfg.Addr,
		Store:              repository,
		AdapterRegistry:    adapterReg,
		AgentDefault:       cfg.AgentDefault,
		LocalAuthToken:     cfg.LocalAuthToken,
		HubJWTSecret:       cfg.HubJWTSecret,
		HubURL:             cfg.HubURL,
		HubToken:           cfg.HubToken,
		RemoteMode:         cfg.RemoteMode,
		AllowedOrigins:     append([]string(nil), cfg.AllowedOrigins...),
		Dev:                cfg.Dev,
		WorkspaceAllowlist: append([]string(nil), cfg.WorkspaceAllowlist...),
		SkillsDirs:         append([]string(nil), cfg.SkillsDirs...),
		EventLogPath:       cfg.EventLogPath,
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

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func splitPathList(value string) []string {
	parts := filepath.SplitList(value)
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func splitCommaList(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func trimRepeatedStrings(values repeatedString) repeatedString {
	out := repeatedString{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func buildConfig(args []string) (config, error) {
	fs := flag.NewFlagSet("agenthub-edge", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	cfg := config{}
	fs.StringVar(&cfg.Addr, "addr", getEnv("AGENTHUB_ADDR", "127.0.0.1:3210"), "listen address")
	fs.StringVar(&cfg.StoreFile, "store-file", getEnv("AGENTHUB_STORE_FILE", ""), "JSON store snapshot file path")
	fs.StringVar(&cfg.StoreBackend, "store-backend", getEnv("AGENTHUB_STORE_BACKEND", ""), "store backend; empty = legacy auto, supported: memory, file, sqlite")
	fs.StringVar(&cfg.StoreDB, "store-db", getEnv("AGENTHUB_STORE_DB", ""), "SQLite store database path; requires --store-backend sqlite")
	fs.StringVar(&cfg.RunnerProfile, "runner-profile", getEnv("AGENTHUB_RUNNER_PROFILE", ""), "runner profile preset; supported: agenthub-runner-mock, claude-code, codex, opencode")
	fs.StringVar(&cfg.RunnerCommand, "runner-command", getEnv("AGENTHUB_RUNNER_COMMAND", ""), "local process executable to run for each run; empty uses the built-in mock executor")
	fs.StringVar(&cfg.RunnerWorkDir, "runner-workdir", getEnv("AGENTHUB_RUNNER_WORKDIR", ""), "working directory for --runner-command; empty inherits the edge process working directory")
	cfg.WorkspaceAllowlist = append(cfg.WorkspaceAllowlist, splitPathList(getEnv("AGENTHUB_WORKSPACE_ALLOWLIST", ""))...)
	fs.Var(&cfg.WorkspaceAllowlist, "workspace-allowlist", "workspace root allowed for request workDir; may be repeated; env AGENTHUB_WORKSPACE_ALLOWLIST uses OS path-list separators")
	fs.StringVar(&cfg.LocalAuthToken, "local-auth-token", getEnv("AGENTHUB_EDGE_AUTH_TOKEN", ""), "optional local bearer token required for Edge APIs other than /v1/health")
	fs.StringVar(&cfg.HubJWTSecret, "hub-jwt-secret", getEnv("AGENTHUB_HUB_JWT_SECRET", ""), "shared secret for validating Hub-issued HS256 JWTs (enables TokenDance trust chain)")
	fs.StringVar(&cfg.HubURL, "hub-url", getEnv("AGENTHUB_HUB_URL", ""), "Hub server base URL for Edge→Hub direct callback reporting (e.g. https://hub.example.com)")
	fs.StringVar(&cfg.HubToken, "hub-token", getEnv("AGENTHUB_HUB_TOKEN", ""), "JWT bearer token for authenticating callback requests to Hub")
	fs.BoolVar(&cfg.RemoteMode, "remote-mode", getEnv("AGENTHUB_REMOTE_MODE", "0") == "1", "allow non-loopback bind and remote origins (requires --local-auth-token or --hub-jwt-secret)")
	cfg.AllowedOrigins = append(cfg.AllowedOrigins, splitCommaList(getEnv("AGENTHUB_ALLOWED_ORIGINS", ""))...)
	fs.Var(&cfg.AllowedOrigins, "allowed-origin", "browser origin allowed by remote-mode CORS; may be repeated; env AGENTHUB_ALLOWED_ORIGINS uses comma separators")
	fs.BoolVar(&cfg.Dev, "dev", getEnv("AGENTHUB_DEV", "0") == "1", "disable auto-generated local auth token for development; all endpoints are open")
	fs.BoolVar(&cfg.Tailscale, "tailscale", getEnv("AGENTHUB_TAILSCALE", "0") == "1", "enable tailscale mode (implies --remote-mode, registers with Hub via tailscale identity)")
	fs.StringVar(&cfg.TailscaleIP, "tailscale-ip", getEnv("AGENTHUB_TAILSCALE_IP", ""), "tailscale IP address for Hub registration identity")
	fs.Var(&cfg.RunnerArgs, "runner-arg", "argument passed to --runner-command; may be repeated")
	fs.Var(&cfg.RunnerEnv, "runner-env", "environment variable passed to --runner-command as KEY=VALUE; may be repeated")

	fs.StringVar(&cfg.AgentDefault, "agent-default", getEnv("AGENTHUB_AGENT_DEFAULT", ""), "default agent adapter ID (claude-code, codex, opencode)")
	fs.StringVar(&cfg.ClaudeCodePath, "claude-code-path", getEnv("AGENTHUB_CLAUDE_CODE_PATH", "claude"), "path to claude binary")
	fs.StringVar(&cfg.CodexPath, "codex-path", getEnv("AGENTHUB_CODEX_PATH", "codex"), "path to codex binary")
	fs.StringVar(&cfg.OpenCodePath, "opencode-path", getEnv("AGENTHUB_OPENCODE_PATH", "opencode"), "path to opencode binary")
	fs.StringVar(&cfg.AgentModel, "agent-model", getEnv("AGENTHUB_AGENT_MODEL", ""), "model override for the default agent (e.g. claude-sonnet-4-6)")

	cfg.SkillsDirs = append(cfg.SkillsDirs, splitPathList(getEnv("AGENTHUB_SKILLS_DIRS", ""))...)
	fs.Var(&cfg.SkillsDirs, "skills-dir", "directory containing SKILL.md subdirectories; may be repeated; defaults to .agents/skills and .codex/skills")

	fs.StringVar(&cfg.EventLogPath, "event-log-path", getEnv("AGENTHUB_EVENT_LOG_PATH", ""), "append-only JSON-lines event log path for crash recovery and replay; empty = no persistence")

	if err := fs.Parse(args); err != nil {
		return config{}, err
	}
	cfg.Addr = strings.TrimSpace(cfg.Addr)
	cfg.StoreFile = strings.TrimSpace(cfg.StoreFile)
	cfg.StoreBackend = strings.ToLower(strings.TrimSpace(cfg.StoreBackend))
	cfg.StoreDB = strings.TrimSpace(cfg.StoreDB)
	switch cfg.StoreBackend {
	case "":
		if cfg.StoreDB != "" {
			return config{}, fmt.Errorf("--store-db requires --store-backend sqlite")
		}
	case "memory":
		if cfg.StoreFile != "" {
			return config{}, fmt.Errorf("--store-file cannot be combined with --store-backend memory")
		}
		if cfg.StoreDB != "" {
			return config{}, fmt.Errorf("--store-db cannot be combined with --store-backend memory")
		}
	case "file":
		if cfg.StoreFile == "" {
			return config{}, fmt.Errorf("--store-backend file requires --store-file")
		}
		if cfg.StoreDB != "" {
			return config{}, fmt.Errorf("--store-db cannot be combined with --store-backend file")
		}
	case "sqlite":
		if cfg.StoreDB == "" {
			return config{}, fmt.Errorf("--store-backend sqlite requires --store-db")
		}
		if cfg.StoreFile != "" {
			return config{}, fmt.Errorf("--store-file cannot be combined with --store-backend sqlite")
		}
	default:
		return config{}, fmt.Errorf("unknown --store-backend %q; supported values: memory, file, sqlite", cfg.StoreBackend)
	}
	// --tailscale implies --remote-mode and tailscale-aware registration with Hub
	if cfg.Tailscale {
		cfg.RemoteMode = true
		if cfg.TailscaleIP != "" {
			slog.Info("tailscale mode enabled", "tailscale_ip", cfg.TailscaleIP)
		} else {
			slog.Info("tailscale mode enabled")
		}
	}
	if cfg.RemoteMode {
		if err := security.ValidateRemoteListenAddr(cfg.Addr); err != nil {
			return config{}, err
		}
		if cfg.LocalAuthToken == "" && cfg.HubJWTSecret == "" {
			return config{}, fmt.Errorf("--remote-mode requires --local-auth-token or --hub-jwt-secret to be set")
		}
	} else {
		if err := security.ValidateLocalListenAddr(cfg.Addr); err != nil {
			return config{}, err
		}
	}
	if err := applyRunnerProfile(&cfg); err != nil {
		return config{}, err
	}
	cfg.RunnerCommand = strings.TrimSpace(cfg.RunnerCommand)
	cfg.AgentDefault = strings.TrimSpace(cfg.AgentDefault)
	cfg.LocalAuthToken = strings.TrimSpace(cfg.LocalAuthToken)
	cfg.AllowedOrigins = trimRepeatedStrings(cfg.AllowedOrigins)
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
	if cfg.ClaudeCodePath != "" {
		childAgents := registeredChildAgentIDs(reg)
		a := adapters.NewOrchestratorAdapter(
			cfg.ClaudeCodePath,
			cfg.AgentModel,
			adapters.DefaultOrchestratorPrompt(childAgents),
			childAgents,
		)
		if err := reg.Register(a); err != nil {
			slog.Warn("failed to register orchestrator adapter", "err", err)
		} else {
			reg.SetDefault("orchestrator", a.Metadata().ID)
			slog.Info("registered adapter", "id", a.Metadata().ID, "path", cfg.ClaudeCodePath, "children", childAgents)
		}
	}
	if cfg.AgentDefault != "" {
		reg.SetDefault("default", cfg.AgentDefault)
	}

	return reg
}

func registeredChildAgentIDs(reg *adapters.Registry) []string {
	ids := make([]string, 0, 3)
	for _, id := range []string{"claude-code", "codex", "opencode"} {
		if _, ok := reg.Get(id); ok {
			ids = append(ids, id)
		}
	}
	return ids
}

func newStoreFromConfig(cfg config) (store.Repository, error) {
	switch cfg.StoreBackend {
	case "sqlite":
		repository, err := store.NewSQLite(cfg.StoreDB)
		if err != nil {
			return nil, fmt.Errorf("open sqlite store %q: %w", cfg.StoreDB, err)
		}
		return repository, nil
	case "memory":
		return store.New(), nil
	case "file":
		if cfg.StoreFile == "" {
			return nil, fmt.Errorf("--store-backend file requires --store-file")
		}
		repository, err := store.NewFile(cfg.StoreFile)
		if err != nil {
			return nil, fmt.Errorf("open store file %q: %w", cfg.StoreFile, err)
		}
		return repository, nil
	case "":
		if cfg.StoreFile == "" {
			return store.New(), nil
		}
		repository, err := store.NewFile(cfg.StoreFile)
		if err != nil {
			return nil, fmt.Errorf("open store file %q: %w", cfg.StoreFile, err)
		}
		return repository, nil
	default:
		return nil, fmt.Errorf("unknown store backend %q", cfg.StoreBackend)
	}
}
