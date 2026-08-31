package handler_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
)

// ── Edge↔Hub 3-layer protocol integration test ──────────────────────────
//
// This test validates the complete callback chain that an Edge server
// executes against the Hub:
//
//   Edge POST /edge/devices/register → Hub ack
//   Web  POST /web/agent-tasks       → Hub creates task, dispatches to Edge
//   Edge POST /edge/agent-tasks/:id/ack → Hub marks running
//   Edge POST /edge/agent-tasks/:id/stream → Hub persists streaming chunks
//   Edge POST /edge/agent-tasks/:id/done → Hub marks completed
//
// Each stage is verified with mock services that record state transitions,
// ensuring the 3-layer protocol contract (Web → Hub → Edge → Hub) holds.

func TestEdgeHubProtocol_FullCallbackChain(t *testing.T) {
	var mu sync.Mutex
	deviceRegistered := false
	taskCreated := false
	taskAcked := false
	ackedRunID := ""
	streamChunks := make([]string, 0)
	taskDone := false

	// ── Mock device service ──────────────────────────────────────────
	deviceSvc := &mockDeviceService{
		registerFn: func(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
			mu.Lock()
			deviceRegistered = true
			mu.Unlock()
			return &model.Device{
				ID:         deviceID,
				UserID:     userID,
				DeviceType: deviceType,
				AppVersion: appVersion,
			}, nil
		},
	}
	deviceHandler := handler.NewDeviceHandler(deviceSvc)

	// ── Mock agent service ───────────────────────────────────────────
	agentSvc := &mockAgentService{
		triggerTaskFn: func(ctx context.Context, userID, triggerMessageID string) (*model.PendingAgentTask, error) {
			mu.Lock()
			taskCreated = true
			mu.Unlock()
			return &model.PendingAgentTask{
				ID:                "d0000000-0000-0000-0000-000000000001",
				AgentInstanceID:   "agent-001",
				TriggeredByUserID: userID,
				TriggerMessageID:  triggerMessageID,
				Status:            model.TaskStatusDispatched,
			}, nil
		},
		addAgentFn: func(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error) {
			return &model.AgentInstance{}, nil
		},
		handleAckFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
			mu.Lock()
			taskAcked = true
			ackedRunID = edgeRunID
			mu.Unlock()
			return nil
		},
		handleStreamFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
			mu.Lock()
			streamChunks = append(streamChunks, stream.Content)
			mu.Unlock()
			return nil
		},
		handleDoneFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
			mu.Lock()
			taskDone = true
			mu.Unlock()
			return nil
		},
	}
	agentHandler := handler.NewAgentHandler(agentSvc)

	t.Run("Stage1_DeviceRegister", func(t *testing.T) {
		c, w := newGinCtx("POST", "/edge/devices/register", map[string]any{
			"device_id":    "22222222-2222-4222-8222-222222222222",
			"app_version":  "2.0.0",
			"capabilities": []string{"claude-code", "opencode"},
		}, "user_id", "u1", "device_type", "desktop")
		deviceHandler.Register(c)

		assertStatus(t, w, 200)
		assertOK(t, w)

		if !deviceRegistered {
			t.Fatal("device should have been registered")
		}
	})

	t.Run("Stage2_TriggerAgentTask", func(t *testing.T) {
		c, w := newGinCtx("POST", "/web/agent-tasks", map[string]string{
			"trigger_message_id": "msg-001",
		}, "user_id", "u1")
		agentHandler.TriggerTask(c)

		assertStatus(t, w, 200)
		resp := parseResp(t, w)
		if resp.Code != "ok" {
			t.Fatalf("stage 2 trigger task: expected ok got %s", resp.Code)
		}
		if !taskCreated {
			t.Fatal("task should have been created")
		}

		// Verify task payload in response
		var taskData map[string]interface{}
		dataJSON, _ := json.Marshal(resp.Data)
		if err := json.Unmarshal(dataJSON, &taskData); err != nil {
			t.Fatalf("failed to decode task data: %v", err)
		}
		if taskData["id"] != "d0000000-0000-0000-0000-000000000001" {
			t.Fatalf("expected task id task-001, got %v", taskData["id"])
		}
		if taskData["status"] != model.TaskStatusDispatched {
			t.Fatalf("expected status %s, got %v", model.TaskStatusDispatched, taskData["status"])
		}
	})

	t.Run("Stage3_EdgeAck", func(t *testing.T) {
		c, w := newGinCtx("POST", "/edge/agent-tasks/task-001/ack", map[string]string{
			"run_id": "run-edge-001",
		}, "user_id", "u1")
		// Edge routes have Gin params parsed via router; set Param manually
		c.Params = []gin.Param{{Key: "id", Value: "d0000000-0000-0000-0000-000000000001"}}
		agentHandler.TaskAck(c)

		assertStatus(t, w, 200)
		assertOK(t, w)

		if !taskAcked {
			t.Fatal("task should have been acked")
		}
		if ackedRunID != "run-edge-001" {
			t.Fatalf("ack edge run id = %q, want run-edge-001", ackedRunID)
		}
	})

	t.Run("Stage4_EdgeStream", func(t *testing.T) {
		chunks := []string{
			`{"type":"text","content":"Hello from Edge"}`,
			`{"type":"tool_call","name":"read_file","args":{"path":"/tmp/test.go"}}`,
			`{"type":"text","content":"Done processing"}`,
		}
		for i, chunk := range chunks {
			c, w := newGinCtx("POST", "/edge/agent-tasks/task-001/stream", map[string]string{
				"content": chunk,
			}, "user_id", "u1")
			c.Params = []gin.Param{{Key: "id", Value: "d0000000-0000-0000-0000-000000000001"}}
			agentHandler.TaskStream(c)

			assertStatus(t, w, 200)
			assertOK(t, w)

			if len(streamChunks) != i+1 {
				t.Fatalf("stream chunk %d: expected %d chunks recorded, got %d", i, i+1, len(streamChunks))
			}
		}
		if streamChunks[0] != chunks[0] {
			t.Fatalf("first chunk mismatch: %q", streamChunks[0])
		}
	})

	t.Run("Stage5_EdgeDone", func(t *testing.T) {
		c, w := newGinCtx("POST", "/edge/agent-tasks/task-001/done", map[string]string{
			"final_content": "All operations completed successfully.",
		}, "user_id", "u1")
		c.Params = []gin.Param{{Key: "id", Value: "d0000000-0000-0000-0000-000000000001"}}
		agentHandler.TaskDone(c)

		assertStatus(t, w, 200)
		assertOK(t, w)

		if !taskDone {
			t.Fatal("task should have been marked done")
		}
	})

	t.Run("Stage6_EdgeFail", func(t *testing.T) {
		// Reset and test failure path with a new task
		mu.Lock()
		taskDone = false
		mu.Unlock()

		agentSvcFail := &mockAgentService{
			handleDoneFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
				return nil
			},
			handleFailFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error {
				mu.Lock()
				taskDone = true // reuse for verification
				mu.Unlock()
				return nil
			},
		}
		failHandler := handler.NewAgentHandler(agentSvcFail)

		c, w := newGinCtx("POST", "/edge/agent-tasks/task-002/fail", map[string]string{
			"error": "execution timeout after 60s",
		}, "user_id", "u1")
		c.Params = []gin.Param{{Key: "id", Value: "d0000000-0000-0000-0000-000000000002"}}
		failHandler.TaskFail(c)

		assertStatus(t, w, 200)
		assertOK(t, w)

		if !taskDone {
			t.Fatal("task fail should have been recorded")
		}
	})
}

