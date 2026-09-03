// Package ccswitch reads the cc-switch SQLite database to discover transparent
// proxy model aliases and provider configuration. cc-switch is a transparent
// proxy that sits between Claude Code / Codex and upstream API providers,
// rewriting requests so that Claude Code thinks it is talking to Anthropic
// while the actual backend may be DeepSeek, GLM, Qwen, etc.
//
// The database lives at ~/.cc-switch/cc-switch.db (or $CC_SWITCH_HOME/cc-switch.db).
package ccswitch

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	// modernc.org/sqlite registers its "sqlite" driver via init; the blank
	// import is required for database/sql to find it without importing the
	// driver's API surface.
	_ "modernc.org/sqlite"
)

// Status describes whether cc-switch is installed and active on this
// machine.
type Status struct {
	Installed     bool   `json:"installed"`
	DBPath        string `json:"dbPath,omitempty"`
	ConfigDir     string `json:"configDir,omitempty"`
	RoutingActive bool   `json:"routingActive"`
	// ProxyPort is the port cc-switch proxy listens on (from proxy_config).
	ProxyPort int `json:"proxyPort,omitempty"`
	// ActiveAppTypes lists the app_types with proxy_enabled=1 in proxy_config.
	ActiveAppTypes []string `json:"activeAppTypes,omitempty"`
}

// ProviderModelMapping describes a single cc-switch provider and its model
// alias configuration (the transparent proxy mapping).
type ProviderModelMapping struct {
	ProviderID     string            `json:"providerId"`
	ProviderName   string            `json:"providerName"`
	AppType        string            `json:"appType"`
	ProviderType   string            `json:"providerType,omitempty"`
	BaseURL        string            `json:"baseUrl,omitempty"`
	APIKeySet      bool              `json:"apiKeySet"`
	IsCurrent      bool              `json:"isCurrent"`
	InFailover     bool              `json:"inFailover"`
	IsActive       bool              `json:"isActive"`
	CostMultiplier string            `json:"costMultiplier,omitempty"`
	ModelAliases   map[string]string `json:"modelAliases,omitempty"`
	// SettingsConfigJSON is the raw settings_config JSON (redacted).
	SettingsConfigJSON string `json:"-"`
}

// settingsConfig represents the provider settings_config JSON structure.
type settingsConfig struct {
	Model string            `json:"model"`
	Env   map[string]string `json:"env"`
}

// DBReadResult holds the result of reading the cc-switch database.
type DBReadResult struct {
	Providers []ProviderModelMapping `json:"providers"`
	Settings  map[string]string      `json:"settings"`
}

// Reader reads cc-switch database state. It is safe for concurrent use after
// initialization.
type Reader struct {
	dbPath string
	mu     sync.Mutex
}

// ConfigDir returns the cc-switch configuration directory path.
func ConfigDir() string {
	if env := strings.TrimSpace(os.Getenv("CC_SWITCH_HOME")); env != "" {
		return env
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".cc-switch")
}

// DBPath returns the path to the cc-switch SQLite database.
func DBPath() string {
	dir := ConfigDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "cc-switch.db")
}

// Detect probes the local filesystem for a cc-switch installation and returns
// a status summary.
func Detect() Status {
	dir := ConfigDir()
	dbPath := DBPath()

	status := Status{
		ConfigDir: dir,
		DBPath:    dbPath,
	}

	if dbPath == "" {
		return status
	}

	if _, err := os.Stat(dbPath); err != nil {
		return status
	}
	status.Installed = true

	// Read proxy_config to determine routing state.
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		slog.Warn("cc-switch: failed to open database", "error", err)
		return status
	}
	defer db.Close()

	rows, err := db.Query(`SELECT app_type, proxy_enabled, listen_port FROM proxy_config`)
	if err != nil {
		slog.Debug("cc-switch: failed to query proxy_config", "error", err)
		return status
	}
	defer rows.Close()

	var anyEnabled bool
	for rows.Next() {
		var appType string
		var enabled int
		var port int
		if err := rows.Scan(&appType, &enabled, &port); err != nil {
			continue
		}
		if enabled == 1 {
			anyEnabled = true
			status.ActiveAppTypes = append(status.ActiveAppTypes, appType)
		}
		status.ProxyPort = port
	}
	status.RoutingActive = anyEnabled

	return status
}

