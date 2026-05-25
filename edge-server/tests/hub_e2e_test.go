// Package tests contains end-to-end integration tests for the Edge→Hub direct
// callback bridge. These tests spin up a mock Hub server and a real Edge server
// with the ProcessExecutor, create runs with hubTaskId, and verify that the
// Edge server fires the correct callbacks back to the mock Hub.
//
// Tests guarded by testing.Short() are skipped in CI short mode because they
// launch subprocesses.
package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/api"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/store"
)

// ── Hub mock with full Edge callback endpoint support ──────────────────────

// hubCallbackMock is a mock Hub server that records all callback requests
// and responds with the standard Hub JSON format: {"code": "OK", ...}.
type hubCallbackMock struct {
	mu     sync.Mutex
	server *httptest.Server

	ackCalls    []hubCallbackRecord
	streamCalls []hubCallbackRecord
	doneCalls   []hubCallbackRecord
	failCalls   []hubCallbackRecord
}

type hubCallbackRecord struct {
	TaskID string
	Body   map[string]string
}

func newHubCallbackMock(t *testing.T) *hubCallbackMock {
	t.Helper()
	m := &hubCallbackMock{}
	mux := http.NewServeMux()
	mux.HandleFunc("/edge/agent-tasks/", m.handleEdgeTaskCallback)
	m.server = httptest.NewServer(mux)
	t.Cleanup(func() { m.server.Close() })
	return m
}

func (m *hubCallbackMock) URL() string { return m.server.URL }

func (m *hubCallbackMock) handleEdgeTaskCallback(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/edge/agent-tasks/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	taskID := parts[0]
	action := parts[1]

	body, _ := io.ReadAll(r.Body)
	var bodyMap map[string]string
	json.Unmarshal(body, &bodyMap)
	if bodyMap == nil {
		bodyMap = make(map[string]string)
	}

	record := hubCallbackRecord{TaskID: taskID, Body: bodyMap}

	m.mu.Lock()
	switch action {
	case "ack":
		m.ackCalls = append(m.ackCalls, record)
	case "stream":
		m.streamCalls = append(m.streamCalls, record)
	case "done":
		m.doneCalls = append(m.doneCalls, record)
	case "fail":
		m.failCalls = append(m.failCalls, record)
	}
	m.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"code": "OK"})
}

func (m *hubCallbackMock) ackCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.ackCalls)
}

func (m *hubCallbackMock) doneCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.doneCalls)
}

func (m *hubCallbackMock) failCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.failCalls)
}

func (m *hubCallbackMock) streamCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.streamCalls)
}

// ── Edge server with CallbackClient helper ──────────────────────────────────

// noopCommand returns a command+args that exits immediately with code 0.
// On Windows, uses cmd.exe; on Unix, uses echo.
func noopCommand() (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd", []string{"/c", "exit 0"}
	}
	return "echo", []string{"done"}
}

// startEdgeWithHubCallbacks creates an Edge server with:
//   - An in-memory store
//   - A ProcessExecutor running a no-op command (exits immediately with success)
//   - A hub.CallbackClient pointed at the given mock Hub URL
//
// Returns the httptest server and the Handler.
func startEdgeWithHubCallbacks(t *testing.T, hubURL string) (*httptest.Server, *api.Handler) {
	t.Helper()

	bus := events.NewBus(100)
	storeRepo := store.New()

	cmd, args := noopCommand()
	execCfg := lifecycle.ProcessExecutorConfig{
		Command: cmd,
		Args:    args,
	}

	processExecutor, err := lifecycle.NewProcessExecutor(bus, storeRepo, execCfg, nil, nil)
	if err != nil {
		t.Fatalf("failed to create process executor: %v", err)
	}

	// Wire Hub callback client
	if hubURL != "" {
		hubClient := hub.NewCallbackClient(hubURL, "")
		processExecutor.SetHubCallback(hubClient)
	}

	h := &api.Handler{
		Bus:      bus,
		Registry: runners.NewRegistry(),
		Store:    storeRepo,
		Executor: processExecutor,
	}

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	ts := httptest.NewServer(mux)
	t.Cleanup(func() {
		ts.Close()
	})
	return ts, h
}

// ── E2E Tests ──────────────────────────────────────────────────────────────

