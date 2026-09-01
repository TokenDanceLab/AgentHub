package repository

import (
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func insertTeamRunForCASTest(t *testing.T, db *gorm.DB, id, status string) {
	t.Helper()
	require.NoError(t, db.Exec(`INSERT INTO agent_team_runs (id, team_id, trigger_user_id, status, created_at, updated_at)
		VALUES (?, 'team-1', 'user-1', ?, datetime('now'), datetime('now'))`, id, status).Error)
}

func TestUpdateTeamRunStatusIf_MatchingStatus_Claimed(t *testing.T) {
	db := setupSQLite(t)
	insertTeamRunForCASTest(t, db, "run-claim", model.TeamRunStatusPendingReview)

	updated, err := UpdateTeamRunStatusIf(db, "run-claim",
		model.TeamRunStatusPendingReview, model.TeamRunStatusRunning)
	require.NoError(t, err)
	require.Equal(t, int64(1), updated)

	run, err := GetTeamRunByID(db, "run-claim")
	require.NoError(t, err)
	require.Equal(t, model.TeamRunStatusRunning, run.Status)
}

func TestUpdateTeamRunStatusIf_NonMatchingStatus_NotClaimed(t *testing.T) {
	db := setupSQLite(t)
	for _, status := range []string{
		model.TeamRunStatusRunning,
		model.TeamRunStatusCompleted,
		model.TeamRunStatusFailed,
		model.TeamRunStatusCancelled,
	} {
		id := "run-" + status
		insertTeamRunForCASTest(t, db, id, status)

		updated, err := UpdateTeamRunStatusIf(db, id,
			model.TeamRunStatusPendingReview, model.TeamRunStatusRunning)
		require.NoError(t, err)
		require.Equal(t, int64(0), updated, "status %s must not be claimed", status)

		run, err := GetTeamRunByID(db, id)
		require.NoError(t, err)
		require.Equal(t, status, run.Status)
	}
}

func TestUpdateTeamRunStatusIf_MissingRun_NoError(t *testing.T) {
	db := setupSQLite(t)
	updated, err := UpdateTeamRunStatusIf(db, "run-ghost",
		model.TeamRunStatusPendingReview, model.TeamRunStatusRunning)
	require.NoError(t, err)
	require.Equal(t, int64(0), updated)
}
