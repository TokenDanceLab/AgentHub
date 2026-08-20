// MCP config wiring for the ACP session (#1743, follow-up of #1404).
//
// The run profile carries MCP server definitions as a --mcp-config-style
// JSON string ({"mcpServers": {name: {...}}}); this file converts them into
// the acp-go-sdk session/new McpServer union entries. The conversion is
// pure and fail-closed: any entry that cannot be represented on the ACP
// wire fails the whole parse so runACPSession can surface the #1740
// degradation event instead of silently dropping servers.
package acp

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/coder/acp-go-sdk"
)

// parseACPMcpServers converts a run-profile MCP config JSON string into ACP
// session/new McpServer entries. Empty input yields an empty (non-nil)
// slice — session/new requires the mcpServers field to be present. Any
// unrepresentable entry (unparseable JSON, unknown transport, missing
// command/url) fails the whole parse; the caller keeps the #1740 degraded
// event on that path.
func parseACPMcpServers(configJSON string) ([]acp.McpServer, error) {
	if strings.TrimSpace(configJSON) == "" {
		return []acp.McpServer{}, nil
	}
	var file adapters.MCPServerConfigFile
	if err := json.Unmarshal([]byte(configJSON), &file); err != nil {
		// Keep a non-nil empty slice on failure: session/new still sends a
		// valid empty mcpServers array while the caller degrades the run.
		return []acp.McpServer{}, fmt.Errorf("acp: parse MCP config JSON: %w", err)
	}

	names := make([]string, 0, len(file.MCPServers))
	for name := range file.MCPServers {
		names = append(names, name)
	}
	sort.Strings(names)

	servers := make([]acp.McpServer, 0, len(names))
	for _, name := range names {
		mcpServer, err := acpMcpServerFor(name, file.MCPServers[name])
		if err != nil {
			return []acp.McpServer{}, err
		}
		servers = append(servers, mcpServer)
	}
	return servers, nil
}

// acpMcpServerFor maps one adapters.MCPServerConfig entry to the ACP wire
// union. Transport names follow the Claude Code --mcp-config convention:
// empty and "stdio" map to the stdio variant, "sse" to the sse variant,
// "streamable-http" to the http variant. Fail-closed: anything else is a
// config error, not a silent skip.
func acpMcpServerFor(key string, cfg adapters.MCPServerConfig) (acp.McpServer, error) {
	name := strings.TrimSpace(cfg.Name)
	if name == "" {
		name = key
	}
	switch strings.ToLower(cfg.Transport) {
	case "", "stdio":
		if strings.TrimSpace(cfg.Command) == "" {
			return acp.McpServer{}, fmt.Errorf("acp: MCP server %q: stdio transport requires a command", name)
		}
		return acp.McpServer{Stdio: &acp.McpServerStdio{
			Name:    name,
			Command: cfg.Command,
			Args:    acpMCPArgs(cfg.Args),
			Env:     acpMCPEnv(cfg.Env),
		}}, nil
	case "sse":
		if strings.TrimSpace(cfg.URL) == "" {
			return acp.McpServer{}, fmt.Errorf("acp: MCP server %q: sse transport requires a url", name)
		}
		return acp.McpServer{Sse: &acp.McpServerSseInline{
			Name: name,
			Url:  cfg.URL,
		}}, nil
	case "streamable-http":
		if strings.TrimSpace(cfg.URL) == "" {
			return acp.McpServer{}, fmt.Errorf("acp: MCP server %q: streamable-http transport requires a url", name)
		}
		return acp.McpServer{Http: &acp.McpServerHttpInline{
			Name: name,
			Url:  cfg.URL,
		}}, nil
	default:
		return acp.McpServer{}, fmt.Errorf("acp: MCP server %q: unsupported transport %q", name, cfg.Transport)
	}
}

// acpMCPArgs returns args as a non-nil slice: the ACP schema requires the
// array to be present (a nil slice would marshal to null).
func acpMCPArgs(args []string) []string {
	if args == nil {
		return []string{}
	}
	return args
}

// acpMCPEnv converts the config env map into sorted EnvVariable entries for
// deterministic wire output.
func acpMCPEnv(env map[string]string) []acp.EnvVariable {
	if len(env) == 0 {
		return []acp.EnvVariable{}
	}
	names := make([]string, 0, len(env))
	for name := range env {
		names = append(names, name)
	}
	sort.Strings(names)
	variables := make([]acp.EnvVariable, 0, len(names))
	for _, name := range names {
		variables = append(variables, acp.EnvVariable{Name: name, Value: env[name]})
	}
	return variables
}
