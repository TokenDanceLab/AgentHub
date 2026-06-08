package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/ws"
)

func newAgentRunEventTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)

	ddl := []string{
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			next_seq INTEGER NOT NULL DEFAULT 0,
			last_message_at DATETIME,
			dissolved BOOLEAN NOT NULL DEFAULT FALSE,
			created_at DATETIME
		)`,
		`CREATE TABLE agent_instances (
			id TEXT PRIMARY KEY,
			agent_type TEXT NOT NULL,
			custom_agent_id TEXT,
			session_id TEXT NOT NULL,
			inviter_user_id TEXT NOT NULL,
			workspace_id TEXT,
			display_name TEXT NOT NULL,
			created_at DATETIME
		)`,
		`CREATE TABLE pending_agent_tasks (
			id TEXT PRIMARY KEY,
			agent_instance_id TEXT NOT NULL,
			triggered_by_user_id TEXT NOT NULL,
			trigger_message_id TEXT NOT NULL,
			status TEXT NOT NULL,
			edge_run_id TEXT,
			edge_device_id TEXT,
			error_message TEXT,
			created_at DATETIME,
			dispatched_at DATETIME,
			finished_at DATETIME,
			expire_at DATETIME NOT NULL
		)`,
		`CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			seq_id INTEGER NOT NULL,
			client_msg_id TEXT NOT NULL,
			sender_type TEXT NOT NULL,
			sender_id TEXT NOT NULL,
			content_type TEXT NOT NULL,
			content TEXT NOT NULL,
			reply_to_message_id TEXT,
			recalled BOOLEAN NOT NULL DEFAULT FALSE,
			edited BOOLEAN NOT NULL DEFAULT FALSE,
			edited_at DATETIME,
			created_at DATETIME
		)`,
		`CREATE UNIQUE INDEX idx_messages_session_client_msg ON messages (session_id, client_msg_id)`,
		`CREATE TABLE agent_run_events (
			id TEXT PRIMARY KEY,
			task_id TEXT NOT NULL,
			edge_run_id TEXT,
			session_id TEXT NOT NULL,
			agent_instance_id TEXT NOT NULL,
			event_seq INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			payload TEXT NOT NULL,
			created_at DATETIME
		)`,
	}
	for _, stmt := range ddl {
		require.NoError(t, db.Exec(stmt).Error)
	}

	now := time.Now()
	require.NoError(t, db.Exec(
		`INSERT INTO sessions (id, type, next_seq, dissolved, created_at) VALUES (?, ?, ?, ?, ?)`,
		"sess-1", "group", 0, false, now,
	).Error)
	require.NoError(t, db.Exec(
		`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"agent-1", "codex", "sess-1", "user-1", "Codex", now,
	).Error)
	require.NoError(t, db.Exec(
		`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, edge_run_id, edge_device_id, created_at, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-1", "agent-1", "user-1", "msg-1", model.TaskStatusRunning, "run-1", "dev-1", now, now.Add(time.Hour),
	).Error)

	return db
}

func TestHandleTaskStreamPersistsTypedRunEventAndProjection(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	bus := newTestBus(t)
	agentStream := make(chan *model.AgentRunEvent, 1)
	bus.Subscribe(ws.TypeAgentStream, func(ctx context.Context, event Event) {
		if payload, ok := event.Payload.(*model.AgentRunEvent); ok {
			agentStream <- payload
		}
	})

	svc := &AgentService{db: db, bus: bus, cacheClient: &mockAgentCache{}}
	payload := json.RawMessage(`{"type":"run.agent.tool_call","callId":"call-1","toolName":"read_file"}`)
	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		EventType:   "run.agent.tool_call",
		Payload:     payload,
		ClientMsgID: "11111111-1111-4111-8111-111111111111",
	})
	require.NoError(t, err)

	var persisted model.AgentRunEvent
	require.NoError(t, db.Where("task_id = ?", "task-1").First(&persisted).Error)
	require.Equal(t, int64(1), persisted.EventSeq)
	require.Equal(t, "run.agent.tool_call", persisted.EventType)
	require.JSONEq(t, string(payload), persisted.Payload)

	var projected model.Message
	require.NoError(t, db.Where("session_id = ? AND client_msg_id = ?", "sess-1", "11111111-1111-4111-8111-111111111111").First(&projected).Error)
	require.Equal(t, model.ContentTypeText, projected.ContentType)
	require.JSONEq(t, string(payload), projected.Content)

	select {
	case event := <-agentStream:
		require.Equal(t, persisted.TaskID, event.TaskID)
		require.Equal(t, persisted.EventType, event.EventType)
	case <-time.After(time.Second):
		t.Fatal("agent.stream event was not published")
	}
}

func TestHandleTaskStreamRejectsOversizedInferredEventType(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &AgentService{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
	tooLongEventType := "run.agent." + strings.Repeat("x", 96)
	payload := json.RawMessage(`{"type":"` + tooLongEventType + `","content":"oversized event type"}`)

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		Payload: payload,
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var count int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestHandleTaskStreamRejectsOversizedPayload(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &AgentService{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
	payload := json.RawMessage(`{"type":"run.output.batch","content":"` + strings.Repeat("x", model.RunEventPayloadMaxBytes) + `"}`)

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		Payload: payload,
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var eventCount int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Count(&eventCount).Error)
	require.Zero(t, eventCount)

	var messageCount int64
	require.NoError(t, db.Model(&model.Message{}).Count(&messageCount).Error)
	require.Zero(t, messageCount)
}

func TestHandleTaskStreamRejectsOversizedProjectedContent(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &AgentService{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		Payload: json.RawMessage(`{"type":"run.agent.tool_call","toolName":"read_file"}`),
		Content: strings.Repeat("x", model.RunEventPayloadMaxBytes),
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var eventCount int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Count(&eventCount).Error)
	require.Zero(t, eventCount)

	var messageCount int64
	require.NoError(t, db.Model(&model.Message{}).Count(&messageCount).Error)
	require.Zero(t, messageCount)
}

func TestHandleTaskStreamRejectsOversizedEdgeRunID(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &AgentService{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", strings.Repeat("x", 129), model.AgentRunEventInput{
		Payload: json.RawMessage(`{"type":"run.output.batch","content":"hello"}`),
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var eventCount int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Count(&eventCount).Error)
	require.Zero(t, eventCount)

	var messageCount int64
	require.NoError(t, db.Model(&model.Message{}).Count(&messageCount).Error)
	require.Zero(t, messageCount)
}

func TestHandleTaskStreamRejectsRunEventWhenTaskEventCapReached(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &AgentService{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
	maxRunEventsPerTask := config.MaxRunEventsPerTask

	events := make([]model.AgentRunEvent, 0, maxRunEventsPerTask)
	for seq := int64(1); seq <= maxRunEventsPerTask; seq++ {
		events = append(events, model.AgentRunEvent{
			TaskID:          "task-1",
			EdgeRunID:       "run-1",
			SessionID:       "sess-1",
			AgentInstanceID: "agent-1",
			EventSeq:        seq,
			EventType:       model.RunEventTypeOutputBatch,
			Payload:         `{"content":"previous"}`,
		})
	}
	require.NoError(t, db.CreateInBatches(events, 256).Error)

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		Payload:     json.RawMessage(`{"type":"run.output.batch","content":"overflow"}`),
		ClientMsgID: "22222222-2222-4222-8222-222222222222",
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var eventCount int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Where("task_id = ?", "task-1").Count(&eventCount).Error)
	require.Equal(t, maxRunEventsPerTask, eventCount)

	var messageCount int64
	require.NoError(t, db.Model(&model.Message{}).Where("session_id = ?", "sess-1").Count(&messageCount).Error)
	require.Zero(t, messageCount)
}

func TestHandleTaskDoneRejectsOversizedFinalContent(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &AgentService{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", "task-1", "run-1", strings.Repeat("x", model.RunEventPayloadMaxBytes+1))
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var messageCount int64
	require.NoError(t, db.Model(&model.Message{}).Count(&messageCount).Error)
	require.Zero(t, messageCount)

	var task model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", "task-1").First(&task).Error)
	require.Equal(t, model.TaskStatusRunning, task.Status)
}

func TestHandleTaskDoneRejectsOversizedEdgeRunID(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &AgentService{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", "task-1", strings.Repeat("x", 129), "final")
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var messageCount int64
	require.NoError(t, db.Model(&model.Message{}).Count(&messageCount).Error)
	require.Zero(t, messageCount)

	var task model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", "task-1").First(&task).Error)
	require.Equal(t, model.TaskStatusRunning, task.Status)
}

func TestHandleTaskFailRejectsOversizedError(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &AgentService{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", "task-1", "run-1", strings.Repeat("x", model.RunEventPayloadMaxBytes+1))
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var task model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", "task-1").First(&task).Error)
	require.Equal(t, model.TaskStatusRunning, task.Status)
	require.Empty(t, task.ErrorMessage)
}

func TestHandleTaskFailRejectsOversizedEdgeRunID(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &AgentService{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", "task-1", strings.Repeat("x", 129), "model error")
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var task model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", "task-1").First(&task).Error)
	require.Equal(t, model.TaskStatusRunning, task.Status)
	require.Empty(t, task.ErrorMessage)
}

func TestListTaskRunEventsIsOwnerScoped(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	require.NoError(t, db.Create(&model.AgentRunEvent{
		TaskID:          "task-1",
		EdgeRunID:       "run-1",
		SessionID:       "sess-1",
		AgentInstanceID: "agent-1",
		EventSeq:        1,
		EventType:       model.RunEventTypeOutputBatch,
		Payload:         `{"content":"hello"}`,
	}).Error)

	svc := &AgentService{db: db}
	events, err := svc.ListTaskRunEvents(context.Background(), "user-1", "task-1", model.AgentRunEventFilter{})
	require.NoError(t, err)
	require.Len(t, events, 1)
	require.Equal(t, model.RunEventTypeOutputBatch, events[0].EventType)

	_, err = svc.ListTaskRunEvents(context.Background(), "other-user", "task-1", model.AgentRunEventFilter{})
	require.ErrorIs(t, err, errcode.AgentTaskNotFound)
}

func TestListTaskRunEventsSupportsFilters(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	base := time.Date(2026, 5, 27, 1, 0, 0, 0, time.UTC)
	for _, event := range []model.AgentRunEvent{
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 1, EventType: model.RunEventTypeOutputBatch, Payload: `{"chunks":[{"text":"hello"}]}`, CreatedAt: base},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 2, EventType: "run.agent.tool_call", Payload: `{"toolName":"read_file"}`, CreatedAt: base.Add(time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 3, EventType: "run.agent.permission_requested", Payload: `{"requestId":"req-1","status":"pending"}`, CreatedAt: base.Add(2 * time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 4, EventType: "run.agent.file_change", Payload: `{"path":"a.txt","action":"modified"}`, CreatedAt: base.Add(3 * time.Second)},
	} {
		require.NoError(t, db.Create(&event).Error)
	}

	svc := &AgentService{db: db}
	toolEvents, err := svc.ListTaskRunEvents(context.Background(), "user-1", "task-1", model.AgentRunEventFilter{
		EventType: "run.agent.tool_call",
		AfterSeq:  1,
		Limit:     10,
	})
	require.NoError(t, err)
	require.Len(t, toolEvents, 1)
	require.Equal(t, int64(2), toolEvents[0].EventSeq)
	require.Equal(t, "run.agent.tool_call", toolEvents[0].EventType)

	limited, err := svc.ListTaskRunEvents(context.Background(), "user-1", "task-1", model.AgentRunEventFilter{
		AfterSeq: 1,
		Limit:    2,
	})
	require.NoError(t, err)
	require.Len(t, limited, 2)
	require.Equal(t, int64(2), limited[0].EventSeq)
	require.Equal(t, int64(3), limited[1].EventSeq)
}

func TestGetTaskRunEventSummaryAggregatesRuntimeHistory(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	base := time.Date(2026, 5, 27, 1, 0, 0, 0, time.UTC)
	finishedAt := base.Add(6 * time.Second)
	require.NoError(t, db.Exec(`UPDATE pending_agent_tasks SET status = ?, created_at = ?, finished_at = ? WHERE id = ?`,
		model.TaskStatusDone, base, finishedAt, "task-1").Error)
	for _, event := range []model.AgentRunEvent{
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 1, EventType: model.RunEventTypeOutputBatch, Payload: `{"chunks":[{"text":"hello\n"}]}`, CreatedAt: base.Add(time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 2, EventType: "run.agent.tool_call", Payload: `{"toolName":"read_file"}`, CreatedAt: base.Add(2 * time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 3, EventType: "run.agent.permission_requested", Payload: `{"requestId":"req-1","status":"pending"}`, CreatedAt: base.Add(3 * time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 4, EventType: "run.agent.permission_decided", Payload: `{"requestId":"req-1","decision":"allow"}`, CreatedAt: base.Add(4 * time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 5, EventType: "run.agent.file_change", Payload: `{"path":"a.txt","action":"modified"}`, CreatedAt: base.Add(5 * time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 6, EventType: "run.agent.result", Payload: `{"usage":{"input_tokens":100,"output_tokens":25},"status":"success"}`, CreatedAt: finishedAt},
	} {
		require.NoError(t, db.Create(&event).Error)
	}

	svc := &AgentService{db: db}
	summary, err := svc.GetTaskRunEventSummary(context.Background(), "user-1", "task-1")
	require.NoError(t, err)
	require.Equal(t, "task-1", summary.TaskID)
	require.Equal(t, "run-1", summary.EdgeRunID)
	require.Equal(t, model.TaskStatusDone, summary.Status)
	require.Equal(t, 6, summary.TotalEvents)
	require.Equal(t, int64(6), summary.LastEventSeq)
	require.Equal(t, 1, summary.ToolCallCount)
	require.Equal(t, 1, summary.ArtifactCount)
	require.Equal(t, 1, summary.ApprovalCount)
	require.Equal(t, 0, summary.PendingApprovals)
	require.Equal(t, 1, summary.DecidedApprovals)
	require.Equal(t, 100, summary.InputTokens)
	require.Equal(t, 25, summary.OutputTokens)
	require.Equal(t, 6, summary.OutputBytes)
	require.Equal(t, int64(6000), summary.ElapsedMs)
	require.Equal(t, 1, summary.EventTypeCounts[model.RunEventTypeOutputBatch])
	require.Equal(t, 1, summary.EventTypeCounts["run.agent.result"])
}
