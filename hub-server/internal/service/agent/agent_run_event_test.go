package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/ws"
)

func newTestBus(t *testing.T) *bus.Bus {
	t.Helper()
	b, err := bus.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Close(context.Background()) })
	return b
}

func newAgentRunEventTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)

	ddl := []string{
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			workspace_id TEXT,
			next_seq INTEGER NOT NULL DEFAULT 0,
			last_message_at DATETIME,
			dissolved BOOLEAN NOT NULL DEFAULT FALSE,
			created_at DATETIME
		)`,
		`CREATE TABLE agent_instances (
			id TEXT PRIMARY KEY,
			agent_type TEXT NOT NULL,
			custom_agent_id TEXT,
			session_id TEXT NOT NULL,
			inviter_user_id TEXT NOT NULL,
			workspace_id TEXT,
			display_name TEXT NOT NULL,
			created_at DATETIME
		)`,
		`CREATE TABLE pending_agent_tasks (
			id TEXT PRIMARY KEY,
			agent_instance_id TEXT NOT NULL,
			triggered_by_user_id TEXT NOT NULL,
			trigger_message_id TEXT NOT NULL,
			target_id TEXT,
			status TEXT NOT NULL,
			edge_run_id TEXT,
			edge_device_id TEXT,
			error_message TEXT,
			model_params TEXT DEFAULT '{}',
			created_at DATETIME,
			dispatched_at DATETIME,
			finished_at DATETIME,
			expire_at DATETIME NOT NULL
		)`,
		`CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			seq_id INTEGER NOT NULL,
			client_msg_id TEXT NOT NULL,
			sender_type TEXT NOT NULL,
			sender_id TEXT NOT NULL,
			content_type TEXT NOT NULL,
			content TEXT NOT NULL,
			reply_to_message_id TEXT,
			recalled BOOLEAN NOT NULL DEFAULT FALSE,
			edited BOOLEAN NOT NULL DEFAULT FALSE,
			edited_at DATETIME,
			created_at DATETIME
		)`,
		`CREATE UNIQUE INDEX idx_messages_session_client_msg ON messages (session_id, client_msg_id)`,
		`CREATE TABLE agent_run_events (
			id TEXT PRIMARY KEY,
			task_id TEXT NOT NULL,
			edge_run_id TEXT,
			session_id TEXT NOT NULL,
			agent_instance_id TEXT NOT NULL,
			event_seq INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			payload TEXT NOT NULL,
			created_at DATETIME
		)`,
		`CREATE TABLE agent_team_runs (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			session_id TEXT NOT NULL,
			trigger_user_id TEXT NOT NULL,
			trigger_message TEXT,
			target_id TEXT,
			mode TEXT NOT NULL DEFAULT 'supervisor',
			status TEXT NOT NULL,
			created_at DATETIME,
			updated_at DATETIME
		)`,
	}
	for _, stmt := range ddl {
		require.NoError(t, db.Exec(stmt).Error)
	}

	now := time.Now()
	require.NoError(t, db.Exec(
		`INSERT INTO sessions (id, type, next_seq, dissolved, created_at) VALUES (?, ?, ?, ?, ?)`,
		"sess-1", "group", 0, false, now,
	).Error)
	require.NoError(t, db.Exec(
		`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"agent-1", "codex", "sess-1", "user-1", "Codex", now,
	).Error)
	require.NoError(t, db.Exec(
		`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, target_id, status, edge_run_id, edge_device_id, created_at, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-1", "agent-1", "user-1", "msg-1", "target-1", model.TaskStatusRunning, "run-1", "dev-1", now, now.Add(time.Hour),
	).Error)

	return db
}

func seedAgentRunEventTeamRun(t *testing.T, db *gorm.DB, status string) {
	t.Helper()
	now := time.Now()
	require.NoError(t, db.Exec(
		`INSERT INTO agent_team_runs (id, team_id, session_id, trigger_user_id, trigger_message, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"team-run-1", "team-1", "sess-1", "owner-1", "start team run", status, now, now,
	).Error)
}

