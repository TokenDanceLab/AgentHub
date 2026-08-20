package app

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/glebarez/sqlite"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/agent"
	"github.com/agenthub/hub-server/internal/ws"
)

// ── helpers ──────────────────────────────────────────────────────────────────

func newBehaviorDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)

	require.NoError(t, db.AutoMigrate(
		&model.User{},
		&model.Friendship{},
		&model.Session{},
		&model.SessionMember{},
		&model.Message{},
		&model.MessagePin{},
		&model.AgentRunEvent{},
		&model.Notification{},
	))
	return db
}

func newBehaviorCache(t *testing.T) *cache.Client {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	return cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()}))
}

func newBehaviorBus(t *testing.T) *bus.Bus {
	t.Helper()
	b, err := bus.New()
	require.NoError(t, err)
	t.Cleanup(func() { b.Close(context.Background()) })
	return b
}

func newBehaviorMgr(t *testing.T) *ws.Manager {
	t.Helper()
	return ws.NewManager()
}

// waitBusDrain waits for all pending events on the b to be processed. It
// gates on Pending()==0 (the bus's own completion counter) rather than
// Running()==0: an idle ants worker does not exit immediately after a
// handler returns, so gating on Running would add a per-publish purge wait
// with no correctness benefit (P1: bus drain 语义).
func waitBusDrain(t *testing.T, b *bus.Bus) {
	t.Helper()
	require.Eventually(t, func() bool {
		return b.Pending() == 0
	}, 3*time.Second, time.Millisecond)
}

// readFrame reads a single Frame from the conn's Send channel.
func readFrame(t *testing.T, conn *ws.Conn) ws.Frame {
	t.Helper()
	select {
	case data := <-conn.Send:
		var frame ws.Frame
		require.NoError(t, json.Unmarshal(data, &frame))
		return frame
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for websocket frame")
		return ws.Frame{}
	}
}

// assertNoFrame asserts no frame arrives within a short window.
func assertNoFrame(t *testing.T, conn *ws.Conn) {
	t.Helper()
	select {
	case data := <-conn.Send:
		t.Fatalf("unexpected frame received: %s", string(data))
	case <-time.After(150 * time.Millisecond):
	}
}

// ── Event dispatch behavioral tests ─────────────────────────────────────────

// TestEventDispatch_MessageRecall verifies that a "message.recall" event is
// dispatched as a websocket frame to session members.
func TestEventDispatch_MessageRecall(t *testing.T) {
	mgr := newBehaviorMgr(t)
	mgr.ResolveMembers = func(sessionID string) []string {
		if sessionID == "sess-recall-1" {
			return []string{"user-a"}
		}
		return nil
	}

	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-a", "web", "device-1")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	msg := &model.Message{
		ID:        "msg-recall-1",
		SessionID: "sess-recall-1",
		SeqID:     1,
	}
	b.Publish(context.Background(), bus.Event{
		Type:    "message.recall",
		Payload: msg,
	})
	waitBusDrain(t, b)

	frame := readFrame(t, conn)
	require.Equal(t, ws.TypeMessageRecall, frame.Type)
	payload, ok := frame.Payload.(map[string]interface{})
	require.True(t, ok)
	require.Equal(t, "msg-recall-1", payload["message_id"])
	require.Equal(t, "sess-recall-1", payload["session_id"])
}

// TestEventDispatch_MessageRecallIgnoresWrongPayload verifies that a
// "message.recall" event with a non-Message payload does not crash.
func TestEventDispatch_MessageRecallIgnoresWrongPayload(t *testing.T) {
	mgr := newBehaviorMgr(t)
	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-a", "web", "device-1")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	b.Publish(context.Background(), bus.Event{
		Type:    "message.recall",
		Payload: "not-a-message",
	})
	waitBusDrain(t, b)
	assertNoFrame(t, conn)
}

