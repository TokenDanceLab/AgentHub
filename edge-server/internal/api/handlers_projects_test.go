package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/store"
)

type recordingRepository struct {
	store.Repository
	createProjectCalls int
}

func (r *recordingRepository) CreateProject(id, name, ownerID string) (store.Project, error) {
	r.createProjectCalls++
	return r.Repository.CreateProject(id, name, ownerID)
}

type corruptPinRepository struct {
	store.Repository
	pins []store.ThreadPin
}

func (r *corruptPinRepository) ListThreadPins(threadID string) []store.ThreadPin {
	return append([]store.ThreadPin(nil), r.pins...)
}

func TestProjectThreadRoutes(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/projects", strings.NewReader(`{"projectId":"proj_test","name":"Test Project"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/projects status = %d, want 201", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/threads", strings.NewReader(`{"threadId":"thread_test","projectId":"proj_test","title":"Test Thread"}`))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/threads status = %d, want 201", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/threads?projectId=proj_test", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/threads status = %d, want 200", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	body = unwrapSuccess(body)
	items := body["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected one thread, got %d", len(items))
	}
	thread := items[0].(map[string]any)
	if thread["threadId"] != "thread_test" || thread["projectId"] != "proj_test" {
		t.Fatalf("unexpected thread response: %#v", thread)
	}
}

func TestThreadUpdateArchiveDeleteRoutes(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	h.ensureDefaults()
	if _, err := h.Store.CreateThread("thread_manage", "proj_local", "Manage Thread", "", "", ""); err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	if _, err := h.Store.CreateRun("run_manage", "proj_local", "thread_manage"); err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if _, err := h.Store.CreateThreadMessage("item_manage", "thread_manage", "user", "hello"); err != nil {
		t.Fatalf("CreateThreadMessage returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPatch, "/v1/threads/thread_manage", strings.NewReader(`{"title":"Renamed","status":"active"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /v1/threads/thread_manage status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode patch body: %v", err)
	}
	body = unwrapSuccess(body)
	if body["title"] != "Renamed" || body["status"] != "active" {
		t.Fatalf("patch body = %#v, want renamed active thread", body)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/threads/thread_manage:archive", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("POST archive status = %d, want 202 body=%s", rec.Code, rec.Body.String())
	}
	thread, ok := h.Store.GetThread("thread_manage")
	if !ok || thread.Status != "archived" {
		t.Fatalf("archived thread = %#v ok=%v, want archived", thread, ok)
	}

	req = httptest.NewRequest(http.MethodDelete, "/v1/threads/thread_manage", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE /v1/threads/thread_manage status = %d, want 204 body=%s", rec.Code, rec.Body.String())
	}
	if _, ok := h.Store.GetThread("thread_manage"); ok {
		t.Fatal("thread still exists after delete")
	}
	if runs := h.Store.ListRuns("thread_manage"); len(runs) != 0 {
		t.Fatalf("runs after delete = %#v, want none", runs)
	}
	if items := h.Store.ListThreadItems("thread_manage"); len(items) != 0 {
		t.Fatalf("items after delete = %#v, want none", items)
	}
}

func TestHandlerAcceptsInjectedRepository(t *testing.T) {
	repository := &recordingRepository{Repository: store.New()}
	h := &Handler{
		Bus:      events.NewBus(1000),
		Registry: runners.NewRegistry(),
		Store:    repository,
	}
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/projects", strings.NewReader(`{"projectId":"proj_injected","name":"Injected"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/projects status = %d, want 201", rec.Code)
	}
	if repository.createProjectCalls < 2 {
		t.Fatalf("CreateProject calls = %d, want defaults plus request through injected repository", repository.createProjectCalls)
	}
	project, ok := repository.GetProject("proj_injected")
	if !ok {
		t.Fatal("injected repository did not store proj_injected")
	}
	if project.Name != "Injected" {
		t.Fatalf("project name = %q, want Injected", project.Name)
	}
}

