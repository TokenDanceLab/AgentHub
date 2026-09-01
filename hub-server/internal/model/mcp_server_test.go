//nolint:gosec // 测试 fixture：凭据模式字符串用于构造测试用例，非真实凭据
package model

import (
	"testing"
)

func TestMCPServerValidate(t *testing.T) {
	tests := []struct {
		name    string
		server  MCPServer
		wantErr bool
		errMsg  string
	}{
		{
			name:    "valid MCP server passes",
			server:  MCPServer{Name: "test-server", Transport: "stdio", Command: "node", Args: `["server.js"]`, EnvVars: `{"NODE_ENV":"production"}`, ToolSchema: `{"tools":[]}`, URL: "https://example.com/api", AuthType: "none", AuthConfig: "{}"},
			wantErr: false,
		},
		{
			name:    "args not array → error",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", Args: `"not-an-array"`},
			wantErr: true,
			errMsg:  "args must be a JSON array",
		},
		{
			name:    "auth_config not object → error",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", AuthConfig: `"not-an-object"`},
			wantErr: true,
			errMsg:  "auth_config must be a JSON object",
		},
		{
			name:    "auth_config with api_key real value → error",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", AuthConfig: `{"api_key":"real_key_value"}`},
			wantErr: true,
			errMsg:  "auth_config must not contain plaintext api_key",
		},
		{
			name:    "auth_config with api_key masked value → passes",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", AuthConfig: `{"api_key":"***"}`},
			wantErr: false,
		},
		{
			name:    "auth_config with empty api_key → passes",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", AuthConfig: `{"api_key":""}`},
			wantErr: false,
		},
		{
			name:    "auth_config with token real value → error",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", AuthConfig: `{"token":"real_token_123"}`},
			wantErr: true,
			errMsg:  "auth_config must not contain plaintext token",
		},
		{
			name:    "auth_config with secret real value → error",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", AuthConfig: `{"secret":"mysecret"}`},
			wantErr: true,
			errMsg:  "auth_config must not contain plaintext secret",
		},
		{
			name:    "auth_config with password real value → error",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", AuthConfig: `{"password":"pass123"}`},
			wantErr: true,
			errMsg:  "auth_config must not contain plaintext password",
		},
		{
			name:    "auth_config with key real value → error",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", AuthConfig: `{"key":"mykey"}`},
			wantErr: true,
			errMsg:  "auth_config must not contain plaintext key",
		},
		{
			name:    "auth_config with api_secret real value → error",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", AuthConfig: `{"api_secret":"realsecret"}`},
			wantErr: true,
			errMsg:  "auth_config must not contain plaintext api_secret",
		},
		{
			name:    "auth_config with access_token real value → error",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", AuthConfig: `{"access_token":"realtoken"}`},
			wantErr: true,
			errMsg:  "auth_config must not contain plaintext access_token",
		},
		{
			name:    "url with embedded @ → error",
			server:  MCPServer{Name: "test", Transport: "sse", URL: "https://user:pass@example.com/api"}, // #nosec G101 -- 负向测试：必须含凭据的 URL
			wantErr: true,
			errMsg:  "url must not contain credentials",
		},
		{
			name:    "url with token= → error",
			server:  MCPServer{Name: "test", Transport: "sse", URL: "https://example.com?token=abc123"},
			wantErr: true,
			errMsg:  "url must not contain credentials",
		},
		{
			name:    "url with key= → error",
			server:  MCPServer{Name: "test", Transport: "sse", URL: "https://example.com?key=abc123"},
			wantErr: true,
			errMsg:  "url must not contain credentials",
		},
		{
			name:    "url with secret= → error",
			server:  MCPServer{Name: "test", Transport: "sse", URL: "https://example.com?secret=abc123"},
			wantErr: true,
			errMsg:  "url must not contain credentials",
		},
		{
			name:    "normal url → passes",
			server:  MCPServer{Name: "test", Transport: "sse", URL: "https://example.com/api"},
			wantErr: false,
		},
		{
			name:    "ftp scheme → error",
			server:  MCPServer{Name: "test", Transport: "sse", URL: "ftp://example.com/api"},
			wantErr: true,
			errMsg:  "url must be http or https",
		},
		{
			name:    "no host → error",
			server:  MCPServer{Name: "test", Transport: "sse", URL: "https:///missing-host"},
			wantErr: true,
			errMsg:  "url must include a host",
		},
		{
			name:    "bare hostname (no scheme) → error",
			server:  MCPServer{Name: "test", Transport: "sse", URL: "example.com/api"},
			wantErr: true,
			errMsg:  "url must be http or https",
		},
		{
			name:    "env_vars not object → error",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", EnvVars: `"not-an-object"`},
			wantErr: true,
			errMsg:  "env_vars must be a JSON object",
		},
		{
			name:    "tool_schema not object → error",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", ToolSchema: `"not-an-object"`},
			wantErr: true,
			errMsg:  "tool_schema must be a JSON object",
		},
		{
			name:    "empty args → passes (not validated when empty)",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", Args: ""},
			wantErr: false,
		},
		{
			name:    "empty auth_config → passes",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", AuthConfig: ""},
			wantErr: false,
		},
		{
			name:    "auth_config with non-sensitive keys → passes",
			server:  MCPServer{Name: "test", Transport: "stdio", Command: "node", AuthConfig: `{"client_id":"myapp","scope":"read"}`},
			wantErr: false,
		},
		{
			name: "default transport (stdio) with valid config → passes",
			server: MCPServer{
				Name:      "brave-search",
				Transport: "stdio",
				Command:   "npx",
				Args:      `["-y","@anthropic/mcp-server-brave-search"]`,
				EnvVars:   `{"BRAVE_API_KEY":"not-a-real-key-in-this-context"}`,
				AuthType:  "none",
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.server.Validate()
			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error containing %q, got nil", tt.errMsg)
					return
				}
				if tt.errMsg != "" && !contains(err.Error(), tt.errMsg) {
					t.Errorf("expected error containing %q, got %q", tt.errMsg, err.Error())
				}
			} else {
				if err != nil {
					t.Errorf("expected no error, got %v", err)
				}
			}
		})
	}
}