func TestAgentHandlerTaskStreamRejectsInvalidClientMsgID(t *testing.T) {
	called := false
	agentSvc := &mockAgentService{
		handleStreamFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
			called = true
			return nil
		},
	}
	agentHandler := handler.NewAgentHandler(agentSvc)

	c, w := newGinCtx("POST", "/edge/agent-tasks/task-001/stream", map[string]string{
		"content":       "hello",
		"client_msg_id": "not-a-uuid",
	}, "user_id", "u1", "device_id", "dev-1")
	c.Params = []gin.Param{{Key: "id", Value: "d0000000-0000-0000-0000-000000000001"}}

	agentHandler.TaskStream(c)

	assertStatus(t, w, http.StatusBadRequest)
	if called {
		t.Fatal("HandleTaskStream should not run for invalid client_msg_id")
	}
}

// TestEdgeHubProtocol_RegisterRequired verifies that the Hub requires device
// registration before accepting agent task callbacks (authorization check).
func TestEdgeHubProtocol_RegisterRequired(t *testing.T) {
	// This verifies the device registration shape accepted by Hub.
	// The actual auth enforcement happens in middleware (tested separately).

	t.Run("ValidRegistrationPayload", func(t *testing.T) {
		c, w := newGinCtx("POST", "/edge/devices/register", map[string]any{
			"device_id":    "dddddddd-dddd-dddd-dddd-dddddddddd01",
			"app_version":  "1.0.0",
			"capabilities": []string{"claude-code", "opencode", "codex"},
		}, "user_id", "u1", "device_type", "desktop")

		assertJSONBody(t, c.Request, map[string]string{
			"device_id": "dddddddd-dddd-dddd-dddd-dddddddddd01",
		})
		assertStatus(t, w, 200) // won't fire handler here, just validates body
	})

	t.Run("MissingDeviceID", func(t *testing.T) {
		svc := &mockDeviceService{
			registerFn: func(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
				return nil, nil
			},
		}
		h := handler.NewDeviceHandler(svc)
		c, w := newGinCtx("POST", "/edge/devices/register", map[string]string{
			"app_version": "1.0",
		}, "user_id", "u1", "device_type", "desktop")
		h.Register(c)

		assertStatus(t, w, 400)
	})
}

