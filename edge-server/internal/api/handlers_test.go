package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/store"
)

func newTestHandler() *Handler {
	return &Handler{
		Bus:      events.NewBus(1000),
		Registry: runners.NewRegistry(),
		Store:    store.New(),
	}
}

type recordingRepository struct {
	store.Repository
	createProjectCalls int
}

func (r *recordingRepository) CreateProject(id, name string) (store.Project, error) {
	r.createProjectCalls++
	return r.Repository.CreateProject(id, name)
}

type fakeRunExecutor struct {
	started []store.Run
	cancel  lifecycle.CancelResult
	cancels []string
	err     error
}

func (f *fakeRunExecutor) Start(run store.Run, _ lifecycle.RunProcessContext) error {
	f.started = append(f.started, run)
	return f.err
}

func (f *fakeRunExecutor) Cancel(runID string) lifecycle.CancelResult {
	f.cancels = append(f.cancels, runID)
	return f.cancel
}

func TestGetHealth(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()

	h.GetHealth(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	if body["status"] != "ok" {
		t.Errorf("expected status=ok, got %v", body["status"])
	}
	if body["version"] != "v1" {
		t.Errorf("expected version=v1, got %v", body["version"])
	}
	if body["edgeId"] != "local" {
		t.Errorf("expected edgeId=local, got %v", body["edgeId"])
	}
	checks, ok := body["checks"].(map[string]any)
	if !ok {
		t.Fatalf("checks = %T, want object", body["checks"])
	}
	runnerCheck, ok := checks["runners"].(map[string]any)
	if !ok {
		t.Fatalf("runner check = %T, want object", checks["runners"])
	}
	if runnerCheck["status"] != "ok" {
		t.Fatalf("runner check status = %v, want ok", runnerCheck["status"])
	}
	if runnerCheck["total"] != float64(1) || runnerCheck["available"] != float64(1) || runnerCheck["unavailable"] != float64(0) {
		t.Fatalf("runner counts = %#v, want total=1 available=1 unavailable=0", runnerCheck)
	}
	statuses, ok := runnerCheck["statuses"].(map[string]any)
	if !ok {
		t.Fatalf("runner statuses = %T, want object", runnerCheck["statuses"])
	}
	if statuses["online"] != float64(1) {
		t.Fatalf("online runner count = %#v, want 1", statuses["online"])
	}
	items, ok := runnerCheck["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("runner items = %#v, want one item", runnerCheck["items"])
	}

	contentType := rec.Header().Get("Content-Type")
	if !strings.Contains(contentType, "application/json") {
		t.Errorf("expected JSON content-type, got %q", contentType)
	}
}

func TestGetHealthDegradesWhenNoRunnerAvailable(t *testing.T) {
	h := newTestHandler()
	h.Registry.Upsert(runners.RunnerInfo{
		ID:           "runner_local_1",
		Name:         "Mock Runner (local)",
		Status:       "offline",
		Capabilities: []string{"mock"},
	})
	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()

	h.GetHealth(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["status"] != "degraded" {
		t.Fatalf("overall status = %v, want degraded", body["status"])
	}
	checks := body["checks"].(map[string]any)
	runnerCheck := checks["runners"].(map[string]any)
	if runnerCheck["status"] != "degraded" {
		t.Fatalf("runner check status = %v, want degraded", runnerCheck["status"])
	}
	if runnerCheck["detail"] != "no available runners" {
		t.Fatalf("runner detail = %v, want no available runners", runnerCheck["detail"])
	}
	if runnerCheck["available"] != float64(0) || runnerCheck["unavailable"] != float64(1) {
		t.Fatalf("runner counts = %#v, want available=0 unavailable=1", runnerCheck)
	}
	statuses := runnerCheck["statuses"].(map[string]any)
	if statuses["offline"] != float64(1) {
		t.Fatalf("offline runner count = %#v, want 1", statuses["offline"])
	}
}

func TestGetHealthDegradesWhenRunnerRegistryMissing(t *testing.T) {
	h := newTestHandler()
	h.Registry = nil
	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()

	h.GetHealth(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["status"] != "degraded" {
		t.Fatalf("overall status = %v, want degraded", body["status"])
	}
	checks := body["checks"].(map[string]any)
	runnerCheck := checks["runners"].(map[string]any)
	if runnerCheck["detail"] != "no runner registry configured" {
		t.Fatalf("runner detail = %v, want missing registry detail", runnerCheck["detail"])
	}
	if runnerCheck["total"] != float64(0) || runnerCheck["available"] != float64(0) {
		t.Fatalf("runner counts = %#v, want zero counts", runnerCheck)
	}
}

func TestGetRunners(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/runners", nil)
	rec := httptest.NewRecorder()

	h.GetRunners(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	items, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("expected items array, got %T", body["items"])
	}
	if len(items) == 0 {
		t.Error("expected at least 1 runner (mock runner)")
	}

	page, ok := body["page"].(map[string]any)
	if !ok {
		t.Fatalf("expected page object, got %T", body["page"])
	}
	if hasMore, ok := page["hasMore"].(bool); !ok || hasMore {
		t.Errorf("expected hasMore=false, got %v", page["hasMore"])
	}
}

func TestGetRuns(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	h.GetRuns(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	items, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("expected items array, got %T", body["items"])
	}
	if len(items) != 0 {
		t.Errorf("expected empty items, got %d items", len(items))
	}
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
	items := body["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected one thread, got %d", len(items))
	}
	thread := items[0].(map[string]any)
	if thread["threadId"] != "thread_test" || thread["projectId"] != "proj_test" {
		t.Fatalf("unexpected thread response: %#v", thread)
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

func TestPostRuns(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	runID, ok := body["runId"].(string)
	if !ok || !strings.HasPrefix(runID, "run_") {
		t.Errorf("expected runId starting with run_, got %v", body["runId"])
	}
	if body["status"] != "queued" {
		t.Errorf("expected status=queued, got %v", body["status"])
	}
	if body["projectId"] != "proj_local" {
		t.Errorf("expected default projectId=proj_local, got %v", body["projectId"])
	}
	if body["threadId"] != "thread_local" {
		t.Errorf("expected default threadId=thread_local, got %v", body["threadId"])
	}
}

func TestPostRunsBindsProjectAndThread(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()
	_, err := h.Store.CreateThread("thread_bound", "proj_local", "Bound Thread")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{"projectId":"proj_local","threadId":"thread_bound"}`))
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["projectId"] != "proj_local" || body["threadId"] != "thread_bound" {
		t.Fatalf("run binding response = %#v, want proj_local/thread_bound", body)
	}

	runID := body["runId"].(string)
	run, ok := h.Store.GetRun(runID)
	if !ok {
		t.Fatalf("run %q was not stored", runID)
	}
	if run.ProjectID != "proj_local" || run.ThreadID != "thread_bound" {
		t.Fatalf("stored run = %#v, want proj_local/thread_bound", run)
	}
	if len(executor.started) != 1 {
		t.Fatalf("executor starts = %d, want 1", len(executor.started))
	}
	if executor.started[0].ID != runID {
		t.Fatalf("executor started run = %#v, want run %q", executor.started[0], runID)
	}
}

func TestPostRunsStartsExecutorAfterQueueingRun(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{}
	h.Executor = executor
	_, ch, _ := h.Bus.Subscribe(0)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d", rec.Code)
	}
	if len(executor.started) != 1 {
		t.Fatalf("executor starts = %d, want 1", len(executor.started))
	}
	run := executor.started[0]
	if run.Status != "queued" {
		t.Fatalf("executor run status = %q, want queued", run.Status)
	}

	select {
	case evt := <-ch:
		if evt.Type != "run.queued" {
			t.Fatalf("event type = %q, want run.queued", evt.Type)
		}
		if evt.Scope["runId"] != run.ID {
			t.Fatalf("event runId = %#v, want %q", evt.Scope["runId"], run.ID)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for run.queued event")
	}

	items := h.Store.ListThreadItems(run.ThreadID)
	if len(items) != 1 {
		t.Fatalf("thread items = %d, want initial run item", len(items))
	}
	if items[0].RunID != run.ID || items[0].Status != "queued" {
		t.Fatalf("initial item = %#v, want queued run item", items[0])
	}
}

func TestPostRunsReturnsErrorWhenExecutorStartFails(t *testing.T) {
	h := newTestHandler()
	h.Executor = &fakeRunExecutor{err: errors.New("start failed")}

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d", rec.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("error body = %#v, want error object", body)
	}
	if errObj["code"] != "executor_start_failed" {
		t.Fatalf("error code = %#v, want executor_start_failed", errObj["code"])
	}
}

func TestPostRunsRejectsUnknownThreadBinding(t *testing.T) {
	h := newTestHandler()
	h.ensureDefaults()

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{"projectId":"proj_local","threadId":"thread_missing"}`))
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", rec.Code)
	}
}

func TestPostRunsRejectsSecondActiveRunForThread(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{}
	h.Executor = executor

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{"projectId":"proj_local","threadId":"thread_local"}`))
	rec := httptest.NewRecorder()
	h.PostRuns(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("first POST /v1/runs status = %d, want 202", rec.Code)
	}
	if len(executor.started) != 1 {
		t.Fatalf("executor starts after first run = %d, want 1", len(executor.started))
	}
	firstRunID := executor.started[0].ID

	req = httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{"projectId":"proj_local","threadId":"thread_local"}`))
	rec = httptest.NewRecorder()
	h.PostRuns(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("second POST /v1/runs status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if len(executor.started) != 1 {
		t.Fatalf("executor starts after duplicate active run = %d, want still 1", len(executor.started))
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode duplicate active run body: %v", err)
	}
	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("error body = %#v, want error object", body)
	}
	if errObj["code"] != "active_run_exists" {
		t.Fatalf("error code = %#v, want active_run_exists", errObj["code"])
	}
	if body["runId"] != firstRunID {
		t.Fatalf("duplicate response runId = %#v, want active run %q", body["runId"], firstRunID)
	}
	if runs := h.Store.ListRuns("thread_local"); len(runs) != 1 {
		t.Fatalf("thread run count = %d, want 1", len(runs))
	}
}

