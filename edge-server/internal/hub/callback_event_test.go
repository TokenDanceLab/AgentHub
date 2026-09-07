package hub_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/hub"
)

func TestCallbackClient_TaskStreamEventSendsTypedPayloadObject(t *testing.T) {
	var mu sync.Mutex
	var (
		method string
		path   string
		raw    []byte
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		method = r.Method
		path = r.URL.Path
		raw = body
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":"` + errcode.OK.Code + `"}`))
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	err := client.TaskStreamEvent(
		context.Background(),
		"task-001",
		"run-001",
		"client-msg-001",
		"run.agent.permission_requested",
		json.RawMessage(`{"requestId":"req-001","toolName":"Bash"}`),
	)
	if err != nil {
		t.Fatalf("TaskStreamEvent returned error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if method != http.MethodPost {
		t.Fatalf("method = %q, want POST", method)
	}
	if path != "/edge/agent-tasks/task-001/stream" {
		t.Fatalf("path = %q, want /edge/agent-tasks/task-001/stream", path)
	}

	var body struct {
		RunID       string          `json:"run_id"`
		EventType   string          `json:"event_type"`
		Payload     json.RawMessage `json:"payload"`
		ClientMsgID string          `json:"client_msg_id"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("request body is not JSON: %v (raw=%s)", err, raw)
	}
	if body.RunID != "run-001" {
		t.Fatalf("run_id = %q, want run-001", body.RunID)
	}
	if body.EventType != "run.agent.permission_requested" {
		t.Fatalf("event_type = %q, want permission_requested", body.EventType)
	}
	if body.ClientMsgID != "client-msg-001" {
		t.Fatalf("client_msg_id = %q, want client-msg-001", body.ClientMsgID)
	}
	if len(body.Payload) == 0 || body.Payload[0] != '{' {
		t.Fatalf("payload = %s, want a JSON object, not a stringified payload", body.Payload)
	}
	var payload map[string]any
	if err := json.Unmarshal(body.Payload, &payload); err != nil {
		t.Fatalf("payload is not an object: %v", err)
	}
	if payload["requestId"] != "req-001" || payload["toolName"] != "Bash" {
		t.Fatalf("payload = %#v, want requestId/toolName", payload)
	}
}

func TestCallbackClient_TaskStreamEventRetriesOnServerError(t *testing.T) {
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":"` + errcode.OK.Code + `"}`))
	}))
	defer srv.Close()

	cfg := hub.DefaultCallbackConfig()
	cfg.MaxAttempts = 2
	cfg.RetryBaseDelay = time.Millisecond
	cfg.RetryBudget = time.Second
	client := newPolicyCallbackClient(srv.URL, "test-token", cfg)
	err := client.TaskStreamEvent(
		context.Background(),
		"task-001",
		"run-001",
		"client-msg-001",
		"run.agent.route_decision",
		json.RawMessage(`{"action":"finish"}`),
	)
	if err != nil {
		t.Fatalf("TaskStreamEvent returned error after retry: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if attempts != 2 {
		t.Fatalf("attempts = %d, want 2 (typed stream is idempotent by client_msg_id)", attempts)
	}
}
