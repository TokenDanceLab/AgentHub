package dispatchsvc

// #1549 contract tests for the Hub→Edge dispatch client: URL/token must come
// from the injected config (composition root), never from process env, and
// the shared client must respect the caller's deadline even when it is
// shorter than the configured client timeout.

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/outboundhttp"
)

// TestDispatchToEdgeHTTP_UsesInjectedConfigNotEnv pins the #1549 guarantee:
// dispatch requests go to the configured URL with the configured token even
// when misleading AGENTHUB_EDGE_* env vars are present — the service layer
// no longer reads process env.
func TestDispatchToEdgeHTTP_UsesInjectedConfigNotEnv(t *testing.T) {
	var gotPath, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success":true,"data":{"runId":"run-42"}}`))
	}))
	defer srv.Close()

	// Env points at a dead address and a wrong token; the injected config must win.
	t.Setenv("AGENTHUB_EDGE_URL", "http://127.0.0.1:1")
	t.Setenv("AGENTHUB_EDGE_AUTH_TOKEN", "env-token-must-not-be-used")

	ds := NewDispatchService(nil, nil, nil, nil, nil, nil, config.EdgeDispatchConfig{
		URL:       srv.URL,
		AuthToken: "cfg-token",
		Timeout:   5 * time.Second,
	}, outboundhttp.NewClient(5*time.Second), "cfg-jwt-secret")

	task := &model.PendingAgentTask{ID: "task-1", AgentInstanceID: "ai-1"}
	dp := dispatchPayload{
		TaskID:           "task-1",
		AgentInstanceID:  "ai-1",
		AgentType:        "codex",
		SessionID:        "sess-1",
		TriggerMessageID: "msg-1",
		TriggerUserID:    "user-1",
		Prompt:           "hello",
		DisplayName:      "agent",
	}
	runID := ds.dispatchToEdgeHTTP(context.Background(), task, &dp)

	assert.Equal(t, "run-42", runID, "successful dispatch must return the Edge run id")
	assert.Equal(t, "/v1/runs", gotPath)
	assert.Equal(t, "Bearer cfg-token", gotAuth, "token must come from injected config")
}

// TestDispatchToEdgeHTTP_CallerDeadlineCancels pins that a caller deadline
// shorter than the client timeout cancels the request promptly instead of
// blocking for the full client timeout (#1549: retry/timeout must respect
// the caller deadline).
func TestDispatchToEdgeHTTP_CallerDeadlineCancels(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Never respond; block until the client gives up or the test ends.
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	t.Cleanup(func() { close(release); srv.Close() })

	ds := NewDispatchService(nil, nil, nil, nil, nil, nil, config.EdgeDispatchConfig{
		URL:     srv.URL,
		Timeout: 10 * time.Second, // client timeout is generous
	}, outboundhttp.NewClient(10*time.Second), "")

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	task := &model.PendingAgentTask{ID: "task-2", AgentInstanceID: "ai-2"}
	dp := dispatchPayload{
		TaskID: "task-2", AgentInstanceID: "ai-2", AgentType: "codex",
		SessionID: "sess-2", TriggerMessageID: "msg-2", TriggerUserID: "user-2",
		Prompt: "hello", DisplayName: "agent",
	}

	start := time.Now()
	runID := ds.dispatchToEdgeHTTP(ctx, task, &dp)
	elapsed := time.Since(start)

	assert.Equal(t, "", runID, "cancelled request must not dispatch")
	require.Less(t, elapsed, 9*time.Second,
		"caller deadline must win over the 10s client timeout (took %v)", elapsed)
}

// TestDispatchToEdgeHTTP_NonSuccessLogUsesSummaryNotRawBody pins the #2120
// slice-1 security contract: when Edge returns a non-success status, the warn
// log must contain a body_summary field (length + sanitized prefix) and must
// NOT contain the raw response body as a string value. A long, unique sentinel
// embedded in the response proves the raw text does not leak through slog.
func TestDispatchToEdgeHTTP_NonSuccessLogUsesSummaryNotRawBody(t *testing.T) {
	const sentinel = "UNIQUE-SENTINEL-DO-NOT-LOG-9f3b8a2e7c1d"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		// Body is well past the summary prefix cap so the sentinel cannot
		// appear even accidentally via prefix leakage.
		_, _ = w.Write([]byte(strings.Repeat("x", defaultBodySummaryPrefixBytes+64) + sentinel))
	}))
	defer srv.Close()

	var logBuf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	ds := NewDispatchService(nil, nil, nil, nil, nil, nil, config.EdgeDispatchConfig{
		URL:     srv.URL,
		Timeout: 5 * time.Second,
	}, outboundhttp.NewClient(5*time.Second), "")

	task := &model.PendingAgentTask{ID: "task-log", AgentInstanceID: "ai-log"}
	dp := dispatchPayload{
		TaskID: "task-log", AgentInstanceID: "ai-log", AgentType: "codex",
		SessionID: "sess-log", TriggerMessageID: "msg-log", TriggerUserID: "user-log",
		Prompt: "hello", DisplayName: "agent",
	}
	runID := ds.dispatchToEdgeHTTP(context.Background(), task, &dp)

	assert.Equal(t, "", runID, "non-success dispatch must return empty run id")
	logged := logBuf.String()
	assert.Contains(t, logged, `"body_summary":"len=`)
	assert.NotContains(t, logged, sentinel,
		"raw body sentinel must not appear in logs (leak surface)")
	// Also ensure we did not accidentally keep the old "body" key with raw text.
	assert.NotContains(t, logged, `,"body":"`)
}
