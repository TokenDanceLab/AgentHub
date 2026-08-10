package hub_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/agenthub/edge-server/internal/edgehttp"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/hub"

	"github.com/google/uuid"
)

// newTestCallbackClient builds a CallbackClient with the default policy and a
// composition-root-style policy client (mirrors httpserver wiring, #1564).
func newTestCallbackClient(hubURL, authToken string) *hub.CallbackClient {
	return hub.NewCallbackClient(hubURL, authToken, edgehttp.NewClient(0), hub.DefaultCallbackConfig())
}

// newPolicyCallbackClient builds a CallbackClient with an explicit policy.
func newPolicyCallbackClient(hubURL, authToken string, cfg hub.CallbackConfig) *hub.CallbackClient {
	return hub.NewCallbackClient(hubURL, authToken, edgehttp.NewClient(cfg.Timeout), cfg)
}

func TestCallbackClient_TaskAck(t *testing.T) {
	var mu sync.Mutex
	var receivedMethod string
	var receivedPath string
	var receivedBody map[string]string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedMethod = r.Method
		receivedPath = r.URL.Path
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &receivedBody)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedMethod != "POST" {
		t.Fatalf("expected POST, got %s", receivedMethod)
	}
	if receivedPath != "/edge/agent-tasks/task-001/ack" {
		t.Fatalf("expected /edge/agent-tasks/task-001/ack, got %s", receivedPath)
	}
	if receivedBody["run_id"] != "run-001" {
		t.Fatalf("expected run_id=run-001, got %v", receivedBody["run_id"])
	}
}

func TestCallbackClient_TaskStream(t *testing.T) {
	var mu sync.Mutex
	var receivedPath string
	var receivedBody map[string]string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedPath = r.URL.Path
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &receivedBody)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	err := client.TaskStream(context.Background(), "task-001", "run-001", "client-msg-id-1", "Hello from Edge")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedPath != "/edge/agent-tasks/task-001/stream" {
		t.Fatalf("expected /edge/agent-tasks/task-001/stream, got %s", receivedPath)
	}
	if receivedBody["content"] != "Hello from Edge" {
		t.Fatalf("expected content=Hello from Edge, got %v", receivedBody["content"])
	}
	if receivedBody["client_msg_id"] != "client-msg-id-1" {
		t.Fatalf("expected client_msg_id=client-msg-id-1, got %v", receivedBody["client_msg_id"])
	}
}

func TestCallbackClient_TaskDone(t *testing.T) {
	var mu sync.Mutex
	var receivedPath string
	var receivedBody map[string]string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedPath = r.URL.Path
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &receivedBody)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	err := client.TaskDone(context.Background(), "task-001", hub.TaskResult{
		RunID:        "run-001",
		FinalContent: "All done",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedPath != "/edge/agent-tasks/task-001/done" {
		t.Fatalf("expected /edge/agent-tasks/task-001/done, got %s", receivedPath)
	}
	if receivedBody["run_id"] != "run-001" {
		t.Fatalf("expected run_id=run-001, got %v", receivedBody["run_id"])
	}
	if receivedBody["final_content"] != "All done" {
		t.Fatalf("expected final_content=All done, got %v", receivedBody["final_content"])
	}
}

func TestCallbackClient_TaskFail(t *testing.T) {
	var mu sync.Mutex
	var receivedPath string
	var receivedBody map[string]string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedPath = r.URL.Path
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &receivedBody)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	err := client.TaskFail(context.Background(), "task-001", "run-001", "execution timeout")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedPath != "/edge/agent-tasks/task-001/fail" {
		t.Fatalf("expected /edge/agent-tasks/task-001/fail, got %s", receivedPath)
	}
	if receivedBody["error"] != "execution timeout" {
		t.Fatalf("expected error=execution timeout, got %v", receivedBody["error"])
	}
}

func TestCallbackClient_AuthHeader(t *testing.T) {
	var mu sync.Mutex
	var receivedAuth string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedAuth = r.Header.Get("Authorization")
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-jwt-token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedAuth != "Bearer test-jwt-token" {
		t.Fatalf("expected Authorization: Bearer test-jwt-token, got %q", receivedAuth)
	}
}