// NewReader creates a new Reader for the cc-switch database at the given path.
// Returns nil if the database does not exist.
func NewReader() *Reader {
	dbPath := DBPath()
	if dbPath == "" {
		return nil
	}
	if _, err := os.Stat(dbPath); err != nil {
		return nil
	}
	return &Reader{dbPath: dbPath}
}

// NewReaderWithPath creates a new Reader for the cc-switch database at the given
// path. Returns nil if dbPath is empty or the file does not exist. Use this when
// the db path is already known (e.g. from Detect()) to avoid re-deriving it.
func NewReaderWithPath(dbPath string) *Reader {
	if dbPath == "" {
		return nil
	}
	if _, err := os.Stat(dbPath); err != nil {
		return nil
	}
	return &Reader{dbPath: dbPath}
}

// ReadProviders reads providers from the cc-switch database, filtered by
// app_type (an empty appType returns every provider). Failover-queued providers
// are returned as well — they are reported through ProviderModelMapping.InFailover
// with IsActive=false rather than being dropped, so callers can still see the
// queue. The settings_config is parsed to extract model alias mappings.
func (r *Reader) ReadProviders(appType string) ([]ProviderModelMapping, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	db, err := sql.Open("sqlite", r.dbPath)
	if err != nil {
		return nil, fmt.Errorf("open cc-switch db: %w", err)
	}
	defer db.Close()

	return readProviders(db, appType)
}

// ReadSettings reads key-value settings from the cc-switch database.
func (r *Reader) ReadSettings(keys ...string) (map[string]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	db, err := sql.Open("sqlite", r.dbPath)
	if err != nil {
		return nil, fmt.Errorf("open cc-switch db: %w", err)
	}
	defer db.Close()

	return readSettings(db, keys...)
}

// ReadAll reads all providers and settings from the cc-switch database.
func (r *Reader) ReadAll() (*DBReadResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	db, err := sql.Open("sqlite", r.dbPath)
	if err != nil {
		return nil, fmt.Errorf("open cc-switch db: %w", err)
	}
	defer db.Close()

	providers, err := readProviders(db, "")
	if err != nil {
		return nil, err
	}

	settings, err := readSettings(db)
	if err != nil {
		return nil, err
	}

	return &DBReadResult{
		Providers: providers,
		Settings:  settings,
	}, nil
}

// ResolveModelAlias resolves a Claude Code model alias (e.g. "claude-sonnet")
// to the actual model that cc-switch will route it to, given the current
// active provider for the specified app_type.
//
// Returns ("", false) if cc-switch is not active or the alias cannot be resolved.
func (r *Reader) ResolveModelAlias(alias, appType string) (string, bool) {
	providers, err := r.ReadProviders(appType)
	if err != nil {
		return "", false
	}

	// Find the current provider.
	for _, p := range providers {
		if !p.IsCurrent {
			continue
		}
		// Check model aliases for a match.
		if resolved, ok := p.ModelAliases[alias]; ok {
			return resolved, true
		}
		// Fall back to the display-name variant. The key is alias+"_name"
		// because parseModelAliases's aliasMap is the only producer of
		// ModelAliases and it emits lowercase keys ("opus_name" from
		// ANTHROPIC_DEFAULT_OPUS_MODEL_NAME). This used to read "_NAME", which
		// no producer ever emitted, so the fallback never fired; the sibling
		// consumer in internal/api/model_catalog_ccswitch.go already used the
		// lowercase form.
		nameKey := alias + "_name"
		if resolved, ok := p.ModelAliases[nameKey]; ok {
			return resolved, true
		}
	}
	return "", false
}

