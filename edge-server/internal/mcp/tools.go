package mcp

// Residual pure-helper peel of MCP tool surface (#1104).
// Companion files (same package):
//   - tools_catalog.go  — listTools tool definition catalog
//   - tools_handlers.go — tool handler implementations
//   - tools_helpers.go  — jsonSchema / marshalResult / generateID helpers
// This file keeps the Tool type and callTool dispatcher.

import (
	"encoding/json"
	"fmt"
	"log/slog"
)

// Tool represents an MCP tool definition returned by tools/list.
// Name and Description are displayed to the MCP client.
// InputSchema is a JSON Schema object defining the tool's parameters.
type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

// callTool dispatches to the appropriate tool handler based on the tool name.
//
// Naming:
//   - agenthub_ prefixed names are the canonical tool names and dispatch silently.
//   - Unprefixed names are deprecated aliases; they dispatch to the same handler
//     but log a WARNING urging migration.
//
// Returns an error for unknown tool names (caught by handleToolsCall and wrapped
// as a tool result with isError: true).
func (s *Server) callTool(name string, args json.RawMessage) (json.RawMessage, error) {
	switch name {
	// Canonical agenthub_ prefixed names
	case "agenthub_list_projects":
		return s.toolListProjects(args)
	case "agenthub_list_threads":
		return s.toolListThreads(args)
	case "agenthub_get_thread":
		return s.toolGetThread(args)
	case "agenthub_start_run":
		return s.toolStartRun(args)
	case "agenthub_get_run_status":
		return s.toolGetRunStatus(args)
	case "agenthub_approve_action":
		return s.toolApproveAction(args)
	case "agenthub_cancel_run":
		return s.toolCancelRun(args)
	case "agenthub_send_message":
		return s.toolSendMessage(args)
	// Deprecated unprefixed aliases (backward compatibility)
	case "list_projects":
		slog.Warn("mcp: deprecated tool name 'list_projects' used, migrate to 'agenthub_list_projects'")
		return s.toolListProjects(args)
	case "list_threads":
		slog.Warn("mcp: deprecated tool name 'list_threads' used, migrate to 'agenthub_list_threads'")
		return s.toolListThreads(args)
	case "get_thread":
		slog.Warn("mcp: deprecated tool name 'get_thread' used, migrate to 'agenthub_get_thread'")
		return s.toolGetThread(args)
	case "start_run":
		slog.Warn("mcp: deprecated tool name 'start_run' used, migrate to 'agenthub_start_run'")
		return s.toolStartRun(args)
	case "get_run_status":
		slog.Warn("mcp: deprecated tool name 'get_run_status' used, migrate to 'agenthub_get_run_status'")
		return s.toolGetRunStatus(args)
	case "approve_action":
		slog.Warn("mcp: deprecated tool name 'approve_action' used, migrate to 'agenthub_approve_action'")
		return s.toolApproveAction(args)
	case "cancel_run":
		slog.Warn("mcp: deprecated tool name 'cancel_run' used, migrate to 'agenthub_cancel_run'")
		return s.toolCancelRun(args)
	case "send_message":
		slog.Warn("mcp: deprecated tool name 'send_message' used, migrate to 'agenthub_send_message'")
		return s.toolSendMessage(args)
	default:
		return nil, fmt.Errorf("unknown tool: %s", name)
	}
}
