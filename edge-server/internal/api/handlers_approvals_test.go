package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/adapters/claude"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/permission"
	"github.com/agenthub/edge-server/internal/store"
)

func TestPostPermissionDecideRejectsInvalidDecision(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(`{"runId":"run_1","requestId":"req_1","decision":"maybe"}`))
	rec := httptest.NewRecorder()

	h.PostPermissionDecide(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrInvalidDecision.Code)
}

func TestPostPermissionDecideRequiresRunAndRequest(t *testing.T) {
	t.Run("missing_run", func(t *testing.T) {
		h := newTestHandler()
		req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(`{"requestId":"req_1","decision":"allow"}`))
		rec := httptest.NewRecorder()

		h.PostPermissionDecide(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
		}
		assertErrorCode(t, rec.Body.String(), errcode.ErrRunIDRequired.Code)
	})

	t.Run("missing_request", func(t *testing.T) {
		h := newTestHandler()
		req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(`{"runId":"run_1","decision":"allow"}`))
		rec := httptest.NewRecorder()

		h.PostPermissionDecide(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
		}
		assertErrorCode(t, rec.Body.String(), errcode.ErrRequestIDRequired.Code)
	})
}

func TestPostPermissionDecideRejectsUnknownRequest(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(`{"runId":"run_1","requestId":"req_missing","decision":"allow"}`))
	rec := httptest.NewRecorder()

	h.PostPermissionDecide(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrPermissionRequestNotFound.Code)
}

func TestPostPermissionDecideRejectsWrongRun(t *testing.T) {
	h := newTestHandler()
	h.ensurePermissionRegistry().Register(permission.PendingPermission{
		RunID:     "run_real",
		RequestID: "req_1",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(`{"runId":"run_spoof","requestId":"req_1","decision":"allow"}`))
	rec := httptest.NewRecorder()

	h.PostPermissionDecide(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrPermissionRequestNotFound.Code)
	if _, ok := h.PermissionRegistry.Consume("run_real", "req_1"); !ok {
		t.Fatal("wrong-run decision consumed the real pending request")
	}
}

func TestPostPermissionDecideConsumesPendingRequestAndPublishesEvent(t *testing.T) {
	h := newTestHandler()
	h.ensurePermissionRegistry().Register(permission.PendingPermission{
		ProjectID: "proj_1",
		ThreadID:  "thread_1",
		RunID:     "run_1",
		RequestID: "req_1",
		ToolName:  "Bash",
		ToolUseID: "tool_1",
	})
	_, ch, _ := h.Bus.Subscribe(0)
	req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(`{"runId":"run_1","requestId":"req_1","decision":"deny","reason":"not now"}`))
	rec := httptest.NewRecorder()

	h.PostPermissionDecide(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	body = unwrapSuccess(body)
	if body["status"] != "ok" {
		t.Fatalf("body status = %#v, want ok", body["status"])
	}
	select {
	case evt := <-ch:
		if evt.Type != "run.agent.permission_decided" {
			t.Fatalf("event type = %q, want permission_decided", evt.Type)
		}
		if evt.Scope["projectId"] != "proj_1" || evt.Scope["threadId"] != "thread_1" || evt.Scope["runId"] != "run_1" {
			t.Fatalf("event scope = %#v, want project/thread/run", evt.Scope)
		}
		payload := evt.Payload.(map[string]any)
		if payload["requestId"] != "req_1" || payload["decision"] != "deny" || payload["reason"] != "not now" {
			t.Fatalf("event payload = %#v, want deny decision", payload)
		}
		if payload["toolName"] != "Bash" || payload["toolUseId"] != "tool_1" {
			t.Fatalf("event payload missing tool metadata: %#v", payload)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for permission_decided event")
	}
	if _, ok := h.PermissionRegistry.Consume("run_1", "req_1"); ok {
		t.Fatal("pending request remained after decision")
	}
}

func TestPostPermissionDecideUnblocksWaitingPermissionRequest(t *testing.T) {
	for _, tt := range []struct {
		name     string
		decision string
		reason   string
	}{
		{name: "allow", decision: "allow"},
		{name: "deny", decision: "deny", reason: "not safe"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler()
			broker := h.ensurePermissionBroker()
			wait, ok := broker.Begin(adapters.PermissionScope{
				ProjectID: "proj_1",
				ThreadID:  "thread_1",
				RunID:     "run_1",
			}, adapters.PermissionRequest{
				RequestID: "req_1",
				ToolName:  "Bash",
				ToolUseID: "tool_1",
			})
			if !ok {
				t.Fatal("failed to begin pending permission request")
			}

			resultCh := make(chan adapters.PermissionDecision, 1)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			go func() {
				resultCh <- wait(ctx)
			}()

			body := fmt.Sprintf(`{"runId":"run_1","requestId":"req_1","decision":%q,"reason":%q}`, tt.decision, tt.reason)
			req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(body))
			rec := httptest.NewRecorder()
			h.PostPermissionDecide(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			select {
			case got := <-resultCh:
				if got.Behavior != tt.decision {
					t.Fatalf("Behavior = %q, want %q", got.Behavior, tt.decision)
				}
				if got.Message != tt.reason {
					t.Fatalf("Message = %q, want %q", got.Message, tt.reason)
				}
			case <-time.After(time.Second):
				t.Fatal("timed out waiting for broker decision")
			}
		})
	}
}

func TestRegisterRoutesInstallsPermissionBrokerOnClaudeAdapter(t *testing.T) {
	h := newTestHandler()
	adapterRegistry := adapters.NewRegistry()
	claudeAdapter := claude.NewClaudeCodeAdapter("claude", "", "")
	if err := adapterRegistry.Register(claudeAdapter); err != nil {
		t.Fatalf("register adapter: %v", err)
	}
	h.AdapterRegistry = adapterRegistry
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	inner, _ := json.Marshal(adapters.ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Bash",
		ToolUseID: "tool_1",
	})
	msg, _ := json.Marshal(adapters.ControlMessage{
		Type:      "control_request",
		RequestID: "req_1",
		Request:   inner,
	})
	var stdin bytes.Buffer
	done := make(chan error, 1)
	run := store.Run{ID: "run_1", ProjectID: "proj_1", ThreadID: "thread_1", Status: "started"}

	go func() {
		done <- claudeAdapter.ParseStream(context.Background(), strings.NewReader(string(msg)+"\n"), &stdin, adapters.NewBusEventEmitter(h.Bus), run)
	}()

	select {
	case err := <-done:
		t.Fatalf("ParseStream returned before /permissions/decide: %v", err)
	case <-time.After(50 * time.Millisecond):
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(`{"runId":"run_1","requestId":"req_1","decision":"allow"}`))
	rec := httptest.NewRecorder()
	h.PostPermissionDecide(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ParseStream: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("ParseStream did not resume after /permissions/decide")
	}
	if !strings.Contains(stdin.String(), `"behavior":"allow"`) {
		t.Fatalf("stdin response = %s, want allow control response", stdin.String())
	}
}

