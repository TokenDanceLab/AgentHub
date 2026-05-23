package httpserver

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
)

func TestCORSMiddlewareAllowsTrustedLocalOrigin(t *testing.T) {
	called := false
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	req.Header.Set("Origin", "http://localhost:5199")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !called {
		t.Fatal("handler was not called")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5199" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
}

func TestCORSMiddlewareRejectsUntrustedOrigin(t *testing.T) {
	called := false
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	req.Header.Set("Origin", "https://example.com")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if called {
		t.Fatal("handler should not be called for an untrusted origin")
	}
}

func TestCORSMiddlewareAllowsNoOrigin(t *testing.T) {
	called := false
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !called {
		t.Fatal("handler was not called")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want empty", got)
	}
}

func TestNewHandlerFromConfigLeavesDefaultExecutorLazy(t *testing.T) {
	handler, err := newHandlerFromConfig(Config{})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	if handler.Executor != nil {
		t.Fatalf("Executor = %T, want nil before handler defaulting", handler.Executor)
	}
	if handler.Bus == nil {
		t.Fatal("Bus is nil")
	}
	if handler.Store == nil {
		t.Fatal("Store is nil")
	}
}

func TestNewHandlerFromConfigWiresProcessExecutor(t *testing.T) {
	handler, err := newHandlerFromConfig(Config{
		ProcessExecutor: lifecycle.ProcessExecutorConfig{
			Command: os.Args[0],
			Args:    []string{"-test.run=TestProcessExecutorWiringHelper", "--"},
		},
	})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}

	if _, ok := handler.Executor.(*lifecycle.ProcessExecutor); !ok {
		t.Fatalf("Executor = %T, want *lifecycle.ProcessExecutor", handler.Executor)
	}

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", bytes.NewBufferString("{}"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", rec.Code, rec.Body.String())
	}

	subID, ch, replay := handler.Bus.Subscribe(0)
	defer handler.Bus.Unsubscribe(subID)
	eventsSeen := append([]string(nil), eventTypes(replay)...)

	deadline := time.After(10 * time.Second)
	for !hasEventType(eventsSeen, "run.started") || !hasEventType(eventsSeen, "run.finished") {
		select {
		case evt := <-ch:
			eventsSeen = append(eventsSeen, evt.Type)
		case <-deadline:
			t.Fatalf("timed out waiting for process executor events; saw %v", eventsSeen)
		}
	}
}

func eventTypes(envelopes []events.EventEnvelope) []string {
	types := make([]string, 0, len(envelopes))
	for _, evt := range envelopes {
		types = append(types, evt.Type)
	}
	return types
}

func hasEventType(events []string, want string) bool {
	for _, got := range events {
		if got == want {
			return true
		}
	}
	return false
}

func TestProcessExecutorWiringHelper(t *testing.T) {
	if len(os.Args) >= 2 && os.Args[1] == "-test.run=TestProcessExecutorWiringHelper" {
		return
	}
}
