package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/store"
	"github.com/agenthub/pkg/jwtutil"
)

// admissionExecutor is a controllable RunExecutor used to prove the
// delivery-admission contract without mocking PostRuns/runcontrol:
//   - counts every Start call so tests can assert "second run started once"
//   - can fail the next Start (owner release after a failed attempt)
//   - can block the next Start until release (holds the admission window open)
type admissionExecutor struct {
	mu        sync.Mutex
	starts    []store.Run
	err       error
	blockNext bool
	failNext  bool
	entered   chan string // buffered; signalled when a blocking Start is entered
	release   chan struct{}
}

func (e *admissionExecutor) Start(run store.Run, ctx lifecycle.RunProcessContext) error {
	e.mu.Lock()
	e.starts = append(e.starts, run)
	fail := e.failNext
	block := e.blockNext
	e.failNext = false
	e.blockNext = false
	e.mu.Unlock()
	if fail {
		return e.err
	}
	if block {
		if e.entered != nil {
			select {
			case e.entered <- run.ID:
			default:
			}
		}
		if e.release != nil {
			<-e.release
		}
	}
	return nil
}

func (e *admissionExecutor) StartCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.starts)
}

func (e *admissionExecutor) Cancel(runID string) lifecycle.CancelResult {
	return lifecycle.CancelResult{Found: false}
}

// newDeliveryTestServer builds a real httptest server with a controllable
// executor. config may override Handler fields (e.g. HubJWTSecret/EdgeDeviceID).
func newDeliveryTestServer(t *testing.T, exec lifecycle.RunExecutor, config func(*Handler)) (*httptest.Server, *Handler) {
	t.Helper()
	h := newTestHandler()
	if h.Bus != nil {
		t.Cleanup(func() {
			if err := h.Bus.Close(); err != nil {
				t.Errorf("close event bus: %v", err)
			}
		})
	}
	if exec != nil {
		h.Executor = exec
	}
	if config != nil {
		config(h)
	}
	h.WorkspaceAllowlist = []string{t.TempDir()}
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	return httptest.NewServer(mux), h
}

type postResult struct {
	status int
	body   map[string]any
	resp   *http.Response
}

