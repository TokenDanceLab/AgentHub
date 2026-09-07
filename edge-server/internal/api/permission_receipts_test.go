package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/permission"
	"github.com/agenthub/edge-server/internal/store"
)

func seedModernApprovalRun(t *testing.T, repo store.Repository, key, runID, ownerID, hubTaskID string) {
	t.Helper()
	projectID := "proj-receipt-" + key
	threadID := "thread-receipt-" + key
	if _, err := repo.CreateProject(projectID, "Receipt "+key, ownerID); err != nil {
		t.Fatalf("CreateProject(%s): %v", projectID, err)
	}
	if _, err := repo.CreateThread(threadID, projectID, "Receipt "+key, "", "", ""); err != nil {
		t.Fatalf("CreateThread(%s): %v", threadID, err)
	}
	if _, err := repo.CreateRun(runID, projectID, threadID); err != nil {
		t.Fatalf("CreateRun(%s): %v", runID, err)
	}
	if _, ok := repo.SetRunHubTaskID(runID, hubTaskID); !ok {
		t.Fatalf("SetRunHubTaskID(%s) failed", runID)
	}
}

func registerModernPendingRegistry(t *testing.T, h *Handler, runID, requestID, projectID, threadID string) {
	t.Helper()
	registry := h.ensurePermissionRegistry()
	if !registry.Register(permission.PendingPermission{
		ProjectID: projectID,
		ThreadID:  threadID,
		RunID:     runID,
		RequestID: requestID,
		ToolName:  "Bash",
		ToolUseID: "tool-" + requestID,
	}) {
		t.Fatalf("Register(%s/%s) failed", runID, requestID)
	}
}

func registerModernBrokerPending(t *testing.T, h *Handler, runID, requestID, projectID, threadID string) func(context.Context) adapters.PermissionDecision {
	t.Helper()
	wait, ok := h.ensurePermissionBroker().Begin(adapters.PermissionScope{
		ProjectID: projectID,
		ThreadID:  threadID,
		RunID:     runID,
	}, adapters.PermissionRequest{
		RequestID: requestID,
		ToolName:  "Bash",
		ToolUseID: "tool-" + requestID,
	})
	if !ok {
		t.Fatalf("broker.Begin(%s/%s) failed", runID, requestID)
	}
	return wait
}

func modernPermissionDecisionBody(controlID, hubTaskID, runID, requestID, decision, reason string) string {
	return fmt.Sprintf(
		`{"controlId":%q,"hubTaskId":%q,"runId":%q,"requestId":%q,"decision":%q,"reason":%q}`,
		controlID, hubTaskID, runID, requestID, decision, reason,
	)
}

func modernReceiptData(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return unwrapSuccess(body)
}

func assertModernReceipt(t *testing.T, rec *httptest.ResponseRecorder, controlID, hubTaskID, runID, requestID, decision string, deduplicated bool) {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	data := modernReceiptData(t, rec)
	for key, want := range map[string]any{
		"status":       "ok",
		"controlId":    controlID,
		"hubTaskId":    hubTaskID,
		"runId":        runID,
		"requestId":    requestID,
		"decision":     decision,
		"applied":      true,
		"deduplicated": deduplicated,
	} {
		if got := data[key]; got != want {
			t.Fatalf("data[%q] = %#v, want %#v; body=%s", key, got, want, rec.Body.String())
		}
	}
}

