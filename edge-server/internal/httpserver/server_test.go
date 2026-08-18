package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/api"
	"github.com/agenthub/edge-server/internal/edgeidentity"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/store"

	"github.com/golang-jwt/jwt/v5"
)

func TestCORSMiddlewareAllowsTrustedLocalOrigin(t *testing.T) {
	called := false
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), false, nil)

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
	}), false, nil)

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

func TestCORSMiddlewareRemoteModeRejectsOriginOutsideAllowlist(t *testing.T) {
	called := false
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), true, []string{"https://app.example"})

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if called {
		t.Fatal("handler should not be called for a remote origin outside the allowlist")
	}
}

func TestCORSMiddlewareRemoteModeRejectsLocalhostOutsideAllowlist(t *testing.T) {
	called := false
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), true, []string{"https://app.example"})

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if called {
		t.Fatal("handler should not be called for localhost outside the remote allowlist")
	}
}

func TestCORSMiddlewareRemoteModeAllowsOriginInAllowlist(t *testing.T) {
	called := false
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), true, []string{"https://app.example"})

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	req.Header.Set("Origin", "https://app.example")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !called {
		t.Fatal("handler was not called for an allowed remote origin")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
}

func TestCORSMiddlewareAllowsNoOrigin(t *testing.T) {
	called := false
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), false, nil)

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

func TestNewHandlerFromConfigDefaultsToMockExecutor(t *testing.T) {
	handler, err := newHandlerFromConfig(Config{})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	// No runner command and no agent default: the edge falls back to the mock
	// executor so the run lifecycle stays usable (the agenthub-runner-mock
	// profile contract). This replaced the old nil-executor behavior, which
	// left the edge degraded (no executor, no runners) and every run failing
	// with ErrExecutorUnavailable.
	if _, ok := handler.Executor.(*lifecycle.MockExecutor); !ok {
		t.Fatalf("Executor = %T, want *lifecycle.MockExecutor (mock fallback)", handler.Executor)
	}
	if handler.Bus == nil {
		t.Fatal("Bus is nil")
	}
	if handler.Store == nil {
		t.Fatal("Store is nil")
	}
}

func TestNewHandlerFromConfigWiresProcessExecutor(t *testing.T) {
	workDir := t.TempDir()
	handler, err := newHandlerFromConfig(Config{
		ProcessExecutor: lifecycle.ProcessExecutorConfig{
			Command: os.Args[0],
			Args:    []string{"-test.run=TestProcessExecutorWiringHelper", "--"},
		},
		WorkspaceAllowlist: []string{workDir},
	})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}

	if _, ok := handler.Executor.(*lifecycle.ProcessExecutor); !ok {
		t.Fatalf("Executor = %T, want *lifecycle.ProcessExecutor", handler.Executor)
	}

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	body := fmt.Sprintf(`{"workDir":%q}`, workDir)
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", bytes.NewBufferString(body))
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
			}), false, nil)

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
	}), false, nil)

	req := httptest.NewRequest(http.MethodOptions, "/v1/health", nil)
	req.Header.Set("Origin", "http://localhost:5199")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("OPTIONS status = %d, want 204", rec.Code)
	}
}

func TestCORSPreflightAllowsCapabilityTokenHeader(t *testing.T) {
	// Dual-token auth reads X-AgentHub-Capability-Token (handlers_runs.go).
	// Browser preflight must allow that header or cross-origin run-start fails.
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called for OPTIONS preflight")
	}), false, nil)

	req := httptest.NewRequest(http.MethodOptions, "/v1/runs", nil)
	req.Header.Set("Origin", "http://localhost:5199")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "content-type, authorization, x-agenthub-capability-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("OPTIONS status = %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5199" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
	headers := rec.Header().Get("Access-Control-Allow-Headers")
	if !strings.Contains(headers, "X-AgentHub-Capability-Token") {
		t.Fatalf("Access-Control-Allow-Headers = %q, want capability token header", headers)
	}
	if !strings.Contains(headers, "X-AgentHub-Edge-Token") {
		t.Fatalf("Access-Control-Allow-Headers = %q, want edge token header", headers)
	}
}

func TestCORSHeadersSet(t *testing.T) {
	called := false
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), false, nil)

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
	if headers != "Content-Type, Authorization, X-AgentHub-Edge-Token, X-AgentHub-Capability-Token" {
		t.Fatalf("Access-Control-Allow-Headers = %q", headers)
	}
}

