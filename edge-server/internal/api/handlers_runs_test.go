package api

import (
	"context"
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

	"github.com/golang-jwt/jwt/v5"

	"github.com/agenthub/edge-server/internal/edgeidentity"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/jwtutil"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/runcontrol"
	"github.com/agenthub/edge-server/internal/store"
)

func fallbackHomeDir(t *testing.T) string {
	t.Helper()
	home, err := os.UserHomeDir()
	if err == nil && home != "" {
		return home
	}
	return t.TempDir()
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
	body = unwrapSuccess(body)

	items, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("expected items array, got %T", body["items"])
	}
	if len(items) != 0 {
		t.Errorf("expected empty items, got %d items", len(items))
	}
}

func TestPostRuns(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"workDir":%q}`, workDir)))
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	body = unwrapSuccess(body)

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
	workDir := allowTestWorkspace(t, h)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{

		"prompt":"route with model metadata",
		"model":"newapi/deepseek-v4-pro",
		"provider":"tokendance-gateway",
		"modelAlias":"sonnet",
		"modelMappingEnabled":true,
		"providerFallbackEnabled":true,
		"reasoningEffort":"high",
			"workDir":%q
		}`, workDir)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestPostRunsBindsProjectAndThread(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()
	_, err := h.Store.CreateThread("thread_bound", "proj_local", "Bound Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_bound","workDir":%q}`, workDir)))
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	body = unwrapSuccess(body)
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
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()
	if _, err := h.Store.CreateThread("thread_context", "proj_local", "Context Thread", "", "", ""); err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{

		"projectId":"proj_local",
		"threadId":"thread_context",
		"prompt":"remember green-842",
			"workDir":%q
		}`, workDir)))
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
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()
	if _, err := h.Store.CreateThread("thread_resume", "proj_local", "Resume Thread", "", "", ""); err != nil {
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

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{

		"projectId":"proj_local",
		"threadId":"thread_resume",
		"sessionId":"thread_resume",
		"prompt":"resume this thread",
			"workDir":%q
		}`, workDir)))
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
	workDir := t.TempDir()
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
		"configOverrides":        map[string]string{"reasoning_summary": "auto"},
		"agentDefinitions": map[string]any{
			"reviewer": map[string]any{
				"description": "Review code",
				"prompt":      "Check correctness",
				"tools":       []string{"Read"},
				"model":       "sonnet",
			},
		},
		"mcpConfig": `{"servers":{"filesystem":{"command":"node"}}}`,
		"hubTaskId": "task_hub_1",
		"ephemeral": true,
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
	if errObj["code"] != errcode.ErrWorkspaceNotAllowed.Code {
		t.Fatalf("error code = %#v, want %s", errObj["code"], errcode.ErrWorkspaceNotAllowed.Code)
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

	tests := []struct {
		name    string
		workDir string
	}{
		{"any valid dir", t.TempDir()},
		{"home directory", fallbackHomeDir(t)},
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
			if errObj["code"] != errcode.ErrWorkspaceAllowlistNotConfigured.Code {
				t.Fatalf("error code = %#v, want %s", errObj["code"], errcode.ErrWorkspaceAllowlistNotConfigured.Code)
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

func TestPostRunsRejectsEmptyWorkDir(t *testing.T) {
	h := newTestHandler()
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()
	// Allowlist configured so only emptiness is under test.
	h.WorkspaceAllowlist = []string{t.TempDir()}

	cases := []struct {
		name string
		body string
	}{
		{"omitted", `{"projectId":"proj_local","threadId":"thread_local","prompt":"x"}`},
		{"empty", `{"projectId":"proj_local","threadId":"thread_local","prompt":"x","workDir":""}`},
		{"whitespace", `{"projectId":"proj_local","threadId":"thread_local","prompt":"x","workDir":"   "}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(tc.body))
			rec := httptest.NewRecorder()
			h.PostRuns(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected status 400, got %d: %s", rec.Code, rec.Body.String())
			}
			var resp map[string]any
			if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
				t.Fatalf("decode: %v", err)
			}
			errObj, ok := resp["error"].(map[string]any)
			if !ok {
				t.Fatalf("error body = %#v", resp)
			}
			if errObj["code"] != errcode.ErrWorkDirRequired.Code {
				t.Fatalf("error code = %#v, want %s", errObj["code"], errcode.ErrWorkDirRequired.Code)
			}
			if len(executor.started) != 0 {
				t.Fatalf("executor starts = %d, want 0", len(executor.started))
			}
			if runs := h.Store.ListRuns("thread_local"); len(runs) != 0 {
				t.Fatalf("stored runs = %d, want 0", len(runs))
			}
		})
	}
}