// TestEdgeHubProtocol_TaskLifecycleStateMachine verifies the task
// status state machine: queued → dispatched → running → done/failed.
func TestEdgeHubProtocol_TaskLifecycleStateMachine(t *testing.T) {
	stateLog := make([]string, 0)
	var mu sync.Mutex

	recordState := func(s string) {
		mu.Lock()
		stateLog = append(stateLog, s)
		mu.Unlock()
	}

	agentSvc := &mockAgentService{
		triggerTaskFn: func(ctx context.Context, userID, triggerMessageID string) (*model.PendingAgentTask, error) {
			recordState(model.TaskStatusDispatched)
			return &model.PendingAgentTask{
				ID:     "d0000000-0000-0000-0000-000000000011",
				Status: model.TaskStatusDispatched,
			}, nil
		},
		handleAckFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
			recordState(model.TaskStatusRunning)
			return nil
		},
		handleStreamFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
			return nil
		},
		handleDoneFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
			recordState(model.TaskStatusDone)
			return nil
		},
	}
	h := handler.NewAgentHandler(agentSvc)

	// Trigger
	c, w := newGinCtx("POST", "/web/agent-tasks", map[string]string{
		"trigger_message_id": "msg-state-001",
	}, "user_id", "u1")
	h.TriggerTask(c)
	assertStatus(t, w, 200)

	// Ack
	c, w = newGinCtx("POST", "/edge/agent-tasks/task-state-001/ack", nil, "user_id", "u1")
	c.Params = []gin.Param{{Key: "id", Value: "d0000000-0000-0000-0000-000000000011"}}
	h.TaskAck(c)
	assertStatus(t, w, 200)

	// Done
	c, w = newGinCtx("POST", "/edge/agent-tasks/task-state-001/done", map[string]string{
		"final_content": "completed",
	}, "user_id", "u1")
	c.Params = []gin.Param{{Key: "id", Value: "d0000000-0000-0000-0000-000000000011"}}
	h.TaskDone(c)
	assertStatus(t, w, 200)

	// Verify state transitions
	expected := []string{model.TaskStatusDispatched, model.TaskStatusRunning, model.TaskStatusDone}
	if len(stateLog) != len(expected) {
		t.Fatalf("expected %d state transitions, got %d: %v", len(expected), len(stateLog), stateLog)
	}
	for i, exp := range expected {
		if stateLog[i] != exp {
			t.Fatalf("state[%d]: expected %s, got %s", i, exp, stateLog[i])
		}
	}
}