func TestPostRunsAllowsNewRunAfterActiveRunTerminal(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{}
	h.Executor = executor

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{"projectId":"proj_local","threadId":"thread_local"}`))
	rec := httptest.NewRecorder()
	h.PostRuns(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("first POST /v1/runs status = %d, want 202", rec.Code)
	}
	firstRunID := executor.started[0].ID
	if _, ok := h.Store.SetRunStatus(firstRunID, "finished"); !ok {
		t.Fatal("SetRunStatus returned ok=false")
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{"projectId":"proj_local","threadId":"thread_local"}`))
	rec = httptest.NewRecorder()
	h.PostRuns(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("second POST /v1/runs after terminal status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	if len(executor.started) != 2 {
		t.Fatalf("executor starts = %d, want 2", len(executor.started))
	}
	if executor.started[1].ID == firstRunID {
		t.Fatalf("second run reused first run ID %q", firstRunID)
	}
}

func TestPostRunsMarksExecutorStartFailureTerminalForRetry(t *testing.T) {
	h := newTestHandler()
	failingExecutor := &fakeRunExecutor{err: errors.New("start failed")}
	h.Executor = failingExecutor

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{"projectId":"proj_local","threadId":"thread_local"}`))
	rec := httptest.NewRecorder()
	h.PostRuns(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("first POST /v1/runs status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	if len(failingExecutor.started) != 1 {
		t.Fatalf("failed executor starts = %d, want 1", len(failingExecutor.started))
	}
	failedRunID := failingExecutor.started[0].ID
	failedRun, ok := h.Store.GetRun(failedRunID)
	if !ok {
		t.Fatalf("failed run %q was not stored", failedRunID)
	}
	if failedRun.Status != "failed" {
		t.Fatalf("failed run status = %q, want failed", failedRun.Status)
	}

	retryExecutor := &fakeRunExecutor{}
	h.Executor = retryExecutor
	req = httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{"projectId":"proj_local","threadId":"thread_local"}`))
	rec = httptest.NewRecorder()
	h.PostRuns(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("retry POST /v1/runs status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	if len(retryExecutor.started) != 1 {
		t.Fatalf("retry executor starts = %d, want 1", len(retryExecutor.started))
	}
}

