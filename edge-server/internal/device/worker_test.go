//go:build !windows

package device

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/stretchr/testify/require"
)

type testExecution struct {
	admitted    int
	complete    bool
	cancelCalls int
	retained    bool
	admitErr    error
	control     Control
}

func (e *testExecution) Admit(context.Context, TextRun) (string, error) {
	e.admitted++
	if e.admitErr != nil {
		return "", e.admitErr
	}
	e.retained = true
	return "run-1", nil
}
func (e *testExecution) Retained(string) bool { return e.retained }
func (e *testExecution) Cancel(_ context.Context, c Control) (string, bool, error) {
	e.cancelCalls++
	e.control = c
	if !e.retained {
		return "", e.complete, nil
	}
	return "run-1", e.complete, nil
}

func fixtureDelivery(t *testing.T, c Credential) Delivery {
	r := TextRun{ProjectID: "paired-" + c.DeviceID, ThreadID: "hub-session-1", Prompt: "Hello", AgentID: "openai-sdk", Model: "fixture-model", WorkDir: c.WorkspaceRoot, CallbackOwner: "edge", HubTaskID: "task-1", DeliveryID: "delivery-1"}
	body, err := json.Marshal(r)
	require.NoError(t, err)
	return Delivery{ID: r.DeliveryID, TaskID: r.HubTaskID, RunRequest: body}
}

func fixtureWorker(t *testing.T, handler http.Handler) (*Worker, *testExecution, string) {
	t.Helper()
	c := fixtureCredential(t)
	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)
	client, err := NewClient(server.URL, c.Secret, server.Client())
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "device.sqlite")
	journal, err := OpenJournal(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = journal.Close() })
	e := &testExecution{}
	return &Worker{Client: client, Credential: c, Allowlist: []string{c.WorkspaceRoot}, Journal: journal, Execution: e}, e, path
}

func TestWorkerReplayAndCancellationSurviveRestart(t *testing.T) {
	var acks atomic.Int32
	w, e, path := fixtureWorker(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/edge/device/controls/task-1/ack" {
			var body map[string]string
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			require.Equal(t, "applied", body["status"])
			acks.Add(1)
		}
		reply(w, 200, struct{}{})
	}))
	delivery := fixtureDelivery(t, w.Credential)
	require.NoError(t, w.applyBatch(context.Background(), Batch{Deliveries: []Delivery{delivery, delivery}}))
	require.Equal(t, 1, e.admitted)
	require.NoError(t, w.Journal.Close())
	reopened, err := OpenJournal(path)
	require.NoError(t, err)
	defer reopened.Close()
	w.Journal = reopened
	require.NoError(t, w.applyBatch(context.Background(), Batch{Deliveries: []Delivery{delivery}}))
	require.Equal(t, 1, e.admitted)
	control := Control{ID: delivery.TaskID, TaskID: delivery.TaskID, Kind: "cancel"}
	require.NoError(t, w.applyBatch(context.Background(), Batch{Controls: []Control{control}}))
	require.Zero(t, acks.Load())
	e.complete = true
	require.NoError(t, w.reconcileControls(context.Background()))
	require.EqualValues(t, 1, acks.Load())
	require.NoError(t, w.applyBatch(context.Background(), Batch{Deliveries: []Delivery{delivery}}))
	require.Equal(t, 1, e.admitted)
	control.TaskID = "different-task"
	require.Error(t, w.Journal.Record(control))
}

func TestWorkerCancelBeforeAdmissionNeverStarts(t *testing.T) {
	w, e, path := fixtureWorker(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reply(w, 200, struct{}{}) }))
	e.complete = true
	delivery := fixtureDelivery(t, w.Credential)
	require.NoError(t, w.applyBatch(context.Background(), Batch{Deliveries: []Delivery{delivery}, Controls: []Control{{ID: delivery.TaskID, TaskID: delivery.TaskID, Kind: "cancel"}}}))
	require.Zero(t, e.admitted)
	require.NoError(t, w.Journal.Close())
	reopened, err := OpenJournal(path)
	require.NoError(t, err)
	defer reopened.Close()
	w.Journal = reopened
	require.NoError(t, w.applyBatch(context.Background(), Batch{Deliveries: []Delivery{delivery}}))
	require.Zero(t, e.admitted)
}

func TestWorkerRejectsRemoteExecutionOverrides(t *testing.T) {
	w, e, _ := fixtureWorker(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reply(w, 200, struct{}{}) }))
	for key, value := range map[string]any{"agentId": "codex-acp", "workDir": t.TempDir(), "provider": "native", "configOverrides": map[string]string{"api_key": "secret"}, "allowedTools": []string{"exec"}, "continue": true, "callbackOwner": "desktop", "hubTaskId": "other-task", "projectId": "local-project", "model": ""} {
		t.Run(key, func(t *testing.T) {
			d := fixtureDelivery(t, w.Credential)
			var body map[string]any
			require.NoError(t, json.Unmarshal(d.RunRequest, &body))
			body[key] = value
			d.RunRequest, _ = json.Marshal(body)
			require.Error(t, w.applyBatch(context.Background(), Batch{Deliveries: []Delivery{d}}))
			require.Zero(t, e.admitted)
		})
	}
}

func TestWorkerRejectsUncertainAdmissionAfterCrash(t *testing.T) {
	w, e, _ := fixtureWorker(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reply(w, 200, struct{}{}) }))
	d := fixtureDelivery(t, w.Credential)
	_, _, err := w.Journal.BeginAdmission(d.TaskID, d.ID, "paired-"+w.Credential.DeviceID+"/hub-session-1")
	require.NoError(t, err)
	require.ErrorContains(t, w.applyBatch(context.Background(), Batch{Deliveries: []Delivery{d}}), "uncertain")
	require.Zero(t, e.admitted)
}

