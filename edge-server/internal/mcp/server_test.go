package mcp

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/permission"
	"github.com/agenthub/edge-server/internal/store"
)

// newTestServer creates an MCP server with a mock store for testing.
// The workspace allowlist root is a real temp directory so EvalSymlinks-based
// workDir checks (shared with REST / #998) can resolve successfully.
func newTestServer(t *testing.T) (*Server, *store.Store) {
	t.Helper()
	s := store.New()
	// Create default project and thread
	_, _ = s.CreateProject("proj_test", "Test Project", "")
	_, _ = s.CreateThread("thread_test", "proj_test", "Test Thread", "", "", "")

	bus := events.NewBus(100)
	permReg := permission.NewPermissionRegistry(0)

	srv := NewServer(s, nil, bus, permReg)
	srv.SetWorkspaceAllowlist([]string{t.TempDir()})
	return srv, s
}

// testMCPWorkDir returns a path inside the server's workspace allowlist that
// exists on disk (required by EvalSymlinks containment).
func testMCPWorkDir(t *testing.T, srv *Server) string {
	t.Helper()
	if len(srv.workspaceAllowlist) == 0 {
		t.Fatal("workspace allowlist not configured")
	}
	return srv.workspaceAllowlist[0]
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

func parseToolResult(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	resp := parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("unexpected JSON-RPC error: %+v", resp.Error)
	}
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}
	if result["isError"] == true {
		t.Fatalf("unexpected tool error: %+v", result)
	}
	content, ok := result["content"].([]any)
	if !ok || len(content) == 0 {
		t.Fatalf("missing tool content: %+v", result)
	}
	contentMap, ok := content[0].(map[string]any)
	if !ok {
		t.Fatalf("content[0] is not a map: %T", content[0])
	}
	text, ok := contentMap["text"].(string)
	if !ok {
		t.Fatalf("content text is not a string: %T", contentMap["text"])
	}
	var data map[string]any
	if err := json.Unmarshal([]byte(text), &data); err != nil {
		t.Fatalf("failed to parse tool result: %v\ntext: %s", err, text)
	}
	return data
}

func assertToolError(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	resp := parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("unexpected JSON-RPC error: %+v", resp.Error)
	}
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not a map: %T", resp.Result)
	}
	if result["isError"] != true {
		t.Fatalf("expected tool error, got %+v", result)
	}
	return result
}

type recordingRunExecutor struct {
	started  []store.Run
	contexts []lifecycle.RunProcessContext
	startErr error
	cancel   lifecycle.CancelResult
	cancels  []string
}

func (e *recordingRunExecutor) Start(run store.Run, ctx lifecycle.RunProcessContext) error {
	e.started = append(e.started, run)
	e.contexts = append(e.contexts, ctx)
	return e.startErr
}

func (e *recordingRunExecutor) Cancel(runID string) lifecycle.CancelResult {
	e.cancels = append(e.cancels, runID)
	return e.cancel
}