func TestGetRunAndThreadItemsAfterPostRun(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("POST /v1/runs status = %d, want 202", rec.Code)
	}
	var runBody map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&runBody); err != nil {
		t.Fatalf("failed to decode run body: %v", err)
	}
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

	var item store.Item
	if err := json.NewDecoder(rec.Body).Decode(&item); err != nil {
		t.Fatalf("failed to decode item body: %v", err)
	}
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
	var item store.Item
	if err := json.NewDecoder(rec.Body).Decode(&item); err != nil {
		t.Fatalf("failed to decode item body: %v", err)
	}
	if item.Role != "assistant" {
		t.Fatalf("item role = %q, want assistant", item.Role)
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

func TestPostRunsMethodNotAllowed(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/runs should return 200, got %d", rec.Code)
	}
}

func TestPostCancelRun(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/runs/run_test123:cancel", nil)
	rec := httptest.NewRecorder()

	h.PostCancelRun(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	if body["runId"] != "run_test123" {
		t.Errorf("expected runId=run_test123, got %v", body["runId"])
	}
}

func TestPostCancelRunUsesExecutor(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{
		cancel: lifecycle.CancelResult{Found: true, Status: "cancelling"},
	}
	h.Executor = executor
	req := httptest.NewRequest(http.MethodPost, "/v1/runs/run_test123:cancel", nil)
	rec := httptest.NewRecorder()

	h.PostCancelRun(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d", rec.Code)
	}
	if len(executor.cancels) != 1 || executor.cancels[0] != "run_test123" {
		t.Fatalf("executor cancels = %#v, want run_test123", executor.cancels)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["status"] != "cancelling" {
		t.Fatalf("status = %#v, want cancelling", body["status"])
	}
}

func TestPostCancelRunReturnsStoredStatusWhenExecutorCannotCancel(t *testing.T) {
	h := newTestHandler()
	h.ensureDefaults()
	run, err := h.Store.CreateRun("run_finished", "proj_local", "thread_local")
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	run, ok := h.Store.SetRunStatus(run.ID, "finished")
	if !ok {
		t.Fatal("SetRunStatus returned ok=false")
	}
	h.Executor = &fakeRunExecutor{cancel: lifecycle.CancelResult{Found: false, Status: "not_found"}}

	req := httptest.NewRequest(http.MethodPost, "/v1/runs/run_finished:cancel", nil)
	rec := httptest.NewRecorder()
	h.PostCancelRun(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d", rec.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["status"] != run.Status {
		t.Fatalf("status = %#v, want %q", body["status"], run.Status)
	}
}

func TestErrorResponseFormat(t *testing.T) {
	errResp := errorResponse("TEST_ERROR", "something went wrong")
	data, _ := json.Marshal(errResp)

	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("expected error object, got %T", body["error"])
	}
	if errObj["code"] != "TEST_ERROR" {
		t.Errorf("expected code=TEST_ERROR, got %v", errObj["code"])
	}
	if errObj["message"] != "something went wrong" {
		t.Errorf("expected message, got %v", errObj["message"])
	}
}

func TestListResponseFormat(t *testing.T) {
	listResp := listResponse([]string{"a", "b"})
	data, _ := json.Marshal(listResp)

	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	items, ok := body["items"].([]any)
	if !ok || len(items) != 2 {
		t.Error("expected items array with 2 elements")
	}
}

func TestExtractRunID(t *testing.T) {
	tests := []struct {
		path     string
		suffix   string
		expected string
	}{
		{"/v1/runs/run_abc:cancel", ":cancel", "run_abc"},
		{"/v1/runs/run_xyz123:cancel", ":cancel", "run_xyz123"},
	}

	for _, tt := range tests {
		result := extractRunID(tt.path, tt.suffix)
		if result != tt.expected {
			t.Errorf("extractRunID(%q, %q) = %q, want %q", tt.path, tt.suffix, result, tt.expected)
		}
	}
}

// ── Route integration tests (through RegisterRoutes) ──

func TestMuxHealthRoute(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestMuxRunnersRoute(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/runners", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestMuxPostRunsRoute(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", rec.Code)
	}
}