func TestPostPermissionDecideRejectsSecondDecision(t *testing.T) {
	h := newTestHandler()
	h.ensurePermissionRegistry().Register(permission.PendingPermission{
		RunID:     "run_1",
		RequestID: "req_1",
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(`{"runId":"run_1","requestId":"req_1","decision":"allow"}`))
	rec := httptest.NewRecorder()
	h.PostPermissionDecide(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("first status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(`{"runId":"run_1","requestId":"req_1","decision":"deny"}`))
	rec = httptest.NewRecorder()
	h.PostPermissionDecide(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("second status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrPermissionRequestNotFound.Code)
}

func TestPostPermissionDecideRejectsExpiredRequestWithoutPublishing(t *testing.T) {
	h := newTestHandler()
	now := time.Date(2026, 5, 29, 8, 0, 0, 0, time.UTC)
	registry := permission.NewPermissionRegistryWithClock(time.Minute, func() time.Time { return now })
	h.PermissionRegistry = registry
	h.PermissionRegistry.Register(permission.PendingPermission{
		ProjectID: "proj_1",
		ThreadID:  "thread_1",
		RunID:     "run_1",
		RequestID: "req_1",
		ToolName:  "Bash",
		ToolUseID: "tool_1",
	})

	now = now.Add(2 * time.Minute)
	req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(`{"runId":"run_1","requestId":"req_1","decision":"allow"}`))
	rec := httptest.NewRecorder()
	h.PostPermissionDecide(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrPermissionRequestNotFound.Code)
	if got := h.Bus.HistoryLen(); got != 0 {
		t.Fatalf("event history len = %d, want 0", got)
	}
}

func TestMuxPermissionDecideWrongMethod(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/permissions/decide", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET /v1/permissions/decide status = %d, want 405", rec.Code)
	}
}