func TestPostPermissionDecideModernReceiptReplayIsSingleApplication(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	defer h.Bus.Close()
	seedModernApprovalRun(t, h.Store, "replay", "run-replay", "user-a", "task-replay")
	wait := registerModernBrokerPending(t, h, "run-replay", "req_1", "proj-receipt-replay", "thread-receipt-replay")
	registerModernPendingRegistry(t, h, "run-replay", "req_1", "proj-receipt-replay", "thread-receipt-replay")

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	resultCh := make(chan adapters.PermissionDecision, 1)
	go func() {
		resultCh <- wait(ctx)
	}()

	body := modernPermissionDecisionBody("control-replay", "task-replay", "run-replay", "req_1", "allow", "approved")
	first := doPermissionDecideAsUser(h, "user-a", body)
	assertModernReceipt(t, first, "control-replay", "task-replay", "run-replay", "req_1", "allow", false)

	select {
	case got := <-resultCh:
		if got.Behavior != "allow" || got.Message != "approved" {
			t.Fatalf("broker decision = %#v, want allow/approved", got)
		}
	case <-time.After(time.Second):
		t.Fatal("broker waiter was not woken")
	}
	if h.ensurePermissionBroker().PendingPermission("run-replay", "req_1") {
		t.Fatal("broker pending entry remained after first modern decision")
	}
	if _, ok := h.PermissionRegistry.Consume("run-replay", "req_1"); ok {
		t.Fatal("registry pending entry remained after first modern decision")
	}
	if got := h.Bus.HistoryLen(); got != 1 {
		t.Fatalf("event history after first decision = %d, want 1", got)
	}

	replay := doPermissionDecideAsUser(h, "user-a", body)
	assertModernReceipt(t, replay, "control-replay", "task-replay", "run-replay", "req_1", "allow", true)
	if got := h.Bus.HistoryLen(); got != 1 {
		t.Fatalf("event history after replay = %d, want 1", got)
	}
	if got := h.permissionReceipts.len(); got != 1 {
		t.Fatalf("receipt cache length = %d, want 1", got)
	}
}

func TestPostPermissionDecideModernConflictIsFailClosed(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	defer h.Bus.Close()
	seedModernApprovalRun(t, h.Store, "conflict", "run-conflict", "user-a", "task-conflict")
	registerModernPendingRegistry(t, h, "run-conflict", "req_1", "proj-receipt-conflict", "thread-receipt-conflict")

	body := modernPermissionDecisionBody("control-ok", "task-conflict", "run-conflict", "req_1", "allow", "yes")
	first := doPermissionDecideAsUser(h, "user-a", body)
	assertModernReceipt(t, first, "control-ok", "task-conflict", "run-conflict", "req_1", "allow", false)
	if got := h.Bus.HistoryLen(); got != 1 {
		t.Fatalf("event history after first decision = %d, want 1", got)
	}

	altered := doPermissionDecideAsUser(h, "user-a", modernPermissionDecisionBody("control-ok", "task-conflict", "run-conflict", "req_1", "deny", "changed"))
	if altered.Code != http.StatusConflict {
		t.Fatalf("altered replay status = %d, want 409; body=%s", altered.Code, altered.Body.String())
	}
	assertErrorCode(t, altered.Body.String(), errcode.ErrConflict.Code)
	if got := h.Bus.HistoryLen(); got != 1 {
		t.Fatalf("altered replay published %d events, want 1", got)
	}

	different := doPermissionDecideAsUser(h, "user-a", modernPermissionDecisionBody("control-other", "task-conflict", "run-conflict", "req_1", "allow", "yes"))
	if different.Code != http.StatusConflict {
		t.Fatalf("different control status = %d, want 409; body=%s", different.Code, different.Body.String())
	}
	assertErrorCode(t, different.Body.String(), errcode.ErrConflict.Code)
	if got := h.Bus.HistoryLen(); got != 1 {
		t.Fatalf("different control published %d events, want 1", got)
	}
}

