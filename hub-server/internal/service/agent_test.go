package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

const (
	sqlmPendingTask   = `FROM "pending_agent_tasks" WHERE id =`
	sqlmAgentInstance = `FROM "agent_instances" WHERE id =`
	sqlmUpdateTask    = `UPDATE "pending_agent_tasks" SET`
	sqlmSeqFallback   = `UPDATE sessions SET next_seq`
)

type mockAgentCache struct {
	seq        int64
	err        error
	seqCalls   int
	seqSession string

	routeConnID     string
	routeErr        error
	pendingCalls    int
	pendingUserID   string
	pendingTaskJSON string
}

func (m *mockAgentCache) GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
	if m.routeErr != nil || m.routeConnID != "" {
		return m.routeConnID, m.routeErr
	}
	return "", errors.New("not configured")
}

func (m *mockAgentCache) PushPendingTask(ctx context.Context, userID, taskJSON string) error {
	m.pendingCalls++
	m.pendingUserID = userID
	m.pendingTaskJSON = taskJSON
	return nil
}

func (m *mockAgentCache) AllocateSeq(ctx context.Context, sessionID string) (int64, error) {
	m.seqCalls++
	m.seqSession = sessionID
	return m.seq, m.err
}

func TestHandleTaskAckPersistsEdgeRunID(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	taskID := "task-ack-1"
	edgeRunID := "run-edge-1"

	mock.ExpectQuery(sqlmPendingTask).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_instance_id", "triggered_by_user_id", "trigger_message_id", "status", "edge_run_id", "expire_at",
		}).AddRow(taskID, "agent-1", "user-1", "msg-1", model.TaskStatusDispatched, "", time.Now().Add(time.Hour)))

	mock.ExpectQuery(sqlmAgentInstance).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_type", "session_id", "inviter_user_id", "display_name", "created_at",
		}).AddRow("agent-1", "claude-code", "session-1", "user-1", "Claude", time.Now()))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := &AgentService{db: db}
	require.NoError(t, svc.HandleTaskAck(context.Background(), "user-1", "", taskID, edgeRunID))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAckRejectsWrongEdgeUser(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	taskID := "task-ack-wrong-user"

	mock.ExpectQuery(sqlmPendingTask).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_instance_id", "triggered_by_user_id", "trigger_message_id", "status", "edge_run_id", "expire_at",
		}).AddRow(taskID, "agent-1", "trigger-user", "msg-1", model.TaskStatusDispatched, "", time.Now().Add(time.Hour)))

	mock.ExpectQuery(sqlmAgentInstance).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_type", "session_id", "inviter_user_id", "display_name", "created_at",
		}).AddRow("agent-1", "claude-code", "session-1", "edge-owner", "Claude", time.Now()))

	svc := &AgentService{db: db}
	require.ErrorIs(t, svc.HandleTaskAck(context.Background(), "other-edge-user", "", taskID, "run-edge-1"), errcode.AgentTaskNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAckRejectsWrongEdgeDevice(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	taskID := "task-ack-wrong-device"

	mock.ExpectQuery(sqlmPendingTask).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_instance_id", "triggered_by_user_id", "trigger_message_id", "status", "edge_device_id", "expire_at",
		}).AddRow(taskID, "agent-1", "user-1", "msg-1", model.TaskStatusDispatched, "device-allowed", time.Now().Add(time.Hour)))

	mock.ExpectQuery(sqlmAgentInstance).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_type", "session_id", "inviter_user_id", "display_name", "created_at",
		}).AddRow("agent-1", "claude-code", "session-1", "user-1", "Claude", time.Now()))

	svc := &AgentService{db: db}
	require.ErrorIs(t, svc.HandleTaskAck(context.Background(), "user-1", "device-other", taskID, "run-edge-1"), errcode.AgentTaskNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskCallbacksRejectWrongEdgeUser(t *testing.T) {
	tests := []struct {
		name   string
		status string
		call   func(*AgentService, context.Context, string, string) error
	}{
		{
			name:   "stream",
			status: model.TaskStatusRunning,
			call: func(svc *AgentService, ctx context.Context, edgeUserID, taskID string) error {
				return svc.HandleTaskStream(ctx, edgeUserID, "", taskID, "", `{"text":"partial"}`)
			},
		},
		{
			name:   "done",
			status: model.TaskStatusRunning,
			call: func(svc *AgentService, ctx context.Context, edgeUserID, taskID string) error {
				return svc.HandleTaskDone(ctx, edgeUserID, "", taskID, "", `{"text":"final"}`)
			},
		},
		{
			name:   "fail",
			status: model.TaskStatusRunning,
			call: func(svc *AgentService, ctx context.Context, edgeUserID, taskID string) error {
				return svc.HandleTaskFail(ctx, edgeUserID, "", taskID, "", "failed")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, sqlDB := newMockDB(t)
			defer sqlDB.Close()

			taskID := "task-" + tt.name + "-wrong-user"
			mock.ExpectQuery(sqlmPendingTask).
				WithArgs(taskID, 1).
				WillReturnRows(sqlmock.NewRows([]string{
					"id", "agent_instance_id", "triggered_by_user_id", "trigger_message_id", "status", "expire_at",
				}).AddRow(taskID, "agent-1", "trigger-user", "msg-1", tt.status, time.Now().Add(time.Hour)))

			mock.ExpectQuery(sqlmAgentInstance).
				WithArgs("agent-1", 1).
				WillReturnRows(sqlmock.NewRows([]string{
					"id", "agent_type", "session_id", "inviter_user_id", "display_name", "created_at",
				}).AddRow("agent-1", "claude-code", "session-1", "edge-owner", "Claude", time.Now()))

			svc := &AgentService{db: db}
			require.ErrorIs(t, tt.call(svc, context.Background(), "other-edge-user", taskID), errcode.AgentTaskNotFound)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestHandleTaskCallbacksRejectWrongEdgeDevice(t *testing.T) {
	tests := []struct {
		name   string
		status string
		call   func(*AgentService, context.Context, string, string, string) error
	}{
		{
			name:   "stream",
			status: model.TaskStatusRunning,
			call: func(svc *AgentService, ctx context.Context, edgeUserID, edgeDeviceID, taskID string) error {
				return svc.HandleTaskStream(ctx, edgeUserID, edgeDeviceID, taskID, "run-edge-1", `{"text":"partial"}`)
			},
		},
		{
			name:   "done",
			status: model.TaskStatusRunning,
			call: func(svc *AgentService, ctx context.Context, edgeUserID, edgeDeviceID, taskID string) error {
				return svc.HandleTaskDone(ctx, edgeUserID, edgeDeviceID, taskID, "run-edge-1", `{"text":"final"}`)
			},
		},
		{
			name:   "fail",
			status: model.TaskStatusRunning,
			call: func(svc *AgentService, ctx context.Context, edgeUserID, edgeDeviceID, taskID string) error {
				return svc.HandleTaskFail(ctx, edgeUserID, edgeDeviceID, taskID, "run-edge-1", "failed")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, sqlDB := newMockDB(t)
			defer sqlDB.Close()

			taskID := "task-" + tt.name + "-wrong-device"
			mock.ExpectQuery(sqlmPendingTask).
				WithArgs(taskID, 1).
				WillReturnRows(sqlmock.NewRows([]string{
					"id", "agent_instance_id", "triggered_by_user_id", "trigger_message_id", "status", "edge_run_id", "edge_device_id", "expire_at",
				}).AddRow(taskID, "agent-1", "trigger-user", "msg-1", tt.status, "run-edge-1", "device-allowed", time.Now().Add(time.Hour)))

			mock.ExpectQuery(sqlmAgentInstance).
				WithArgs("agent-1", 1).
				WillReturnRows(sqlmock.NewRows([]string{
					"id", "agent_type", "session_id", "inviter_user_id", "display_name", "created_at",
				}).AddRow("agent-1", "claude-code", "session-1", "edge-owner", "Claude", time.Now()))

			svc := &AgentService{db: db}
			require.ErrorIs(t, tt.call(svc, context.Background(), "edge-owner", "device-other", taskID), errcode.AgentTaskNotFound)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestHandleTaskCallbacksRejectWrongEdgeRunID(t *testing.T) {
	tests := []struct {
		name   string
		status string
		call   func(*AgentService, context.Context, string, string, string) error
	}{
		{
			name:   "stream",
			status: model.TaskStatusRunning,
			call: func(svc *AgentService, ctx context.Context, edgeUserID, edgeDeviceID, taskID string) error {
				return svc.HandleTaskStream(ctx, edgeUserID, edgeDeviceID, taskID, "run-other", `{"text":"partial"}`)
			},
		},
		{
			name:   "done",
			status: model.TaskStatusRunning,
			call: func(svc *AgentService, ctx context.Context, edgeUserID, edgeDeviceID, taskID string) error {
				return svc.HandleTaskDone(ctx, edgeUserID, edgeDeviceID, taskID, "run-other", `{"text":"final"}`)
			},
		},
		{
			name:   "fail",
			status: model.TaskStatusRunning,
			call: func(svc *AgentService, ctx context.Context, edgeUserID, edgeDeviceID, taskID string) error {
				return svc.HandleTaskFail(ctx, edgeUserID, edgeDeviceID, taskID, "run-other", "failed")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, sqlDB := newMockDB(t)
			defer sqlDB.Close()

			taskID := "task-" + tt.name + "-wrong-run"
			mock.ExpectQuery(sqlmPendingTask).
				WithArgs(taskID, 1).
				WillReturnRows(sqlmock.NewRows([]string{
					"id", "agent_instance_id", "triggered_by_user_id", "trigger_message_id", "status", "edge_run_id", "edge_device_id", "expire_at",
				}).AddRow(taskID, "agent-1", "trigger-user", "msg-1", tt.status, "run-edge-1", "device-allowed", time.Now().Add(time.Hour)))

			mock.ExpectQuery(sqlmAgentInstance).
				WithArgs("agent-1", 1).
				WillReturnRows(sqlmock.NewRows([]string{
					"id", "agent_type", "session_id", "inviter_user_id", "display_name", "created_at",
				}).AddRow("agent-1", "claude-code", "session-1", "edge-owner", "Claude", time.Now()))

			svc := &AgentService{db: db}
			require.ErrorIs(t, tt.call(svc, context.Background(), "edge-owner", "device-allowed", taskID), errcode.ErrBadRequest)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestDispatchTaskQueuesWhenRouteExistsButManagerUnavailable(t *testing.T) {
	cache := &mockAgentCache{routeConnID: "conn-without-manager"}
	svc := &AgentService{cacheClient: cache}

	task := &model.PendingAgentTask{
		ID:                "task-dispatch-nil-manager",
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "claude-code",
		SessionID:     "session-1",
		InviterUserID: "user-1",
		DisplayName:   "Claude",
	}

	require.NotPanics(t, func() {
		svc.dispatchTask(context.Background(), task, agent)
	})
	require.Equal(t, 1, cache.pendingCalls)
	require.Equal(t, "user-1", cache.pendingUserID)
	require.Contains(t, cache.pendingTaskJSON, `"task_id":"task-dispatch-nil-manager"`)
}

func TestCancelTaskPublishesResolvedSessionID(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	taskID := "task-1"
	agentID := "agent-1"
	sessionID := "session-1"
	userID := "user-1"

	mock.ExpectQuery(sqlmPendingTask).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_instance_id", "triggered_by_user_id", "trigger_message_id", "status", "expire_at",
		}).AddRow(taskID, agentID, userID, "msg-1", model.TaskStatusRunning, time.Now().Add(time.Hour)))

	mock.ExpectQuery(sqlmAgentInstance).
		WithArgs(agentID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_type", "session_id", "inviter_user_id", "display_name", "created_at",
		}).AddRow(agentID, "claude-code", sessionID, userID, "Claude", time.Now()))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	bus := newTestBus(t)
	events := make(chan Event, 1)
	bus.Subscribe("agent.cancel", func(ctx context.Context, event Event) {
		events <- event
	})

	svc := &AgentService{db: db, bus: bus}
	require.NoError(t, svc.CancelTask(context.Background(), userID, taskID))

	select {
	case event := <-events:
		payload, ok := event.Payload.(map[string]string)
		require.True(t, ok, "payload type = %T", event.Payload)
		require.Equal(t, taskID, payload["task_id"])
		require.Equal(t, agentID, payload["agent_instance_id"])
		require.Equal(t, sessionID, payload["session_id"])
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for agent.cancel event")
	}

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskStreamPersistsAgentMessageWithClientMsgIDAndRedisSeq(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	taskID := "task-stream-1"
	agentID := "agent-1"
	sessionID := "session-1"
	userID := "user-1"
	payload := `{"text":"partial"}`

	mock.ExpectQuery(sqlmPendingTask).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_instance_id", "triggered_by_user_id", "trigger_message_id", "status", "expire_at",
		}).AddRow(taskID, agentID, userID, "msg-1", model.TaskStatusDispatched, time.Now().Add(time.Hour)))

	mock.ExpectQuery(sqlmAgentInstance).
		WithArgs(agentID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_type", "session_id", "inviter_user_id", "display_name", "created_at",
		}).AddRow(agentID, "claude-code", sessionID, userID, "Claude", time.Now()))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectBegin()
	mock.ExpectExec(sqlmInsertMsg).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	bus := newTestBus(t)
	events := make(chan Event, 1)
	bus.Subscribe("message.new", func(ctx context.Context, event Event) {
		events <- event
	})

	cache := &mockAgentCache{seq: 42}
	svc := &AgentService{db: db, bus: bus, cacheClient: cache}
	require.NoError(t, svc.HandleTaskStream(context.Background(), userID, "", taskID, "", payload))

	require.Equal(t, 1, cache.seqCalls)
	require.Equal(t, sessionID, cache.seqSession)

	msg := requireMessageEvent(t, events)
	require.Equal(t, sessionID, msg.SessionID)
	require.Equal(t, int64(42), msg.SeqID)
	require.NotEmpty(t, msg.ClientMsgID)
	require.Equal(t, model.SenderTypeAgent, msg.SenderType)
	require.Equal(t, agentID, msg.SenderID)
	require.Equal(t, model.ContentTypeText, msg.ContentType)
	require.Equal(t, payload, msg.Content)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskDoneUsesDBSeqFallbackAndPublishesFinalEvents(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	taskID := "task-done-1"
	agentID := "agent-1"
	sessionID := "session-1"
	userID := "user-1"
	finalContent := `{"text":"final"}`

	mock.ExpectQuery(sqlmPendingTask).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_instance_id", "triggered_by_user_id", "trigger_message_id", "status", "expire_at",
		}).AddRow(taskID, agentID, userID, "msg-1", model.TaskStatusRunning, time.Now().Add(time.Hour)))

	mock.ExpectQuery(sqlmAgentInstance).
		WithArgs(agentID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_type", "session_id", "inviter_user_id", "display_name", "created_at",
		}).AddRow(agentID, "claude-code", sessionID, userID, "Claude", time.Now()))

	mock.ExpectBegin()
	mock.ExpectQuery(sqlmSeqFallback).
		WithArgs(sessionID).
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(88))
	mock.ExpectCommit()

	mock.ExpectBegin()
	mock.ExpectExec(sqlmInsertMsg).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	bus := newTestBus(t)
	messageEvents := make(chan Event, 1)
	doneEvents := make(chan Event, 1)
	bus.Subscribe("message.new", func(ctx context.Context, event Event) {
		messageEvents <- event
	})
	bus.Subscribe("agent.done", func(ctx context.Context, event Event) {
		doneEvents <- event
	})

	cache := &mockAgentCache{err: errors.New("redis unavailable")}
	svc := &AgentService{db: db, bus: bus, cacheClient: cache}
	require.NoError(t, svc.HandleTaskDone(context.Background(), userID, "", taskID, "", finalContent))

	require.Equal(t, 1, cache.seqCalls)
	require.Equal(t, sessionID, cache.seqSession)

	msg := requireMessageEvent(t, messageEvents)
	require.Equal(t, sessionID, msg.SessionID)
	require.Equal(t, int64(88), msg.SeqID)
	require.NotEmpty(t, msg.ClientMsgID)
	require.Equal(t, model.SenderTypeAgent, msg.SenderType)
	require.Equal(t, agentID, msg.SenderID)
	require.Equal(t, finalContent, msg.Content)

	select {
	case event := <-doneEvents:
		payload, ok := event.Payload.(map[string]interface{})
		require.True(t, ok, "payload type = %T", event.Payload)
		require.Equal(t, taskID, payload["task_id"])
		require.Equal(t, agentID, payload["agent_instance_id"])
		require.Equal(t, sessionID, payload["session_id"])
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for agent.done event")
	}

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskDoneNilCacheUsesDBSeqFallback(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	taskID := "task-done-nil-cache"
	agentID := "agent-1"
	sessionID := "session-1"
	userID := "user-1"
	finalContent := `{"text":"final without redis"}`

	mock.ExpectQuery(sqlmPendingTask).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_instance_id", "triggered_by_user_id", "trigger_message_id", "status", "expire_at",
		}).AddRow(taskID, agentID, userID, "msg-1", model.TaskStatusRunning, time.Now().Add(time.Hour)))

	mock.ExpectQuery(sqlmAgentInstance).
		WithArgs(agentID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_type", "session_id", "inviter_user_id", "display_name", "created_at",
		}).AddRow(agentID, "claude-code", sessionID, userID, "Claude", time.Now()))

	mock.ExpectBegin()
	mock.ExpectQuery(sqlmSeqFallback).
		WithArgs(sessionID).
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(89))
	mock.ExpectCommit()

	mock.ExpectBegin()
	mock.ExpectExec(sqlmInsertMsg).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	bus := newTestBus(t)
	messageEvents := make(chan Event, 1)
	doneEvents := make(chan Event, 1)
	bus.Subscribe("message.new", func(ctx context.Context, event Event) {
		messageEvents <- event
	})
	bus.Subscribe("agent.done", func(ctx context.Context, event Event) {
		doneEvents <- event
	})

	svc := NewAgentService(db, bus, nil, nil)
	require.NoError(t, svc.HandleTaskDone(context.Background(), userID, "", taskID, "", finalContent))

	msg := requireMessageEvent(t, messageEvents)
	require.Equal(t, sessionID, msg.SessionID)
	require.Equal(t, int64(89), msg.SeqID)
	require.NotEmpty(t, msg.ClientMsgID)
	require.Equal(t, model.SenderTypeAgent, msg.SenderType)
	require.Equal(t, agentID, msg.SenderID)
	require.Equal(t, finalContent, msg.Content)

	select {
	case event := <-doneEvents:
		payload, ok := event.Payload.(map[string]interface{})
		require.True(t, ok, "payload type = %T", event.Payload)
		require.Equal(t, taskID, payload["task_id"])
		require.Equal(t, agentID, payload["agent_instance_id"])
		require.Equal(t, sessionID, payload["session_id"])
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for agent.done event")
	}

	require.NoError(t, mock.ExpectationsWereMet())
}

