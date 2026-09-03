package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/deliverydedup"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/store"
)

func newTestHandler() *Handler {
	bus := events.NewBus(1000)
	s := store.New()
	reg := runners.NewRegistry()
	reg.Upsert(runners.RunnerInfo{
		ID:     "mock-runner",
		Name:   "Mock Runner",
		Status: "online",
	})
	return &Handler{
		DeliveryDedup: deliverydedup.New(deliverydedup.DefaultCapacity, deliverydedup.DefaultTTL),
		Bus:           bus,
		Registry:      reg,
		Store:         s,
		Executor:      lifecycle.NewMockExecutor(bus, s),
	}
}

type fakeRunExecutor struct {
	started  []store.Run
	contexts []lifecycle.RunProcessContext
	cancel   lifecycle.CancelResult
	cancels  []string
	err      error
}

func (f *fakeRunExecutor) Start(run store.Run, ctx lifecycle.RunProcessContext) error {
	f.started = append(f.started, run)
	f.contexts = append(f.contexts, ctx)
	return f.err
}

func (f *fakeRunExecutor) Cancel(runID string) lifecycle.CancelResult {
	f.cancels = append(f.cancels, runID)
	return f.cancel
}

func allowTestWorkspace(t *testing.T, h *Handler) string {
	t.Helper()
	workDir := t.TempDir()
	h.WorkspaceAllowlist = []string{workDir}
	return workDir
}

func TestErrorResponseFormat(t *testing.T) {
	errBody := errcode.ErrorBody(errcode.ErrNotFound.WithMessage("something went wrong"))
	data, _ := json.Marshal(errBody)

	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("expected error object, got %T", body["error"])
	}
	if errObj["code"] != errcode.ErrNotFound.Code {
		t.Errorf("expected code=%s, got %v", errcode.ErrNotFound.Code, errObj["code"])
	}
	if errObj["message"] != "something went wrong" {
		t.Errorf("expected message, got %v", errObj["message"])
	}
	if errObj["traceId"] == nil || errObj["traceId"].(string) == "" {
		t.Error("expected non-empty traceId")
	}
}

func TestMuxUnknownPath(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/nonexistent", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func drainEvents(t *testing.T, ch <-chan events.EventEnvelope, count int) {
	t.Helper()
	for i := 0; i < count; i++ {
		select {
		case <-ch:
		case <-time.After(500 * time.Millisecond):
			t.Fatalf("timed out draining event %d of %d", i+1, count)
		}
	}
}

func assertNextEvent(t *testing.T, ch <-chan events.EventEnvelope, wantType, wantThreadID, wantItemID string) {
	t.Helper()
	select {
	case evt := <-ch:
		if evt.Type != wantType {
			t.Fatalf("event type = %q, want %q", evt.Type, wantType)
		}
		if evt.Scope["threadId"] != wantThreadID || evt.Scope["itemId"] != wantItemID {
			t.Fatalf("event scope = %#v, want thread/item", evt.Scope)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("timed out waiting for %s event", wantType)
	}
}

func TestEnsureStoreNilRepoCreatesInMemory(t *testing.T) {
	h := &Handler{}
	repo := ensureStore(h)
	if repo == nil {
		t.Fatal("ensureStore should create an in-memory store")
	}
	if h.Store == nil {
		t.Fatal("Store should be set by ensureStore")
	}
	// Verify defaults were created
	_, ok := repo.GetProject("proj_local")
	if !ok {
		t.Fatal("expected proj_local to be created by defaults")
	}
}

func assertErrorCode(t *testing.T, body string, want string) {
	t.Helper()
	var decoded map[string]any
	if err := json.Unmarshal([]byte(body), &decoded); err != nil {
		t.Fatalf("failed to decode error body %q: %v", body, err)
	}
	errObj, ok := decoded["error"].(map[string]any)
	if !ok {
		t.Fatalf("error body = %#v, want error object", decoded)
	}
	if errObj["code"] != want {
		t.Fatalf("error code = %#v, want %q", errObj["code"], want)
	}
}

// unwrapSuccess extracts data from the unified {"code":"ok","data":...} envelope
// (older builds emitted "OK"; both casings are accepted).
// Returns the inner data map when an envelope is present, or body unchanged for
// backward compatibility with raw/non-envelope responses (e.g. error responses).

func unwrapSuccess(body map[string]any) map[string]any {
	if body["code"] == "ok" || body["code"] == "OK" {
		if data, ok := body["data"].(map[string]any); ok {
			return data
		}
	}
	return body
}

type fakeCallbackJournal struct {
	entries []hub.DeliveryJournalEntry
}

func (f *fakeCallbackJournal) DurableSnapshot(afterSeq uint64) ([]hub.DeliveryJournalEntry, error) {
	var out []hub.DeliveryJournalEntry
	for _, e := range f.entries {
		if e.Seq > afterSeq {
			out = append(out, e)
		}
	}
	return out, nil
}