func TestWorkerRetriesDefinitePreExecutionRejection(t *testing.T) {
	w, e, _ := fixtureWorker(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reply(w, 200, struct{}{}) }))
	d := fixtureDelivery(t, w.Credential)
	e.admitErr = errcode.ErrActiveRunExists
	require.NoError(t, w.applyBatch(context.Background(), Batch{Deliveries: []Delivery{d}}))
	_, found, err := w.Journal.Admission(d.TaskID)
	require.NoError(t, err)
	require.False(t, found)
	e.admitErr = nil
	require.NoError(t, w.applyBatch(context.Background(), Batch{Deliveries: []Delivery{d}}))
	require.Equal(t, 2, e.admitted)
}

func TestWorkerNeverReportsUncertainAdmissionCancelled(t *testing.T) {
	acks := make(chan map[string]string, 1)
	w, e, _ := fixtureWorker(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		if r.URL.Path == "/edge/device/controls/task-1/ack" {
			acks <- body
		}
		reply(w, 200, struct{}{})
	}))
	d := fixtureDelivery(t, w.Credential)
	_, _, err := w.Journal.BeginAdmission(d.TaskID, d.ID, "paired-"+w.Credential.DeviceID+"/hub-session-1")
	require.NoError(t, err)
	e.complete = true // An empty executor cannot erase the durable uncertainty.
	require.NoError(t, w.applyBatch(context.Background(), Batch{Controls: []Control{{ID: d.TaskID, TaskID: d.TaskID, Kind: "cancel"}}}))
	require.Equal(t, "failed", (<-acks)["status"])
}

func TestWorkerRetainedReceiptCannotChangeThread(t *testing.T) {
	w, e, _ := fixtureWorker(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reply(w, 200, struct{}{}) }))
	d := fixtureDelivery(t, w.Credential)
	require.NoError(t, w.applyBatch(context.Background(), Batch{Deliveries: []Delivery{d}}))
	var body TextRun
	require.NoError(t, json.Unmarshal(d.RunRequest, &body))
	body.ThreadID = "hub-other-session"
	d.RunRequest, _ = json.Marshal(body)
	require.Error(t, w.applyBatch(context.Background(), Batch{Deliveries: []Delivery{d}}))
	require.Equal(t, 1, e.admitted)
}

func TestWorkerExpiryDoesNotCancelExistingExecution(t *testing.T) {
	w, e, _ := fixtureWorker(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/edge/device/poll" {
			<-r.Context().Done()
			return
		}
		reply(w, 200, struct{}{})
	}))
	w.Credential.ExpiresAt = time.Now().Add(100 * time.Millisecond)
	require.ErrorIs(t, w.Run(context.Background()), ErrUnauthorized)
	require.Zero(t, e.cancelCalls)
}

func TestWorkerRetriesLostControlAckWithoutRebindingCancelledTask(t *testing.T) {
	var taskAcks, controlAcks atomic.Int32
	w, e, _ := fixtureWorker(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/edge/device/tasks/task-1/ack" {
			taskAcks.Add(1)
			if controlAcks.Load() > 0 {
				w.WriteHeader(410) // Hub already applied cancellation.
				return
			}
		}
		if r.URL.Path == "/edge/device/controls/task-1/ack" {
			if controlAcks.Add(1) == 1 {
				// Simulate an accepted control whose HTTP response was lost.
				w.WriteHeader(500)
				_, _ = io.WriteString(w, "fixture response loss")
				return
			}
		}
		reply(w, 200, struct{}{})
	}))
	d := fixtureDelivery(t, w.Credential)
	require.NoError(t, w.applyBatch(context.Background(), Batch{Deliveries: []Delivery{d}}))
	e.complete = true
	require.NoError(t, w.applyBatch(context.Background(), Batch{Controls: []Control{{ID: d.TaskID, TaskID: d.TaskID, Kind: "cancel"}}}))
	require.NoError(t, w.reconcileControls(context.Background()))
	require.EqualValues(t, 2, taskAcks.Load()) // admission + resolving lost original binding
	require.EqualValues(t, 2, controlAcks.Load())
	pending, err := w.Journal.Pending()
	require.NoError(t, err)
	require.Empty(t, pending)
}

func TestWorkerContinuesPollingAndStopsOnRevocation(t *testing.T) {
	var polls atomic.Int32
	w, e, _ := fixtureWorker(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/edge/device/poll" {
			if polls.Add(1) == 2 {
				w.WriteHeader(401)
				return
			}
			reply(w, 200, Batch{})
			return
		}
		reply(w, 200, struct{}{})
	}))
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	require.ErrorIs(t, w.Run(ctx), ErrUnauthorized)
	require.EqualValues(t, 2, polls.Load())
	require.Zero(t, e.cancelCalls)
}

func TestWorkerContextCancellationStopsLongPoll(t *testing.T) {
	started := make(chan struct{})
	w, _, _ := fixtureWorker(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/edge/device/poll" {
			close(started)
			<-r.Context().Done()
			return
		}
		reply(w, 200, struct{}{})
	}))
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { result <- w.Run(ctx) }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("poll not started")
	}
	cancel()
	select {
	case err := <-result:
		require.ErrorIs(t, err, context.Canceled)
	case <-time.After(3 * time.Second):
		t.Fatal("worker did not stop")
	}
}
