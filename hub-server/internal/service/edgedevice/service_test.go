package edgedevice_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/agenthub/hub-server/internal/service/deliveryoutbox"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/agenthub/hub-server/internal/service/edgedevice"
	"github.com/agenthub/hub-server/internal/service/edgeenrollment"
	"github.com/agenthub/hub-server/internal/testkit"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type fixture struct {
	db         *gorm.DB
	enrollment *edgeenrollment.Service
	service    *edgedevice.Service
	p          *edgeenrollment.Principal
	auth       edgeenrollment.Authorizer
	agent      model.AgentInstance
	message    model.Message
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	db := testkit.NewAuthDB(t)
	require.NoError(t, db.AutoMigrate(&model.EdgeEnrollment{}, &model.EdgeDeviceCredential{}, &model.AgentInstance{}, &model.Session{}, &model.Message{}))
	// SQLite contract fixture uses DATETIME; production timestamptz and row
	// locking are exercised separately by the PostgreSQL integration tests.
	for _, ddl := range []string{
		`CREATE TABLE execution_targets (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, device_id TEXT, name TEXT NOT NULL, target_type TEXT, host TEXT, port INTEGER, workspace_root TEXT, workspace_allowlist TEXT, trust_level TEXT, health_state TEXT, auth_method TEXT, is_online BOOLEAN, last_seen_at DATETIME, capabilities TEXT, metadata TEXT, created_at DATETIME, updated_at DATETIME, deleted_at DATETIME)`,
		`CREATE TABLE execution_target_evidence (id TEXT PRIMARY KEY, target_id TEXT NOT NULL UNIQUE, source TEXT, status TEXT, failure_category TEXT, observed_target_id TEXT, route_key TEXT, observed_at DATETIME, expires_at DATETIME, created_at DATETIME, updated_at DATETIME)`,
		`CREATE TABLE pending_agent_tasks (id TEXT PRIMARY KEY, agent_instance_id TEXT NOT NULL, triggered_by_user_id TEXT NOT NULL, trigger_message_id TEXT NOT NULL, target_id TEXT, status TEXT NOT NULL, edge_run_id TEXT, edge_device_id TEXT, error_message TEXT, model_params TEXT DEFAULT '{}', created_at DATETIME, dispatched_at DATETIME, finished_at DATETIME, expire_at DATETIME NOT NULL, cancel_requested_at DATETIME, cancel_applied_at DATETIME, cancel_error TEXT NOT NULL DEFAULT '')`,
		`CREATE TABLE delivery_outbox (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, delivery_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, next_retry_at DATETIME, last_error TEXT DEFAULT '', edge_device_id TEXT, transport TEXT NOT NULL DEFAULT 'push', paired_credential_hash TEXT NOT NULL DEFAULT '', created_at DATETIME, updated_at DATETIME, delivered_at DATETIME)`,
	} {
		require.NoError(t, db.Exec(ddl).Error)
	}
	return seedFixture(t, db)
}

func seedFixture(t *testing.T, db *gorm.DB) *fixture {
	t.Helper()
	user := model.User{Username: uuid.NewString(), Nickname: "Delivery fixture"}
	require.NoError(t, db.Create(&user).Error)
	identity := model.UserIdentity{UserID: user.ID, Provider: model.IdentityProviderAccount, Issuer: "https://account.test", Subject: uuid.NewString(), Status: model.IdentityStatusActive, LinkedAt: time.Now()}
	require.NoError(t, db.Create(&identity).Error)
	require.NoError(t, db.Create(&model.OIDCSubjectEpoch{Issuer: identity.Issuer, Subject: identity.Subject}).Error)
	f := &fixture{db: db, enrollment: edgeenrollment.New(db, "hub-test-client"), auth: edgeenrollment.Authorizer{UserID: user.ID, IdentityID: identity.ID, OIDCClientID: "hub-test-client"}}
	f.p = f.pair(t, uuid.NewString())
	session := model.Session{Type: model.SessionTypeGroup, OwnerUserID: &user.ID, NextSeq: 1}
	require.NoError(t, db.Create(&session).Error)
	f.agent = model.AgentInstance{SessionID: session.ID, InviterUserID: user.ID, AgentType: "openai-sdk", DisplayName: "SDK"}
	require.NoError(t, db.Create(&f.agent).Error)
	f.message = model.Message{SessionID: session.ID, SeqID: 1, ClientMsgID: uuid.NewString(), SenderType: model.SenderTypeUser, SenderID: user.ID, ContentType: model.ContentTypeText, Content: `{"text":"first turn"}`}
	require.NoError(t, db.Create(&f.message).Error)
	f.service = edgedevice.New(db, f.enrollment)
	return f
}

