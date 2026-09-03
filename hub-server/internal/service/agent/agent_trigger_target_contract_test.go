// TriggerAgentTask target-contract tests: ownership, bound device, local
// edge, health evidence, and per-instance TurnInProgress gate. Mirrors
// agent_dispatch_facade.go (TriggerAgentTask).

package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

func TestTriggerAgentTask_RejectsDissolvedSession(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
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

	svc := &Service{db: db}
	_, err := svc.TriggerAgentTask(context.Background(), "user-1", triggerMsgID, "", "", "", "", "")
	require.ErrorIs(t, err, errcode.SessionDissolved)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestTriggerAgentTask_MemberActiveLookupErrorSurfaces pins the honest error
// path for the membership gate: a session_members lookup failure must surface
// as an error to the caller instead of being misread as "not a member"
// (previously `active, _ :=` collapsed DB faults into SessionNotMember).
func TestTriggerAgentTask_MemberActiveLookupErrorSurfaces(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	triggerMsgID := "trigger-msg-member-err"
	memberCheckErr := fmt.Errorf("session_members lookup failed")

	// GetMessageByID
	mock.ExpectQuery(`FROM "messages" WHERE id =`).
		WithArgs(triggerMsgID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "sender_type", "sender_id", "content_type", "content", "seq_id", "client_msg_id"}).
			AddRow(triggerMsgID, "session-live", "user", "user-1", "text", `{"text":"hello"}`, int64(1), "client-1"))

	// GetSessionByID returns a live group session
	mock.ExpectQuery(`FROM "sessions" WHERE id =`).
		WithArgs("session-live", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("session-live", "group", false, "owner-1"))

	// ListAgentInstancesByInviter returns one agent so selection succeeds
	mock.ExpectQuery(`FROM "agent_instances" WHERE session_id =`).
		WithArgs("session-live", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id", "display_name"}).
			AddRow("agent-1", "claude-code", "session-live", "user-1", "Agent One"))

	// IsMemberActive fails at the DB layer
	mock.ExpectQuery(`FROM "session_members" WHERE session_id =`).
		WithArgs("session-live", "user", "user-1").
		WillReturnError(memberCheckErr)

	svc := &Service{db: db}
	_, err := svc.TriggerAgentTask(context.Background(), "user-1", triggerMsgID, "", "", "", "", "")
	require.ErrorIs(t, err, memberCheckErr)
	require.NotErrorIs(t, err, errcode.SessionNotMember)
	// No further queries: the task must not be created after a failed member check.
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestTriggerAgentTaskRejectsTargetOwnedByAnotherUser(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	svc := &Service{db: db, cacheClient: &mockAgentCache{}}

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-other")

	require.ErrorIs(t, err, errcode.TargetNotFound)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(0), count)
}

func TestTriggerAgentTaskRejectsTargetWithoutBoundDevice(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, name, target_type, workspace_allowlist, trust_level, health_state, is_online, last_seen_at, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-no-device", "user-1", "Local workstation", "local_edge", `["/workspace"]`, "local", "online", true, time.Now(), "{}", "{}").Error)
	svc := &Service{db: db, cacheClient: &mockAgentCache{}}

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-no-device")

	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(0), count)
}

func TestTriggerAgentTaskRejectsNonLocalEdgeTarget(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO devices (id, user_id, device_type, app_version, capabilities, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"dev-remote", "user-1", "desktop", "0.1.0", "[]", "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, device_id, name, target_type, workspace_allowlist, trust_level, health_state, is_online, last_seen_at, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-remote", "user-1", "dev-remote", "Remote SSH target", "remote_ssh", `["/workspace"]`, "remote", "online", true, time.Now(), "{}", "{}").Error)
	svc := &Service{db: db, cacheClient: &mockAgentCache{}}

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-remote")

	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(0), count)
}

func TestTriggerAgentTaskStoresAndDispatchesOwnedTarget(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO devices (id, user_id, device_type, app_version, capabilities, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"dev-target", "user-1", "desktop", "0.1.0", "[]", "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, device_id, name, target_type, workspace_allowlist, trust_level, health_state, is_online, last_seen_at, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-local", "user-1", "dev-target", "Local workstation", "local_edge", `["/workspace"]`, "local", "online", true, time.Now(), "{}", "{}").Error)
	seedEvidenceForTarget(t, db, "target-local", "online", -time.Minute, dispatch.DesktopTargetStaleAfter)
	cache := &mockAgentCache{}
	svc := &Service{db: db, cacheClient: cache}

	task, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-local")

	require.NoError(t, err)
	require.Equal(t, "target-local", task.TargetID)
	require.Equal(t, "dev-target", task.EdgeDeviceID)
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, "target-local", stored.TargetID)
	require.Equal(t, "dev-target", stored.EdgeDeviceID)
	require.Eventually(t, func() bool {
		return len(cache.snapshot().pushedTarget) == 1
	}, time.Second, 10*time.Millisecond)
	snapshot := cache.snapshot()
	var payload dispatch.Payload
	require.NoError(t, json.Unmarshal([]byte(snapshot.pushedTarget[0]), &payload))
	require.Equal(t, "target-local", payload.TargetID)
	require.Equal(t, "dev-target", payload.EdgeDeviceID)
}