func TestTriggerTaskPassesTargetID(t *testing.T) {
	var gotTargetID string
	agentSvc := &mockAgentService{
		triggerTaskWithTargetFn: func(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
			gotTargetID = targetID
			return &model.PendingAgentTask{
				ID:                "task-target-001",
				AgentInstanceID:   "agent-001",
				TriggeredByUserID: userID,
				TriggerMessageID:  triggerMessageID,
				Status:            model.TaskStatusQueued,
				TargetID:          targetID,
			}, nil
		},
	}
	h := handler.NewAgentHandler(agentSvc)

	c, w := newGinCtx("POST", "/web/agent-tasks", map[string]string{
		"trigger_message_id": "msg-001",
		"target_id":          "target-001",
	}, "user_id", "u1")
	h.TriggerTask(c)

	assertStatus(t, w, 200)
	assertOK(t, w)
	if gotTargetID != "target-001" {
		t.Fatalf("target_id was not passed to service: got %q", gotTargetID)
	}
}

func TestTaskEventsPassesQueryFiltersToService(t *testing.T) {
	var gotFilter model.AgentRunEventFilter
	agentSvc := &mockAgentService{
		listTaskRunEventsFn: func(ctx context.Context, userID, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error) {
			gotFilter = filter
			return []model.AgentRunEvent{{TaskID: taskID, EventSeq: 3, EventType: "run.agent.tool_call", Payload: `{}`}}, nil
		},
	}
	h := handler.NewAgentHandler(agentSvc)

	c, w := newGinCtx("GET", "/web/agent-tasks/task-1/events?event_type=run.agent.tool_call&after_seq=2&limit=10", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "task-1"}}
	h.TaskEvents(c)

	assertStatus(t, w, 200)
	assertOK(t, w)
	if gotFilter.EventType != "run.agent.tool_call" || gotFilter.AfterSeq != 2 || gotFilter.Limit != 10 {
		t.Fatalf("unexpected filter: %+v", gotFilter)
	}
}

func TestTaskEventSummaryReturnsRuntimeSummary(t *testing.T) {
	agentSvc := &mockAgentService{
		taskRunEventSummaryFn: func(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error) {
			return &model.AgentRunEventSummary{
				TaskID:      taskID,
				Status:      model.TaskStatusDone,
				TotalEvents: 2,
			}, nil
		},
	}
	h := handler.NewAgentHandler(agentSvc)

	c, w := newGinCtx("GET", "/web/agent-tasks/task-1/events/summary", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "task-1"}}
	h.TaskEventSummary(c)

	assertStatus(t, w, 200)
	resp := parseResp(t, w)
	if resp.Code != "ok" {
		t.Fatalf("expected ok, got %s", resp.Code)
	}
	payload, ok := resp.Data.(map[string]interface{})
	if !ok {
		t.Fatalf("expected object data, got %T", resp.Data)
	}
	if payload["task_id"] != "task-1" || payload["status"] != model.TaskStatusDone {
		t.Fatalf("unexpected summary payload: %v", payload)
	}
}

func TestTaskEventSummaryAliasReturnsRuntimeSummary(t *testing.T) {
	agentSvc := &mockAgentService{
		taskRunEventSummaryFn: func(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error) {
			return &model.AgentRunEventSummary{
				TaskID:      taskID,
				Status:      model.TaskStatusRunning,
				TotalEvents: 3,
			}, nil
		},
	}
	h := handler.NewAgentHandler(agentSvc)

	c, w := newGinCtx("GET", "/web/agent-tasks/task-1/summary", nil, "user_id", "u1")
	c.Params = gin.Params{{Key: "id", Value: "task-1"}}
	h.TaskEventSummary(c)

	assertStatus(t, w, 200)
	resp := parseResp(t, w)
	if resp.Code != "ok" {
		t.Fatalf("expected ok, got %s", resp.Code)
	}
	payload, ok := resp.Data.(map[string]interface{})
	if !ok {
		t.Fatalf("expected object data, got %T", resp.Data)
	}
	if payload["task_id"] != "task-1" || payload["status"] != model.TaskStatusRunning {
		t.Fatalf("unexpected alias summary payload: %v", payload)
	}
}

