package api

// Residual pure-helper peel #1133: shared model-catalog pure helpers extracted
// from model_catalog.go. Same package api; zero behavior change.

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
)

func addLocalConfigModelCatalog(builder *modelCatalogBuilder) {
	home, err := os.UserHomeDir()
	if err != nil {
		builder.addSource(modelCatalogSource{
			ID:     "local-config",
			Label:  "Local configuration",
			Status: "unavailable",
			Detail: "User home directory is not available.",
		})
		return
	}

	addCodexConfigCatalog(builder, configHome("CODEX_HOME", home, ".codex"))
	addClaudeSettingsCatalog(builder, configHome("CLAUDE_CONFIG_DIR", home, ".claude"))
	addClaudeProviderCatalog(builder, filepath.Join(configHome("CLAUDE_CONFIG_DIR", home, ".claude"), "cc-haha", "providers.json"))
	addCcSwitchCatalog(builder, configHome("CC_SWITCH_HOME", home, ".cc-switch"))
}

func configHome(envKey, home, fallbackName string) string {
	if value := strings.TrimSpace(os.Getenv(envKey)); value != "" {
		return value
	}
	return filepath.Join(home, fallbackName)
}

func readJSONFile(path string) (map[string]any, error) {
	// #nosec G304 -- model catalog config files come from operator config
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var raw map[string]any
	if err := json.NewDecoder(file).Decode(&raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func objectMap(value any) map[string]any {
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func stringValue(value any) string {
	if s, ok := value.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

func hostFromURL(raw string) string {
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return parsed.Host
}

func hostDetail(host string) string {
	if host == "" {
		return ""
	}
	return "Configured host: " + host
}

func runtimeProviderLabel(runtimeID string) string {
	switch runtimeID {
	case "claude-code":
		return "Claude Code"
	case "codex":
		return "Codex"
	case "opencode":
		return "OpenCode"
	case "orchestrator":
		return "Claude Code"
	default:
		return runtimeID
	}
}

func reasoningEffortsForRuntime(runtimeID string) []string {
	efforts := adapters.ReasoningEfforts[runtimeID]
	if len(efforts) == 0 {
		return nil
	}
	order := []string{"low", "medium", "high", "max"}
	result := make([]string, 0, len(order))
	for _, key := range order {
		if _, ok := efforts[key]; ok {
			result = append(result, key)
		}
	}
	return result
}

func strconvSafe(value int) string {
	const digits = "0123456789"
	if value == 0 {
		return "0"
	}
	var out []byte
	for value > 0 {
		out = append([]byte{digits[value%10]}, out...)
		value /= 10
	}
	return string(out)
}
