// Package adapters provides model configuration resolution for all agent runtimes.
//
// # Model configuration sources (merge order, later overrides earlier)
//
//  1. Static defaults — hardcoded ModelAliases, DefaultModels, ReasoningEfforts maps
//     in this file. These are the baseline fallback for all agents.
//  2. cc-switch dynamic aliases — ConsumeCCSwitchModels() reads the cc-switch SQLite
//     database and merges provider model aliases into the static ModelAliases map.
//     cc-switch entries override static entries on key match; static entries that
//     do not conflict are preserved (never removed).
//
// # Graceful degradation
//
// If the cc-switch database is missing, unreadable, or contains no usable data,
// ConsumeCCSwitchModels returns an error. Callers log a WARNING and continue with
// static config only — cc-switch is an optional enhancement, never a hard
// dependency. Edge Server starts and operates normally without it.
//
// # Dynamic routing capability
//
// When cc-switch is active, model resolution is transparently rerouted at the Edge
// layer: a user selecting "claude-sonnet" may actually run against a DeepSeek,
// GLM, or Qwen backend configured in cc-switch, without changing their AgentHub
// profile. This is the same transparent proxy mechanism that cc-switch provides
// for Claude Code / Codex CLI, now surfaced to Edge Server adapter model resolution.
package adapters

import (
	"fmt"
	"log/slog"

	"github.com/agenthub/edge-server/internal/ccswitch"
)

// ModelAliases resolves short names to full model IDs per agent CLI.
// Example: "sonnet" → "claude-sonnet-4-6" for Claude Code.
//
// This map is the static baseline. At startup, ConsumeCCSwitchModels() may
// dynamically augment it with cc-switch provider aliases (cc-switch entries
// override static entries on key conflict; non-conflicting static entries are
// preserved). Code that reads ModelAliases after startup sees the merged result.
var ModelAliases = map[string]map[string]string{
	"claude-code": {
		"opus":   "claude-opus-4-7",
		"sonnet": "claude-sonnet-4-6",
		"haiku":  "claude-haiku-4-5-20251001",
		// Direct model-name aliases for convenience
		"4.7": "claude-opus-4-7",
		"4.6": "claude-sonnet-4-6",
		"4.5": "claude-haiku-4-5-20251001",
	},
	"anthropic-sdk": {
		"opus":   "claude-opus-4-7",
		"sonnet": "claude-sonnet-4-6",
		"haiku":  "claude-haiku-4-5-20251001",
		"4.7":    "claude-opus-4-7",
		"4.6":    "claude-sonnet-4-6",
		"4.5":    "claude-haiku-4-5-20251001",
	},
	"openai-sdk": {
		"gpt-5":       "gpt-5.5",
		"gpt-5-codex": "gpt-5.3-codex",
		"gpt-5-mini":  "gpt-5.4-mini",
		"gpt-5.5":     "gpt-5.5",
		"o4":          "o4-mini",
	},
}

// ReasoningEfforts maps generic effort levels to CLI-specific values.
var ReasoningEfforts = map[string]map[string]string{
	"claude-code": {
		"low":    "low",
		"medium": "medium",
		"high":   "high",
		"max":    "max",
	},
	"anthropic-sdk": {
		"low":    "low",
		"medium": "medium",
		"high":   "high",
		"max":    "max",
	},
	"openai-sdk": {
		"low":    "low",
		"medium": "medium",
		"high":   "high",
		"max":    "max",
	},
}

// DefaultModels holds the default model per agent ID.
var DefaultModels = map[string]string{
	"claude-code":   "claude-sonnet-4-6",
	"orchestrator":  "claude-sonnet-4-6",
	"anthropic-sdk": "claude-sonnet-4-6",
	"openai-sdk":    "gpt-5.5",
}

// ResolveModel resolves a model identifier for a specific agent.
// If the model is found in ModelAliases[agentID], the alias is resolved.
// Otherwise the model is returned as-is (passthrough for direct model IDs).
func ResolveModel(agentID, model string) string {
	if model == "" {
		return ""
	}
	if aliases, ok := ModelAliases[agentID]; ok {
		if resolved, ok := aliases[model]; ok {
			return resolved
		}
	}
	return model
}