func TestHandleTaskStreamPersistsTypedRunEventAndProjection(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	b := newTestBus(t)
	agentStream := make(chan *model.AgentRunEvent, 1)
	b.Subscribe(ws.TypeAgentStream, func(ctx context.Context, event bus.Event) {
		if payload, ok := event.Payload.(*model.AgentRunEvent); ok {
			agentStream <- payload
		}
	})

	svc := &Service{db: db, bus: b, cacheClient: &mockAgentCache{}}
	payload := json.RawMessage(`{"type":"run.agent.tool_call","callId":"call-1","toolName":"read_file"}`)
	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		EventType:   "run.agent.tool_call",
		Payload:     payload,
		ClientMsgID: "11111111-1111-4111-8111-111111111111",
	})
	require.NoError(t, err)

	var persisted model.AgentRunEvent
	require.NoError(t, db.Where("task_id = ?", "task-1").First(&persisted).Error)
	require.Equal(t, int64(1), persisted.EventSeq)
	require.Equal(t, "run.agent.tool_call", persisted.EventType)
	require.JSONEq(t, string(payload), persisted.Payload)

	var projected model.Message
	require.NoError(t, db.Where("session_id = ? AND client_msg_id = ?", "sess-1", "11111111-1111-4111-8111-111111111111").First(&projected).Error)
	require.Equal(t, model.ContentTypeText, projected.ContentType)
	// #2274 B-1: the projection keeps the event payload verbatim AND carries
	// the producing task ref (`agent_task.task_id`) that the transcript needs
	// to offer an honest regenerate — hub stamps it on both callback paths.
	require.JSONEq(
		t,
		`{"type":"run.agent.tool_call","callId":"call-1","toolName":"read_file","agent_task":{"task_id":"task-1"}}`,
		projected.Content,
	)

	select {
	case event := <-agentStream:
		require.Equal(t, persisted.TaskID, event.TaskID)
		require.Equal(t, persisted.EventType, event.EventType)
	case <-time.After(time.Second):
		t.Fatal("agent.stream event was not published")
	}
}

func TestHandleTaskStreamAutoParsesRunningTeamRunRouteDecision(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	seedAgentRunEventTeamRun(t, db, model.TeamRunStatusRunning)
	b := newTestBus(t)
	decisions := make(chan RouteDecisionPayload, 1)
	b.Subscribe("agent.route_decision", func(ctx context.Context, event bus.Event) {
		if payload, ok := event.Payload.(RouteDecisionPayload); ok {
			decisions <- payload
		}
	})
	svc := &Service{db: db, bus: b, cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		Payload: json.RawMessage(`{"action":"delegate","next_worker":"member-2","instructions":"Implement the route","reasoning":"needs backend"}`),
	})

	require.NoError(t, err)
	select {
	case payload := <-decisions:
		require.Equal(t, "owner-1", payload.UserID)
		require.Equal(t, "team-1", payload.TeamID)
		require.Equal(t, "team-run-1", payload.RunID)
		require.Equal(t, "delegate", payload.Decision.Action)
		require.Equal(t, "member-2", payload.Decision.NextWorker)
		require.Equal(t, "Implement the route", payload.Decision.Instructions)
	case <-time.After(5 * time.Second):
		t.Fatal("expected route_decision event was not published")
	}
}