func (f *fixture) pair(t *testing.T, deviceID string) *edgeenrollment.Principal {
	t.Helper()
	ctx := context.Background()
	start, err := f.enrollment.Start(ctx, edgeenrollment.StartInput{DeviceID: deviceID, Name: "Fixture SDK", RuntimeID: "openai-sdk", WorkspaceRoot: "/workspace/project"})
	require.NoError(t, err)
	_, err = f.enrollment.Confirm(ctx, f.auth, start.UserCode)
	require.NoError(t, err)
	exchange, err := f.enrollment.Exchange(ctx, start.EnrollmentID, start.PollSecret)
	require.NoError(t, err)
	p, err := f.enrollment.Authenticate(ctx, exchange.Credential)
	require.NoError(t, err)
	require.NoError(t, f.enrollment.Heartbeat(ctx, p))
	return p
}

func (f *fixture) candidate() (*model.PendingAgentTask, dispatch.Payload) {
	task := dispatch.NewQueuedPendingTask(f.agent.ID, f.auth.UserID, f.message.ID, f.p.TargetID, f.p.DeviceID, time.Now().Add(time.Hour))
	payload := dispatch.Payload{AgentInstanceID: f.agent.ID, AgentType: "openai-sdk", TriggerUserID: f.auth.UserID, TriggerMessageID: task.TriggerMessageID, TargetID: f.p.TargetID, EdgeDeviceID: f.p.DeviceID, SessionID: f.agent.SessionID, Prompt: "Second turn", ModelParams: `{"model":"fixture-model","work_dir":"/workspace/project"}`, Messages: []dispatch.Message{{Role: "user", Content: "Remember the first turn"}, {Role: "assistant", Content: "Remembered"}}}
	return task, payload
}

func (f *fixture) createTask(t *testing.T) *model.PendingAgentTask {
	t.Helper()
	task, payload := f.candidate()
	created, err := f.service.CreateTask(context.Background(), task, payload)
	require.NoError(t, err)
	return created
}

func (f *fixture) task(t *testing.T, id string) model.PendingAgentTask {
	t.Helper()
	var task model.PendingAgentTask
	require.NoError(t, f.db.Where("id = ?", id).Take(&task).Error)
	return task
}

func TestPollPreservesIdentityAndHistoryWithoutExposingGrant(t *testing.T) {
	f := newFixture(t)
	task := f.createTask(t)
	ctx := context.Background()
	first, err := f.service.Poll(ctx, f.p)
	require.NoError(t, err)
	require.Len(t, first.Deliveries, 1)
	delivery := first.Deliveries[0]
	require.Equal(t, task.ID, delivery.TaskID)
	require.Equal(t, task.ID, delivery.RunRequest.HubTaskID)
	require.Equal(t, delivery.DeliveryID, delivery.RunRequest.DeliveryID)
	require.Equal(t, "edge", delivery.RunRequest.CallbackOwner)
	require.Equal(t, "openai-sdk", delivery.RunRequest.AgentID)
	require.Equal(t, "/workspace/project", delivery.RunRequest.WorkDir)
	require.Equal(t, "hub-"+f.agent.SessionID, delivery.RunRequest.ThreadID)
	require.Len(t, delivery.RunRequest.Messages, 2)
	require.NotNil(t, delivery.RunRequest.Continue)
	require.False(t, *delivery.RunRequest.Continue)
	encoded, err := json.Marshal(first)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), f.p.CredentialHash)
	require.NotContains(t, string(encoded), "credential")
	second, err := f.service.Poll(ctx, f.p)
	require.NoError(t, err)
	require.Empty(t, second.Deliveries, "the persisted lease must suppress concurrent offers")
	require.NoError(t, f.db.Table("delivery_outbox").Where("task_id = ?", task.ID).Update("next_retry_at", time.Now().UTC().Add(-time.Second)).Error)
	replay, err := edgedevice.New(f.db, f.enrollment).Poll(ctx, f.p)
	require.NoError(t, err)
	require.Equal(t, first.Deliveries, replay.Deliveries, "restart or lost HTTP response cannot mint a new execution identity")
	require.Equal(t, model.TaskStatusDispatched, f.task(t, task.ID).Status)
}

func TestCreateTaskAndOutboxRollbackTogether(t *testing.T) {
	f := newFixture(t)
	require.NoError(t, f.db.Exec(`CREATE TRIGGER reject_delivery BEFORE INSERT ON delivery_outbox BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END`).Error)
	task, payload := f.candidate()
	_, err := f.service.CreateTask(context.Background(), task, payload)
	require.Error(t, err)
	var count int64
	require.NoError(t, f.db.Model(&model.PendingAgentTask{}).Count(&count).Error)
	require.Zero(t, count, "outbox failure must not orphan an accepted task")
}