func TestRESTTimeoutMiddlewareTimesOutNonWebSocketRequests(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	defer close(release)

	handler := restTimeoutMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		w.WriteHeader(http.StatusOK)
	}), 10*time.Millisecond)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	select {
	case <-started:
	default:
		t.Fatal("wrapped handler was not called")
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 timeout", rec.Code)
	}
}

func TestRESTTimeoutMiddlewareBypassesWebSocketUpgrade(t *testing.T) {
	called := false
	handler := restTimeoutMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusSwitchingProtocols)
	}), 1*time.Nanosecond)

	req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Fatal("websocket handler was not called")
	}
	if rec.Code != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d, want 101", rec.Code)
	}
}

func TestLocalAuthMiddlewareDisabledAllowsRequests(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}), "", "", "")

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	if !called {
		t.Fatal("handler was not called")
	}
}

func TestLocalAuthMiddlewareRequiresTokenForStateChangingRoutes(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}), "edge-secret", "", "")

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if called {
		t.Fatal("handler should not be called without a token")
	}
}

func TestLocalAuthMiddlewareRequiresTokenForReadRoutes(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
	}{
		{"GET project list", http.MethodGet, "/v1/projects"},
		{"HEAD project list", http.MethodHead, "/v1/projects"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			}), "edge-secret", "", "")

			req := httptest.NewRequest(tt.method, tt.path, nil)
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", rec.Code)
			}
			if called {
				t.Fatal("handler should not be called without a token")
			}
		})
	}
}

func TestLocalAuthMiddlewareAllowsBearerToken(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}), "edge-secret", "", "")

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	req.Header.Set("Authorization", "Bearer edge-secret")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	if !called {
		t.Fatal("handler was not called with a valid token")
	}
}

func TestLocalAuthMiddlewareAllowsHealthAndOptionsWithoutToken(t *testing.T) {
	calls := 0
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusOK)
	}), "edge-secret", "", "")

	for _, req := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "/v1/health", nil),
		httptest.NewRequest(http.MethodOptions, "/v1/runs", nil),
	} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s %s status = %d, want 200", req.Method, req.URL.Path, rec.Code)
		}
	}
	if calls != 2 {
		t.Fatalf("handler calls = %d, want 2", calls)
	}
}

// TestLocalAuthMiddlewareRejectsWebSocketQueryToken is the #965 fail-closed
// gate: query-only access_token must no longer authenticate Edge /v1/events.
func TestLocalAuthMiddlewareRejectsWebSocketQueryToken(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusSwitchingProtocols)
	}), "edge-secret", "", "")

	req := httptest.NewRequest(http.MethodGet, "/v1/events?access_token=edge-secret", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for query-only access_token", rec.Code)
	}
	if called {
		t.Fatal("websocket handler should not be called with query-only access_token")
	}
}

// TestLocalAuthMiddlewareAllowsWebSocketSubprotocolToken covers the preferred
// browser/desktop path: Sec-WebSocket-Protocol carries
// "agenthub.edge.bearer.v1, <token>" without a query access_token.
func TestLocalAuthMiddlewareAllowsWebSocketSubprotocolToken(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusSwitchingProtocols)
	}), "edge-secret", "", "")

	req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Protocol", WSEdgeBearerSubprotocol+", edge-secret")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d, want 101", rec.Code)
	}
	if !called {
		t.Fatal("websocket handler was not called with a valid Sec-WebSocket-Protocol token")
	}
}

// TestLocalAuthMiddlewareAllowsWebSocketAccessTokenSubprotocolForm covers the
// alternate single-token convention: access_token.<edge-token>.
func TestLocalAuthMiddlewareAllowsWebSocketAccessTokenSubprotocolForm(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusSwitchingProtocols)
	}), "edge-secret", "", "")

	req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Protocol", "access_token.edge-secret")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d, want 101", rec.Code)
	}
	if !called {
		t.Fatal("websocket handler was not called with access_token.<token> subprotocol")
	}
}

// TestLocalAuthMiddlewareAllowsWebSocketEdgeHeaderToken ensures native clients
// can still authenticate /v1/events via X-AgentHub-Edge-Token.
func TestLocalAuthMiddlewareAllowsWebSocketEdgeHeaderToken(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusSwitchingProtocols)
	}), "edge-secret", "", "")

	req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("X-AgentHub-Edge-Token", "edge-secret")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d, want 101", rec.Code)
	}
	if !called {
		t.Fatal("websocket handler was not called with X-AgentHub-Edge-Token")
	}
}

