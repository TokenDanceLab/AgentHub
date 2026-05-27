package repository

import (
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// AgentTeam CRUD

func CreateTeam(db *gorm.DB, team *model.AgentTeam) error {
	return db.Create(team).Error
}

func GetTeamByID(db *gorm.DB, id string) (*model.AgentTeam, error) {
	var t model.AgentTeam
	err := db.Where("id = ?", id).First(&t).Error
	return &t, err
}

func ListTeamsByOwner(db *gorm.DB, ownerID string) ([]model.AgentTeam, error) {
	var teams []model.AgentTeam
	err := db.Where("owner_id = ?", ownerID).Order("created_at DESC").Find(&teams).Error
	return teams, err
}

func UpdateTeam(db *gorm.DB, team *model.AgentTeam) error {
	return db.Save(team).Error
}

func DeleteTeam(db *gorm.DB, id string) error {
	return db.Where("id = ?", id).Delete(&model.AgentTeam{}).Error
}

// AgentTeamMember

func AddTeamMember(db *gorm.DB, member *model.AgentTeamMember) error {
	return db.Create(member).Error
}

func RemoveTeamMember(db *gorm.DB, memberID string) error {
	return db.Where("id = ?", memberID).Delete(&model.AgentTeamMember{}).Error
}

func ListTeamMembers(db *gorm.DB, teamID string) ([]model.AgentTeamMember, error) {
	var members []model.AgentTeamMember
	err := db.Where("team_id = ?", teamID).Order("position ASC, created_at ASC").Find(&members).Error
	return members, err
}

func GetTeamMemberByID(db *gorm.DB, memberID string) (*model.AgentTeamMember, error) {
	var m model.AgentTeamMember
	err := db.Where("id = ?", memberID).First(&m).Error
	return &m, err
}

// AgentTeamRun

func CreateTeamRun(db *gorm.DB, run *model.AgentTeamRun) error {
	return db.Create(run).Error
}

func GetTeamRunByID(db *gorm.DB, runID string) (*model.AgentTeamRun, error) {
	var r model.AgentTeamRun
	err := db.Where("id = ?", runID).First(&r).Error
	return &r, err
}

func GetTeamRunBySessionID(db *gorm.DB, sessionID string) (*model.AgentTeamRun, error) {
	var r model.AgentTeamRun
	err := db.Where("session_id = ?", sessionID).Order("created_at DESC").First(&r).Error
	return &r, err
}

func ListTeamRunsByTeam(db *gorm.DB, teamID string) ([]model.AgentTeamRun, error) {
	var runs []model.AgentTeamRun
	err := db.Where("team_id = ?", teamID).Order("created_at DESC").Find(&runs).Error
	return runs, err
}

func UpdateTeamRunStatus(db *gorm.DB, runID, status string) error {
	return db.Model(&model.AgentTeamRun{}).Where("id = ?", runID).Update("status", status).Error
}

// AgentTeamAssignment

func CreateAssignment(db *gorm.DB, a *model.AgentTeamAssignment) error {
	return db.Create(a).Error
}

func GetAssignmentByID(db *gorm.DB, id string) (*model.AgentTeamAssignment, error) {
	var a model.AgentTeamAssignment
	err := db.Where("id = ?", id).First(&a).Error
	return &a, err
}

func ListAssignmentsByTeamRun(db *gorm.DB, teamRunID string) ([]model.AgentTeamAssignment, error) {
	var as []model.AgentTeamAssignment
	err := db.Where("team_run_id = ?", teamRunID).Order("created_at ASC").Find(&as).Error
	return as, err
}

func CountAssignmentsByTeamRun(db *gorm.DB, teamRunID string) (int64, error) {
	var count int64
	err := db.Model(&model.AgentTeamAssignment{}).Where("team_run_id = ?", teamRunID).Count(&count).Error
	return count, err
}

func UpdateAssignmentStatus(db *gorm.DB, id string, status string, result string) error {
	updates := map[string]interface{}{
		"status": status,
		"result": result,
	}
	return db.Model(&model.AgentTeamAssignment{}).Where("id = ?", id).Updates(updates).Error
}

func UpdateAssignmentDispatchBinding(db *gorm.DB, id, pendingTaskID string) error {
	return db.Model(&model.AgentTeamAssignment{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status": model.AssignmentStatusDispatched,
		"run_id": pendingTaskID,
	}).Error
}

func CountActiveAssignmentsByMember(db *gorm.DB, memberID string) (int64, error) {
	var count int64
	err := db.Model(&model.AgentTeamAssignment{}).
		Where("from_member_id = ? AND status IN (?, ?, ?)", memberID,
			model.AssignmentStatusPending,
			model.AssignmentStatusDispatched,
			model.AssignmentStatusRunning).
		Count(&count).Error
	return count, err
}

func CountActiveAssignmentsByTeamRun(db *gorm.DB, teamRunID string) (int64, error) {
	var count int64
	err := db.Model(&model.AgentTeamAssignment{}).
		Where("team_run_id = ? AND status IN (?, ?, ?)", teamRunID,
			model.AssignmentStatusPending,
			model.AssignmentStatusDispatched,
			model.AssignmentStatusRunning).
		Count(&count).Error
	return count, err
}

// GetAssignmentByToMember returns the most recent assignment where the given
// member was the target (to_member_id) within a team run. Used for ancestor chain walking.
func GetAssignmentByToMember(db *gorm.DB, teamRunID, toMemberID string) (*model.AgentTeamAssignment, error) {
	var a model.AgentTeamAssignment
	err := db.Where("team_run_id = ? AND to_member_id = ?", teamRunID, toMemberID).
		Order("depth DESC").First(&a).Error
	return &a, err
}

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
	err := db.Where("team_run_id = ?", teamRunID).Order("created_at ASC").Find(&tasks).Error
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

// AgentTeamArtifact

func ReplaceTeamArtifactsForRun(db *gorm.DB, teamRunID string, artifacts []model.AgentTeamArtifact) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("team_run_id = ?", teamRunID).Delete(&model.AgentTeamArtifact{}).Error; err != nil {
			return err
		}
		if len(artifacts) == 0 {
			return nil
		}
		return tx.Create(&artifacts).Error
	})
}

func ListTeamArtifactsByRun(db *gorm.DB, teamRunID string) ([]model.AgentTeamArtifact, error) {
	var artifacts []model.AgentTeamArtifact
	err := db.Where("team_run_id = ?", teamRunID).Order("created_at ASC, id ASC").Find(&artifacts).Error
	return artifacts, err
}

// AgentTeamEvent

func AppendTeamEvent(db *gorm.DB, event *model.AgentTeamEvent) error {
	if event.Payload == "" {
		event.Payload = "{}"
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var maxSeq int
		if err := tx.Model(&model.AgentTeamEvent{}).
			Where("team_run_id = ?", event.TeamRunID).
			Select("COALESCE(MAX(seq), 0)").
			Scan(&maxSeq).Error; err != nil {
			return err
		}
		event.Seq = maxSeq + 1
		return tx.Create(event).Error
	})
}

func ListTeamEventsByRun(db *gorm.DB, teamRunID string) ([]model.AgentTeamEvent, error) {
	var events []model.AgentTeamEvent
	err := db.Where("team_run_id = ?", teamRunID).Order("seq ASC, created_at ASC").Find(&events).Error
	return events, err
}