func TestGetRunAndThreadItemsAfterPostRun(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"workDir":%q}`, workDir)))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("POST /v1/runs status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	var runBody map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&runBody); err != nil {
		t.Fatalf("failed to decode run body: %v", err)
	}
	runBody = unwrapSuccess(runBody)
	runID := runBody["runId"].(string)

	req = httptest.NewRequest(http.MethodGet, "/v1/runs/"+runID, nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/runs/{id} status = %d, want 200", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/threads/thread_local/items", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/threads/thread_local/items status = %d, want 200", rec.Code)
	}
	var itemBody map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&itemBody); err != nil {
		t.Fatalf("failed to decode item body: %v", err)
	}
	itemBody = unwrapSuccess(itemBody)
	items := itemBody["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected one run item, got %d", len(items))
	}
}

func TestPostThreadMessageCreatesItem(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/threads/thread_local/messages", strings.NewReader(`{"content":"hello from user"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/threads/thread_local/messages status = %d, want 201", rec.Code)
	}

	var itemRaw map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&itemRaw); err != nil {
		t.Fatalf("failed to decode item body: %v", err)
	}
	itemRaw = unwrapSuccess(itemRaw)
	itemBytes, _ := json.Marshal(itemRaw)
	var item store.Item
	json.Unmarshal(itemBytes, &item)
	if !strings.HasPrefix(item.ID, "item_") {
		t.Fatalf("item ID = %q, want item_ prefix", item.ID)
	}
	if item.ProjectID != "proj_local" || item.ThreadID != "thread_local" {
		t.Fatalf("item scope = %#v, want default project/thread", item)
	}
	if item.Type != "user_message" || item.Role != "user" || item.Status != "created" {
		t.Fatalf("item metadata = %#v, want user_message/user/created", item)
	}
	if item.Content != "hello from user" {
		t.Fatalf("item content = %q, want request content", item.Content)
	}

	stored, ok := h.Store.GetItem(item.ID)
	if !ok {
		t.Fatalf("item %q was not stored", item.ID)
	}
	if stored.Content != item.Content {
		t.Fatalf("stored item content = %q, want %q", stored.Content, item.Content)
	}
}

func TestPostThreadMessageUsesRequestedRole(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/threads/thread_local/messages", strings.NewReader(`{"role":"assistant","content":"agent reply"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/threads/thread_local/messages status = %d, want 201", rec.Code)
	}
	var itemRaw map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&itemRaw); err != nil {
		t.Fatalf("failed to decode item body: %v", err)
	}
	itemRaw = unwrapSuccess(itemRaw)
	itemBytes, _ := json.Marshal(itemRaw)
	var item store.Item
	json.Unmarshal(itemBytes, &item)
	if item.Role != "assistant" {
		t.Fatalf("item role = %q, want assistant", item.Role)
	}
}