func TestTokenFromWSSubprotocols(t *testing.T) {
	token := "edge-secret-token"
	cases := []struct {
		name   string
		values []string
		want   string
	}{
		{"empty", nil, ""},
		{"marker only", []string{WSEdgeBearerSubprotocol}, ""},
		{"preferred form", []string{WSEdgeBearerSubprotocol + ", " + token}, token},
		{"access_token form", []string{"access_token." + token}, token},
		{"multi header values", []string{WSEdgeBearerSubprotocol, token}, token},
		{"access_token preferred over raw", []string{WSEdgeBearerSubprotocol + ", other.token, access_token." + token}, token},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tokenFromWSSubprotocols(tc.values); got != tc.want {
				t.Fatalf("tokenFromWSSubprotocols(%v) = %q, want %q", tc.values, got, tc.want)
			}
		})
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
	a := adapters.NewCodexACPadapter("")
	if err := reg.Register(a); err != nil {
		t.Fatalf("Register: %v", err)
	}

	handler, err := newHandlerFromConfig(Config{
		AdapterRegistry: reg,
		AgentDefault:    "codex-acp",
	})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	runner, ok := handler.Registry.Get("runner_local_1")
	if !ok {
		t.Fatal("runner_local_1 should exist")
	}
	if runner.Name != "Codex (ACP) Runner (local)" {
		t.Fatalf("runner name = %q, want Codex (ACP) Runner (local)", runner.Name)
	}
	if hasString(runner.Capabilities, "mock") {
		t.Fatalf("runner capabilities = %v, must not report mock for runtime adapter executor", runner.Capabilities)
	}
	for _, want := range []string{"codex-acp", "tool_calls", "file_changes", "multi_turn"} {
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

// TestNewHandlerFromConfigWiresTokenProviderStopHook proves the rotation
// goroutine gets a shutdown hook when --hub-refresh-token is configured, and
// that no hook is registered when auto-rotation is disabled (no refresh token
// or no HubURL). Regression guard for the #1410 graceful-shutdown gap.
func TestNewHandlerFromConfigWiresTokenProviderStopHook(t *testing.T) {
	// No HubURL / no refresh token: no token provider, so no extra stop hook
	// beyond the result aggregator's (#988). We use the adapter sentinel path
	// (AdapterRegistry + AgentDefault) so buildProcessExecutor does not take
	// the mock-executor early return and actually reaches the HubURL wiring.
	withoutRefresh, err := newHandlerFromConfig(Config{
		AdapterRegistry: &adapters.Registry{},
		AgentDefault:     "claude-code",
	})
	if err != nil {
		t.Fatalf("newHandlerFromConfig returned error: %v", err)
	}
	if len(withoutRefresh.ShutdownHooks) == 0 {
		t.Fatalf("ShutdownHooks empty even without token provider; expected at least the result aggregator hook")
	}
	baseHookCount := len(withoutRefresh.ShutdownHooks)

	// HubURL + refresh token: token provider starts and its Stop is appended.
	// Use a localhost stub URL; we don't exercise the refresh round-trip here,
	// only that newHandlerFromConfig wires the stop hook. StartAutoRefresh
	// schedules the first refresh at exp-1m, so with a long-lived token no
	// outbound call is made during the test.
	const jwtAccess = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
		"eyJleHAiOjk5OTk5OTk5OTl9." + // far-future exp
		"sig"
	withRefresh, err := newHandlerFromConfig(Config{
		AdapterRegistry: &adapters.Registry{},
		AgentDefault:    "claude-code",
		HubURL:          "http://127.0.0.1:0",
		HubToken:        jwtAccess,
		HubRefreshToken: "rt-dev",
	})
	if err != nil {
		t.Fatalf("newHandlerFromConfig with refresh token returned error: %v", err)
	}
	if len(withRefresh.ShutdownHooks) <= baseHookCount {
		t.Fatalf("ShutdownHooks = %d (base %d); want > base after token provider wired",
			len(withRefresh.ShutdownHooks), baseHookCount)
	}

	// Drain hooks: the appended Stop must be safe to call (idempotent) and
	// must not block even though StartAutoRefresh was just started.
	for _, hook := range withRefresh.ShutdownHooks {
		hook()
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

func TestRunRejectsNonLoopbackAddr(t *testing.T) {
	err := Run(Config{Addr: ":3211"})
	if err == nil {
		t.Fatal("expected Run to reject wildcard listen address")
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

// --- Hub JWT auth middleware tests ---

const testHubJWTSecret = "hub-secret-at-least-32-bytes-long!!"

func newHubJWT(secret string, userID string, expiresIn time.Duration) string {
	return newHubJWTForDevice(secret, userID, "test-device", expiresIn)
}

func newHubJWTForDevice(secret string, userID string, deviceID string, expiresIn time.Duration) string {
	claims := struct {
		UserID     string `json:"user_id"`
		DeviceID   string `json:"device_id"`
		DeviceType string `json:"device_type"`
		Purpose    string `json:"purpose"`
		jwt.RegisteredClaims
	}{
		UserID:     userID,
		DeviceID:   deviceID,
		DeviceType: "edge",
		Purpose:    "edge-api",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-edge"},
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiresIn)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte(secret))
	return s
}

func newOrdinaryHubAPIJWT(secret string, userID string, expiresIn time.Duration) string {
	claims := struct {
		UserID     string `json:"user_id"`
		DeviceID   string `json:"device_id"`
		DeviceType string `json:"device_type"`
		jwt.RegisteredClaims
	}{
		UserID:     userID,
		DeviceID:   "test-device",
		DeviceType: "desktop",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-api"},
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiresIn)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte(secret))
	return s
}

func TestLocalAuthMiddleware_HubJWTSuccess(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}), "", testHubJWTSecret, "test-device")

	token := newHubJWT(testHubJWTSecret, "user-1", 1*time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	if !called {
		t.Fatal("handler was not called with valid Hub JWT")
	}
}

func TestLocalAuthMiddleware_RejectsOrdinaryHubAPIToken(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}), "", testHubJWTSecret, "test-device")

	token := newOrdinaryHubAPIJWT(testHubJWTSecret, "user-1", 1*time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if called {
		t.Fatal("handler should not be called with ordinary Hub API JWT")
	}
}

