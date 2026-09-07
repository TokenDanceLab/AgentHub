package dispatchsvc

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

func (s *DispatchService) dispatchTargetBoundTask(ctx context.Context, cacheClient dispatchCache, task *model.PendingAgentTask, userID, deviceID string, payload []byte) bool {
	queueTargetTask := func(reason string, err error) {
		if pushErr := cacheClient.PushPendingTargetTask(ctx, userID, task.TargetID, deviceID, string(payload)); !dispatch.OfflineQueuePushSucceeded(pushErr) {
			if metrics.AgentDispatchOfflinePushFailures != nil {
				metrics.AgentDispatchOfflinePushFailures.WithLabelValues("target_bound").Inc()
			}
			slog.Error(dispatch.DispatchLogTargetBoundOfflinePushFailed, "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "reason", reason, "error", pushErr)
			return
		}
		if dispatch.TargetBoundOfflinePushInfoLog(err) {
			slog.Info(dispatch.DispatchLogTargetBoundQueued, "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "reason", reason, "error", err)
		}
	}

	connID, err := cacheClient.GetRouteForDevice(ctx, userID, dispatch.DesktopDeviceType, deviceID)
	if dispatch.TargetBoundRouteUnavailable(err, connID, dispatch.ManagerPortAvailable(s.mgr != nil)) {
		queueTargetTask(dispatch.TargetBoundReasonRouteUnavailable, err)
		return false
	}
	conn := s.mgr.FindByConnID(connID)
	if !dispatch.TargetBoundConnFound(conn != nil) {
		queueTargetTask(dispatch.TargetBoundReasonConnMismatch, nil)
		return false
	}
	if dispatch.TargetBoundConnRejected(true, conn.UserID, conn.DeviceType, conn.DeviceID, userID, deviceID) {
		queueTargetTask(dispatch.TargetBoundReasonConnMismatch, nil)
		return false
	}
	frame := FramePort{Type: frameTypeAgentDispatch, Payload: json.RawMessage(payload)}
	// Restoring an accepted Desktop-owned run must not downgrade a fast ACK/done.
	if task.EdgeRunID == "" {
		if err := repository.UpdatePendingTaskDispatched(s.db, task.ID, deviceID); !dispatch.RepoUpdateSucceeded(err) {
			slog.Error(dispatch.DispatchLogTargetBoundMarkFailed, "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "error", err)
			return false
		}
	}
	result := s.mgr.PushToConn(connID, frame)
	if !dispatch.RedeliveryWSPushSucceeded(result.Queued) {
		slog.Warn(dispatch.DispatchLogTargetBoundWSNotQueued, "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
		queueTargetTask(dispatch.TargetBoundReasonWSNotQueued, result.Err)
		return false
	}
	return true
}
