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

	"github.com/agenthub/edge-server/internal/hub"
)

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
		json.NewEncoder(w).Encode(map[string]string{"code": "OK"})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "test-token")
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
		json.NewEncoder(w).Encode(map[string]string{"code": "OK"})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "test-token")
	err := client.TaskStream(context.Background(), "task-001", "run-001", "Hello from Edge")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedPath != "/edge/agent-tasks/task-001/stream" {
		t.Fatalf("expected /edge/agent-tasks/task-001/stream, got %s", receivedPath)
	}
	if receivedBody["content"] != "Hello from Edge" {
		t.Fatalf("expected content=Hello from Edge, got %v", receivedBody["content"])
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
		json.NewEncoder(w).Encode(map[string]string{"code": "OK"})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "test-token")
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
		json.NewEncoder(w).Encode(map[string]string{"code": "OK"})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "test-token")
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
		json.NewEncoder(w).Encode(map[string]string{"code": "OK"})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "test-jwt-token")
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
		json.NewEncoder(w).Encode(map[string]string{"code": "OK"})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "")
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
		json.NewEncoder(w).Encode(map[string]string{"code": "OK"})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "test-token")
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

	client := hub.NewCallbackClient(srv.URL, "test-token")
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

	client := hub.NewCallbackClient(srv.URL, "test-token")
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

	client := hub.NewCallbackClient(srv.URL, "test-token")
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

	client := hub.NewCallbackClient(srv.URL, "test-token")
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
		json.NewEncoder(w).Encode(map[string]string{"code": "OK"})
	}))
	defer srv.Close()

	client := hub.NewCallbackClient(srv.URL, "test-token")
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
