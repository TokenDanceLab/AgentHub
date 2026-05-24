package service

import (
	"context"
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
)

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
