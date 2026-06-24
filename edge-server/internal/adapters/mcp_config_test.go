package adapters

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// --- MCPConfigStore tests ---

func TestNewMCPConfigStore(t *testing.T) {
	s := NewMCPConfigStore()
	if s == nil {
		t.Fatal("NewMCPConfigStore should not return nil")
	}
	servers := s.Get()
	if len(servers) != 0 {
		t.Fatalf("new store should be empty, got %d servers", len(servers))
	}
}

func TestMCPConfigStoreSetAndGet(t *testing.T) {
	s := NewMCPConfigStore()

	servers := map[string]MCPServerConfig{
		"filesystem": {Name: "filesystem", Transport: "stdio", Command: "npx", Args: []string{"-y", "@anthropic/mcp-filesystem"}},
		"github":     {Name: "github", Transport: "sse", URL: "https://api.github.com/mcp"},
	}
	s.Set(servers)

	got := s.Get()
	if len(got) != 2 {
		t.Fatalf("expected 2 servers, got %d", len(got))
	}
	if got["filesystem"].Name != "filesystem" {
		t.Errorf("filesystem name = %q", got["filesystem"].Name)
	}
	if got["github"].Transport != "sse" {
		t.Errorf("github transport = %q", got["github"].Transport)
	}
}

func TestMCPConfigStoreGetReturnsCopy(t *testing.T) {
	s := NewMCPConfigStore()
	s.Set(map[string]MCPServerConfig{
		"test": {Name: "test"},
	})

	got1 := s.Get()
	got1["intruder"] = MCPServerConfig{Name: "intruder"}

	got2 := s.Get()
	if _, ok := got2["intruder"]; ok {
		t.Error("Get should return a copy; modifications should not affect store")
	}
}

func TestMCPConfigStoreConfigJSONEmpty(t *testing.T) {
	s := NewMCPConfigStore()
	jsonStr := s.ConfigJSON()
	if jsonStr != "" {
		t.Errorf("empty store ConfigJSON should return empty string, got %q", jsonStr)
	}
}

func TestMCPConfigStoreConfigJSONWithServers(t *testing.T) {
	s := NewMCPConfigStore()
	s.Set(map[string]MCPServerConfig{
		"test": {Name: "test", Transport: "stdio", Command: "echo"},
	})

	jsonStr := s.ConfigJSON()
	if jsonStr == "" {
		t.Fatal("ConfigJSON should not be empty when servers are set")
	}

	var cfg MCPServerConfigFile
	if err := json.Unmarshal([]byte(jsonStr), &cfg); err != nil {
		t.Fatalf("ConfigJSON output is not valid JSON: %v", err)
	}
	if len(cfg.MCPServers) != 1 {
		t.Fatalf("expected 1 server in config, got %d", len(cfg.MCPServers))
	}
	if cfg.MCPServers["test"].Transport != "stdio" {
		t.Errorf("transport = %q", cfg.MCPServers["test"].Transport)
	}
}

func TestMCPConfigStoreSetOverwrites(t *testing.T) {
	s := NewMCPConfigStore()
	s.Set(map[string]MCPServerConfig{"a": {Name: "a"}})
	s.Set(map[string]MCPServerConfig{"b": {Name: "b"}})

	got := s.Get()
	if len(got) != 1 {
		t.Fatalf("Set should replace all: expected 1, got %d", len(got))
	}
	if _, ok := got["b"]; !ok {
		t.Error("Set should contain new server 'b'")
	}
	if _, ok := got["a"]; ok {
		t.Error("Set should not contain old server 'a'")
	}
}

func TestMCPConfigStoreConcurrency(t *testing.T) {
	// Basic concurrency smoke test: parallel read/write should not panic.
	s := NewMCPConfigStore()
	done := make(chan bool)

	go func() {
		for i := 0; i < 100; i++ {
			s.Set(map[string]MCPServerConfig{
				"test": {Name: "test", Transport: "stdio", Command: "echo"},
			})
		}
		done <- true
	}()
	go func() {
		for i := 0; i < 100; i++ {
			s.Get()
			s.ConfigJSON()
		}
		done <- true
	}()

	<-done
	<-done
}

// --- IsMCPToolCall tests ---

// --- MergeConfigJSON tests ---

func TestMergeConfigJSONRunOnly(t *testing.T) {
	runConfig := `{"mcpServers":{"a":{"name":"a","command":"echo"}}}`
	result := MergeConfigJSON(runConfig, nil)
	if result != runConfig {
		t.Errorf("nil hub store: got %q, want run config", result)
	}
}

func TestMergeConfigJSONEmptyHub(t *testing.T) {
	runConfig := `{"mcpServers":{"a":{"name":"a","command":"echo"}}}`
	s := NewMCPConfigStore() // empty store

	result := MergeConfigJSON(runConfig, s)
	if result != runConfig {
		t.Errorf("empty hub config: got %q, want run config", result)
	}
}

