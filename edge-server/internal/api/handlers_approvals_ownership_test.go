package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters/orchestrator"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/permission"
)

// Ownership slice for the human approval gates (#2241 round-64 lane A):
//
//	POST /v1/permissions/decide — allow/deny a live tool call of a run
//	POST /v1/plans/decide       — approve/reject an orchestrator plan of a run
//	GET  /v1/plans/pending      — list plans waiting for a human decision
//
// Before this slice none of the three resolved an ownership principal, so any
// caller past the Edge's coarse auth could list another Hub user's pending
// plans and approve them, i.e. make the victim's agent perform the file writes
// and command executions in that plan. The paradigm asserted here is the one
// the package already uses for run-scoped writes (PostPreview, PostApplyRunDiff):
// 404 with the endpoint's own not-found errcode for both "missing" and "not
// yours" (byte-identical bodies) so the endpoints are not a runId existence
// oracle, list endpoints filter instead of rejecting, the
// documented local single-tenant sentinel keeps seeing everything, and an empty
// principal under Hub JWT fails closed (AH-SR-045).

// ---------------------------------------------------------------------------
// Fixtures — real broker/registry/store concretes, no fakes on the gated path
// ---------------------------------------------------------------------------

// newPlanApprovalBroker builds the same concrete the httpserver composition
// root wires, with an auto-deny timeout long enough that no case races it.
func newPlanApprovalBroker() *orchestrator.PlanApprovalBroker {
	return orchestrator.NewPlanApprovalBroker(orchestrator.PlanApprovalConfig{
		Enabled:            true,
		AutoApproveTimeout: time.Minute,
	})
}

// submitPendingPlan registers a plan the way the orchestrator does before it
// blocks on the human decision.
func submitPendingPlan(t *testing.T, broker *orchestrator.PlanApprovalBroker, runID string) {
	t.Helper()
	_, ok := broker.SubmitPlan(context.Background(), orchestrator.PendingPlan{
		RunID:     runID,
		ProjectID: "proj-sec-" + runID,
		Tasks: []orchestrator.PlanTask{{
			ID:          "t1",
			Agent:       "codex",
			Description: "write a file",
		}},
		Mode:      "sequential",
		CreatedAt: time.Now(),
		Status:    "pending",
	})
	if !ok {
		t.Fatalf("SubmitPlan(%s) failed", runID)
	}
}

func doPlanDecideAsUser(h *Handler, userID, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/plans/decide", strings.NewReader(body))
	req = req.WithContext(withHubUser(req.Context(), userID))
	rec := httptest.NewRecorder()
	h.PostPlanDecide(rec, req)
	return rec
}

func doPlansPendingAsUser(h *Handler, userID string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/v1/plans/pending", nil)
	req = req.WithContext(withHubUser(req.Context(), userID))
	rec := httptest.NewRecorder()
	h.GetPlansPending(rec, req)
	return rec
}

func doPermissionDecideAsUser(h *Handler, userID, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/permissions/decide", strings.NewReader(body))
	req = req.WithContext(withHubUser(req.Context(), userID))
	rec := httptest.NewRecorder()
	h.PostPermissionDecide(rec, req)
	return rec
}

// assertDecisionOK pins the success envelope of both decide endpoints
// ({"code":"ok","data":{"status":"ok"}}) so the owner path cannot silently
// change shape while the gate is added.
func assertDecisionOK(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	if data := unwrapSuccess(body); data["status"] != "ok" {
		t.Fatalf("body = %#v, want data.status == \"ok\"", body)
	}
}

