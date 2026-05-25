package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func newMockDBAgent(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, *sql.DB) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(
		sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(
			func(expectedSQL, actualSQL string) error {
				if strings.Contains(actualSQL, expectedSQL) {
					return nil
				}
				return fmt.Errorf("expected SQL to contain %q, but got %q", expectedSQL, actualSQL)
			},
		)),
	)
	require.NoError(t, err)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		SkipDefaultTransaction: true,
		PrepareStmt:            false,
	})
	require.NoError(t, err)
	return gormDB, mock, sqlDB
}

const (
	sqlmTaskByID    = `FROM "pending_agent_tasks" WHERE id =`
	sqlmAgentByID   = `FROM "agent_instances" WHERE id =`
	sqlmUpdateTask  = `UPDATE "pending_agent_tasks" SET`
)

// ==================== CancelTask ====================

func TestCancelTask_AtomicFailClosed(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	bus := newTestBus(t)
	svc := &AgentService{db: db, bus: bus}

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

	bus := newTestBus(t)
	svc := &AgentService{db: db, bus: bus}

	taskID := "task-done"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDone))

	err := svc.CancelTask(context.Background(), "user-1", taskID)
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== HandleTaskAck ====================

func TestHandleTaskAck_DispatchedToRunningAtomic(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-ack"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDispatched, "", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-001")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_AlreadyRunningIdempotent(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-already-running"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "", "run-001"))

	// Already running with edgeRunID set → idempotent, no DB update needed.
	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-001")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_EdgeRunIDBackfill(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-backfill"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(`UPDATE "pending_agent_tasks" SET "edge_run_id"`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-002")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== HandleTaskDone ====================

func TestHandleTaskDone_AtomicTransition(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	bus := newTestBus(t)
	svc := &AgentService{db: db, bus: bus}

	taskID := "task-done-atomic"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== HandleTaskFail ====================

func TestHandleTaskFail_AtomicTransition(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	bus := newTestBus(t)
	svc := &AgentService{db: db, bus: bus}

	taskID := "task-fail-atomic"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", taskID, "run-001", "model error")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskFail_AlreadyTerminal(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-already-done"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDone, "dev-1", "run-001"))

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", taskID, "run-001", "error")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
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