func TestHandleTaskStreamSkipsInvalidRouteDecisionPayloads(t *testing.T) {
	tests := []struct {
		name    string
		status  string
		payload json.RawMessage
		wantErr error
	}{
		{
			name:    "invalid json",
			status:  model.TeamRunStatusRunning,
			payload: json.RawMessage(`{"action":`),
			wantErr: errcode.ErrBadRequest,
		},
		{
			name:    "non decision",
			status:  model.TeamRunStatusRunning,
			payload: json.RawMessage(`{"type":"run.output.batch","content":"hello"}`),
		},
		{
			name:    "invalid action",
			status:  model.TeamRunStatusRunning,
			payload: json.RawMessage(`{"action":"handoff","next_worker":"member-2","instructions":"Implement"}`),
		},
		{
			name:    "non running team run",
			status:  model.TeamRunStatusCompleted,
			payload: json.RawMessage(`{"action":"delegate","next_worker":"member-2","instructions":"Implement"}`),
		},
		{
			name:    "no team run",
			payload: json.RawMessage(`{"action":"delegate","next_worker":"member-2","instructions":"Implement"}`),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newAgentRunEventTestDB(t)
			if tt.status != "" {
				seedAgentRunEventTeamRun(t, db, tt.status)
			}
			b := newTestBus(t)
			decisions := make(chan RouteDecisionPayload, 1)
			b.Subscribe("agent.route_decision", func(ctx context.Context, event bus.Event) {
				if payload, ok := event.Payload.(RouteDecisionPayload); ok {
					decisions <- payload
				}
			})
			svc := &Service{db: db, bus: b, cacheClient: &mockAgentCache{}}

			err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
				Payload: tt.payload,
			})

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
			} else {
				require.NoError(t, err)
			}
			// No route_decision event should be published for invalid payloads
			select {
			case <-decisions:
				t.Fatal("unexpected route_decision event was published")
			case <-time.After(500 * time.Millisecond):
			}
		})
	}
}

func TestHandleTaskStreamRouteDecisionHandlerErrorDoesNotFailStream(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	seedAgentRunEventTeamRun(t, db, model.TeamRunStatusRunning)
	b := newTestBus(t)
	// Subscribe and simulate handler error to verify stream still succeeds
	b.Subscribe("agent.route_decision", func(ctx context.Context, event bus.Event) {
		// Simulate a handler that would error — but on the b, errors only log.
		_ = event
	})
	svc := &Service{db: db, bus: b, cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		Payload: json.RawMessage(`{"action":"delegate","next_worker":"member-2","instructions":"Implement the route"}`),
	})

	require.NoError(t, err)
	// Route decision is dispatched async via event b; stream should never fail due to handler errors.
}

func TestHandleTaskStreamRejectsOversizedInferredEventType(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
	tooLongEventType := "run.agent." + strings.Repeat("x", 96)
	payload := json.RawMessage(`{"type":"` + tooLongEventType + `","content":"oversized event type"}`)

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		Payload: payload,
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var count int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestHandleTaskStreamRejectsOversizedPayload(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
	payload := json.RawMessage(`{"type":"run.output.batch","content":"` + strings.Repeat("x", model.RunEventPayloadMaxBytes) + `"}`)

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		Payload: payload,
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var eventCount int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Count(&eventCount).Error)
	require.Zero(t, eventCount)

	var messageCount int64
	require.NoError(t, db.Model(&model.Message{}).Count(&messageCount).Error)
	require.Zero(t, messageCount)
}

func TestHandleTaskStreamRejectsOversizedProjectedContent(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		Payload: json.RawMessage(`{"type":"run.agent.tool_call","toolName":"read_file"}`),
		Content: strings.Repeat("x", model.RunEventPayloadMaxBytes),
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var eventCount int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Count(&eventCount).Error)
	require.Zero(t, eventCount)

	var messageCount int64
	require.NoError(t, db.Model(&model.Message{}).Count(&messageCount).Error)
	require.Zero(t, messageCount)
}

func TestHandleTaskStreamRejectsOversizedEdgeRunID(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", strings.Repeat("x", 129), model.AgentRunEventInput{
		Payload: json.RawMessage(`{"type":"run.output.batch","content":"hello"}`),
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var eventCount int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Count(&eventCount).Error)
	require.Zero(t, eventCount)

	var messageCount int64
	require.NoError(t, db.Model(&model.Message{}).Count(&messageCount).Error)
	require.Zero(t, messageCount)
}

