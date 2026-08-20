package agentcontrol

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/ws"
)

func TestAgentControlServiceDeliversToExactDesktopDevice(t *testing.T) {
	ctx := context.Background()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	cacheClient := cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()}))

	mgr := ws.NewManager()
	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-1", "desktop", "dev-b")
	require.NoError(t, cacheClient.SetRoute(ctx, "user-1", "desktop:dev-b", conn.ID))

	svc := NewService(cacheClient, mgr)
	require.NoError(t, svc.DeliverToDesktopDevice(ctx, "user-1", "dev-b", model.AgentControlPayload{
		Kind:       model.AgentControlKindPermissionDecide,
		ApprovalID: "approval-b",
		EdgeControl: &model.TeamApprovalEdgeControl{
			RunID:     "edge-run-b",
			RequestID: "approval-b",
			Decision:  "allow",
		},
	}))

	select {
	case data := <-conn.Send:
		var frame struct {
			Type    string `json:"type"`
			Payload struct {
				Kind         string `json:"kind"`
				ApprovalID   string `json:"approval_id"`
				EdgeDeviceID string `json:"edge_device_id"`
			} `json:"payload"`
		}
		require.NoError(t, json.Unmarshal(data, &frame))
		require.Equal(t, ws.TypeAgentControl, frame.Type)
		require.Equal(t, model.AgentControlKindPermissionDecide, frame.Payload.Kind)
		require.Equal(t, "approval-b", frame.Payload.ApprovalID)
		require.Equal(t, "dev-b", frame.Payload.EdgeDeviceID)
	case <-time.After(time.Second):
		t.Fatal("agent control was not delivered to exact desktop device")
	}

	queued, err := cacheClient.PopPendingAgentControlsForDevice(ctx, "user-1", "dev-b")
	require.NoError(t, err)
	require.Empty(t, queued)
}

func TestAgentControlServiceQueuesWhenExactDeviceRouteMissing(t *testing.T) {
	ctx := context.Background()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	cacheClient := cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()}))

	mgr := ws.NewManager()
	connA := ws.NewConn(nil)
	require.NoError(t, mgr.Register(connA))
	mgr.SetAuth(connA.ID, "user-1", "desktop", "dev-a")
	require.NoError(t, cacheClient.SetRoute(ctx, "user-1", "desktop:dev-a", connA.ID))

	svc := NewService(cacheClient, mgr)
	require.NoError(t, svc.DeliverToDesktopDevice(ctx, "user-1", "dev-b", model.AgentControlPayload{
		Kind:       model.AgentControlKindPermissionDecide,
		ApprovalID: "approval-b",
		EdgeControl: &model.TeamApprovalEdgeControl{
			RunID:     "edge-run-b",
			RequestID: "approval-b",
			Decision:  "allow",
		},
	}))

	select {
	case <-connA.Send:
		t.Fatal("control for dev-b was delivered to dev-a")
	case <-time.After(100 * time.Millisecond):
	}

	queued, err := cacheClient.PopPendingAgentControlsForDevice(ctx, "user-1", "dev-b")
	require.NoError(t, err)
	require.Len(t, queued, 1)
	require.JSONEq(t, `{"kind":"permission.decide","edge_device_id":"dev-b","approval_id":"approval-b","edge_control":{"runId":"edge-run-b","requestId":"approval-b","decision":"allow"}}`, queued[0])
}

func TestAgentControlServiceQueuesWhenExactDeviceDeliveryBufferFull(t *testing.T) {
	ctx := context.Background()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	cacheClient := cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()}))

	mgr := ws.NewManager()
	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-1", "desktop", "dev-b")
	require.NoError(t, cacheClient.SetRoute(ctx, "user-1", "desktop:dev-b", conn.ID))
	for i := 0; i < cap(conn.Send); i++ {
		conn.Send <- []byte("already queued")
	}

	svc := NewService(cacheClient, mgr)
	require.NoError(t, svc.DeliverToDesktopDevice(ctx, "user-1", "dev-b", model.AgentControlPayload{
		Kind:       model.AgentControlKindPermissionDecide,
		ApprovalID: "approval-b",
		EdgeControl: &model.TeamApprovalEdgeControl{
			RunID:     "edge-run-b",
			RequestID: "approval-b",
			Decision:  "allow",
		},
	}))

	queued, err := cacheClient.PopPendingAgentControlsForDevice(ctx, "user-1", "dev-b")
	require.NoError(t, err)
	require.Len(t, queued, 1)
	require.JSONEq(t, `{"kind":"permission.decide","edge_device_id":"dev-b","approval_id":"approval-b","edge_control":{"runId":"edge-run-b","requestId":"approval-b","decision":"allow"}}`, queued[0])
}

func TestAgentControlServiceQueuesDuplicateOfflineControlOnce(t *testing.T) {
	ctx := context.Background()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	cacheClient := cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()}))

	svc := NewService(cacheClient, ws.NewManager())
	payload := model.AgentControlPayload{
		Kind:       model.AgentControlKindPermissionDecide,
		ApprovalID: "approval-dedupe",
		EdgeControl: &model.TeamApprovalEdgeControl{
			RunID:     "edge-run-dedupe",
			RequestID: "approval-dedupe",
			Decision:  "allow",
		},
	}
	require.NoError(t, svc.DeliverToDesktopDevice(ctx, "user-1", "dev-b", payload))
	require.NoError(t, svc.DeliverToDesktopDevice(ctx, "user-1", "dev-b", payload))

	queued, err := cacheClient.PopPendingAgentControlsForDevice(ctx, "user-1", "dev-b")
	require.NoError(t, err)
	require.Len(t, queued, 1)
	require.JSONEq(t, `{"kind":"permission.decide","edge_device_id":"dev-b","approval_id":"approval-dedupe","edge_control":{"runId":"edge-run-dedupe","requestId":"approval-dedupe","decision":"allow"}}`, queued[0])
}
