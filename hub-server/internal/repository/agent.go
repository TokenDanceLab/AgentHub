package repository

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func CreateAgentInstance(db *gorm.DB, ai *model.AgentInstance) error {
	return db.Create(ai).Error
}

func GetAgentInstanceByID(db *gorm.DB, id string) (*model.AgentInstance, error) {
	var ai model.AgentInstance
	err := db.Where("id = ?", id).First(&ai).Error
	return &ai, err
}

func ListAgentInstancesBySession(db *gorm.DB, sessionID string) ([]model.AgentInstance, error) {
	var agents []model.AgentInstance
	err := db.Where("session_id = ?", sessionID).Find(&agents).Error
	return agents, err
}

func ListAgentInstancesByInviter(db *gorm.DB, sessionID, inviterID string) ([]model.AgentInstance, error) {
	var agents []model.AgentInstance
	err := db.Where("session_id = ? AND inviter_user_id = ?", sessionID, inviterID).Find(&agents).Error
	return agents, err
}

func DeleteAgentInstance(db *gorm.DB, agentID string) error {
	return db.Where("id = ?", agentID).Delete(&model.AgentInstance{}).Error
}

func CreateCustomAgent(db *gorm.DB, ca *model.CustomAgent) error {
	return db.Create(ca).Error
}

func GetCustomAgentByID(db *gorm.DB, id string) (*model.CustomAgent, error) {
	var ca model.CustomAgent
	err := db.Where("id = ? AND deleted_at IS NULL", id).First(&ca).Error
	return &ca, err
}

func ListCustomAgentsByOwner(db *gorm.DB, ownerID string) ([]model.CustomAgent, error) {
	var agents []model.CustomAgent
	err := db.Where("owner_user_id = ? AND deleted_at IS NULL", ownerID).Find(&agents).Error
	return agents, err
}

func UpdateCustomAgent(db *gorm.DB, ca *model.CustomAgent) error {
	return db.Save(ca).Error
}

func SoftDeleteCustomAgent(db *gorm.DB, id string) error {
	now := time.Now()
	return db.Model(&model.CustomAgent{}).Where("id = ?", id).Update("deleted_at", now).Error
}

// PendingAgentTask

func CreatePendingTask(db *gorm.DB, task *model.PendingAgentTask) error {
	return db.Create(task).Error
}

func GetPendingTaskByID(db *gorm.DB, id string) (*model.PendingAgentTask, error) {
	var task model.PendingAgentTask
	err := db.Where("id = ?", id).First(&task).Error
	return &task, err
}

func ListPendingTasksByIDs(db *gorm.DB, ids []string) ([]model.PendingAgentTask, error) {
	var tasks []model.PendingAgentTask
	if len(ids) == 0 {
		return tasks, nil
	}
	err := db.Where("id IN ?", ids).Find(&tasks).Error
	return tasks, err
}

func UpdatePendingTaskStatus(db *gorm.DB, id, status, errMsg string) error {
	return UpdatePendingTaskStatusWithEdgeRunID(db, id, status, errMsg, "")
}

func UpdatePendingTaskDispatched(db *gorm.DB, id, edgeDeviceID string) error {
	now := time.Now()
	updates := map[string]interface{}{
		"status":        model.TaskStatusDispatched,
		"dispatched_at": &now,
	}
	if edgeDeviceID != "" {
		updates["edge_device_id"] = edgeDeviceID
	}
	return db.Model(&model.PendingAgentTask{}).Where("id = ?", id).Updates(updates).Error
}

func UpdatePendingTaskStatusWithEdgeRunID(db *gorm.DB, id, status, errMsg, edgeRunID string) error {
	updates := map[string]interface{}{"status": status}
	if status == model.TaskStatusDispatched {
		now := time.Now()
		updates["dispatched_at"] = &now
	}
	if status == model.TaskStatusDone || status == model.TaskStatusFailed || status == model.TaskStatusCancelled || status == model.TaskStatusTimeout {
		now := time.Now()
		updates["finished_at"] = &now
	}
	if errMsg != "" {
		updates["error_message"] = errMsg
	}
	if edgeRunID != "" {
		updates["edge_run_id"] = edgeRunID
	}
	return db.Model(&model.PendingAgentTask{}).Where("id = ?", id).Updates(updates).Error
}

// UpdatePendingTaskStatusAtomic updates a task's status only when the current
// status matches oldStatus (atomic compare-and-swap). Returns the number of
// rows affected (0 means a concurrent write won).
func UpdatePendingTaskStatusAtomic(db *gorm.DB, id, oldStatus, newStatus, errMsg string) (int64, error) {
	updates := map[string]interface{}{"status": newStatus}
	if newStatus == model.TaskStatusDispatched {
		now := time.Now()
		updates["dispatched_at"] = &now
	}
	if newStatus == model.TaskStatusDone || newStatus == model.TaskStatusFailed ||
		newStatus == model.TaskStatusCancelled || newStatus == model.TaskStatusTimeout {
		now := time.Now()
		updates["finished_at"] = &now
	}
	if errMsg != "" {
		updates["error_message"] = errMsg
	}
	result := db.Model(&model.PendingAgentTask{}).
		Where("id = ? AND status = ?", id, oldStatus).
		Updates(updates)
	return result.RowsAffected, result.Error
}

