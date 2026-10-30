//go:build !windows

package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/adapters/sdk"
	"github.com/agenthub/edge-server/internal/device"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
	"github.com/stretchr/testify/require"
)

// A TLS Hub fixture drives the real poll client, SQLite admission, process
// executor and SDK HTTP adapter. The model endpoint is localhost-only fixture
// data, never production inference or an operator credential.
func TestEnrolledPollRealExecutorReplayMultiturnAndCancel(t *testing.T) {
	workspace := t.TempDir()
	answerChunks := []string{"  中文 paragraph\n", strings.Repeat("multi chunk text ", 100), "\n\n", "tail  "}
	answer := strings.Join(answerChunks, "")
	var modelCalls atomic.Int32
	modelStopped := make(chan struct{})
	modelStarted := make(chan struct{})
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/chat/completions", r.URL.Path)
		require.Equal(t, "Bearer fixture-model-key", r.Header.Get("Authorization"))
		var body struct {
			Model    string              `json:"model"`
			Messages []runnerctx.Message `json:"messages"`
			Tools    json.RawMessage     `json:"tools"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.Equal(t, "fixture-model", body.Model)
		require.Empty(t, body.Tools)
		switch modelCalls.Add(1) {
		case 1:
			require.Equal(t, "first question", body.Messages[len(body.Messages)-1].Content)
		case 2:
			contents := make([]string, 0, len(body.Messages))
			for _, m := range body.Messages {
				contents = append(contents, m.Content)
			}
			require.Contains(t, contents, "first question")
			require.Contains(t, contents, answer)
			require.Equal(t, "second question", contents[len(contents)-1])
		case 3:
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			close(modelStarted)
			<-r.Context().Done()
			close(modelStopped)
			return
		default:
			t.Error("replay unexpectedly started a new model call")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, content := range answerChunks {
			chunk, err := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": content}}}})
			require.NoError(t, err)
			_, _ = fmt.Fprintf(w, "data: %s\n\n", chunk)
			w.(http.Flusher).Flush()
		}
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer model.Close()
	t.Setenv("OPENAI_BASE_URL", model.URL)
	credential := device.Credential{DeviceID: "device-1", TargetID: "target-1", Secret: "fixture-device-key", ExpiresAt: time.Now().Add(time.Hour), RuntimeID: "openai-sdk", WorkspaceRoot: workspace}
	batches := make(chan device.Batch, 10)
	done := make(chan string, 10)
	controlApplied := make(chan struct{}, 1)
	hubServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer fixture-device-key", r.Header.Get("Authorization"))
		var data any = struct{}{}
		switch {
		case r.URL.Path == "/edge/device/heartbeat":
		case r.URL.Path == "/edge/device/poll":
			select {
			case data = <-batches:
			case <-r.Context().Done():
				return
			}
		case strings.HasPrefix(r.URL.Path, "/edge/device/tasks/"):
			if strings.HasSuffix(r.URL.Path, "/done") {
				var result hub.TaskResult
				require.NoError(t, json.NewDecoder(r.Body).Decode(&result))
				var text map[string]string
				require.NoError(t, json.Unmarshal([]byte(result.FinalContent), &text))
				require.Equal(t, answer, text["content"])
				done <- r.URL.Path
			}
		case r.URL.Path == "/edge/device/controls/task-3/ack":
			var ack map[string]string
			require.NoError(t, json.NewDecoder(r.Body).Decode(&ack))
			require.Equal(t, "applied", ack["status"])
			require.NotEmpty(t, ack["run_id"])
			select {
			case <-modelStopped:
			case <-time.After(time.Second):
				t.Error("applied was sent without cancelling the model HTTP request")
			}
			controlApplied <- struct{}{}
		default:
			t.Errorf("unexpected callback route %s", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"code": "ok", "data": data})
	}))
	defer hubServer.Close()
	credential.HubURL = hubServer.URL
	reg := adapters.NewRegistry()
	require.NoError(t, reg.Register(sdk.NewOpenAISDKAdapter("fixture-model-key", "fixture-model", model.Client())))
	repository, err := store.NewSQLite(filepath.Join(t.TempDir(), "runs.sqlite"))
	require.NoError(t, err)
	defer repository.Close()
	h, err := newHandlerFromConfig(Config{DeviceCredential: &credential, Store: repository, AdapterRegistry: reg, AgentDefault: "openai-sdk", HubURL: hubServer.URL, HubToken: credential.Secret, WorkspaceAllowlist: []string{workspace}})
	require.NoError(t, err)
	defer h.Bus.Close()
	executor, ok := h.Executor.(*lifecycle.ProcessExecutor)
	require.True(t, ok)
	defer executor.CancelAll(context.Background())
	cbConfig := hub.DefaultCallbackConfig()
	cbConfig.DeviceMode = true
	callbacks := hub.NewCallbackClient(hubServer.URL, credential.Secret, hubServer.Client(), cbConfig)
	h.CallbackClient = callbacks
	executor.WithHubCallback(callbacks)
	client, err := device.NewClient(hubServer.URL, credential.Secret, hubServer.Client())
	require.NoError(t, err)
	journal, err := device.OpenJournal(filepath.Join(t.TempDir(), "journal.sqlite"))
	require.NoError(t, err)
	defer journal.Close()
	worker := device.Worker{Client: client, Credential: credential, Allowlist: []string{workspace}, Journal: journal, Execution: enrolledExecution{h}}
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { result <- worker.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-result:
		case <-time.After(5 * time.Second):
			t.Error("device worker did not stop")
		}
	}()
	delivery := func(task, prompt string, history []runnerctx.Message) device.Delivery {
		r := device.TextRun{ProjectID: "paired-device-1", ThreadID: "hub-session-1", Prompt: prompt, AgentID: "openai-sdk", Model: "fixture-model", WorkDir: workspace, CallbackOwner: "edge", HubTaskID: task, DeliveryID: "delivery-" + task, Messages: history}
		raw, marshalErr := json.Marshal(r)
		require.NoError(t, marshalErr)
		return device.Delivery{ID: r.DeliveryID, TaskID: task, RunRequest: raw}
	}
	first := delivery("task-1", "first question", nil)
	batches <- device.Batch{Deliveries: []device.Delivery{first, first}}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("first task not completed")
	}
	firstRun, found := repository.GetRunByHubTaskID("task-1")
	require.True(t, found)
	require.Equal(t, "finished", firstRun.Status)
	require.Empty(t, firstRun.EvidenceGateResult)
	var assistantMessages []string
	for _, item := range repository.ListThreadItems("hub-session-1") {
		if item.Type == "agent_message" {
			assistantMessages = append(assistantMessages, item.Content)
		}
	}
	require.Equal(t, []string{answer}, assistantMessages)
	second := delivery("task-2", "second question", []runnerctx.Message{{Role: "user", Content: "first question"}, {Role: "assistant", Content: answer}})
	batches <- device.Batch{Deliveries: []device.Delivery{first, second}}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("second task not completed")
	}
	third := delivery("task-3", "long question", nil)
	batches <- device.Batch{Deliveries: []device.Delivery{third}}
	select {
	case <-modelStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("cancellable model call did not start")
	}
	batches <- device.Batch{Controls: []device.Control{{ID: "task-3", TaskID: "task-3", Kind: "cancel"}}, Deliveries: []device.Delivery{third}}
	select {
	case <-controlApplied:
	case <-time.After(5 * time.Second):
		t.Fatal("cancel not acknowledged")
	}
	require.EqualValues(t, 3, modelCalls.Load())
	run, found := repository.GetRunByHubTaskID("task-3")
	require.True(t, found)
	require.Equal(t, "cancelled", run.Status)
	require.Nil(t, h.SkillRegistry)
	require.Nil(t, h.CCSwitchReader)
}