// ResolveReasoningEffort maps a generic effort level to the CLI-specific value.
func ResolveReasoningEffort(agentID, effort string) string {
	if effort == "" {
		return ""
	}
	if efforts, ok := ReasoningEfforts[agentID]; ok {
		if resolved, ok := efforts[effort]; ok {
			return resolved
		}
	}
	return effort
}

// ResolveModelWithDefault is like ResolveModel but falls back to DefaultModels[agentID]
// when the model is empty.
func ResolveModelWithDefault(agentID, model string) string {
	resolved := ResolveModel(agentID, model)
	if resolved != "" {
		return resolved
	}
	return DefaultModels[agentID]
}

// appTypeToAgentID maps cc-switch app_type values to AgentHub adapter IDs.
// Only app_types present in this map are consumed; unknown app_types in the
// cc-switch database are silently skipped.
//
// codex / opencode 已迁移到 ACP（codex-acp / opencode-acp），其模型解析在
// ACP 进程内完成，不走本表的 ModelAliases，因此不再在此消费 cc-switch 别名。
var appTypeToAgentID = map[string]string{
	"claude": "claude-code",
}

// ConsumeCCSwitchModels reads model aliases from the cc-switch SQLite database at
// dbPath and merges them into the static ModelAliases table.
//
// # Merge semantics
//
// For each cc-switch provider whose app_type maps to a known AgentHub adapter
// (claude → claude-code), the provider's model aliases (parsed from settings_config
// env vars like ANTHROPIC_DEFAULT_SONNET_MODEL) are written into ModelAliases[agentID]:
//
//   - cc-switch entries override static entries on key match (e.g. if cc-switch
//     says "sonnet" → "deepseek-v4-pro", that replaces the static "claude-sonnet-4-6").
//   - Static entries that do not conflict are preserved (never removed).
//   - Multiple cc-switch providers for the same app_type are merged; the last
//     provider in iteration order wins on conflict within cc-switch data.
//   - Providers with empty model aliases are skipped.
//   - Unknown app_types are silently skipped.
//
// # Graceful degradation
//
// On error (DB not found, unreadable, empty, no usable providers) the function
// returns nil and the error. Callers MUST log a WARNING and continue with static
// config only — cc-switch is an optional enhancement, never a fatal condition.
// Edge Server starts and serves normally without cc-switch.
//
// # Return value
//
// On success it returns the set of cc-switch-sourced aliases that were merged
// (keyed by adapter agentID) and logs the merged count at INFO level.
func ConsumeCCSwitchModels(dbPath string) (map[string]map[string]string, error) {
	reader := ccswitch.NewReaderWithPath(dbPath)
	if reader == nil {
		return nil, fmt.Errorf("cc-switch database not found at %s", dbPath)
	}

	result, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("read cc-switch database: %w", err)
	}

	// Build cc-switch aliases keyed by adapter agentID.
	ccAliases := make(map[string]map[string]string)
	for _, p := range result.Providers {
		agentID, ok := appTypeToAgentID[p.AppType]
		if !ok {
			continue
		}
		if len(p.ModelAliases) == 0 {
			continue
		}
		if ccAliases[agentID] == nil {
			ccAliases[agentID] = make(map[string]string)
		}
		for alias, model := range p.ModelAliases {
			ccAliases[agentID][alias] = model
		}
	}

	// Merge into static ModelAliases: cc-switch overrides static on key match.
	totalMerged := 0
	for agentID, aliases := range ccAliases {
		if ModelAliases[agentID] == nil {
			ModelAliases[agentID] = make(map[string]string)
		}
		for alias, model := range aliases {
			ModelAliases[agentID][alias] = model
			totalMerged++
		}
	}

	slog.Info("cc-switch model aliases merged into static config",
		"db", dbPath,
		"mergedCount", totalMerged,
		"adapterCount", len(ccAliases))
	return ccAliases, nil
}