// pendingPlanRunIDs decodes the runIds of a /v1/plans/pending success envelope.
func pendingPlanRunIDs(t *testing.T, rec *httptest.ResponseRecorder) []string {
	t.Helper()
	var envelope struct {
		Code string `json:"code"`
		Data []struct {
			RunID string `json:"runId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode plans pending body %q: %v", rec.Body.String(), err)
	}
	if !strings.EqualFold(envelope.Code, "ok") {
		t.Fatalf("plans pending envelope code = %q, want ok; body=%s", envelope.Code, rec.Body.String())
	}
	runIDs := make([]string, 0, len(envelope.Data))
	for _, plan := range envelope.Data {
		runIDs = append(runIDs, plan.RunID)
	}
	return runIDs
}

func containsRunID(runIDs []string, want string) bool {
	for _, id := range runIDs {
		if id == want {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// POST /v1/plans/decide — ownership gate
// ---------------------------------------------------------------------------

// TestPostPlanDecideRejectsNonOwnerRun is the privilege-escalation red test:
// user-b must not be able to approve user-a's plan, and the plan must survive
// the blocked attempt so the real owner can still decide it.
func TestPostPlanDecideRejectsNonOwnerRun(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret" // multi-user mode
	seedOwnedApplyRun(t, h.Store, "planno", "run-plan-victim", "user-a", "queued", "", "")
	broker := newPlanApprovalBroker()
	submitPendingPlan(t, broker, "run-plan-victim")
	h.PlanApprovalBroker = broker

	rec := doPlanDecideAsUser(h, "user-b", `{"runId":"run-plan-victim","decision":"approve"}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-owner plan decide status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrPlanNotFound.Code)
	if _, ok := broker.GetPending("run-plan-victim"); !ok {
		t.Error("ESCAPE: the non-owner decision consumed the victim's pending plan")
	}
}

// TestPostPlanDecideNonOwnerIsNotAnExistenceOracle pins that "not your run" and
// "no such run" are indistinguishable through the gate.
func TestPostPlanDecideNonOwnerIsNotAnExistenceOracle(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	seedOwnedApplyRun(t, h.Store, "planoracle", "run-plan-oracle", "user-a", "queued", "", "")
	broker := newPlanApprovalBroker()
	submitPendingPlan(t, broker, "run-plan-oracle")
	h.PlanApprovalBroker = broker

	notOwned := doPlanDecideAsUser(h, "user-b", `{"runId":"run-plan-oracle","decision":"approve"}`)
	missing := doPlanDecideAsUser(h, "user-b", `{"runId":"run-plan-does-not-exist","decision":"approve"}`)

	if notOwned.Code != missing.Code {
		t.Fatalf("status differs: not-owned=%d missing=%d (runId existence oracle)", notOwned.Code, missing.Code)
	}
	if stripTraceID(notOwned.Body.String()) != stripTraceID(missing.Body.String()) {
		t.Fatalf("body differs:\n not-owned=%s\n missing  =%s", notOwned.Body.String(), missing.Body.String())
	}
	if _, ok := broker.GetPending("run-plan-oracle"); !ok {
		t.Error("ESCAPE: the probed plan was consumed by the non-owner oracle request")
	}
}

// TestPostPlanDecideFailsClosedWithoutHubIdentity mirrors AH-SR-045: under Hub
// JWT a request without a Hub identity has an empty principal and reaches
// nobody's plan.
func TestPostPlanDecideFailsClosedWithoutHubIdentity(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	seedOwnedApplyRun(t, h.Store, "plannoid", "run-plan-noid", "user-a", "queued", "", "")
	broker := newPlanApprovalBroker()
	submitPendingPlan(t, broker, "run-plan-noid")
	h.PlanApprovalBroker = broker

	rec := doPlanDecideAsUser(h, "", `{"runId":"run-plan-noid","decision":"approve"}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 without Hub identity; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrPlanNotFound.Code)
	if _, ok := broker.GetPending("run-plan-noid"); !ok {
		t.Error("ESCAPE: an identity-less request consumed the pending plan")
	}
}

// TestPostPlanDecideOwnerCanApprove is the positive control: the owner keeps the
// pre-gate behaviour (200 + {"status":"ok"} + the plan is resolved).
func TestPostPlanDecideOwnerCanApprove(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	seedOwnedApplyRun(t, h.Store, "planmine", "run-plan-mine", "user-a", "queued", "", "")
	broker := newPlanApprovalBroker()
	submitPendingPlan(t, broker, "run-plan-mine")
	h.PlanApprovalBroker = broker

	rec := doPlanDecideAsUser(h, "user-a", `{"runId":"run-plan-mine","decision":"approve"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("owner plan decide status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	assertDecisionOK(t, rec)
	if _, ok := broker.GetPending("run-plan-mine"); ok {
		t.Error("owner decision did not resolve the pending plan")
	}
}

// TestPostPlanDecideLocalSingleTenantUnaffected guards the documented local
// single-tenant bypass (no HubJWTSecret → sentinel principal), so the gate
// cannot break the local/dev Edge stack.
func TestPostPlanDecideLocalSingleTenantUnaffected(t *testing.T) {
	h := newTestHandler() // HubJWTSecret empty → local single-tenant mode
	seedOwnedApplyRun(t, h.Store, "planlocal", "run-plan-local", "user-a", "queued", "", "")
	broker := newPlanApprovalBroker()
	submitPendingPlan(t, broker, "run-plan-local")
	h.PlanApprovalBroker = broker

	rec := doPlanDecideAsUser(h, "", `{"runId":"run-plan-local","decision":"approve"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("local single-tenant plan decide status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	assertDecisionOK(t, rec)
	if _, ok := broker.GetPending("run-plan-local"); ok {
		t.Error("local single-tenant decision did not resolve the pending plan")
	}
}

// ---------------------------------------------------------------------------
// GET /v1/plans/pending — ownership filter (list endpoints filter, not reject)
// ---------------------------------------------------------------------------

// TestGetPlansPendingHidesOtherUsersPlans is the disclosure red test: a Hub user
// must only see plans of runs they own.
func TestGetPlansPendingHidesOtherUsersPlans(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	seedOwnedApplyRun(t, h.Store, "planlistA", "run-plan-a", "user-a", "queued", "", "")
	seedOwnedApplyRun(t, h.Store, "planlistB", "run-plan-b", "user-b", "queued", "", "")
	broker := newPlanApprovalBroker()
	submitPendingPlan(t, broker, "run-plan-a")
	submitPendingPlan(t, broker, "run-plan-b")
	h.PlanApprovalBroker = broker

	recB := doPlansPendingAsUser(h, "user-b")
	if recB.Code != http.StatusOK {
		t.Fatalf("user-b plans pending status = %d, want 200; body=%s", recB.Code, recB.Body.String())
	}
	gotB := pendingPlanRunIDs(t, recB)
	if containsRunID(gotB, "run-plan-a") {
		t.Errorf("LEAK: user-b sees user-a's pending plan; runIds=%v", gotB)
	}
	if len(gotB) != 1 || gotB[0] != "run-plan-b" {
		t.Errorf("user-b runIds = %v, want exactly [run-plan-b]", gotB)
	}

	recA := doPlansPendingAsUser(h, "user-a")
	if recA.Code != http.StatusOK {
		t.Fatalf("user-a plans pending status = %d, want 200; body=%s", recA.Code, recA.Body.String())
	}
	gotA := pendingPlanRunIDs(t, recA)
	if containsRunID(gotA, "run-plan-b") {
		t.Errorf("LEAK: user-a sees user-b's pending plan; runIds=%v", gotA)
	}
	if len(gotA) != 1 || gotA[0] != "run-plan-a" {
		t.Errorf("user-a runIds = %v, want exactly [run-plan-a]", gotA)
	}
}

// TestGetPlansPendingFailsClosedWithoutHubIdentity pins the fail-closed shape for
// list endpoints: 200 with an empty list, never another user's entries and never
// a 404 (which would be a behaviour regression for the Desktop poller).
func TestGetPlansPendingFailsClosedWithoutHubIdentity(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	seedOwnedApplyRun(t, h.Store, "planlistnoid", "run-plan-noid", "user-a", "queued", "", "")
	broker := newPlanApprovalBroker()
	submitPendingPlan(t, broker, "run-plan-noid")
	h.PlanApprovalBroker = broker

	rec := doPlansPendingAsUser(h, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("identity-less plans pending status = %d, want 200 with an empty list; body=%s", rec.Code, rec.Body.String())
	}
	if got := pendingPlanRunIDs(t, rec); len(got) != 0 {
		t.Errorf("LEAK: identity-less request saw pending plans %v, want none", got)
	}
}

// TestGetPlansPendingLocalSingleTenantSeesAllPlans guards the sentinel: local
// single-tenant mode keeps the unfiltered view.
func TestGetPlansPendingLocalSingleTenantSeesAllPlans(t *testing.T) {
	h := newTestHandler() // HubJWTSecret empty → local single-tenant mode
	seedOwnedApplyRun(t, h.Store, "planlistlocalA", "run-plan-local-a", "user-a", "queued", "", "")
	seedOwnedApplyRun(t, h.Store, "planlistlocalB", "run-plan-local-b", "user-b", "queued", "", "")
	broker := newPlanApprovalBroker()
	submitPendingPlan(t, broker, "run-plan-local-a")
	submitPendingPlan(t, broker, "run-plan-local-b")
	h.PlanApprovalBroker = broker

	rec := doPlansPendingAsUser(h, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("local single-tenant plans pending status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	got := pendingPlanRunIDs(t, rec)
	if len(got) != 2 || !containsRunID(got, "run-plan-local-a") || !containsRunID(got, "run-plan-local-b") {
		t.Errorf("local single-tenant runIds = %v, want both pending plans", got)
	}
}

// ---------------------------------------------------------------------------
// POST /v1/permissions/decide — ownership gate
// ---------------------------------------------------------------------------

const permissionDecideVictimBody = `{"runId":"run-perm-victim","requestId":"req_1","decision":"allow"}`

// TestPostPermissionDecideRejectsNonOwnerRun is the privilege-escalation red
// test for the tool-permission gate: user-b must not be able to allow a Bash
// call of user-a's run, no decision event may be published, and the pending
// request must survive so the owner can still decide it.
func TestPostPermissionDecideRejectsNonOwnerRun(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	seedOwnedApplyRun(t, h.Store, "permno", "run-perm-victim", "user-a", "queued", "", "")
	h.ensurePermissionRegistry().Register(permission.PendingPermission{
		ProjectID: "proj-sec-permno",
		ThreadID:  "thread-sec-permno",
		RunID:     "run-perm-victim",
		RequestID: "req_1",
		ToolName:  "Bash",
		ToolUseID: "tool_1",
	})

	rec := doPermissionDecideAsUser(h, "user-b", permissionDecideVictimBody)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-owner permission decide status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrPermissionRequestNotFound.Code)
	if got := h.Bus.HistoryLen(); got != 0 {
		t.Errorf("ESCAPE: non-owner decision published %d bus events, want 0", got)
	}
	ownerRec := doPermissionDecideAsUser(h, "user-a", permissionDecideVictimBody)
	if ownerRec.Code != http.StatusOK {
		t.Fatalf("owner decide after a blocked non-owner attempt = %d, want 200 (pending request was consumed); body=%s",
			ownerRec.Code, ownerRec.Body.String())
	}
}

// TestPostPermissionDecideNonOwnerIsNotAnExistenceOracle pins that "not your
// run" and "no such run" produce byte-identical 404 envelopes, so probing
// runIds through the permission gate leaks nothing.
func TestPostPermissionDecideNonOwnerIsNotAnExistenceOracle(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	seedOwnedApplyRun(t, h.Store, "permoracle", "run-perm-oracle", "user-a", "queued", "", "")
	h.ensurePermissionRegistry().Register(permission.PendingPermission{
		RunID:     "run-perm-oracle",
		RequestID: "req_1",
		ToolName:  "Bash",
		ToolUseID: "tool_1",
	})

	notOwned := doPermissionDecideAsUser(h, "user-b", `{"runId":"run-perm-oracle","requestId":"req_1","decision":"allow"}`)
	missing := doPermissionDecideAsUser(h, "user-b", `{"runId":"run-perm-does-not-exist","requestId":"req_1","decision":"allow"}`)

	if notOwned.Code != missing.Code {
		t.Fatalf("status differs: not-owned=%d missing=%d (runId existence oracle)", notOwned.Code, missing.Code)
	}
	if stripTraceID(notOwned.Body.String()) != stripTraceID(missing.Body.String()) {
		t.Fatalf("body differs:\n not-owned=%s\n missing  =%s", notOwned.Body.String(), missing.Body.String())
	}
	assertErrorCode(t, notOwned.Body.String(), errcode.ErrPermissionRequestNotFound.Code)
	if got := h.Bus.HistoryLen(); got != 0 {
		t.Errorf("ESCAPE: the oracle probes published %d bus events, want 0", got)
	}
	ownerRec := doPermissionDecideAsUser(h, "user-a", `{"runId":"run-perm-oracle","requestId":"req_1","decision":"allow"}`)
	if ownerRec.Code != http.StatusOK {
		t.Fatalf("owner decide after the blocked probes = %d, want 200; body=%s", ownerRec.Code, ownerRec.Body.String())
	}
}

// TestPostPermissionDecideFailsClosedWithoutHubIdentity pins AH-SR-045 for the
// permission gate.
func TestPostPermissionDecideFailsClosedWithoutHubIdentity(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	seedOwnedApplyRun(t, h.Store, "permnoid", "run-perm-victim", "user-a", "queued", "", "")
	h.ensurePermissionRegistry().Register(permission.PendingPermission{
		RunID:     "run-perm-victim",
		RequestID: "req_1",
		ToolName:  "Bash",
		ToolUseID: "tool_1",
	})

	rec := doPermissionDecideAsUser(h, "", permissionDecideVictimBody)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 without Hub identity; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrPermissionRequestNotFound.Code)
	if got := h.Bus.HistoryLen(); got != 0 {
		t.Errorf("ESCAPE: identity-less decision published %d bus events, want 0", got)
	}
}

// TestPostPermissionDecideOwnerCanDecide is the positive control: the owner path
// keeps 200 + {"status":"ok"} + the permission_decided event + single-consume.
func TestPostPermissionDecideOwnerCanDecide(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	seedOwnedApplyRun(t, h.Store, "permmine", "run-perm-mine", "user-a", "queued", "", "")
	h.ensurePermissionRegistry().Register(permission.PendingPermission{
		ProjectID: "proj-sec-permmine",
		ThreadID:  "thread-sec-permmine",
		RunID:     "run-perm-mine",
		RequestID: "req_1",
		ToolName:  "Bash",
		ToolUseID: "tool_1",
	})
	_, ch, _ := h.Bus.Subscribe(0)

	rec := doPermissionDecideAsUser(h, "user-a", `{"runId":"run-perm-mine","requestId":"req_1","decision":"deny","reason":"not now"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("owner permission decide status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	assertDecisionOK(t, rec)
	select {
	case evt := <-ch:
		if evt.Type != "run.agent.permission_decided" {
			t.Fatalf("event type = %q, want run.agent.permission_decided", evt.Type)
		}
		if evt.Scope["runId"] != "run-perm-mine" || evt.Scope["projectId"] != "proj-sec-permmine" {
			t.Fatalf("event scope = %#v, want the owner's run/project", evt.Scope)
		}
	case <-time.After(time.Second):
		t.Fatal("owner decision did not publish permission_decided")
	}
	replay := doPermissionDecideAsUser(h, "user-a", `{"runId":"run-perm-mine","requestId":"req_1","decision":"allow"}`)
	if replay.Code != http.StatusNotFound {
		t.Fatalf("second owner decision status = %d, want 404; body=%s", replay.Code, replay.Body.String())
	}
	assertErrorCode(t, replay.Body.String(), errcode.ErrPermissionRequestNotFound.Code)
}

// TestPostPermissionDecideLocalSingleTenantUnaffected guards the sentinel on the
// permission gate.
func TestPostPermissionDecideLocalSingleTenantUnaffected(t *testing.T) {
	h := newTestHandler() // HubJWTSecret empty → local single-tenant mode
	seedOwnedApplyRun(t, h.Store, "permlocal", "run-perm-local", "user-a", "queued", "", "")
	h.ensurePermissionRegistry().Register(permission.PendingPermission{
		RunID:     "run-perm-local",
		RequestID: "req_1",
		ToolName:  "Bash",
		ToolUseID: "tool_1",
	})

	rec := doPermissionDecideAsUser(h, "", `{"runId":"run-perm-local","requestId":"req_1","decision":"allow"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("local single-tenant permission decide status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	assertDecisionOK(t, rec)
}
