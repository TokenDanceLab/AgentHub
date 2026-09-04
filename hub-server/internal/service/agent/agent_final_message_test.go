// HandleTaskDone final-message dedup/insert tests: shouldSkipDoneFinalInsert,
// canonicalContent, unwrapMessageContentText, and the duplicate/distinct
// insert paths. Mirrors agent_edge_callback.go.

package agent

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
)

func TestShouldSkipDoneFinalInsert_IdenticalLatestAgentMessage(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}).
			AddRow("msg-9", "sess-1", int64(9), "cmid-9", model.SenderTypeAgent, "agent-1", "text", `{"content":"ANSWER"}`))

	got := shouldSkipDoneFinalInsert(db, "sess-1", "agent-1", "ANSWER")
	assert.True(t, got)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestShouldSkipDoneFinalInsert_PartialStreamDoesNotSuppress(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}).
			AddRow("msg-9", "sess-1", int64(9), "cmid-9", model.SenderTypeAgent, "agent-1", "text", `{"content":"PARTIAL"}`))

	got := shouldSkipDoneFinalInsert(db, "sess-1", "agent-1", "PARTIAL ANSWER")
	assert.False(t, got)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestShouldSkipDoneFinalInsert_UserMessageAfterAgentDoesNotSuppress(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}).
			AddRow("msg-9", "sess-1", int64(9), "cmid-9", model.SenderTypeUser, "user-1", "text", `{"text":"follow-up"}`))

	got := shouldSkipDoneFinalInsert(db, "sess-1", "agent-1", "follow-up")
	assert.False(t, got)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestShouldSkipDoneFinalInsert_NoMessages(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}))

	got := shouldSkipDoneFinalInsert(db, "sess-1", "agent-1", "ANSWER")
	assert.False(t, got)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestShouldSkipDoneFinalInsert_EmptyFinalContent(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	// Empty final content short-circuits before any DB read.
	got := shouldSkipDoneFinalInsert(db, "sess-1", "agent-1", "")
	assert.False(t, got)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestUnwrapMessageContentText(t *testing.T) {
	assert.Equal(t, "plain answer", unwrapMessageContentText(`{"content":"plain answer"}`))
	assert.Equal(t, `{"text":"user text"}`, unwrapMessageContentText(`{"text":"user text"}`))
	assert.Equal(t, "not json at all", unwrapMessageContentText("not json at all"))
	assert.Equal(t, `{"content":""}`, unwrapMessageContentText(`{"content":""}`))
}

func TestHandleTaskDone_SkipsDuplicateFinalMessage(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &Service{db: db, bus: b}

	taskID := "task-done-dedup"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	// Latest agent message already carries the exact final text (stream path).
	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}).
			AddRow("msg-9", "sess-1", int64(9), "cmid-9", model.SenderTypeAgent, "agent-1", "text", `{"content":"FINAL ANSWER"}`))

	// Transaction must contain only the status update — no message insert.
	mock.ExpectBegin()
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "FINAL ANSWER")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskDone_InsertsDistinctFinalMessage(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &Service{db: db, bus: b}

	taskID := "task-done-distinct"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	// Latest agent message differs from the final content → insert proceeds.
	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}).
			AddRow("msg-9", "sess-1", int64(9), "cmid-9", model.SenderTypeAgent, "agent-1", "text", `{"content":"partial"}`))

	// Message insert requires a seq allocation; Redis is absent so the
	// allocator falls back to the DB sequence bump in its own transaction.
	mock.ExpectBegin()
	mock.ExpectQuery(`UPDATE sessions SET next_seq`).
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(10))
	mock.ExpectCommit()

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO "messages"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "FINAL ANSWER")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// #1414: jsonb re-serialization (whitespace/key order) must not defeat the
// done-final dedup for JSON-shaped stream content.
func TestShouldSkipDoneFinalInsert_JSONCanonicalMatch(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}).
			AddRow("msg-9", "sess-1", int64(9), "cmid-9", model.SenderTypeAgent, "agent-1", "text", `{"summary":"42","action":"finish"}`))

	got := shouldSkipDoneFinalInsert(db, "sess-1", "agent-1", `{"action":"finish","summary":"42"}`)
	assert.True(t, got)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestCanonicalContent(t *testing.T) {
	assert.Equal(t, `{"action":"finish","summary":"42"}`, canonicalContent(`{"summary":"42",  "action": "finish"}`))
	assert.Equal(t, "plain text", canonicalContent("plain text"))
	// The projection wrapper {"content": X} unwraps to X.
	assert.Equal(t, "x", canonicalContent(`{"content":"x"}`))
}

// #2274 B-1: the done-final message must carry the producing task ref, exactly
// like the stream projection path — the transcript needs `agent_task.task_id`
// to offer an honest regenerate (the endpoint only accepts task ids).
func TestHandleTaskDone_StampsProducingTaskRefOnFinalMessage(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	b := newTestBus(t)
	svc := &Service{db: db, bus: b, cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", "task-1", "run-1", "FINAL ANSWER")
	require.NoError(t, err)

	var msg model.Message
	require.NoError(t, db.Where("session_id = ? AND sender_type = ?", "sess-1", model.SenderTypeAgent).
		Order("seq_id DESC").First(&msg).Error)

	var content struct {
		Content   string `json:"content"`
		AgentTask *struct {
			TaskID string `json:"task_id"`
		} `json:"agent_task"`
	}
	require.NoError(t, json.Unmarshal([]byte(msg.Content), &content))
	require.Equal(t, "FINAL ANSWER", content.Content, "visible text must survive the stamp")
	require.NotNil(t, content.AgentTask, "done-final message must carry the producing task ref")
	require.Equal(t, "task-1", content.AgentTask.TaskID)
}