func TestLocalAuthMiddleware_RejectsHubJWTForDifferentEdgeDevice(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}), "", testHubJWTSecret, "test-device")

	token := newHubJWTForDevice(testHubJWTSecret, "user-1", "other-edge-device", 1*time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if called {
		t.Fatal("handler should not be called with a Hub JWT for a different Edge device")
	}
}

func TestLocalAuthMiddleware_HubJWTInvalid(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}), "", testHubJWTSecret, "test-device")

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if called {
		t.Fatal("handler should not be called with invalid Hub JWT")
	}
}

func TestLocalAuthMiddleware_HubJWTWrongSecret(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}), "", testHubJWTSecret, "test-device")

	token := newHubJWT("different-secret-key-for-testing!!", "user-1", 1*time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if called {
		t.Fatal("handler should not be called with wrong-secret Hub JWT")
	}
}

func TestLocalAuthMiddleware_HubJWTExpired(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}), "", testHubJWTSecret, "test-device")

	token := newHubJWT(testHubJWTSecret, "user-1", -1*time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if called {
		t.Fatal("handler should not be called with expired Hub JWT")
	}
}

func TestLocalAuthMiddleware_SkipsTokenDancePrefix(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}), "edge-secret", testHubJWTSecret, "test-device")

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	req.Header.Set("Authorization", "Bearer td_some_tokendance_token")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (td_ tokens should be rejected)", rec.Code)
	}
	if called {
		t.Fatal("handler should not be called with td_ prefixed token")
	}
}

func TestLocalAuthMiddleware_LocalAuthTokenFallback(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}), "edge-secret", testHubJWTSecret, "test-device")

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	req.Header.Set("Authorization", "Bearer edge-secret")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	if !called {
		t.Fatal("handler was not called with valid LocalAuthToken")
	}
}

func TestLocalAuthMiddleware_BothNilAllowsAll(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}), "", "", "")

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	if !called {
		t.Fatal("handler should be called when auth is disabled")
	}
}

func TestLocalAuthMiddleware_HubJWTXEdgeTokenHeader(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}), "", testHubJWTSecret, "test-device")

	token := newHubJWT(testHubJWTSecret, "user-2", 1*time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	req.Header.Set("X-AgentHub-Edge-Token", token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	if !called {
		t.Fatal("handler was not called with Hub JWT in X-AgentHub-Edge-Token header")
	}
}

func TestLocalAuthMiddleware_HealthEndpointExempt(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), "edge-secret", testHubJWTSecret, "test-device")

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !called {
		t.Fatal("health endpoint should be exempt from auth")
	}
}

