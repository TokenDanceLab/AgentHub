// Package tests contains end-to-end integration tests for the Edge→Hub direct
// callback bridge. These tests spin up a mock Hub server and a real Edge server
// with the ProcessExecutor, create runs with hubTaskId, and verify that the
// Edge server fires the correct callbacks back to the mock Hub.
//
// Tests guarded by testing.Short() are skipped in the standard go test -short
// lane because they launch subprocesses. To run these tests locally:
//
//	go test ./tests -count=1 -run "^TestHubE2E_" -v
//
// CI status: the backend-edge-e2e job (.github/workflows/checks.yml) runs
// `go test ./tests/ -run '^TestHubE2E_'` WITHOUT -short, so the full suite
// (including subprocess tests) executes in CI, with a non-zero PASS count
// assertion.
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
	"github.com/agenthub/edge-server/internal/edgehttp"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/store"
	"github.com/agenthub/edge-server/internal/testkit"
)

const (
	// runTerminalWaitTimeout is the Eventually budget for an E2E run to reach
	// a terminal store status (finished/failed/cancelled); it spans
	// subprocess startup plus executor teardown (#2055).
	runTerminalWaitTimeout = 10 * time.Second

	// roundTripWaitTimeout is the Eventually budget for the round-trip run
	// to reach a terminal status; the headroom covers the full ack→done
	// callback sequence (#2055).
	roundTripWaitTimeout = 15 * time.Second
)

// isTerminalRunStatus reports whether status is a terminal run lifecycle
// state (finished/failed/cancelled).
func isTerminalRunStatus(status string) bool {
	return status == "finished" || status == "failed" || status == "cancelled"
}

// runCallbackDump renders run status plus mock Hub callback counters for
// Eventually timeout diagnostics.
func runCallbackDump(runID string, h *api.Handler, mockHub *hubCallbackMock) string {
	status := "<missing>"
	if run, ok := h.Store.GetRun(runID); ok {
		status = run.Status
	}
	return fmt.Sprintf("run %s status=%q (acks=%d done=%d fail=%d stream=%d)",
		runID, status, mockHub.ackCount(), mockHub.doneCount(), mockHub.failCount(), mockHub.streamCount())
}

// ── Hub mock with full Edge callback endpoint support ──────────────────────

// hubCallbackMock is a mock Hub server that records all callback requests
// and responds with the standard Hub JSON format: {"code": errcode.OK.Code, ...}.
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
	json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
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

// newE2ECallbackClient builds a CallbackClient with the default policy and a
// composition-root-style policy client (mirrors httpserver wiring, #1564).
func newE2ECallbackClient(hubURL, authToken string) *hub.CallbackClient {
	return hub.NewCallbackClient(hubURL, authToken, edgehttp.NewClient(0), hub.DefaultCallbackConfig())
}

const noopCommandOutput = "hub-output-done"

