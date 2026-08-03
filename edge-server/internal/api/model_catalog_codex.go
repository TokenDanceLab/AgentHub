package api

// Residual pure-helper peel #1133: Codex config catalog pure helpers extracted
// from model_catalog.go. Same package api; zero behavior change.

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

func addCodexConfigCatalog(builder *modelCatalogBuilder, codexHome string) {
	path := filepath.Join(codexHome, "config.toml")
	cfg, err := readCodexModelConfig(path)
	if err != nil {
		builder.addSource(modelCatalogSource{
			ID:     "codex-config",
			Label:  "Codex config",
			Status: "unavailable",
			Detail: "No readable Codex config found.",
		})
		return
	}
	provider := cfg.ProviderName
	if provider == "" {
		provider = cfg.Provider
	}
	host := hostFromURL(cfg.BaseURL)
	detail := strings.TrimSpace(strings.Join([]string{provider, host, cfg.WireAPI}, " "))
	builder.addSource(modelCatalogSource{
		ID:     "codex-config",
		Label:  "Codex config",
		Status: "ready",
		Detail: detail,
	})
	if cfg.Model != "" {
		builder.addItem(modelCatalogItem{
			ID:               "codex-config:model",
			Value:            cfg.Model,
			Label:            cfg.Model,
			Provider:         provider,
			RuntimeID:        "codex",
			ResolvedModel:    cfg.Model,
			SourceID:         "codex-config",
			SourceLabel:      "Codex config",
			Status:           "configured",
			Description:      hostDetail(host),
			Tags:             []string{"local-config", "codex"},
			ReasoningEfforts: reasoningEffortsForRuntime("codex"),
			Default:          true,
		})
	}
}

type codexModelConfig struct {
	Model        string
	Provider     string
	ProviderName string
	BaseURL      string
	WireAPI      string
}

func readCodexModelConfig(path string) (codexModelConfig, error) {
	// #nosec G304 -- codex config path comes from operator config
	file, err := os.Open(path)
	if err != nil {
		return codexModelConfig{}, err
	}
	defer file.Close()

	var cfg codexModelConfig
	currentProvider := ""
	providerFields := map[string]map[string]string{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[model_providers.") && strings.HasSuffix(line, "]") {
			currentProvider = strings.TrimSuffix(strings.TrimPrefix(line, "[model_providers."), "]")
			if providerFields[currentProvider] == nil {
				providerFields[currentProvider] = map[string]string{}
			}
			continue
		}
		if strings.HasPrefix(line, "[") {
			currentProvider = ""
			continue
		}
		key, value, ok := parseSimpleTOMLString(line)
		if !ok {
			continue
		}
		if currentProvider == "" {
			switch key {
			case "model":
				cfg.Model = value
			case "model_provider":
				cfg.Provider = value
			}
			continue
		}
		providerFields[currentProvider][key] = value
	}
	if err := scanner.Err(); err != nil {
		return codexModelConfig{}, err
	}
	fields := providerFields[cfg.Provider]
	cfg.ProviderName = fields["name"]
	cfg.BaseURL = fields["base_url"]
	cfg.WireAPI = fields["wire_api"]
	return cfg, nil
}

func parseSimpleTOMLString(line string) (string, string, bool) {
	before, after, ok := strings.Cut(line, "=")
	if !ok {
		return "", "", false
	}
	key := strings.TrimSpace(before)
	value := strings.TrimSpace(after)
	if idx := strings.Index(value, "#"); idx >= 0 {
		value = strings.TrimSpace(value[:idx])
	}
	if len(value) < 2 || value[0] != '"' || value[len(value)-1] != '"' {
		return "", "", false
	}
	return key, strings.Trim(value, `"`), true
}
