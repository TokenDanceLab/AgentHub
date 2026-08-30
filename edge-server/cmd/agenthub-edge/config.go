package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/security"
)

type config struct {
	Addr               string
	StoreFile          string
	StoreBackend       string
	StoreDB            string
	StoreReadiness     bool
	RunnerProfile      string
	RunnerCommand      string
	RunnerArgs         repeatedString
	RunnerEnv          repeatedString
	RunnerWorkDir      string
	WorkspaceAllowlist repeatedString
	LocalAuthToken     string
	HubJWTSecret       string // shared secret for validating Hub-issued HS256 JWTs
	EdgeDeviceID       string // local Edge device ID expected in Edge-scoped Hub JWTs
	RemoteMode         bool   // allow non-loopback bind + remote origins (requires auth)
	AllowedOrigins     repeatedString
	Dev                bool // disable auto-generated local auth token for development

	// Hub callback configuration (Edge→Hub direct bridge)
	HubURL                 string // Hub server base URL for Edge callback reporting
	HubToken               string // JWT bearer token for authenticating with Hub
	HubRefreshToken        string // Hub session refresh token; rotates --hub-token before expiry
	HubCallbackTimeout     string // per-request timeout for Edge→Hub callbacks (default 30s)
	HubCallbackBudget      string // total wall-clock retry budget for callbacks (default 10s)
	HubCallbackMaxAttempts string // total attempts per callback (default 3)

	// Tailscale mode (implies --remote-mode, registers with Hub via tailscale identity)
	Tailscale   bool   // enable tailscale mode
	TailscaleIP string // tailscale IP for Hub registration identity

	// Agent adapter configuration
	AgentDefault     string         // default agent adapter ID
	ClaudeCodePath   string         // path to claude binary (orchestrator inner + legacy fallback)
	CodexACPPath     string         // npx launcher for the official codex-acp ACP adapter; empty = platform-native npx
	OpencodeACPPath  string         // path to opencode binary for native `opencode acp` ACP mode; empty = "opencode"
	ClaudeACPPath    string         // npx launcher for the official claude-agent-acp ACP adapter; empty = platform-native npx
	AgentModel       string         // model override for the default agent
	RuntimeManifests repeatedString // fixture-only custom runtime manifests

	// SDK adapter configuration (direct HTTP API calls, no CLI subprocess)
	AnthropicSDKPath string // enables anthropic-sdk adapter; value is API key or "env" for ANTHROPIC_API_KEY
	OpenAISDKPath    string // enables openai-sdk adapter; value is API key or "env" for OPENAI_API_KEY

	// SKILL.md discovery
	SkillsDirs repeatedString // additional dirs to search for SKILL.md files

	// Event log persistence for crash recovery and replay
	EventLogPath    string // append-only JSON-lines event log path; empty = no persistence
	EventLogMaxSize int64  // event log truncation threshold in bytes; 0 = default (50 MiB)

	// MCP Hub sync: periodically fetch MCP server configs from Hub's /web/mcp-servers endpoint
	HubMCPSyncURL      string // Hub URL for MCP config sync; empty = no sync
	HubMCPSyncInterval string // sync interval (default "5m")
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

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func parseIntEnv(key string, defaultVal int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return defaultVal
}

func parseInt64Env(key string, defaultVal int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
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
	fs.BoolVar(&cfg.StoreReadiness, "store-readiness", false, "print store readiness JSON and exit; currently supports --store-backend sqlite")
	fs.StringVar(&cfg.RunnerProfile, "runner-profile", getEnv("AGENTHUB_RUNNER_PROFILE", ""), "runner profile preset; supported: agenthub-runner-mock, claude-code, codex, opencode")
	fs.StringVar(&cfg.RunnerCommand, "runner-command", getEnv("AGENTHUB_RUNNER_COMMAND", ""), "local process executable to run for each run; empty uses the built-in mock executor")
	fs.StringVar(&cfg.RunnerWorkDir, "runner-workdir", getEnv("AGENTHUB_RUNNER_WORKDIR", ""), "working directory for --runner-command; empty inherits the edge process working directory")
	cfg.WorkspaceAllowlist = append(cfg.WorkspaceAllowlist, splitPathList(getEnv("AGENTHUB_WORKSPACE_ALLOWLIST", ""))...)
	fs.Var(&cfg.WorkspaceAllowlist, "workspace-allowlist", "workspace root allowed for request workDir; may be repeated; env AGENTHUB_WORKSPACE_ALLOWLIST uses OS path-list separators")
	fs.StringVar(&cfg.LocalAuthToken, "local-auth-token", getEnv("AGENTHUB_EDGE_AUTH_TOKEN", ""), "optional local bearer token required for Edge APIs other than /v1/health")
	fs.StringVar(&cfg.HubJWTSecret, "hub-jwt-secret", getEnv("AGENTHUB_HUB_JWT_SECRET", ""), "shared secret for validating Hub-issued HS256 JWTs (enables TokenDance trust chain)")
	fs.StringVar(&cfg.EdgeDeviceID, "edge-device-id", getEnv("AGENTHUB_EDGE_DEVICE_ID", ""), "local Edge device ID expected in Edge-scoped Hub JWTs; required with --hub-jwt-secret")
	fs.StringVar(&cfg.HubURL, "hub-url", getEnv("AGENTHUB_HUB_URL", ""), "Hub server base URL for Edge→Hub direct callback reporting (e.g. https://hub.example.com)")
	fs.StringVar(&cfg.HubToken, "hub-token", getEnv("AGENTHUB_HUB_TOKEN", ""), "JWT bearer token for authenticating callback requests to Hub")
	fs.StringVar(&cfg.HubRefreshToken, "hub-refresh-token", getEnv("AGENTHUB_HUB_REFRESH_TOKEN", ""), "Hub session refresh token; when set the Edge rotates --hub-token before expiry via /client/auth/refresh")
	fs.StringVar(&cfg.HubCallbackTimeout, "hub-callback-timeout", getEnv("AGENTHUB_HUB_CALLBACK_TIMEOUT", ""), "per-request timeout for Edge→Hub callbacks (Go duration, default 30s)")
	fs.StringVar(&cfg.HubCallbackBudget, "hub-callback-retry-budget", getEnv("AGENTHUB_HUB_CALLBACK_RETRY_BUDGET", ""), "total wall-clock retry budget for Edge→Hub callbacks (Go duration, default 10s)")
	fs.StringVar(&cfg.HubCallbackMaxAttempts, "hub-callback-max-attempts", getEnv("AGENTHUB_HUB_CALLBACK_MAX_ATTEMPTS", ""), "total attempts per Edge→Hub callback (default 3)")
	fs.BoolVar(&cfg.RemoteMode, "remote-mode", getEnv("AGENTHUB_REMOTE_MODE", "0") == "1", "allow non-loopback bind and remote origins (requires --local-auth-token or --hub-jwt-secret)")
	cfg.AllowedOrigins = append(cfg.AllowedOrigins, splitCommaList(getEnv("AGENTHUB_ALLOWED_ORIGINS", ""))...)
	fs.Var(&cfg.AllowedOrigins, "allowed-origin", "browser origin allowed by remote-mode CORS; may be repeated; env AGENTHUB_ALLOWED_ORIGINS uses comma separators")
	fs.BoolVar(&cfg.Dev, "dev", getEnv("AGENTHUB_DEV", "0") == "1", "disable auto-generated local auth token for development; all endpoints are open")
	fs.BoolVar(&cfg.Tailscale, "tailscale", getEnv("AGENTHUB_TAILSCALE", "0") == "1", "enable tailscale mode (implies --remote-mode, registers with Hub via tailscale identity)")
	fs.StringVar(&cfg.TailscaleIP, "tailscale-ip", getEnv("AGENTHUB_TAILSCALE_IP", ""), "tailscale IP address for Hub registration identity")
	fs.Var(&cfg.RunnerArgs, "runner-arg", "argument passed to --runner-command; may be repeated")
	fs.Var(&cfg.RunnerEnv, "runner-env", "environment variable passed to --runner-command as KEY=VALUE; may be repeated")

	fs.StringVar(&cfg.AgentDefault, "agent-default", getEnv("AGENTHUB_AGENT_DEFAULT", ""), "default agent adapter ID (claude-acp, codex-acp, opencode-acp, claude-code)")
	fs.StringVar(&cfg.ClaudeCodePath, "claude-code-path", getEnv("AGENTHUB_CLAUDE_CODE_PATH", "claude"), "path to claude binary (orchestrator inner + legacy fallback)")
	fs.StringVar(&cfg.CodexACPPath, "codex-acp-path", getEnv("AGENTHUB_CODEX_ACP_PATH", ""), "npx launcher for the official codex-acp ACP adapter (e.g. \"npx.cmd\"); empty = platform-native npx")
	fs.StringVar(&cfg.OpencodeACPPath, "opencode-acp-path", getEnv("AGENTHUB_OPENCODE_ACP_PATH", ""), "path to opencode binary for the native opencode-acp ACP adapter (e.g. \"opencode\"); empty = \"opencode\"")
	fs.StringVar(&cfg.ClaudeACPPath, "claude-acp-path", getEnv("AGENTHUB_CLAUDE_ACP_PATH", ""), "npx launcher for the official claude-agent-acp ACP adapter (e.g. \"npx.cmd\"); empty = platform-native npx")
	fs.StringVar(&cfg.AgentModel, "agent-model", getEnv("AGENTHUB_AGENT_MODEL", ""), "model override for the default agent")
	cfg.RuntimeManifests = append(cfg.RuntimeManifests, splitPathList(getEnv("AGENTHUB_RUNTIME_MANIFESTS", ""))...)
	fs.Var(&cfg.RuntimeManifests, "runtime-manifest", "fixture-only custom runtime manifest JSON path; may be repeated; env AGENTHUB_RUNTIME_MANIFESTS uses OS path-list separators")

	fs.StringVar(&cfg.AnthropicSDKPath, "anthropic-sdk-path", getEnv("AGENTHUB_ANTHROPIC_SDK_PATH", ""), "enable anthropic-sdk adapter; API key or env-var for ANTHROPIC_API_KEY")
	fs.StringVar(&cfg.OpenAISDKPath, "openai-sdk-path", getEnv("AGENTHUB_OPENAI_SDK_PATH", ""), "enable openai-sdk adapter; API key or env-var for OPENAI_API_KEY")

	cfg.SkillsDirs = append(cfg.SkillsDirs, splitPathList(getEnv("AGENTHUB_SKILLS_DIRS", ""))...)
	fs.Var(&cfg.SkillsDirs, "skills-dir", "directory containing SKILL.md subdirectories; may be repeated; defaults to .agents/skills and .codex/skills")

	fs.StringVar(&cfg.EventLogPath, "event-log-path", getEnv("AGENTHUB_EVENT_LOG_PATH", ""), "append-only JSON-lines event log path for crash recovery and replay; empty = no persistence")
	fs.Int64Var(&cfg.EventLogMaxSize, "event-log-max-size", parseInt64Env("AGENTHUB_EVENT_LOG_MAX_SIZE", 0), "event log truncation threshold in bytes; 0 = default 50 MiB")

	fs.StringVar(&cfg.HubMCPSyncURL, "hub-mcp-sync-url", getEnv("AGENTHUB_HUB_MCP_SYNC_URL", ""), "Hub URL for periodic MCP server config sync; empty = no sync")
	fs.StringVar(&cfg.HubMCPSyncInterval, "hub-mcp-sync-interval", getEnv("AGENTHUB_HUB_MCP_SYNC_INTERVAL", "5m"), "interval for MCP config sync from Hub (e.g. 5m, 30s)")

	if err := fs.Parse(args); err != nil {
		return config{}, err
	}
	cfg.Addr = strings.TrimSpace(cfg.Addr)
	cfg.StoreFile = strings.TrimSpace(cfg.StoreFile)
	cfg.StoreBackend = strings.ToLower(strings.TrimSpace(cfg.StoreBackend))
	cfg.StoreDB = strings.TrimSpace(cfg.StoreDB)
	cfg.LocalAuthToken = strings.TrimSpace(cfg.LocalAuthToken)
	cfg.HubJWTSecret = strings.TrimSpace(cfg.HubJWTSecret)
	cfg.EdgeDeviceID = strings.TrimSpace(cfg.EdgeDeviceID)
	if err := cfg.validateStoreBackend(); err != nil {
		return config{}, err
	}
	if err := cfg.validateListenMode(); err != nil {
		return config{}, err
	}
	if err := cfg.validateRunnerAndArgs(fs); err != nil {
		return config{}, err
	}
	return cfg, nil
}

// validateStoreBackend cross-checks --store-backend against the --store-file
// and --store-db combinations.
func (cfg *config) validateStoreBackend() error {
	switch cfg.StoreBackend {
	case "":
		if cfg.StoreDB != "" {
			return fmt.Errorf("--store-db requires --store-backend sqlite")
		}
	case "memory":
		if cfg.StoreFile != "" {
			return fmt.Errorf("--store-file cannot be combined with --store-backend memory")
		}
		if cfg.StoreDB != "" {
			return fmt.Errorf("--store-db cannot be combined with --store-backend memory")
		}
	case "file":
		if cfg.StoreFile == "" {
			return fmt.Errorf("--store-backend file requires --store-file")
		}
		if cfg.StoreDB != "" {
			return fmt.Errorf("--store-db cannot be combined with --store-backend file")
		}
	case "sqlite":
		if cfg.StoreDB == "" {
			return fmt.Errorf("--store-backend sqlite requires --store-db")
		}
		if cfg.StoreFile != "" {
			return fmt.Errorf("--store-file cannot be combined with --store-backend sqlite")
		}
	default:
		return fmt.Errorf("unknown --store-backend %q; supported values: memory, file, sqlite", cfg.StoreBackend)
	}
	if cfg.StoreReadiness && cfg.StoreBackend != "sqlite" {
		return fmt.Errorf("--store-readiness requires --store-backend sqlite")
	}
	return nil
}

// validateListenMode applies tailscale/remote-mode semantics and validates
// the listen address and its auth requirements.
func (cfg *config) validateListenMode() error {
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
			return err
		}
		if cfg.LocalAuthToken == "" && cfg.HubJWTSecret == "" {
			return fmt.Errorf("--remote-mode requires --local-auth-token or --hub-jwt-secret to be set")
		}
	} else {
		if err := security.ValidateLocalListenAddr(cfg.Addr); err != nil {
			return err
		}
	}
	if cfg.HubJWTSecret != "" && cfg.EdgeDeviceID == "" {
		return fmt.Errorf("--hub-jwt-secret requires --edge-device-id")
	}
	return nil
}