func TestMergeConfigJSONHubOnly(t *testing.T) {
	s := NewMCPConfigStore()
	s.Set(map[string]MCPServerConfig{
		"hub_server": {Name: "hub_server", Transport: "sse", URL: "https://example.com/mcp"},
	})

	result := MergeConfigJSON("", s)

	var cfg MCPServerConfigFile
	if err := json.Unmarshal([]byte(result), &cfg); err != nil {
		t.Fatalf("result is not valid JSON: %v", err)
	}
	if len(cfg.MCPServers) != 1 {
		t.Fatalf("expected 1 server, got %d", len(cfg.MCPServers))
	}
}

func TestMergeConfigJSONBothMerge(t *testing.T) {
	s := NewMCPConfigStore()
	s.Set(map[string]MCPServerConfig{
		"hub_server": {Name: "hub_server", Transport: "sse", URL: "https://example.com/mcp"},
	})

	runConfig := `{"mcpServers":{"run_server":{"name":"run_server","command":"echo"}}}`

	result := MergeConfigJSON(runConfig, s)

	var cfg MCPServerConfigFile
	if err := json.Unmarshal([]byte(result), &cfg); err != nil {
		t.Fatalf("result is not valid JSON: %v", err)
	}
	if len(cfg.MCPServers) != 2 {
		t.Fatalf("expected 2 merged servers, got %d", len(cfg.MCPServers))
	}
	if _, ok := cfg.MCPServers["hub_server"]; !ok {
		t.Error("merged result should contain hub_server")
	}
	if _, ok := cfg.MCPServers["run_server"]; !ok {
		t.Error("merged result should contain run_server")
	}
}

func TestMergeConfigJSONRunLevelWinsOnConflict(t *testing.T) {
	s := NewMCPConfigStore()
	s.Set(map[string]MCPServerConfig{
		"server1": {Name: "server1", Transport: "sse", URL: "https://hub.example.com"},
	})

	runConfig := `{"mcpServers":{"server1":{"name":"server1","transport":"stdio","command":"custom"}}}`

	result := MergeConfigJSON(runConfig, s)

	var cfg MCPServerConfigFile
	if err := json.Unmarshal([]byte(result), &cfg); err != nil {
		t.Fatalf("result is not valid JSON: %v", err)
	}
	if len(cfg.MCPServers) != 1 {
		t.Fatalf("expected 1 server (merged), got %d", len(cfg.MCPServers))
	}
	if cfg.MCPServers["server1"].Transport != "stdio" {
		t.Errorf("run-level config should win on conflict: transport = %q", cfg.MCPServers["server1"].Transport)
	}
	if cfg.MCPServers["server1"].Command != "custom" {
		t.Errorf("run-level config should win: command = %q", cfg.MCPServers["server1"].Command)
	}
}

func TestMergeConfigJSONInvalidRunConfig(t *testing.T) {
	s := NewMCPConfigStore()
	s.Set(map[string]MCPServerConfig{
		"hub_server": {Name: "hub_server", Transport: "sse"},
	})

	runConfig := `{invalid json}`

	result := MergeConfigJSON(runConfig, s)
	// Should fall back to hub config only
	if !strings.Contains(result, "hub_server") {
		t.Errorf("should fall back to hub config on invalid run config: got %q", result)
	}
}

func TestMergeConfigJSONBothEmpty(t *testing.T) {
	result := MergeConfigJSON("", NewMCPConfigStore())
	if result != "" {
		t.Errorf("both empty should return empty string, got %q", result)
	}
}

func TestMergeConfigJSONHubNil(t *testing.T) {
	runConfig := `{"mcpServers":{"a":{"name":"a"}}}`
	result := MergeConfigJSON(runConfig, nil)
	if result != runConfig {
		t.Errorf("nil hub: got %q, want runConfig", result)
	}
}

// --- WriteMCPConfigTempFile tests ---

func TestWriteMCPConfigTempFileEmptyConfig(t *testing.T) {
	path, err := WriteMCPConfigTempFile("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if path != "" {
		t.Errorf("empty config should return empty path, got %q", path)
	}
}

func TestWriteMCPConfigTempFileCreatesValidFile(t *testing.T) {
	configJSON := `{"mcpServers":{"test":{"name":"test","command":"echo"}}}`
	path, err := WriteMCPConfigTempFile(configJSON)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if path == "" {
		t.Fatal("path should not be empty")
	}
	defer os.Remove(path)

	// Verify the file exists and contains the right content.
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read temp file: %v", err)
	}

	// Normalize whitespace for comparison (JSON has no significant whitespace).
	var expected, actual any
	json.Unmarshal([]byte(configJSON), &expected)
	json.Unmarshal(data, &actual)

	expectedMap := expected.(map[string]any)
	actualMap := actual.(map[string]any)
	if len(expectedMap) != len(actualMap) {
		t.Errorf("file content mismatch: got %s", string(data))
	}
}

func TestWriteMCPConfigTempFileHasMatchingPrefix(t *testing.T) {
	path, err := WriteMCPConfigTempFile(`{"mcpServers":{}}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer os.Remove(path)

	if !strings.Contains(path, "agenthub-mcp-config-") {
		t.Errorf("temp file name should contain 'agenthub-mcp-config-': %q", path)
	}
}

// --- MCPServerConfig types tests ---

