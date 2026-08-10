package hub_test

// Phase-2 outbound policy tests (#1564): retry budget, Retry-After, body
// limit, action-level retry policy, redirect refusal, idempotency-key
// stability, caller-deadline cancellation, and connection reuse.

import (
	"context"
	"encoding/json"
	"fmt"
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

// fastPolicy returns a default policy with a tiny retry budget so tests that
// assert budget stops do not sleep for seconds.
func fastPolicy(budget time.Duration) hub.CallbackConfig {
	cfg := hub.DefaultCallbackConfig()
	cfg.RetryBudget = budget
	return cfg
}

func TestCallbackClient_RetryBudgetExhausted(t *testing.T) {
	var mu sync.Mutex
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		mu.Unlock()
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	client := newPolicyCallbackClient(srv.URL, "test-token", fastPolicy(time.Millisecond))
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err == nil {
		t.Fatal("expected error after budget exhaustion")
	}
	if attempts != 1 {
		t.Fatalf("expected 1 attempt (budget exhausted before retry), got %d", attempts)
	}
	if !strings.Contains(err.Error(), "budget") {
		t.Fatalf("error should mention the retry budget, got: %v", err)
	}
}

func TestCallbackClient_RetryAfterOverBudgetStops(t *testing.T) {
	var mu sync.Mutex
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		mu.Unlock()
		w.Header().Set("Retry-After", "3600")
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	client := newPolicyCallbackClient(srv.URL, "test-token", fastPolicy(time.Millisecond))
	start := time.Now()
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err == nil {
		t.Fatal("expected error when Retry-After overruns the budget")
	}
	if attempts != 1 {
		t.Fatalf("expected 1 attempt (Retry-After over budget), got %d", attempts)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("must stop immediately when Retry-After exceeds budget, took %s", time.Since(start))
	}
}

func TestCallbackClient_RetryAfterHonored(t *testing.T) {
	var mu sync.Mutex
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		mu.Unlock()
		if attempts < 2 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusServiceUnavailable)
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
		t.Fatalf("unexpected error after Retry-After retry: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("expected 2 attempts (Retry-After honored), got %d", attempts)
	}
}

func TestCallbackClient_StreamNotRetried(t *testing.T) {
	var mu sync.Mutex
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		mu.Unlock()
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	err := client.TaskStream(context.Background(), "task-001", "run-001", "", "chunk")
	if err == nil {
		t.Fatal("expected error for 5xx stream callback")
	}
	// stream is a content append without a client-side idempotency key in the
	// payload — retrying could duplicate the chunk on the Hub (#1564).
	if attempts != 1 {
		t.Fatalf("expected 1 attempt (stream is not retried), got %d", attempts)
	}
	if !strings.Contains(err.Error(), "not retried") {
		t.Fatalf("error should state the action is not retried, got: %v", err)
	}
}

func TestCallbackClient_429WithRetryAfterRetried(t *testing.T) {
	var mu sync.Mutex
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		mu.Unlock()
		if attempts < 2 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
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
		t.Fatalf("unexpected error after 429+Retry-After retry: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("expected 2 attempts (429 with Retry-After), got %d", attempts)
	}
}

func TestCallbackClient_429WithoutRetryAfterNotRetried(t *testing.T) {
	var mu sync.Mutex
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		mu.Unlock()
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err == nil {
		t.Fatal("expected error for 429 without Retry-After")
	}
	if attempts != 1 {
		t.Fatalf("expected 1 attempt (429 without Retry-After is not retried), got %d", attempts)
	}
}

func TestCallbackClient_ResponseBodyLimitFailClosed(t *testing.T) {
	const limit = 1024
	rawBody := strings.Repeat("x", limit*2) + "secret-payload-marker"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(rawBody))
	}))
	defer srv.Close()

	cfg := hub.DefaultCallbackConfig()
	cfg.MaxResponseBodyBytes = limit
	client := newPolicyCallbackClient(srv.URL, "test-token", cfg)
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err == nil {
		t.Fatal("expected fail-closed error for oversize response body")
	}
	if !strings.Contains(err.Error(), "too large") {
		t.Fatalf("error should mention the body limit, got: %v", err)
	}
	if strings.Contains(err.Error(), "secret-payload-marker") {
		t.Fatalf("oversize body content must not surface in errors: %v", err)
	}
	if !strings.Contains(err.Error(), "body_too_large") {
		t.Fatalf("error should carry the body_too_large category, got: %v", err)
	}
}

func TestCallbackClient_RetrySendsIdenticalPayload(t *testing.T) {
	var mu sync.Mutex
	var receivedBodies [][]byte
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		attempts++
		receivedBodies = append(receivedBodies, body)
		mu.Unlock()
		if attempts < 2 {
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
		t.Fatalf("unexpected error: %v", err)
	}
	if len(receivedBodies) != 2 {
		t.Fatalf("expected 2 attempts, got %d", len(receivedBodies))
	}
	// The idempotency key (taskID in the URL, run_id in the body) must stay
	// byte-identical across retries (#1564).
	if string(receivedBodies[0]) != string(receivedBodies[1]) {
		t.Fatalf("retry payload changed: %q vs %q", receivedBodies[0], receivedBodies[1])
	}
}

func TestCallbackClient_RedirectNotFollowed(t *testing.T) {
	var mu sync.Mutex
	attempts := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		mu.Unlock()
		w.Header().Set("Location", "http://example.invalid/elsewhere")
		w.WriteHeader(http.StatusFound)
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	err := client.TaskAck(context.Background(), "task-001", "run-001")
	if err == nil {
		t.Fatal("expected error for redirect response")
	}
	if attempts != 1 {
		t.Fatalf("expected 1 attempt (redirects not followed), got %d", attempts)
	}
	if !strings.Contains(err.Error(), "redirect") {
		t.Fatalf("error should mention redirect, got: %v", err)
	}
}

func TestCallbackClient_CallerDeadlineCancelsPromptly(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Hang until the caller deadline fires (bounded so the test server
		// can always shut down cleanly).
		select {
		case <-r.Context().Done():
		case <-time.After(10 * time.Second):
		}
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	client := newTestCallbackClient(srv.URL, "test-token")
	start := time.Now()
	err := client.TaskAck(ctx, "task-001", "run-001")
	if err == nil {
		t.Fatal("expected error when the caller deadline is shorter than the client timeout")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("caller deadline must cancel promptly, took %s", elapsed)
	}
	if !strings.Contains(err.Error(), "timeout") {
		t.Fatalf("error should carry the timeout category, got: %v", err)
	}
}

func TestCallbackClient_ConnectionReuse(t *testing.T) {
	var mu sync.Mutex
	var remoteAddrs []string
	requests := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requests++
		remoteAddrs = append(remoteAddrs, r.RemoteAddr)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"code": errcode.OK.Code})
	}))
	defer srv.Close()

	client := newTestCallbackClient(srv.URL, "test-token")
	for i := 0; i < 3; i++ {
		if err := client.TaskAck(context.Background(), fmt.Sprintf("task-%03d", i), "run-001"); err != nil {
			t.Fatalf("callback %d failed: %v", i, err)
		}
	}
	if requests != 3 {
		t.Fatalf("expected 3 requests, got %d", requests)
	}
	if len(remoteAddrs) < 2 {
		t.Fatalf("expected at least 2 recorded remote addrs, got %d", len(remoteAddrs))
	}
	for i := 1; i < len(remoteAddrs); i++ {
		if remoteAddrs[i] != remoteAddrs[0] {
			t.Fatalf("connection not reused: %q vs %q", remoteAddrs[0], remoteAddrs[i])
		}
	}
}