// httpPostJSON performs POST /v1/runs without touching testing.T, so it is safe
// to call from a spawned goroutine (unlike helpers that call t.Fatalf).
func httpPostJSON(url, body string) (postResult, error) {
	resp, err := http.Post(url+"/v1/runs", "application/json", strings.NewReader(body))
	if err != nil {
		return postResult{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	return postResult{status: resp.StatusCode, body: m, resp: resp}, nil
}

func postRunsRaw(t *testing.T, serverURL, body string) postResult {
	t.Helper()
	pr, err := httpPostJSON(serverURL, body)
	if err != nil {
		t.Fatalf("POST %s: %v", serverURL, err)
	}
	return pr
}

func doReq(t *testing.T, req *http.Request) postResult {
	t.Helper()
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do req: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	return postResult{status: resp.StatusCode, body: m, resp: resp}
}

func admissionRunBody(workDir, deliveryID, hubTaskID string, extra map[string]any) string {
	m := map[string]any{"prompt": "admission-regression-run", "workDir": workDir}
	if deliveryID != "" {
		m["deliveryId"] = deliveryID
	}
	if hubTaskID != "" {
		m["hubTaskId"] = hubTaskID
	}
	for k, v := range extra {
		m[k] = v
	}
	b, _ := json.Marshal(m)
	return string(b)
}

func errCode(body map[string]any) string {
	if e, ok := body["error"].(map[string]any); ok {
		if c, ok := e["code"].(string); ok {
			return c
		}
	}
	return ""
}

func signCapability(hmacSigningKey, userID, deviceID, projectID, purpose string, ttl time.Duration) string {
	tok, err := jwtutil.IssueCapabilityToken([]byte(hmacSigningKey), userID, deviceID, projectID, purpose, ttl)
	if err != nil {
		panic(fmt.Sprintf("sign capability: %v", err))
	}
	return tok
}

// ── 1. Reject before admission, then retry the SAME delivery id must admit a
// real run (not a fake cached 202). ─────────────────────────────────────────

func TestDeliveryAdmission_RejectBeforeAdmission_RetryGetsRealRun(t *testing.T) {
	exec := &admissionExecutor{}
	server, h := newDeliveryTestServer(t, exec, nil)
	defer server.Close()

	// Occupy the default thread with an active run so admission is rejected.
	h.ensureDefaults()
	if _, err := h.Store.CreateRun("run-occupied", "proj_local", "thread_local"); err != nil {
		t.Fatalf("create occupant run: %v", err)
	}
	body := admissionRunBody(h.WorkspaceAllowlist[0], "del-reject-retry", "", nil)

	resp1 := postRunsRaw(t, server.URL, body)
	if resp1.status != http.StatusConflict {
		t.Fatalf("first admission: expected 409 active_run_exists, got %d: %#v", resp1.status, resp1.body)
	}
	if errCode(resp1.body) != "active_run_exists" {
		t.Fatalf("expected code active_run_exists, got %q", errCode(resp1.body))
	}

	// Free the occupant so the same delivery can now be admitted.
	if _, ok := h.Store.SetRunStatus("run-occupied", "finished"); !ok {
		t.Fatalf("could not free occupant run")
	}

	resp2 := postRunsRaw(t, server.URL, body)
	if resp2.status != http.StatusAccepted {
		t.Fatalf("retry after freeing: expected 202, got %d: %#v", resp2.status, resp2.body)
	}
	data := unwrapSuccess(resp2.body)
	runID, _ := data["runId"].(string)
	if runID == "" {
		t.Fatalf("retry must return a real runId; got a fake deduplicated 202: %#v", data)
	}
	if v, _ := data["deduplicated"].(bool); v {
		t.Fatalf("retry after admission rejection must not be a deduplicated 202: %#v", data)
	}
	if exec.StartCount() != 1 {
		t.Fatalf("expected exactly one executor start on admitted retry, got %d", exec.StartCount())
	}
}

// ── 2. Success then replay returns the ORIGINAL run id, no second start. ────

func TestDeliveryAdmission_SuccessReplayReturnsOriginalRunID(t *testing.T) {
	exec := &admissionExecutor{}
	server, h := newDeliveryTestServer(t, exec, nil)
	defer server.Close()
	body := admissionRunBody(h.WorkspaceAllowlist[0], "del-same-run", "task-1", nil)

	resp1 := postRunsRaw(t, server.URL, body)
	if resp1.status != http.StatusAccepted {
		t.Fatalf("first: expected 202, got %d: %#v", resp1.status, resp1.body)
	}
	data1 := unwrapSuccess(resp1.body)
	runID, _ := data1["runId"].(string)
	if runID == "" {
		t.Fatalf("first run missing runId: %#v", data1)
	}

	resp2 := postRunsRaw(t, server.URL, body)
	if resp2.status != http.StatusAccepted {
		t.Fatalf("replay: expected 202, got %d: %#v", resp2.status, resp2.body)
	}
	data2 := unwrapSuccess(resp2.body)
	if got, _ := data2["runId"].(string); got != runID {
		t.Fatalf("replay must return original runId %q, got %#v", runID, data2)
	}
	if v, _ := data2["deduplicated"].(bool); !v {
		t.Fatalf("replay must carry deduplicated=true: %#v", data2)
	}
	if got, _ := data2["deliveryId"].(string); got != "del-same-run" {
		t.Fatalf("replay must carry deliveryId, got %#v", data2)
	}
	if exec.StartCount() != 1 {
		t.Fatalf("replay must not start a second executor; starts=%d", exec.StartCount())
	}
}

// ── 2c. Same deliveryId + same HubTaskId but a DIFFERENT thread (the two
// channels legitimately use different thread representations) must replay the
// original run and its real original scope, not conflict and not re-execute. ─
func TestDeliveryAdmission_SameHubTaskIDDifferentThreadReplaysOriginalRun(t *testing.T) {
	exec := &admissionExecutor{}
	server, h := newDeliveryTestServer(t, exec, nil)
	defer server.Close()
	h.ensureDefaults()
	if _, err := h.Store.CreateThread("thread-B", "proj_local", "Thread B", "direct", "", ""); err != nil {
		t.Fatalf("create thread-B: %v", err)
	}
	wd := h.WorkspaceAllowlist[0]

	body1 := admissionRunBody(wd, "del-thread-diff", "task-1", nil)
	resp1 := postRunsRaw(t, server.URL, body1)
	if resp1.status != http.StatusAccepted {
		t.Fatalf("first: expected 202, got %d: %#v", resp1.status, resp1.body)
	}
	data1 := unwrapSuccess(resp1.body)
	runID, _ := data1["runId"].(string)
	if runID == "" {
		t.Fatalf("first run missing runId: %#v", data1)
	}
	if got, _ := data1["threadId"].(string); got != "thread_local" {
		t.Fatalf("first run scope threadId = %q, want thread_local", got)
	}

	// Same deliveryId + same HubTaskId, but the replay uses a different thread
	// (channel representation). Must return the ORIGINAL run (thread_local
	// scope) and not execute again.
	body2 := admissionRunBody(wd, "del-thread-diff", "task-1", map[string]any{"threadId": "thread-B"})
	resp2 := postRunsRaw(t, server.URL, body2)
	if resp2.status != http.StatusAccepted {
		t.Fatalf("replay (different thread): expected 202, got %d: %#v", resp2.status, resp2.body)
	}
	data2 := unwrapSuccess(resp2.body)
	if got, _ := data2["runId"].(string); got != runID {
		t.Fatalf("replay must return original runId %q, got %#v", runID, data2)
	}
	if got, _ := data2["threadId"].(string); got != "thread_local" {
		t.Fatalf("replay must assert the REAL original scope threadId=thread_local, got %q: %#v", got, data2)
	}
	if exec.StartCount() != 1 {
		t.Fatalf("same HubTaskId replay must not start a second executor; starts=%d", exec.StartCount())
	}
}

// ── 2b. Distinct delivery ids and legacy (no id) process independently. ─────

func TestDeliveryAdmission_DistinctIDsAndLegacyProcessedIndependently(t *testing.T) {
	exec := &admissionExecutor{}
	server, h := newDeliveryTestServer(t, exec, nil)
	defer server.Close()
	h.ensureDefaults()
	for _, th := range []string{"thread-B", "thread-C"} {
		if _, err := h.Store.CreateThread(th, "proj_local", th, "direct", "", ""); err != nil {
			t.Fatalf("create %s: %v", th, err)
		}
	}
	wd := h.WorkspaceAllowlist[0]

	r1 := postRunsRaw(t, server.URL, admissionRunBody(wd, "del-A", "", nil))
	r2 := postRunsRaw(t, server.URL, admissionRunBody(wd, "del-B", "", map[string]any{"threadId": "thread-B"}))
	r3 := postRunsRaw(t, server.URL, admissionRunBody(wd, "", "", map[string]any{"threadId": "thread-C"}))

	if r1.status != http.StatusAccepted || r2.status != http.StatusAccepted || r3.status != http.StatusAccepted {
		t.Fatalf("independent runs: expected all 202, got %d/%d/%d", r1.status, r2.status, r3.status)
	}
	idA := unwrapSuccess(r1.body)["runId"]
	idB := unwrapSuccess(r2.body)["runId"]
	if idA == idB {
		t.Fatalf("distinct delivery ids must produce distinct runs, both=%v", idA)
	}
	if v, _ := unwrapSuccess(r2.body)["deduplicated"].(bool); v {
		t.Fatalf("distinct delivery id must NOT be deduplicated: %#v", unwrapSuccess(r2.body))
	}
	if _, ok := unwrapSuccess(r3.body)["deduplicated"]; ok {
		t.Fatalf("legacy (no delivery id) must not carry deduplicated: %#v", unwrapSuccess(r3.body))
	}
	if exec.StartCount() != 3 {
		t.Fatalf("expected 3 starts for 3 independent runs, got %d", exec.StartCount())
	}
}

// ── 3. Concurrent same delivery id during admission returns 503 busy with
// Retry-After; replay after completion returns same run id. No time.Sleep. ──

func TestDeliveryAdmission_ConcurrentSameIDReturnsBusy(t *testing.T) {
	entered := make(chan string, 1)
	release := make(chan struct{})

	exec := &admissionExecutor{blockNext: true, entered: entered, release: release}
	server, h := newDeliveryTestServer(t, exec, nil)
	defer server.Close()
	// Must be registered AFTER server.Close() so this runs first (LIFO) and
	// unblocks the held admission request before the server is torn down.
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()

	body := admissionRunBody(h.WorkspaceAllowlist[0], "del-busy", "", nil)

	// First request: admission is held open inside executor Start.
	firstPost := make(chan postResult, 1)
	go func() {
		pr, err := httpPostJSON(server.URL, body)
		if err != nil {
			t.Errorf("first post: %v", err)
			firstPost <- postResult{status: 0}
			return
		}
		firstPost <- pr
	}()

	select {
	case rid := <-entered:
		_ = rid
	case <-time.After(5 * time.Second):
		t.Fatal("first request did not enter admission in time")
	}

	// Second same delivery id while the first admission is held -> busy, not 202.
	resp2 := postRunsRaw(t, server.URL, body)
	if resp2.status != http.StatusServiceUnavailable {
		t.Fatalf("concurrent duplicate must be 503 delivery_busy, got %d: %#v", resp2.status, resp2.body)
	}
	if errCode(resp2.body) != "delivery_busy" {
		t.Fatalf("expected code delivery_busy, got %q", errCode(resp2.body))
	}
	if resp2.resp.Header.Get("Retry-After") == "" {
		t.Fatalf("503 delivery_busy must carry a Retry-After header")
	}

	// Release the first admission; it completes with a real run id.
	close(release)
	first := <-firstPost
	if first.status != http.StatusAccepted {
		t.Fatalf("first admission should complete 202, got %d: %#v", first.status, first.body)
	}
	runID, _ := unwrapSuccess(first.body)["runId"].(string)
	if runID == "" {
		t.Fatalf("first admitted run missing runId: %#v", unwrapSuccess(first.body))
	}

	// Replay after completion returns the same run id, no second start.
	resp3 := postRunsRaw(t, server.URL, body)
	if resp3.status != http.StatusAccepted {
		t.Fatalf("replay after completion: expected 202, got %d: %#v", resp3.status, resp3.body)
	}
	if got, _ := unwrapSuccess(resp3.body)["runId"].(string); got != runID {
		t.Fatalf("replay after completion must return same runId %q, got %#v", runID, unwrapSuccess(resp3.body))
	}
	if exec.StartCount() != 1 {
		t.Fatalf("expected one start across busy + replay, got %d", exec.StartCount())
	}
}

// ── 3b. A failed owner releases the claim so a retry is admitted fresh. ─────

func TestDeliveryAdmission_FailedOwnerReleasesClaim(t *testing.T) {
	exec := &admissionExecutor{err: fmt.Errorf("start failed")}
	exec.failNext = true
	server, h := newDeliveryTestServer(t, exec, nil)
	defer server.Close()
	body := admissionRunBody(h.WorkspaceAllowlist[0], "del-fail-retry", "", nil)

	resp1 := postRunsRaw(t, server.URL, body)
	if resp1.status == http.StatusAccepted {
		t.Fatalf("failing first attempt must not be accepted, got 202: %#v", resp1.body)
	}

	// Owner released the claim: the same delivery id can be admitted again.
	resp2 := postRunsRaw(t, server.URL, body)
	if resp2.status != http.StatusAccepted {
		t.Fatalf("retry after failed owner must be accepted, got %d: %#v", resp2.status, resp2.body)
	}
	data := unwrapSuccess(resp2.body)
	if runID, _ := data["runId"].(string); runID == "" {
		t.Fatalf("retry must return a real runId after failure, got %#v", data)
	}
	if v, _ := data["deduplicated"].(bool); v {
		t.Fatalf("retry after failed owner must not be a deduplicated 202: %#v", data)
	}
	if exec.StartCount() != 2 {
		t.Fatalf("expected two starts (failed first + admitted retry), got %d", exec.StartCount())
	}
}

// ── 4. A committed receipt cannot bypass capability validation. ─────────────

func TestDeliveryAdmission_ReceiptCannotBypassCapability(t *testing.T) {
	const hmacSigningKey = "0123456789abcdef0123456789abcdef01234567"
	exec := &admissionExecutor{}
	server, h := newDeliveryTestServer(t, exec, func(h *Handler) {
		h.HubJWTSecret = hmacSigningKey
		h.EdgeDeviceID = "test-device"
	})
	defer server.Close()
	body := admissionRunBody(h.WorkspaceAllowlist[0], "del-cap", "task-cap", nil)

	// Valid capability admits a real run.
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/runs", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-AgentHub-Capability-Token", signCapability(hmacSigningKey, "user-1", "test-device", "proj_local", "run-start", time.Hour))
	resp1 := doReq(t, req)
	if resp1.status != http.StatusAccepted {
		t.Fatalf("valid capability must admit, got %d: %#v", resp1.status, resp1.body)
	}
	if runID, _ := unwrapSuccess(resp1.body)["runId"].(string); runID == "" {
		t.Fatalf("valid-capability run missing runId: %#v", unwrapSuccess(resp1.body))
	}

	// Same delivery id but NO capability token must still be rejected, not a
	// cached 202 that skipped the per-request capability gate.
	req2, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/runs", strings.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	resp2 := doReq(t, req2)
	if resp2.status != http.StatusForbidden {
		t.Fatalf("duplicate without capability must be 403, got %d: %#v", resp2.status, resp2.body)
	}
	if errCode(resp2.body) != "capability_token_invalid" {
		t.Fatalf("expected capability_token_invalid, got %q", errCode(resp2.body))
	}
}

// ── 4a2. A committed receipt on replay must re-validate capability against
// the ORIGINAL run scope: presenting a capability bound to a different scope
// cannot be used to read the original run. ──────────────────────────────────
func TestDeliveryAdmission_ReplayCannotUseDifferentScopeCapability(t *testing.T) {
	const hmacSigningKey = "0123456789abcdef0123456789abcdef01234567"
	exec := &admissionExecutor{}
	server, h := newDeliveryTestServer(t, exec, func(h *Handler) {
		h.HubJWTSecret = hmacSigningKey
		h.EdgeDeviceID = "test-device"
	})
	defer server.Close()
	wd := h.WorkspaceAllowlist[0]

	// First: capability bound to proj_local, hubTaskId present.
	body1 := admissionRunBody(wd, "del-cap-scope", "task-cap-scope", map[string]any{"projectId": "proj_local"})
	req1, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/runs", strings.NewReader(body1))
	req1.Header.Set("Content-Type", "application/json")
	req1.Header.Set("X-AgentHub-Capability-Token", signCapability(hmacSigningKey, "user-1", "test-device", "proj_local", "run-start", time.Hour))
	resp1 := doReq(t, req1)
	if resp1.status != http.StatusAccepted {
		t.Fatalf("first (proj_local capability): expected 202, got %d: %#v", resp1.status, resp1.body)
	}
	if runID, _ := unwrapSuccess(resp1.body)["runId"].(string); runID == "" {
		t.Fatalf("first run missing runId: %#v", unwrapSuccess(resp1.body))
	}

	// Replay with same deliveryId + same HubTaskId, but a capability bound to a
	// DIFFERENT scope (proj_other). The per-request capability matches the
	// request body, but it must NOT be usable to read the original (proj_local)
	// run → 403 capability_token_invalid.
	body2 := admissionRunBody(wd, "del-cap-scope", "task-cap-scope", map[string]any{"projectId": "proj_other"})
	req2, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/runs", strings.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-AgentHub-Capability-Token", signCapability(hmacSigningKey, "user-1", "test-device", "proj_other", "run-start", time.Hour))
	resp2 := doReq(t, req2)
	if resp2.status != http.StatusForbidden {
		t.Fatalf("replay with different-scope capability must be 403, got %d: %#v", resp2.status, resp2.body)
	}
	if errCode(resp2.body) != "capability_token_invalid" {
		t.Fatalf("expected capability_token_invalid, got %q", errCode(resp2.body))
	}
}