func TestTriggerAgentTaskPrebindsOwnedTargetDevice(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO devices (id, user_id, device_type, app_version, capabilities, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"dev-local", "user-1", "desktop", "0.1.0", "[]", "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, device_id, name, target_type, workspace_allowlist, trust_level, health_state, is_online, last_seen_at, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-local-device", "user-1", "dev-local", "Local workstation", "local_edge", `["/workspace"]`, "local", "online", true, time.Now(), "{}", "{}").Error)
	seedEvidenceForTarget(t, db, "target-local-device", "online", -time.Minute, dispatch.DesktopTargetStaleAfter)
	cache := &mockAgentCache{}
	svc := &Service{db: db, cacheClient: cache}

	task, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-local-device")

	require.NoError(t, err)
	require.Equal(t, "target-local-device", task.TargetID)
	require.Equal(t, "dev-local", task.EdgeDeviceID)
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, "dev-local", stored.EdgeDeviceID)
}

func TestTriggerAgentTaskRejectsStaleTargetHealth(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO devices (id, user_id, device_type, app_version, capabilities, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"dev-stale", "user-1", "desktop", "0.1.0", "[]", "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, device_id, name, target_type, workspace_allowlist, trust_level, health_state, is_online, last_seen_at, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-stale", "user-1", "dev-stale", "Stale workstation", "local_edge", `["/workspace"]`, "local", "online", true, time.Now().Add(-dispatch.DesktopTargetStaleAfter-time.Second), "{}", "{}").Error)
	// 证据窗口已过期 → 投影 stale → 调度拒绝。
	seedEvidenceForTarget(t, db, "target-stale", "online", -3*time.Minute, -time.Minute)
	svc := &Service{db: db, cacheClient: &mockAgentCache{}}

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-stale")

	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(0), count)
}

func TestTriggerAgentTaskRejectsMismatchTargetHealth(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO devices (id, user_id, device_type, app_version, capabilities, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"dev-mismatch", "user-1", "desktop", "0.1.0", "[]", "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, device_id, name, target_type, workspace_allowlist, trust_level, health_state, is_online, last_seen_at, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-mismatch", "user-1", "dev-mismatch", "Mismatched workstation", "local_edge", `["/workspace"]`, "local", "mismatch", false, time.Now(), "{}", "{}").Error)
	// observed identity mismatch 证据 → 投影 mismatch → 调度拒绝。
	seedEvidenceForTarget(t, db, "target-mismatch", "mismatch", -time.Minute, dispatch.DesktopTargetStaleAfter)
	svc := &Service{db: db, cacheClient: &mockAgentCache{}}

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-mismatch")

	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(0), count)
}

// seedEvidenceForTarget seeds a health evidence row for dispatch-contract
// tests (#1544): health validation reads evidence, not the legacy columns.
func seedEvidenceForTarget(t *testing.T, db *gorm.DB, targetID, status string, observedAgo, expiresIn time.Duration) {
	t.Helper()
	observed := time.Now().Add(observedAgo)
	expires := time.Now().Add(expiresIn)
	require.NoError(t, db.Exec(`INSERT INTO execution_target_evidence (id, target_id, source, status, observed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"ev-"+targetID, targetID, "registration", status, observed, expires).Error)
}

// TestTriggerAgentTaskTurnInProgressRejectsActiveTask seeds an active (queued)
// task for agent-1 and verifies a second trigger for the same agent_instance is
// rejected with errcode.TurnInProgress (HTTP 409). The already-persisted
// trigger message is not rolled back (SendMessage is independent — IM model).
func TestTriggerAgentTaskTurnInProgressRejectsActiveTask(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	cache := &mockAgentCache{}
	svc := &Service{db: db, cacheClient: cache}

	// Pre-seed an active queued task so the gate fires without spawning a
	// dispatch goroutine for the first task.
	activeTask := &model.PendingAgentTask{
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-active",
		Status:            model.TaskStatusQueued,
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(activeTask).Error)

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "agent-1", "", "", "", "")

	require.ErrorIs(t, err, errcode.TurnInProgress)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Where("agent_instance_id = ?", "agent-1").Count(&count).Error)
	require.Equal(t, int64(1), count, "second trigger must not create a duplicate task")
}

// TestTriggerAgentTaskTurnInProgressDifferentAgentInstanceNotBlocked verifies
// that the gate is per agent_instance: an active task for agent-1 must not
// block a trigger for agent-2 in the same session.
func TestTriggerAgentTaskTurnInProgressDifferentAgentInstanceNotBlocked(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name) VALUES (?, ?, ?, ?, ?)`,
		"agent-2", "claude-code", "sess-1", "user-1", "Claude").Error)
	cache := &mockAgentCache{}
	svc := &Service{db: db, cacheClient: cache}

	activeTask := &model.PendingAgentTask{
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-active",
		Status:            model.TaskStatusQueued,
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(activeTask).Error)

	task, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "agent-2", "", "", "", "")

	require.NoError(t, err)
	require.Equal(t, "agent-2", task.AgentInstanceID)
	require.NotEqual(t, activeTask.ID, task.ID)

	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(2), count, "agent-1 active + agent-2 new task")
}

// TestTriggerAgentTaskTurnInProgressTerminalTaskDoesNotBlock verifies that a
// terminal (done) task does not block a new trigger for the same agent_instance.
func TestTriggerAgentTaskTurnInProgressTerminalTaskDoesNotBlock(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	cache := &mockAgentCache{}
	svc := &Service{db: db, cacheClient: cache}

	doneTask := &model.PendingAgentTask{
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-done",
		Status:            model.TaskStatusDone,
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(doneTask).Error)

	task, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "agent-1", "", "", "", "")

	require.NoError(t, err)
	require.NotEqual(t, doneTask.ID, task.ID)
}
