package mcp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/edge-server/internal/api"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/store"
)

// newTestServer creates an MCP server with a mock store for testing.
func newTestServer(t *testing.T) (*Server, *store.Store) {
	t.Helper()
	s := store.New()
	// Create default project and thread
	_, _ = s.CreateProject("proj_test", "Test Project")
	_, _ = s.CreateThread("thread_test", "proj_test", "Test Thread")

	bus := events.NewBus(100)
	permReg := api.NewPermissionRegistry(0)

	srv := NewServer(s, nil, bus, permReg)
	return srv, s
}

// doJSONRPC sends a JSON-RPC request to the MCP server and returns the response.
func doJSONRPC(t *testing.T, srv *Server, method string, id any, params any) *httptest.ResponseRecorder {
	t.Helper()

	reqBody := map[string]any{
		"jsonrpc": "2.0",
		"method":  method,
	}
	if id != nil {
		reqBody["id"] = id
	}
	if params != nil {
		data, err := json.Marshal(params)
		if err != nil {
			t.Fatalf("failed to marshal params: %v", err)
		}
		reqBody["params"] = json.RawMessage(data)
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		t.Fatalf("failed to marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

// parseResponse parses the JSON-RPC response body.
func parseResponse(t *testing.T, rec *httptest.ResponseRecorder) jsonrpcResponse {
	t.Helper()
	var resp jsonrpcResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v\nbody: %s", err, rec.Body.String())
	}
	return resp
}

func TestInitialize(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "initialize", 1, map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "test-client", "version": "1.0"},
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	resp := parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}

	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}
	if result["protocolVersion"] != protocolVersion {
		t.Errorf("expected protocolVersion %q, got %q", protocolVersion, result["protocolVersion"])
	}

	serverInfo, ok := result["serverInfo"].(map[string]any)
	if !ok {
		t.Fatal("serverInfo is not a map")
	}
	if serverInfo["name"] != serverName {
		t.Errorf("expected server name %q, got %q", serverName, serverInfo["name"])
	}
}

func TestPing(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "ping", 1, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	resp := parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}
}

func TestToolsList(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "tools/list", 1, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	resp := parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}

	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}

	tools, ok := result["tools"].([]any)
	if !ok {
		t.Fatalf("tools is not an array: %T", result["tools"])
	}

	// We expect at least 8 tools
	if len(tools) < 8 {
		t.Errorf("expected at least 8 tools, got %d", len(tools))
	}

	// Verify each tool has required fields
	for i, tool := range tools {
		toolMap, ok := tool.(map[string]any)
		if !ok {
			t.Errorf("tool %d is not a map", i)
			continue
		}
		if _, ok := toolMap["name"]; !ok {
			t.Errorf("tool %d missing name", i)
		}
		if _, ok := toolMap["description"]; !ok {
			t.Errorf("tool %d missing description", i)
		}
		if _, ok := toolMap["inputSchema"]; !ok {
			t.Errorf("tool %d missing inputSchema", i)
		}
	}
}

func TestToolListProjects(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name":      "list_projects",
		"arguments": map[string]any{},
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	resp := parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}

	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}

	content, ok := result["content"].([]any)
	if !ok || len(content) == 0 {
		t.Fatal("missing or empty content")
	}

	// Parse the text content
	contentMap, ok := content[0].(map[string]any)
	if !ok {
		t.Fatal("content[0] is not a map")
	}
	text, ok := contentMap["text"].(string)
	if !ok {
		t.Fatal("content text is not a string")
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(text), &data); err != nil {
		t.Fatalf("failed to parse tool result: %v", err)
	}

	projects, ok := data["projects"].([]any)
	if !ok {
		t.Fatal("projects is not an array")
	}
	if len(projects) < 1 {
		t.Errorf("expected at least 1 project, got %d", len(projects))
	}
}

