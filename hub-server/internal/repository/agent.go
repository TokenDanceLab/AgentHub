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

func UpdatePendingTaskStatus(db *gorm.DB, id, status, errMsg string) error {
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
	return db.Model(&model.PendingAgentTask{}).Where("id = ?", id).Updates(updates).Error
}

func ScanExpiredTasks(db *gorm.DB) ([]model.PendingAgentTask, error) {
	var tasks []model.PendingAgentTask
	err := db.Where("expire_at < NOW() AND status IN ?", []string{model.TaskStatusQueued, model.TaskStatusDispatched}).Find(&tasks).Error
	return tasks, err
}

func CancelTasksByAgentInstance(db *gorm.DB, agentInstanceID string) error {
	now := time.Now()
	return db.Model(&model.PendingAgentTask{}).
		Where("agent_instance_id = ? AND status IN ?", agentInstanceID, []string{model.TaskStatusQueued, model.TaskStatusDispatched, model.TaskStatusRunning}).
		Updates(map[string]interface{}{"status": model.TaskStatusCancelled, "finished_at": &now}).Error
}