func TestInitialize(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "initialize", 1, map[string]any{
		"protocolVersion": "2025-06-18",
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

// TestToolsListDescriptionsNotEmpty verifies that every tool in tools/list has
// a non-empty description. This is a quality gate: MCP clients rely on
// descriptions to present tool choices to users.
func TestToolsListDescriptionsNotEmpty(t *testing.T) {
	srv, _ := newTestServer(t)
	rec := doJSONRPC(t, srv, "tools/list", 1, nil)

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

	for i, tool := range tools {
		toolMap, ok := tool.(map[string]any)
		if !ok {
			t.Errorf("tool %d is not a map", i)
			continue
		}
		name, _ := toolMap["name"].(string)
		desc, _ := toolMap["description"].(string)
		if desc == "" {
			t.Errorf("tool %q has empty description", name)
		}
	}
}

// TestPrefixedToolNamesWork verifies that calling tools with the new
// agenthub_ prefix works correctly (canonical names).
func TestPrefixedToolNamesWork(t *testing.T) {
	srv, _ := newTestServer(t)

	// Test agenthub_list_projects
	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name":      "agenthub_list_projects",
		"arguments": map[string]any{},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("agenthub_list_projects: expected 200, got %d", rec.Code)
	}
	resp := parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("agenthub_list_projects: unexpected error: %+v", resp.Error)
	}

	// Test agenthub_list_threads
	rec = doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "agenthub_list_threads",
		"arguments": map[string]any{
			"projectId": "proj_test",
		},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("agenthub_list_threads: expected 200, got %d", rec.Code)
	}
	resp = parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("agenthub_list_threads: unexpected error: %+v", resp.Error)
	}

	// Test agenthub_get_thread
	rec = doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "agenthub_get_thread",
		"arguments": map[string]any{
			"threadId": "thread_test",
		},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("agenthub_get_thread: expected 200, got %d", rec.Code)
	}
	resp = parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("agenthub_get_thread: unexpected error: %+v", resp.Error)
	}

	// Test agenthub_get_run_status (with nonexistent run — should get tool error)
	rec = doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "agenthub_get_run_status",
		"arguments": map[string]any{
			"runId": "nonexistent",
		},
	})
	resp = parseResponse(t, rec)
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("agenthub_get_run_status: result is not a map: %T", resp.Result)
	}
	if result["isError"] != true {
		t.Error("agenthub_get_run_status: expected isError for nonexistent run")
	}

	// Test agenthub_send_message
	rec = doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "agenthub_send_message",
		"arguments": map[string]any{
			"threadId": "thread_test",
			"content":  "Hello via prefixed name",
			"role":     "user",
		},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("agenthub_send_message: expected 200, got %d", rec.Code)
	}
	resp = parseResponse(t, rec)
	if resp.Error != nil {
		t.Fatalf("agenthub_send_message: unexpected error: %+v", resp.Error)
	}
}

// TestDeprecatedToolAliasesWork verifies that calling tools with the old
// unprefixed names still works (backward compatibility).
func TestDeprecatedToolAliasesWork(t *testing.T) {
	srv, _ := newTestServer(t)

	deprecatedNames := []struct {
		name string
		args map[string]any
	}{
		{"list_projects", map[string]any{}},
		{"list_threads", map[string]any{"projectId": "proj_test"}},
		{"get_thread", map[string]any{"threadId": "thread_test"}},
		{"get_run_status", map[string]any{"runId": "nonexistent"}}, // expect isError
		{"send_message", map[string]any{"threadId": "thread_test", "content": "Hello deprecated", "role": "user"}},
	}

	for _, dn := range deprecatedNames {
		t.Run(dn.name, func(t *testing.T) {
			rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
				"name":      dn.name,
				"arguments": dn.args,
			})
			if rec.Code != http.StatusOK {
				t.Fatalf("%s: expected 200, got %d", dn.name, rec.Code)
			}
			resp := parseResponse(t, rec)
			if resp.Error != nil {
				t.Fatalf("%s: unexpected JSON-RPC error: %+v", dn.name, resp.Error)
			}
			// For nonexistent run, isError=true is expected (tool error, not JSON-RPC error)
			result, _ := resp.Result.(map[string]any)
			if dn.name == "get_run_status" {
				if result == nil || result["isError"] != true {
					t.Errorf("%s: expected isError for nonexistent run", dn.name)
				}
			}
		})
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

