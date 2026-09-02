// Package adapters provides MCP (Model Context Protocol) config types, Hub sync,
// and injection helpers for Edge server adapter builds.
package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// MCPServerConfig describes a single MCP server entry for injection into agent CLIs.
// It mirrors the Hub model.MCPServer but is kept decoupled to avoid importing Hub models.
type MCPServerConfig struct {
	Name      string            `json:"name"`
	Transport string            `json:"transport,omitempty"` // "stdio" | "sse" | "streamable-http"
	Command   string            `json:"command,omitempty"`
	Args      []string          `json:"args,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	URL       string            `json:"url,omitempty"`
}

// MCPServerConfigFile is the top-level structure for Claude Code's --mcp-config JSON.
// It maps server names to their configurations.
type MCPServerConfigFile struct {
	MCPServers map[string]MCPServerConfig `json:"mcpServers"`
}

// MCPConfigStore holds MCP server configs synced from the Hub. It is safe for
// concurrent access. When non-empty, these configs are merged into every run's
// MCPConfig during injection.
type MCPConfigStore struct {
	mu      sync.RWMutex
	servers map[string]MCPServerConfig
}

// NewMCPConfigStore creates an empty config store.
func NewMCPConfigStore() *MCPConfigStore {
	return &MCPConfigStore{servers: make(map[string]MCPServerConfig)}
}

// Set replaces all stored MCP server configs.
func (s *MCPConfigStore) Set(servers map[string]MCPServerConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.servers = servers
}

// Get returns a copy of the current MCP server configs.
func (s *MCPConfigStore) Get() map[string]MCPServerConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]MCPServerConfig, len(s.servers))
	for k, v := range s.servers {
		out[k] = v
	}
	return out
}

// ConfigJSON returns the merged MCP config as a JSON string suitable for
// --mcp-config (Claude Code) or equivalent injection. If no servers are
// configured, returns empty string.
func (s *MCPConfigStore) ConfigJSON() string {
	servers := s.Get()
	if len(servers) == 0 {
		return ""
	}
	cfg := MCPServerConfigFile{MCPServers: servers}
	data, err := json.Marshal(cfg)
	if err != nil {
		slog.Error("mcp: failed to marshal config JSON", "error", err)
		return ""
	}
	return string(data)
}

// MergeConfigJSON merges the Hub-synced MCP configs into a run's existing
// MCPConfig string. If the run already has MCPConfig, the Hub configs are
// merged in (run-level wins on conflicts). Returns the merged JSON string,
// or empty string if both are empty.
func MergeConfigJSON(runConfig string, hubStore *MCPConfigStore) string {
	hubJSON := ""
	if hubStore != nil {
		hubJSON = hubStore.ConfigJSON()
	}
	if hubJSON == "" {
		return runConfig
	}
	if runConfig == "" {
		return hubJSON
	}

	// Both present: merge, run-level wins on key conflicts.
	var runCfg, hubCfg MCPServerConfigFile
	if err := json.Unmarshal([]byte(runConfig), &runCfg); err != nil {
		slog.Warn("mcp: failed to parse run MCPConfig, using hub config only", "error", err)
		return hubJSON
	}
	if err := json.Unmarshal([]byte(hubJSON), &hubCfg); err != nil {
		slog.Warn("mcp: failed to parse hub MCP config, using run config only", "error", err)
		return runConfig
	}
	if runCfg.MCPServers == nil {
		runCfg.MCPServers = make(map[string]MCPServerConfig)
	}
	for k, v := range hubCfg.MCPServers {
		if _, exists := runCfg.MCPServers[k]; !exists {
			runCfg.MCPServers[k] = v
		}
	}
	merged, err := json.Marshal(runCfg)
	if err != nil {
		return runConfig
	}
	return string(merged)
}

// WriteMCPConfigTempFile writes the MCP config JSON to a temporary file and
// returns the file path. The caller is responsible for cleaning up (the file
// is removed when the process exits). Returns empty string if config is empty.
func WriteMCPConfigTempFile(configJSON string) (string, error) {
	if configJSON == "" {
		return "", nil
	}
	f, err := os.CreateTemp("", "agenthub-mcp-config-*.json")
	if err != nil {
		return "", fmt.Errorf("mcp: create temp config file: %w", err)
	}
	if _, err := f.WriteString(configJSON); err != nil {
		_ = f.Close()
		_ = os.Remove(f.Name())
		return "", fmt.Errorf("mcp: write temp config file: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(f.Name())
		return "", fmt.Errorf("mcp: close temp config file: %w", err)
	}
	return f.Name(), nil
}

// --- Hub MCP Sync ---

// mcpSyncMaxResponseBodyBytes is the fail-closed cap on the Hub /web/mcp-servers
// response body (64 KiB, matching the outbound policy default #1593). Oversize
// responses fail the sync without retaining body content past the cap.
const mcpSyncMaxResponseBodyBytes = 64 * 1024

// HubMCPSyncer periodically fetches MCP server configs from the Hub server's
// /web/mcp-servers endpoint and updates the local MCPConfigStore.
type HubMCPSyncer struct {
	hubURL    string
	authToken string
	store     *MCPConfigStore
	client    *http.Client

	// mu guards cancelFunc: Run assigns it from its own goroutine while
	// Stop reads it from the shutdown-hook goroutine (#2154).
	mu         sync.Mutex
	cancelFunc context.CancelFunc
}

// NewHubMCPSyncer creates a new syncer. The syncer does not start until Run()
// is called. client is the shared outbound client built at the composition
// root (edgehttp.NewClient); a nil client is a wiring bug and fails fast
// (#1593). Redirect refusal and the bounded timeout come from the injected
// client; the response body is capped fail-closed inside syncOnce.
func NewHubMCPSyncer(hubURL, authToken string, store *MCPConfigStore, client *http.Client) *HubMCPSyncer {
	if client == nil {
		panic("adapters: NewHubMCPSyncer requires a non-nil *http.Client (construct it at the composition root, e.g. edgehttp.NewClient)")
	}
	return &HubMCPSyncer{
		hubURL:    strings.TrimRight(hubURL, "/"),
		authToken: authToken,
		store:     store,
		client:    client,
	}
}

// Run starts the periodic sync loop. It blocks until ctx is cancelled.
// The first sync happens immediately; subsequent syncs happen every syncInterval.
func (s *HubMCPSyncer) Run(ctx context.Context, syncInterval time.Duration) {
	ctx, cancel := context.WithCancel(ctx)
	s.mu.Lock()
	s.cancelFunc = cancel
	s.mu.Unlock()
	defer cancel()

	// Initial sync
	s.syncOnce(ctx)

	ticker := time.NewTicker(syncInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.syncOnce(ctx)
		}
	}
}

// Stop cancels the sync loop. Safe to call multiple times.
func (s *HubMCPSyncer) Stop() {
	s.mu.Lock()
	cancel := s.cancelFunc
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *HubMCPSyncer) syncOnce(ctx context.Context) {
	url := s.hubURL + "/web/mcp-servers"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		slog.Warn("mcp-sync: failed to create request", "error", err)
		return
	}
	if s.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.authToken)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		slog.Warn("mcp-sync: request failed", "error", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("mcp-sync: unexpected status", "status", resp.StatusCode)
		return
	}

	// Fail-closed response cap (#1593): read at most mcpSyncMaxResponseBodyBytes
	// and reject oversize bodies without retaining content past the limit.
	body, err := io.ReadAll(io.LimitReader(resp.Body, mcpSyncMaxResponseBodyBytes+1))
	if err != nil {
		slog.Warn("mcp-sync: read body failed", "error", err)
		return
	}
	if int64(len(body)) > mcpSyncMaxResponseBodyBytes {
		slog.Warn("mcp-sync: response body exceeds limit", "max_bytes", mcpSyncMaxResponseBodyBytes)
		return
	}

	var result struct {
		Code string `json:"code"`
		Data struct {
			Items []struct {
				Name      string `json:"name"`
				Transport string `json:"transport"`
				Command   string `json:"command"`
				Args      string `json:"args"`     // JSON array string
				EnvVars   string `json:"env_vars"` // JSON object string
				URL       string `json:"url"`
				IsPublic  bool   `json:"is_public"`
			} `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		slog.Warn("mcp-sync: decode failed", "error", err)
		return
	}

	servers := make(map[string]MCPServerConfig, len(result.Data.Items))
	for _, item := range result.Data.Items {
		if item.Name == "" {
			continue
		}
		cfg := MCPServerConfig{
			Name:      item.Name,
			Transport: item.Transport,
			Command:   item.Command,
			URL:       item.URL,
		}
		if item.Args != "" && item.Args != "[]" {
			_ = json.Unmarshal([]byte(item.Args), &cfg.Args)
		}
		if item.EnvVars != "" && item.EnvVars != "{}" {
			_ = json.Unmarshal([]byte(item.EnvVars), &cfg.Env)
		}
		servers[item.Name] = cfg
	}

	s.store.Set(servers)
	slog.Info("mcp-sync: synced MCP server configs from Hub", "count", len(servers))
}

// IsMCPToolCall reports whether a tool name originates from an MCP server.
// MCP tool names follow the convention: "mcp__<server>__<tool>" (used by
// Claude Code and Codex adapters).
func IsMCPToolCall(toolName string) bool {
	return strings.HasPrefix(toolName, "mcp__")
}
