// Unit tests for the ACP MCP config wiring (#1743): parseACPMcpServers and
// its per-entry mapper. Pure table-driven tests — no wire, no sleep.
package acp

import (
	"reflect"
	"testing"

	"github.com/coder/acp-go-sdk"
)

func TestParseACPMcpServers(t *testing.T) {
	tests := []struct {
		name        string
		configJSON  string
		wantErr     bool
		wantServers []acp.McpServer
	}{
		{
			name:        "empty config yields empty non-nil slice",
			configJSON:  "",
			wantServers: []acp.McpServer{},
		},
		{
			name:        "whitespace-only config yields empty non-nil slice",
			configJSON:  "   \n\t",
			wantServers: []acp.McpServer{},
		},
		{
			name: "stdio server with args and env sorted",
			configJSON: `{"mcpServers":{"fs":{"name":"filesystem","transport":"stdio",` +
				`"command":"node","args":["server.js","--debug"],"env":{"KEY_B":"2","KEY_A":"1"}}}}`,
			wantServers: []acp.McpServer{{
				Stdio: &acp.McpServerStdio{
					Name:    "filesystem",
					Command: "node",
					Args:    []string{"server.js", "--debug"},
					Env:     []acp.EnvVariable{{Name: "KEY_A", Value: "1"}, {Name: "KEY_B", Value: "2"}},
				},
			}},
		},
		{
			name:       "empty transport defaults to stdio and name falls back to key",
			configJSON: `{"mcpServers":{"mcp-git":{"command":"mcp-server-git"}}}`,
			wantServers: []acp.McpServer{{
				Stdio: &acp.McpServerStdio{
					Name:    "mcp-git",
					Command: "mcp-server-git",
					Args:    []string{},
					Env:     []acp.EnvVariable{},
				},
			}},
		},
		{
			name: "sse server maps to sse union variant",
			configJSON: `{"mcpServers":{"web":{"name":"web","transport":"sse",` +
				`"url":"https://example.com/sse"}}}`,
			wantServers: []acp.McpServer{{
				Sse: &acp.McpServerSseInline{Name: "web", Url: "https://example.com/sse"},
			}},
		},
		{
			name: "streamable-http server maps to http union variant",
			configJSON: `{"mcpServers":{"api":{"transport":"streamable-http",` +
				`"url":"https://example.com/mcp"}}}`,
			wantServers: []acp.McpServer{{
				Http: &acp.McpServerHttpInline{Name: "api", Url: "https://example.com/mcp"},
			}},
		},
		{
			name: "multiple servers ordered by map key",
			configJSON: `{"mcpServers":{"zeta":{"command":"z"},` +
				`"alpha":{"command":"a"}}}`,
			wantServers: []acp.McpServer{
				{Stdio: &acp.McpServerStdio{Name: "alpha", Command: "a", Args: []string{}, Env: []acp.EnvVariable{}}},
				{Stdio: &acp.McpServerStdio{Name: "zeta", Command: "z", Args: []string{}, Env: []acp.EnvVariable{}}},
			},
		},
		{
			name:       "invalid JSON fails the whole parse",
			configJSON: `{"mcpServers": `,
			wantErr:    true,
		},
		{
			name:       "unknown transport fails the whole parse",
			configJSON: `{"mcpServers":{"x":{"transport":"carrier-pigeon","command":"coo"}}}`,
			wantErr:    true,
		},
		{
			name:       "stdio without command fails the whole parse",
			configJSON: `{"mcpServers":{"x":{"transport":"stdio"}}}`,
			wantErr:    true,
		},
		{
			name:       "sse without url fails the whole parse",
			configJSON: `{"mcpServers":{"x":{"transport":"sse"}}}`,
			wantErr:    true,
		},
		{
			name:       "streamable-http without url fails the whole parse",
			configJSON: `{"mcpServers":{"x":{"transport":"streamable-http"}}}`,
			wantErr:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseACPMcpServers(tt.configJSON)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("parseACPMcpServers(%q) error = nil, want error", tt.configJSON)
				}
				if got == nil {
					t.Fatal("parseACPMcpServers returned nil slice on error; session/new must still send a valid empty mcpServers array")
				}
				return
			}
			if err != nil {
				t.Fatalf("parseACPMcpServers(%q) = %v, want nil", tt.configJSON, err)
			}
			if got == nil {
				t.Fatal("parseACPMcpServers returned nil slice; session/new requires a non-nil mcpServers field")
			}
			if !reflect.DeepEqual(got, tt.wantServers) {
				t.Errorf("parseACPMcpServers(%q) = %+v, want %+v", tt.configJSON, got, tt.wantServers)
			}
		})
	}
}

// TestParseACPMcpServersEmptyServersObject: a syntactically valid config with
// no servers parses cleanly into an empty non-nil slice (nothing to degrade).
func TestParseACPMcpServersEmptyServersObject(t *testing.T) {
	got, err := parseACPMcpServers(`{"mcpServers":{}}`)
	if err != nil {
		t.Fatalf("parseACPMcpServers = %v, want nil", err)
	}
	if len(got) != 0 {
		t.Errorf("parseACPMcpServers = %+v, want empty slice", got)
	}
}