func requireMessageEvent(t *testing.T, events <-chan Event) *model.Message {
	t.Helper()
	select {
	case event := <-events:
		msg, ok := event.Payload.(*model.Message)
		require.True(t, ok, "payload type = %T", event.Payload)
		return msg
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for message.new event")
		return nil
	}
}

// ==================== B5: #116 reject agent tasks for dissolved sessions ====================

func TestTriggerAgentTask_RejectsDissolvedSession(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	triggerMsgID := "trigger-msg-dissolved"

	// GetMessageByID
	mock.ExpectQuery(`FROM "messages" WHERE id =`).
		WithArgs(triggerMsgID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "sender_type", "sender_id", "content_type", "content", "seq_id", "client_msg_id"}).
			AddRow(triggerMsgID, "session-dissolved", "user", "user-1", "text", `{"text":"hello"}`, int64(1), "client-1"))

	// GetSessionByID returns dissolved session
	mock.ExpectQuery(`FROM "sessions" WHERE id =`).
		WithArgs("session-dissolved", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("session-dissolved", "group", true, "owner-1"))

	svc := &AgentService{db: db}
	_, err := svc.TriggerAgentTask(context.Background(), "user-1", triggerMsgID)
	require.ErrorIs(t, err, errcode.SessionDissolved)
	require.NoError(t, mock.ExpectationsWereMet())
}