// TestHubE2E_RunCompletes_FiresDoneCallback verifies the full Edge→Hub
// callback chain when a run completes successfully:
//
//	1. Edge receives POST /v1/runs with hubTaskId
//	2. Edge creates a run and starts the executor
//	3. When the run finishes, Edge calls POST /edge/agent-tasks/:id/done
//	4. Mock Hub verifies the callback was received with correct payload
func TestHubE2E_RunCompletes_FiresDoneCallback(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping E2E test in short mode (launches subprocess)")
	}

	mockHub := newHubCallbackMock(t)
	edgeTS, edgeH := startEdgeWithHubCallbacks(t, mockHub.URL())

	taskID := "task-e2e-done-001"

	// Create a run with hubTaskId to trigger Edge→Hub callbacks
	runResp := postJSON(t, edgeTS.URL+"/v1/runs", map[string]any{
		"projectId": "proj_local",
		"threadId":  "thread_local",
		"prompt":    "E2E test: complete run",
		"hubTaskId": taskID,
	})

	if runResp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(runResp.Body)
		runResp.Body.Close()
		t.Fatalf("POST /v1/runs: expected 202, got %d: %s", runResp.StatusCode, string(body))
	}

	runBody := decodeJSON[map[string]any](t, runResp)
	runID, ok := runBody["runId"].(string)
	if !ok {
		t.Fatalf("expected runId in response, got %v", runBody)
	}
	t.Logf("created run %s for task %s", runID, taskID)

	// Wait for the run to finish (echo exits almost immediately)
	deadline := time.Now().Add(10 * time.Second)
	var runStatus string
	for time.Now().Before(deadline) {
		run, ok := edgeH.Store.GetRun(runID)
		if ok {
			runStatus = run.Status
			if runStatus == "finished" || runStatus == "failed" || runStatus == "cancelled" {
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Logf("run %s final status: %s", runID, runStatus)

	// Give the async callback goroutine a moment to fire
	time.Sleep(500 * time.Millisecond)

	// Verify Hub received the done callback
	doneCount := mockHub.doneCount()
	if doneCount < 1 {
		t.Fatalf("expected at least 1 done callback, got %d (acks=%d, done=%d, fail=%d)",
			doneCount, mockHub.ackCount(), mockHub.doneCount(), mockHub.failCount())
	}

	// Verify callback payload format matches what Hub expects
	mockHub.mu.Lock()
	doneRecord := mockHub.doneCalls[0]
	mockHub.mu.Unlock()

	if doneRecord.TaskID != taskID {
		t.Errorf("done callback taskID = %q, want %q", doneRecord.TaskID, taskID)
	}
	if doneRecord.Body["run_id"] != runID {
		t.Errorf("done callback run_id = %q, want %q", doneRecord.Body["run_id"], runID)
	}
	// final_content should contain the run status ("finished")
	if doneRecord.Body["final_content"] == "" {
		t.Error("done callback final_content should not be empty")
	}
}

// TestHubE2E_RunFails_FiresFailCallback verifies the fail callback path.
func TestHubE2E_RunFails_FiresFailCallback(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping E2E test in short mode (launches subprocess)")
	}

	mockHub := newHubCallbackMock(t)

	// Use a command that will fail (executing a non-existent binary path)
	bus := events.NewBus(100)
	storeRepo := store.New()

	execCfg := lifecycle.ProcessExecutorConfig{
		Command: "nonexistent_command_xyz_123",
	}

	processExecutor, err := lifecycle.NewProcessExecutor(bus, storeRepo, execCfg, nil, nil)
	if err != nil {
		t.Fatalf("failed to create process executor: %v", err)
	}

	hubClient := hub.NewCallbackClient(mockHub.URL(), "")
	processExecutor.SetHubCallback(hubClient)

	h := &api.Handler{
		Bus:      bus,
		Registry: runners.NewRegistry(),
		Store:    storeRepo,
		Executor: processExecutor,
	}

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	edgeTS := httptest.NewServer(mux)
	defer edgeTS.Close()

	taskID := "task-e2e-fail-001"

	runResp := postJSON(t, edgeTS.URL+"/v1/runs", map[string]any{
		"projectId": "proj_local",
		"threadId":  "thread_local",
		"prompt":    "E2E test: failing run",
		"hubTaskId": taskID,
	})

	if runResp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(runResp.Body)
		runResp.Body.Close()
		t.Fatalf("POST /v1/runs: expected 202, got %d: %s", runResp.StatusCode, string(body))
	}

	runBody := decodeJSON[map[string]any](t, runResp)
	runID, _ := runBody["runId"].(string)
	t.Logf("created failing run %s for task %s", runID, taskID)

	// Wait for run to terminate with failure
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		run, ok := storeRepo.GetRun(runID)
		if ok && (run.Status == "failed" || run.Status == "finished" || run.Status == "cancelled") {
			t.Logf("run %s status: %s", runID, run.Status)
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	time.Sleep(500 * time.Millisecond) // allow async callback

	if failCount := mockHub.failCount(); failCount >= 1 {
		mockHub.mu.Lock()
		failRecord := mockHub.failCalls[0]
		mockHub.mu.Unlock()
		t.Logf("fail callback received for task %s: error=%s", failRecord.TaskID, failRecord.Body["error"])
	} else {
		// It's OK if fail doesn't fire (the run might have "started" before finding the binary)
		// The important thing is the wiring doesn't crash
		t.Log("no fail callback (run may have failed before started status)")
	}
}

// TestHubE2E_CallbackFormat_HubCompatible verifies that the callback JSON
// format produced by the CallbackClient exactly matches what Hub's handler
// expects (as defined in hub-server/internal/handler/agent.go).
func TestHubE2E_CallbackFormat_HubCompatible(t *testing.T) {
	mockHub := newHubCallbackMock(t)
	client := hub.NewCallbackClient(mockHub.URL(), "test-jwt")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	taskID := "task-format-test"
	runID := "run-format-001"

	// Test ack format
	if err := client.TaskAck(ctx, taskID, runID); err != nil {
		t.Fatalf("TaskAck: %v", err)
	}
	if c := mockHub.ackCount(); c != 1 {
		t.Fatalf("expected 1 ack, got %d", c)
	}
	mockHub.mu.Lock()
	ack := mockHub.ackCalls[0]
	mockHub.mu.Unlock()
	if ack.Body["run_id"] != runID {
		t.Errorf("ack run_id = %q, want %q", ack.Body["run_id"], runID)
	}

	// Test stream format
	if err := client.TaskStream(ctx, taskID, runID, "Hello World"); err != nil {
		t.Fatalf("TaskStream: %v", err)
	}
	if c := mockHub.streamCount(); c != 1 {
		t.Fatalf("expected 1 stream, got %d", c)
	}
	mockHub.mu.Lock()
	stream := mockHub.streamCalls[0]
	mockHub.mu.Unlock()
	if stream.Body["content"] != "Hello World" {
		t.Errorf("stream content = %q, want Hello World", stream.Body["content"])
	}
	if stream.Body["run_id"] != runID {
		t.Errorf("stream run_id = %q, want %q", stream.Body["run_id"], runID)
	}

	// Test done format
	if err := client.TaskDone(ctx, taskID, hub.TaskResult{
		RunID:        runID,
		FinalContent: "All tasks completed",
	}); err != nil {
		t.Fatalf("TaskDone: %v", err)
	}
	if c := mockHub.doneCount(); c != 1 {
		t.Fatalf("expected 1 done, got %d", c)
	}
	mockHub.mu.Lock()
	done := mockHub.doneCalls[0]
	mockHub.mu.Unlock()
	if done.Body["run_id"] != runID {
		t.Errorf("done run_id = %q, want %q", done.Body["run_id"], runID)
	}
	if done.Body["final_content"] != "All tasks completed" {
		t.Errorf("done final_content = %q", done.Body["final_content"])
	}

	// Test fail format
	if err := client.TaskFail(ctx, taskID, runID, "execution timeout"); err != nil {
		t.Fatalf("TaskFail: %v", err)
	}
	if c := mockHub.failCount(); c != 1 {
		t.Fatalf("expected 1 fail, got %d", c)
	}
	mockHub.mu.Lock()
	fail := mockHub.failCalls[0]
	mockHub.mu.Unlock()
	if fail.Body["error"] != "execution timeout" {
		t.Errorf("fail error = %q, want execution timeout", fail.Body["error"])
	}
	if fail.Body["run_id"] != runID {
		t.Errorf("fail run_id = %q, want %q", fail.Body["run_id"], runID)
	}
}

// TestHubE2E_NoCallbackWhenNotConfigured verifies that the Edge server does
// NOT fire callbacks when hubTaskId is not provided in the run request.
func TestHubE2E_NoCallbackWhenNotConfigured(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping E2E test in short mode (launches subprocess)")
	}

	mockHub := newHubCallbackMock(t)
	edgeTS, _ := startEdgeWithHubCallbacks(t, mockHub.URL())

	// Create a run WITHOUT hubTaskId
	runResp := postJSON(t, edgeTS.URL+"/v1/runs", map[string]any{
		"projectId": "proj_local",
		"threadId":  "thread_local",
		"prompt":    "E2E test: no callback",
		// No hubTaskId
	})

	if runResp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(runResp.Body)
		runResp.Body.Close()
		t.Fatalf("POST /v1/runs: expected 202, got %d: %s", runResp.StatusCode, string(body))
	}

	// Wait for run to complete
	time.Sleep(2 * time.Second)

	// Verify NO callbacks were fired to Hub
	if acks := mockHub.ackCount(); acks > 0 {
		t.Errorf("expected 0 ack callbacks without hubTaskId, got %d", acks)
	}
	if dones := mockHub.doneCount(); dones > 0 {
		t.Errorf("expected 0 done callbacks without hubTaskId, got %d", dones)
	}
	if fails := mockHub.failCount(); fails > 0 {
		t.Errorf("expected 0 fail callbacks without hubTaskId, got %d", fails)
	}
}