// TestEventDispatch_MessagePinUnpin verifies pin and unpin events dispatch
// frames to the session.
func TestEventDispatch_MessagePinUnpin(t *testing.T) {
	mgr := newBehaviorMgr(t)
	mgr.ResolveMembers = func(sessionID string) []string {
		if sessionID == "sess-pin-1" {
			return []string{"user-a"}
		}
		return nil
	}

	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-a", "web", "device-1")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	// Test pin
	pin := &model.MessagePin{
		SessionID:      "sess-pin-1",
		MessageID:      "msg-1",
		PinnedByUserID: "user-a",
	}
	b.Publish(context.Background(), bus.Event{
		Type:    "message.pin",
		Payload: pin,
	})
	waitBusDrain(t, b)

	frame := readFrame(t, conn)
	require.Equal(t, ws.TypeMessagePin, frame.Type)

	// Test unpin
	b.Publish(context.Background(), bus.Event{
		Type: "message.unpin",
		Payload: map[string]string{
			"message_id": "msg-1",
			"session_id": "sess-pin-1",
		},
	})
	waitBusDrain(t, b)

	frame = readFrame(t, conn)
	require.Equal(t, ws.TypeMessageUnpin, frame.Type)
}

// TestEventDispatch_AgentDoneFailedTimeoutCancel verifies agent lifecycle
// events dispatch correctly.
func TestEventDispatch_AgentDoneFailedTimeoutCancel(t *testing.T) {
	mgr := newBehaviorMgr(t)
	mgr.ResolveMembers = func(sessionID string) []string {
		if sessionID == "sess-agent-1" {
			return []string{"user-a"}
		}
		return nil
	}

	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-a", "web", "device-1")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	// agent.done
	b.Publish(context.Background(), bus.Event{
		Type: bus.EventTypeAgentDone,
		Payload: bus.AgentTaskPayload{
			TaskID:          "task-1",
			AgentInstanceID: "agent-1",
			SessionID:       "sess-agent-1",
		},
	})
	waitBusDrain(t, b)
	frame := readFrame(t, conn)
	require.Equal(t, ws.TypeAgentDone, frame.Type)

	// agent.failed
	b.Publish(context.Background(), bus.Event{
		Type: bus.EventTypeAgentFailed,
		Payload: bus.AgentFailedPayload{
			AgentTaskPayload: bus.AgentTaskPayload{
				TaskID:          "task-2",
				AgentInstanceID: "agent-2",
				SessionID:       "sess-agent-1",
			},
			Error: "boom",
		},
	})
	waitBusDrain(t, b)
	frame = readFrame(t, conn)
	require.Equal(t, ws.TypeAgentFailed, frame.Type)

	// agent.timeout
	b.Publish(context.Background(), bus.Event{
		Type: bus.EventTypeAgentTimeout,
		Payload: bus.AgentTaskPayload{
			TaskID:          "task-3",
			AgentInstanceID: "agent-3",
			SessionID:       "sess-agent-1",
		},
	})
	waitBusDrain(t, b)
	frame = readFrame(t, conn)
	require.Equal(t, ws.TypeAgentFailed, frame.Type)

	// agent.cancel
	b.Publish(context.Background(), bus.Event{
		Type: bus.EventTypeAgentCancel,
		Payload: bus.AgentCancelPayload{
			AgentTaskPayload: bus.AgentTaskPayload{
				TaskID:          "task-4",
				AgentInstanceID: "agent-4",
				SessionID:       "sess-agent-1",
			},
			TriggeredBy: "user-a",
		},
	})
	waitBusDrain(t, b)
	frame = readFrame(t, conn)
	require.Equal(t, ws.TypeAgentCancel, frame.Type)
}