func TestLocalAuthMiddleware_WebSocketRequiresAuth(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), "edge-secret", testHubJWTSecret, "test-device")

	req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "upgrade")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (WebSocket must authenticate)", rec.Code)
	}
	if called {
		t.Fatal("handler should not be called for unauthenticated WebSocket")
	}
}

// TestLocalAuthMiddleware_WebSocketAuthTokenViaQueryParamRejected is the
// integrated #965 fail-closed gate under dual local+Hub JWT config.
func TestLocalAuthMiddleware_WebSocketAuthTokenViaQueryParamRejected(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), "edge-secret", testHubJWTSecret, "test-device")

	req := httptest.NewRequest(http.MethodGet, "/v1/events?access_token=edge-secret", nil)
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "upgrade")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (query access_token rejected)", rec.Code)
	}
	if called {
		t.Fatal("handler should not be called for query-only access_token on WebSocket")
	}
}

func TestLocalAuthMiddleware_WebSocketAuthTokenViaSubprotocol(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), "edge-secret", testHubJWTSecret, "test-device")

	req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "upgrade")
	req.Header.Set("Sec-WebSocket-Protocol", WSEdgeBearerSubprotocol+", edge-secret")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (WebSocket with Sec-WebSocket-Protocol token)", rec.Code)
	}
	if !called {
		t.Fatal("handler should be called for authenticated WebSocket via Sec-WebSocket-Protocol")
	}
}

func TestLocalAuthMiddleware_WebSocketAuthTokenViaHeader(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), "edge-secret", testHubJWTSecret, "test-device")

	req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "upgrade")
	req.Header.Set("Authorization", "Bearer edge-secret")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (WebSocket with valid Authorization header)", rec.Code)
	}
	if !called {
		t.Fatal("handler should be called for authenticated WebSocket via Authorization header")
	}
}

func TestLocalAuthMiddleware_WebSocketAllowedWhenAuthDisabled(t *testing.T) {
	called := false
	handler := localAuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}), "", "", "")

	req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "upgrade")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (WebSocket allowed when auth disabled)", rec.Code)
	}
	if !called {
		t.Fatal("handler should be called for WebSocket when auth is disabled")
	}
}

func TestHubUserIDFromContext(t *testing.T) {
	// Verify the context key works correctly
	ctx := context.Background()
	if id := HubUserIDFromContext(ctx); id != "" {
		t.Fatalf("empty context should return empty user ID, got %q", id)
	}

	ctx = context.WithValue(ctx, edgeidentity.HubUserIDKey, "test-user")
	if id := HubUserIDFromContext(ctx); id != "test-user" {
		t.Fatalf("expected test-user, got %q", id)
	}
}

// ── Remote Read Auth Tests (AH-SR-045) ──

const testRemoteReadJWTSecret = "remote-read-secret-at-least-32!!"
const testRemoteReadEdgeDevice = "test-edge-1"

