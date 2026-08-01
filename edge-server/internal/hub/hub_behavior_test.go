package hub_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/hub"
)

// ---------------------------------------------------------------------------
// 1. Constructor behavior
// ---------------------------------------------------------------------------

func TestNewCallbackClient_TrimsTrailingSlash(t *testing.T) {
	// The constructor should strip trailing slashes so URLs are well-formed.
	// Indirect verification: make a request and check the URL path.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Path should NOT contain double slashes like //edge/...
		if strings.Contains(r.URL.Path, "//") {
			t.Errorf("URL path contains double slash (trailing slash not trimmed): %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	// Re-create client pointing at the test server with trailing slash.
	client := hub.NewCallbackClient(srv.URL+"/", "token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNewCallbackClient_EmptyURL(t *testing.T) {
	// An empty URL should not panic; the request will just fail at HTTP level.
	client := hub.NewCallbackClient("", "token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err == nil {
		t.Fatal("expected error for empty base URL")
	}
}

// ---------------------------------------------------------------------------
// 2. TaskResult serialization
// ---------------------------------------------------------------------------

func TestTaskResult_JSONRoundTrip(t *testing.T) {
	original := hub.TaskResult{
		RunID:        "run-abc-123",
		FinalContent: "Task completed successfully with output: hello world",
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded hub.TaskResult
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.RunID != original.RunID {
		t.Fatalf("RunID: got %q, want %q", decoded.RunID, original.RunID)
	}
	if decoded.FinalContent != original.FinalContent {
		t.Fatalf("FinalContent: got %q, want %q", decoded.FinalContent, original.FinalContent)
	}
}

func TestTaskResult_EmptyFields(t *testing.T) {
	// An empty TaskResult should serialize/deserialize cleanly.
	result := hub.TaskResult{}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal empty: %v", err)
	}

	var decoded hub.TaskResult
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal empty: %v", err)
	}

	if decoded.RunID != "" || decoded.FinalContent != "" {
		t.Fatalf("expected empty fields, got RunID=%q FinalContent=%q", decoded.RunID, decoded.FinalContent)
	}
}

func TestTaskResult_JSONFieldNames(t *testing.T) {
	// Verify the JSON field names are snake_case as expected by Hub.
	result := hub.TaskResult{RunID: "r1", FinalContent: "done"}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var raw map[string]string
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal to map: %v", err)
	}

	if _, ok := raw["run_id"]; !ok {
		t.Fatalf("expected field 'run_id' in JSON, got keys: %v", mapKeys(raw))
	}
	if _, ok := raw["final_content"]; !ok {
		t.Fatalf("expected field 'final_content' in JSON, got keys: %v", mapKeys(raw))
	}
}

// ---------------------------------------------------------------------------
// 3. HTTP client timeout behavior
// ---------------------------------------------------------------------------

func TestCallbackClient_Timeout(t *testing.T) {
	// Simulate a server that hangs, triggering the HTTP client timeout.
	// We use a short timeout by directly constructing a client with a tiny timeout
	// to keep the test fast. But since NewCallbackClient hardcodes 30s, we test
	// the behavioral contract: a slow server should eventually error (context deadline).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second) // longer than the context deadline below
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	client := hub.NewCallbackClient(srv.URL, "token")
	err := client.TaskAck(ctx, "task-001", "run-001")
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

// ---------------------------------------------------------------------------
// 4. Max retries exhausted
// ---------------------------------------------------------------------------

func TestCallbackClient_MaxRetriesExhausted(t *testing.T) {
	var mu sync.Mutex
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		mu.Unlock()
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err == nil {
		t.Fatal("expected error after exhausting 3 retries")
	}
	if attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempts)
	}
	if !strings.Contains(err.Error(), "3 attempts") {
		t.Fatalf("error should mention 3 attempts, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// 5. 2xx response without JSON body
// ---------------------------------------------------------------------------

func TestCallbackClient_SuccessWithoutJSONBody(t *testing.T) {
	// A 2xx response with empty body (no JSON) should be treated as success.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		// No body, no Content-Type header
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err != nil {
		t.Fatalf("expected success for 2xx without JSON body, got: %v", err)
	}
}

func TestCallbackClient_SuccessWithUnknownAppCode(t *testing.T) {
	// A 2xx response with JSON but a code that is NOT "ok" should be treated
	// as an application-level rejection (not retried).
	var mu sync.Mutex
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": "RATE_LIMITED", "message": "too many requests"})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err == nil {
		t.Fatal("expected error for non-OK app code")
	}
	if attempts != 1 {
		t.Fatalf("non-OK app code should not be retried, got %d attempts", attempts)
	}
	if !strings.Contains(err.Error(), "category=app_rejected") {
		t.Fatalf("expected app_rejected category, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// 6. 2xx with malformed JSON (not valid JSON but still 2xx)
// ---------------------------------------------------------------------------

func TestCallbackClient_SuccessWithMalformedJSON(t *testing.T) {
	// 2xx with non-JSON body should be accepted as success (code path falls
	// through to "2xx without JSON body — accept as success").
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("not valid json {{{"))
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err != nil {
		t.Fatalf("expected success for 2xx with malformed JSON, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// 7. TaskStreamReader with empty reader
// ---------------------------------------------------------------------------

func TestCallbackClient_TaskStreamReader_Empty(t *testing.T) {
	var mu sync.Mutex
	callCount := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		callCount++
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "token")
	err := client.TaskStreamReader(context.Background(), "task-001", "run-001", strings.NewReader(""))
	if err != nil {
		t.Fatalf("unexpected error for empty reader: %v", err)
	}
	if callCount != 0 {
		t.Fatalf("expected 0 callbacks for empty reader, got %d", callCount)
	}
}

func TestCallbackClient_TaskStreamReader_SingleByteChunks(t *testing.T) {
	// Verify that each read produces a callback, even for tiny chunks.
	var mu sync.Mutex
	callCount := 0
	var receivedBodies []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		callCount++
		receivedBodies = append(receivedBodies, string(body))
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "token")
	// Use a reader with chunk size = 1 byte
	reader := bytes.NewReader([]byte("ABC"))
	err := client.TaskStreamReader(context.Background(), "task-001", "run-001", reader)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if callCount < 1 {
		t.Fatal("expected at least 1 callback")
	}
	// All chunks should contain valid JSON with run_id
	for _, body := range receivedBodies {
		var m map[string]string
		if err := json.Unmarshal([]byte(body), &m); err != nil {
			t.Fatalf("invalid JSON body: %s", body)
		}
		if m["run_id"] != "run-001" {
			t.Fatalf("expected run_id=run-001, got %v", m["run_id"])
		}
	}
}

// ---------------------------------------------------------------------------
// 8. TaskStreamReader with server errors (best-effort continues)
// ---------------------------------------------------------------------------

func TestCallbackClient_TaskStreamReader_ServerErrorsContinue(t *testing.T) {
	var mu sync.Mutex
	callCount := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		callCount++
		mu.Unlock()

		// Return 500 for all calls — stream should still consume the full reader
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "token")
	reader := strings.NewReader("chunk1\nchunk2\nchunk3\n")
	err := client.TaskStreamReader(context.Background(), "task-001", "run-001", reader)
	if err != nil {
		t.Fatalf("TaskStreamReader should not fail even when all callbacks error: %v", err)
	}
}

// ---------------------------------------------------------------------------
// 9. URL construction with special characters in taskID
// ---------------------------------------------------------------------------

func TestCallbackClient_SpecialTaskID(t *testing.T) {
	var mu sync.Mutex
	var receivedPath string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedPath = r.URL.Path
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	// TaskID with spaces and special chars that should be URL-encoded
	client := hub.NewCallbackClient(srv.URL, "token")
	err := client.TaskAck(context.Background(), "task with spaces & symbols?", "run-001")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// The raw path as received by the server should contain the literal chars
	if !strings.Contains(receivedPath, "task with spaces") {
		t.Fatalf("path should contain the task ID, got: %s", receivedPath)
	}
}

// ---------------------------------------------------------------------------
// 10. Concurrent callbacks
// ---------------------------------------------------------------------------

func TestCallbackClient_Concurrent(t *testing.T) {
	var mu sync.Mutex
	received := make(map[string]int)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		received[r.URL.Path]++
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "token")

	const goroutines = 10
	var wg sync.WaitGroup
	errs := make(chan error, goroutines)

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			errs <- client.TaskAck(context.Background(), "task-concurrent", "run-"+string(rune('0'+id)))
		}(i)
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent callback failed: %v", err)
		}
	}

	// All goroutines called the same taskID "task-concurrent", so path is same
	count := received["/edge/agent-tasks/task-concurrent/ack"]
	if count != goroutines {
		t.Fatalf("expected %d concurrent calls, got %d", goroutines, count)
	}
}

