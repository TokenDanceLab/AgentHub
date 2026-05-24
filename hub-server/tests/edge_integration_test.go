package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
)

// ── Mock services ──────────────────────────────────────────────────────────

// mockEdgeAgentService implements handler.AgentService for edge callback tests.
type mockEdgeAgentService struct {
	handleTaskAckFn    func(ctx context.Context, taskID, edgeRunID string) error
	handleTaskStreamFn func(ctx context.Context, taskID, content string) error
	handleTaskDoneFn   func(ctx context.Context, taskID, finalContent string) error
	handleTaskFailFn   func(ctx context.Context, taskID, errMsg string) error

	addAgentFn    func(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) error
	triggerTaskFn func(ctx context.Context, userID, triggerMessageID string) (*model.PendingAgentTask, error)
	cancelTaskFn  func(ctx context.Context, userID, taskID string) error
}

func (m *mockEdgeAgentService) AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) error {
	return m.addAgentFn(ctx, userID, sessionID, agentType, customAgentID, displayName)
}
func (m *mockEdgeAgentService) TriggerAgentTask(ctx context.Context, userID, triggerMessageID string) (*model.PendingAgentTask, error) {
	return m.triggerTaskFn(ctx, userID, triggerMessageID)
}
func (m *mockEdgeAgentService) CancelTask(ctx context.Context, userID, taskID string) error {
	return m.cancelTaskFn(ctx, userID, taskID)
}
func (m *mockEdgeAgentService) HandleTaskAck(ctx context.Context, taskID, edgeRunID string) error {
	return m.handleTaskAckFn(ctx, taskID, edgeRunID)
}
func (m *mockEdgeAgentService) HandleTaskStream(ctx context.Context, taskID, content string) error {
	return m.handleTaskStreamFn(ctx, taskID, content)
}
func (m *mockEdgeAgentService) HandleTaskDone(ctx context.Context, taskID, finalContent string) error {
	return m.handleTaskDoneFn(ctx, taskID, finalContent)
}
func (m *mockEdgeAgentService) HandleTaskFail(ctx context.Context, taskID, errMsg string) error {
	return m.handleTaskFailFn(ctx, taskID, errMsg)
}

// mockEdgeDeviceService implements handler.DeviceService.
type mockEdgeDeviceService struct {
	registerFn func(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error)
}

func (m *mockEdgeDeviceService) Register(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
	return m.registerFn(deviceID, userID, deviceType, appVersion, capabilities)
}

// ── Test helpers ───────────────────────────────────────────────────────────

func newEdgeGinCtx(method, path string, body any, kv ...string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	var reqBody []byte
	if body != nil {
		reqBody, _ = json.Marshal(body)
	}
	c.Request = httptest.NewRequest(method, path, bytes.NewReader(reqBody))
	c.Request.Header.Set("Content-Type", "application/json")

	for i := 0; i+1 < len(kv); i += 2 {
		c.Set(kv[i], kv[i+1])
	}
	return c, w
}

func parseEdgeResp(t *testing.T, w *httptest.ResponseRecorder) handler.Response {
	t.Helper()
	var resp handler.Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	return resp
}

// ── Device Register ────────────────────────────────────────────────────────

func TestEdgeDeviceRegister(t *testing.T) {
	var captured struct {
		deviceID     string
		userID       string
		deviceType   string
		capabilities []string
	}
	svc := &mockEdgeDeviceService{
		registerFn: func(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
			captured.deviceID = deviceID
			captured.userID = userID
			captured.deviceType = deviceType
			captured.capabilities = capabilities
			return &model.Device{
				ID: deviceID, UserID: userID, DeviceType: deviceType,
				AppVersion: appVersion,
			}, nil
		},
	}
	h := handler.NewDeviceHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/devices/register", map[string]any{
		"device_id":    "edge-device-001",
		"app_version":  "2.0.0",
		"capabilities": []string{"codex", "claude-code"},
	}, "user_id", "user-1", "device_type", "desktop")
	h.Register(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseEdgeResp(t, w)
	if resp.Code != "OK" {
		t.Fatalf("expected OK, got %s: %s", resp.Code, resp.Message)
	}
	if captured.deviceID != "edge-device-001" {
		t.Errorf("deviceID = %q, want edge-device-001", captured.deviceID)
	}
	if captured.userID != "user-1" {
		t.Errorf("userID = %q, want user-1", captured.userID)
	}
	if captured.deviceType != "desktop" {
		t.Errorf("deviceType = %q, want desktop", captured.deviceType)
	}
	if len(captured.capabilities) != 2 {
		t.Errorf("capabilities len = %d, want 2", len(captured.capabilities))
	}

	// Verify response contains device object.
	data, _ := json.Marshal(resp.Data)
	var dev map[string]any
	json.Unmarshal(data, &dev)
	if dev["id"] != "edge-device-001" {
		t.Errorf("response device id = %v, want edge-device-001", dev["id"])
	}
}