func TestPostPermissionDecideModernOwnershipAndBindingFailClosed(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	defer h.Bus.Close()
	seedModernApprovalRun(t, h.Store, "auth", "run-auth", "user-a", "task-auth")
	seedModernApprovalRun(t, h.Store, "auth-other", "run-auth-other", "user-a", "task-auth")
	_ = registerModernBrokerPending(t, h, "run-auth", "req_1", "proj-receipt-auth", "thread-receipt-auth")
	_ = registerModernBrokerPending(t, h, "run-auth-other", "req_2", "proj-receipt-auth-other", "thread-receipt-auth-other")
	registerModernPendingRegistry(t, h, "run-auth", "req_1", "proj-receipt-auth", "thread-receipt-auth")
	registerModernPendingRegistry(t, h, "run-auth-other", "req_2", "proj-receipt-auth-other", "thread-receipt-auth-other")

	nonOwner := doPermissionDecideAsUser(h, "user-b", modernPermissionDecisionBody("control-user", "task-auth", "run-auth", "req_1", "allow", "x"))
	if nonOwner.Code != http.StatusNotFound {
		t.Fatalf("non-owner status = %d, want 404; body=%s", nonOwner.Code, nonOwner.Body.String())
	}
	if got := h.Bus.HistoryLen(); got != 0 {
		t.Fatalf("non-owner published %d events, want 0", got)
	}
	if !h.ensurePermissionBroker().PendingPermission("run-auth", "req_1") {
		t.Fatal("non-owner consumed the pending request")
	}

	wrongTask := doPermissionDecideAsUser(h, "user-a", modernPermissionDecisionBody("control-task", "wrong-task", "run-auth", "req_1", "allow", "x"))
	if wrongTask.Code != http.StatusNotFound {
		t.Fatalf("wrong task status = %d, want 404; body=%s", wrongTask.Code, wrongTask.Body.String())
	}
	if got := h.Bus.HistoryLen(); got != 0 {
		t.Fatalf("wrong task published %d events, want 0", got)
	}
	if !h.ensurePermissionBroker().PendingPermission("run-auth", "req_1") {
		t.Fatal("wrong task consumed the pending request")
	}

	owner := doPermissionDecideAsUser(h, "user-a", modernPermissionDecisionBody("control-ok", "task-auth", "run-auth", "req_1", "allow", "x"))
	assertModernReceipt(t, owner, "control-ok", "task-auth", "run-auth", "req_1", "allow", false)
	if got := h.Bus.HistoryLen(); got != 1 {
		t.Fatalf("owner published %d events, want 1", got)
	}

	crossRun := doPermissionDecideAsUser(h, "user-a", modernPermissionDecisionBody("control-ok", "task-auth", "run-auth-other", "req_2", "allow", "x"))
	if crossRun.Code != http.StatusConflict {
		t.Fatalf("cross-run status = %d, want 409; body=%s", crossRun.Code, crossRun.Body.String())
	}
	if got := h.Bus.HistoryLen(); got != 1 {
		t.Fatalf("cross-run published %d events, want 1", got)
	}
	if !h.ensurePermissionBroker().PendingPermission("run-auth-other", "req_2") {
		t.Fatal("cross-run consumed the other run's pending request")
	}
}

func TestPostPermissionDecideModernCapacityFullRejectsBeforeEffect(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	h.permissionReceipts = newPermissionReceiptCache(1, time.Minute)
	defer h.Bus.Close()
	seedModernApprovalRun(t, h.Store, "cap-a", "run-cap-a", "user-a", "task-cap-a")
	seedModernApprovalRun(t, h.Store, "cap-b", "run-cap-b", "user-a", "task-cap-b")
	_ = registerModernBrokerPending(t, h, "run-cap-a", "req_a", "proj-receipt-cap-a", "thread-receipt-cap-a")
	_ = registerModernBrokerPending(t, h, "run-cap-b", "req_b", "proj-receipt-cap-b", "thread-receipt-cap-b")
	registerModernPendingRegistry(t, h, "run-cap-a", "req_a", "proj-receipt-cap-a", "thread-receipt-cap-a")
	registerModernPendingRegistry(t, h, "run-cap-b", "req_b", "proj-receipt-cap-b", "thread-receipt-cap-b")

	first := doPermissionDecideAsUser(h, "user-a", modernPermissionDecisionBody("control-a", "task-cap-a", "run-cap-a", "req_a", "allow", "x"))
	assertModernReceipt(t, first, "control-a", "task-cap-a", "run-cap-a", "req_a", "allow", false)

	full := doPermissionDecideAsUser(h, "user-a", modernPermissionDecisionBody("control-b", "task-cap-b", "run-cap-b", "req_b", "allow", "x"))
	if full.Code != http.StatusTooManyRequests {
		t.Fatalf("capacity full status = %d, want 429; body=%s", full.Code, full.Body.String())
	}
	assertErrorCode(t, full.Body.String(), errcode.ErrTooManyRequests.Code)
	if got := h.Bus.HistoryLen(); got != 1 {
		t.Fatalf("capacity full published %d events, want 1", got)
	}
	if !h.ensurePermissionBroker().PendingPermission("run-cap-b", "req_b") {
		t.Fatal("capacity full consumed the pending request")
	}
	if got := h.permissionReceipts.len(); got != 1 {
		t.Fatalf("receipt cache length = %d, want 1", got)
	}
}