func TestActiveTurnAndUnsupportedRuntimeRejectBeforeEnqueue(t *testing.T) {
	f := newFixture(t)
	task, payload := f.candidate()
	payload.AgentType = "codex"
	_, err := f.service.CreateTask(context.Background(), task, payload)
	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	f.createTask(t)
	task, payload = f.candidate()
	_, err = f.service.CreateTask(context.Background(), task, payload)
	require.ErrorIs(t, err, repository.ErrTurnInProgressActive)
	var count int64
	require.NoError(t, f.db.Table("delivery_outbox").Count(&count).Error)
	require.EqualValues(t, 1, count)
}

func TestPushWorkerCannotScanOrClaimPullDelivery(t *testing.T) {
	f := newFixture(t)
	task := f.createTask(t)
	store := service.NewDeliveryOutboxStore(f.db)
	ctx := context.Background()
	var row struct{ DeliveryID string }
	require.NoError(t, f.db.Table("delivery_outbox").Where("task_id = ?", task.ID).Take(&row).Error)
	old := time.Now().Add(-time.Hour)
	for _, status := range []string{"pending", "sent", "retrying"} {
		require.NoError(t, f.db.Table("delivery_outbox").Where("task_id = ?", task.ID).Updates(map[string]any{"status": status, "created_at": old, "updated_at": old, "next_retry_at": old}).Error)
		entries, err := deliveryoutbox.NewOutbox(store, nil).ScanRetryableDeliveries(ctx)
		require.NoError(t, err)
		require.Empty(t, entries)
		claimed := "retrying"
		rows, err := store.ClaimRetry(ctx, row.DeliveryID, []string{status}, 0, deliveryoutbox.Patch{Status: &claimed})
		require.NoError(t, err)
		require.Zero(t, rows, "even a stale scan cannot steal the pull lease")
	}
	_, err := deliveryoutbox.NewOutbox(store, nil).RecordDelivery(ctx, uuid.NewString(), `{}`, uuid.NewString())
	require.NoError(t, err)
	push, err := store.ScanPending(ctx, time.Now().Add(time.Second), 10)
	require.NoError(t, err)
	require.Len(t, push, 1, "legacy Desktop deliveries remain retryable")
}

func TestCancelRequiresBoundRunReceiptAndPreservesFailures(t *testing.T) {
	f := newFixture(t)
	task := f.createTask(t)
	ctx := context.Background()
	publications := 0
	f.service.SetCancelPublisher(func(_ context.Context, published *model.PendingAgentTask) error {
		publications++
		require.Equal(t, model.TaskStatusCancelled, published.Status)
		require.Equal(t, task.ID, published.ID)
		require.NotNil(t, f.task(t, task.ID).CancelAppliedAt, "event must follow commit")
		return nil
	})
	require.NoError(t, f.db.Model(task).Updates(map[string]any{"status": "running", "edge_run_id": "original-run"}).Error)
	require.ErrorIs(t, f.service.RequestCancel(ctx, uuid.NewString(), task.ID), errcode.AgentTaskNotFound)
	require.NoError(t, f.service.RequestCancel(ctx, f.auth.UserID, task.ID))
	require.NoError(t, f.service.RequestCancel(ctx, f.auth.UserID, task.ID))
	stored := f.task(t, task.ID)
	require.Equal(t, model.TaskStatusRunning, stored.Status)
	require.NotNil(t, stored.CancelRequestedAt)
	require.Nil(t, stored.CancelAppliedAt)
	require.Zero(t, publications)
	poll, err := f.service.Poll(ctx, f.p)
	require.NoError(t, err)
	require.Empty(t, poll.Deliveries)
	require.Equal(t, []edgedevice.Control{{ControlID: task.ID, TaskID: task.ID, RunID: "original-run", Kind: "cancel"}}, poll.Controls)
	require.ErrorIs(t, f.service.AckControl(ctx, f.p, task.ID, edgedevice.ControlAck{TaskID: task.ID, RunID: "wrong-run", Status: "applied"}), errcode.ErrBadRequest)
	require.NoError(t, f.service.AckControl(ctx, f.p, task.ID, edgedevice.ControlAck{TaskID: task.ID, RunID: "original-run", Status: "failed", Error: "fixture raw secret must not escape"}))
	stored = f.task(t, task.ID)
	require.Equal(t, model.TaskStatusRunning, stored.Status)
	require.NotEmpty(t, stored.CancelError)
	require.NotContains(t, stored.CancelError, "secret")
	require.Zero(t, publications)
	ack := edgedevice.ControlAck{TaskID: task.ID, RunID: "original-run", Status: "applied"}
	require.NoError(t, f.service.AckControl(ctx, f.p, task.ID, ack))
	require.NoError(t, f.service.AckControl(ctx, f.p, task.ID, ack))
	require.ErrorIs(t, f.service.AckControl(ctx, f.p, task.ID, edgedevice.ControlAck{TaskID: task.ID, RunID: "original-run", Status: "failed"}), errcode.ErrBadRequest)
	stored = f.task(t, task.ID)
	require.Equal(t, model.TaskStatusCancelled, stored.Status)
	require.NotNil(t, stored.CancelAppliedAt)
	require.Empty(t, stored.CancelError)
	require.Equal(t, 1, publications)
	final, err := f.service.Poll(ctx, f.p)
	require.NoError(t, err)
	require.Empty(t, final.Deliveries)
	require.Empty(t, final.Controls)
}

