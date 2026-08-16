// Package mcp implements a Model Context Protocol (MCP) server endpoint
// that exposes AgentHub's project/thread/run capabilities as standard MCP tools.
//
// # Protocol
//
// Uses JSON-RPC 2.0 over HTTP (Streamable HTTP transport). The server supports
// both single requests and batch requests per the JSON-RPC 2.0 specification.
// Notifications (requests without an "id" field) are acknowledged with
// HTTP 202 Accepted and no response body.
//
// # Authentication
//
// MCP-level auth mirrors the global Edge local auth token for defense-in-depth:
// even if a request bypasses the middleware chain, the MCP handler itself
// enforces the same bearer token. When SetAuthToken is called with a non-empty
// token, every MCP request MUST include it as a Bearer token in the
// Authorization header.
//
// # Tool naming
//
// Tools use canonical agenthub_ prefixed names (e.g. agenthub_list_projects).
// Unprefixed deprecated aliases are listed during discovery with [DEPRECATED]
// markers and log a WARNING when invoked. They will be removed in a future release.
//
// # Wire-up
//
// The MCP server is instantiated in httpserver/server.go and registered at
// POST /mcp on the Edge HTTP mux. It receives the same store, executor,
// event bus, and permission registry dependencies as the REST API handler.
package mcp

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/permission"
	"github.com/agenthub/edge-server/internal/resputil"
	"github.com/agenthub/edge-server/internal/store"
)

// MCP protocol version supported by this server.
// "2025-06-18" is the stateless HTTP-based spec that replaced the
// session-based "2024-11-05" transport. This server uses per-request
// stateless design (ServeHTTP), which aligns with the newer spec.
const protocolVersion = "2025-06-18"

// Server name reported during initialize handshake.
const serverName = "agenthub-edge"

// Server version reported during initialize handshake.
const serverVersion = "1.0.0"

// JSON-RPC 2.0 error codes.
const (
	codeParseError     = -32700
	codeInvalidRequest = -32600
	codeMethodNotFound = -32601
	codeInvalidParams  = -32602
)

// maxMCPBodyBytes limits the request body size for MCP requests (1 MB).
// This matches the REST API limit in handlers.go.
const maxMCPBodyBytes = 1 << 20

// jsonrpcRequest represents a JSON-RPC 2.0 request.
// The ID field is any JSON value or nil for notifications.
// Params is raw JSON to be unmarshalled by each handler independently.
type jsonrpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// jsonrpcResponse represents a JSON-RPC 2.0 response.
// Exactly one of Result or Error is set for success/error responses.
// Both are nil for notifications (no response body).
type jsonrpcResponse struct {
	JSONRPC string        `json:"jsonrpc"`
	ID      any           `json:"id,omitempty"`
	Result  any           `json:"result,omitempty"`
	Error   *jsonrpcError `json:"error,omitempty"`
}

// jsonrpcError represents a JSON-RPC 2.0 error object.
// Code uses the standard JSON-RPC error codes (-32700 to -32603) defined above.
// Data is an optional arbitrary value for additional error context.
type jsonrpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// Server implements an MCP server over HTTP using JSON-RPC 2.0.
//
// Dependencies:
//   - store: provides project/thread/run CRUD for tool implementations
//   - executor: starts and cancels agent runs
//   - bus: publishes events (run.queued, message.created, run.failed)
//   - permissionRegistry: resolves permission approval/deny decisions
//   - workspaceAllowlist: validates workDir in start_run requests
//
// All fields are set during initialization and are read-only thereafter.
type Server struct {
	store              store.Repository
	executor           lifecycle.RunExecutor
	bus                *events.Bus
	permissionRegistry *permission.PermissionRegistry
	workspaceAllowlist []string

	// authToken, if non-empty, is required as Bearer token on every MCP request.
	// When empty (default), MCP inherits the global Edge auth middleware.
	authToken string
}

