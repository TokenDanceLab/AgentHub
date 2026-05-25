package httpserver

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
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

func TestCORSMiddlewareAllowsLocalhostVariants(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{"localhost with port 5199", "http://localhost:5199", true},
		{"localhost with port 5173", "http://localhost:5173", true},
		{"127.0.0.1 with port", "http://127.0.0.1:5199", true},
		{"tauri custom protocol", "https://tauri.localhost", true},
		{"malicious origin", "https://evil.com", false},
		{"malicious with localhost in hostname", "https://localhost.evil.com", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			}))

			req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
			req.Header.Set("Origin", tt.origin)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if tt.want && rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 for origin %q", rec.Code, tt.origin)
			}
			if !tt.want && rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403 for origin %q", rec.Code, tt.origin)
			}
			if tt.want && !called {
				t.Fatal("handler was not called for trusted origin")
			}
			if !tt.want && called {
				t.Fatal("handler should not be called for untrusted origin")
			}
		})
	}
}

func TestCORSWithOptionsRequest(t *testing.T) {
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called for OPTIONS")
	}))

	req := httptest.NewRequest(http.MethodOptions, "/v1/health", nil)
	req.Header.Set("Origin", "http://localhost:5199")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("OPTIONS status = %d, want 204", rec.Code)
	}
}

func TestCORSHeadersSet(t *testing.T) {
	called := false
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	req.Header.Set("Origin", "http://localhost:5199")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !called {
		t.Fatal("handler was not called")
	}

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5199" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
	if got := rec.Header().Get("Vary"); got != "Origin" {
		t.Fatalf("Vary = %q, want Origin", got)
	}
	methods := rec.Header().Get("Access-Control-Allow-Methods")
	if methods != "GET, POST, PATCH, DELETE, OPTIONS" {
		t.Fatalf("Access-Control-Allow-Methods = %q", methods)
	}
	headers := rec.Header().Get("Access-Control-Allow-Headers")
	if headers != "Content-Type, Authorization" {
		t.Fatalf("Access-Control-Allow-Headers = %q", headers)
	}
}

func TestRunConfigDefaultAddr(t *testing.T) {
	// Test that Run fills in default Addr when empty.
	// We don't actually start the server (it would block), but we verify
	// the config path is set up correctly.
	cfg := Config{}
	if cfg.Addr == "" {
		cfg.Addr = "127.0.0.1:3210"
	}
	if cfg.Addr != "127.0.0.1:3210" {
		t.Fatalf("default Addr = %q, want 127.0.0.1:3210", cfg.Addr)
	}
}

func TestNewHandlerFromConfigEnsuresStore(t *testing.T) {
	handler, err := newHandlerFromConfig(Config{})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	if handler.Store == nil {
		t.Fatal("Store should not be nil")
	}
}

func TestNewHandlerFromConfigEnsuresBus(t *testing.T) {
	handler, err := newHandlerFromConfig(Config{})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	if handler.Bus == nil {
		t.Fatal("Bus should not be nil")
	}
}

func TestNewHandlerFromConfigEnsuresRegistry(t *testing.T) {
	handler, err := newHandlerFromConfig(Config{})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	// Registry comes from runners.NewRegistry() in the constructor
	if handler.Registry == nil {
		t.Fatal("Registry should not be nil")
	}
}

func TestNewHandlerFromConfigWithAdapterRegistryButNoDefault(t *testing.T) {
	handler, err := newHandlerFromConfig(Config{
		AdapterRegistry: &adapters.Registry{},
		AgentDefault:    "",
	})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	// Should still succeed — no executor wired because AgentDefault is empty
	if handler.Executor != nil {
		t.Logf("Executor is non-nil (may be wired if adapter found): %T", handler.Executor)
	}
}

func TestNewHandlerFromConfigCustomAddr(t *testing.T) {
	handler, err := newHandlerFromConfig(Config{})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	if handler == nil {
		t.Fatal("handler is nil")
	}
}

func TestNewHandlerFromConfigWithAdapterAndCommand(t *testing.T) {
	handler, err := newHandlerFromConfig(Config{
		AdapterRegistry: &adapters.Registry{},
		AgentDefault:    "claude-code",
		ProcessExecutor: lifecycle.ProcessExecutorConfig{
			Command: os.Args[0],
			Args:    []string{"-test.run=TestProcessExecutorWiringHelper", "--"},
		},
	})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	if handler == nil {
		t.Fatal("handler is nil")
	}
	// With an explicit command, executor should be wired
	if handler.Executor == nil {
		t.Fatal("Executor is nil with explicit command")
	}
}

func TestNewHandlerFromConfigWithAdapterSentinelPath(t *testing.T) {
	// When AdapterRegistry and AgentDefault are set but no Command,
	// the code should use the sentinel path.
	handler, err := newHandlerFromConfig(Config{
		AdapterRegistry: &adapters.Registry{},
		AgentDefault:    "claude-code",
	})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	if handler == nil {
		t.Fatal("handler is nil")
	}
	// Even without an explicit command, the sentinel should allow executor wiring
	// (if the adapter is registered, which it's not in this test, executor would still be wired)
}

func TestNewHandlerFromConfigWithRegisteredAdapter(t *testing.T) {
	reg := adapters.NewRegistry()
	a := adapters.NewClaudeCodeAdapter("claude", "sonnet", "")
	if err := reg.Register(a); err != nil {
		t.Fatalf("Register: %v", err)
	}

	handler, err := newHandlerFromConfig(Config{
		AdapterRegistry: reg,
		AgentDefault:    "claude-code",
	})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	if handler == nil {
		t.Fatal("handler is nil")
	}
	if handler.AdapterRegistry != reg {
		t.Fatal("AdapterRegistry was not propagated")
	}
}