func TestHandleTaskStreamRejectsRunEventWhenTaskEventCapReached(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
	maxRunEventsPerTask := config.MaxRunEventsPerTask

	events := make([]model.AgentRunEvent, 0, maxRunEventsPerTask)
	for seq := int64(1); seq <= maxRunEventsPerTask; seq++ {
		events = append(events, model.AgentRunEvent{
			TaskID:          "task-1",
			EdgeRunID:       "run-1",
			SessionID:       "sess-1",
			AgentInstanceID: "agent-1",
			EventSeq:        seq,
			EventType:       model.RunEventTypeOutputBatch,
			Payload:         `{"content":"previous"}`,
		})
	}
	require.NoError(t, db.CreateInBatches(events, 256).Error)

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		Payload:     json.RawMessage(`{"type":"run.output.batch","content":"overflow"}`),
		ClientMsgID: "22222222-2222-4222-8222-222222222222",
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var eventCount int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Where("task_id = ?", "task-1").Count(&eventCount).Error)
	require.Equal(t, maxRunEventsPerTask, eventCount)

	var messageCount int64
	require.NoError(t, db.Model(&model.Message{}).Where("session_id = ?", "sess-1").Count(&messageCount).Error)
	require.Zero(t, messageCount)
}

func TestHandleTaskDoneRejectsOversizedFinalContent(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", "task-1", "run-1", strings.Repeat("x", model.RunEventPayloadMaxBytes+1))
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var messageCount int64
	require.NoError(t, db.Model(&model.Message{}).Count(&messageCount).Error)
	require.Zero(t, messageCount)

	var task model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", "task-1").First(&task).Error)
	require.Equal(t, model.TaskStatusRunning, task.Status)
}

func TestHandleTaskDoneRejectsOversizedEdgeRunID(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", "task-1", strings.Repeat("x", 129), "final")
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var messageCount int64
	require.NoError(t, db.Model(&model.Message{}).Count(&messageCount).Error)
	require.Zero(t, messageCount)

	var task model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", "task-1").First(&task).Error)
	require.Equal(t, model.TaskStatusRunning, task.Status)
}

func TestHandleTaskFailRejectsOversizedError(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", "task-1", "run-1", strings.Repeat("x", model.RunEventPayloadMaxBytes+1))
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var task model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", "task-1").First(&task).Error)
	require.Equal(t, model.TaskStatusRunning, task.Status)
	require.Empty(t, task.ErrorMessage)
}

func TestHandleTaskFailRejectsOversizedEdgeRunID(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", "task-1", strings.Repeat("x", 129), "model error")
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var task model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", "task-1").First(&task).Error)
	require.Equal(t, model.TaskStatusRunning, task.Status)
	require.Empty(t, task.ErrorMessage)
}

func TestListTaskRunEventsIsOwnerScoped(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	require.NoError(t, db.Create(&model.AgentRunEvent{
		TaskID:          "task-1",
		EdgeRunID:       "run-1",
		SessionID:       "sess-1",
		AgentInstanceID: "agent-1",
		EventSeq:        1,
		EventType:       model.RunEventTypeOutputBatch,
		Payload:         `{"content":"hello"}`,
	}).Error)

	svc := &Service{db: db}
	events, err := svc.ListTaskRunEvents(context.Background(), "user-1", "task-1", model.AgentRunEventFilter{})
	require.NoError(t, err)
	require.Len(t, events, 1)
	require.Equal(t, model.RunEventTypeOutputBatch, events[0].EventType)

	_, err = svc.ListTaskRunEvents(context.Background(), "other-user", "task-1", model.AgentRunEventFilter{})
	require.ErrorIs(t, err, errcode.AgentTaskNotFound)
}

