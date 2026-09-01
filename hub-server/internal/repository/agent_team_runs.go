package repository

import (
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// AgentTeamRun

func CreateTeamRun(db *gorm.DB, run *model.AgentTeamRun) error {
	return db.Create(run).Error
}

func GetTeamRunByID(db *gorm.DB, runID string) (*model.AgentTeamRun, error) {
	var r model.AgentTeamRun
	err := db.Where("id = ?", runID).First(&r).Error
	return &r, err
}

// LockTeamRunForUpdate serializes check-then-write operations for one run.
// PostgreSQL uses a row-level FOR UPDATE lock. The SQLite fallback performs a
// no-op update so integration tests exercise a real write lock as well.
func LockTeamRunForUpdate(db *gorm.DB, runID string) error {
	if db.Name() == "postgres" {
		var id string
		if err := db.Raw("SELECT id FROM agent_team_runs WHERE id = ? FOR UPDATE", runID).Scan(&id).Error; err != nil {
			return err
		}
		if id == "" {
			return gorm.ErrRecordNotFound
		}
		return nil
	}
	result := db.Model(&model.AgentTeamRun{}).
		Where("id = ?", runID).
		UpdateColumn("updated_at", gorm.Expr("updated_at"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
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

// UpdateTeamRunStatusIf transitions a run's status only when the current
// status equals fromStatus. The conditional WHERE makes the check-and-write
// atomic so racing callers cannot both claim the same state (e.g. two
// concurrent ReviewDagPlan decisions on one pending_review run). Returns the
// number of rows updated (0 when the run was already claimed, has moved on,
// or does not exist).
func UpdateTeamRunStatusIf(db *gorm.DB, runID, fromStatus, toStatus string) (int64, error) {
	res := db.Model(&model.AgentTeamRun{}).
		Where("id = ? AND status = ?", runID, fromStatus).
		Update("status", toStatus)
	return res.RowsAffected, res.Error
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