// TestEventDispatch_AgentDoneSkipsNotificationWhenNoTask verifies that
// agent.done without a matching pending task does not panic.
func TestEventDispatch_AgentDoneSkipsNotificationWhenNoTask(t *testing.T) {
	mgr := newBehaviorMgr(t)
	mgr.ResolveMembers = func(sessionID string) []string {
		if sessionID == "sess-no-task" {
			return []string{"user-a"}
		}
		return nil
	}

	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-a", "web", "device-1")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	db := newBehaviorDB(t)
	cc := newBehaviorCache(t)
	b := newBehaviorBus(t)

	agentSvc := agent.NewService(db, nil, mgr, cc, nil, config.EdgeDispatchConfig{}, nil, "")
	a := &App{
		mgr:          mgr,
		bus:          b,
		DB:           db,
		CacheClient:  cc,
		AgentService: agentSvc,
	}
	a.startEventSubscriptions(context.Background())

	b.Publish(context.Background(), bus.Event{
		Type: bus.EventTypeAgentDone,
		Payload: bus.AgentTaskPayload{
			TaskID:          "nonexistent-task",
			AgentInstanceID: "agent-nonexistent",
			SessionID:       "sess-no-task",
		},
	})
	waitBusDrain(t, b)

	frame := readFrame(t, conn)
	require.Equal(t, ws.TypeAgentDone, frame.Type)
}

// TestEventDispatch_SessionCreatedPushesToMembers verifies that
// session.created pushes frames to all listed members.
func TestEventDispatch_SessionCreatedPushesToMembers(t *testing.T) {
	mgr := newBehaviorMgr(t)
	connA := ws.NewConn(nil)
	connB := ws.NewConn(nil)
	require.NoError(t, mgr.Register(connA))
	require.NoError(t, mgr.Register(connB))
	mgr.SetAuth(connA.ID, "user-a", "web", "dev-a")
	mgr.SetAuth(connB.ID, "user-b", "web", "dev-b")
	t.Cleanup(func() {
		mgr.Unregister(connA.ID)
		mgr.Unregister(connB.ID)
	})

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	b.Publish(context.Background(), bus.Event{
		Type: "session.created",
		Payload: map[string]interface{}{
			"session_id": "sess-new-1",
			"type":       "private",
			"members":    []string{"user-a", "user-b"},
		},
	})
	waitBusDrain(t, b)

	frameA := readFrame(t, connA)
	require.Equal(t, ws.TypeSessionCreated, frameA.Type)

	frameB := readFrame(t, connB)
	require.Equal(t, ws.TypeSessionCreated, frameB.Type)
}

// TestEventDispatch_SessionCreatedFallsBackToResolveMembers verifies that
// session.created uses ResolveMembers when the "members" key is absent.
func TestEventDispatch_SessionCreatedFallsBackToResolveMembers(t *testing.T) {
	mgr := newBehaviorMgr(t)
	mgr.ResolveMembers = func(sessionID string) []string {
		if sessionID == "sess-fallback-1" {
			return []string{"user-x"}
		}
		return nil
	}

	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-x", "web", "dev-x")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	b.Publish(context.Background(), bus.Event{
		Type: "session.created",
		Payload: map[string]interface{}{
			"session_id": "sess-fallback-1",
			"type":       "private",
		},
	})
	waitBusDrain(t, b)

	frame := readFrame(t, conn)
	require.Equal(t, ws.TypeSessionCreated, frame.Type)
}

// TestEventDispatch_SessionMemberJoinedLeftInfoDissolved verifies session
// lifecycle events push to all session members.
func TestEventDispatch_SessionMemberJoinedLeftInfoDissolved(t *testing.T) {
	mgr := newBehaviorMgr(t)
	mgr.ResolveMembers = func(sessionID string) []string {
		if sessionID == "sess-lifecycle-1" {
			return []string{"user-a"}
		}
		return nil
	}

	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-a", "web", "device-1")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	tests := []struct {
		name      string
		eventType string
		frameType string
	}{
		{"member_joined", "session.member_joined", ws.TypeSessionMemberJoined},
		{"member_left", "session.member_left", ws.TypeSessionMemberLeft},
		{"info_updated", "session.info_updated", ws.TypeSessionInfoUpdated},
		{"dissolved", "session.dissolved", ws.TypeSessionDissolved},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b.Publish(context.Background(), bus.Event{
				Type: tt.eventType,
				Payload: map[string]interface{}{
					"session_id": "sess-lifecycle-1",
					"member_id":  "user-b",
				},
			})
			waitBusDrain(t, b)

			frame := readFrame(t, conn)
			require.Equal(t, tt.frameType, frame.Type)
		})
	}
}