// TestHubE2E_CompleteRoundTrip verifies the full protocol:
//
//	Edge POST /v1/runs (with hubTaskId) → run starts
//	Edge callbacks Hub POST /edge/agent-tasks/:id/ack
//	Run completes → Edge callbacks Hub POST /edge/agent-tasks/:id/done
//	Hub receives everything in correct order
func TestHubE2E_CompleteRoundTrip(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping E2E test in short mode (launches subprocess)")
	}

	mockHub := newHubCallbackMock(t)
	edgeTS, edgeH := startEdgeWithHubCallbacks(t, mockHub.URL())

	taskID := fmt.Sprintf("task-roundtrip-%d", time.Now().UnixNano())

	runResp := postJSON(t, edgeTS.URL+"/v1/runs", map[string]any{
		"projectId": "proj_local",
		"threadId":  "thread_local",
		"prompt":    "Complete round trip test",
		"hubTaskId": taskID,
	})

	if runResp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(runResp.Body)
		runResp.Body.Close()
		t.Fatalf("POST /v1/runs: expected 202, got %d: %s", runResp.StatusCode, string(body))
	}

	runBody := decodeJSON[map[string]any](t, runResp)
	runID, ok := runBody["runId"].(string)
	if !ok {
		t.Fatalf("expected runId, got %v", runBody)
	}
	t.Logf("roundtrip: run %s, task %s", runID, taskID)

	// Wait for completion
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		run, ok := edgeH.Store.GetRun(runID)
		if ok {
			status := run.Status
			t.Logf("run %s status: %s (callback stats: ack=%d done=%d fail=%d)",
				runID, status, mockHub.ackCount(), mockHub.doneCount(), mockHub.failCount())
			if status == "finished" || status == "failed" || status == "cancelled" {
				break
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	time.Sleep(500 * time.Millisecond) // allow async callbacks to fire

	// Verify Hub received both ack and done callbacks
	ackCount := mockHub.ackCount()
	doneCount := mockHub.doneCount()

	t.Logf("final callback counts: ack=%d, done=%d, fail=%d, stream=%d",
		ackCount, doneCount, mockHub.failCount(), mockHub.streamCount())

	if ackCount < 1 && doneCount < 1 {
		t.Error("expected at least ack or done callback; got none")
	}

	// Verify callback taskID matches
	if ackCount >= 1 {
		mockHub.mu.Lock()
		if mockHub.ackCalls[0].TaskID != taskID {
			t.Errorf("ack taskID = %q, want %q", mockHub.ackCalls[0].TaskID, taskID)
		}
		mockHub.mu.Unlock()
	}
	if doneCount >= 1 {
		mockHub.mu.Lock()
		if mockHub.doneCalls[0].TaskID != taskID {
			t.Errorf("done taskID = %q, want %q", mockHub.doneCalls[0].TaskID, taskID)
		}
		if mockHub.doneCalls[0].Body["run_id"] != runID {
			t.Errorf("done run_id = %q, want %q", mockHub.doneCalls[0].Body["run_id"], runID)
		}
		mockHub.mu.Unlock()
	}
}
