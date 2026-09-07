package dispatchsvc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/outboundhttp"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

func TestDirectHTTPUnknownReceiptKeepsOriginalDeviceAcrossRedelivery(t *testing.T) {
	for _, reset := range []bool{false, true} {
		name := "missing-owner"
		if reset {
			name = "response-lost"
		}
		t.Run(name, func(t *testing.T) {
			task := &model.PendingAgentTask{}
			db := newDirectDispatchDB(t, task)
			var posts atomic.Int32
			var healthy atomic.Bool
			healthy.Store(true)
			requestTaskIDs := make(chan string, 3)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/v1/health" {
					if !healthy.Load() {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					_, _ = w.Write([]byte(`{"edgeId":"fixture-edge-device","capabilities":{"runCallbackOwnership":true,"directHubCallbacks":true}}`))
					return
				}
				var body dispatch.EdgeRunRequest
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				requestTaskIDs <- body.HubTaskID
				n := posts.Add(1)
				if n == 1 && reset {
					conn, _, err := w.(http.Hijacker).Hijack()
					if err == nil {
						_ = conn.Close()
					}
					return
				}
				w.WriteHeader(http.StatusAccepted)
				if n == 1 {
					_, _ = w.Write([]byte(`{"data":{"runId":"original-run"}}`))
					return
				}
				_, _ = w.Write([]byte(`{"data":{"runId":"original-run","callbackOwner":"edge"}}`))
			}))
			defer server.Close()
			cache := &recordingDispatchCache{routes: map[string]string{"fixture-user:desktop": "other-conn"}}
			manager := &recordingDispatchWS{conn: &ConnPort{ID: "other-conn", UserID: "fixture-user", DeviceType: "desktop", DeviceID: "other-device"}}
			outbox := &recordingDispatchOutbox{}
			cfg := config.EdgeDispatchConfig{DeviceID: "fixture-edge-device", URL: server.URL, Timeout: time.Second}
			service := NewDispatchService(db, nil, manager, cache, nil, outbox, cfg, outboundhttp.NewClient(time.Second), "")
			payload := dispatchPayload{TaskID: task.ID, AgentType: "codex", Prompt: "Keep execution on one device.", ModelParams: `{"work_dir":"/workspace/project"}`}
			raw, err := dispatch.MarshalPayload(payload)
			require.NoError(t, err)
			service.dispatchRouteHTTP(context.Background(), task, &model.AgentInstance{InviterUserID: "fixture-user"}, &payload, raw, "delivery-1", cache)
			require.EqualValues(t, 1, posts.Load())
			require.Equal(t, 0, manager.pushed)
			require.Empty(t, cache.pushed)
			require.Zero(t, outbox.marked)
			stored, err := readDirectDispatchTask(db, task.ID)
			require.NoError(t, err)
			require.Equal(t, "fixture-edge-device", stored.EdgeDeviceID)
			require.Empty(t, stored.EdgeRunID)
			require.Equal(t, model.TaskStatusQueued, stored.Status)

			// A fresh dispatcher has no in-memory admission state. It must use
			// the persisted destination even while the Edge health probe fails.
			restarted := NewDispatchService(db, nil, manager, cache, nil, outbox, cfg, outboundhttp.NewClient(time.Second), "")
			snapshot, err := restarted.getPendingTaskForRedelivery(context.Background(), task.ID)
			require.NoError(t, err)
			record := redispatchTarget{DeliveryID: "delivery-2", TaskID: task.ID}
			healthy.Store(false)
			require.Error(t, restarted.retryDispatchToTarget(context.Background(), snapshot, payload, raw, record))
			require.EqualValues(t, 1, posts.Load())
			require.Zero(t, manager.pushed)
			require.Empty(t, cache.pushed)

			healthy.Store(true)
			require.NoError(t, restarted.retryDispatchToTarget(context.Background(), snapshot, payload, raw, record))
			require.EqualValues(t, 2, posts.Load())
			require.Equal(t, task.ID, <-requestTaskIDs)
			require.Equal(t, task.ID, <-requestTaskIDs)
			require.Zero(t, manager.pushed)
			require.Empty(t, cache.pushed)
			stored, err = readDirectDispatchTask(db, task.ID)
			require.NoError(t, err)
			require.Equal(t, "original-run", stored.EdgeRunID)
			require.Equal(t, "fixture-edge-device", stored.EdgeDeviceID)
		})
	}
}