func TestThreadPinsPersistPerThreadItem(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	_, ch, _ := h.Bus.Subscribe(0)

	req := httptest.NewRequest(http.MethodPost, "/v1/threads/thread_local/messages", strings.NewReader(`{"content":"pin this message"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/threads/thread_local/messages status = %d, want 201", rec.Code)
	}
	var itemRaw map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&itemRaw); err != nil {
		t.Fatalf("failed to decode item body: %v", err)
	}
	itemRaw = unwrapSuccess(itemRaw)
	itemID := itemRaw["itemId"].(string)
	drainEvents(t, ch, 2)

	req = httptest.NewRequest(http.MethodPost, "/v1/threads/thread_local/pins", strings.NewReader(`{"itemId":"`+itemID+`","pinnedBy":" demo-user "}`))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/threads/thread_local/pins status = %d, want 201 body=%s", rec.Code, rec.Body.String())
	}
	assertNextEvent(t, ch, "thread.pin.created", "thread_local", itemID)

	req = httptest.NewRequest(http.MethodPost, "/v1/threads/thread_local/pins", strings.NewReader(`{"itemId":"`+itemID+`","pinnedBy":"AgentHub"}`))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST duplicate /pins status = %d, want 201 body=%s", rec.Code, rec.Body.String())
	}
	assertNextEvent(t, ch, "thread.pin.created", "thread_local", itemID)

	req = httptest.NewRequest(http.MethodGet, "/v1/threads/thread_local/pins", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/threads/thread_local/pins status = %d, want 200", rec.Code)
	}
	var pinsRaw map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&pinsRaw); err != nil {
		t.Fatalf("failed to decode pins body: %v", err)
	}
	pinsRaw = unwrapSuccess(pinsRaw)
	pins := pinsRaw["items"].([]any)
	if len(pins) != 1 {
		t.Fatalf("pins = %d, want 1", len(pins))
	}
	pin := pins[0].(map[string]any)
	if pin["itemId"] != itemID || pin["pinnedBy"] != "AgentHub" {
		t.Fatalf("pin = %#v, want updated pinned item metadata", pin)
	}
	item := pin["item"].(map[string]any)
	if item["content"] != "pin this message" {
		t.Fatalf("pin item content = %q", item["content"])
	}

	req = httptest.NewRequest(http.MethodDelete, "/v1/threads/thread_local/pins?itemId="+itemID, nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE /v1/threads/thread_local/pins status = %d, want 204", rec.Code)
	}
	assertNextEvent(t, ch, "thread.pin.deleted", "thread_local", itemID)
	if pins := h.Store.ListThreadPins("thread_local"); len(pins) != 0 {
		t.Fatalf("stored pins = %#v, want empty", pins)
	}
}

func TestThreadPinsRejectInvalidRequests(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	item, err := h.Store.CreateThreadMessage("item_local", "thread_local", "user", "hello")
	if err != nil {
		t.Fatalf("CreateThreadMessage returned error: %v", err)
	}
	_, _ = h.Store.CreateThread("thread_other", "proj_local", "Other", "", "", "")
	otherItem, err := h.Store.CreateThreadMessage("item_other", "thread_other", "user", "other")
	if err != nil {
		t.Fatalf("CreateThreadMessage other returned error: %v", err)
	}

	tests := []struct {
		name   string
		method string
		path   string
		body   string
		want   int
	}{
		{name: "get unknown thread", method: http.MethodGet, path: "/v1/threads/thread_missing/pins", want: http.StatusNotFound},
		{name: "post bad json", method: http.MethodPost, path: "/v1/threads/thread_local/pins", body: `{"itemId":`, want: http.StatusBadRequest},
		{name: "post missing item", method: http.MethodPost, path: "/v1/threads/thread_local/pins", body: `{}`, want: http.StatusBadRequest},
		{name: "post unknown item", method: http.MethodPost, path: "/v1/threads/thread_local/pins", body: `{"itemId":"item_missing"}`, want: http.StatusNotFound},
		{name: "post cross thread item", method: http.MethodPost, path: "/v1/threads/thread_local/pins", body: `{"itemId":"` + otherItem.ID + `"}`, want: http.StatusNotFound},
		{name: "delete missing item id", method: http.MethodDelete, path: "/v1/threads/thread_local/pins", want: http.StatusBadRequest},
		{name: "delete missing pin", method: http.MethodDelete, path: "/v1/threads/thread_local/pins?itemId=" + item.ID, want: http.StatusNotFound},
		{name: "wrong method", method: http.MethodPatch, path: "/v1/threads/thread_local/pins", want: http.StatusMethodNotAllowed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != tt.want {
				t.Fatalf("%s %s status = %d, want %d body=%s", tt.method, tt.path, rec.Code, tt.want, rec.Body.String())
			}
		})
	}
}

func TestThreadPinsSkipCrossThreadSnapshotPin(t *testing.T) {
	base := store.New()
	_, _ = base.CreateProject("proj_local", "Local", "")
	_, _ = base.CreateThread("thread_local", "proj_local", "Local", "", "", "")
	_, _ = base.CreateThread("thread_other", "proj_local", "Other", "", "", "")
	otherItem, err := base.CreateThreadMessage("item_other", "thread_other", "user", "other")
	if err != nil {
		t.Fatalf("CreateThreadMessage other returned error: %v", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)

	h := newTestHandler()
	h.Store = &corruptPinRepository{
		Repository: base,
		pins: []store.ThreadPin{{
			ThreadID:  "thread_local",
			ItemID:    otherItem.ID,
			PinnedAt:  now,
			CreatedAt: now,
			UpdatedAt: now,
		}},
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/threads/thread_local/pins", nil)
	rec := httptest.NewRecorder()
	h.GetThreadPins(rec, req, "thread_local")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/threads/thread_local/pins status = %d, want 200", rec.Code)
	}
	var pinsRaw map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&pinsRaw); err != nil {
		t.Fatalf("failed to decode pins body: %v", err)
	}
	pinsRaw = unwrapSuccess(pinsRaw)
	pins := pinsRaw["items"].([]any)
	if len(pins) != 0 {
		t.Fatalf("pins = %#v, want cross-thread snapshot pin skipped", pins)
	}
}

func TestPostThreadMessageRejectsEmptyContent(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/threads/thread_local/messages", strings.NewReader(`{"content":"  "}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST empty content status = %d, want 400", rec.Code)
	}
}

func TestPostThreadMessageRejectsUnknownThread(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/threads/thread_missing/messages", strings.NewReader(`{"content":"hello"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("POST unknown thread status = %d, want 404", rec.Code)
	}
}

func TestPostThreadMessageRejectsInvalidJSON(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/threads/thread_local/messages", strings.NewReader(`{"content":`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST invalid JSON status = %d, want 400", rec.Code)
	}
}

