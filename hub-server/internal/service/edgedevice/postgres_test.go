//go:build integration

package edgedevice_test

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/agent"
	"github.com/agenthub/hub-server/internal/service/edgedevice"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

func postgresFixture(t *testing.T) *fixture {
	t.Helper()
	require.NotEmpty(t, os.Getenv("AGENTHUB_DB_PASSWORD"), "integration requires an explicit fixture password")
	cfg, err := config.Load("../../../configs/config.yaml")
	require.NoError(t, err)
	adminCfg := cfg.DB
	adminCfg.Name = "postgres"
	admin, err := gorm.Open(postgres.Open(adminCfg.DSN()), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	adminSQL, err := admin.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, adminSQL.Close()) })
	name := "edge_delivery_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	require.NoError(t, admin.Exec("CREATE DATABASE "+name).Error)
	t.Cleanup(func() { require.NoError(t, admin.Exec("DROP DATABASE "+name).Error) })
	cfg.DB.Name = name
	db, err := gorm.Open(postgres.Open(cfg.DB.DSN()), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(16)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	require.NoError(t, repository.RunMigrations(&cfg.DB))
	return seedFixture(t, db)
}

func TestPostgresConcurrentTriggerAndPollHaveOneWinner(t *testing.T) {
	f := postgresFixture(t)
	ctx := context.Background()
	const workers = 12
	var winners atomic.Int32
	var wg sync.WaitGroup
	start := make(chan struct{})
	errCh := make(chan error, workers)
	for range workers {
		wg.Go(func() {
			<-start
			task, payload := f.candidate()
			_, err := f.service.CreateTask(ctx, task, payload)
			if err == nil {
				winners.Add(1)
			} else {
				errCh <- err
			}
		})
	}
	close(start)
	wg.Wait()
	close(errCh)
	require.EqualValues(t, 1, winners.Load())
	for err := range errCh {
		require.ErrorIs(t, err, repository.ErrTurnInProgressActive)
	}
	var count int64
	require.NoError(t, f.db.Table("delivery_outbox").Count(&count).Error)
	require.EqualValues(t, 1, count)
	winners.Store(0)
	start = make(chan struct{})
	errCh = make(chan error, workers)
	for range workers {
		wg.Go(func() {
			<-start
			poll, err := f.service.Poll(ctx, f.p)
			if err != nil {
				errCh <- err
				return
			}
			winners.Add(int32(len(poll.Deliveries)))
		})
	}
	close(start)
	wg.Wait()
	close(errCh)
	for err := range errCh {
		require.NoError(t, err)
	}
	require.EqualValues(t, 1, winners.Load(), "a database lease, not process memory, owns the offer")
	var task model.PendingAgentTask
	require.NoError(t, f.db.First(&task).Error)
	require.NoError(t, f.service.RequestCancel(ctx, f.auth.UserID, task.ID))
	poll, err := f.service.Poll(ctx, f.p)
	require.NoError(t, err)
	require.Empty(t, poll.Deliveries)
	require.Len(t, poll.Controls, 1)
}