// NewServer creates a new MCP server with the given dependencies.
// Call SetAuthToken and SetWorkspaceAllowlist after construction to configure
// authentication and workDir validation respectively.
func NewServer(
	repository store.Repository,
	executor lifecycle.RunExecutor,
	bus *events.Bus,
	permissionRegistry *permission.PermissionRegistry,
) *Server {
	return &Server{
		store:              repository,
		executor:           executor,
		bus:                bus,
		permissionRegistry: permissionRegistry,
	}
}

// SetAuthToken configures a required Bearer token for MCP endpoint access.
// When empty, no additional MCP-level auth is enforced (the global middleware
// still applies). When set, every MCP request MUST include this token as a
// Bearer token in the Authorization header.
func (s *Server) SetAuthToken(token string) {
	s.authToken = token
}

// SetWorkspaceAllowlist configures the workspace allowlist for workDir validation
// in start_run requests. When set, workDir values must fall within one of the
// allowed roots — matching the REST API validation in PostRuns.
func (s *Server) SetWorkspaceAllowlist(roots []string) {
	s.workspaceAllowlist = roots
}

// ServeHTTP handles MCP requests on the /mcp endpoint.
//
// Only POST is accepted; other methods return 405 Method Not Allowed.
// Accepts JSON-RPC 2.0 payloads with Content-Type: application/json.
// The body is limited to maxMCPBodyBytes (1 MB).
//
// When an MCP-specific auth token is configured (SetAuthToken), requests must
// include it as a Bearer token in the Authorization header. This is in addition
// to the global Edge auth middleware — defense-in-depth.
//
// Supports both single requests and batch requests:
//   - Single request: parses one JSON-RPC request, dispatches via handleRequest.
//   - Batch request: parses an array of JSON-RPC requests, dispatches each
//     independently, returns an array of responses. Notifications (no "id") are
//     excluded from the response array.
//   - Notification: a single request with no "id" field returns HTTP 202.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// MCP-level authentication: when configured, verify Bearer token.
	if s.authToken != "" {
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") || !strings.EqualFold(strings.TrimPrefix(auth, "Bearer "), s.authToken) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}

	contentType := r.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "application/json") {
		writeJSONRPCError(w, nil, codeInvalidRequest, "Content-Type must be application/json")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, maxMCPBodyBytes))
	if err != nil {
		writeJSONRPCError(w, nil, codeParseError, "failed to read request body")
		return
	}
	defer r.Body.Close()

	// Try to parse as a single request first
	var req jsonrpcRequest
	if err := json.Unmarshal(body, &req); err != nil {
		// Try batch request
		var batch []jsonrpcRequest
		if err := json.Unmarshal(body, &batch); err != nil {
			writeJSONRPCError(w, nil, codeParseError, "invalid JSON")
			return
		}
		// Handle batch requests
		responses := make([]jsonrpcResponse, 0, len(batch))
		for _, batchReq := range batch {
			resp := s.handleRequest(batchReq)
			if resp != nil {
				responses = append(responses, *resp)
			}
		}
		if len(responses) == 0 {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		writeJSON(w, http.StatusOK, responses)
		return
	}

	resp := s.handleRequest(req)
	if resp == nil {
		// Notification (no ID) — no response needed
		w.WriteHeader(http.StatusAccepted)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleRequest dispatches a single JSON-RPC request to the appropriate method
// handler. Returns nil for notifications (requests without an "id" field that
// are not method calls).
//
// Method dispatch table:
//
//	initialize               → handleInitialize (capabilities announcement)
//	notifications/initialized → nil (client acknowledgement, no response)
//	ping                     → handlePing (liveness check)
//	tools/list               → handleToolsList (discovery)
//	tools/call               → handleToolsCall (execution)
//	<unknown>                → errorResponse with codeMethodNotFound
func (s *Server) handleRequest(req jsonrpcRequest) *jsonrpcResponse {
	if req.JSONRPC != "2.0" {
		return errorResponse(req.ID, codeInvalidRequest, "jsonrpc must be '2.0'")
	}

	switch req.Method {
	case "initialize":
		return s.handleInitialize(req)
	case "notifications/initialized":
		// Client acknowledgment — no response needed for notifications
		return nil
	case "ping":
		return s.handlePing(req)
	case "tools/list":
		return s.handleToolsList(req)
	case "tools/call":
		return s.handleToolsCall(req)
	default:
		return errorResponse(req.ID, codeMethodNotFound, "method not found: "+req.Method)
	}
}

// handleInitialize processes the MCP initialize request.
// Reports protocol version 2025-06-18 (stateless), announces the tools
// capability, and returns server metadata. No session is created — the
// server uses a per-request stateless design (ServeHTTP) aligned with the
// 2025 MCP spec which dropped session-based transport in favor of
// stateless HTTP.
func (s *Server) handleInitialize(req jsonrpcRequest) *jsonrpcResponse {
	result := map[string]any{
		"protocolVersion": protocolVersion,
		"capabilities": map[string]any{
			"tools": map[string]any{},
		},
		"serverInfo": map[string]any{
			"name":    serverName,
			"version": serverVersion,
		},
		"instructions": "AgentHub Edge MCP Server — manage projects, threads, and agent runs.",
	}

	return successResponse(req.ID, result)
}

// handlePing responds to ping requests.
func (s *Server) handlePing(req jsonrpcRequest) *jsonrpcResponse {
	return successResponse(req.ID, map[string]any{})
}

// handleToolsList returns the list of available MCP tools.
func (s *Server) handleToolsList(req jsonrpcRequest) *jsonrpcResponse {
	tools := s.listTools()
	result := map[string]any{
		"tools": tools,
	}
	return successResponse(req.ID, result)
}

// handleToolsCall executes a tool by name with the given arguments.
//
// Tool errors (unknown tool, invalid arguments, store/executor not configured)
// are returned as successful JSON-RPC responses with isError: true — this
// follows the MCP specification which distinguishes between protocol-level
// errors (JSON-RPC error object) and tool-level errors (tool result with isError).
//
// See tools.go for the list of available tools and their implementations.
func (s *Server) handleToolsCall(req jsonrpcRequest) *jsonrpcResponse {
	var params struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments,omitempty"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, codeInvalidParams, "invalid params: "+err.Error())
	}
	if params.Name == "" {
		return errorResponse(req.ID, codeInvalidParams, "tool name is required")
	}

	result, err := s.callTool(params.Name, params.Arguments)
	if err != nil {
		// Return tool error as a tool result with isError flag
		return successResponse(req.ID, map[string]any{
			"content": []map[string]any{
				{"type": "text", "text": err.Error()},
			},
			"isError": true,
		})
	}

	return successResponse(req.ID, map[string]any{
		"content": []map[string]any{
			{"type": "text", "text": string(result)},
		},
	})
}

// successResponse creates a successful JSON-RPC 2.0 response.
// The result is serialized as-is into the "result" field.
func successResponse(id any, result any) *jsonrpcResponse {
	return &jsonrpcResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}
}

// errorResponse creates an error JSON-RPC 2.0 response.
// The error is returned with the given code, message, and no data payload.
func errorResponse(id any, code int, message string) *jsonrpcResponse {
	return &jsonrpcResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: &jsonrpcError{
			Code:    code,
			Message: message,
		},
	}
}

// writeJSONRPCError writes a JSON-RPC error response directly to the HTTP
// response writer. Used for protocol-level errors that occur before a request
// can be dispatched (parse errors, invalid content type, etc.).
func writeJSONRPCError(w http.ResponseWriter, id any, code int, message string) {
	writeJSON(w, http.StatusOK, errorResponse(id, code, message))
}

// writeJSON writes a JSON response with the given HTTP status.
// Delegates to the shared resputil writer (#1675): Content-Type
// application/json; charset=utf-8, nil payloads write only headers.
func writeJSON(w http.ResponseWriter, status int, v any) {
	resputil.WriteJSON(w, status, v)
}