func TestPostThreadMessageGeneratesEvents(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	_, ch, _ := h.Bus.Subscribe(0)

	req := httptest.NewRequest(http.MethodPost, "/v1/threads/thread_local/messages", strings.NewReader(`{"content":"hello events"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/threads/thread_local/messages status = %d, want 201", rec.Code)
	}

	var messageCreated any
	for _, wantType := range []string{"message.created", "item.created"} {
		select {
		case evt := <-ch:
			if evt.Type != wantType {
				t.Fatalf("event type = %q, want %q", evt.Type, wantType)
			}
			if evt.Scope["projectId"] != "proj_local" || evt.Scope["threadId"] != "thread_local" {
				t.Fatalf("event scope = %#v, want project/thread", evt.Scope)
			}
			itemID, ok := evt.Scope["itemId"].(string)
			if !ok || !strings.HasPrefix(itemID, "item_") {
				t.Fatalf("event itemId = %#v, want item_ prefix", evt.Scope["itemId"])
			}
			if wantType == "message.created" {
				messageCreated = evt.Payload
			}
		case <-time.After(500 * time.Millisecond):
			t.Fatalf("timed out waiting for %s event", wantType)
		}
	}
	if messageCreated == nil {
		t.Fatal("message.created payload was not captured")
	}
}

// ── Additional route coverage tests ──

func TestMuxGetProjectsRoute(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/projects", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/projects status = %d, want 200", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	body = unwrapSuccess(body)
	items, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("expected items array, got %T", body["items"])
	}
	// At least proj_local should exist (from ensureDefaults)
	if len(items) == 0 {
		t.Fatal("expected at least 1 project")
	}
}

func TestMuxPostProjectsRoute(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/projects", strings.NewReader(`{"projectId":"proj_manual","name":"Manual Project"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/projects status = %d, want 201", rec.Code)
	}

	var project map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&project); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	project = unwrapSuccess(project)
	if project["projectId"] != "proj_manual" {
		t.Fatalf("projectId = %v, want proj_manual", project["projectId"])
	}
}

func TestMuxPostProjectsExistingProjectReturnsOKWithoutCreatedEvent(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	_, ch, _ := h.Bus.Subscribe(0)
	req := httptest.NewRequest(http.MethodPost, "/v1/projects", strings.NewReader(`{"projectId":"proj_manual","name":"Manual Project"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("initial POST /v1/projects status = %d, want 201", rec.Code)
	}
	select {
	case evt := <-ch:
		if evt.Type != "project.created" {
			t.Fatalf("initial event type = %q, want project.created", evt.Type)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for initial project.created event")
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/projects", strings.NewReader(`{"projectId":"proj_manual","name":"Renamed Project"}`))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("duplicate POST /v1/projects status = %d, want 200", rec.Code)
	}

	var project map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&project); err != nil {
		t.Fatalf("failed to decode duplicate body: %v", err)
	}
	project = unwrapSuccess(project)
	if project["name"] != "Manual Project" {
		t.Fatalf("duplicate project name = %v, want original Manual Project", project["name"])
	}
	select {
	case evt := <-ch:
		t.Fatalf("unexpected event for duplicate project: %s", evt.Type)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestMuxPostProjectsAutoID(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/projects", strings.NewReader(`{"name":"Auto ID Project"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/projects (auto ID) status = %d, want 201", rec.Code)
	}

	var project map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&project); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	project = unwrapSuccess(project)
	id, ok := project["projectId"].(string)
	if !ok || !strings.HasPrefix(id, "proj_") {
		t.Fatalf("projectId = %v, want proj_ prefix", project["projectId"])
	}
}

func TestMuxPostProjectsBadJSON(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/projects", strings.NewReader(`{bad`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST /v1/projects (bad JSON) status = %d, want 400", rec.Code)
	}
}