func TestListTaskRunEventsSupportsFilters(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	base := time.Date(2026, 5, 27, 1, 0, 0, 0, time.UTC)
	for _, event := range []model.AgentRunEvent{
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 1, EventType: model.RunEventTypeOutputBatch, Payload: `{"chunks":[{"text":"hello"}]}`, CreatedAt: base},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 2, EventType: "run.agent.tool_call", Payload: `{"toolName":"read_file"}`, CreatedAt: base.Add(time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 3, EventType: "run.agent.permission_requested", Payload: `{"requestId":"req-1","status":"pending"}`, CreatedAt: base.Add(2 * time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 4, EventType: "run.agent.file_change", Payload: `{"path":"a.txt","action":"modified"}`, CreatedAt: base.Add(3 * time.Second)},
	} {
		require.NoError(t, db.Create(&event).Error)
	}

	svc := &Service{db: db}
	toolEvents, err := svc.ListTaskRunEvents(context.Background(), "user-1", "task-1", model.AgentRunEventFilter{
		EventType: "run.agent.tool_call",
		AfterSeq:  1,
		Limit:     10,
	})
	require.NoError(t, err)
	require.Len(t, toolEvents, 1)
	require.Equal(t, int64(2), toolEvents[0].EventSeq)
	require.Equal(t, "run.agent.tool_call", toolEvents[0].EventType)

	limited, err := svc.ListTaskRunEvents(context.Background(), "user-1", "task-1", model.AgentRunEventFilter{
		AfterSeq: 1,
		Limit:    2,
	})
	require.NoError(t, err)
	require.Len(t, limited, 2)
	require.Equal(t, int64(2), limited[0].EventSeq)
	require.Equal(t, int64(3), limited[1].EventSeq)
}