func TestCompletedResultWinsLateCancellationReceipt(t *testing.T) {
	f := newFixture(t)
	task := f.createTask(t)
	ctx := context.Background()
	require.NoError(t, f.db.Model(task).Update("edge_run_id", "run").Error)
	require.NoError(t, f.service.RequestCancel(ctx, f.auth.UserID, task.ID))
	require.NoError(t, f.db.Model(task).Update("status", "done").Error)
	require.NoError(t, f.service.AckControl(ctx, f.p, task.ID, edgedevice.ControlAck{TaskID: task.ID, RunID: "run", Status: "applied"}))
	require.Equal(t, model.TaskStatusDone, f.task(t, task.ID).Status)
}

func TestOwnerDeviceTargetAndGrantAreAllRequired(t *testing.T) {
	f := newFixture(t)
	task := f.createTask(t)
	ctx := context.Background()
	require.NoError(t, f.service.AuthorizeTask(ctx, f.p, task.ID))
	otherDevice := f.pair(t, uuid.NewString())
	require.ErrorIs(t, f.service.AuthorizeTask(ctx, otherDevice, task.ID), errcode.AgentTaskNotFound)
	otherPoll, err := f.service.Poll(ctx, otherDevice)
	require.NoError(t, err)
	require.Empty(t, otherPoll.Deliveries)
	for _, field := range []string{"target_id", "triggered_by_user_id", "edge_device_id"} {
		original := map[string]string{"target_id": f.p.TargetID, "triggered_by_user_id": f.p.UserID, "edge_device_id": f.p.DeviceID}[field]
		require.NoError(t, f.db.Model(task).Update(field, uuid.NewString()).Error)
		require.ErrorIs(t, f.service.AuthorizeTask(ctx, f.p, task.ID), errcode.AgentTaskNotFound)
		require.NoError(t, f.db.Model(task).Update(field, original).Error)
	}
	// Re-pairing grants device access, not permission to execute old tasks.
	replacement := f.pair(t, f.p.DeviceID)
	require.ErrorIs(t, f.service.AuthorizeTask(ctx, f.p, task.ID), errcode.AuthInvalidToken)
	require.ErrorIs(t, f.service.AuthorizeTask(ctx, replacement, task.ID), errcode.AgentTaskNotFound)
	replay, err := f.service.Poll(ctx, replacement)
	require.NoError(t, err)
	require.Empty(t, replay.Deliveries)
	require.NoError(t, f.service.RequestCancel(ctx, f.auth.UserID, task.ID))
	require.NoError(t, f.enrollment.Revoke(ctx, f.auth.UserID, replacement.DeviceID))
	_, err = f.service.Poll(ctx, replacement)
	require.ErrorIs(t, err, errcode.AuthInvalidToken)
	require.ErrorIs(t, f.service.AckControl(ctx, replacement, task.ID, edgedevice.ControlAck{TaskID: task.ID, Status: "applied"}), errcode.AuthInvalidToken)
	paired, err := f.service.IsPairedDevice(ctx, replacement.DeviceID)
	require.NoError(t, err)
	require.True(t, paired, "revocation must not enable legacy delivery fallback")
	require.Nil(t, f.task(t, task.ID).CancelAppliedAt)
}

func TestPairedModelContractRejectsExecutionOverrides(t *testing.T) {
	p := &edgeenrollment.Principal{RuntimeID: "openai-sdk", WorkspaceRoot: "/workspace/project", DeviceID: uuid.NewString()}
	for _, raw := range []string{`null`, `[]`, `{"workDir":"/other"}`, `{"agentId":"codex"}`, `{"allowedTools":["shell"]}`, `{"permissionMode":"bypass"}`, `{"sessionId":"other"}`, `{"continue":true}`, `{"configOverrides":{"key":"secret"}}`, `{"fork":false}`, `{"model":42}`} {
		t.Run(raw, func(t *testing.T) {
			_, err := edgedevice.BuildRunRequest(p, dispatch.Payload{AgentType: "openai-sdk", SessionID: "session", ModelParams: raw})
			require.Error(t, err)
		})
	}
	_, err := edgedevice.BuildRunRequest(p, dispatch.Payload{AgentType: "openai-sdk", SessionID: "session", ToolWhitelist: `["Read"]`})
	require.Error(t, err)
}