func TestPostPermissionDecideModernConcurrentSameKeyOneWinner(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	h.permissionReceipts = newPermissionReceiptCache(8, time.Minute)
	defer h.Bus.Close()
	seedModernApprovalRun(t, h.Store, "concurrent", "run-concurrent", "user-a", "task-concurrent")
	wait := registerModernBrokerPending(t, h, "run-concurrent", "req_1", "proj-receipt-concurrent", "thread-receipt-concurrent")
	registerModernPendingRegistry(t, h, "run-concurrent", "req_1", "proj-receipt-concurrent", "thread-receipt-concurrent")

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	resultCh := make(chan adapters.PermissionDecision, 1)
	go func() {
		resultCh <- wait(ctx)
	}()

	const n = 8
	body := modernPermissionDecisionBody("control-concurrent", "task-concurrent", "run-concurrent", "req_1", "allow", "yes")
	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, n)
	for i := 0; i < n; i++ {
		go func() {
			<-start
			results <- doPermissionDecideAsUser(h, "user-a", body)
		}()
	}
	close(start)

	applied := 0
	deduplicated := 0
	for i := 0; i < n; i++ {
		rec := <-results
		if rec.Code != http.StatusOK {
			t.Fatalf("concurrent status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		data := modernReceiptData(t, rec)
		if got, _ := data["applied"].(bool); !got {
			t.Fatalf("concurrent receipt not applied: %#v", data)
		}
		if got, _ := data["deduplicated"].(bool); got {
			deduplicated++
		} else {
			applied++
		}
	}
	if applied != 1 || deduplicated != n-1 {
		t.Fatalf("winner/applied=%d replay/deduplicated=%d, want 1/%d", applied, deduplicated, n-1)
	}
	if h.ensurePermissionBroker().PendingPermission("run-concurrent", "req_1") {
		t.Fatal("concurrent broker pending remained")
	}
	if _, ok := h.PermissionRegistry.Consume("run-concurrent", "req_1"); ok {
		t.Fatal("concurrent registry pending remained")
	}
	if got := h.Bus.HistoryLen(); got != 1 {
		t.Fatalf("concurrent event history = %d, want 1", got)
	}
	select {
	case got := <-resultCh:
		if got.Behavior != "allow" || got.Message != "yes" {
			t.Fatalf("concurrent broker decision = %#v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("concurrent broker waiter was not woken")
	}
}

func TestPermissionDecisionReceiptsCapability(t *testing.T) {
	h := newTestHandler()
	defer h.Bus.Close()
	rec := httptest.NewRecorder()
	h.GetHealth(rec, httptest.NewRequest(http.MethodGet, "/v1/health", nil))
	var health struct {
		Capabilities map[string]bool `json:"capabilities"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &health); err != nil {
		t.Fatalf("decode health: %v", err)
	}
	if !health.Capabilities["permissionDecisionReceipts"] {
		t.Fatalf("health capabilities missing permissionDecisionReceipts: %#v", health.Capabilities)
	}
}
func TestPermissionReceiptCacheExpiresAndNeverGrowsPastCapacity(t *testing.T) {
	now := time.Unix(1000, 0)
	cache := newPermissionReceiptCache(2, time.Minute).withClock(func() time.Time { return now })
	entry := permissionReceipt{
		ControlID: "control-ttl",
		HubTaskID: "task-ttl",
		RunID:     "run-ttl",
		RequestID: "req-ttl",
		Decision:  "allow",
	}
	if result := cache.apply(entry, func() bool { return true }); !result.Applied {
		t.Fatalf("first apply = %#v", result)
	}
	now = now.Add(30 * time.Second)
	if result := cache.apply(entry, func() bool { return false }); !result.Deduplicated {
		t.Fatalf("warm replay = %#v", result)
	}
	now = now.Add(31 * time.Second)
	if got := cache.len(); got != 0 {
		t.Fatalf("expired receipt remaining in cache = %d, want 0", got)
	}

	capacity := newPermissionReceiptCache(1, time.Minute)
	calls := 0
	if result := capacity.apply(entry, func() bool { calls++; return true }); !result.Applied {
		t.Fatalf("capacity first apply = %#v", result)
	}
	other := entry
	other.ControlID = "control-other"
	other.RunID = "run-other"
	other.RequestID = "req-other"
	if result := capacity.apply(other, func() bool { calls++; return true }); !result.Full {
		t.Fatalf("capacity full apply = %#v", result)
	}
	if calls != 1 {
		t.Fatalf("capacity full callback ran %d times, want 1", calls)
	}
	if got := capacity.len(); got != 1 {
		t.Fatalf("capacity full cache length = %d, want 1", got)
	}
}
