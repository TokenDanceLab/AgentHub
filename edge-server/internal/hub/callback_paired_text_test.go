package hub_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/edge-server/internal/hub"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestPairedCallbacksKeepTextAndMetadataSeparate(t *testing.T) {
	text := "  {\"agent_task\":\"model text, not metadata\"}\n\n  "
	id := uuid.NewString()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		if r.URL.Path == "/edge/device/tasks/task-1/stream" {
			var eventType, identity string
			require.NoError(t, json.Unmarshal(body["event_type"], &eventType))
			require.NoError(t, json.Unmarshal(body["client_msg_id"], &identity))
			require.Equal(t, "run.agent.text_delta", eventType)
			require.Equal(t, id, identity)
			var payload map[string]string
			require.NoError(t, json.Unmarshal(body["payload"], &payload))
			require.Equal(t, text, payload["content"])
		} else {
			require.Equal(t, "/edge/device/tasks/task-1/done", r.URL.Path)
			var final string
			require.NoError(t, json.Unmarshal(body["final_content"], &final))
			var payload map[string]string
			require.NoError(t, json.Unmarshal([]byte(final), &payload))
			require.Equal(t, map[string]string{"content": text}, payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":"ok"}`))
	}))
	defer server.Close()
	cfg := hub.DefaultCallbackConfig()
	cfg.DeviceMode = true
	client := newPolicyCallbackClient(server.URL, "fixture-only", cfg)
	require.NoError(t, client.TaskStream(context.Background(), "task-1", "run-1", id, text))
	require.NoError(t, client.TaskDone(context.Background(), "task-1", hub.TaskResult{RunID: "run-1", FinalContent: text}))
}
