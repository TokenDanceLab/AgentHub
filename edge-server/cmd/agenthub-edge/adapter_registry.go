package main

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/adapters/claude"
	"github.com/agenthub/edge-server/internal/adapters/codex"
	"github.com/agenthub/edge-server/internal/adapters/opencode"
	"github.com/agenthub/edge-server/internal/adapters/orchestrator"
	"github.com/agenthub/edge-server/internal/adapters/sdk"
	"github.com/agenthub/edge-server/internal/edgehttp"
)

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
			cfg.AgentDefault = "claude-acp"
		}
	case runnerProfileCodex:
		if strings.TrimSpace(cfg.RunnerCommand) == "" {
			cfg.RunnerCommand = cfg.ClaudeCodePath
		}
		if cfg.AgentDefault == "" {
			cfg.AgentDefault = "codex-acp"
		}
	case runnerProfileOpenCode:
		if strings.TrimSpace(cfg.RunnerCommand) == "" {
			cfg.RunnerCommand = cfg.ClaudeCodePath
		}
		if cfg.AgentDefault == "" {
			cfg.AgentDefault = "opencode-acp"
		}
	default:
		return fmt.Errorf("unknown --runner-profile %q; supported values: agenthub-runner-mock, claude-code, codex, opencode", cfg.RunnerProfile)
	}
	return nil
}

func buildAdapterRegistry(cfg config) *adapters.Registry {
	reg := adapters.NewRegistry()

	registerClaudeCodeAdapter(reg, cfg)
	registerCodexACPAdapter(reg, cfg)
	registerOpenCodeACPAdapter(reg, cfg)
	registerClaudeACPAdapter(reg, cfg)
	registerManifestAdapters(reg, cfg)
	registerSDKAdapters(reg, cfg)
	registerAdapter(reg, cfg)

	if cfg.AgentDefault != "" {
		reg.SetDefault("default", cfg.AgentDefault)
	}

	return reg
}

// registerClaudeCodeAdapter registers the legacy claude-code NDJSON adapter.
func registerClaudeCodeAdapter(reg *adapters.Registry, cfg config) {
	if cfg.ClaudeCodePath == "" {
		return
	}
	a := claude.NewClaudeCodeAdapter(cfg.ClaudeCodePath, cfg.AgentModel, "")
	if err := reg.Register(a); err != nil {
		slog.Warn("failed to register claude-code adapter", "err", err)
		return
	}
	slog.Info("registered adapter", "id", a.Metadata().ID, "path", cfg.ClaudeCodePath)
}

// registerCodexACPAdapter registers the official codex-acp ACP adapter via
// npx. ACP is the default codex runtime; an empty launcher falls back to the
// platform-native npx (codex.DefaultNpxPath inside NewCodexACPadapter).
func registerCodexACPAdapter(reg *adapters.Registry, cfg config) {
	a := codex.NewCodexACPadapter(cfg.CodexACPPath)
	if err := reg.Register(a); err != nil {
		slog.Warn("failed to register codex-acp adapter", "err", err)
		return
	}
	slog.Info("registered adapter", "id", a.Metadata().ID, "launcher", cfg.CodexACPPath, "version", a.Metadata().Version, "available", a.Available())
}

// registerOpenCodeACPAdapter registers the native `opencode acp` subcommand
// adapter. ACP is the default opencode runtime; an empty path falls back to
// the platform-native "opencode" binary.
func registerOpenCodeACPAdapter(reg *adapters.Registry, cfg config) {
	a := opencode.NewOpenCodeACPAdapter(cfg.OpencodeACPPath)
	if err := reg.Register(a); err != nil {
		slog.Warn("failed to register opencode-acp adapter", "err", err)
		return
	}
	slog.Info("registered adapter", "id", a.Metadata().ID, "path", cfg.OpencodeACPPath, "version", a.Metadata().Version, "available", a.Available())
}