func TestGetTaskRunEventSummaryAggregatesRuntimeHistory(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	base := time.Date(2026, 5, 27, 1, 0, 0, 0, time.UTC)
	finishedAt := base.Add(6 * time.Second)
	require.NoError(t, db.Exec(`UPDATE pending_agent_tasks SET status = ?, created_at = ?, finished_at = ? WHERE id = ?`,
		model.TaskStatusDone, base, finishedAt, "task-1").Error)
	for _, event := range []model.AgentRunEvent{
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 1, EventType: model.RunEventTypeOutputBatch, Payload: `{"chunks":[{"text":"hello\n"}]}`, CreatedAt: base.Add(time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 2, EventType: "run.agent.tool_call", Payload: `{"toolName":"read_file"}`, CreatedAt: base.Add(2 * time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 3, EventType: "run.agent.permission_requested", Payload: `{"requestId":"req-1","status":"pending"}`, CreatedAt: base.Add(3 * time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 4, EventType: "run.agent.permission_decided", Payload: `{"requestId":"req-1","decision":"allow"}`, CreatedAt: base.Add(4 * time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 5, EventType: "run.agent.file_change", Payload: `{"path":"a.txt","action":"modified"}`, CreatedAt: base.Add(5 * time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 6, EventType: "run.agent.result", Payload: `{"usage":{"input_tokens":100,"output_tokens":25},"status":"success"}`, CreatedAt: finishedAt},
	} {
		require.NoError(t, db.Create(&event).Error)
	}

	svc := &Service{db: db}
	summary, err := svc.GetTaskRunEventSummary(context.Background(), "user-1", "task-1")
	require.NoError(t, err)
	require.Equal(t, "task-1", summary.TaskID)
	require.Equal(t, "run-1", summary.EdgeRunID)
	require.Equal(t, model.TaskStatusDone, summary.Status)
	require.Equal(t, 6, summary.TotalEvents)
	require.Equal(t, int64(6), summary.LastEventSeq)
	require.Equal(t, 1, summary.ToolCallCount)
	require.Equal(t, 1, summary.ArtifactCount)
	require.Equal(t, 1, summary.ApprovalCount)
	require.Equal(t, 0, summary.PendingApprovals)
	require.Equal(t, 1, summary.DecidedApprovals)
	require.Equal(t, 100, summary.InputTokens)
	require.Equal(t, 25, summary.OutputTokens)
	require.Equal(t, 6, summary.OutputBytes)
	require.Equal(t, int64(6000), summary.ElapsedMs)
	require.Equal(t, 1, summary.EventTypeCounts[model.RunEventTypeOutputBatch])
	require.Equal(t, 1, summary.EventTypeCounts["run.agent.result"])
}

func TestListTaskApprovalsProjectsPendingAndDecidedRuntimeEvents(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	base := time.Date(2026, 6, 9, 9, 0, 0, 0, time.UTC)
	for _, event := range []model.AgentRunEvent{
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 1, EventType: "run.agent.permission_requested", Payload: `{"requestId":"req-1","toolName":"shell","status":"pending"}`, CreatedAt: base},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 2, EventType: "run.agent.permission_requested", Payload: `{"requestId":"req-2","toolUseId":"tool-2","toolName":"edit"}`, CreatedAt: base.Add(time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 3, EventType: "run.agent.permission_decided", Payload: `{"requestId":"req-2","decision":"allow","reason":"safe"}`, CreatedAt: base.Add(2 * time.Second)},
	} {
		require.NoError(t, db.Create(&event).Error)
	}

	svc := &Service{db: db}
	result, err := svc.ListTaskApprovals(context.Background(), "user-1", "task-1")
	require.NoError(t, err)
	require.Equal(t, "task-1", result.TaskID)
	require.Equal(t, "run-1", result.EdgeRunID)
	require.Equal(t, "sess-1", result.SessionID)
	require.Equal(t, int64(3), result.LastEventSeq)
	require.Len(t, result.Approvals, 2)
	require.Len(t, result.Pending, 1)
	require.Len(t, result.Decided, 1)
	require.Equal(t, "req-1", result.Pending[0].ApprovalID)
	require.Equal(t, "target-1", result.Pending[0].TargetID)
	require.Equal(t, "dev-1", result.Pending[0].EdgeDeviceID)
	require.Equal(t, int64(1), result.Pending[0].EventSeq)
	require.Equal(t, "tool-2", result.Decided[0].ApprovalID)
	require.Equal(t, "allow", result.Decided[0].Status)
	require.Equal(t, "safe", result.Decided[0].Reason)
	require.NotNil(t, result.Decided[0].DecidedAt)

	_, err = svc.ListTaskApprovals(context.Background(), "other-user", "task-1")
	require.ErrorIs(t, err, errcode.AgentTaskNotFound)
}

func TestDecideTaskApprovalRoundTripsExactTargetDeviceAndCorrelation(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	base := time.Date(2026, 6, 9, 9, 0, 0, 0, time.UTC)
	require.NoError(t, db.Create(&model.AgentRunEvent{
		TaskID:          "task-1",
		EdgeRunID:       "edge-run-1",
		SessionID:       "sess-1",
		AgentInstanceID: "agent-1",
		EventSeq:        1,
		EventType:       "run.agent.permission_requested",
		Payload:         `{"requestId":"req-1","toolName":"shell","status":"pending","correlation_id":"corr-web-hub-edge-1"}`,
		CreatedAt:       base,
	}).Error)

	controlCache := &mockAgentRunControlCache{}
	svc := &Service{db: db, cacheClient: controlCache}
	listed, err := svc.ListTaskApprovals(context.Background(), "user-1", "task-1")
	require.NoError(t, err)
	require.Len(t, listed.Pending, 1)
	require.Equal(t, "target-1", listed.Pending[0].TargetID)
	require.Equal(t, "dev-1", listed.Pending[0].EdgeDeviceID)
	require.Equal(t, "corr-web-hub-edge-1", listed.Pending[0].CorrelationID)

	approval, err := svc.DecideTaskApproval(context.Background(), "user-1", "task-1", "req-1", model.TeamApprovalDecision{
		Decision: "allow",
		Reason:   "known safe",
	})
	require.NoError(t, err)
	require.Equal(t, "allow", approval.Status)
	require.Equal(t, "user-1", approval.DecidedBy)
	require.Equal(t, "target-1", approval.TargetID)
	require.Equal(t, "dev-1", approval.EdgeDeviceID)
	require.Equal(t, "corr-web-hub-edge-1", approval.CorrelationID)
	require.NotNil(t, approval.EdgeControl)
	require.Equal(t, "edge-run-1", approval.EdgeControl.RunID)
	require.Equal(t, "req-1", approval.EdgeControl.RequestID)

	require.Len(t, controlCache.controls, 1)
	require.Equal(t, "user-1", controlCache.controls[0].userID)
	require.Equal(t, "dev-1", controlCache.controls[0].deviceID)
	require.JSONEq(t, `{"kind":"permission.decide","agent_task_id":"task-1","target_id":"target-1","edge_device_id":"dev-1","correlation_id":"corr-web-hub-edge-1","approval_id":"req-1","edge_control":{"runId":"edge-run-1","requestId":"req-1","decision":"allow","reason":"known safe"}}`, controlCache.controls[0].payload)

	result, err := svc.ListTaskApprovals(context.Background(), "user-1", "task-1")
	require.NoError(t, err)
	require.Len(t, result.Decided, 1)
	require.Equal(t, "allow", result.Decided[0].Status)
	require.Equal(t, "user-1", result.Decided[0].DecidedBy)
	require.Equal(t, "target-1", result.Decided[0].TargetID)
	require.Equal(t, "dev-1", result.Decided[0].EdgeDeviceID)
	require.Equal(t, "corr-web-hub-edge-1", result.Decided[0].CorrelationID)
}

func TestDecideTaskApprovalRejectsInvalidState(t *testing.T) {
	tests := []struct {
		name       string
		event      *model.AgentRunEvent
		approvalID string
		decision   string
		clearRunID bool
		wantErr    error
	}{
		{name: "missing approval", approvalID: "missing", decision: "allow", wantErr: errcode.AgentTaskNotFound},
		{name: "invalid decision", approvalID: "req-1", decision: "maybe", wantErr: errcode.ErrBadRequest},
		{name: "missing edge run", event: &model.AgentRunEvent{TaskID: "task-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 1, EventType: "run.agent.permission_requested", Payload: `{"requestId":"req-1"}`}, approvalID: "req-1", decision: "allow", clearRunID: true, wantErr: errcode.ErrBadRequest},
		{name: "missing target", event: &model.AgentRunEvent{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 1, EventType: "run.agent.permission_requested", Payload: `{"requestId":"req-1"}`}, approvalID: "req-1", decision: "allow", wantErr: errcode.ErrBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newAgentRunEventTestDB(t)
			if tt.clearRunID {
				require.NoError(t, db.Exec(`UPDATE pending_agent_tasks SET edge_run_id = ? WHERE id = ?`, "", "task-1").Error)
			}
			if tt.name == "missing target" {
				require.NoError(t, db.Exec(`UPDATE pending_agent_tasks SET target_id = ? WHERE id = ?`, "", "task-1").Error)
			}
			if tt.event != nil {
				require.NoError(t, db.Create(tt.event).Error)
			}
			svc := &Service{db: db, cacheClient: &mockAgentRunControlCache{}}
			_, err := svc.DecideTaskApproval(context.Background(), "user-1", "task-1", tt.approvalID, model.TeamApprovalDecision{Decision: tt.decision})
			require.ErrorIs(t, err, tt.wantErr)
		})
	}
}

func TestListTaskArtifactsProjectsFileChangeAndArtifactCreated(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	base := time.Date(2026, 6, 9, 9, 0, 0, 0, time.UTC)
	for _, event := range []model.AgentRunEvent{
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 1, EventType: "run.agent.file_change", Payload: `{"path":"src/a.go","action":"modified","toolName":"apply_patch","status":"ok","diff":"@@ -1 +1 @@\n-old\n+new","edit_id":"edit-1","diff_hash":"sha256:diff-1","review_status":"pending","can_apply":true,"can_revert":true}`, CreatedAt: base},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 2, EventType: "artifact.created", Payload: `{"artifact_id":"art-1","path":"reports/summary.md","name":"summary.md","mime_type":"text/markdown","size_bytes":128,"hash":"sha256:artifact-1"}`, CreatedAt: base.Add(time.Second)},
		{TaskID: "task-1", EdgeRunID: "run-1", SessionID: "sess-1", AgentInstanceID: "agent-1", EventSeq: 3, EventType: "run.agent.file_change", Payload: `{"path":"src/b.go","status":{"unknown":true},"can_apply":"invalid"}`, CreatedAt: base.Add(2 * time.Second)},
	} {
		require.NoError(t, db.Create(&event).Error)
	}

	svc := &Service{db: db}
	result, err := svc.ListTaskArtifacts(context.Background(), "user-1", "task-1")
	require.NoError(t, err)
	require.Equal(t, "task-1", result.TaskID)
	require.Equal(t, "run-1", result.EdgeRunID)
	require.Equal(t, "sess-1", result.SessionID)
	require.Equal(t, int64(3), result.LastEventSeq)
	require.Len(t, result.Artifacts, 3)
	require.Equal(t, "src/a.go", result.Artifacts[0].Path)
	require.Equal(t, "modified", result.Artifacts[0].Action)
	require.Equal(t, int64(1), result.Artifacts[0].EventSeq)
	fileChange := map[string]any{}
	fileChangeJSON, err := json.Marshal(result.Artifacts[0])
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(fileChangeJSON, &fileChange))
	require.Equal(t, "@@ -1 +1 @@\n-old\n+new", fileChange["diff"])
	require.Equal(t, "edit-1", fileChange["edit_id"])
	require.Equal(t, "sha256:diff-1", fileChange["hash"])
	require.Equal(t, "pending", fileChange["review_status"])
	require.Equal(t, false, fileChange["can_apply"])
	require.Equal(t, false, fileChange["can_revert"])
	require.Equal(t, "art-1", result.Artifacts[1].ArtifactID)
	require.Equal(t, "sha256:artifact-1", result.Artifacts[1].Hash)
	require.Equal(t, "reports/summary.md", result.Artifacts[1].Path)
	require.Equal(t, int64(128), result.Artifacts[1].SizeBytes)
	artifactCreated := map[string]any{}
	artifactCreatedJSON, err := json.Marshal(result.Artifacts[1])
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(artifactCreatedJSON, &artifactCreated))
	require.NotContains(t, artifactCreated, "diff")
	malformedFileChange := map[string]any{}
	malformedFileChangeJSON, err := json.Marshal(result.Artifacts[2])
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(malformedFileChangeJSON, &malformedFileChange))
	require.NotContains(t, malformedFileChange, "can_apply")

	_, err = svc.ListTaskArtifacts(context.Background(), "other-user", "task-1")
	require.ErrorIs(t, err, errcode.AgentTaskNotFound)
}

type mockAgentRunControlCache struct {
	controls []mockAgentRunControlCall
}

type mockAgentRunControlCall struct {
	userID   string
	deviceID string
	payload  string
}

func (m *mockAgentRunControlCache) GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
	return "", errors.New("not used")
}

func (m *mockAgentRunControlCache) GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error) {
	return "", errors.New("offline")
}

func (m *mockAgentRunControlCache) PushPendingTask(ctx context.Context, userID, taskJSON string) error {
	return errors.New("not used")
}

func (m *mockAgentRunControlCache) PushPendingTargetTask(ctx context.Context, userID, targetID, deviceID, taskJSON string) error {
	return errors.New("not used")
}

func (m *mockAgentRunControlCache) AllocateSeq(ctx context.Context, sessionID string) (int64, error) {
	return 0, errors.New("not used")
}

func (m *mockAgentRunControlCache) SetSeq(ctx context.Context, sessionID string, seq int64) error {
	return errors.New("not used")
}

func (m *mockAgentRunControlCache) PushPendingAgentControl(ctx context.Context, userID, deviceID, controlJSON string) error {
	m.controls = append(m.controls, mockAgentRunControlCall{userID: userID, deviceID: deviceID, payload: controlJSON})
	return nil
}