// TestEventDispatch_SessionMemberEventsSkipEmptySessionID verifies that
// session lifecycle events with an empty session_id do not push frames.
func TestEventDispatch_SessionMemberEventsSkipEmptySessionID(t *testing.T) {
	mgr := newBehaviorMgr(t)
	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-a", "web", "device-1")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	b.Publish(context.Background(), bus.Event{
		Type: "session.member_joined",
		Payload: map[string]interface{}{
			"session_id": "",
			"member_id":  "user-b",
		},
	})
	waitBusDrain(t, b)

	assertNoFrame(t, conn)
}

// TestEventDispatch_MessageReadPushesToSession verifies message.read event.
func TestEventDispatch_MessageReadPushesToSession(t *testing.T) {
	mgr := newBehaviorMgr(t)
	mgr.ResolveMembers = func(sessionID string) []string {
		if sessionID == "sess-read-1" {
			return []string{"user-a"}
		}
		return nil
	}

	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-a", "web", "device-1")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	b.Publish(context.Background(), bus.Event{
		Type: "message.read",
		Payload: map[string]interface{}{
			"session_id":    "sess-read-1",
			"message_id":    "msg-1",
			"reader_id":     "user-b",
			"last_read_seq": float64(42),
		},
	})
	waitBusDrain(t, b)

	frame := readFrame(t, conn)
	require.Equal(t, ws.TypeMessageRead, frame.Type)
}

// TestEventDispatch_MessageNewSkipsAgentPushesUser verifies that agent-sent
// messages are not pushed via message.new, but user messages are.
func TestEventDispatch_MessageNewSkipsAgentPushesUser(t *testing.T) {
	mgr := newBehaviorMgr(t)
	mgr.ResolveMembers = func(sessionID string) []string {
		return []string{"user-a"}
	}

	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-a", "web", "device-1")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	// Agent message — should NOT push to session
	b.Publish(context.Background(), bus.Event{
		Type: "message.new",
		Payload: &model.Message{
			ID:          "msg-agent",
			SessionID:   "sess-1",
			SenderType:  model.SenderTypeAgent,
			SenderID:    "agent-1",
			ContentType: model.ContentTypeText,
			Content:     `{"text":"processing"}`,
		},
	})
	waitBusDrain(t, b)
	assertNoFrame(t, conn)

	// User message — SHOULD push to session
	b.Publish(context.Background(), bus.Event{
		Type: "message.new",
		Payload: &model.Message{
			ID:          "msg-user",
			SessionID:   "sess-1",
			SenderType:  model.SenderTypeUser,
			SenderID:    "user-b",
			ContentType: model.ContentTypeText,
			Content:     `{"text":"hello"}`,
		},
	})
	waitBusDrain(t, b)

	frame := readFrame(t, conn)
	require.Equal(t, ws.TypeMessageNew, frame.Type)
}