func readProviders(db *sql.DB, appTypeFilter string) ([]ProviderModelMapping, error) {
	query := `SELECT id, app_type, name, settings_config, provider_type,
	                 is_current, in_failover_queue, cost_multiplier
	          FROM providers`
	var args []any
	if appTypeFilter != "" {
		query += ` WHERE app_type = ?`
		args = append(args, appTypeFilter)
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query providers: %w", err)
	}
	defer rows.Close()

	var providers []ProviderModelMapping
	for rows.Next() {
		var p ProviderModelMapping
		var settingsConfigJSON string
		var providerType sql.NullString
		var costMultiplier string

		if err := rows.Scan(&p.ProviderID, &p.AppType, &p.ProviderName,
			&settingsConfigJSON, &providerType,
			&p.IsCurrent, &p.InFailover, &costMultiplier); err != nil {
			continue
		}

		p.ProviderType = providerType.String
		p.CostMultiplier = costMultiplier
		p.SettingsConfigJSON = settingsConfigJSON

		// Parse settings_config to extract model aliases.
		p.ModelAliases = parseModelAliases(settingsConfigJSON)

		providers = append(providers, p)
	}

	// Join with provider_endpoints to get BaseURL.
	endpoints, err := readEndpoints(db)
	if err == nil {
		for i := range providers {
			key := providers[i].ProviderID + "|" + providers[i].AppType
			if url, ok := endpoints[key]; ok {
				providers[i].BaseURL = url
			}
		}
	}

	// Determine if API key is set (check env in settings_config).
	for i := range providers {
		providers[i].APIKeySet = hasAPIKey(providers[i].SettingsConfigJSON)
		// Provider is "active" if it's current or not in failover queue.
		providers[i].IsActive = !providers[i].InFailover
	}

	return providers, nil
}

func readEndpoints(db *sql.DB) (map[string]string, error) {
	rows, err := db.Query(`SELECT provider_id, app_type, url FROM provider_endpoints`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	endpoints := map[string]string{}
	for rows.Next() {
		var providerID, appType, url string
		if err := rows.Scan(&providerID, &appType, &url); err != nil {
			continue
		}
		endpoints[providerID+"|"+appType] = url
	}
	return endpoints, nil
}

func readSettings(db *sql.DB, keys ...string) (map[string]string, error) {
	query := `SELECT key, value FROM settings`
	var args []any
	if len(keys) > 0 {
		placeholders := make([]string, len(keys))
		for i, k := range keys {
			placeholders[i] = "?"
			args = append(args, k)
		}
		// #nosec G202 -- only static "?" placeholders are concatenated; all
		// values are bound via args (parameterized query, no injection).
		query += ` WHERE key IN (` + strings.Join(placeholders, ",") + `)`
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query settings: %w", err)
	}
	defer rows.Close()

	settings := map[string]string{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		settings[key] = value
	}
	return settings, nil
}

// parseModelAliases extracts model alias mappings from a provider's
// settings_config JSON. The cc-switch stores them as environment variables
// like ANTHROPIC_DEFAULT_OPUS_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL, etc.
func parseModelAliases(settingsConfigJSON string) map[string]string {
	aliases := map[string]string{}

	var cfg settingsConfig
	if err := json.Unmarshal([]byte(settingsConfigJSON), &cfg); err != nil {
		return aliases
	}

	// Map from env var key to a short alias name.
	aliasMap := map[string]string{
		"ANTHROPIC_DEFAULT_OPUS_MODEL":        "opus",
		"ANTHROPIC_DEFAULT_SONNET_MODEL":      "sonnet",
		"ANTHROPIC_DEFAULT_HAIKU_MODEL":       "haiku",
		"ANTHROPIC_REASONING_MODEL":           "reasoning",
		"CLAUDE_CODE_SUBAGENT_MODEL":          "subagent",
		"ANTHROPIC_MODEL":                     "default",
		"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME":   "opus_name",
		"ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "sonnet_name",
		"ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME":  "haiku_name",
	}

	for envKey, aliasKey := range aliasMap {
		if value, ok := cfg.Env[envKey]; ok && value != "" {
			// Strip context window suffix like [1M] from model names.
			clean := stripContextSuffix(value)
			aliases[aliasKey] = clean
		}
	}

	return aliases
}

// stripContextSuffix removes cc-switch context window annotations like
// "[1M]", "[1m]", "[128K]", etc. from model names.
func stripContextSuffix(model string) string {
	// Find the last occurrence of a bracketed suffix.
	if idx := strings.LastIndex(model, "["); idx > 0 {
		suffix := model[idx:]
		if strings.HasSuffix(suffix, "]") || strings.HasSuffix(suffix, "] ") {
			return strings.TrimSpace(model[:idx])
		}
	}
	return strings.TrimSpace(model)
}

// hasAPIKey checks if the provider has an API key configured in settings_config.
func hasAPIKey(settingsConfigJSON string) bool {
	var cfg settingsConfig
	if err := json.Unmarshal([]byte(settingsConfigJSON), &cfg); err != nil {
		return false
	}
	_, ok := cfg.Env["ANTHROPIC_AUTH_TOKEN"]
	return ok
}