func TestMuxGetRunsRoute(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/runs", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestMuxCancelRunRoute(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs/run_abc:cancel", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", rec.Code)
	}
}

func TestMuxCancelRunWrongMethod(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/runs/run_abc:cancel", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
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

func TestMuxRunsSubPathUnknown(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	// /v1/runs/something (not a cancel action) should 404
	req := httptest.NewRequest(http.MethodGet, "/v1/runs/run_abc", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown subpath, got %d", rec.Code)
	}
}

// ── WebSocket upgrade test ──

func TestWebSocketUpgrade(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
	req.Header.Set("Connection", "upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")

	rec := httptest.NewRecorder()
	h.GetEvents(rec, req)

	// httptest doesn't support hijacking, so the upgrade will fail.
	// The handler calls upgrader.Upgrade which returns an error in test.
	// We just verify it doesn't panic and logs the error.
	if rec.Code != http.StatusOK {
		// Expected: upgrade fails in test server, handler returns early.
		// The 200 is because httptest doesn't switch protocols.
		t.Logf("WS upgrade in test returned %d (expected in httptest)", rec.Code)
	}
}

func TestWebSocketOriginPolicy(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{"no origin", "", true},
		{"desktop dev", "http://localhost:5199", true},
		{"tauri dev", "http://localhost:5173", true},
		{"loopback", "http://127.0.0.1:5199", true},
		{"untrusted remote", "https://example.com", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			got := upgrader.CheckOrigin(req)
			if got != tt.want {
				t.Fatalf("CheckOrigin(%q) = %v, want %v", tt.origin, got, tt.want)
			}
		})
	}
}