// registerClaudeACPAdapter registers the official claude-agent-acp ACP adapter
// via npx. ACP is the default claude runtime; an empty launcher falls back to
// the platform-native npx (adapters.DefaultNpxPath inside NewClaudeACPAdapter).
// The legacy claude-code NDJSON parser stays registered as the orchestrator
// inner and fallback (claude_code.go, marked DEPRECATED until Phase B).
func registerClaudeACPAdapter(reg *adapters.Registry, cfg config) {
	a := claude.NewClaudeACPAdapter(cfg.ClaudeACPPath, cfg.AgentModel)
	if err := reg.Register(a); err != nil {
		slog.Warn("failed to register claude-acp adapter", "err", err)
		return
	}
	slog.Info("registered adapter", "id", a.Metadata().ID, "launcher", cfg.ClaudeACPPath, "version", a.Metadata().Version, "available", a.Available())
}

// registerManifestAdapters registers fixture-only custom runtime manifests.
func registerManifestAdapters(reg *adapters.Registry, cfg config) {
	for _, manifestPath := range cfg.RuntimeManifests {
		manifest, err := adapters.LoadRuntimeManifestFile(manifestPath)
		if err != nil {
			slog.Warn("failed to load runtime manifest", "path", manifestPath, "err", err)
			continue
		}
		a := adapters.NewRuntimeManifestAdapter(manifest)
		if err := reg.Register(a); err != nil {
			slog.Warn("failed to register runtime manifest adapter", "id", manifest.ID, "path", manifestPath, "err", err)
			continue
		}
		slog.Info("registered runtime manifest adapter", "id", a.Metadata().ID, "path", manifestPath, "fixture", manifest.Fixture.Type)
	}
}

// registerSDKAdapters registers the direct HTTP API adapters (no CLI
// subprocess needed). When the flag value is "env" or empty, the API key is
// read from the corresponding environment variable.
//
// The shared outbound client is built here at the composition root via
// edgehttp.NewClient and injected into both SDK adapters (#1592): one client
// per adapter (connection reuse across retries), redirect refusal and the
// long streaming timeout come from the edgehttp policy primitive.
func registerSDKAdapters(reg *adapters.Registry, cfg config) {
	if cfg.AnthropicSDKPath != "" {
		apiKey := resolveSDKAPIKey(cfg.AnthropicSDKPath, "ANTHROPIC_API_KEY")
		a := sdk.NewAnthropicSDKAdapter(apiKey, cfg.AgentModel, edgehttp.NewClient(sdk.AnthropicHTTPTimeout))
		if err := reg.Register(a); err != nil {
			slog.Warn("failed to register anthropic-sdk adapter", "err", err)
		} else {
			slog.Info("registered adapter", "id", a.Metadata().ID, "available", a.Available())
		}
	}
	if cfg.OpenAISDKPath != "" {
		apiKey := resolveSDKAPIKey(cfg.OpenAISDKPath, "OPENAI_API_KEY")
		a := sdk.NewOpenAISDKAdapter(apiKey, cfg.AgentModel, edgehttp.NewClient(sdk.OpenAIHTTPTimeout))
		if err := reg.Register(a); err != nil {
			slog.Warn("failed to register openai-sdk adapter", "err", err)
		} else {
			slog.Info("registered adapter", "id", a.Metadata().ID, "available", a.Available())
		}
	}
}

// registerAdapter registers the orchestrator adapter with the
// registered child agent IDs when a claude-code binary is configured.
// The orchestrator leaf package gets the concrete ClaudeCodeAdapter through
// its AgentExecutor port (composition root injects concrete deps, #1566).
func registerAdapter(reg *adapters.Registry, cfg config) {
	if cfg.ClaudeCodePath == "" {
		return
	}
	childAgents := registeredChildAgentIDs(reg)
	inner := claude.NewClaudeCodeAdapter(cfg.ClaudeCodePath, cfg.AgentModel, "")
	a := orchestrator.NewOrchestratorAdapter(inner, orchestrator.DefaultOrchestratorPrompt(childAgents))
	if err := reg.Register(a); err != nil {
		slog.Warn("failed to register orchestrator adapter", "err", err)
		return
	}
	reg.SetDefault("orchestrator", a.Metadata().ID)
	slog.Info("registered adapter", "id", a.Metadata().ID, "path", cfg.ClaudeCodePath, "children", childAgents)
}

func registeredChildAgentIDs(reg *adapters.Registry) []string {
	ids := make([]string, 0, 5)
	for _, id := range []string{"claude-code", "codex-acp", "opencode-acp", "anthropic-sdk", "openai-sdk"} {
		if _, ok := reg.Get(id); ok {
			ids = append(ids, id)
		}
	}
	return ids
}