func TestDirectHTTPDesktopReplayRestoresOnlyOriginalDevice(t *testing.T) {
	task := &model.PendingAgentTask{}
	db := newDirectDispatchDB(t, task)
	server := httptest.NewServer(withDirectCallbackHealth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Simulate an already-running callback arriving before the HTTP receipt.
		if err := db.Model(&model.PendingAgentTask{}).Where("id = ?", task.ID).Update("status", model.TaskStatusRunning).Error; err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"data":{"runId":"desktop-run","callbackOwner":"desktop"}}`))
	})))
	defer server.Close()
	cache := &recordingDispatchCache{routes: map[string]string{"fixture-user:desktop": "other-conn"}}
	manager := &recordingDispatchWS{conn: &ConnPort{ID: "other-conn", UserID: "fixture-user", DeviceType: "desktop", DeviceID: "other-device"}}
	service := NewDispatchService(db, nil, manager, cache, nil, nil, config.EdgeDispatchConfig{DeviceID: "fixture-edge-device", URL: server.URL, Timeout: time.Second}, outboundhttp.NewClient(time.Second), "")
	payload := dispatchPayload{TaskID: task.ID, AgentType: "codex", ModelParams: `{"work_dir":"/workspace/project"}`}
	raw, err := dispatch.MarshalPayload(payload)
	require.NoError(t, err)
	service.dispatchRouteHTTP(context.Background(), task, &model.AgentInstance{InviterUserID: "fixture-user"}, &payload, raw, "delivery", cache)
	require.Zero(t, manager.pushed, "another connected Desktop is not the callback owner")
	require.Len(t, cache.pushed, 1)
	require.Contains(t, cache.pushed[0], "fixture-user::fixture-edge-device:")
	require.Contains(t, cache.pushed[0], `"edge_device_id":"fixture-edge-device"`)
	// When the original Desktop is connected, bridge recovery may push but not
	// re-mark the already running task as merely dispatched.
	cache.routes["fixture-user:desktop:fixture-edge-device"] = "owner-conn"
	manager.conn = &ConnPort{ID: "owner-conn", UserID: "fixture-user", DeviceType: "desktop", DeviceID: "fixture-edge-device"}
	service.dispatchRouteHTTP(context.Background(), task, &model.AgentInstance{InviterUserID: "fixture-user"}, &payload, raw, "delivery", cache)
	require.Equal(t, 1, manager.pushed)
	stored, err := readDirectDispatchTask(db, task.ID)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusRunning, stored.Status)
	require.Equal(t, "desktop-run", stored.EdgeRunID)
}

func TestDirectHTTPRejectsCallbackDeviceOwnedByAnotherUser(t *testing.T) {
	task := &model.PendingAgentTask{}
	db := newDirectDispatchDB(t, task)
	require.NoError(t, db.Exec("UPDATE devices SET user_id = ? WHERE id = ?", "other-user", "fixture-edge-device").Error)
	var posts atomic.Int32
	server := httptest.NewServer(withDirectCallbackHealth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { posts.Add(1) })))
	defer server.Close()
	service := NewDispatchService(db, nil, nil, nil, nil, nil, config.EdgeDispatchConfig{DeviceID: "fixture-edge-device", URL: server.URL, Timeout: time.Second}, outboundhttp.NewClient(time.Second), "")
	payload := dispatchPayload{TaskID: task.ID, AgentType: "codex", ModelParams: `{"work_dir":"/workspace/project"}`}
	result := service.dispatchToEdgeHTTP(context.Background(), task, &payload)
	require.True(t, result.SafeToFallback)
	require.Zero(t, posts.Load())
	stored, err := readDirectDispatchTask(db, task.ID)
	require.NoError(t, err)
	require.Empty(t, stored.EdgeDeviceID)
}
