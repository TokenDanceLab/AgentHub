package dispatchsvc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/stretchr/testify/require"
)

type pairedTransportMarker struct{}

func (pairedTransportMarker) ValidateTarget(context.Context, *model.ExecutionTarget, *model.ExecutionTargetEvidence) error {
	return nil
}
func (pairedTransportMarker) CreateTask(context.Context, *model.PendingAgentTask, dispatch.Payload) (*model.PendingAgentTask, error) {
	panic("unexpected task creation")
}
func (pairedTransportMarker) IsPairedDevice(context.Context, string) (bool, error) { return true, nil }
func (pairedTransportMarker) RequestCancel(context.Context, string, string) error {
	panic("unexpected cancellation")
}

func TestPairedDeviceNeverUsesConfiguredLegacyHTTP(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/health" {
			_, _ = w.Write([]byte(`{"edgeId":"fixture-edge-device","capabilities":{"runCallbackOwnership":true,"directHubCallbacks":true}}`))
			return
		}
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"code":"ok","data":{"runId":"must-not-run","callbackOwner":"edge"}}`))
	}))
	defer server.Close()
	for _, bound := range []bool{false, true} {
		task := &model.PendingAgentTask{}
		if bound {
			task.EdgeDeviceID = "fixture-edge-device"
		}
		db := newDirectDispatchDB(t, task)
		svc := NewDispatchService(db, nil, nil, nil, nil, nil, config.EdgeDispatchConfig{DeviceID: "fixture-edge-device", URL: server.URL, Timeout: time.Second}, server.Client(), "")
		svc.SetPairedDeviceService(pairedTransportMarker{})
		payload := dispatchPayload{TaskID: task.ID, AgentType: "openai-sdk", ModelParams: `{"work_dir":"/workspace/project"}`}
		result := svc.dispatchToEdgeHTTP(context.Background(), task, &payload)
		require.Empty(t, result.RunID)
		require.Equal(t, !bound, result.SafeToFallback, "only an unreserved legacy task can fall back to Desktop")
	}
	require.Zero(t, requests.Load(), "paired credentials are outbound-only, not legacy HTTP authority")
}

func TestPairedRedispatchNeverEntersDesktopOrOfflineRouting(t *testing.T) {
	cache := &recordingDispatchCache{}
	svc := NewDispatchService(nil, nil, nil, cache, nil, nil, config.EdgeDispatchConfig{}, nil, "")
	svc.SetPairedDeviceService(pairedTransportMarker{})
	err := svc.RedispatchDelivery(context.Background(), "paired-task", "delivery", `{}`, "paired-device")
	require.Error(t, err)
	require.Empty(t, cache.pushed)
}