func TestEdgeDeviceRegisterBadRequest(t *testing.T) {
	svc := &mockEdgeDeviceService{
		registerFn: func(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
			return nil, errcode.ErrInternal
		},
	}
	h := handler.NewDeviceHandler(svc)

	// Missing required device_id field.
	c, w := newEdgeGinCtx("POST", "/edge/devices/register", map[string]any{
		"app_version": "2.0.0",
	}, "user_id", "user-1", "device_type", "desktop")
	h.Register(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEdgeDeviceRegisterInternalError(t *testing.T) {
	svc := &mockEdgeDeviceService{
		registerFn: func(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
			return nil, context.DeadlineExceeded
		},
	}
	h := handler.NewDeviceHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/devices/register", map[string]any{
		"device_id": "edge-device-002",
	}, "user_id", "user-2", "device_type", "desktop")
	h.Register(c)

	if w.Code != 500 {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Agent Task Ack ─────────────────────────────────────────────────────────

func TestEdgeAgentTaskAck(t *testing.T) {
	var ackedTaskID string
	var ackedRunID string
	svc := &mockEdgeAgentService{
		handleTaskAckFn: func(ctx context.Context, taskID, edgeRunID string) error {
			ackedTaskID = taskID
			ackedRunID = edgeRunID
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/task-001/ack", map[string]string{
		"run_id": "run-edge-001",
	},
		"user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "task-001"}}
	h.TaskAck(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseEdgeResp(t, w)
	if resp.Code != "OK" {
		t.Fatalf("expected OK, got %s: %s", resp.Code, resp.Message)
	}
	if ackedTaskID != "task-001" {
		t.Errorf("acked task ID = %q, want task-001", ackedTaskID)
	}
	if ackedRunID != "run-edge-001" {
		t.Errorf("acked run ID = %q, want run-edge-001", ackedRunID)
	}
}

func TestEdgeAgentTaskAckNotFound(t *testing.T) {
	svc := &mockEdgeAgentService{
		handleTaskAckFn: func(ctx context.Context, taskID, edgeRunID string) error {
			return errcode.AgentTaskNotFound
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/task-missing/ack", nil,
		"user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "task-missing"}}
	h.TaskAck(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseEdgeResp(t, w)
	if resp.Code != "AGENT_TASK_NOT_FOUND" {
		t.Errorf("expected AGENT_TASK_NOT_FOUND, got %s", resp.Code)
	}
}

// ── Agent Task Stream ──────────────────────────────────────────────────────

func TestEdgeAgentTaskStream(t *testing.T) {
	var captured struct {
		taskID  string
		content string
	}
	svc := &mockEdgeAgentService{
		handleTaskStreamFn: func(ctx context.Context, taskID, content string) error {
			captured.taskID = taskID
			captured.content = content
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/task-002/stream", map[string]any{
		"content": "Hello from Edge runner!",
	}, "user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "task-002"}}
	h.TaskStream(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseEdgeResp(t, w)
	if resp.Code != "OK" {
		t.Fatalf("expected OK, got %s: %s", resp.Code, resp.Message)
	}
	if captured.taskID != "task-002" {
		t.Errorf("taskID = %q, want task-002", captured.taskID)
	}
	if captured.content != "Hello from Edge runner!" {
		t.Errorf("content = %q, want 'Hello from Edge runner!'", captured.content)
	}
}

func TestEdgeAgentTaskStreamMultipleChunks(t *testing.T) {
	var chunks []string
	svc := &mockEdgeAgentService{
		handleTaskStreamFn: func(ctx context.Context, taskID, content string) error {
			chunks = append(chunks, content)
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	for i, chunk := range []string{"chunk-1\n", "chunk-2\n", "chunk-3"} {
		c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/task-003/stream", map[string]any{
			"content": chunk,
		}, "user_id", "user-1", "device_type", "desktop")
		c.Params = gin.Params{{Key: "id", Value: "task-003"}}
		h.TaskStream(c)

		if w.Code != 200 {
			t.Fatalf("chunk %d: expected 200, got %d", i, w.Code)
		}
	}
	if len(chunks) != 3 {
		t.Fatalf("expected 3 chunks, got %d", len(chunks))
	}
}

func TestEdgeAgentTaskStreamBadRequest(t *testing.T) {
	svc := &mockEdgeAgentService{
		handleTaskStreamFn: func(ctx context.Context, taskID, content string) error {
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	// Missing required "content" field.
	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/task-004/stream", map[string]any{},
		"user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "task-004"}}
	h.TaskStream(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEdgeAgentTaskStreamNotFound(t *testing.T) {
	svc := &mockEdgeAgentService{
		handleTaskStreamFn: func(ctx context.Context, taskID, content string) error {
			return errcode.AgentTaskNotFound
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/task-missing/stream", map[string]any{
		"content": "some output",
	}, "user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "task-missing"}}
	h.TaskStream(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Agent Task Done ────────────────────────────────────────────────────────

func TestEdgeAgentTaskDone(t *testing.T) {
	var captured struct {
		taskID       string
		finalContent string
	}
	svc := &mockEdgeAgentService{
		handleTaskDoneFn: func(ctx context.Context, taskID, finalContent string) error {
			captured.taskID = taskID
			captured.finalContent = finalContent
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/task-005/done", map[string]any{
		"final_content": "Task completed successfully.",
	}, "user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "task-005"}}
	h.TaskDone(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseEdgeResp(t, w)
	if resp.Code != "OK" {
		t.Fatalf("expected OK, got %s: %s", resp.Code, resp.Message)
	}
	if captured.taskID != "task-005" {
		t.Errorf("taskID = %q, want task-005", captured.taskID)
	}
	if captured.finalContent != "Task completed successfully." {
		t.Errorf("finalContent = %q", captured.finalContent)
	}
}

func TestEdgeAgentTaskDoneWithoutContent(t *testing.T) {
	var called bool
	svc := &mockEdgeAgentService{
		handleTaskDoneFn: func(ctx context.Context, taskID, finalContent string) error {
			called = true
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	// final_content is optional — handler binds it as empty string if omitted.
	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/task-006/done", map[string]any{},
		"user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "task-006"}}
	h.TaskDone(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !called {
		t.Error("HandleTaskDone was not called")
	}
}

func TestEdgeAgentTaskDoneAlreadyFinished(t *testing.T) {
	svc := &mockEdgeAgentService{
		handleTaskDoneFn: func(ctx context.Context, taskID, finalContent string) error {
			return errcode.ErrBadRequest // task already done/failed/cancelled
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/task-007/done", map[string]any{
		"final_content": "done",
	}, "user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "task-007"}}
	h.TaskDone(c)

	if w.Code != 400 {
		t.Fatalf("expected 400 for already-finished task, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Agent Task Fail ────────────────────────────────────────────────────────

func TestEdgeAgentTaskFail(t *testing.T) {
	var captured struct {
		taskID string
		errMsg string
	}
	svc := &mockEdgeAgentService{
		handleTaskFailFn: func(ctx context.Context, taskID, errMsg string) error {
			captured.taskID = taskID
			captured.errMsg = errMsg
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/task-008/fail", map[string]any{
		"error": "runner process crashed: signal 11",
	}, "user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "task-008"}}
	h.TaskFail(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseEdgeResp(t, w)
	if resp.Code != "OK" {
		t.Fatalf("expected OK, got %s: %s", resp.Code, resp.Message)
	}
	if captured.taskID != "task-008" {
		t.Errorf("taskID = %q, want task-008", captured.taskID)
	}
	if captured.errMsg != "runner process crashed: signal 11" {
		t.Errorf("errMsg = %q", captured.errMsg)
	}
}

func TestEdgeAgentTaskFailBadRequest(t *testing.T) {
	svc := &mockEdgeAgentService{
		handleTaskFailFn: func(ctx context.Context, taskID, errMsg string) error {
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	// Missing required "error" field.
	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/task-009/fail", map[string]any{},
		"user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "task-009"}}
	h.TaskFail(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// ── End-to-end protocol simulation ─────────────────────────────────────────

// TestEdgeTaskLifecycle simulates a complete task lifecycle through Hub's
// edge callback endpoints: ack -> stream(s) -> done.
func TestEdgeTaskLifecycle(t *testing.T) {
	svc := &mockEdgeAgentService{
		handleTaskAckFn: func(ctx context.Context, taskID, edgeRunID string) error {
			if taskID != "lifecycle-task" {
				t.Errorf("ack: taskID = %q, want lifecycle-task", taskID)
			}
			return nil
		},
		handleTaskStreamFn: func(ctx context.Context, taskID, content string) error {
			if taskID != "lifecycle-task" {
				t.Errorf("stream: taskID = %q, want lifecycle-task", taskID)
			}
			return nil
		},
		handleTaskDoneFn: func(ctx context.Context, taskID, finalContent string) error {
			if taskID != "lifecycle-task" {
				t.Errorf("done: taskID = %q, want lifecycle-task", taskID)
			}
			if finalContent != "final result" {
				t.Errorf("done: finalContent = %q, want 'final result'", finalContent)
			}
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	// Step 1: Edge acknowledges receipt of the task.
	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/lifecycle-task/ack", nil,
		"user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "lifecycle-task"}}
	h.TaskAck(c)
	if w.Code != 200 {
		t.Fatalf("step 1 ack: expected 200, got %d", w.Code)
	}

	// Step 2: Edge streams intermediate output.
	for _, chunk := range []string{"output line 1\n", "output line 2\n"} {
		c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/lifecycle-task/stream", map[string]any{
			"content": chunk,
		}, "user_id", "user-1", "device_type", "desktop")
		c.Params = gin.Params{{Key: "id", Value: "lifecycle-task"}}
		h.TaskStream(c)
		if w.Code != 200 {
			t.Fatalf("step 2 stream: expected 200, got %d", w.Code)
		}
	}

	// Step 3: Edge marks task as done with final content.
	c, w = newEdgeGinCtx("POST", "/edge/agent-tasks/lifecycle-task/done", map[string]any{
		"final_content": "final result",
	}, "user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "lifecycle-task"}}
	h.TaskDone(c)
	if w.Code != 200 {
		t.Fatalf("step 3 done: expected 200, got %d", w.Code)
	}
}

// TestEdgeTaskLifecycleFail simulates a task that fails after streaming.
func TestEdgeTaskLifecycleFail(t *testing.T) {
	svc := &mockEdgeAgentService{
		handleTaskAckFn: func(ctx context.Context, taskID, edgeRunID string) error { return nil },
		handleTaskStreamFn: func(ctx context.Context, taskID, content string) error {
			return nil
		},
		handleTaskFailFn: func(ctx context.Context, taskID, errMsg string) error {
			if taskID != "fail-task" {
				t.Errorf("fail: taskID = %q, want fail-task", taskID)
			}
			if errMsg != "OOM killed" {
				t.Errorf("fail: errMsg = %q, want 'OOM killed'", errMsg)
			}
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	// Ack + partial stream, then fail.
	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/fail-task/ack", nil,
		"user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "fail-task"}}
	h.TaskAck(c)
	if w.Code != 200 {
		t.Fatalf("ack: expected 200, got %d", w.Code)
	}

	c, w = newEdgeGinCtx("POST", "/edge/agent-tasks/fail-task/stream", map[string]any{
		"content": "partial output...",
	}, "user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "fail-task"}}
	h.TaskStream(c)
	if w.Code != 200 {
		t.Fatalf("stream: expected 200, got %d", w.Code)
	}

	c, w = newEdgeGinCtx("POST", "/edge/agent-tasks/fail-task/fail", map[string]any{
		"error": "OOM killed",
	}, "user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: "fail-task"}}
	h.TaskFail(c)
	if w.Code != 200 {
		t.Fatalf("fail: expected 200, got %d", w.Code)
	}
}