func TestToolListThreads(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "list_threads",
		"arguments": map[string]any{
			"projectId": "proj_test",
		},
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	resp := parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}

	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}

	content, ok := result["content"].([]any)
	if !ok || len(content) == 0 {
		t.Fatal("missing or empty content")
	}

	contentMap, ok := content[0].(map[string]any)
	if !ok {
		t.Fatal("content[0] is not a map")
	}
	text, ok := contentMap["text"].(string)
	if !ok {
		t.Fatal("content text is not a string")
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(text), &data); err != nil {
		t.Fatalf("failed to parse tool result: %v", err)
	}

	threads, ok := data["threads"].([]any)
	if !ok {
		t.Fatal("threads is not an array")
	}
	if len(threads) < 1 {
		t.Errorf("expected at least 1 thread, got %d", len(threads))
	}
}

func TestToolListThreadsProjectNotFound(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "list_threads",
		"arguments": map[string]any{
			"projectId": "nonexistent",
		},
	})

	resp := parseResponse(t, rec)
	// Tool errors are returned as successful responses with isError flag
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}
	if result["isError"] != true {
		t.Error("expected isError to be true")
	}
}

func TestToolGetThread(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "get_thread",
		"arguments": map[string]any{
			"threadId": "thread_test",
		},
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	resp := parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}

	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}

	content, ok := result["content"].([]any)
	if !ok || len(content) == 0 {
		t.Fatal("missing or empty content")
	}

	contentMap, ok := content[0].(map[string]any)
	if !ok {
		t.Fatal("content[0] is not a map")
	}
	text, ok := contentMap["text"].(string)
	if !ok {
		t.Fatal("content text is not a string")
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(text), &data); err != nil {
		t.Fatalf("failed to parse tool result: %v", err)
	}

	thread, ok := data["thread"].(map[string]any)
	if !ok {
		t.Fatal("thread is not a map")
	}
	if thread["threadId"] != "thread_test" {
		t.Errorf("expected threadId 'thread_test', got %q", thread["threadId"])
	}
}

func TestToolGetRunStatus(t *testing.T) {
	srv, s := newTestServer(t)

	// Create a run
	run, err := s.CreateRun("run_test", "proj_test", "thread_test")
	if err != nil {
		t.Fatalf("failed to create run: %v", err)
	}

	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "get_run_status",
		"arguments": map[string]any{
			"runId": run.ID,
		},
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	resp := parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}

	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}

	content, ok := result["content"].([]any)
	if !ok || len(content) == 0 {
		t.Fatal("missing or empty content")
	}

	contentMap, ok := content[0].(map[string]any)
	if !ok {
		t.Fatal("content[0] is not a map")
	}
	text, ok := contentMap["text"].(string)
	if !ok {
		t.Fatal("content text is not a string")
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(text), &data); err != nil {
		t.Fatalf("failed to parse tool result: %v", err)
	}

	if data["runId"] != "run_test" {
		t.Errorf("expected runId 'run_test', got %q", data["runId"])
	}
	if data["status"] != "queued" {
		t.Errorf("expected status 'queued', got %q", data["status"])
	}
}

func TestToolGetRunStatusNotFound(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "get_run_status",
		"arguments": map[string]any{
			"runId": "nonexistent",
		},
	})

	resp := parseResponse(t, rec)
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}
	if result["isError"] != true {
		t.Error("expected isError to be true")
	}
}

func TestToolSendMessage(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "send_message",
		"arguments": map[string]any{
			"threadId": "thread_test",
			"content":  "Hello, agent!",
			"role":     "user",
		},
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	resp := parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}

	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}
	if result["isError"] == true {
		t.Error("unexpected isError")
	}
}

func TestMethodNotFound(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "nonexistent/method", 1, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	resp := parseResponse(t, rec)
	if resp.Error == nil {
		t.Fatal("expected error response")
	}
	if resp.Error.Code != codeMethodNotFound {
		t.Errorf("expected error code %d, got %d", codeMethodNotFound, resp.Error.Code)
	}
}