// validateRunnerAndArgs applies the runner profile and finalizes the
// runner-command/arg/env cross-checks, rejecting unexpected positional args.
func (cfg *config) validateRunnerAndArgs(fs *flag.FlagSet) error {
	if err := applyRunnerProfile(cfg); err != nil {
		return err
	}
	cfg.RunnerCommand = strings.TrimSpace(cfg.RunnerCommand)
	cfg.AgentDefault = strings.TrimSpace(cfg.AgentDefault)
	cfg.AllowedOrigins = trimRepeatedStrings(cfg.AllowedOrigins)
	cfg.RuntimeManifests = trimRepeatedStrings(cfg.RuntimeManifests)
	if cfg.RunnerCommand == "" && len(cfg.RunnerArgs) > 0 {
		return fmt.Errorf("--runner-arg requires --runner-command")
	}
	if cfg.RunnerCommand == "" && len(cfg.RunnerEnv) > 0 {
		return fmt.Errorf("--runner-env requires --runner-command")
	}
	if cfg.RunnerCommand == "" && cfg.RunnerWorkDir != "" {
		return fmt.Errorf("--runner-workdir requires --runner-command")
	}
	if _, err := lifecycle.NewCommandTemplate(nil, cfg.RunnerEnv); err != nil {
		return fmt.Errorf("--runner-env: %w", err)
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments: %v", fs.Args())
	}
	return nil
}

func resolveSDKAPIKey(value, envName string) string {
	if value == "" || strings.EqualFold(value, "env") {
		return os.Getenv(envName)
	}
	return value
}

// parseDurationOrDefault parses a duration string (e.g. "5m", "30s") and
// returns the parsed value. If parsing fails, it returns the default.
func parseDurationOrDefault(s string, defaultVal time.Duration) time.Duration {
	if s == "" {
		return defaultVal
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		slog.Warn("invalid duration, using default", "input", s, "default", defaultVal, "err", err)
		return defaultVal
	}
	return d
}
