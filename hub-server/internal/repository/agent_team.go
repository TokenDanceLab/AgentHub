package repository

import (
	"errors"
	"strings"
	"time"

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
	err := db.Where("owner_id = ?", ownerID).Order("created_at DESC").Limit(200).Find(&teams).Error
	return teams, err
}

func ListTeamsReadableByUser(db *gorm.DB, userID string) ([]model.AgentTeam, error) {
	var teams []model.AgentTeam
	err := db.Table("agent_teams").
		Select("DISTINCT agent_teams.*").
		Joins("LEFT JOIN agent_team_members ON agent_team_members.team_id = agent_teams.id").
		Joins("LEFT JOIN custom_agents ON custom_agents.id = agent_team_members.agent_profile_id AND custom_agents.deleted_at IS NULL").
		Where("agent_teams.owner_id = ? OR custom_agents.owner_user_id = ?", userID, userID).
		Order("agent_teams.created_at DESC").
		Limit(200).
		Find(&teams).Error
	return teams, err
}

func TeamHasAgentOwnedByUser(db *gorm.DB, teamID, userID string) (bool, error) {
	var count int64
	err := db.Table("agent_team_members").
		Joins("JOIN custom_agents ON custom_agents.id = agent_team_members.agent_profile_id AND custom_agents.deleted_at IS NULL").
		Where("agent_team_members.team_id = ? AND custom_agents.owner_user_id = ?", teamID, userID).
		Count(&count).Error
	return count > 0, err
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
	err := db.Where("team_id = ?", teamID).Order("created_at DESC").Limit(200).Find(&runs).Error
	return runs, err
}

func UpdateTeamRunStatus(db *gorm.DB, runID, status string) error {
	return db.Model(&model.AgentTeamRun{}).Where("id = ?", runID).Update("status", status).Error
}

// UpdateTeamRunStatusIfNotTerminal transitions a run's status only when the
// current status is not terminal (completed/failed/cancelled). The conditional
// WHERE makes the check-and-write atomic so a repeated or racing finish cannot
// downgrade a terminal outcome. Returns the number of rows updated (0 when the
// run was already terminal or does not exist).
func UpdateTeamRunStatusIfNotTerminal(db *gorm.DB, runID, status string) (int64, error) {
	res := db.Model(&model.AgentTeamRun{}).
		Where("id = ? AND status NOT IN (?, ?, ?)", runID,
			model.TeamRunStatusCompleted,
			model.TeamRunStatusFailed,
			model.TeamRunStatusCancelled).
		Update("status", status)
	return res.RowsAffected, res.Error
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
	err := db.Where("team_run_id = ?", teamRunID).Order("created_at ASC").Limit(500).Find(&as).Error
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

// HasTimedOutActiveAssignment checks if any active assignment in the given
// team run has been running longer than the specified deadline. Uses a single
// SQL query with LIMIT 1 instead of fetching all assignments and filtering
// in Go (fixes N+1 pattern N6).
func HasTimedOutActiveAssignment(db *gorm.DB, teamRunID string, deadline time.Time) (bool, error) {
	var count int64
	err := db.Model(&model.AgentTeamAssignment{}).
		Where("team_run_id = ? AND status IN (?, ?, ?) AND created_at < ?",
			teamRunID,
			model.AssignmentStatusPending,
			model.AssignmentStatusDispatched,
			model.AssignmentStatusRunning,
			deadline).
		Limit(1).
		Count(&count).Error
	return count > 0, err
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
	err := db.Where("team_run_id = ?", teamRunID).Order("created_at ASC, id ASC").Limit(500).Find(&artifacts).Error
	return artifacts, err
}

// AgentTeamEvent

// appendTeamEventMaxAttempts bounds how often AppendTeamEvent retries after
// losing the (team_run_id, seq) unique-index race (migration 0056) to a
// concurrent append. Each attempt re-reads MAX(seq) inside a fresh
// transaction, so a small bound is enough even under bursts.
const appendTeamEventMaxAttempts = 5

// isUniqueViolation reports whether err is a unique-constraint violation.
// Postgres surfaces SQLSTATE 23505 as "duplicate key value violates unique
// constraint"; SQLite (unit tests) reports "UNIQUE constraint failed". The
// substring match follows the existing isDuplicateKeyError convention in
// service/message.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate key") || strings.Contains(msg, "unique")
}

// AppendTeamEvent appends an event with the next per-run seq. The MAX(seq)+1
// read and the insert run in one transaction, and the unique index on
// (team_run_id, seq) turns a concurrent append racing the same seq into a
// unique violation instead of a silent duplicate; losing appenders retry with
// a freshly read MAX(seq).
func AppendTeamEvent(db *gorm.DB, event *model.AgentTeamEvent) error {
	if event.Payload == "" {
		event.Payload = "{}"
	}
	var lastErr error
	for attempt := 0; attempt < appendTeamEventMaxAttempts; attempt++ {
		err := db.Transaction(func(tx *gorm.DB) error {
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
		if err == nil {
			return nil
		}
		if !isUniqueViolation(err) {
			return err
		}
		lastErr = err
	}
	return lastErr
}

// maxTeamEventsPerRun caps the number of team events returned by
// ListTeamEventsByRun. Team events are append-only and can grow
// unboundedly over a long-running team run. The cap prevents
// unbounded memory consumption while being high enough for realistic
// team runs (1000 events = ~1-2 MB payload).
const maxTeamEventsPerRun = 10000

func ListTeamEventsByRun(db *gorm.DB, teamRunID string) ([]model.AgentTeamEvent, error) {
	var events []model.AgentTeamEvent
	err := db.Where("team_run_id = ?", teamRunID).Order("seq ASC, created_at ASC").Limit(maxTeamEventsPerRun).Find(&events).Error
	return events, err
}