func TestPostRunsStartsExecutorAfterQueueingRun(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	_, ch, _ := h.Bus.Subscribe(0)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"workDir":%q}`, workDir)))
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
	workDir := allowTestWorkspace(t, h)
	h.Executor = &fakeRunExecutor{err: errors.New("start failed")}

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"workDir":%q}`, workDir)))
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d", rec.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	body = unwrapSuccess(body)
	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("error body = %#v, want error object", body)
	}
	if errObj["code"] != errcode.ErrExecutorStartFailed.Code {
		t.Fatalf("error code = %#v, want %s", errObj["code"], errcode.ErrExecutorStartFailed.Code)
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
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","workDir":%q}`, workDir)))
	rec := httptest.NewRecorder()
	h.PostRuns(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("first POST /v1/runs status = %d, want 202", rec.Code)
	}
	if len(executor.started) != 1 {
		t.Fatalf("executor starts after first run = %d, want 1", len(executor.started))
	}
	firstRunID := executor.started[0].ID

	req = httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","workDir":%q}`, workDir)))
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
	body = unwrapSuccess(body)
	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("error body = %#v, want error object", body)
	}
	if errObj["code"] != errcode.ErrActiveRunExists.Code {
		t.Fatalf("error code = %#v, want %s", errObj["code"], errcode.ErrActiveRunExists.Code)
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
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","workDir":%q}`, workDir)))
	rec := httptest.NewRecorder()
	h.PostRuns(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("first POST /v1/runs status = %d, want 202", rec.Code)
	}
	firstRunID := executor.started[0].ID
	if _, ok := h.Store.SetRunStatus(firstRunID, "finished"); !ok {
		t.Fatal("SetRunStatus returned ok=false")
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","workDir":%q}`, workDir)))
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
	workDir := allowTestWorkspace(t, h)
	failingExecutor := &fakeRunExecutor{err: errors.New("start failed")}
	h.Executor = failingExecutor

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","workDir":%q}`, workDir)))
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
	req = httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","workDir":%q}`, workDir)))
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
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.ensureDefaults()

	for i := 0; i < runcontrol.DefaultRunCleanupMaxTerminalRunsPerThread+1; i++ {
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

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","workDir":%q}`, workDir)))
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
	if got := h.Store.ListRuns("thread_local"); len(got) != runcontrol.DefaultRunCleanupMaxTerminalRunsPerThread+1 {
		t.Fatalf("thread run count = %d, want retained terminal runs plus new active run", len(got))
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
	_, _ = h.Store.CreateProject("proj_local", "Local", "")
	_, _ = h.Store.CreateThread("thread_local", "proj_local", "Thread", "", "", "")
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
	body = unwrapSuccess(body)

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
	body = unwrapSuccess(body)
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
	body = unwrapSuccess(body)
	if body["status"] != run.Status {
		t.Fatalf("status = %#v, want %q", body["status"], run.Status)
	}
}

func TestMuxPostRunsRoute(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"workDir":%q}`, workDir)))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d; body=%s", rec.Code, rec.Body.String())
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
	_, _ = h.Store.CreateProject("proj_local", "Local", "")
	_, _ = h.Store.CreateThread("thread_local", "proj_local", "Thread", "", "", "")
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
	workDir := allowTestWorkspace(t, h)
	_, ch, _ := h.Bus.Subscribe(0)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"workDir":%q}`, workDir)))
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

// ---------------------------------------------------------------------------
// Dual-token auth tests (AH-SR-046)
// ---------------------------------------------------------------------------

const testCapSecret = "my-secret-key-for-capability-test-32" // 32+ bytes for HMAC-SHA256

// newCapToken generates a valid HS256 capability token for testing.

