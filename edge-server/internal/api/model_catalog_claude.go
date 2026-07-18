package api

// Residual pure-helper peel #1133: Claude Code settings/provider catalog pure
// helpers extracted from model_catalog.go. Same package api; zero behavior change.

import (
	"path/filepath"
	"sort"
)

func addClaudeSettingsCatalog(builder *modelCatalogBuilder, claudeHome string) {
	path := filepath.Join(claudeHome, "settings.json")
	settings, err := readJSONFile(path)
	if err != nil {
		builder.addSource(modelCatalogSource{
			ID:     "claude-settings",
			Label:  "Claude Code settings",
			Status: "unavailable",
			Detail: "No readable Claude Code settings found.",
		})
		return
	}
	env := objectMap(settings["env"])
	host := hostFromURL(stringValue(env["ANTHROPIC_BASE_URL"]))
	builder.addSource(modelCatalogSource{
		ID:     "claude-settings",
		Label:  "Claude Code settings",
		Status: "ready",
		Detail: hostDetail(host),
	})
	if selected := stringValue(settings["model"]); selected != "" {
		builder.addItem(modelCatalogItem{
			ID:               "claude-settings:selected",
			Value:            selected,
			Label:            selected,
			Provider:         "Claude Code",
			RuntimeID:        "claude-code",
			ResolvedModel:    selected,
			SourceID:         "claude-settings",
			SourceLabel:      "Claude Code settings",
			Status:           "configured",
			Description:      "Current Claude Code model selection.",
			Tags:             []string{"local-config", "claude-code", "selected"},
			ReasoningEfforts: reasoningEffortsForRuntime("claude-code"),
			Default:          true,
		})
	}
	for _, entry := range []struct {
		idKey    string
		nameKey  string
		tag      string
		fallback string
	}{
		{"ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME", "opus", "Opus"},
		{"ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME", "sonnet", "Sonnet"},
		{"ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME", "haiku", "Haiku"},
		{"CLAUDE_CODE_SUBAGENT_MODEL", "", "subagent", "Subagent"},
	} {
		value := stringValue(env[entry.idKey])
		if value == "" {
			continue
		}
		label := stringValue(env[entry.nameKey])
		if label == "" {
			label = entry.fallback
		}
		builder.addItem(modelCatalogItem{
			ID:               "claude-settings:" + entry.idKey,
			Value:            value,
			Label:            label,
			Provider:         "Claude Code",
			RuntimeID:        "claude-code",
			ResolvedModel:    value,
			SourceID:         "claude-settings",
			SourceLabel:      "Claude Code settings",
			Status:           "configured",
			Description:      "Read from Claude Code local settings.",
			Tags:             []string{"local-config", "claude-code", entry.tag},
			ReasoningEfforts: reasoningEffortsForRuntime("claude-code"),
		})
	}
}

func addClaudeProviderCatalog(builder *modelCatalogBuilder, path string) {
	raw, err := readJSONFile(path)
	if err != nil {
		builder.addSource(modelCatalogSource{
			ID:     "claude-provider-map",
			Label:  "Claude provider mappings",
			Status: "unavailable",
			Detail: "No readable provider mapping file found.",
		})
		return
	}
	providers, _ := raw["providers"].([]any)
	if len(providers) == 0 {
		builder.addSource(modelCatalogSource{
			ID:     "claude-provider-map",
			Label:  "Claude provider mappings",
			Status: "unavailable",
			Detail: "Provider mapping file has no providers.",
		})
		return
	}
	builder.addSource(modelCatalogSource{
		ID:     "claude-provider-map",
		Label:  "Claude provider mappings",
		Status: "ready",
		Detail: "Provider aliases read from Claude Code provider mapping.",
	})
	for providerIndex, providerValue := range providers {
		provider := objectMap(providerValue)
		name := stringValue(provider["name"])
		if name == "" {
			name = "Claude provider"
		}
		host := hostFromURL(stringValue(provider["baseUrl"]))
		models := objectMap(provider["models"])
		modelKeys := make([]string, 0, len(models))
		for key := range models {
			modelKeys = append(modelKeys, key)
		}
		sort.Strings(modelKeys)
		for _, key := range modelKeys {
			value := stringValue(models[key])
			if value == "" {
				continue
			}
			builder.addItem(modelCatalogItem{
				ID:               "claude-provider-map:" + strconvSafe(providerIndex) + ":" + key,
				Value:            value,
				Label:            key,
				Provider:         name,
				RuntimeID:        "claude-code",
				ResolvedModel:    value,
				SourceID:         "claude-provider-map",
				SourceLabel:      "Claude provider mappings",
				Status:           "configured",
				Description:      hostDetail(host),
				Tags:             []string{"provider-map", "claude-code"},
				ReasoningEfforts: reasoningEffortsForRuntime("claude-code"),
			})
		}
	}
}