// UpdatePendingTaskStatusAtomicWithEdgeRunID is the atomic variant that also
// sets edge_run_id.
func UpdatePendingTaskStatusAtomicWithEdgeRunID(db *gorm.DB, id, oldStatus, newStatus, errMsg, edgeRunID string) (int64, error) {
	updates := map[string]interface{}{"status": newStatus}
	if newStatus == model.TaskStatusDispatched {
		now := time.Now()
		updates["dispatched_at"] = &now
	}
	if newStatus == model.TaskStatusDone || newStatus == model.TaskStatusFailed ||
		newStatus == model.TaskStatusCancelled || newStatus == model.TaskStatusTimeout {
		now := time.Now()
		updates["finished_at"] = &now
	}
	if errMsg != "" {
		updates["error_message"] = errMsg
	}
	if edgeRunID != "" {
		updates["edge_run_id"] = edgeRunID
	}
	result := db.Model(&model.PendingAgentTask{}).
		Where("id = ? AND status = ?", id, oldStatus).
		Updates(updates)
	return result.RowsAffected, result.Error
}

// UpdatePendingTaskEdgeRunID sets the edge_run_id on a task that has an empty
// edge_run_id. Used when the task is already running and only the edge run id
// needs backfilling (idempotent).
func UpdatePendingTaskEdgeRunID(db *gorm.DB, id, edgeRunID string) error {
	return db.Model(&model.PendingAgentTask{}).
		Where("id = ? AND edge_run_id = ?", id, "").
		Update("edge_run_id", edgeRunID).Error
}

func ScanExpiredTasks(db *gorm.DB) ([]model.PendingAgentTask, error) {
	var tasks []model.PendingAgentTask
	err := db.Where("expire_at < ? AND status IN ?", time.Now(), []string{model.TaskStatusQueued, model.TaskStatusDispatched, model.TaskStatusRunning}).Find(&tasks).Error
	return tasks, err
}

func CancelTasksByAgentInstance(db *gorm.DB, agentInstanceID string) error {
	now := time.Now()
	return db.Model(&model.PendingAgentTask{}).
		Where("agent_instance_id = ? AND status IN ?", agentInstanceID, []string{model.TaskStatusQueued, model.TaskStatusDispatched, model.TaskStatusRunning}).
		Updates(map[string]interface{}{"status": model.TaskStatusCancelled, "finished_at": &now}).Error
}

// BumpRunningTaskExpireAt extends the expire_at timestamp for a running task,
// keeping it alive while activity (stream callbacks) continues.
// #132: running tasks that stop receiving activity will be expired by the scheduler.
func BumpRunningTaskExpireAt(db *gorm.DB, id string, ttl time.Duration) error {
	newExpire := time.Now().Add(ttl)
	return db.Model(&model.PendingAgentTask{}).
		Where("id = ? AND status = ?", id, model.TaskStatusRunning).
		Update("expire_at", newExpire).Error
}

func CreateAgentRunEventWithNextSeq(db *gorm.DB, event *model.AgentRunEvent) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var maxSeq int64
		if err := tx.Model(&model.AgentRunEvent{}).
			Where("task_id = ?", event.TaskID).
			Select("COALESCE(MAX(event_seq), 0)").
			Scan(&maxSeq).Error; err != nil {
			return err
		}
		event.EventSeq = maxSeq + 1
		return tx.Create(event).Error
	})
}

func ListAgentRunEventsByTaskID(db *gorm.DB, taskID string) ([]model.AgentRunEvent, error) {
	return ListAgentRunEventsByTaskIDFiltered(db, taskID, model.AgentRunEventFilter{})
}

func ListAgentRunEventsByTaskIDFiltered(db *gorm.DB, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error) {
	var events []model.AgentRunEvent
	query := db.Where("task_id = ?", taskID)
	if filter.EventType != "" {
		query = query.Where("event_type = ?", filter.EventType)
	}
	if filter.AfterSeq > 0 {
		query = query.Where("event_seq > ?", filter.AfterSeq)
	}
	if filter.Limit > 0 {
		query = query.Limit(filter.Limit)
	}
	err := query.Order("event_seq ASC, created_at ASC, id ASC").Find(&events).Error
	return events, err
}

func ListAgentRunEventsByTaskIDs(db *gorm.DB, taskIDs []string) ([]model.AgentRunEvent, error) {
	var events []model.AgentRunEvent
	if len(taskIDs) == 0 {
		return events, nil
	}
	err := db.Where("task_id IN ?", taskIDs).
		Order("task_id ASC, event_seq ASC, created_at ASC, id ASC").
		Find(&events).Error
	return events, err
}