func TestPostgresTriggerCallbacksPersistSecondTurnAndCancelReceipt(t *testing.T) {
	f := postgresFixture(t)
	ctx := context.Background()
	require.NoError(t, f.db.Create(&model.SessionMember{SessionID: f.agent.SessionID, MemberType: model.MemberTypeUser, MemberID: f.auth.UserID, Role: model.MemberRoleOwner}).Error)
	events, err := bus.New()
	require.NoError(t, err)
	t.Cleanup(func() { events.Close(context.Background()) })
	svc := agent.NewService(f.db, events, nil, cache.NoOpCache{}, nil, config.EdgeDispatchConfig{}, nil, "")
	svc.SetPairedDeviceService(f.service)
	first, err := svc.TriggerAgentTask(ctx, f.auth.UserID, f.message.ID, f.agent.ID, "", "", "", f.p.TargetID)
	require.NoError(t, err)
	poll, err := f.service.Poll(ctx, f.p)
	require.NoError(t, err)
	require.Len(t, poll.Deliveries, 1)
	require.NoError(t, f.service.AuthorizeTask(ctx, f.p, first.ID))
	require.NoError(t, svc.HandleTaskAck(ctx, f.auth.UserID, f.p.DeviceID, first.ID, "first-run"))
	chunks := []string{"  The remembered value ", "is 42.\n", "\n", "tail  "}
	for _, text := range chunks {
		stream := model.AgentRunEventInput{RuntimeOnly: true, EventType: "run.agent.text_delta", Content: text, ClientMsgID: uuid.NewString()}
		require.NoError(t, svc.HandleTaskStream(ctx, f.auth.UserID, f.p.DeviceID, first.ID, "first-run", stream))
		require.NoError(t, svc.HandleTaskStream(ctx, f.auth.UserID, f.p.DeviceID, first.ID, "first-run", stream))
	}
	result := model.AgentRunEventInput{RuntimeOnly: true, EventType: "run.agent.result", Payload: json.RawMessage(`{"success":true}`), ClientMsgID: uuid.NewString()}
	require.NoError(t, svc.HandleTaskStream(ctx, f.auth.UserID, f.p.DeviceID, first.ID, "first-run", result))
	var eventCount int64
	require.NoError(t, f.db.Model(&model.AgentRunEvent{}).Where("task_id = ?", first.ID).Count(&eventCount).Error)
	require.EqualValues(t, len(chunks)+1, eventCount, "stream retry must preserve the existing typed event identity")
	var beforeFinal int64
	require.NoError(t, f.db.Model(&model.Message{}).Where("session_id = ?", f.agent.SessionID).Count(&beforeFinal).Error)
	require.EqualValues(t, 1, beforeFinal, "runtime evidence must not contaminate chat history")
	answer := strings.Join(chunks, "")
	require.NoError(t, svc.HandleTaskDone(ctx, f.auth.UserID, f.p.DeviceID, first.ID, "first-run", answer))
	var persisted []model.Message
	require.NoError(t, f.db.Where("session_id = ?", f.agent.SessionID).Order("seq_id").Find(&persisted).Error)
	require.Len(t, persisted, 2)
	require.Equal(t, model.SenderTypeAgent, persisted[1].SenderType)
	require.Contains(t, persisted[1].Content, "remembered value is 42")
	secondPrompt := model.Message{SessionID: f.agent.SessionID, SeqID: 3, ClientMsgID: uuid.NewString(), SenderType: model.SenderTypeUser, SenderID: f.auth.UserID, ContentType: model.ContentTypeText, Content: `{"text":"What was the value?"}`}
	require.NoError(t, f.db.Create(&secondPrompt).Error)
	require.NoError(t, f.db.Model(&model.Session{}).Where("id = ?", f.agent.SessionID).Update("next_seq", 3).Error)
	// A fresh facade simulates Hub request reconstruction after UI refresh;
	// no frontend or runtime memory supplies this conversation context.
	svc = agent.NewService(f.db, events, nil, cache.NoOpCache{}, nil, config.EdgeDispatchConfig{}, nil, "")
	svc.SetPairedDeviceService(f.service)
	second, err := svc.TriggerAgentTask(ctx, f.auth.UserID, secondPrompt.ID, f.agent.ID, "", "", "", f.p.TargetID)
	require.NoError(t, err)
	poll, err = f.service.Poll(ctx, f.p)
	require.NoError(t, err)
	require.Len(t, poll.Deliveries, 1)
	req := poll.Deliveries[0].RunRequest
	require.Equal(t, "What was the value?", req.Prompt)
	require.Len(t, req.Messages, 2)
	require.Equal(t, "user", req.Messages[0].Role)
	require.Equal(t, "assistant", req.Messages[1].Role)
	require.Contains(t, req.Messages[1].Content, "42")
	require.Equal(t, answer, req.Messages[1].Content)
	require.NoError(t, svc.HandleTaskAck(ctx, f.auth.UserID, f.p.DeviceID, second.ID, "second-run"))
	require.NoError(t, svc.CancelTask(ctx, f.auth.UserID, second.ID))
	require.Equal(t, model.TaskStatusRunning, f.task(t, second.ID).Status)
	controls, err := f.service.Poll(ctx, f.p)
	require.NoError(t, err)
	require.Len(t, controls.Controls, 1)
	require.NoError(t, f.service.AckControl(ctx, f.p, second.ID, edgedevice.ControlAck{TaskID: second.ID, RunID: "second-run", Status: "applied"}))
	require.Equal(t, model.TaskStatusCancelled, f.task(t, second.ID).Status)
	require.Error(t, svc.HandleTaskDone(ctx, f.auth.UserID, f.p.DeviceID, second.ID, "second-run", "late output must not win"))
	var late int64
	require.NoError(t, f.db.Model(&model.Message{}).Where("session_id = ? AND content::text LIKE ?", f.agent.SessionID, "%late output%").Count(&late).Error)
	require.Zero(t, late)
}