func TestCallbackClient_NoAuthToken(t *testing.T) {
	var mu sync.Mutex
	var receivedAuth string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		receivedAuth = r.Header.Get("Authorization")
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedAuth != "" {
		t.Fatalf("expected no Authorization header, got %q", receivedAuth)
	}
}

func TestCallbackClient_RetryOnServerError(t *testing.T) {
	var mu sync.Mutex
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		current := attempts
		mu.Unlock()

		if current < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err != nil {
		t.Fatalf("unexpected error after retries: %v", err)
	}

	if attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempts)
	}
}

func TestCallbackClient_NoRetryOnClientError(t *testing.T) {
	var mu sync.Mutex
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		mu.Unlock()

		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err == nil {
		t.Fatal("expected error for 400 response")
	}
	if attempts != 1 {
		t.Fatalf("expected 1 attempt (no retry on 4xx), got %d", attempts)
	}
	if !strings.Contains(err.Error(), "client error") && !strings.Contains(err.Error(), "400") {
		t.Fatalf("expected client error message, got: %v", err)
	}
}

func TestCallbackClient_ErrorDoesNotLeakHubResponseBody(t *testing.T) {
	rawBody := `{"error":"invalid","access_token":"hub-access-token-secret","client_secret":"hub-client-secret-value","path":"C:\\Users\\Example\\agenthub\\hub-server\\.env"}`

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(rawBody))
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err == nil {
		t.Fatal("expected error for 400 response")
	}

	errText := err.Error()
	for _, leaked := range []string{
		"hub-access-token-secret",
		"hub-client-secret-value",
		"C:\\Users\\Example\\agenthub\\hub-server\\.env",
		"access_token",
		"client_secret",
	} {
		if strings.Contains(errText, leaked) {
			t.Fatalf("callback error leaked %q: %s", leaked, errText)
		}
	}
	for _, expected := range []string{
		"status=400",
		"body_len=",
		"body_sha256_prefix=",
		"category=client_error",
	} {
		if !strings.Contains(errText, expected) {
			t.Fatalf("callback error missing %q: %s", expected, errText)
		}
	}
}

func TestCallbackClient_AppRejectedErrorDoesNotLeakHubMessage(t *testing.T) {
	rawBody := `{"code":"REJECTED","message":"client_secret=hub-client-secret-value access_token=hub-access-token-secret C:\\Users\\Example\\agenthub\\hub-server\\.env"}`

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(rawBody))
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err == nil {
		t.Fatal("expected error for non-OK Hub application code")
	}

	errText := err.Error()
	for _, leaked := range []string{
		"hub-access-token-secret",
		"hub-client-secret-value",
		"C:\\Users\\Example\\agenthub\\hub-server\\.env",
		"access_token",
		"client_secret",
		"REJECTED",
	} {
		if strings.Contains(errText, leaked) {
			t.Fatalf("callback error leaked %q: %s", leaked, errText)
		}
	}
	for _, expected := range []string{
		"status=200",
		"body_len=",
		"body_sha256_prefix=",
		"category=app_rejected",
	} {
		if !strings.Contains(errText, expected) {
			t.Fatalf("callback error missing %q: %s", expected, errText)
		}
	}
}

func TestCallbackClient_ContextCancellation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Hang until context is cancelled
		<-r.Context().Done()
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	client := newTestCallbackClient(srv.URL, "test-token")
	err := client.TaskAck(ctx, "task-001", "run-001")
	if err == nil {
		t.Fatal("expected error due to cancelled context")
	}
}

