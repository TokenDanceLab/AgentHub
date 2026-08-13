package repository

import (
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// AgentTeamTask

func CreateTeamTask(db *gorm.DB, task *model.AgentTeamTask) error {
	if task.InputRefs == "" {
		task.InputRefs = "{}"
	}
	if task.Attempt == 0 {
		task.Attempt = 1
	}
	if task.RiskLevel == "" {
		task.RiskLevel = model.TeamTaskRiskNormal
	}
	if task.Status == "" {
		task.Status = model.TeamTaskStatusPending
	}
	return db.Create(task).Error
}

func ListTeamTasksByRun(db *gorm.DB, teamRunID string) ([]model.AgentTeamTask, error) {
	var tasks []model.AgentTeamTask
	err := db.Where("team_run_id = ?", teamRunID).Order("created_at ASC").Limit(500).Find(&tasks).Error
	return tasks, err
}

func GetTeamTaskByAssignmentID(db *gorm.DB, assignmentID string) (*model.AgentTeamTask, error) {
	var task model.AgentTeamTask
	err := db.Where("assignment_id = ?", assignmentID).First(&task).Error
	return &task, err
}

func UpdateTeamTaskDispatchBinding(db *gorm.DB, id, pendingTaskID string) error {
	return db.Model(&model.AgentTeamTask{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status": model.TeamTaskStatusDispatched,
		"run_id": pendingTaskID,
	}).Error
}