// TestEventDispatch_FriendAcceptedPushesToRequester verifies that
// friend.accepted is pushed to the requester, not the accepter.
func TestEventDispatch_FriendAcceptedPushesToRequester(t *testing.T) {
	mgr := newBehaviorMgr(t)
	connReq := ws.NewConn(nil)
	connAcc := ws.NewConn(nil)
	require.NoError(t, mgr.Register(connReq))
	require.NoError(t, mgr.Register(connAcc))
	mgr.SetAuth(connReq.ID, "requester-1", "web", "dev-req")
	mgr.SetAuth(connAcc.ID, "accepter-1", "web", "dev-acc")
	t.Cleanup(func() {
		mgr.Unregister(connReq.ID)
		mgr.Unregister(connAcc.ID)
	})

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	b.Publish(context.Background(), bus.Event{
		Type: ws.TypeFriendAccepted,
		Payload: map[string]interface{}{
			"friendship_id": "friendship-1",
			"user_id":       "requester-1",
			"accepter_id":   "accepter-1",
		},
	})
	waitBusDrain(t, b)

	frame := readFrame(t, connReq)
	require.Equal(t, ws.TypeFriendAccepted, frame.Type)

	// Accepter should NOT receive the frame
	assertNoFrame(t, connAcc)
}

// TestEventDispatch_FriendAcceptedSkipsEmptyUserID verifies that
// friend.accepted with an empty user_id does not push to anyone.
func TestEventDispatch_FriendAcceptedSkipsEmptyUserID(t *testing.T) {
	mgr := newBehaviorMgr(t)
	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-a", "web", "device-1")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	b.Publish(context.Background(), bus.Event{
		Type: ws.TypeFriendAccepted,
		Payload: map[string]interface{}{
			"friendship_id": "friendship-1",
			"user_id":       "",
			"accepter_id":   "accepter-1",
		},
	})
	waitBusDrain(t, b)

	assertNoFrame(t, conn)
}

// TestEventDispatch_TeamRunStartedPushesToUserWhenNoSession verifies that
// team.run.started pushes to user when no session_id is present.
func TestEventDispatch_TeamRunStartedPushesToUserWhenNoSession(t *testing.T) {
	mgr := newBehaviorMgr(t)
	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-1", "web", "device-1")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	b.Publish(context.Background(), bus.Event{
		Type: "team.run.started",
		Payload: map[string]interface{}{
			"team_id": "team-1",
			"run_id":  "run-1",
			"user_id": "user-1",
		},
	})
	waitBusDrain(t, b)

	frame := readFrame(t, conn)
	require.Equal(t, ws.TypeTeamRunStarted, frame.Type)
}

// TestEventDispatch_TeamEventsWithSessionPushToSession verifies that team
// events with a session_id push to the session.
func TestEventDispatch_TeamEventsWithSessionPushToSession(t *testing.T) {
	mgr := newBehaviorMgr(t)
	mgr.ResolveMembers = func(sessionID string) []string {
		if sessionID == "sess-team-1" {
			return []string{"member-1"}
		}
		return nil
	}

	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "member-1", "web", "device-1")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	b.Publish(context.Background(), bus.Event{
		Type: bus.EventTypeTeamAssignmentDone,
		Payload: map[string]interface{}{
			"team_run_id":   "run-1",
			"assignment_id": "assignment-1",
			"session_id":    "sess-team-1",
		},
	})
	waitBusDrain(t, b)

	frame := readFrame(t, conn)
	require.Equal(t, ws.TypeTeamAssignmentDone, frame.Type)
}

// TestEventDispatch_NonMapPayloadIsIgnored verifies that team and session
// events with non-map payloads are silently ignored.
func TestEventDispatch_NonMapPayloadIsIgnored(t *testing.T) {
	mgr := newBehaviorMgr(t)
	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-a", "web", "device-1")
	t.Cleanup(func() { mgr.Unregister(conn.ID) })

	b := newBehaviorBus(t)
	a := &App{mgr: mgr, bus: b}
	a.startEventSubscriptions(context.Background())

	// String payload for a team event — should be ignored
	b.Publish(context.Background(), bus.Event{
		Type:    "team.event",
		Payload: "not-a-map",
	})
	waitBusDrain(t, b)
	assertNoFrame(t, conn)

	// String payload for session member_left — should be ignored
	b.Publish(context.Background(), bus.Event{
		Type:    "session.member_left",
		Payload: 12345,
	})
	waitBusDrain(t, b)
	assertNoFrame(t, conn)
}
