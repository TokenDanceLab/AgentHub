// Package mcp implements a Model Context Protocol (MCP) server endpoint
// that exposes AgentHub's project/thread/run capabilities as standard MCP tools.
// It uses JSON-RPC 2.0 over HTTP (Streamable HTTP transport).
package mcp

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"

	"github.com/agenthub/edge-server/internal/api"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/store"
)

// MCP protocol version supported by this server.
const protocolVersion = "2024-11-05"

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

// jsonrpcRequest represents a JSON-RPC 2.0 request.
type jsonrpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// jsonrpcResponse represents a JSON-RPC 2.0 response.
type jsonrpcResponse struct {
	JSONRPC string        `json:"jsonrpc"`
	ID      any           `json:"id,omitempty"`
	Result  any           `json:"result,omitempty"`
	Error   *jsonrpcError `json:"error,omitempty"`
}

// jsonrpcError represents a JSON-RPC 2.0 error object.
type jsonrpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// Server implements an MCP server over HTTP using JSON-RPC 2.0.
type Server struct {
	store              store.Repository
	executor           lifecycle.RunExecutor
	bus                *events.Bus
	permissionRegistry *api.PermissionRegistry

	// sessionID is generated on initialize and returned to clients.
	// For simplicity, this implementation uses a single-session model.
	mu        sync.Mutex
	sessionID string
}

// NewServer creates a new MCP server with the given dependencies.
func NewServer(
	repository store.Repository,
	executor lifecycle.RunExecutor,
	bus *events.Bus,
	permissionRegistry *api.PermissionRegistry,
) *Server {
	return &Server{
		store:              repository,
		executor:           executor,
		bus:                bus,
		permissionRegistry: permissionRegistry,
	}
}

// ServeHTTP handles MCP requests on the /mcp endpoint.
// It accepts POST requests with JSON-RPC 2.0 payloads.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	contentType := r.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "application/json") {
		writeJSONRPCError(w, nil, codeInvalidRequest, "Content-Type must be application/json")
		return
	}

	body, err := io.ReadAll(r.Body)
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

// handleRequest dispatches a single JSON-RPC request to the appropriate method handler.
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
func (s *Server) handleInitialize(req jsonrpcRequest) *jsonrpcResponse {
	// Generate a session ID for this connection
	s.mu.Lock()
	s.sessionID = generateSessionID()
	sessionID := s.sessionID
	s.mu.Unlock()

	result := map[string]any{
		"protocolVersion": protocolVersion,
		"capabilities": map[string]any{
			"tools": map[string]any{
				"listChanged": false,
			},
		},
		"serverInfo": map[string]any{
			"name":    serverName,
			"version": serverVersion,
		},
		"instructions": "AgentHub Edge MCP Server — manage projects, threads, and agent runs.",
	}

	slog.Info("mcp.initialize", "sessionID", sessionID, "protocolVersion", protocolVersion)
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

// successResponse creates a successful JSON-RPC response.
func successResponse(id any, result any) *jsonrpcResponse {
	return &jsonrpcResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}
}

// errorResponse creates an error JSON-RPC response.
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

// writeJSONRPCError writes a JSON-RPC error response directly to the response writer.
func writeJSONRPCError(w http.ResponseWriter, id any, code int, message string) {
	writeJSON(w, http.StatusOK, errorResponse(id, code, message))
}

// writeJSON writes a JSON response with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		if err := json.NewEncoder(w).Encode(v); err != nil {
			slog.Error("mcp: failed to encode response", "err", err)
		}
	}
}

// generateSessionID creates a random session identifier.
func generateSessionID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// Fallback to a static value if crypto/rand fails
		return "mcp_sess_fallback"
	}
	return "mcp_sess_" + hex.EncodeToString(b)
}