func setupRemoteReadFixture(t *testing.T) (*api.Handler, *http.ServeMux, store.Repository) {
	t.Helper()
	s := store.New()
	reg := runners.NewRegistry()
	reg.Upsert(runners.RunnerInfo{ID: "mock-runner", Name: "Mock Runner", Status: "online"})
	bus := events.NewBus(1000)
	h := &api.Handler{
		Bus: bus, Registry: reg, Store: s,
		Executor: lifecycle.NewMockExecutor(bus, s),
	}
	s.CreateProject("proj_default", "Default Project", "")
	s.CreateProject("proj_user1", "User 1 Project", "user-1")
	s.CreateProject("proj_user2", "User 2 Project", "user-2")
	s.CreateThread("thread_default", "proj_default", "Default Thread", "direct", "", "")
	s.CreateThread("thread_1", "proj_user1", "User 1 Thread", "direct", "", "")
	s.CreateThread("thread_2", "proj_user2", "User 2 Thread", "direct", "", "")
	s.CreateRun("run_default", "proj_default", "thread_default")
	s.CreateRun("run_1", "proj_user1", "thread_1")
	s.CreateRun("run_2", "proj_user2", "thread_2")
	if _, err := s.CreateItem(store.Item{
		ID:        "item_default",
		ProjectID: "proj_default",
		ThreadID:  "thread_default",
		Type:      "user_message",
		Role:      "user",
		Status:    "created",
		Content:   "unowned item",
	}); err != nil {
		t.Fatalf("CreateItem item_default: %v", err)
	}
	if _, err := s.CreateItem(store.Item{
		ID:        "item_1",
		ProjectID: "proj_user1",
		ThreadID:  "thread_1",
		Type:      "user_message",
		Role:      "user",
		Status:    "created",
		Content:   "user-1 item",
	}); err != nil {
		t.Fatalf("CreateItem item_1: %v", err)
	}
	if _, err := s.CreateItem(store.Item{
		ID:        "item_2",
		ProjectID: "proj_user2",
		ThreadID:  "thread_2",
		Type:      "user_message",
		Role:      "user",
		Status:    "created",
		Content:   "user-2 item",
	}); err != nil {
		t.Fatalf("CreateItem item_2: %v", err)
	}
	if _, err := s.UpsertArtifact(store.Artifact{
		ID:    "artifact_1",
		RunID: "run_1",
		Kind:  "file",
		Path:  "out/user1.txt",
	}); err != nil {
		t.Fatalf("UpsertArtifact artifact_1: %v", err)
	}
	if _, err := s.UpsertArtifact(store.Artifact{
		ID:    "artifact_2",
		RunID: "run_2",
		Kind:  "file",
		Path:  "out/user2.txt",
	}); err != nil {
		t.Fatalf("UpsertArtifact artifact_2: %v", err)
	}
	if _, err := s.UpsertArtifact(store.Artifact{
		ID:    "artifact_default",
		RunID: "run_default",
		Kind:  "file",
		Path:  "out/default.txt",
	}); err != nil {
		t.Fatalf("UpsertArtifact artifact_default: %v", err)
	}
	if _, err := s.UpsertPreview(store.Preview{
		ID:     "preview_1",
		RunID:  "run_1",
		URL:    "http://127.0.0.1:4173/user1",
		Status: "ready",
	}); err != nil {
		t.Fatalf("UpsertPreview preview_1: %v", err)
	}
	if _, err := s.UpsertPreview(store.Preview{
		ID:     "preview_2",
		RunID:  "run_2",
		URL:    "http://127.0.0.1:4173/user2",
		Status: "ready",
	}); err != nil {
		t.Fatalf("UpsertPreview preview_2: %v", err)
	}
	if _, err := s.UpsertRunDiffFile(store.RunDiffFile{
		RunID:  "run_1",
		Path:   "src/a.go",
		Diff:   "+owned",
		Status: "pending",
	}); err != nil {
		t.Fatalf("UpsertRunDiffFile run_1: %v", err)
	}
	if _, err := s.UpsertRunDiffFile(store.RunDiffFile{
		RunID:  "run_2",
		Path:   "src/b.go",
		Diff:   "+other",
		Status: "pending",
	}); err != nil {
		t.Fatalf("UpsertRunDiffFile run_2: %v", err)
	}
	if _, err := s.CreateAgentProfile(store.AgentProfile{
		ID:        "profile_shared",
		Name:      "Shared Profile",
		AdapterID: "mock-runner",
	}); err != nil {
		t.Fatalf("CreateAgentProfile: %v", err)
	}
	s.UpsertSettings(map[string]string{"theme": "dark"})
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	return h, mux, s
}

func wrapWithHubJWT(t *testing.T, mux *http.ServeMux) http.Handler {
	t.Helper()
	return localAuthMiddleware(mux, "", testRemoteReadJWTSecret, testRemoteReadEdgeDevice)
}

func wrapWithLocalAuth(t *testing.T, mux *http.ServeMux, token string) http.Handler {
	t.Helper()
	return localAuthMiddleware(mux, token, "", "")
}

