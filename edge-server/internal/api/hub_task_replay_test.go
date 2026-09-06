package api

import (
	"encoding/json"
	"errors"
	"github.com/agenthub/edge-server/internal/store"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/deliverydedup"
	"github.com/agenthub/edge-server/internal/lifecycle"
)

func TestHubTaskReplay_CacheMissStillAuthorizesOriginalScope(t *testing.T) {
	const signingKey = "fixture-capability-signing-key-32-bytes"
	executor := &admissionExecutor{}
	server, h := newDeliveryTestServer(t, executor, func(h *Handler) {
		h.HubJWTSecret = signingKey
		h.EdgeDeviceID = "fixture-device"
	})
	defer server.Close()
	repository := ensureStore(h)
	if _, err := repository.CreateProject("proj_other", "Other", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.CreateThread("thread_other", "proj_other", "Other", "", "", ""); err != nil {
		t.Fatal(err)
	}
	post := func(projectID, threadID, deliveryID string) postResult {
		body := admissionRunBody(h.WorkspaceAllowlist[0], deliveryID, "task-persisted", map[string]any{"projectId": projectID, "threadId": threadID})
		request, err := http.NewRequest(http.MethodPost, server.URL+"/v1/runs", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-AgentHub-Capability-Token", signCapability(signingKey, "user-fixture", "fixture-device", projectID, "run-start", time.Hour))
		return doReq(t, request)
	}
	first := post("proj_local", "thread_local", "delivery-first")
	if first.status != http.StatusAccepted {
		t.Fatalf("first admission: %d %#v", first.status, first.body)
	}
	// Simulate a fresh process-local cache while preserving the repository.
	h.DeliveryDedup = deliverydedup.New(deliverydedup.DefaultCapacity, deliverydedup.DefaultTTL)
	replay := post("proj_other", "thread_other", "delivery-after-restart")
	if replay.status != http.StatusForbidden || errCode(replay.body) != "capability_token_invalid" {
		t.Fatalf("cold Hub-task lookup bypassed actual-run authorization: %d %#v", replay.status, replay.body)
	}
	if executor.StartCount() != 1 {
		t.Fatalf("unauthorized replay started work: %d", executor.StartCount())
	}
}

func TestHubTaskReplay_RejectedExecutorAdmissionIsNotSuccess(t *testing.T) {
	executor := &admissionExecutor{failNext: true, err: errors.New("fixture admission rejected")}
	server, h := newDeliveryTestServer(t, executor, nil)
	defer server.Close()
	body := admissionRunBody(h.WorkspaceAllowlist[0], "delivery-rejected", "task-rejected", nil)
	first := postRunsRaw(t, server.URL, body)
	if first.status == http.StatusAccepted {
		t.Fatalf("expected initial rejection: %#v", first.body)
	}
	replay := postRunsRaw(t, server.URL, body)
	if replay.status != http.StatusInternalServerError || errCode(replay.body) != "executor_start_failed" || executor.StartCount() != 1 {
		t.Fatalf("rejected Hub task must retain rejection without restarting: %d %#v starts=%d", replay.status, replay.body, executor.StartCount())
	}
}

func TestHubTaskReplay_ConcurrentDifferentDeliveryWaitsForAdmission(t *testing.T) {
	executor := &admissionExecutor{blockNext: true, entered: make(chan string, 1), release: make(chan struct{})}
	server, h := newDeliveryTestServer(t, executor, nil)
	defer server.Close()
	defer func() {
		select {
		case <-executor.release:
		default:
			close(executor.release)
		}
	}()
	first := make(chan postResult, 1)
	failures := make(chan error, 1)
	go func() {
		result, err := httpPostJSON(server.URL, admissionRunBody(h.WorkspaceAllowlist[0], "delivery-inflight", "task-shared", nil))
		if err != nil {
			failures <- err
			return
		}
		first <- result
	}()
	select {
	case <-executor.entered:
	case err := <-failures:
		t.Fatal(err)
	case <-time.After(5 * time.Second):
		t.Fatal("executor admission did not start")
	}
	for _, deliveryID := range []string{"different-delivery", ""} {
		result := postRunsRaw(t, server.URL, admissionRunBody(h.WorkspaceAllowlist[0], deliveryID, "task-shared", nil))
		if result.status != http.StatusServiceUnavailable || errCode(result.body) != "delivery_busy" {
			t.Fatalf("in-flight task replay falsely accepted: %d %#v", result.status, result.body)
		}
		if result.resp.Header.Get("Retry-After") == "" {
			t.Fatal("busy outcome missing retry hint")
		}
	}
	close(executor.release)
	var accepted postResult
	select {
	case accepted = <-first:
	case err := <-failures:
		t.Fatal(err)
	case <-time.After(5 * time.Second):
		t.Fatal("first admission did not complete")
	}
	if accepted.status != http.StatusAccepted {
		t.Fatalf("first result: %d %#v", accepted.status, accepted.body)
	}
	replay := postRunsRaw(t, server.URL, admissionRunBody(h.WorkspaceAllowlist[0], "different-delivery", "task-shared", nil))
	if replay.status != http.StatusAccepted || unwrapSuccess(replay.body)["runId"] != unwrapSuccess(accepted.body)["runId"] || executor.StartCount() != 1 {
		t.Fatalf("completed replay mismatch: %#v starts=%d", replay.body, executor.StartCount())
	}
}

func TestHubTaskReplay_CapacityRejectionCanRetryButAcceptedFailureCannot(t *testing.T) {
	executor := &admissionExecutor{failNext: true, err: lifecycle.ErrTooManyConcurrentRuns}
	server, h := newDeliveryTestServer(t, executor, nil)
	defer server.Close()
	body := admissionRunBody(h.WorkspaceAllowlist[0], "delivery-capacity", "task-capacity", nil)
	rejected := postRunsRaw(t, server.URL, body)
	if rejected.status != http.StatusTooManyRequests || errCode(rejected.body) != "too_many_concurrent_runs" || rejected.resp.Header.Get("Retry-After") == "" {
		t.Fatalf("capacity rejection: %d %#v", rejected.status, rejected.body)
	}
	accepted := postRunsRaw(t, server.URL, body)
	if accepted.status != http.StatusAccepted || executor.StartCount() != 2 {
		t.Fatalf("capacity retry was not really admitted: %d %#v starts=%d", accepted.status, accepted.body, executor.StartCount())
	}
	runID := unwrapSuccess(accepted.body)["runId"].(string)
	ensureStore(h).SetRunStatus(runID, "failed")
	h.DeliveryDedup = deliverydedup.New(deliverydedup.DefaultCapacity, deliverydedup.DefaultTTL)
	replay := postRunsRaw(t, server.URL, body)
	if replay.status != http.StatusAccepted || unwrapSuccess(replay.body)["runId"] != runID || unwrapSuccess(replay.body)["status"] != "failed" || executor.StartCount() != 2 {
		t.Fatalf("execution failure must not restart accepted work: %d %#v starts=%d", replay.status, replay.body, executor.StartCount())
	}
}

func TestHubTaskReplay_UncertainAdmissionExposesReadOnlyEvidence(t *testing.T) {
	executor := &admissionExecutor{}
	server, h := newDeliveryTestServer(t, executor, nil)
	defer server.Close()
	repository := ensureStore(h)
	run, err := repository.CreateRunAdmission("run-needs-review", "proj_local", "thread_local", "task-needs-review")
	if err != nil {
		t.Fatal(err)
	}
	result := postRunsRaw(t, server.URL, admissionRunBody(h.WorkspaceAllowlist[0], "delivery-unknown", "task-needs-review", nil))
	if result.status != http.StatusConflict || errCode(result.body) != "admission_uncertain" {
		t.Fatalf("orphaned pending admission=%d %#v", result.status, result.body)
	}
	if executor.StartCount() != 0 {
		t.Fatal("uncertain replay started an executor")
	}
	response, err := http.Get(server.URL + "/v1/runs/" + run.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	data := unwrapSuccess(body)
	if response.StatusCode != http.StatusOK || data["runId"] != run.ID || data["admissionState"] != store.RunAdmissionPending {
		t.Fatalf("GET run must expose admission evidence for reconciliation: %d %#v", response.StatusCode, body)
	}
}
