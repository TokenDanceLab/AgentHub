package repository

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

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

// UpdateAssignmentStatusIf transitions an assignment only when its current
// status is one of fromStatuses (CAS). Returns rows affected so callers can
// treat 0 as a lost race / already-terminal outcome (#1419).
func UpdateAssignmentStatusIf(db *gorm.DB, id string, fromStatuses []string, status string, result string) (int64, error) {
	if len(fromStatuses) == 0 {
		return 0, nil
	}
	updates := map[string]interface{}{
		"status": status,
		"result": result,
	}
	res := db.Model(&model.AgentTeamAssignment{}).
		Where("id = ? AND status IN ?", id, fromStatuses).
		Updates(updates)
	return res.RowsAffected, res.Error
}

// ClaimAssignmentForDispatch atomically transitions a pending assignment to
// dispatched, but only when the current status is still 'pending' (CAS). The
// run_id is bound separately after TriggerAgentTask returns a pending task ID.
// Returns the number of rows updated: 1 on success, 0 when another caller
// already claimed it. The caller must interpret 0 rows as "already dispatched".
func ClaimAssignmentForDispatch(db *gorm.DB, id string) (int64, error) {
	res := db.Model(&model.AgentTeamAssignment{}).
		Where("id = ? AND status = ?", id, model.AssignmentStatusPending).
		Update("status", model.AssignmentStatusDispatched)
	return res.RowsAffected, res.Error
}

// ReleaseAssignmentDispatchClaim reverts a pre-trigger claim only while it is
// still unbound. Once run_id is present the external trigger has succeeded and
// must never be made dispatchable again.
func ReleaseAssignmentDispatchClaim(db *gorm.DB, id string) (int64, error) {
	res := db.Model(&model.AgentTeamAssignment{}).
		Where("id = ? AND status = ? AND run_id IS NULL", id, model.AssignmentStatusDispatched).
		Update("status", model.AssignmentStatusPending)
	return res.RowsAffected, res.Error
}

// BindClaimedAssignmentDispatch binds the external task only for the caller
// that owns an unbound dispatched claim. Status stays dispatched until
// MarkAssignmentRunningIfDispatched records that the task was handed off.
func BindClaimedAssignmentDispatch(db *gorm.DB, id, pendingTaskID string) (int64, error) {
	res := db.Model(&model.AgentTeamAssignment{}).
		Where("id = ? AND status = ? AND run_id IS NULL", id, model.AssignmentStatusDispatched).
		Update("run_id", pendingTaskID)
	return res.RowsAffected, res.Error
}

// MarkAssignmentRunningIfDispatched advances a successfully bound assignment
// from dispatched → running. Requires run_id so an unbound claim cannot jump
// ahead of TriggerAgentTask. Returns rows affected (0 when already advanced
// or no longer dispatched).
func MarkAssignmentRunningIfDispatched(db *gorm.DB, id string) (int64, error) {
	res := db.Model(&model.AgentTeamAssignment{}).
		Where("id = ? AND status = ? AND run_id IS NOT NULL", id, model.AssignmentStatusDispatched).
		Update("status", model.AssignmentStatusRunning)
	return res.RowsAffected, res.Error
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

// maxTimedOutAssignmentScan caps one background timeout sweep so a backlog
// cannot monopolize the scanner tick.
const maxTimedOutAssignmentScan = 200

// ListTimedOutActiveAssignments returns active assignments whose created_at is
// older than deadline, oldest first. Used by the background timeout terminator
// (the symmetric write-side of HasTimedOutActiveAssignment).
func ListTimedOutActiveAssignments(db *gorm.DB, deadline time.Time, limit int) ([]model.AgentTeamAssignment, error) {
	if limit <= 0 || limit > maxTimedOutAssignmentScan {
		limit = maxTimedOutAssignmentScan
	}
	var assignments []model.AgentTeamAssignment
	err := db.Model(&model.AgentTeamAssignment{}).
		Where("status IN (?, ?, ?) AND created_at < ?",
			model.AssignmentStatusPending,
			model.AssignmentStatusDispatched,
			model.AssignmentStatusRunning,
			deadline).
		Order("created_at ASC").
		Limit(limit).
		Find(&assignments).Error
	return assignments, err
}