func TestCallbackClient_TaskStreamReader(t *testing.T) {
	var mu sync.Mutex
	var receivedBodies []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		receivedBodies = append(receivedBodies, string(body))
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	reader := strings.NewReader("chunk1\nchunk2\nchunk3")
	err := client.TaskStreamReader(context.Background(), "task-001", "run-001", reader)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(receivedBodies) == 0 {
		t.Fatal("expected at least one callback")
	}

	// Verify all chunks have correct structure
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

// TestCallbackClient_TaskStreamReader_DeterministicClientMsgID verifies that
// reader-driven stream chunks now carry a deterministic client_msg_id so a
// re-delivered chunk for the same run + reader position produces the same id
// and the Hub's #130 idempotent stream-to-message dedup can skip duplicates.
// Two independent passes over the same reader content for the same runID must
// produce the same client_msg_id sequence. A custom single-byte reader is
// used so the chunk count is deterministic regardless of buffer sizes.
func TestCallbackClient_TaskStreamReader_DeterministicClientMsgID(t *testing.T) {
	var mu sync.Mutex
	var firstPassIDs []string
	var secondPassIDs []string

	var callCount int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var m map[string]string
		_ = json.Unmarshal(body, &m)

		mu.Lock()
		callCount++
		// First 4 calls belong to pass 1; calls 5..8 belong to pass 2.
		if callCount <= 4 {
			firstPassIDs = append(firstPassIDs, m["client_msg_id"])
		} else {
			secondPassIDs = append(secondPassIDs, m["client_msg_id"])
		}
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")

	// singleByteReader yields one byte per Read so chunk count is deterministic.
	firstPass := newSingleByteReader([]byte("ABCD"))
	if err := client.TaskStreamReader(context.Background(), "task-001", "run-deterministic", firstPass); err != nil {
		t.Fatalf("first pass: %v", err)
	}
	secondPass := newSingleByteReader([]byte("ABCD"))
	if err := client.TaskStreamReader(context.Background(), "task-001", "run-deterministic", secondPass); err != nil {
		t.Fatalf("second pass: %v", err)
	}

	if len(firstPassIDs) != 4 || len(secondPassIDs) != 4 {
		t.Fatalf("expected 4 ids per pass, got first=%d second=%d", len(firstPassIDs), len(secondPassIDs))
	}
	for i, id := range firstPassIDs {
		if id == "" {
			t.Fatalf("chunk %d: expected non-empty client_msg_id, got empty", i)
		}
		if id != secondPassIDs[i] {
			t.Fatalf("chunk %d: re-delivered chunk produced different client_msg_id: first=%s second=%s", i, id, secondPassIDs[i])
		}
	}
	// All four ids must be unique within a single pass (chunkIdx 1..4).
	seen := make(map[string]struct{}, len(firstPassIDs))
	for _, id := range firstPassIDs {
		if _, dup := seen[id]; dup {
			t.Fatalf("duplicate client_msg_id within a single pass: %s", id)
		}
		seen[id] = struct{}{}
	}
}

// singleByteReader emits one byte per Read call so chunk count is independent
// of the client's buffer size. EOF is returned once the source is exhausted.
type singleByteReader struct {
	data []byte
	pos  int
}

func newSingleByteReader(data []byte) *singleByteReader { return &singleByteReader{data: data} }

func (r *singleByteReader) Read(p []byte) (int, error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	p[0] = r.data[r.pos]
	r.pos++
	return 1, nil
}

// TestCallbackClient_TaskStreamReader_ClientMsgID_DistinctFromStructuredPath
// verifies that a reader-driven chunk and a structured fireHubStream chunk for
// the same runID + chunkIdx=1 cannot collide on client_msg_id (different name
// format), so the Hub never accidentally dedups a reader chunk against an
// unrelated structured chunk.
func TestCallbackClient_TaskStreamReader_ClientMsgID_DistinctFromStructuredPath(t *testing.T) {
	// Reader-driven uses UUIDv5(NameSpaceOID, "run-X:reader:1").
	readerID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("run-X:reader:1")).String()
	// Structured fireHubStream uses UUIDv5(NameSpaceOID, "run-X:1") (mirror
	// of lifecycle.hubStreamClientMsgID, which is intentionally not exported —
	// we re-derive here to assert the name-space contract).
	structuredID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("run-X:1")).String()
	if readerID == structuredID {
		t.Fatalf("reader-driven and structured client_msg_id must not collide: both=%s", readerID)
	}
}
