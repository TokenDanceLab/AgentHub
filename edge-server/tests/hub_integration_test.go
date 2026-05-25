package tests

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/agenthub/edge-server/internal/api"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/store"
)

// ── Mock Hub server ────────────────────────────────────────────────────────

// mockHub is a test double for the Hub server that captures Edge's callback
// requests (device registration, task stream, task done/fail).
type mockHub struct {
	mu      sync.Mutex
	server  *httptest.Server

	// Captured requests.
	registerReqs []capturedRegisterReq
	streamChunks map[string][]string // taskID -> chunks
	doneTasks    map[string]string   // taskID -> finalContent
	failTasks    map[string]string   // taskID -> errorMessage
}

type capturedRegisterReq struct {
	DeviceID     string   `json:"device_id"`
	AppVersion   string   `json:"app_version"`
	Capabilities []string `json:"capabilities"`
}

func newMockHub(t *testing.T) *mockHub {
	t.Helper()
	mh := &mockHub{
		streamChunks: make(map[string][]string),
		doneTasks:    make(map[string]string),
		failTasks:    make(map[string]string),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/edge/devices/register", mh.handleRegister)
	mux.HandleFunc("/edge/agent-tasks/", mh.handleTaskCallbacks)
	mh.server = httptest.NewServer(mux)
	t.Cleanup(func() { mh.server.Close() })
	return mh
}

func (mh *mockHub) URL() string { return mh.server.URL }

func (mh *mockHub) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req capturedRegisterReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	mh.mu.Lock()
	mh.registerReqs = append(mh.registerReqs, req)
	mh.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"code": "OK",
		"data": map[string]string{"id": req.DeviceID, "status": "registered"},
	})
}

