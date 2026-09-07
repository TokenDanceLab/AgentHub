package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// RecordPendingTaskDirectReceipt binds an accepted direct run to its real
// callback device. A fast ACK/done callback may already have advanced status;
// the late HTTP receipt must preserve that state and any existing binding.
func RecordPendingTaskDirectReceipt(db *gorm.DB, id, deviceID, runID string) error {
	if deviceID == "" || runID == "" {
		return errors.New("direct receipt requires device and run identities")
	}
	result := db.Model(&model.PendingAgentTask{}).
		Where("id = ? AND (edge_device_id IS NULL OR edge_device_id = ?) AND (edge_run_id IS NULL OR edge_run_id = '' OR edge_run_id = ?)", id, deviceID, runID).
		Updates(map[string]any{
			"edge_device_id": deviceID,
			"edge_run_id":    runID,
			"status":         gorm.Expr("CASE WHEN status = ? THEN ? ELSE status END", model.TaskStatusQueued, model.TaskStatusDispatched),
			"dispatched_at":  gorm.Expr("COALESCE(dispatched_at, ?)", time.Now()),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// ReservePendingTaskDirectDevice persists the execution destination before the
// first run POST. If the response is lost, redelivery must stay on this device
// instead of starting the same logical task on an unrelated Desktop.
func ReservePendingTaskDirectDevice(db *gorm.DB, id, deviceID string) error {
	if deviceID == "" {
		return errors.New("direct dispatch requires a device identity")
	}
	result := db.Model(&model.PendingAgentTask{}).
		Where("id = ? AND (edge_device_id IS NULL OR edge_device_id = ?)", id, deviceID).
		Where("status IN ?", []string{model.TaskStatusQueued, model.TaskStatusDispatched, model.TaskStatusRunning}).
		Update("edge_device_id", deviceID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// DirectCallbackDeviceMatchesTask checks the user boundary of the callback path.
// A configured global Edge cannot report completion for another inviter's task.
func DirectCallbackDeviceMatchesTask(db *gorm.DB, id, deviceID string) (bool, error) {
	var count int64
	err := db.Model(&model.PendingAgentTask{}).
		Joins("JOIN agent_instances ON agent_instances.id = pending_agent_tasks.agent_instance_id").
		Joins("JOIN devices ON devices.id = ? AND devices.user_id = agent_instances.inviter_user_id", deviceID).
		Where("pending_agent_tasks.id = ?", id).
		Count(&count).Error
	return count > 0, err
}
