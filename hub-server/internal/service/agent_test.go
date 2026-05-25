package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

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
}

func (m *mockAgentCache) GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
	return "", errors.New("not configured")
}

func (m *mockAgentCache) PushPendingTask(ctx context.Context, userID, taskJSON string) error {
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

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := &AgentService{db: db}
	require.NoError(t, svc.HandleTaskAck(context.Background(), taskID, edgeRunID))
	require.NoError(t, mock.ExpectationsWereMet())
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

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery(sqlmAgentInstance).
		WithArgs(agentID, 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "agent_type", "session_id", "inviter_user_id", "display_name", "created_at",
		}).AddRow(agentID, "claude-code", sessionID, userID, "Claude", time.Now()))

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
	require.NoError(t, svc.HandleTaskStream(context.Background(), taskID, payload))

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
	require.NoError(t, svc.HandleTaskDone(context.Background(), taskID, finalContent))

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
