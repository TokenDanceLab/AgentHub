// CancelTask atomicity tests. Mirrors agent_dispatch_facade.go (CancelTask).

package agent

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"

	"github.com/agenthub/hub-server/internal/model"
)

func TestCancelTask_AtomicFailClosed(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &Service{db: db, bus: b}

	taskID := "task-cancel-atomic"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.CancelTask(context.Background(), "user-1", taskID)
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestCancelTask_AlreadyTerminal(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &Service{db: db, bus: b}

	taskID := "task-done"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDone))

	err := svc.CancelTask(context.Background(), "user-1", taskID)
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}