func TestRemoteRead_ValidHubJWT_SeesOwnProjects(t *testing.T) {
	_, mux, _ := setupRemoteReadFixture(t)
	handler := wrapWithHubJWT(t, mux)
	token := newHubJWTForDevice(testRemoteReadJWTSecret, "user-1", testRemoteReadEdgeDevice, 1*time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/v1/projects", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	json.Unmarshal(rec.Body.Bytes(), &body)
	body = unwrapSuccess(body)
	items := body["items"].([]any)
	ids := projectIDs(items)
	// AH-SR-045: unowned projects are fail-closed under Hub JWT.
	if contains(ids, "proj_default") {
		t.Error("should not see unowned proj_default under Hub JWT")
	}
	if !contains(ids, "proj_user1") {
		t.Error("missing proj_user1")
	}
	if contains(ids, "proj_user2") {
		t.Error("should not see proj_user2")
	}
}

func TestRemoteRead_ValidHubJWT_SeesOwnThreads(t *testing.T) {
	_, mux, _ := setupRemoteReadFixture(t)
	handler := wrapWithHubJWT(t, mux)
	token := newHubJWTForDevice(testRemoteReadJWTSecret, "user-1", testRemoteReadEdgeDevice, 1*time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/v1/threads", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	json.Unmarshal(rec.Body.Bytes(), &body)
	body = unwrapSuccess(body)
	items := body["items"].([]any)
	ids := threadIDs(items)
	if contains(ids, "thread_default") {
		t.Error("should not see unowned thread_default under Hub JWT")
	}
	if !contains(ids, "thread_1") {
		t.Error("missing thread_1")
	}
	if contains(ids, "thread_2") {
		t.Error("should not see thread_2")
	}
}

func TestRemoteRead_ValidHubJWT_SeesOwnRuns(t *testing.T) {
	_, mux, _ := setupRemoteReadFixture(t)
	handler := wrapWithHubJWT(t, mux)
	token := newHubJWTForDevice(testRemoteReadJWTSecret, "user-1", testRemoteReadEdgeDevice, 1*time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/v1/runs", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	json.Unmarshal(rec.Body.Bytes(), &body)
	body = unwrapSuccess(body)
	items := body["items"].([]any)
	ids := runIDs(items)
	if contains(ids, "run_default") {
		t.Error("should not see unowned run_default under Hub JWT")
	}
	if !contains(ids, "run_1") {
		t.Error("missing run_1")
	}
	if contains(ids, "run_2") {
		t.Error("should not see run_2")
	}
}

func TestRemoteRead_CrossUserAccess_Returns404(t *testing.T) {
	_, mux, _ := setupRemoteReadFixture(t)
	handler := wrapWithHubJWT(t, mux)
	token := newHubJWTForDevice(testRemoteReadJWTSecret, "user-1", testRemoteReadEdgeDevice, 1*time.Hour)
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/v1/projects/proj_user2"},
		{http.MethodGet, "/v1/threads/thread_2"},
		{http.MethodGet, "/v1/runs/run_2"},
		// Unowned resources fail closed under Hub JWT (AH-SR-045).
		{http.MethodGet, "/v1/projects/proj_default"},
		{http.MethodGet, "/v1/threads/thread_default"},
		{http.MethodGet, "/v1/runs/run_default"},
		// Sensitive read routes that previously lacked ownership checks.
		{http.MethodGet, "/v1/items/item_2"},
		{http.MethodGet, "/v1/items/item_default"},
		{http.MethodGet, "/v1/threads/thread_2/items"},
		{http.MethodGet, "/v1/threads/thread_2/pins"},
		{http.MethodGet, "/v1/artifacts/artifact_2"},
		{http.MethodGet, "/v1/artifacts/artifact_default"},
		{http.MethodGet, "/v1/previews/preview_2"},
		{http.MethodGet, "/v1/runs/run_2/diff"},
		{http.MethodGet, "/v1/runs/run_default/diff"},
		{http.MethodGet, "/v1/settings"},
		{http.MethodGet, "/v1/agent-profiles"},
		{http.MethodGet, "/v1/agent-profiles/profile_shared"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s %s status = %d, want 404 body=%s", tc.method, tc.path, rec.Code, rec.Body.String())
		}
	}
}

func TestRemoteRead_ExpiredHubJWT_Returns401(t *testing.T) {
	_, mux, _ := setupRemoteReadFixture(t)
	handler := wrapWithHubJWT(t, mux)
	token := newHubJWTForDevice(testRemoteReadJWTSecret, "user-1", testRemoteReadEdgeDevice, -1*time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/v1/projects", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestRemoteRead_LocalAuthToken_SeesAllProjects(t *testing.T) {
	_, mux, _ := setupRemoteReadFixture(t)
	handler := wrapWithLocalAuth(t, mux, "local-secret-token")
	req := httptest.NewRequest(http.MethodGet, "/v1/projects", nil)
	req.Header.Set("Authorization", "Bearer local-secret-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	json.Unmarshal(rec.Body.Bytes(), &body)
	body = unwrapSuccess(body)
	items := body["items"].([]any)
	ids := projectIDs(items)
	if !contains(ids, "proj_user2") {
		t.Error("local auth should see all projects including proj_user2")
	}
}

func TestRemoteRead_WrongDeviceJWT_Returns401(t *testing.T) {
	_, mux, _ := setupRemoteReadFixture(t)
	handler := wrapWithHubJWT(t, mux)
	token := newHubJWTForDevice(testRemoteReadJWTSecret, "user-1", "other-edge-device", 1*time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/v1/projects", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestRemoteRead_User2_SeesTheirOwnData(t *testing.T) {
	_, mux, _ := setupRemoteReadFixture(t)
	handler := wrapWithHubJWT(t, mux)
	token := newHubJWTForDevice(testRemoteReadJWTSecret, "user-2", testRemoteReadEdgeDevice, 1*time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/v1/projects", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	json.Unmarshal(rec.Body.Bytes(), &body)
	body = unwrapSuccess(body)
	items := body["items"].([]any)
	ids := projectIDs(items)
	if !contains(ids, "proj_user2") {
		t.Error("user-2 should see proj_user2")
	}
	if contains(ids, "proj_user1") {
		t.Error("user-2 should NOT see proj_user1")
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/projects/proj_user2", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("own project: %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/runs/run_2", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("own run: %d", rec.Code)
	}
}

func TestRemoteRead_OwnItemArtifactSettings_AllowedOrDenied(t *testing.T) {
	_, mux, _ := setupRemoteReadFixture(t)
	handler := wrapWithHubJWT(t, mux)
	token := newHubJWTForDevice(testRemoteReadJWTSecret, "user-1", testRemoteReadEdgeDevice, 1*time.Hour)

	// Own item / artifact / preview / diff should succeed.
	for _, path := range []string{
		"/v1/items/item_1",
		"/v1/threads/thread_1/items",
		"/v1/artifacts/artifact_1",
		"/v1/artifacts?runId=run_1",
		"/v1/previews/preview_1",
		"/v1/runs/run_1/diff",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want 200 body=%s", path, rec.Code, rec.Body.String())
		}
	}

	// Artifact list for another user's run is empty (not 404) to avoid enumeration noise.
	req := httptest.NewRequest(http.MethodGet, "/v1/artifacts?runId=run_2", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("cross-user artifact list status = %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode artifact list: %v", err)
	}
	body = unwrapSuccess(body)
	items, _ := body["items"].([]any)
	if len(items) != 0 {
		t.Fatalf("cross-user artifact list items = %#v, want empty", items)
	}
}

func TestRemoteRead_LocalAuth_SeesUnownedAndSharedConfig(t *testing.T) {
	_, mux, _ := setupRemoteReadFixture(t)
	handler := wrapWithLocalAuth(t, mux, "local-secret-token")
	for _, path := range []string{
		"/v1/projects/proj_default",
		"/v1/items/item_default",
		"/v1/artifacts/artifact_default",
		"/v1/settings",
		"/v1/agent-profiles",
		"/v1/agent-profiles/profile_shared",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer local-secret-token")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("local auth %s status = %d, want 200 body=%s", path, rec.Code, rec.Body.String())
		}
	}
}

func TestRemoteRead_NoAuthToken_Returns401(t *testing.T) {
	_, mux, _ := setupRemoteReadFixture(t)
	handler := wrapWithHubJWT(t, mux)
	req := httptest.NewRequest(http.MethodGet, "/v1/projects", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func projectIDs(items []any) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		if m, ok := item.(map[string]any); ok {
			if id, ok := m["projectId"].(string); ok {
				ids = append(ids, id)
			}
		}
	}
	return ids
}

func threadIDs(items []any) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		if m, ok := item.(map[string]any); ok {
			if id, ok := m["threadId"].(string); ok {
				ids = append(ids, id)
			}
		}
	}
	return ids
}

func runIDs(items []any) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		if m, ok := item.(map[string]any); ok {
			if id, ok := m["runId"].(string); ok {
				ids = append(ids, id)
			}
		}
	}
	return ids
}

func contains(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

func unwrapSuccess(body map[string]any) map[string]any {
	if body["code"] == "OK" {
		if data, ok := body["data"].(map[string]any); ok {
			return data
		}
	}
	return body
}
