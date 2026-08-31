//go:build integration

package integration

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

// Edge 回调 handler 通过 taskIDParam 校验 :id 必须是 UUID（非 UUID 返回 400
// 而非数据库 22P02 500，#f5d4f8969）。fixture task id 使用固定合法 UUID，
// 保证断言可读且经过 normalize 后不变。
const (
	edgeTaskID001     = "00000000-0000-4000-8000-000000000001"
	edgeTaskID002     = "00000000-0000-4000-8000-000000000002"
	edgeTaskID003     = "00000000-0000-4000-8000-000000000003"
	edgeTaskID004     = "00000000-0000-4000-8000-000000000004"
	edgeTaskID005     = "00000000-0000-4000-8000-000000000005"
	edgeTaskID006     = "00000000-0000-4000-8000-000000000006"
	edgeTaskID007     = "00000000-0000-4000-8000-000000000007"
	edgeTaskID008     = "00000000-0000-4000-8000-000000000008"
	edgeTaskID009     = "00000000-0000-4000-8000-000000000009"
	edgeTaskIDMissing = "00000000-0000-4000-8000-0000000000ff"
	edgeTaskLifecycle = "00000000-0000-4000-8000-0000000000a1"
	edgeTaskFail      = "00000000-0000-4000-8000-0000000000b1"
)

// ── Mock services ──────────────────────────────────────────────────────────

// mockEdgeAgentService implements handler.AgentService for edge callback tests.
type mockEdgeAgentService struct {
	handleTaskAckFn    func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error
	handleTaskStreamFn func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error
	handleTaskDoneFn   func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error
	handleTaskFailFn   func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error

	addAgentFn    func(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error)
	triggerTaskFn func(ctx context.Context, userID, triggerMessageID string) (*model.PendingAgentTask, error)
	cancelTaskFn  func(ctx context.Context, userID, taskID string) error
}