// ── 4b. Same delivery id with a different binding must conflict (409), not
// reuse another run. ────────────────────────────────────────────────────────

func TestDeliveryAdmission_SameDeliveryIDDifferentBindingConflicts(t *testing.T) {
	exec := &admissionExecutor{}
	server, h := newDeliveryTestServer(t, exec, nil)
	defer server.Close()
	wd := h.WorkspaceAllowlist[0]

	body1 := admissionRunBody(wd, "del-bind", "task-1", nil)
	resp1 := postRunsRaw(t, server.URL, body1)
	if resp1.status != http.StatusAccepted {
		t.Fatalf("first: expected 202, got %d: %#v", resp1.status, resp1.body)
	}
	if runID, _ := unwrapSuccess(resp1.body)["runId"].(string); runID == "" {
		t.Fatalf("first binding run missing runId: %#v", unwrapSuccess(resp1.body))
	}

	// Same delivery id, different hubTaskId binding → 409 delivery_conflict.
	body2 := admissionRunBody(wd, "del-bind", "task-2", nil)
	resp2 := postRunsRaw(t, server.URL, body2)
	if resp2.status != http.StatusConflict {
		t.Fatalf("same delivery id different binding must be 409 delivery_conflict, got %d: %#v", resp2.status, resp2.body)
	}
	if errCode(resp2.body) != "delivery_conflict" {
		t.Fatalf("expected code delivery_conflict, got %q", errCode(resp2.body))
	}
}