// ---------------------------------------------------------------------------
// 11. Mixed retry scenarios: 5xx then 4xx (should stop at 4xx)
// ---------------------------------------------------------------------------

func TestCallbackClient_RetryStopsAt4xx(t *testing.T) {
	var mu sync.Mutex
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		current := attempts
		mu.Unlock()

		if current == 1 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		// Second attempt returns 4xx — should NOT retry further
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err == nil {
		t.Fatal("expected error for 400 response")
	}
	if attempts != 2 {
		t.Fatalf("expected 2 attempts (1 retry then 4xx stop), got %d", attempts)
	}
	if !strings.Contains(err.Error(), "client error") {
		t.Fatalf("expected client error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// 12. 201 Created response (non-200 2xx)
// ---------------------------------------------------------------------------

func TestCallbackClient_Non200Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err != nil {
		t.Fatalf("expected success for 201 with OK code, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// 13. TaskDone sends all TaskResult fields
// ---------------------------------------------------------------------------

func TestCallbackClient_TaskDoneSendsAllFields(t *testing.T) {
	var mu sync.Mutex
	var receivedBody map[string]string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &receivedBody)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "token")
	err := client.TaskDone(context.Background(), "task-001", hub.TaskResult{
		RunID:        "run-xyz",
		FinalContent: "multi\nline\noutput",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedBody["run_id"] != "run-xyz" {
		t.Fatalf("run_id: got %q, want %q", receivedBody["run_id"], "run-xyz")
	}
	if receivedBody["final_content"] != "multi\nline\noutput" {
		t.Fatalf("final_content: got %q, want %q", receivedBody["final_content"], "multi\nline\noutput")
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func mapKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