// ── Error path tests ──

func TestGetHealthWrongMethod(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/health", nil)
	rec := httptest.NewRecorder()

	h.GetHealth(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}

	var body map[string]any
	json.NewDecoder(rec.Body).Decode(&body)
	errObj := body["error"].(map[string]any)
	if errObj["code"] != "method_not_allowed" {
		t.Errorf("expected method_not_allowed, got %v", errObj["code"])
	}
}

func TestPostRunsWrongMethodDirect(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for direct GET on PostRuns, got %d", rec.Code)
	}
}

func TestPostCancelRunWrongMethod(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/runs/run_x:cancel", nil)
	rec := httptest.NewRecorder()

	h.PostCancelRun(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}
}

// ── Event bus integration ──

func TestPostRunsGeneratesEvents(t *testing.T) {
	h := newTestHandler()
	_, ch, _ := h.Bus.Subscribe(0)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()
	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", rec.Code)
	}

	// First event: run.queued (published synchronously in PostRuns)
	select {
	case evt := <-ch:
		if evt.Type != "run.queued" {
			t.Errorf("first event should be run.queued, got %s", evt.Type)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for run.queued event")
	}

	// Second event: run.started (published by the default mock executor)
	select {
	case evt := <-ch:
		if evt.Type != "run.started" {
			t.Errorf("second event should be run.started, got %s", evt.Type)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for run.started event")
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

func TestAcceptedResponseFormat(t *testing.T) {
	data := acceptedResponse(map[string]any{"runId": "run_1", "status": "queued"})
	if data["runId"] != "run_1" {
		t.Errorf("runId = %v, want run_1", data["runId"])
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

func TestMuxGetAgentsEmptyRegistry(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/agents", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/agents status = %d, want 200", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	items, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("expected items array, got %T", body["items"])
	}
	// AdapterRegistry is nil so we expect empty list
	if len(items) != 0 {
		t.Fatalf("expected 0 agents with nil registry, got %d", len(items))
	}
}

func TestMuxGetAgentsWrongMethod(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/agents", nil)
	rec := httptest.NewRecorder()

	h.GetAgents(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /v1/agents status = %d, want 405", rec.Code)
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

func TestGenIDPrefix(t *testing.T) {
	id := genID("test_")
	if !strings.HasPrefix(id, "test_") {
		t.Fatalf("genID = %q, want test_ prefix", id)
	}
	if len(id) <= len("test_") {
		t.Fatalf("genID = %q, expected hex suffix after prefix", id)
	}
}

func TestWriteJSONEncodingError(t *testing.T) {
	// writeJSON with an unencodable value should not panic.
	// We use a channel which cannot be JSON-encoded.
	rec := httptest.NewRecorder()
	writeJSON(rec, http.StatusOK, make(chan int))
	// Should still have set the status even if encoding fails
	if rec.Code != http.StatusOK {
		t.Fatalf("writeJSON status = %d, want 200", rec.Code)
	}
}