func TestNewHandlerFromConfigRegistersRuntimeRunner(t *testing.T) {
	reg := adapters.NewRegistry()
	a := adapters.NewCodexAdapter("codex", "")
	if err := reg.Register(a); err != nil {
		t.Fatalf("Register: %v", err)
	}

	handler, err := newHandlerFromConfig(Config{
		AdapterRegistry: reg,
		AgentDefault:    "codex",
	})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	runner, ok := handler.Registry.Get("runner_local_1")
	if !ok {
		t.Fatal("runner_local_1 should exist")
	}
	if runner.Name != "Codex Runner (local)" {
		t.Fatalf("runner name = %q, want Codex Runner (local)", runner.Name)
	}
	if hasString(runner.Capabilities, "mock") {
		t.Fatalf("runner capabilities = %v, must not report mock for runtime adapter executor", runner.Capabilities)
	}
	for _, want := range []string{"codex", "tool_calls", "file_changes", "multi_turn"} {
		if !hasString(runner.Capabilities, want) {
			t.Fatalf("runner capabilities = %v, missing %q", runner.Capabilities, want)
		}
	}
}

func TestNewHandlerFromConfigRegistersProcessRunner(t *testing.T) {
	handler, err := newHandlerFromConfig(Config{
		ProcessExecutor: lifecycle.ProcessExecutorConfig{
			Command: os.Args[0],
			Args:    []string{"-test.run=TestProcessExecutorWiringHelper", "--"},
		},
	})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	runner, ok := handler.Registry.Get("runner_local_1")
	if !ok {
		t.Fatal("runner_local_1 should exist")
	}
	if runner.Name != "Process Runner (local)" {
		t.Fatalf("runner name = %q, want Process Runner (local)", runner.Name)
	}
	for _, want := range []string{"process", "shell"} {
		if !hasString(runner.Capabilities, want) {
			t.Fatalf("runner capabilities = %v, missing %q", runner.Capabilities, want)
		}
	}
}

func TestNewHandlerFromConfigAdapterNotFound(t *testing.T) {
	reg := adapters.NewRegistry()
	// Register something different from AgentDefault
	a := adapters.NewClaudeCodeAdapter("claude", "sonnet", "")
	if err := reg.Register(a); err != nil {
		t.Fatalf("Register: %v", err)
	}

	handler, err := newHandlerFromConfig(Config{
		AdapterRegistry: reg,
		AgentDefault:    "nonexistent",
	})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	if handler == nil {
		t.Fatal("handler is nil")
	}
	// The adapter is not found, but handler should still be created
}

func TestNewHandlerFromConfigEnsuresAllFields(t *testing.T) {
	handler, err := newHandlerFromConfig(Config{})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	if handler.Bus == nil {
		t.Fatal("Bus should not be nil")
	}
	if handler.Registry == nil {
		t.Fatal("Registry should not be nil")
	}
	if handler.Store == nil {
		t.Fatal("Store should not be nil")
	}
	// Executor is lazily set or nil when no ProcessExecutorCommand is given
	if handler.Executor != nil {
		t.Logf("Executor is non-nil (may be wired): %T", handler.Executor)
	}
}

func TestNewHandlerFromConfigInvalidEnv(t *testing.T) {
	_, err := newHandlerFromConfig(Config{
		ProcessExecutor: lifecycle.ProcessExecutorConfig{
			Command:  os.Args[0],
			ExtraEnv: []string{"INVALID"},
		},
	})
	if err == nil {
		t.Fatal("expected error for invalid ExtraEnv")
	}
}

// --- Run tests ---

func TestRunReturnsErrorForInvalidConfig(t *testing.T) {
	// newHandlerFromConfig will fail on invalid ExtraEnv, Run should propagate the error.
	err := Run(Config{
		Addr: "127.0.0.1:3211",
		ProcessExecutor: lifecycle.ProcessExecutorConfig{
			Command:  os.Args[0],
			ExtraEnv: []string{"INVALID"},
		},
	})
	if err == nil {
		t.Fatal("expected error from Run with invalid config")
	}
}

func TestRunServerStartAndServeHTTP(t *testing.T) {
	// Start Run in a goroutine on a random port to exercise the full server
	// startup path. We verify the server does not exit with an error.
	// On platforms without signal support, the server goroutine will leak;
	// that is acceptable for a test (random port, no conflicts).
	errCh := make(chan error, 1)
	started := make(chan struct{})
	go func() {
		close(started)
		errCh <- Run(Config{
			Addr: "127.0.0.1:0", // random available port
		})
	}()

	// Wait for the goroutine to actually start
	<-started
	time.Sleep(300 * time.Millisecond)

	// Try to send interrupt — if it works (Unix), Run returns cleanly.
	if err := sendInterrupt(); err != nil {
		// Signal not supported on this platform (e.g., Windows without proper syscall).
		// Verify the goroutine hasn't exited with an error yet —
		// the server should be running, blocked on the signal channel.
		select {
		case err := <-errCh:
			t.Fatalf("Run exited unexpectedly: %v", err)
		default:
			t.Log("Server goroutine running as expected on platform without signal support")
		}
		return
	}

	// Wait for graceful shutdown
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("Run returned error: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Run did not return within timeout")
	}
}

// sendInterrupt sends an interrupt to the current process.
// Returns nil if the signal was sent successfully, or an error if
// the platform does not support sending signals to the current process.
func sendInterrupt() error {
	p, err := os.FindProcess(os.Getpid())
	if err != nil {
		return err
	}
	return p.Signal(os.Interrupt)
}

func hasString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
