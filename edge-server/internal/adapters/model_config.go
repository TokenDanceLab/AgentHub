package adapters

// ModelAliases resolves short names to full model IDs per agent CLI.
// Example: "sonnet" → "claude-sonnet-4-6" for Claude Code.
var ModelAliases = map[string]map[string]string{
	"claude-code": {
		"opus":   "claude-opus-4-7",
		"sonnet": "claude-sonnet-4-6",
		"haiku":  "claude-haiku-4-5-20251001",
	},
	"codex": {
		"gpt-5":       "gpt-5.3-codex",
		"gpt-5-codex": "gpt-5.3-codex",
		"gpt-5-mini":  "gpt-5.4-mini",
		"o4":          "o4-mini",
	},
	"opencode": {
		// OpenCode uses provider/model format — aliases resolve the model part.
		"opus":   "newapi/deepseek-v4-pro",
		"sonnet": "newapi/deepseek-v4-pro",
		"haiku":  "newapi/deepseek-v4-pro",
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
	"codex": {
		"low":    "minimal",
		"medium": "low",
		"high":   "high",
		"max":    "xhigh",
	},
	"opencode": {
		// OpenCode uses --variant flag rather than --reasoning-effort.
		"low":    "minimal",
		"medium": "",
		"high":   "high",
		"max":    "max",
	},
}

// DefaultModels holds the default model per agent ID.
var DefaultModels = map[string]string{
	"claude-code":  "claude-sonnet-4-6",
	"codex":        "gpt-5.3-codex",
	"opencode":     "newapi/deepseek-v4-pro",
	"orchestrator": "claude-sonnet-4-6",
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