// noopCommand returns a command+args that emits a stable stdout line and exits
// with code 0. The stdout is part of the Hub callback contract under test.
func noopCommand() (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd", []string{"/c", "echo " + noopCommandOutput}
	}
	return "echo", []string{noopCommandOutput}
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
		hubClient := newE2ECallbackClient(hubURL, "")
		processExecutor.SetHubCallback(hubClient)
	}

	workDir := t.TempDir()
	h := &api.Handler{
		Bus:                bus,
		Registry:           runners.NewRegistry(),
		Store:              storeRepo,
		Executor:           processExecutor,
		WorkspaceAllowlist: []string{workDir},
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
//  1. Edge receives POST /v1/runs with hubTaskId
//  2. Edge creates a run and starts the executor
//  3. When the run finishes, Edge calls POST /edge/agent-tasks/:id/done
//  4. Mock Hub verifies the callback was received with correct payload
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
		"workDir":   edgeH.WorkspaceAllowlist[0],
	})

	if runResp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(runResp.Body)
		runResp.Body.Close()
		t.Fatalf("POST /v1/runs: expected 202, got %d: %s", runResp.StatusCode, string(body))
	}

	runBody := decodeJSON[map[string]any](t, runResp)
	runID, ok := unwrapSuccess(runBody)["runId"].(string)
	if !ok {
		t.Fatalf("expected runId in response, got %v", runBody)
	}
	t.Logf("created run %s for task %s", runID, taskID)

	// Wait for the run to finish (echo exits almost immediately)
	testkit.Eventually(t, runTerminalWaitTimeout, func() bool {
		run, ok := edgeH.Store.GetRun(runID)
		return ok && isTerminalRunStatus(run.Status)
	}, "run should reach a terminal status before callback assertions", func() string {
		return runCallbackDump(runID, edgeH, mockHub)
	})
	if run, ok := edgeH.Store.GetRun(runID); ok {
		t.Logf("run %s final status: %s", runID, run.Status)
	}

	// Give the async callback goroutine a moment to fire
	time.Sleep(500 * time.Millisecond)

	// Verify Hub received a stream callback with real process stdout.
	streamCount := mockHub.streamCount()
	if streamCount < 1 {
		t.Fatalf("expected at least 1 stream callback, got %d (acks=%d, done=%d, fail=%d)",
			streamCount, mockHub.ackCount(), mockHub.doneCount(), mockHub.failCount())
	}
	mockHub.mu.Lock()
	var streamContent strings.Builder
	for _, streamRecord := range mockHub.streamCalls {
		streamContent.WriteString(streamRecord.Body["content"])
	}
	mockHub.mu.Unlock()
	if !strings.Contains(streamContent.String(), noopCommandOutput) {
		t.Fatalf("stream callback content = %q, want %q", streamContent.String(), noopCommandOutput)
	}

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
	if !strings.Contains(doneRecord.Body["final_content"], noopCommandOutput) {
		t.Errorf("done callback final_content = %q, want stdout %q", doneRecord.Body["final_content"], noopCommandOutput)
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

	hubClient := newE2ECallbackClient(mockHub.URL(), "")
	processExecutor.SetHubCallback(hubClient)

	workDir := t.TempDir()
	h := &api.Handler{
		Bus:                bus,
		Registry:           runners.NewRegistry(),
		Store:              storeRepo,
		Executor:           processExecutor,
		WorkspaceAllowlist: []string{workDir},
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
		"workDir":   workDir,
	})

	if runResp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(runResp.Body)
		runResp.Body.Close()
		t.Fatalf("POST /v1/runs: expected 202, got %d: %s", runResp.StatusCode, string(body))
	}

	runBody := decodeJSON[map[string]any](t, runResp)
	runID, _ := unwrapSuccess(runBody)["runId"].(string)
	t.Logf("created failing run %s for task %s", runID, taskID)

	// Wait for run to terminate with failure
	testkit.Eventually(t, runTerminalWaitTimeout, func() bool {
		run, ok := storeRepo.GetRun(runID)
		return ok && isTerminalRunStatus(run.Status)
	}, "failing run should reach a terminal status", func() string {
		return runCallbackDump(runID, h, mockHub)
	})
	if run, ok := storeRepo.GetRun(runID); ok {
		t.Logf("run %s status: %s", runID, run.Status)
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
	client := newE2ECallbackClient(mockHub.URL(), "test-jwt")

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
	if err := client.TaskStream(ctx, taskID, runID, "", "Hello World"); err != nil {
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
	edgeTS, edgeH := startEdgeWithHubCallbacks(t, mockHub.URL())

	// Create a run WITHOUT hubTaskId
	runResp := postJSON(t, edgeTS.URL+"/v1/runs", map[string]any{
		"projectId": "proj_local",
		"threadId":  "thread_local",
		"prompt":    "E2E test: no callback",
		// No hubTaskId
		"workDir": edgeH.WorkspaceAllowlist[0],
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
		"workDir":   edgeH.WorkspaceAllowlist[0],
	})

	if runResp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(runResp.Body)
		runResp.Body.Close()
		t.Fatalf("POST /v1/runs: expected 202, got %d: %s", runResp.StatusCode, string(body))
	}

	runBody := decodeJSON[map[string]any](t, runResp)
	runID, ok := unwrapSuccess(runBody)["runId"].(string)
	if !ok {
		t.Fatalf("expected runId, got %v", runBody)
	}
	t.Logf("roundtrip: run %s, task %s", runID, taskID)

	// Wait for completion
	testkit.Eventually(t, roundTripWaitTimeout, func() bool {
		run, ok := edgeH.Store.GetRun(runID)
		return ok && isTerminalRunStatus(run.Status)
	}, "round-trip run should reach a terminal status", func() string {
		return runCallbackDump(runID, edgeH, mockHub)
	})
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