func TestToolStartRunCreatesRunMessageAndStartsExecutor(t *testing.T) {
	srv, s := newTestServer(t)
	executor := &recordingRunExecutor{}
	srv.executor = executor
	workDir := testMCPWorkDir(t, srv)

	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "start_run",
		"arguments": map[string]any{
			"projectId": "proj_test",
			"threadId":  "thread_test",
			"prompt":    "Build the CI patch",
			"agentId":   "codex",
			"model":     "gpt-5",
			"workDir":   workDir,
		},
	})

	data := parseToolResult(t, rec)
	runID, ok := data["runId"].(string)
	if !ok || runID == "" {
		t.Fatalf("runId = %v, want non-empty string", data["runId"])
	}
	if data["projectId"] != "proj_test" {
		t.Fatalf("projectId = %v, want proj_test", data["projectId"])
	}
	if data["threadId"] != "thread_test" {
		t.Fatalf("threadId = %v, want thread_test", data["threadId"])
	}
	if data["status"] != "started" {
		t.Fatalf("status = %v, want started", data["status"])
	}

	if len(executor.started) != 1 {
		t.Fatalf("executor starts = %d, want 1", len(executor.started))
	}
	if executor.started[0].ID != runID {
		t.Fatalf("executor run = %q, want %q", executor.started[0].ID, runID)
	}
	ctx := executor.contexts[0]
	if ctx.Run.ID != runID {
		t.Fatalf("context run = %q, want %q", ctx.Run.ID, runID)
	}
	if ctx.Prompt != "Build the CI patch" {
		t.Fatalf("prompt = %q", ctx.Prompt)
	}
	if ctx.AgentID != "codex" {
		t.Fatalf("agentID = %q", ctx.AgentID)
	}
	if ctx.Model != "gpt-5" {
		t.Fatalf("model = %q", ctx.Model)
	}
	if ctx.WorkDir != workDir {
		t.Fatalf("workDir = %q, want %q", ctx.WorkDir, workDir)
	}
	if ctx.SessionID != "mcp_thread_test" {
		t.Fatalf("sessionID = %q, want mcp_thread_test", ctx.SessionID)
	}
	if !ctx.ContinueLast {
		t.Fatal("ContinueLast = false, want true")
	}

	run, ok := s.GetRun(runID)
	if !ok {
		t.Fatalf("run %q was not persisted", runID)
	}
	if run.Status != "queued" {
		t.Fatalf("persisted run status = %q, want queued", run.Status)
	}
	items := s.ListThreadItems("thread_test")
	if len(items) != 1 {
		t.Fatalf("thread items = %d, want 1", len(items))
	}
	if items[0].RunID != runID {
		t.Fatalf("message runID = %q, want %q", items[0].RunID, runID)
	}
	if items[0].Type != "user_message" || items[0].Role != "user" {
		t.Fatalf("message type/role = %q/%q, want user_message/user", items[0].Type, items[0].Role)
	}
	if items[0].Content != "Build the CI patch" {
		t.Fatalf("message content = %q", items[0].Content)
	}
}

func TestToolStartRunRejectsEmptyWorkDir(t *testing.T) {
	srv, s := newTestServer(t)
	srv.executor = &recordingRunExecutor{}

	cases := []struct {
		name string
		args map[string]any
	}{
		{
			name: "omitted",
			args: map[string]any{
				"projectId": "proj_test",
				"threadId":  "thread_test",
				"prompt":    "no workdir",
			},
		},
		{
			name: "empty",
			args: map[string]any{
				"projectId": "proj_test",
				"threadId":  "thread_test",
				"prompt":    "empty workdir",
				"workDir":   "",
			},
		},
		{
			name: "whitespace",
			args: map[string]any{
				"projectId": "proj_test",
				"threadId":  "thread_test",
				"prompt":    "ws workdir",
				"workDir":   "   ",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
				"name":      "agenthub_start_run",
				"arguments": tc.args,
			})
			result := assertToolError(t, rec)
			content := result["content"].([]any)[0].(map[string]any)
			text := content["text"].(string)
			if !strings.Contains(text, "workdir_required") && !strings.Contains(text, "workDir is required") {
				t.Fatalf("error text = %q, want workdir_required", text)
			}
			if runs := s.ListRuns("thread_test"); len(runs) != 0 {
				t.Fatalf("stored runs = %d, want 0", len(runs))
			}
		})
	}
}

func TestToolStartRunRejectsActiveRun(t *testing.T) {
	srv, s := newTestServer(t)
	srv.executor = &recordingRunExecutor{}
	if _, err := s.CreateRun("run_active", "proj_test", "thread_test"); err != nil {
		t.Fatalf("failed to create active run: %v", err)
	}

	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "start_run",
		"arguments": map[string]any{
			"projectId": "proj_test",
			"threadId":  "thread_test",
			"prompt":    "Should wait",
			"workDir":   testMCPWorkDir(t, srv),
		},
	})

	result := assertToolError(t, rec)
	content := result["content"].([]any)[0].(map[string]any)
	text := content["text"].(string)
	if !strings.Contains(text, "thread already has an active run") {
		t.Fatalf("error text = %q", text)
	}
}