func (m *mockEdgeAgentService) AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error) {
	return m.addAgentFn(ctx, userID, sessionID, agentType, customAgentID, displayName)
}
func (m *mockEdgeAgentService) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	return m.triggerTaskFn(ctx, userID, triggerMessageID)
}
func (m *mockEdgeAgentService) CancelTask(ctx context.Context, userID, taskID string) error {
	return m.cancelTaskFn(ctx, userID, taskID)
}
func (m *mockEdgeAgentService) HandleTaskAck(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
	return m.handleTaskAckFn(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID)
}
func (m *mockEdgeAgentService) HandleTaskStream(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
	return m.handleTaskStreamFn(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, stream)
}
func (m *mockEdgeAgentService) HandleTaskDone(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
	return m.handleTaskDoneFn(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent)
}
func (m *mockEdgeAgentService) HandleTaskFail(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error {
	return m.handleTaskFailFn(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg)
}
func (m *mockEdgeAgentService) ListTaskRunEvents(ctx context.Context, userID, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error) {
	return nil, nil
}
func (m *mockEdgeAgentService) GetTaskRunEventSummary(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error) {
	return nil, nil
}
func (m *mockEdgeAgentService) RegenerateAgentTask(ctx context.Context, userID, taskID string) (*model.PendingAgentTask, error) {
	return nil, nil
}

// mockEdgeDeviceService implements handler.DeviceService.
type mockEdgeDeviceService struct {
	registerFn func(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error)
}

func (m *mockEdgeDeviceService) Register(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
	return m.registerFn(ctx, deviceID, userID, deviceType, appVersion, capabilities)
}

func (m *mockEdgeDeviceService) ListDevices(userID string) ([]model.Device, error) {
	return nil, nil
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

func parseEdgeResp(t *testing.T, w *httptest.ResponseRecorder) apiResp {
	t.Helper()
	var resp apiResp
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
		registerFn: func(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
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

	const testDeviceID = "33333333-3333-4333-8333-333333333301"
	c, w := newEdgeGinCtx("POST", "/edge/devices/register", map[string]any{
		"device_id":    testDeviceID,
		"app_version":  "2.0.0",
		"capabilities": []string{"codex", "claude-code"},
	}, "user_id", "user-1", "device_type", "desktop")
	h.Register(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseEdgeResp(t, w)
	if resp.GetCode() != errcode.OK.Code {
		t.Fatalf("expected OK, got %s: %s", resp.Code, resp.Code)
	}
	if captured.deviceID != testDeviceID {
		t.Errorf("deviceID = %q, want %s", captured.deviceID, testDeviceID)
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
	if dev["id"] != testDeviceID {
		t.Errorf("response device id = %v, want %s", dev["id"], testDeviceID)
	}
}

func TestEdgeDeviceRegisterBadRequest(t *testing.T) {
	svc := &mockEdgeDeviceService{
		registerFn: func(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
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
		registerFn: func(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
			return nil, context.DeadlineExceeded
		},
	}
	h := handler.NewDeviceHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/devices/register", map[string]any{
		"device_id": "33333333-3333-4333-8333-333333333302",
	}, "user_id", "user-2", "device_type", "desktop")
	h.Register(c)

	if w.Code != 500 {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Agent Task Ack ─────────────────────────────────────────────────────────

func TestEdgeAgentTaskAck(t *testing.T) {
	var ackedEdgeUserID string
	var ackedEdgeDeviceID string
	var ackedTaskID string
	var ackedRunID string
	svc := &mockEdgeAgentService{
		handleTaskAckFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
			ackedEdgeUserID = edgeUserID
			ackedEdgeDeviceID = edgeDeviceID
			ackedTaskID = taskID
			ackedRunID = edgeRunID
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskID001+"/ack", map[string]string{
		"run_id": "run-edge-001",
	},
		"user_id", "user-1", "device_type", "desktop", "device_id", "device-1")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskID001}}
	h.TaskAck(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseEdgeResp(t, w)
	if resp.GetCode() != errcode.OK.Code {
		t.Fatalf("expected OK, got %s: %s", resp.Code, resp.Code)
	}
	if ackedTaskID != edgeTaskID001 {
		t.Errorf("acked task ID = %q, want %s", ackedTaskID, edgeTaskID001)
	}
	if ackedEdgeUserID != "user-1" {
		t.Errorf("acked edge user ID = %q, want user-1", ackedEdgeUserID)
	}
	if ackedEdgeDeviceID != "device-1" {
		t.Errorf("acked edge device ID = %q, want device-1", ackedEdgeDeviceID)
	}
	if ackedRunID != "run-edge-001" {
		t.Errorf("acked run ID = %q, want run-edge-001", ackedRunID)
	}
}

func TestEdgeAgentTaskAckNotFound(t *testing.T) {
	svc := &mockEdgeAgentService{
		handleTaskAckFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
			return errcode.AgentTaskNotFound
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskIDMissing+"/ack", nil,
		"user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskIDMissing}}
	h.TaskAck(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseEdgeResp(t, w)
	if resp.GetCode() != errcode.AgentTaskNotFound.Code {
		t.Errorf("expected agent_task_not_found, got %s", resp.Code)
	}
}

// ── Agent Task Stream ──────────────────────────────────────────────────────

func TestEdgeAgentTaskStream(t *testing.T) {
	var captured struct {
		edgeUserID   string
		edgeDeviceID string
		taskID       string
		runID        string
		content      string
	}
	svc := &mockEdgeAgentService{
		handleTaskStreamFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
			captured.edgeUserID = edgeUserID
			captured.edgeDeviceID = edgeDeviceID
			captured.taskID = taskID
			captured.runID = edgeRunID
			captured.content = stream.Content
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskID002+"/stream", map[string]any{
		"content": "Hello from Edge runner!",
		"run_id":  "run-edge-002",
	}, "user_id", "user-1", "device_type", "desktop", "device_id", "device-1")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskID002}}
	h.TaskStream(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseEdgeResp(t, w)
	if resp.GetCode() != errcode.OK.Code {
		t.Fatalf("expected OK, got %s: %s", resp.Code, resp.Code)
	}
	if captured.taskID != edgeTaskID002 {
		t.Errorf("taskID = %q, want %s", captured.taskID, edgeTaskID002)
	}
	if captured.edgeUserID != "user-1" {
		t.Errorf("edgeUserID = %q, want user-1", captured.edgeUserID)
	}
	if captured.edgeDeviceID != "device-1" {
		t.Errorf("edgeDeviceID = %q, want device-1", captured.edgeDeviceID)
	}
	if captured.runID != "run-edge-002" {
		t.Errorf("runID = %q, want run-edge-002", captured.runID)
	}
	if captured.content != "Hello from Edge runner!" {
		t.Errorf("content = %q, want 'Hello from Edge runner!'", captured.content)
	}
}

func TestEdgeAgentTaskStreamMultipleChunks(t *testing.T) {
	var chunks []string
	svc := &mockEdgeAgentService{
		handleTaskStreamFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
			chunks = append(chunks, stream.Content)
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	for i, chunk := range []string{"chunk-1\n", "chunk-2\n", "chunk-3"} {
		c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskID003+"/stream", map[string]any{
			"content": chunk,
		}, "user_id", "user-1", "device_type", "desktop")
		c.Params = gin.Params{{Key: "id", Value: edgeTaskID003}}
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
		handleTaskStreamFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	// Missing required "content" field.
	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskID004+"/stream", map[string]any{},
		"user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskID004}}
	h.TaskStream(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEdgeAgentTaskStreamNotFound(t *testing.T) {
	svc := &mockEdgeAgentService{
		handleTaskStreamFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
			return errcode.AgentTaskNotFound
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskIDMissing+"/stream", map[string]any{
		"content": "some output",
	}, "user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskIDMissing}}
	h.TaskStream(c)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Agent Task Done ────────────────────────────────────────────────────────

func TestEdgeAgentTaskDone(t *testing.T) {
	var captured struct {
		edgeUserID   string
		edgeDeviceID string
		taskID       string
		runID        string
		finalContent string
	}
	svc := &mockEdgeAgentService{
		handleTaskDoneFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
			captured.edgeUserID = edgeUserID
			captured.edgeDeviceID = edgeDeviceID
			captured.taskID = taskID
			captured.runID = edgeRunID
			captured.finalContent = finalContent
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskID005+"/done", map[string]any{
		"final_content": "Task completed successfully.",
		"run_id":        "run-edge-005",
	}, "user_id", "user-1", "device_type", "desktop", "device_id", "device-1")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskID005}}
	h.TaskDone(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseEdgeResp(t, w)
	if resp.GetCode() != errcode.OK.Code {
		t.Fatalf("expected OK, got %s: %s", resp.Code, resp.Code)
	}
	if captured.taskID != edgeTaskID005 {
		t.Errorf("taskID = %q, want %s", captured.taskID, edgeTaskID005)
	}
	if captured.edgeUserID != "user-1" {
		t.Errorf("edgeUserID = %q, want user-1", captured.edgeUserID)
	}
	if captured.edgeDeviceID != "device-1" {
		t.Errorf("edgeDeviceID = %q, want device-1", captured.edgeDeviceID)
	}
	if captured.runID != "run-edge-005" {
		t.Errorf("runID = %q, want run-edge-005", captured.runID)
	}
	if captured.finalContent != "Task completed successfully." {
		t.Errorf("finalContent = %q", captured.finalContent)
	}
}

func TestEdgeAgentTaskDoneWithoutContent(t *testing.T) {
	var called bool
	svc := &mockEdgeAgentService{
		handleTaskDoneFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
			called = true
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	// final_content is optional — handler binds it as empty string if omitted.
	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskID006+"/done", map[string]any{},
		"user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskID006}}
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
		handleTaskDoneFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
			return errcode.ErrBadRequest // task already done/failed/cancelled
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskID007+"/done", map[string]any{
		"final_content": "done",
	}, "user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskID007}}
	h.TaskDone(c)

	if w.Code != 400 {
		t.Fatalf("expected 400 for already-finished task, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Agent Task Fail ────────────────────────────────────────────────────────

func TestEdgeAgentTaskFail(t *testing.T) {
	var captured struct {
		edgeUserID   string
		edgeDeviceID string
		taskID       string
		runID        string
		errMsg       string
	}
	svc := &mockEdgeAgentService{
		handleTaskFailFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error {
			captured.edgeUserID = edgeUserID
			captured.edgeDeviceID = edgeDeviceID
			captured.taskID = taskID
			captured.runID = edgeRunID
			captured.errMsg = errMsg
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskID008+"/fail", map[string]any{
		"error":  "runner process crashed: signal 11",
		"run_id": "run-edge-008",
	}, "user_id", "user-1", "device_type", "desktop", "device_id", "device-1")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskID008}}
	h.TaskFail(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := parseEdgeResp(t, w)
	if resp.GetCode() != errcode.OK.Code {
		t.Fatalf("expected OK, got %s: %s", resp.Code, resp.Code)
	}
	if captured.taskID != edgeTaskID008 {
		t.Errorf("taskID = %q, want %s", captured.taskID, edgeTaskID008)
	}
	if captured.edgeUserID != "user-1" {
		t.Errorf("edgeUserID = %q, want user-1", captured.edgeUserID)
	}
	if captured.edgeDeviceID != "device-1" {
		t.Errorf("edgeDeviceID = %q, want device-1", captured.edgeDeviceID)
	}
	if captured.runID != "run-edge-008" {
		t.Errorf("runID = %q, want run-edge-008", captured.runID)
	}
	if captured.errMsg != "runner process crashed: signal 11" {
		t.Errorf("errMsg = %q", captured.errMsg)
	}
}

func TestEdgeAgentTaskFailBadRequest(t *testing.T) {
	svc := &mockEdgeAgentService{
		handleTaskFailFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error {
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	// Missing required "error" field.
	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskID009+"/fail", map[string]any{},
		"user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskID009}}
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
		handleTaskAckFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
			if taskID != edgeTaskLifecycle {
				t.Errorf("ack: taskID = %q, want %s", taskID, edgeTaskLifecycle)
			}
			if edgeUserID != "user-1" {
				t.Errorf("ack: edgeUserID = %q, want user-1", edgeUserID)
			}
			return nil
		},
		handleTaskStreamFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
			if taskID != edgeTaskLifecycle {
				t.Errorf("stream: taskID = %q, want %s", taskID, edgeTaskLifecycle)
			}
			if edgeUserID != "user-1" {
				t.Errorf("stream: edgeUserID = %q, want user-1", edgeUserID)
			}
			return nil
		},
		handleTaskDoneFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
			if taskID != edgeTaskLifecycle {
				t.Errorf("done: taskID = %q, want %s", taskID, edgeTaskLifecycle)
			}
			if edgeUserID != "user-1" {
				t.Errorf("done: edgeUserID = %q, want user-1", edgeUserID)
			}
			if finalContent != "final result" {
				t.Errorf("done: finalContent = %q, want 'final result'", finalContent)
			}
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	// Step 1: Edge acknowledges receipt of the task.
	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskLifecycle+"/ack", nil,
		"user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskLifecycle}}
	h.TaskAck(c)
	if w.Code != 200 {
		t.Fatalf("step 1 ack: expected 200, got %d", w.Code)
	}

	// Step 2: Edge streams intermediate output.
	for _, chunk := range []string{"output line 1\n", "output line 2\n"} {
		c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskLifecycle+"/stream", map[string]any{
			"content": chunk,
		}, "user_id", "user-1", "device_type", "desktop")
		c.Params = gin.Params{{Key: "id", Value: edgeTaskLifecycle}}
		h.TaskStream(c)
		if w.Code != 200 {
			t.Fatalf("step 2 stream: expected 200, got %d", w.Code)
		}
	}

	// Step 3: Edge marks task as done with final content.
	c, w = newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskLifecycle+"/done", map[string]any{
		"final_content": "final result",
	}, "user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskLifecycle}}
	h.TaskDone(c)
	if w.Code != 200 {
		t.Fatalf("step 3 done: expected 200, got %d", w.Code)
	}
}

// TestEdgeTaskLifecycleFail simulates a task that fails after streaming.
func TestEdgeTaskLifecycleFail(t *testing.T) {
	svc := &mockEdgeAgentService{
		handleTaskAckFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
			return nil
		},
		handleTaskStreamFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
			return nil
		},
		handleTaskFailFn: func(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error {
			if taskID != edgeTaskFail {
				t.Errorf("fail: taskID = %q, want %s", taskID, edgeTaskFail)
			}
			if edgeUserID != "user-1" {
				t.Errorf("fail: edgeUserID = %q, want user-1", edgeUserID)
			}
			if errMsg != "OOM killed" {
				t.Errorf("fail: errMsg = %q, want 'OOM killed'", errMsg)
			}
			return nil
		},
	}
	h := handler.NewAgentHandler(svc)

	// Ack + partial stream, then fail.
	c, w := newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskFail+"/ack", nil,
		"user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskFail}}
	h.TaskAck(c)
	if w.Code != 200 {
		t.Fatalf("ack: expected 200, got %d", w.Code)
	}

	c, w = newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskFail+"/stream", map[string]any{
		"content": "partial output...",
	}, "user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskFail}}
	h.TaskStream(c)
	if w.Code != 200 {
		t.Fatalf("stream: expected 200, got %d", w.Code)
	}

	c, w = newEdgeGinCtx("POST", "/edge/agent-tasks/"+edgeTaskFail+"/fail", map[string]any{
		"error": "OOM killed",
	}, "user_id", "user-1", "device_type", "desktop")
	c.Params = gin.Params{{Key: "id", Value: edgeTaskFail}}
	h.TaskFail(c)
	if w.Code != 200 {
		t.Fatalf("fail: expected 200, got %d", w.Code)
	}
}
