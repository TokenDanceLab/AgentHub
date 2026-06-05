package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/store"
	"github.com/gorilla/websocket"
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
		Bus:      bus,
		Registry: reg,
		Store:    s,
		Executor: lifecycle.NewMockExecutor(bus, s),
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

func TestGetModelCatalogRedactsLocalConfigSecrets(t *testing.T) {
	tempDir := t.TempDir()
	codexHome := filepath.Join(tempDir, ".codex")
	claudeHome := filepath.Join(tempDir, ".claude")
	ccSwitchHome := filepath.Join(tempDir, ".cc-switch")
	if err := os.MkdirAll(codexHome, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(claudeHome, "cc-haha"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(ccSwitchHome, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEX_HOME", codexHome)
	t.Setenv("CLAUDE_CONFIG_DIR", claudeHome)
	t.Setenv("CC_SWITCH_HOME", ccSwitchHome)

	if err := os.WriteFile(filepath.Join(codexHome, "config.toml"), []byte(`
model = "gpt-5.5"
model_provider = "newapi"

[model_providers.newapi]
name = "TokenDance Gateway"
base_url = "https://api.vectorcontrol.tech/v1"
wire_api = "responses"
api_key = "SHOULD_NOT_LEAK"
`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(claudeHome, "settings.json"), []byte(`{
  "model": "opus[1m]",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "SHOULD_NOT_LEAK",
    "ANTHROPIC_BASE_URL": "https://api.vectorcontrol.tech",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-7[1M]",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME": "glm-5.1"
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(claudeHome, "cc-haha", "providers.json"), []byte(`{
  "providers": [{
    "name": "MetAPI / Opus",
    "baseUrl": "https://api.vectorcontrol.tech/v1",
    "apiKey": "SHOULD_NOT_LEAK",
    "models": { "main": "claude-opus-4-6", "opus": "" }
  }]
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ccSwitchHome, "settings.json"), []byte(`{
  "currentProviderClaude": "SHOULD_NOT_LEAK"
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/model-catalog", nil)
	rec := httptest.NewRecorder()

	h.GetModelCatalog(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, "SHOULD_NOT_LEAK") {
		t.Fatalf("model catalog leaked secret material: %s", body)
	}
	for _, want := range []string{"gpt-5.5", "opus[1m]", "deepseek-v4-pro", "claude-opus-4-6", "cc-switch"} {
		if !strings.Contains(body, want) {
			t.Fatalf("model catalog missing %q in %s", want, body)
		}
	}
}

func TestGetHealthDegradesWhenNoRunnerAvailable(t *testing.T) {
	h := newTestHandler()
	// Reset registry to only contain an offline runner for this test.
	h.Registry = runners.NewRegistry()
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

func TestThreadUpdateArchiveDeleteRoutes(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	h.ensureDefaults()
	if _, err := h.Store.CreateThread("thread_manage", "proj_local", "Manage Thread"); err != nil {
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

func TestPostRunsAcceptsDesktopModelRoutingMetadata(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{
		"prompt":"route with model metadata",
		"model":"newapi/deepseek-v4-pro",
		"provider":"tokendance-gateway",
		"modelAlias":"sonnet",
		"modelMappingEnabled":true,
		"providerFallbackEnabled":true,
		"reasoningEffort":"high"
	}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
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

func TestPostRunsPersistsUserPromptAndUsesThreadSession(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()
	if _, err := h.Store.CreateThread("thread_context", "proj_local", "Context Thread"); err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{
		"projectId":"proj_local",
		"threadId":"thread_context",
		"prompt":"remember green-842"
	}`))
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(executor.contexts) != 1 {
		t.Fatalf("executor contexts = %d, want 1", len(executor.contexts))
	}
	wantSessionID := runtimeSessionIDForThread("thread_context")
	if executor.contexts[0].SessionID != wantSessionID {
		t.Fatalf("session id = %q, want %q", executor.contexts[0].SessionID, wantSessionID)
	}
	if wantSessionID == "thread_context" || len(wantSessionID) != 36 || strings.Count(wantSessionID, "-") != 4 {
		t.Fatalf("derived session id = %q, want UUID-shaped runtime id", wantSessionID)
	}

	items := h.Store.ListThreadItems("thread_context")
	var userItem *store.Item
	var runItem *store.Item
	for i := range items {
		item := items[i]
		switch item.Type {
		case "user_message":
			userItem = &item
		case "run":
			runItem = &item
		}
	}
	if userItem == nil {
		t.Fatalf("thread items = %#v, want user_message item", items)
	}
	if userItem.Role != "user" || userItem.Content != "remember green-842" || userItem.RunID == "" {
		t.Fatalf("user item = %#v, want persisted prompt bound to run", *userItem)
	}
	if runItem == nil || runItem.Status != "queued" {
		t.Fatalf("thread items = %#v, want queued run item", items)
	}
}

func TestPostRunsResumesThreadRuntimeSessionAfterAssistantHistory(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()
	if _, err := h.Store.CreateThread("thread_resume", "proj_local", "Resume Thread"); err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	if _, err := h.Store.CreateRun("run_existing", "proj_local", "thread_resume"); err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	h.Store.SetRunStatus("run_existing", "finished")
	if _, err := h.Store.CreateItem(store.Item{
		ID:        "item_existing_agent",
		ProjectID: "proj_local",
		ThreadID:  "thread_resume",
		RunID:     "run_existing",
		Type:      "agent_message",
		Role:      "agent",
		Status:    "created",
		Content:   "remembered state",
	}); err != nil {
		t.Fatalf("CreateItem returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{
		"projectId":"proj_local",
		"threadId":"thread_resume",
		"sessionId":"thread_resume",
		"prompt":"resume this thread"
	}`))
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(executor.contexts) != 1 {
		t.Fatalf("executor contexts = %d, want 1", len(executor.contexts))
	}
	if !executor.contexts[0].ContinueLast {
		t.Fatal("ContinueLast = false, want true for thread with prior assistant history")
	}
	if got, want := executor.contexts[0].SessionID, runtimeSessionIDForThread("thread_resume"); got != want {
		t.Fatalf("session id = %q, want %q", got, want)
	}
}

func TestPostRunsPassesRuntimeProfileConfigToExecutor(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()

	// Allow the workDir used by this test to pass workspace validation.
	workDir := filepath.Join(t.TempDir(), "AgentHub")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	h.WorkspaceAllowlist = []string{workDir}

	body, err := json.Marshal(map[string]any{
		"projectId":              "proj_local",
		"threadId":               "thread_local",
		"prompt":                 "review this patch",
		"agentId":                "codex",
		"model":                  "gpt-5.5",
		"reasoningEffort":        "high",
		"thinkingMode":           "adaptive",
		"permissionMode":         "plan",
		"workDir":                workDir,
		"includePartial":         true,
		"structuredOutputSchema": `{"type":"object"}`,
		"systemPrompt":           "You are a careful reviewer.",
		"appendSystemPrompt":     "Keep output concise.",
		"allowedTools":           []string{"Read", "Grep"},
		"configOverrides":        map[string]any{"reasoning_summary": "auto"},
		"agentDefinitions":       map[string]any{
			"reviewer": map[string]any{
				"description": "Review code",
				"prompt":      "Check correctness",
				"tools":       []string{"Read"},
				"model":       "sonnet",
			},
		},
		"mcpConfig":              `{"servers":{"filesystem":{"command":"node"}}}`,
		"hubTaskId":              "task_hub_1",
		"ephemeral":              true,
	})
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(executor.contexts) != 1 {
		t.Fatalf("executor contexts = %d, want 1", len(executor.contexts))
	}
	ctx := executor.contexts[0]
	if ctx.Prompt != "review this patch" || ctx.AgentID != "codex" || ctx.Model != "gpt-5.5" {
		t.Fatalf("basic run context = %#v", ctx)
	}
	if ctx.ReasoningEffort != "high" || ctx.ThinkingMode != "adaptive" || ctx.PermissionMode != "plan" {
		t.Fatalf("runtime policy context = %#v", ctx)
	}
	if ctx.WorkDir != workDir || !ctx.IncludePartial || !ctx.Ephemeral {
		t.Fatalf("execution context = %#v", ctx)
	}
	if ctx.StructuredOutputSchema != `{"type":"object"}` {
		t.Fatalf("structured output schema = %#v", ctx.StructuredOutputSchema)
	}
	if ctx.SystemPrompt != "You are a careful reviewer." || ctx.AppendSystemPrompt != "Keep output concise." {
		t.Fatalf("system prompt context = %#v", ctx)
	}
	if len(ctx.AllowedTools) != 2 || ctx.AllowedTools[0] != "Read" || ctx.AllowedTools[1] != "Grep" {
		t.Fatalf("allowed tools = %#v", ctx.AllowedTools)
	}
	if ctx.ConfigOverrides["reasoning_summary"] != "auto" {
		t.Fatalf("config overrides = %#v", ctx.ConfigOverrides)
	}
	if ctx.AgentDefinitions["reviewer"].Prompt != "Check correctness" || ctx.AgentDefinitions["reviewer"].Tools[0] != "Read" {
		t.Fatalf("agent definitions = %#v", ctx.AgentDefinitions)
	}
	if ctx.MCPConfig != `{"servers":{"filesystem":{"command":"node"}}}` {
		t.Fatalf("mcp config = %#v", ctx.MCPConfig)
	}
	if ctx.HubTaskID != "task_hub_1" {
		t.Fatalf("hub task id = %#v", ctx.HubTaskID)
	}
}

func TestPostRunsAllowsWorkDirWithinWorkspaceAllowlist(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()

	allowedRoot := filepath.Join(t.TempDir(), "workspace")
	workDir := filepath.Join(allowedRoot, "project-a")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	h.WorkspaceAllowlist = []string{allowedRoot}

	body, err := json.Marshal(map[string]any{
		"projectId": "proj_local",
		"threadId":  "thread_local",
		"workDir":   workDir,
	})
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(executor.started) != 1 {
		t.Fatalf("executor starts = %d, want 1", len(executor.started))
	}
	if executor.contexts[0].WorkDir != workDir {
		t.Fatalf("executor workDir = %q, want %q", executor.contexts[0].WorkDir, workDir)
	}
}

func TestPostRunsRejectsWorkDirOutsideWorkspaceAllowlist(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()

	parent := t.TempDir()
	allowedRoot := filepath.Join(parent, "allowed")
	escapedWorkDir := filepath.Join(allowedRoot, "..", "outside")
	if err := os.MkdirAll(allowedRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll allowed root returned error: %v", err)
	}
	if err := os.MkdirAll(escapedWorkDir, 0o755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	h.WorkspaceAllowlist = []string{allowedRoot}

	body, err := json.Marshal(map[string]any{
		"projectId": "proj_local",
		"threadId":  "thread_local",
		"workDir":   escapedWorkDir,
	})
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	errObj, ok := resp["error"].(map[string]any)
	if !ok {
		t.Fatalf("error body = %#v, want error object", resp)
	}
	if errObj["code"] != "workspace_not_allowed" {
		t.Fatalf("error code = %#v, want workspace_not_allowed", errObj["code"])
	}
	if len(executor.started) != 0 {
		t.Fatalf("executor starts = %d, want 0", len(executor.started))
	}
	if runs := h.Store.ListRuns("thread_local"); len(runs) != 0 {
		t.Fatalf("stored runs = %d, want 0", len(runs))
	}
}

func TestPostRunsRejectsSymlinkEscapeFromWorkspaceAllowlist(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()

	parent := t.TempDir()
	allowedRoot := filepath.Join(parent, "allowed")
	outsideRoot := filepath.Join(parent, "outside")
	if err := os.MkdirAll(allowedRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll allowed root returned error: %v", err)
	}
	if err := os.MkdirAll(outsideRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll outside root returned error: %v", err)
	}
	linkPath := filepath.Join(allowedRoot, "linked-outside")
	if err := os.Symlink(outsideRoot, linkPath); err != nil {
		t.Skipf("symlink creation unavailable in this environment: %v", err)
	}
	h.WorkspaceAllowlist = []string{allowedRoot}

	body, err := json.Marshal(map[string]any{
		"projectId": "proj_local",
		"threadId":  "thread_local",
		"workDir":   linkPath,
	})
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(executor.started) != 0 {
		t.Fatalf("executor starts = %d, want 0", len(executor.started))
	}
}

func TestPostRunsRejectsWorkDirWhenWorkspaceAllowlistEmpty(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()

	// Empty allowlist (nil or zero-length slice) must reject all non-empty workDir values.
	// This is the fail-closed security behavior for AH-SR-006.
	h.WorkspaceAllowlist = []string{} // explicitly empty; nil would behave the same

	homeDir, err := os.UserHomeDir()
	if err != nil || homeDir == "" {
		homeDir = t.TempDir()
	}

	tests := []struct {
		name    string
		workDir string
	}{
		{"any valid dir", t.TempDir()},
		{"home directory", homeDir},
		{"root filesystem", string(filepath.Separator)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, err := json.Marshal(map[string]any{
				"projectId": "proj_local",
				"threadId":  "thread_local",
				"workDir":   tt.workDir,
			})
			if err != nil {
				t.Fatalf("json.Marshal returned error: %v", err)
			}
			req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(string(body)))
			rec := httptest.NewRecorder()

			h.PostRuns(rec, req)

			if rec.Code != http.StatusForbidden {
				t.Fatalf("expected status 403 for workDir=%q, got %d: %s", tt.workDir, rec.Code, rec.Body.String())
			}
			var resp map[string]any
			if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
				t.Fatalf("failed to decode body: %v", err)
			}
			errObj, ok := resp["error"].(map[string]any)
			if !ok {
				t.Fatalf("error body = %#v, want error object", resp)
			}
			if errObj["code"] != "workspace_not_allowed" {
				t.Fatalf("error code = %#v, want workspace_not_allowed", errObj["code"])
			}
			msg, ok := errObj["message"].(string)
			if !ok || !strings.Contains(msg, "allowlist") {
				t.Fatalf("error message = %q, want mention of allowlist configuration", msg)
			}
		})
	}

	// Verify: no runs/items were created during any of the rejected requests.
	if runs := h.Store.ListRuns("thread_local"); len(runs) != 0 {
		t.Fatalf("stored runs = %d, want 0", len(runs))
	}

	// Verify: nil allowlist behaves identically to empty allowlist.
	h.WorkspaceAllowlist = nil
	body, err := json.Marshal(map[string]any{
		"projectId": "proj_local",
		"threadId":  "thread_local",
		"workDir":   t.TempDir(),
	})
	if err != nil {
		t.Fatalf("json.Marshal returned error: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	h.PostRuns(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("nil allowlist: expected status 403, got %d: %s", rec.Code, rec.Body.String())
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

func TestPostRunsCleansTerminalRunsBeforeCreatingNewRun(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()

	for i := 0; i < defaultRunCleanupMaxTerminalRunsPerThread+1; i++ {
		runID := fmt.Sprintf("run_terminal_%02d", i)
		itemID := fmt.Sprintf("item_terminal_%02d", i)
		run, err := h.Store.CreateRun(runID, "proj_local", "thread_local")
		if err != nil {
			t.Fatalf("CreateRun(%q) returned error: %v", runID, err)
		}
		if _, ok := h.Store.SetRunStatus(run.ID, "finished"); !ok {
			t.Fatalf("SetRunStatus(%q) returned ok=false", run.ID)
		}
		if _, err := h.Store.CreateItem(store.Item{
			ID:        itemID,
			ProjectID: run.ProjectID,
			ThreadID:  run.ThreadID,
			RunID:     run.ID,
			Type:      "run",
			Status:    "finished",
		}); err != nil {
			t.Fatalf("CreateItem(%q) returned error: %v", itemID, err)
		}
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{"projectId":"proj_local","threadId":"thread_local"}`))
	rec := httptest.NewRecorder()
	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("POST /v1/runs status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	if _, ok := h.Store.GetRun("run_terminal_00"); ok {
		t.Fatal("oldest terminal run was not cleaned before creating a new run")
	}
	if _, ok := h.Store.GetItem("item_terminal_00"); ok {
		t.Fatal("item for oldest terminal run was not cleaned before creating a new run")
	}
	if len(executor.started) != 1 {
		t.Fatalf("executor starts = %d, want 1", len(executor.started))
	}
	if got := h.Store.ListRuns("thread_local"); len(got) != defaultRunCleanupMaxTerminalRunsPerThread+1 {
		t.Fatalf("thread run count = %d, want retained terminal runs plus new active run", len(got))
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
	// Create project and thread first (required for CreateRun).
	_, _ = h.Store.CreateProject("proj_local", "Local")
	_, _ = h.Store.CreateThread("thread_local", "proj_local", "Thread")
	_, _ = h.Store.CreateRun("run_test123", "proj_local", "thread_local")
	req := httptest.NewRequest(http.MethodPost, "/v1/runs/run_test123:cancel", nil)
	rec := httptest.NewRecorder()

	h.PostCancelRun(rec, req)

	// #108: existing run returns 200 via store fallback
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	if body["runId"] != "run_test123" {
		t.Errorf("expected runId=run_test123, got %v", body["runId"])
	}
}

func TestPostCancelRunMissingRunReturns404(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/runs/run_nonexistent:cancel", nil)
	rec := httptest.NewRecorder()

	h.PostCancelRun(rec, req)

	// #108: missing run returns 404
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status 404 for missing run, got %d", rec.Code)
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

	// #108: store fallback for terminal runs returns 200
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 (terminal run fallback), got %d", rec.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["status"] != run.Status {
		t.Fatalf("status = %#v, want %q", body["status"], run.Status)
	}
}

func TestPostPermissionDecideRejectsInvalidDecision(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(`{"runId":"run_1","requestId":"req_1","decision":"maybe"}`))
	rec := httptest.NewRecorder()

	h.PostPermissionDecide(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "bad_request")
}

func TestPostPermissionDecideRequiresRunAndRequest(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"missing run", `{"requestId":"req_1","decision":"allow"}`},
		{"missing request", `{"runId":"run_1","decision":"allow"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler()
			req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(tt.body))
			rec := httptest.NewRecorder()

			h.PostPermissionDecide(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			assertErrorCode(t, rec.Body.String(), "bad_request")
		})
	}
}

func TestPostPermissionDecideRejectsUnknownRequest(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(`{"runId":"run_1","requestId":"req_missing","decision":"allow"}`))
	rec := httptest.NewRecorder()

	h.PostPermissionDecide(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "permission_request_not_found")
}

func TestPostPermissionDecideRejectsWrongRun(t *testing.T) {
	h := newTestHandler()
	h.ensurePermissionRegistry().Register(PendingPermission{
		RunID:     "run_real",
		RequestID: "req_1",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(`{"runId":"run_spoof","requestId":"req_1","decision":"allow"}`))
	rec := httptest.NewRecorder()

	h.PostPermissionDecide(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "permission_request_not_found")
	if _, ok := h.PermissionRegistry.Consume("run_real", "req_1"); !ok {
		t.Fatal("wrong-run decision consumed the real pending request")
	}
}

func TestPostPermissionDecideConsumesPendingRequestAndPublishesEvent(t *testing.T) {
	h := newTestHandler()
	h.ensurePermissionRegistry().Register(PendingPermission{
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

func TestPostPermissionDecideRejectsSecondDecision(t *testing.T) {
	h := newTestHandler()
	h.ensurePermissionRegistry().Register(PendingPermission{
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
	assertErrorCode(t, rec.Body.String(), "permission_request_not_found")
}

func TestPostPermissionDecideRejectsExpiredRequestWithoutPublishing(t *testing.T) {
	h := newTestHandler()
	now := time.Date(2026, 5, 29, 8, 0, 0, 0, time.UTC)
	registry := NewPermissionRegistry(time.Minute)
	registry.now = func() time.Time { return now }
	h.PermissionRegistry = registry
	h.PermissionRegistry.Register(PendingPermission{
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
	assertErrorCode(t, rec.Body.String(), "permission_request_not_found")
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
	// Create project, thread, and run so the cancel route can find it.
	_, _ = h.Store.CreateProject("proj_local", "Local")
	_, _ = h.Store.CreateThread("thread_local", "proj_local", "Thread")
	_, _ = h.Store.CreateRun("run_abc", "proj_local", "thread_local")
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs/run_abc:cancel", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestMuxCancelRunMissingRunRoute(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs/run_missing:cancel", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	// #108: missing run returns 404
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
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

func TestWebSocketRespondsToApplicationPing(t *testing.T) {
	h := newTestHandler()
	server := httptest.NewServer(http.HandlerFunc(h.GetEvents))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	header := http.Header{}
	header.Set("Origin", "http://localhost:5173")
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		if resp != nil {
			t.Fatalf("dial failed with status %d: %v", resp.StatusCode, err)
		}
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{"type": "ping", "ts": float64(123)}); err != nil {
		t.Fatalf("write ping: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	var got map[string]any
	if err := conn.ReadJSON(&got); err != nil {
		t.Fatalf("read pong: %v", err)
	}
	if got["type"] != "pong" {
		t.Fatalf("type = %v, want pong; frame=%v", got["type"], got)
	}
	if got["ts"] != float64(123) {
		t.Fatalf("ts = %v, want 123; frame=%v", got["ts"], got)
	}
}

func TestWebSocketOriginPolicy(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{"no origin", "", false},
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
