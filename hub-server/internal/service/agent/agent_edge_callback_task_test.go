// Edge callback task-lifecycle tests: HandleTaskAck/Done/Fail/Stream atomic
// transitions, queued/offline replays, edge-run-id backfill and conflict
// handling. Mirrors agent_edge_callback.go.

package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/ws"
)

func TestHandleTaskAck_DispatchedToRunningAtomic(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &Service{db: db}

	taskID := "task-ack"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDispatched, "dev-1", ""))

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

	svc := &Service{db: db}

	taskID := "task-already-running"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	// Already running with edgeRunID set → idempotent, no DB update needed.
	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-001")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_OfflineQueuedUnboundDeviceClaim(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &Service{db: db}

	taskID := "task-offline-unbound"
	// #99 offline-replay task: queued, no edge device binding yet.
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued, "", ""))

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

func TestHandleTaskAck_OfflineQueuedUnboundRejectsWrongUser(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &Service{db: db}

	taskID := "taskx-offline-wrong-user"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued, "", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	err := svc.HandleTaskAck(context.Background(), "user-2", "dev-1", taskID, "run-001")
	require.Error(t, err)
	var taskErr *errcode.Error
	require.True(t, errors.As(err, &taskErr))
	require.Equal(t, errcode.AgentTaskNotFound.Code, taskErr.Code)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_EdgeRunIDBackfill(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &Service{db: db}

	taskID := "task-backfill"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", ""))

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

func TestHandleTaskAck_EdgeRunIDBackfillConflictAcceptsSameRunID(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &Service{db: db}

	taskID := "task-backfill-same-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(`UPDATE "pending_agent_tasks" SET "edge_run_id"`).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-002"))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-002")
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_EdgeRunIDBackfillConflictRejectsMismatch(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &Service{db: db}

	taskID := "task-backfill-mismatch-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(`UPDATE "pending_agent_tasks" SET "edge_run_id"`).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-other"))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-002")
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAckRejectsOversizedEdgeRunID(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &Service{db: db}

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", "task-ack", strings.Repeat("x", 129))
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskStream_DispatchedTransitionConflictDoesNotPersist(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	streamEvents := make(chan bus.Event, 1)
	b.Subscribe(ws.TypeAgentStream, func(ctx context.Context, event bus.Event) {
		streamEvents <- event
	})
	svc := &Service{db: db, bus: b, cacheClient: &mockAgentCache{}}

	taskID := "task-stream-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDispatched, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "codex", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDone, "dev-1", "run-001"))

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", taskID, "run-001", model.AgentRunEventInput{
		Payload: json.RawMessage(`{"type":"run.output.batch","content":"hello"}`),
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	select {
	case <-streamEvents:
		t.Fatal("agent.stream was published after dispatched transition conflict")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskDone_AtomicTransition(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &Service{db: db, bus: b}

	taskID := "task-done-atomic"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectBegin()
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskDone_AtomicConflictDoesNotPublish(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	doneEvents := make(chan bus.Event, 1)
	b.Subscribe("agent.done", func(ctx context.Context, event bus.Event) {
		doneEvents <- event
	})
	svc := &Service{db: db, bus: b}

	taskID := "task-done-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectBegin()
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "")
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	select {
	case <-doneEvents:
		t.Fatal("agent.done was published after atomic update conflict")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskFail_AtomicTransition(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &Service{db: db, bus: b}

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

func TestHandleTaskFail_AtomicConflictDoesNotPublish(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	failedEvents := make(chan bus.Event, 1)
	b.Subscribe("agent.failed", func(ctx context.Context, event bus.Event) {
		failedEvents <- event
	})
	svc := &Service{db: db, bus: b}

	taskID := "task-fail-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 0))

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", taskID, "run-001", "model error")
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	select {
	case <-failedEvents:
		t.Fatal("agent.failed was published after atomic update conflict")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskFail_AlreadyTerminal(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &Service{db: db}

	taskID := "task-already-done"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDone, "dev-1", "run-001"))

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", taskID, "run-001", "error")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskDone_RejectsQueuedTask(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &Service{db: db}

	taskID := "task-queued"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued, "dev-1", "run-001"))

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "final")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskFail_RejectsQueuedTask(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &Service{db: db}

	taskID := "task-queued-fail"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued, "dev-1", "run-001"))

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", taskID, "run-001", "error")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskDone_AcceptsDispatchedTask(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &Service{db: db, bus: b}

	taskID := "task-dispatched-done"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDispatched, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectBegin()
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_QueuedToRunning(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &Service{db: db}

	taskID := "task-queued-ack"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued, "dev-1", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	// queued → running (offline-replayed task)
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-001")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_QueuedOfflineReplayTransitionsToRunning(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	task := &model.PendingAgentTask{
		ID:                "task-queued-ack-real",
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		Status:            model.TaskStatusQueued,
		EdgeDeviceID:      "dev-1",
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(task).Error)
	svc := &Service{db: db}

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", task.ID, "run-queued")

	require.NoError(t, err)
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, model.TaskStatusRunning, stored.Status)
	require.Equal(t, "run-queued", stored.EdgeRunID)
}