func TestMuxGetSpecificProject(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/projects/proj_local", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/projects/proj_local status = %d, want 200", rec.Code)
	}
}

func TestMuxGetProjectNotFound(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/projects/proj_nonexistent", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET /v1/projects/proj_nonexistent status = %d, want 404", rec.Code)
	}
}

func TestMuxGetSpecificThread(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/threads/thread_local", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/threads/thread_local status = %d, want 200", rec.Code)
	}
}

func TestMuxGetThreadNotFound(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/threads/thread_nonexistent", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET /v1/threads/thread_nonexistent status = %d, want 404", rec.Code)
	}
}

func TestMuxPostThreadsAutoID(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/threads", strings.NewReader(`{"title":"Auto Thread"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/threads (auto ID) status = %d, want 201", rec.Code)
	}
}

func TestMuxPostThreadsBadJSON(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/threads", strings.NewReader(`{bad`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST /v1/threads (bad JSON) status = %d, want 400", rec.Code)
	}
}

func TestMuxPostThreadsProjectNotFound(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/threads", strings.NewReader(`{"projectId":"proj_nonexistent","title":"Bad Project"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("POST /v1/threads (bad project) status = %d, want 404", rec.Code)
	}
}

func TestMuxGetThreadItems(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/threads/thread_local/items", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/threads/thread_local/items status = %d, want 200", rec.Code)
	}
}

func TestMuxGetThreadItemsNotFound(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/threads/thread_nonexistent/items", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET /v1/threads/thread_nonexistent/items status = %d, want 404", rec.Code)
	}
}

func TestMuxGetItem(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	// Create a thread message first so there's an item to fetch
	h.PostThreadMessage(httptest.NewRecorder(),
		httptest.NewRequest(http.MethodPost, "/v1/threads/thread_local/messages",
			strings.NewReader(`{"content":"test item"}`)),
		"thread_local")

	// Get the item via the items endpoint
	items := h.Store.ListThreadItems("thread_local")
	if len(items) == 0 {
		t.Fatal("expected at least one item")
	}
	itemID := items[0].ID

	req := httptest.NewRequest(http.MethodGet, "/v1/items/"+itemID, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/items/%s status = %d, want 200", itemID, rec.Code)
	}
}

func TestMuxGetItemNotFound(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/items/item_nonexistent", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET /v1/items/item_nonexistent status = %d, want 404", rec.Code)
	}
}

func TestMuxThreadsSubpathWrongMethod(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/threads/thread_local", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /v1/threads/thread_local status = %d, want 405", rec.Code)
	}
}
