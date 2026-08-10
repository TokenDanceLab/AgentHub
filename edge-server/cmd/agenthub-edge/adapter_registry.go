package main

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/adapters/orchestrator"
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

	registerClaudeCodeAdapter(reg, cfg)
	registerCodexAdapter(reg, cfg)
	registerCodexACPAdapter(reg, cfg)
	registerOpenCodeAdapter(reg, cfg)
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
	a := adapters.NewClaudeCodeAdapter(cfg.ClaudeCodePath, cfg.AgentModel, "")
	if err := reg.Register(a); err != nil {
		slog.Warn("failed to register claude-code adapter", "err", err)
		return
	}
	slog.Info("registered adapter", "id", a.Metadata().ID, "path", cfg.ClaudeCodePath)
}

// registerCodexAdapter registers the codex CLI adapter.
func registerCodexAdapter(reg *adapters.Registry, cfg config) {
	if cfg.CodexPath == "" {
		return
	}
	a := adapters.NewCodexAdapter(cfg.CodexPath, cfg.AgentModel)
	if err := reg.Register(a); err != nil {
		slog.Warn("failed to register codex adapter", "err", err)
		return
	}
	slog.Info("registered adapter", "id", a.Metadata().ID, "path", cfg.CodexPath)
}

// registerCodexACPAdapter registers the official codex-acp ACP adapter via
// npx (ACP migration, first switch target; default off — enable with
// --codex-acp-path npx.cmd). Cutover = point --agent-default (or per-run
// agentId) at "codex-acp".
func registerCodexACPAdapter(reg *adapters.Registry, cfg config) {
	if cfg.CodexACPPath == "" {
		return
	}
	a := adapters.NewCodexACPadapter(cfg.CodexACPPath)
	if err := reg.Register(a); err != nil {
		slog.Warn("failed to register codex-acp adapter", "err", err)
		return
	}
	slog.Info("registered adapter", "id", a.Metadata().ID, "launcher", cfg.CodexACPPath, "version", a.Metadata().Version, "available", a.Available())
}

// registerOpenCodeAdapter registers the opencode CLI adapter.
func registerOpenCodeAdapter(reg *adapters.Registry, cfg config) {
	if cfg.OpenCodePath == "" {
		return
	}
	a := adapters.NewOpenCodeAdapter(cfg.OpenCodePath)
	if err := reg.Register(a); err != nil {
		slog.Warn("failed to register opencode adapter", "err", err)
		return
	}
	slog.Info("registered adapter", "id", a.Metadata().ID, "path", cfg.OpenCodePath)
}

// registerOpenCodeACPAdapter registers the native `opencode acp` subcommand
// adapter (ACP migration, second switch target; default off — enable with
// --opencode-acp-path opencode). Cutover = point --agent-default (or per-run
// agentId) at "opencode-acp".
func registerOpenCodeACPAdapter(reg *adapters.Registry, cfg config) {
	if cfg.OpencodeACPPath == "" {
		return
	}
	a := adapters.NewOpenCodeACPAdapter(cfg.OpencodeACPPath)
	if err := reg.Register(a); err != nil {
		slog.Warn("failed to register opencode-acp adapter", "err", err)
		return
	}
	slog.Info("registered adapter", "id", a.Metadata().ID, "path", cfg.OpencodeACPPath, "version", a.Metadata().Version, "available", a.Available())
}

// registerClaudeACPAdapter registers the official claude-agent-acp ACP adapter
// via npx (ACP migration, third switch target; default off — enable with
// --claude-acp-path npx.cmd). The legacy claude-code NDJSON parser stays
// registered as a fallback and control (claude_code.go, marked DEPRECATED).
func registerClaudeACPAdapter(reg *adapters.Registry, cfg config) {
	if cfg.ClaudeACPPath == "" {
		return
	}
	a := adapters.NewClaudeACPAdapter(cfg.ClaudeACPPath)
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
		a := adapters.NewAnthropicSDKAdapter(apiKey, cfg.AgentModel, edgehttp.NewClient(adapters.AnthropicHTTPTimeout))
		if err := reg.Register(a); err != nil {
			slog.Warn("failed to register anthropic-sdk adapter", "err", err)
		} else {
			slog.Info("registered adapter", "id", a.Metadata().ID, "available", a.Available())
		}
	}
	if cfg.OpenAISDKPath != "" {
		apiKey := resolveSDKAPIKey(cfg.OpenAISDKPath, "OPENAI_API_KEY")
		a := adapters.NewOpenAISDKAdapter(apiKey, cfg.AgentModel, edgehttp.NewClient(adapters.OpenAIHTTPTimeout))
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
	inner := adapters.NewClaudeCodeAdapter(cfg.ClaudeCodePath, cfg.AgentModel, "")
	a := orchestrator.NewOrchestratorAdapter(inner, orchestrator.DefaultOrchestratorPrompt(childAgents))
	if err := reg.Register(a); err != nil {
		slog.Warn("failed to register orchestrator adapter", "err", err)
		return
	}
	reg.SetDefault("orchestrator", a.Metadata().ID)
	slog.Info("registered adapter", "id", a.Metadata().ID, "path", cfg.ClaudeCodePath, "children", childAgents)
}

func registeredChildAgentIDs(reg *adapters.Registry) []string {
	ids := make([]string, 0, 3)
	for _, id := range []string{"claude-code", "codex", "opencode", "anthropic-sdk", "openai-sdk"} {
		if _, ok := reg.Get(id); ok {
			ids = append(ids, id)
		}
	}
	return ids
}