func newCapToken(secret, userID, deviceID, projectID, purpose string, expiresIn time.Duration) string {
	claims := jwtutil.CapabilityClaims{
		UserID:    userID,
		DeviceID:  deviceID,
		ProjectID: projectID,
		Purpose:   purpose,
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

func TestRunStartDualToken(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	capToken := newCapToken(testCapSecret, "user-1", "test-edge-001", "proj_local", "run-start", 1*time.Hour)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"dual-token test","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", capToken)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(executor.started) != 1 {
		t.Fatalf("executor starts = %d, want 1", len(executor.started))
	}
}

func TestRunStartDualToken_MissingCapabilityTokenReturns403(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","workDir":%q}`, workDir)))
	// Do NOT set X-AgentHub-Capability-Token
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrCapabilityTokenInvalid.Code)
	if len(executor.started) != 0 {
		t.Fatalf("executor starts = %d, want 0", len(executor.started))
	}
}

func TestRunStartDualToken_WrongCapabilityTokenReturns403(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	// Use wrong secret for capability token
	capToken := newCapToken("wrong-secret-that-is-also-32-bytes!!", "user-1", "test-edge-001", "proj_local", "run-start", 1*time.Hour)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", capToken)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrCapabilityTokenInvalid.Code)
}

func TestRunStartDualToken_ExpiredCapabilityTokenReturns403(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	capToken := newCapToken(testCapSecret, "user-1", "test-edge-001", "proj_local", "run-start", -1*time.Hour)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", capToken)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403 for expired token, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrCapabilityTokenInvalid.Code)
}

func TestRunStartDualToken_MismatchedProjectReturns403(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	// Capability token is for proj_other, but request uses proj_local
	capToken := newCapToken(testCapSecret, "user-1", "test-edge-001", "proj_other", "run-start", 1*time.Hour)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", capToken)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403 for mismatched project, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrCapabilityTokenInvalid.Code)
}

func TestRunStartDualToken_MismatchedUserIdentityReturns403(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	// Capability token is for user-1, but the context identity will be user-2
	capToken := newCapToken(testCapSecret, "user-1", "test-edge-001", "proj_local", "run-start", 1*time.Hour)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", capToken)
	// Inject a different user identity into context (simulating middleware)
	ctx := context.WithValue(req.Context(), edgeidentity.HubUserIDKey, "user-2")
	ctx = context.WithValue(ctx, edgeidentity.HubDeviceIDKey, "test-edge-001")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403 for mismatched user identity, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrCapabilityTokenInvalid.Code)
}

func TestRunStartDualToken_NoSecretConfiguredSkipsCapabilityCheck(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	// HubJWTSecret is empty and no Hub identity — local single-tenant path
	// still allowed without capability (AH-SR-046 / #899).
	h.HubJWTSecret = ""
	h.EdgeDeviceID = ""
	h.ensureDefaults()

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"no dual token","workDir":%q}`, workDir)))
	// No capability token header, no Hub identity in context
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	// Local empty identity + empty secret remains allowed without capability.
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202 (local single-tenant, no dual-token gate), got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(executor.started) != 1 {
		t.Fatalf("executor starts = %d, want 1", len(executor.started))
	}
}

func TestRunStartDualToken_HubIdentityMissingCapabilityReturns403(t *testing.T) {
	// #899: Hub identity + secret set + missing capability → 403 (no soft-skip).
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"hub identity no cap","workDir":%q}`, workDir)))
	// Hub identity present, but no X-AgentHub-Capability-Token
	ctx := context.WithValue(req.Context(), edgeidentity.HubUserIDKey, "user-hub")
	ctx = context.WithValue(ctx, edgeidentity.HubDeviceIDKey, "test-edge-001")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrCapabilityTokenInvalid.Code)
	if len(executor.started) != 0 {
		t.Fatalf("executor starts = %d, want 0", len(executor.started))
	}
}