func TestToolStartRunMarksRunFailedWhenExecutorFails(t *testing.T) {
	srv, s := newTestServer(t)
	srv.executor = &recordingRunExecutor{startErr: errors.New("executor offline")}

	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "start_run",
		"arguments": map[string]any{
			"projectId": "proj_test",
			"threadId":  "thread_test",
			"prompt":    "Start and fail",
			"workDir":   testMCPWorkDir(t, srv),
		},
	})

	assertToolError(t, rec)
	runs := s.ListRuns("thread_test")
	if len(runs) != 1 {
		t.Fatalf("runs = %d, want 1", len(runs))
	}
	if runs[0].Status != "failed" {
		t.Fatalf("run status = %q, want failed", runs[0].Status)
	}
	items := s.ListThreadItems("thread_test")
	if len(items) != 1 {
		t.Fatalf("thread items = %d, want 1", len(items))
	}
	if items[0].Content != "Start and fail" {
		t.Fatalf("message content = %q", items[0].Content)
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

func TestToolCancelRunSuccess(t *testing.T) {
	srv, _ := newTestServer(t)
	executor := &recordingRunExecutor{
		cancel: lifecycle.CancelResult{Found: true, Status: "cancelling"},
	}
	srv.executor = executor

	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "cancel_run",
		"arguments": map[string]any{
			"runId": "run_cancel",
		},
	})

	data := parseToolResult(t, rec)
	if data["runId"] != "run_cancel" {
		t.Fatalf("runId = %v, want run_cancel", data["runId"])
	}
	if data["status"] != "cancelling" {
		t.Fatalf("status = %v, want cancelling", data["status"])
	}
	if len(executor.cancels) != 1 || executor.cancels[0] != "run_cancel" {
		t.Fatalf("cancels = %#v, want [run_cancel]", executor.cancels)
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

func TestToolApproveActionSuccessPublishesDecision(t *testing.T) {
	srv, _ := newTestServer(t)
	if !srv.permissionRegistry.Register(permission.PendingPermission{
		ProjectID: "proj_test",
		ThreadID:  "thread_test",
		RunID:     "run_test",
		RequestID: "req_test",
		ToolName:  "shell",
		ToolUseID: "toolu_test",
	}) {
		t.Fatal("failed to register pending permission")
	}
	_, ch, replay := srv.bus.Subscribe(0)
	if len(replay) != 0 {
		t.Fatalf("replay events = %d, want 0", len(replay))
	}

	rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
		"name": "approve_action",
		"arguments": map[string]any{
			"runId":     "run_test",
			"requestId": "req_test",
			"decision":  "allow",
			"reason":    "trusted test command",
		},
	})

	data := parseToolResult(t, rec)
	if data["status"] != "ok" {
		t.Fatalf("status = %v, want ok", data["status"])
	}
	if data["decision"] != "allow" {
		t.Fatalf("decision = %v, want allow", data["decision"])
	}
	if data["toolName"] != "shell" {
		t.Fatalf("toolName = %v, want shell", data["toolName"])
	}
	if _, ok := srv.permissionRegistry.Consume("run_test", "req_test"); ok {
		t.Fatal("permission request was not consumed")
	}

	select {
	case evt := <-ch:
		if evt.Type != adapters.BusEventPermissionDecided {
			t.Fatalf("event type = %q, want %q", evt.Type, adapters.BusEventPermissionDecided)
		}
		if evt.Scope["projectId"] != "proj_test" {
			t.Fatalf("event projectId = %v, want proj_test", evt.Scope["projectId"])
		}
		payload, ok := evt.Payload.(map[string]any)
		if !ok {
			t.Fatalf("payload is %T, want map", evt.Payload)
		}
		if payload["decision"] != "allow" {
			t.Fatalf("payload decision = %v, want allow", payload["decision"])
		}
		if payload["reason"] != "trusted test command" {
			t.Fatalf("payload reason = %v", payload["reason"])
		}
	default:
		t.Fatal("permission decision event was not published")
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

func TestToolStartRunWorkspaceAllowlistPolicy(t *testing.T) {
	// Table tests for the shared REST/MCP workDir SSOT (AH-SR-006 residual / #998).
	// MCP must reject symlink escapes the same way REST does (EvalSymlinks + IsPathWithin).
	parent := t.TempDir()
	allowedRoot := filepath.Join(parent, "allowed")
	outsideRoot := filepath.Join(parent, "outside")
	inside := filepath.Join(allowedRoot, "project-a")
	if err := os.MkdirAll(inside, 0o755); err != nil {
		t.Fatalf("MkdirAll inside: %v", err)
	}
	if err := os.MkdirAll(outsideRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll outside: %v", err)
	}

	linkPath := filepath.Join(allowedRoot, "linked-outside")
	if err := os.Symlink(outsideRoot, linkPath); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}

	cases := []struct {
		name      string
		allowlist []string
		workDir   string
		wantCode  string
	}{
		{
			name:      "happy path child of root",
			allowlist: []string{allowedRoot},
			workDir:   inside,
			wantCode:  "",
		},
		{
			name:      "outside allowlist",
			allowlist: []string{allowedRoot},
			workDir:   outsideRoot,
			wantCode:  errcode.ErrWorkspaceNotAllowed.Code,
		},
		{
			name:      "symlink escape rejected",
			allowlist: []string{allowedRoot},
			workDir:   linkPath,
			wantCode:  errcode.ErrWorkspaceNotAllowed.Code,
		},
		{
			name:      "empty allowlist fail-closed",
			allowlist: nil,
			workDir:   inside,
			wantCode:  errcode.ErrWorkspaceAllowlistNotConfigured.Code,
		},
		{
			name:      "parent escape via .. segments",
			allowlist: []string{allowedRoot},
			workDir:   filepath.Join(allowedRoot, "..", "outside"),
			wantCode:  errcode.ErrWorkspaceNotAllowed.Code,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			srv, s := newTestServer(t)
			executor := &recordingRunExecutor{}
			srv.executor = executor
			srv.SetWorkspaceAllowlist(tc.allowlist)

			// Fresh thread per case so active-run checks do not collide.
			threadID := "thread_" + tc.name
			if _, err := s.CreateThread(threadID, "proj_test", tc.name, "", "", ""); err != nil {
				t.Fatalf("CreateThread: %v", err)
			}

			rec := doJSONRPC(t, srv, "tools/call", 1, map[string]any{
				"name": "agenthub_start_run",
				"arguments": map[string]any{
					"projectId": "proj_test",
					"threadId":  threadID,
					"prompt":    "allowlist policy " + tc.name,
					"workDir":   tc.workDir,
				},
			})

			if tc.wantCode == "" {
				data := parseToolResult(t, rec)
				if data["threadId"] != threadID {
					t.Fatalf("threadId = %v, want %s", data["threadId"], threadID)
				}
				if len(executor.started) != 1 {
					t.Fatalf("executor starts = %d, want 1", len(executor.started))
				}
				if executor.contexts[0].WorkDir != tc.workDir {
					t.Fatalf("executor workDir = %q, want %q", executor.contexts[0].WorkDir, tc.workDir)
				}
				return
			}

			result := assertToolError(t, rec)
			content := result["content"].([]any)[0].(map[string]any)
			text := content["text"].(string)
			// errcode.Error.Error() formats as "code: message".
			if !strings.Contains(text, tc.wantCode) {
				t.Fatalf("error text = %q, want code %s", text, tc.wantCode)
			}
			if len(executor.started) != 0 {
				t.Fatalf("executor starts = %d, want 0", len(executor.started))
			}
			if runs := s.ListRuns(threadID); len(runs) != 0 {
				t.Fatalf("stored runs = %d, want 0", len(runs))
			}
		})
	}
}

// Ensure lifecycle package is used (for mock executor in future tests)
var _ lifecycle.RunExecutor
