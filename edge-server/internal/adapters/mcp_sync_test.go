package adapters

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// --- HubMCPSyncer syncOnce tests ---

func TestMCPSyncOnceSuccess(t *testing.T) {
	// Mock Hub API that returns valid MCP server config JSON.
	mockHub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify the request path and method.
		if r.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/web/mcp-servers" {
			t.Errorf("expected /web/mcp-servers, got %s", r.URL.Path)
		}
		if r.Header.Get("Accept") != "application/json" {
			t.Errorf("expected Accept: application/json, got %q", r.Header.Get("Accept"))
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{
			"code": "success",
			"data": {
				"items": [
					{
						"name": "filesystem",
						"transport": "stdio",
						"command": "npx",
						"args": "[\"-y\", \"@anthropic/mcp-filesystem\"]",
						"env_vars": "{\"HOME\": \"/tmp\"}",
						"url": "",
						"is_public": true
					},
					{
						"name": "github",
						"transport": "sse",
						"command": "",
						"args": "[]",
						"env_vars": "{}",
						"url": "https://api.github.com/mcp",
						"is_public": false
					}
				]
			}
		}`))
	}))
	defer mockHub.Close()

	store := NewMCPConfigStore()

	syncer := &HubMCPSyncer{
		hubURL:    mockHub.URL,
		authToken: "",
		store:     store,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}

	ctx := context.Background()
	syncer.syncOnce(ctx)

	servers := store.Get()
	if len(servers) != 2 {
		t.Fatalf("expected 2 servers in store, got %d", len(servers))
	}

	// Validate filesystem server.
	fs, ok := servers["filesystem"]
	if !ok {
		t.Fatal("expected 'filesystem' server in store")
	}
	if fs.Name != "filesystem" {
		t.Errorf("filesystem name = %q, want 'filesystem'", fs.Name)
	}
	if fs.Transport != "stdio" {
		t.Errorf("filesystem transport = %q, want 'stdio'", fs.Transport)
	}
	if fs.Command != "npx" {
		t.Errorf("filesystem command = %q, want 'npx'", fs.Command)
	}
	if len(fs.Args) != 2 || fs.Args[0] != "-y" || fs.Args[1] != "@anthropic/mcp-filesystem" {
		t.Errorf("filesystem args = %v, want ['-y', '@anthropic/mcp-filesystem']", fs.Args)
	}
	if fs.Env["HOME"] != "/tmp" {
		t.Errorf("filesystem env HOME = %q, want '/tmp'", fs.Env["HOME"])
	}

	// Validate github server.
	gh, ok := servers["github"]
	if !ok {
		t.Fatal("expected 'github' server in store")
	}
	if gh.Transport != "sse" {
		t.Errorf("github transport = %q, want 'sse'", gh.Transport)
	}
	if gh.URL != "https://api.github.com/mcp" {
		t.Errorf("github url = %q, want 'https://api.github.com/mcp'", gh.URL)
	}
}

func TestMCPSyncOnceServerError(t *testing.T) {
	// Mock Hub API that returns 500.
	mockHub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal server error"))
	}))
	defer mockHub.Close()

	store := NewMCPConfigStore()
	// Pre-populate store to verify it is not cleared on error.
	store.Set(map[string]MCPServerConfig{
		"existing": {Name: "existing", Transport: "stdio", Command: "echo"},
	})

	syncer := &HubMCPSyncer{
		hubURL:    mockHub.URL,
		authToken: "",
		store:     store,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}

	ctx := context.Background()
	syncer.syncOnce(ctx)

	// Store should still contain the pre-populated data (syncOnce should
	// return early on non-200, leaving store untouched).
	servers := store.Get()
	if len(servers) != 1 {
		t.Fatalf("expected 1 server (unchanged), got %d", len(servers))
	}
	if _, ok := servers["existing"]; !ok {
		t.Error("existing server should still be present after failed sync")
	}
}

func TestMCPSyncOnceInvalidJSON(t *testing.T) {
	// Mock Hub API that returns 200 but with invalid JSON body.
	mockHub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{not valid json`))
	}))
	defer mockHub.Close()

	store := NewMCPConfigStore()
	store.Set(map[string]MCPServerConfig{
		"existing": {Name: "existing", Transport: "stdio", Command: "echo"},
	})

	syncer := &HubMCPSyncer{
		hubURL: mockHub.URL,
		store:  store,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}

	ctx := context.Background()
	syncer.syncOnce(ctx)

	// Store should be unchanged since decode failed.
	servers := store.Get()
	if len(servers) != 1 {
		t.Fatalf("expected 1 server (unchanged), got %d", len(servers))
	}
	if _, ok := servers["existing"]; !ok {
		t.Error("existing server should still be present after decode failure")
	}
}

func TestMCPSyncOnceAuthToken(t *testing.T) {
	tokenReceived := ""

	mockHub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenReceived = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"code":"success","data":{"items":[]}}`))
	}))
	defer mockHub.Close()

	store := NewMCPConfigStore()
	syncer := &HubMCPSyncer{
		hubURL:    mockHub.URL,
		authToken: "test-secret-token",
		store:     store,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}

	ctx := context.Background()
	syncer.syncOnce(ctx)

	if tokenReceived != "Bearer test-secret-token" {
		t.Errorf("expected Authorization 'Bearer test-secret-token', got %q", tokenReceived)
	}
}

func TestMCPSyncOnceEmptyItems(t *testing.T) {
	mockHub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"code":"success","data":{"items":[]}}`))
	}))
	defer mockHub.Close()

	store := NewMCPConfigStore()
	syncer := &HubMCPSyncer{
		hubURL: mockHub.URL,
		store:  store,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}

	ctx := context.Background()
	syncer.syncOnce(ctx)

	servers := store.Get()
	if len(servers) != 0 {
		t.Fatalf("expected 0 servers for empty items, got %d", len(servers))
	}
}

func TestMCPSyncOnceSkipEmptyName(t *testing.T) {
	mockHub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{
			"code": "success",
			"data": {
				"items": [
					{"name": "", "transport": "stdio", "command": "npx"},
					{"name": "valid-server", "transport": "sse", "url": "https://example.com/mcp"}
				]
			}
		}`))
	}))
	defer mockHub.Close()

	store := NewMCPConfigStore()
	syncer := &HubMCPSyncer{
		hubURL: mockHub.URL,
		store:  store,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}

	ctx := context.Background()
	syncer.syncOnce(ctx)

	servers := store.Get()
	if len(servers) != 1 {
		t.Fatalf("expected 1 server (empty name skipped), got %d", len(servers))
	}
	if _, ok := servers["valid-server"]; !ok {
		t.Error("expected 'valid-server' in store")
	}
}

func TestMCPSyncOnceContextCancelled(t *testing.T) {
	mockHub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"code":"success","data":{"items":[]}}`))
	}))
	defer mockHub.Close()

	store := NewMCPConfigStore()
	store.Set(map[string]MCPServerConfig{
		"existing": {Name: "existing"},
	})

	syncer := &HubMCPSyncer{
		hubURL: mockHub.URL,
		store:  store,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel before calling syncOnce

	syncer.syncOnce(ctx)

	// syncOnce handles cancelled context gracefully (request fails, store unchanged).
	servers := store.Get()
	if len(servers) != 1 {
		t.Fatalf("expected 1 server (unchanged), got %d", len(servers))
	}
}