func TestInvalidJSON(t *testing.T) {
	srv, _ := newTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	resp := parseResponse(t, rec)
	if resp.Error == nil {
		t.Fatal("expected error response")
	}
	if resp.Error.Code != codeParseError {
		t.Errorf("expected error code %d, got %d", codeParseError, resp.Error.Code)
	}
}

func TestMethodNotAllowed(t *testing.T) {
	srv, _ := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/mcp", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rec.Code)
	}
}

func TestInvalidContentType(t *testing.T) {
	srv, _ := newTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	resp := parseResponse(t, rec)
	if resp.Error == nil {
		t.Fatal("expected error response")
	}
	if resp.Error.Code != codeInvalidRequest {
		t.Errorf("expected error code %d, got %d", codeInvalidRequest, resp.Error.Code)
	}
}

func TestBatchRequest(t *testing.T) {
	srv, _ := newTestServer(t)

	batch := []map[string]any{
		{"jsonrpc": "2.0", "id": 1, "method": "ping"},
		{"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
	}
	body, _ := json.Marshal(batch)

	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var responses []jsonrpcResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &responses); err != nil {
		t.Fatalf("failed to parse batch response: %v", err)
	}
	if len(responses) != 2 {
		t.Errorf("expected 2 responses, got %d", len(responses))
	}
}

func TestToolCallRequiresName(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"arguments": map[string]any{},
	})

	resp := parseResponse(t, rec)
	if resp.Error == nil {
		t.Fatal("expected error response")
	}
	if resp.Error.Code != codeInvalidParams {
		t.Errorf("expected error code %d, got %d", codeInvalidParams, resp.Error.Code)
	}
}

func TestToolCallUnknownTool(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name":      "unknown_tool",
		"arguments": map[string]any{},
	})

	resp := parseResponse(t, rec)
	// Unknown tool returns as tool error (isError: true), not JSON-RPC error
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}
	if result["isError"] != true {
		t.Error("expected isError to be true for unknown tool")
	}
}

func TestStartRunRequiresExecutor(t *testing.T) {
	srv, _ := newTestServer(t)
	// srv has nil executor
	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "start_run",
		"arguments": map[string]any{
			"projectId": "proj_test",
			"threadId":  "thread_test",
			"prompt":    "Hello",
		},
	})

	resp := parseResponse(t, rec)
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}
	if result["isError"] != true {
		t.Error("expected isError when executor is nil")
	}
}

func TestCancelRunRequiresExecutor(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "cancel_run",
		"arguments": map[string]any{
			"runId": "run_test",
		},
	})

	resp := parseResponse(t, rec)
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}
	if result["isError"] != true {
		t.Error("expected isError when executor is nil")
	}
}

func TestApproveActionRequiresPermission(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "approve_action",
		"arguments": map[string]any{
			"runId":     "run_test",
			"requestId": "req_test",
			"decision":  "allow",
		},
	})

	resp := parseResponse(t, rec)
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}
	if result["isError"] != true {
		t.Error("expected isError when permission not found")
	}
}

func TestApproveActionInvalidDecision(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "approve_action",
		"arguments": map[string]any{
			"runId":     "run_test",
			"requestId": "req_test",
			"decision":  "maybe",
		},
	})

	resp := parseResponse(t, rec)
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}
	if result["isError"] != true {
		t.Error("expected isError for invalid decision")
	}
}

func TestNotificationReturnsNoResponse(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "notifications/initialized", nil, nil)

	if rec.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d", rec.Code)
	}
}

func TestInvalidJSONRPCVersion(t *testing.T) {
	srv, _ := newTestServer(t)

	reqBody := map[string]any{
		"jsonrpc": "1.0",
		"id":      1,
		"method":  "ping",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	resp := parseResponse(t, rec)
	if resp.Error == nil {
		t.Fatal("expected error for invalid jsonrpc version")
	}
	if resp.Error.Code != codeInvalidRequest {
		t.Errorf("expected error code %d, got %d", codeInvalidRequest, resp.Error.Code)
	}
}

// Ensure lifecycle package is used (for mock executor in future tests)
var _ lifecycle.RunExecutor