func TestPostgresGrantRevocationLinearizesBeforeTaskCreation(t *testing.T) {
	f := postgresFixture(t)
	ctx := context.Background()
	tx := f.db.Begin()
	require.NoError(t, tx.Error)
	t.Cleanup(func() { _ = tx.Rollback().Error })
	var device model.Device
	require.NoError(t, tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", f.p.DeviceID).Take(&device).Error)
	result := make(chan error, 1)
	go func() {
		task, payload := f.candidate()
		_, err := f.service.CreateTask(ctx, task, payload)
		result <- err
	}()
	// Observe actual PostgreSQL lock waiting, rather than sleeping and assuming
	// the device-grant recheck happened at a specific scheduler interleaving.
	require.Eventually(t, func() bool {
		var count int64
		err := f.db.Raw("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%devices%'").Scan(&count).Error
		return err == nil && count > 0
	}, 5*time.Second, 10*time.Millisecond)
	require.NoError(t, tx.Model(&model.EdgeDeviceCredential{}).Where("device_id = ?", f.p.DeviceID).Update("revoked_at", time.Now().UTC()).Error)
	require.NoError(t, tx.Commit().Error)
	require.ErrorIs(t, <-result, errcode.AuthInvalidToken)
	var count int64
	require.NoError(t, f.db.Model(&model.PendingAgentTask{}).Count(&count).Error)
	require.Zero(t, count)
	require.NoError(t, f.db.Table("delivery_outbox").Count(&count).Error)
	require.Zero(t, count)
}

func TestPostgresCompletionAndAppliedReceiptDoNotRegressEachOther(t *testing.T) {
	f := postgresFixture(t)
	ctx := context.Background()
	events, err := bus.New()
	require.NoError(t, err)
	t.Cleanup(func() { events.Close(ctx) })
	svc := agent.NewService(f.db, events, nil, cache.NoOpCache{}, nil, config.EdgeDispatchConfig{}, nil, "")
	for range 8 {
		task := f.createTask(t)
		require.NoError(t, f.db.Model(task).Updates(map[string]any{"status": model.TaskStatusRunning, "edge_run_id": "original"}).Error)
		require.NoError(t, f.service.RequestCancel(ctx, f.auth.UserID, task.ID))
		start := make(chan struct{})
		done := make(chan error, 1)
		applied := make(chan error, 1)
		go func() {
			<-start
			done <- svc.HandleTaskDone(ctx, f.auth.UserID, f.p.DeviceID, task.ID, "original", "")
		}()
		go func() {
			<-start
			applied <- f.service.AckControl(ctx, f.p, task.ID, edgedevice.ControlAck{TaskID: task.ID, RunID: "original", Status: "applied"})
		}()
		close(start)
		doneErr := <-done
		require.NoError(t, <-applied)
		stored := f.task(t, task.ID)
		require.NotNil(t, stored.CancelAppliedAt)
		if doneErr == nil {
			require.Equal(t, model.TaskStatusDone, stored.Status, "an already committed completed result wins")
		} else {
			require.Equal(t, model.TaskStatusCancelled, stored.Status, "late completion cannot overwrite confirmed cancellation")
		}
	}
}