func (mh *mockHub) handleTaskCallbacks(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/edge/agent-tasks/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	taskID := parts[0]
	action := parts[1]

	switch action {
	case "stream":
		var req struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mh.mu.Lock()
		mh.streamChunks[taskID] = append(mh.streamChunks[taskID], req.Content)
		mh.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"code": "OK"})

	case "done":
		var req struct {
			FinalContent string `json:"final_content"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		mh.mu.Lock()
		mh.doneTasks[taskID] = req.FinalContent
		mh.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"code": "OK"})

	case "fail":
		var req struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		mh.mu.Lock()
		mh.failTasks[taskID] = req.Error
		mh.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"code": "OK"})

	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func (mh *mockHub) registrationCount() int {
	mh.mu.Lock()
	defer mh.mu.Unlock()
	return len(mh.registerReqs)
}

func (mh *mockHub) chunksForTask(taskID string) []string {
	mh.mu.Lock()
	defer mh.mu.Unlock()
	return mh.streamChunks[taskID]
}

func (mh *mockHub) doneContent(taskID string) string {
	mh.mu.Lock()
	defer mh.mu.Unlock()
	return mh.doneTasks[taskID]
}

func (mh *mockHub) failError(taskID string) string {
	mh.mu.Lock()
	defer mh.mu.Unlock()
	return mh.failTasks[taskID]
}

// ── Edge server helper ─────────────────────────────────────────────────────

// startEdgeServer creates an edge server backed by an in-memory store,
// registers routes, and returns a *httptest.Server plus the Handler for
// verification.
func startEdgeServer(t *testing.T) (*httptest.Server, *api.Handler) {
	t.Helper()
	h := &api.Handler{
		Bus:      events.NewBus(100),
		Registry: runners.NewRegistry(),
		Store:    store.New(),
	}
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(func() { ts.Close() })
	return ts, h
}

// postJSON is a helper to make JSON POST requests.
func postJSON(t *testing.T, url string, body any) *http.Response {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		r = strings.NewReader(string(b))
	}
	req, err := http.NewRequest(http.MethodPost, url, r)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	return resp
}

// getJSON is a helper to make JSON GET requests.
func getJSON(t *testing.T, url string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	return resp
}

func decodeJSON[T any](t *testing.T, resp *http.Response) T {
	t.Helper()
	defer resp.Body.Close()
	var v T
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return v
}

// ── Tests ──────────────────────────────────────────────────────────────────

// TestEdgeRegistersWithHub verifies that Edge can register a device with Hub
// via the REST callback endpoint. A mock Hub captures the registration request.
func TestEdgeRegistersWithHub(t *testing.T) {
	mockHub := newMockHub(t)

	// Simulate Edge Desktop sending a registration request to Hub.
	reqBody := map[string]any{
		"device_id":    "edge-win-001",
		"app_version":  "1.5.0",
		"capabilities": []string{"codex", "claude-code", "opencode"},
	}
	resp := postJSON(t, mockHub.URL()+"/edge/devices/register", reqBody)

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	if mockHub.registrationCount() != 1 {
		t.Fatalf("expected 1 registration, got %d", mockHub.registrationCount())
	}

	// Verify the registration request body matches expectations.
	mockHub.mu.Lock()
	reg := mockHub.registerReqs[0]
	mockHub.mu.Unlock()
	if reg.DeviceID != "edge-win-001" {
		t.Errorf("device_id = %q, want edge-win-001", reg.DeviceID)
	}
	if reg.AppVersion != "1.5.0" {
		t.Errorf("app_version = %q, want 1.5.0", reg.AppVersion)
	}
	if len(reg.Capabilities) != 3 {
		t.Errorf("capabilities len = %d, want 3", len(reg.Capabilities))
	}
}

// TestEdgeRegistersWithHubMultiple verifies multiple devices can register.
func TestEdgeRegistersWithHubMultiple(t *testing.T) {
	mockHub := newMockHub(t)

	devices := []map[string]any{
		{"device_id": "edge-mac-001", "app_version": "1.5.0", "capabilities": []string{"codex"}},
		{"device_id": "edge-linux-001", "app_version": "1.5.1", "capabilities": []string{"claude-code"}},
	}

	for _, dev := range devices {
		resp := postJSON(t, mockHub.URL()+"/edge/devices/register", dev)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}
	}

	if mockHub.registrationCount() != 2 {
		t.Fatalf("expected 2 registrations, got %d", mockHub.registrationCount())
	}
}

// TestEdgeReceivesDispatchFromHub verifies that when Hub dispatches a task
// (simulated via Edge's local REST API), Edge creates a run. In the real
// system, Desktop forwards the Hub WebSocket dispatch to Edge's local API.
func TestEdgeReceivesDispatchFromHub(t *testing.T) {
	ts, h := startEdgeServer(t)

	// Simulate Hub dispatch arriving at Edge: Desktop calls POST /v1/runs
	// with the task parameters extracted from the agent.dispatch frame.
	dispatchBody := map[string]any{
		"projectId": "proj_local",
		"threadId":  "thread_local",
		"prompt":    "Please review this PR for security issues.",
		"agentId":   "codex",
		"model":     "claude-sonnet-4-5",
	}
	resp := postJSON(t, ts.URL+"/v1/runs", dispatchBody)
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", resp.StatusCode)
	}

	runResp := decodeJSON[map[string]any](t, resp)
	runID, ok := runResp["runId"].(string)
	if !ok || !strings.HasPrefix(runID, "run_") {
		t.Fatalf("expected runId with run_ prefix, got %v", runResp["runId"])
	}

	// Verify run exists in Edge store.
	run, ok := h.Store.GetRun(runID)
	if !ok {
		t.Fatalf("run %q not found in store after dispatch", runID)
	}
	if run.Status != "queued" {
		t.Errorf("run status = %q, want queued", run.Status)
	}
	if run.ProjectID != "proj_local" {
		t.Errorf("run projectId = %q, want proj_local", run.ProjectID)
	}

	// Verify run appears in Edge's GET /v1/runs endpoint.
	getResp := getJSON(t, ts.URL+"/v1/runs?threadId=thread_local")
	runsBody := decodeJSON[map[string]any](t, getResp)
	items, _ := runsBody["items"].([]any)
	found := false
	for _, item := range items {
		m, _ := item.(map[string]any)
		if m["runId"] == runID {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("run not found in GET /v1/runs response")
	}
}

// TestEdgeStreamsBackToHub verifies that Edge sends stream chunks and done
// callbacks to Hub's REST endpoints in the expected format.
func TestEdgeStreamsBackToHub(t *testing.T) {
	mockHub := newMockHub(t)
	taskID := "task-stream-test"

	// Simulate Edge streaming output chunks to Hub.
	chunks := []string{"Initializing...\n", "Processing step 1/3...\n", "Processing step 2/3...\n",
		"Processing step 3/3...\n", "Build successful!\n"}
	for _, chunk := range chunks {
		url := fmt.Sprintf("%s/edge/agent-tasks/%s/stream", mockHub.URL(), taskID)
		resp := postJSON(t, url, map[string]any{"content": chunk})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("stream chunk: expected 200, got %d", resp.StatusCode)
		}
	}

	// Verify all chunks captured by mock Hub.
	captured := mockHub.chunksForTask(taskID)
	if len(captured) != len(chunks) {
		t.Fatalf("expected %d chunks, got %d", len(chunks), len(captured))
	}
	for i, expected := range chunks {
		if captured[i] != expected {
			t.Errorf("chunk[%d] = %q, want %q", i, captured[i], expected)
		}
	}

	// Simulate Edge marking task as done.
	doneURL := fmt.Sprintf("%s/edge/agent-tasks/%s/done", mockHub.URL(), taskID)
	resp := postJSON(t, doneURL, map[string]any{"final_content": "Build successful! All tests pass."})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("done: expected 200, got %d", resp.StatusCode)
	}

	if content := mockHub.doneContent(taskID); content != "Build successful! All tests pass." {
		t.Errorf("done final_content = %q", content)
	}
}

// TestEdgeReportsFailToHub verifies that Edge reports task failures to Hub
// with error details.
func TestEdgeReportsFailToHub(t *testing.T) {
	mockHub := newMockHub(t)
	taskID := "task-fail-test"

	// 1. Stream partial output before failure.
	streamURL := fmt.Sprintf("%s/edge/agent-tasks/%s/stream", mockHub.URL(), taskID)
	resp := postJSON(t, streamURL, map[string]any{"content": "Starting build..."})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stream: expected 200, got %d", resp.StatusCode)
	}

	// 2. Report failure.
	failURL := fmt.Sprintf("%s/edge/agent-tasks/%s/fail", mockHub.URL(), taskID)
	resp = postJSON(t, failURL, map[string]any{"error": "build failed: cannot find module 'express'"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("fail: expected 200, got %d", resp.StatusCode)
	}

	// Verify error captured.
	if errMsg := mockHub.failError(taskID); errMsg != "build failed: cannot find module 'express'" {
		t.Errorf("fail error = %q", errMsg)
	}

	// Verify stream chunk still recorded.
	if chunks := mockHub.chunksForTask(taskID); len(chunks) != 1 {
		t.Errorf("expected 1 stream chunk before fail, got %d", len(chunks))
	}
}

// TestEdgeFullProtocolRoundTrip simulates a complete Edge-Hub protocol
// flow: device registration -> Hub dispatch -> Edge streaming results -> done.
func TestEdgeFullProtocolRoundTrip(t *testing.T) {
	mockHub := newMockHub(t)
	edgeTS, edgeH := startEdgeServer(t)

	// Phase 1: Edge registers device with Hub.
	resp := postJSON(t, mockHub.URL()+"/edge/devices/register", map[string]any{
		"device_id":    "edge-e2e-001",
		"app_version":  "2.0.0",
		"capabilities": []string{"codex", "claude-code"},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("phase 1 register: expected 200, got %d", resp.StatusCode)
	}

	// Phase 2: Hub dispatches a task (Desktop forwards to Edge).
	dispatchResp := postJSON(t, edgeTS.URL+"/v1/runs", map[string]any{
		"projectId": "proj_local",
		"threadId":  "thread_local",
		"prompt":    "Analyze src/ for security vulnerabilities.",
		"agentId":   "codex",
	})
	if dispatchResp.StatusCode != http.StatusAccepted {
		t.Fatalf("phase 2 dispatch: expected 202, got %d", dispatchResp.StatusCode)
	}
	runResp := decodeJSON[map[string]any](t, dispatchResp)
	runID := runResp["runId"].(string)

	// Phase 3: Edge streams results back to Hub (via Desktop).
	taskID := "task-" + runID
	for _, chunk := range []string{"Scanning files...\n", "No vulnerabilities found.\n"} {
		url := fmt.Sprintf("%s/edge/agent-tasks/%s/stream", mockHub.URL(), taskID)
		resp := postJSON(t, url, map[string]any{"content": chunk})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("phase 3 stream: expected 200, got %d", resp.StatusCode)
		}
	}

	// Phase 4: Edge marks task done.
	url := fmt.Sprintf("%s/edge/agent-tasks/%s/done", mockHub.URL(), taskID)
	resp = postJSON(t, url, map[string]any{"final_content": "Security scan complete. 0 issues found."})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("phase 4 done: expected 200, got %d", resp.StatusCode)
	}

	// Verify complete protocol: run exists in Edge store.
	run, ok := edgeH.Store.GetRun(runID)
	if !ok {
		t.Fatalf("run %q not found in edge store", runID)
	}
	if run.Status != "queued" {
		t.Errorf("run status = %q, want queued", run.Status)
	}

	// Verify Hub captured all results.
	if chunks := mockHub.chunksForTask(taskID); len(chunks) != 2 {
		t.Errorf("expected 2 chunks on hub, got %d", len(chunks))
	}
	if content := mockHub.doneContent(taskID); content != "Security scan complete. 0 issues found." {
		t.Errorf("done content = %q", content)
	}
}
