package agent

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestTextDeltasPersistOnceAsEventsAndOneFinalAnswer(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
	chunks := []string{"  开始\n", strings.Repeat("long response ", 100), "\n\n", "结束  "}
	for _, text := range chunks {
		payload, err := json.Marshal(map[string]string{"content": text})
		require.NoError(t, err)
		input := model.AgentRunEventInput{RuntimeOnly: true, EventType: "run.agent.text_delta", ClientMsgID: uuid.NewString(), Payload: payload}
		for range 2 {
			require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", input))
		}
	}
	var events []model.AgentRunEvent
	require.NoError(t, db.Order("event_seq").Find(&events).Error)
	require.Len(t, events, len(chunks), "replayed chunks must not append another event")
	for index, event := range events {
		var payload map[string]string
		require.NoError(t, json.Unmarshal([]byte(event.Payload), &payload))
		require.Equal(t, chunks[index], payload["content"], "stream whitespace is data")
	}
	var count int64
	require.NoError(t, db.Model(&model.Message{}).Count(&count).Error)
	require.Zero(t, count, "partial deltas are run evidence, not chat messages")
	final := strings.Join(chunks, "")
	require.NoError(t, svc.HandleTaskDone(context.Background(), "user-1", "dev-1", "task-1", "run-1", final))
	var messages []model.Message
	require.NoError(t, db.Find(&messages).Error)
	require.Len(t, messages, 1, "one completed turn contributes one history message")
	var content struct {
		Content string `json:"content"`
		Task    struct {
			ID     string `json:"task_id"`
			Status string `json:"status"`
		} `json:"agent_task"`
	}
	require.NoError(t, json.Unmarshal([]byte(messages[0].Content), &content))
	require.Equal(t, final, content.Content)
	require.Equal(t, "task-1", content.Task.ID)
	require.Equal(t, "done", content.Task.Status)
}

func TestTextDeltaIdentityCannotReplacePayloadOrBinding(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
	input := model.AgentRunEventInput{RuntimeOnly: true, EventType: "run.agent.text_delta", ClientMsgID: uuid.NewString(), Payload: json.RawMessage(`{"content":"original"}`)}
	require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", input))
	input.Payload = json.RawMessage(`{"content":"replacement"}`)
	require.ErrorIs(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", input), errcode.ErrBadRequest)
	input.Payload = json.RawMessage(`{"content":"original","provider":"changed"}`)
	require.ErrorIs(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", input), errcode.ErrBadRequest)
	input.ClientMsgID = "not-a-uuid"
	require.ErrorIs(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", input), errcode.ErrBadRequest)
	var events []model.AgentRunEvent
	require.NoError(t, db.Find(&events).Error)
	require.Len(t, events, 1)
	require.JSONEq(t, `{"content":"original"}`, events[0].Payload)
}

func TestPairedRuntimeMetadataDoesNotBecomeConversationText(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
	for _, eventType := range []string{"run.agent.thinking", "run.agent.result"} {
		input := model.AgentRunEventInput{RuntimeOnly: true, EventType: eventType, ClientMsgID: uuid.NewString(), Payload: json.RawMessage(`{"content":"runtime evidence"}`)}
		require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", input))
	}
	var events, messages int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Count(&events).Error)
	require.NoError(t, db.Model(&model.Message{}).Count(&messages).Error)
	require.EqualValues(t, 2, events)
	require.Zero(t, messages)
}

func TestRuntimeEventIdentityPreservesLargeJSONNumbers(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
	input := model.AgentRunEventInput{RuntimeOnly: true, EventType: "run.agent.result", ClientMsgID: uuid.NewString(), Payload: json.RawMessage(`{"sequence":9007199254740992}`)}
	require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", input))
	input.Payload = json.RawMessage(`{"sequence":9007199254740993}`)
	require.ErrorIs(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", input), errcode.ErrBadRequest)
}

func TestLegacyTextDeltaRetainsChatProjection(t *testing.T) {
	db := newAgentRunEventTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
	input := model.AgentRunEventInput{EventType: "run.agent.text_delta", ClientMsgID: uuid.NewString(), Payload: json.RawMessage(`{"content":"legacy reply"}`)}
	require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", input))
	var messages []model.Message
	require.NoError(t, db.Find(&messages).Error)
	require.Len(t, messages, 1, "only the authenticated paired policy disables chat projection")
}