func TestRunStartDualToken_HubIdentityEmptySecretFailsClosed(t *testing.T) {
	// #899: Hub identity + empty secret → fail closed (config error), not soft-skip.
	//
	// The status is asserted as the literal 503, NOT as
	// errcode.ErrNotConfigured.HTTPStatus: the point of this test is to pin the
	// wire contract, and a derived expectation would keep passing if the code
	// table itself drifted. 503 is a deliberate change from the historical 403 —
	// the site used to hand-copy http.StatusForbidden while the body already said
	// not_configured, so an operator misconfiguration was reported to the client
	// as "your credentials are wrong, do not retry" (#2245).
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = ""
	h.EdgeDeviceID = ""
	h.ensureDefaults()

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"hub identity no secret","workDir":%q}`, workDir)))
	// Inject Hub identity even though secret is empty (defense-in-depth residual).
	ctx := context.WithValue(req.Context(), edgeidentity.HubUserIDKey, "user-hub")
	ctx = context.WithValue(ctx, edgeidentity.HubDeviceIDKey, "test-edge-001")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503 (fail closed config error, not_configured), got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrNotConfigured.Code)
	if len(executor.started) != 0 {
		t.Fatalf("executor starts = %d, want 0", len(executor.started))
	}
}

func TestRunStartDualToken_WithMatchingIdentityContext(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	capToken := newCapToken(testCapSecret, "user-alice", "test-edge-001", "proj_local", "run-start", 1*time.Hour)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"matched identity","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", capToken)
	// Inject matching identity into context
	ctx := context.WithValue(req.Context(), edgeidentity.HubUserIDKey, "user-alice")
	ctx = context.WithValue(ctx, edgeidentity.HubDeviceIDKey, "test-edge-001")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202 with matching identity, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(executor.started) != 1 {
		t.Fatalf("executor starts = %d, want 1", len(executor.started))
	}
}

func TestRunStartDualToken_WrongDeviceInCapabilityTokenReturns403(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	// Capability token is for device "other-device" but Edge expects "test-edge-001"
	capToken := newCapToken(testCapSecret, "user-1", "other-device", "proj_local", "run-start", 1*time.Hour)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", capToken)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403 for wrong device, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrCapabilityTokenInvalid.Code)
}

func TestRunStartDualToken_WrongPurposeReturns403(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	capToken := newCapToken(testCapSecret, "user-1", "test-edge-001", "proj_local", "not-run-start", 1*time.Hour)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"purpose test","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", capToken)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrCapabilityTokenInvalid.Code)
	if len(executor.started) != 0 {
		t.Fatalf("executor starts = %d, want 0", len(executor.started))
	}
}

func TestRunStartDualToken_WrongActionReturns403(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	claims := jwtutil.CapabilityClaims{
		UserID: "user-1", DeviceID: "test-edge-001", ProjectID: "proj_local",
		Purpose: "run-start", Action: "stream",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "agenthub-hub", Audience: jwt.ClaimStrings{"agenthub-edge"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now()),
		},
	}
	tok, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testCapSecret))
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"action test","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", tok)
	rec := httptest.NewRecorder()
	h.PostRuns(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(executor.started) != 0 {
		t.Fatalf("executor starts = %d, want 0", len(executor.started))
	}
}

func TestRunStartDualToken_WrongThreadReturns403(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	claims := jwtutil.CapabilityClaims{
		UserID: "user-1", DeviceID: "test-edge-001", ProjectID: "proj_local",
		Purpose: "run-start", Action: "run-start", ThreadID: "thread_other",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "agenthub-hub", Audience: jwt.ClaimStrings{"agenthub-edge"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now()),
		},
	}
	tok, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testCapSecret))
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"thread test","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", tok)
	rec := httptest.NewRecorder()
	h.PostRuns(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(executor.started) != 0 {
		t.Fatalf("executor starts = %d, want 0", len(executor.started))
	}
}

func TestRunStartDualToken_WrongTargetReturns403(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	claims := jwtutil.CapabilityClaims{
		UserID: "user-1", DeviceID: "test-edge-001", ProjectID: "proj_local",
		Purpose: "run-start", Action: "run-start", TargetID: "target-a",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "agenthub-hub", Audience: jwt.ClaimStrings{"agenthub-edge"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now()),
		},
	}
	tok, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testCapSecret))
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"target test","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", tok)
	req.Header.Set("X-AgentHub-Target-Id", "target-b")
	rec := httptest.NewRecorder()
	h.PostRuns(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(executor.started) != 0 {
		t.Fatalf("executor starts = %d, want 0", len(executor.started))
	}
}

func TestRunStartDualToken_MatchingTargetAndThreadAccepted(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	claims := jwtutil.CapabilityClaims{
		UserID: "user-1", DeviceID: "test-edge-001", ProjectID: "proj_local",
		Purpose: "run-start", Action: "run-start", TargetID: "target-a", ThreadID: "thread_local",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "agenthub-hub", Audience: jwt.ClaimStrings{"agenthub-edge"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now()),
		},
	}
	tok, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testCapSecret))
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"bound ok","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", tok)
	req.Header.Set("X-AgentHub-Target-Id", "target-a")
	rec := httptest.NewRecorder()
	h.PostRuns(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(executor.started) != 1 {
		t.Fatalf("executor starts = %d, want 1", len(executor.started))
	}
}

// issueHubShapedCapToken mirrors hub-server IssueCapabilityToken wire claims
// (issuer/audience/nbf + action/target/thread) for PostRuns dual-token fixture
// evidence (AH-SR-046 residual / #461). No production network.

func issueHubShapedCapToken(secret, userID, deviceID, projectID, purpose, action, targetID, threadID string, expiresIn time.Duration) string {
	if purpose == "" {
		purpose = "run-start"
	}
	if action == "" {
		action = purpose
	}
	now := time.Now()
	claims := jwtutil.CapabilityClaims{
		UserID:    userID,
		DeviceID:  deviceID,
		ProjectID: projectID,
		Purpose:   purpose,
		Action:    action,
		TargetID:  targetID,
		ThreadID:  threadID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-edge"},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now.Add(-5 * time.Second)),
			ExpiresAt: jwt.NewNumericDate(now.Add(expiresIn)),
		},
	}
	tok, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	return tok
}

func TestRunStartDualToken_HubIssueShape_AcceptsBoundToken(t *testing.T) {
	// AH-SR-046 / #461 fixture: Hub-shaped issue → Edge PostRuns validate path.
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	capToken := issueHubShapedCapToken(testCapSecret, "user-1", "test-edge-001", "proj_local", "run-start", "run-start", "target-a", "thread_local", time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"hub-issue shape ok","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", capToken)
	req.Header.Set("X-AgentHub-Target-Id", "target-a")
	ctx := context.WithValue(req.Context(), edgeidentity.HubUserIDKey, "user-1")
	ctx = context.WithValue(ctx, edgeidentity.HubDeviceIDKey, "test-edge-001")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(executor.started) != 1 {
		t.Fatalf("executor starts = %d, want 1", len(executor.started))
	}
}

func TestRunStartDualToken_HubIssueShape_RejectsWrongThread(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	capToken := issueHubShapedCapToken(testCapSecret, "user-1", "test-edge-001", "proj_local", "run-start", "run-start", "target-a", "thread_other", time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"hub-issue wrong thread","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", capToken)
	req.Header.Set("X-AgentHub-Target-Id", "target-a")
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrCapabilityTokenInvalid.Code)
	if len(executor.started) != 0 {
		t.Fatalf("executor starts = %d, want 0", len(executor.started))
	}
}

func TestRunStartDualToken_HubIssueShape_RejectsWrongTarget(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	capToken := issueHubShapedCapToken(testCapSecret, "user-1", "test-edge-001", "proj_local", "run-start", "run-start", "target-a", "thread_local", time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"hub-issue wrong target","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", capToken)
	req.Header.Set("X-AgentHub-Target-Id", "target-b")
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrCapabilityTokenInvalid.Code)
	if len(executor.started) != 0 {
		t.Fatalf("executor starts = %d, want 0", len(executor.started))
	}
}

func TestRunStartDualToken_HubIssueShape_RejectsWrongAction(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	executor := &fakeRunExecutor{}
	h.Executor = executor
	h.HubJWTSecret = testCapSecret
	h.EdgeDeviceID = "test-edge-001"
	h.ensureDefaults()

	// Hand-craft action mismatch (Hub issuer would refuse action!=purpose).
	claims := jwtutil.CapabilityClaims{
		UserID: "user-1", DeviceID: "test-edge-001", ProjectID: "proj_local",
		Purpose: "run-start", Action: "stream", TargetID: "target-a", ThreadID: "thread_local",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "agenthub-hub", Audience: jwt.ClaimStrings{"agenthub-edge"},
			IssuedAt: jwt.NewNumericDate(time.Now()), NotBefore: jwt.NewNumericDate(time.Now().Add(-5 * time.Second)),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	tok, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testCapSecret))
	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(fmt.Sprintf(`{"projectId":"proj_local","threadId":"thread_local","prompt":"hub-issue wrong action","workDir":%q}`, workDir)))
	req.Header.Set("X-AgentHub-Capability-Token", tok)
	req.Header.Set("X-AgentHub-Target-Id", "target-a")
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrCapabilityTokenInvalid.Code)
	if len(executor.started) != 0 {
		t.Fatalf("executor starts = %d, want 0", len(executor.started))
	}
}