// ── 4c. Legacy (no HubTaskId): different project/thread on the same delivery
// id is a scope conflict → 409 delivery_conflict (no HubTaskId to bind on). ──
func TestDeliveryAdmission_LegacyDifferentThreadConflicts(t *testing.T) {
	exec := &admissionExecutor{}
	server, h := newDeliveryTestServer(t, exec, nil)
	defer server.Close()
	h.ensureDefaults()
	if _, err := h.Store.CreateThread("thread-B", "proj_local", "Thread B", "direct", "", ""); err != nil {
		t.Fatalf("create thread-B: %v", err)
	}
	wd := h.WorkspaceAllowlist[0]

	body1 := admissionRunBody(wd, "del-legacy-conflict", "", nil) // no hubTaskId, thread_local
	resp1 := postRunsRaw(t, server.URL, body1)
	if resp1.status != http.StatusAccepted {
		t.Fatalf("first legacy: expected 202, got %d: %#v", resp1.status, resp1.body)
	}
	if runID, _ := unwrapSuccess(resp1.body)["runId"].(string); runID == "" {
		t.Fatalf("first legacy run missing runId: %#v", unwrapSuccess(resp1.body))
	}

	// Same delivery id, no hubTaskId, but a different thread → legacy scope
	// conflict (there is no HubTaskId primary binding to absorb the difference).
	body2 := admissionRunBody(wd, "del-legacy-conflict", "", map[string]any{"threadId": "thread-B"})
	resp2 := postRunsRaw(t, server.URL, body2)
	if resp2.status != http.StatusConflict {
		t.Fatalf("legacy different thread must be 409 delivery_conflict, got %d: %#v", resp2.status, resp2.body)
	}
	if errCode(resp2.body) != "delivery_conflict" {
		t.Fatalf("expected code delivery_conflict, got %q", errCode(resp2.body))
	}
}
