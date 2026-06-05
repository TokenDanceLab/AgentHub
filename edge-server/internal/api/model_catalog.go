package api

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/errcode"
)

type modelCatalogResponse struct {
	Items   []modelCatalogItem   `json:"items"`
	Sources []modelCatalogSource `json:"sources"`
}

type modelCatalogItem struct {
	ID               string   `json:"id"`
	Value            string   `json:"value"`
	Label            string   `json:"label"`
	Provider         string   `json:"provider,omitempty"`
	RuntimeID        string   `json:"runtimeId,omitempty"`
	ResolvedModel    string   `json:"resolvedModel,omitempty"`
	SourceID         string   `json:"sourceId"`
	SourceLabel      string   `json:"sourceLabel"`
	Status           string   `json:"status"`
	Description      string   `json:"description,omitempty"`
	Tags             []string `json:"tags,omitempty"`
	ReasoningEfforts []string `json:"reasoningEfforts,omitempty"`
	Default          bool     `json:"default,omitempty"`
}

type modelCatalogSource struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

func (h *Handler) GetModelCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		return
	}
	writeJSON(w, http.StatusOK, h.buildModelCatalog())
}

func (h *Handler) buildModelCatalog() modelCatalogResponse {
	builder := &modelCatalogBuilder{
		itemsByID:   map[string]modelCatalogItem{},
		sourcesByID: map[string]modelCatalogSource{},
	}
	builder.addSource(modelCatalogSource{
		ID:     "edge-adapter",
		Label:  "Edge adapter mappings",
		Status: "ready",
		Detail: "Runtime alias mappings compiled into the local Edge adapter layer.",
	})
	h.addAdapterModelCatalog(builder)
	addLocalConfigModelCatalog(builder)
	return builder.response()
}

func (h *Handler) addAdapterModelCatalog(builder *modelCatalogBuilder) {
	runtimeIDs := make([]string, 0, len(adapters.ModelAliases))
	for runtimeID := range adapters.ModelAliases {
		runtimeIDs = append(runtimeIDs, runtimeID)
	}
	for runtimeID := range adapters.DefaultModels {
		if _, ok := adapters.ModelAliases[runtimeID]; !ok {
			runtimeIDs = append(runtimeIDs, runtimeID)
		}
	}
	sort.Strings(runtimeIDs)

	for _, runtimeID := range runtimeIDs {
		status := h.adapterModelStatus(runtimeID)
		provider := runtimeProviderLabel(runtimeID)
		efforts := reasoningEffortsForRuntime(runtimeID)
		aliases := adapters.ModelAliases[runtimeID]
		aliasNames := make([]string, 0, len(aliases))
		for alias := range aliases {
			aliasNames = append(aliasNames, alias)
		}
		sort.Strings(aliasNames)
		for _, alias := range aliasNames {
			resolved := aliases[alias]
			builder.addItem(modelCatalogItem{
				ID:               "edge-adapter:" + runtimeID + ":" + alias,
				Value:            alias,
				Label:            alias,
				Provider:         provider,
				RuntimeID:        runtimeID,
				ResolvedModel:    resolved,
				SourceID:         "edge-adapter",
				SourceLabel:      "Edge adapter mappings",
				Status:           status,
				Description:      "Resolved by local Edge before launching the runtime.",
				Tags:             []string{"alias", runtimeID},
				ReasoningEfforts: efforts,
			})
		}
		if defaultModel := adapters.DefaultModels[runtimeID]; defaultModel != "" {
			builder.addItem(modelCatalogItem{
				ID:               "edge-adapter:" + runtimeID + ":default",
				Value:            defaultModel,
				Label:            defaultModel,
				Provider:         provider,
				RuntimeID:        runtimeID,
				ResolvedModel:    defaultModel,
				SourceID:         "edge-adapter",
				SourceLabel:      "Edge adapter mappings",
				Status:           status,
				Description:      "Default model compiled into the local Edge adapter.",
				Tags:             []string{"default", runtimeID},
				ReasoningEfforts: efforts,
				Default:          true,
			})
		}
	}
}

func (h *Handler) adapterModelStatus(runtimeID string) string {
	if h.AdapterRegistry == nil {
		return "configured"
	}
	adapter, ok := h.AdapterRegistry.Get(runtimeID)
	if !ok {
		return "configured"
	}
	if adapter.Available() {
		return "available"
	}
	return "unavailable"
}

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

func addCcSwitchCatalog(builder *modelCatalogBuilder, ccSwitchHome string) {
	path := filepath.Join(ccSwitchHome, "settings.json")
	raw, err := readJSONFile(path)
	if err != nil {
		builder.addSource(modelCatalogSource{
			ID:     "cc-switch",
			Label:  "cc-switch",
			Status: "unavailable",
			Detail: "No readable cc-switch settings found.",
		})
		return
	}
	configured := 0
	for _, key := range []string{"currentProviderClaude", "currentProviderClaudeDesktop", "currentProviderCodex"} {
		if stringValue(raw[key]) != "" {
			configured++
		}
	}
	status := "unavailable"
	detail := "No active provider selection found."
	if configured > 0 {
		status = "configured"
		detail = "Provider selections are configured; provider IDs are redacted from the catalog."
	}
	builder.addSource(modelCatalogSource{
		ID:     "cc-switch",
		Label:  "cc-switch",
		Status: status,
		Detail: detail,
	})
}

func readJSONFile(path string) (map[string]any, error) {
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

type modelCatalogBuilder struct {
	itemsByID   map[string]modelCatalogItem
	sourcesByID map[string]modelCatalogSource
}

func (b *modelCatalogBuilder) addSource(source modelCatalogSource) {
	if source.ID == "" {
		return
	}
	b.sourcesByID[source.ID] = source
}

func (b *modelCatalogBuilder) addItem(item modelCatalogItem) {
	if item.ID == "" || item.Value == "" {
		return
	}
	if item.Label == "" {
		item.Label = item.Value
	}
	b.itemsByID[item.ID] = item
}

func (b *modelCatalogBuilder) response() modelCatalogResponse {
	items := make([]modelCatalogItem, 0, len(b.itemsByID))
	for _, item := range b.itemsByID {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].RuntimeID != items[j].RuntimeID {
			return items[i].RuntimeID < items[j].RuntimeID
		}
		if items[i].SourceID != items[j].SourceID {
			return items[i].SourceID < items[j].SourceID
		}
		return items[i].Label < items[j].Label
	})

	sources := make([]modelCatalogSource, 0, len(b.sourcesByID))
	for _, source := range b.sourcesByID {
		sources = append(sources, source)
	}
	sort.Slice(sources, func(i, j int) bool {
		return sources[i].ID < sources[j].ID
	})
	return modelCatalogResponse{Items: items, Sources: sources}
}