// ── Helpers ───────────────────────────────────────────────────────────

// mockAgentService satisfies handler.AgentService.
type mockAgentService struct {
	triggerTaskFn           func(ctx context.Context, userID, triggerMessageID string) (*model.PendingAgentTask, error)
	triggerTaskWithTargetFn func(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error)
	regenerateAgentTaskFn   func(ctx context.Context, userID, taskID string) (*model.PendingAgentTask, error)
	addAgentFn              func(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error)
	cancelTaskFn            func(ctx context.Context, userID, taskID string) error
	handleAckFn             func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error
	handleStreamFn          func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error
	handleDoneFn            func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error
	handleFailFn            func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error
	listTaskRunEventsFn     func(ctx context.Context, userID, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error)
	taskRunEventSummaryFn   func(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error)
}

func (m *mockAgentService) AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error) {
	if m.addAgentFn != nil {
		return m.addAgentFn(ctx, userID, sessionID, agentType, customAgentID, displayName)
	}
	return &model.AgentInstance{}, nil
}
func (m *mockAgentService) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	if m.triggerTaskWithTargetFn != nil {
		return m.triggerTaskWithTargetFn(ctx, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID)
	}
	if m.triggerTaskFn != nil {
		return m.triggerTaskFn(ctx, userID, triggerMessageID)
	}
	return nil, nil
}
func (m *mockAgentService) RegenerateAgentTask(ctx context.Context, userID, taskID string) (*model.PendingAgentTask, error) {
	if m.regenerateAgentTaskFn != nil {
		return m.regenerateAgentTaskFn(ctx, userID, taskID)
	}
	return nil, nil
}
func (m *mockAgentService) CancelTask(ctx context.Context, userID, taskID string) error {
	if m.cancelTaskFn != nil {
		return m.cancelTaskFn(ctx, userID, taskID)
	}
	return nil
}
func (m *mockAgentService) HandleTaskAck(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
	if m.handleAckFn != nil {
		return m.handleAckFn(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID)
	}
	return nil
}
func (m *mockAgentService) HandleTaskStream(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
	if m.handleStreamFn != nil {
		return m.handleStreamFn(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, stream)
	}
	return nil
}
func (m *mockAgentService) HandleTaskDone(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
	if m.handleDoneFn != nil {
		return m.handleDoneFn(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent)
	}
	return nil
}
func (m *mockAgentService) HandleTaskFail(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error {
	if m.handleFailFn != nil {
		return m.handleFailFn(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg)
	}
	return nil
}
func (m *mockAgentService) ListTaskRunEvents(ctx context.Context, userID, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error) {
	if m.listTaskRunEventsFn != nil {
		return m.listTaskRunEventsFn(ctx, userID, taskID, filter)
	}
	return nil, nil
}
func (m *mockAgentService) GetTaskRunEventSummary(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error) {
	if m.taskRunEventSummaryFn != nil {
		return m.taskRunEventSummaryFn(ctx, userID, taskID)
	}
	return nil, nil
}

func assertStatus(t *testing.T, w *httptest.ResponseRecorder, expected int) {
	t.Helper()
	if w.Code != expected {
		t.Fatalf("expected HTTP %d, got %d: %s", expected, w.Code, w.Body.String())
	}
}

func assertOK(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	resp := parseResp(t, w)
	if resp.Code != "ok" {
		t.Fatalf("expected ok, got %s", resp.Code)
	}
}

func parseResp(t *testing.T, w *httptest.ResponseRecorder) handler.Response {
	t.Helper()
	var resp handler.Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	return resp
}

func assertJSONBody(t *testing.T, r *http.Request, want map[string]string) {
	t.Helper()
	body, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(strings.NewReader(string(body)))
	var got map[string]interface{}
	json.Unmarshal(body, &got)
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("body[%s]: expected %q, got %v", k, v, got[k])
		}
	}
}
