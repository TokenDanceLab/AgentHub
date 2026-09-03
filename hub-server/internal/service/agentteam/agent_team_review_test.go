package agentteam

import (
	"context"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ── Human Review Gate (ADR-008) ────────────────────────────────

func TestHumanReviewGate(t *testing.T) {
	t.Run("disabled by default rejects review API", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		team, _, executor, run := seedAgentTeamRun(t, db)

		// HandleRouteDecision should proceed normally (no pending_review).
		assignment, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)
		require.NotNil(t, assignment)

		// Verify the run is still in running state, not pending_review.
		gotRun, err := repository.GetTeamRunByID(db, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.TeamRunStatusRunning, gotRun.Status)

		// Calling ReviewDagPlan when disabled should fail.
		_, err = svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
			Action: model.ReviewActionApprove,
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, errcode.ErrBadRequest)
	})

	t.Run("enabled sets pending_review after route decision", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		team, _, executor, run := seedAgentTeamRun(t, db)

		assignment, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)
		require.NotNil(t, assignment)

		// Verify the run is now pending_review.
		gotRun, err := repository.GetTeamRunByID(db, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.TeamRunStatusPendingReview, gotRun.Status)

		// Verify review_pending event was recorded.
		events, err := repository.ListTeamEventsByRun(db, run.ID)
		require.NoError(t, err)
		foundPending := false
		for _, e := range events {
			if e.Type == model.TeamEventReviewPending {
				foundPending = true
				break
			}
		}
		assert.True(t, foundPending, "expected team.review.pending event")
	})

	t.Run("enabled approve transitions back to running", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		team, _, executor, run := seedAgentTeamRun(t, db)

		_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)

		// Review: approve
		state, err := svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
			Action:  model.ReviewActionApprove,
			Comment: "looks good",
		})
		require.NoError(t, err)
		assert.Equal(t, model.ReviewActionApprove, state.Action)
		assert.Equal(t, "looks good", state.Comment)

		// Verify the run is back to running.
		gotRun, err := repository.GetTeamRunByID(db, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.TeamRunStatusRunning, gotRun.Status)

		// Verify review_decided event was recorded.
		events, err := repository.ListTeamEventsByRun(db, run.ID)
		require.NoError(t, err)
		foundDecided := false
		for _, e := range events {
			if e.Type == model.TeamEventReviewDecided {
				foundDecided = true
				break
			}
		}
		assert.True(t, foundDecided, "expected team.review.decided event")

		// The replay projection must leave the review gate too: before the
		// ReviewDecided replay fix the client-facing GetTeamRunState stayed
		// pending_review forever even though the DB row was already running.
		runState, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.TeamRunStatusRunning, runState.Status)
		require.Len(t, runState.Reviews, 1)
		assert.Equal(t, model.ReviewActionApprove, runState.Reviews[0].Action)
	})

	t.Run("decided review restores running in projection for discuss and modify", func(t *testing.T) {
		for _, action := range []string{model.ReviewActionDiscuss, model.ReviewActionModify} {
			db := setupAgentTeamStateSQLite(t)
			svc := NewAgentTeamService(db, nil, nil)
			svc.SetHumanReviewEnabled(true)
			team, _, executor, run := seedAgentTeamRun(t, db)

			_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
				Action:       "delegate",
				NextWorker:   executor.ID,
				Instructions: "Do the thing",
			})
			require.NoError(t, err)

			_, err = svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
				Action:  action,
				Comment: "not yet",
			})
			require.NoError(t, err)

			// Write side sets the DB row back to running for every decided
			// action; the projection must agree.
			runState, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
			require.NoError(t, err)
			assert.Equal(t, model.TeamRunStatusRunning, runState.Status, "action=%s", action)
		}
	})

	t.Run("enabled discuss cancels pending assignments", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		team, _, executor, run := seedAgentTeamRun(t, db)

		_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)

		// Verify assignment is pending before review.
		assignments, err := repository.ListAssignmentsByTeamRun(db, run.ID)
		require.NoError(t, err)
		require.Len(t, assignments, 1)
		assert.Equal(t, model.AssignmentStatusPending, assignments[0].Status)

		// Review: discuss
		state, err := svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
			Action:  model.ReviewActionDiscuss,
			Comment: "needs more thought",
		})
		require.NoError(t, err)
		assert.Equal(t, model.ReviewActionDiscuss, state.Action)

		// Verify the run is back to running (so supervisor can re-plan).
		gotRun, err := repository.GetTeamRunByID(db, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.TeamRunStatusRunning, gotRun.Status)

		// Verify assignments were cancelled.
		assignments, err = repository.ListAssignmentsByTeamRun(db, run.ID)
		require.NoError(t, err)
		require.Len(t, assignments, 1)
		assert.Equal(t, model.AssignmentStatusCancelled, assignments[0].Status)
	})

	t.Run("enabled modify cancels pending assignments with changes recorded", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		team, _, executor, run := seedAgentTeamRun(t, db)

		_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)

		state, err := svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
			Action: model.ReviewActionModify,
			Changes: []model.HumanReviewChange{
				{Field: "instructions", Value: "Do the other thing"},
				{Field: "next_worker", Value: "worker-2"},
			},
			Comment: "change the target",
		})
		require.NoError(t, err)
		assert.Equal(t, model.ReviewActionModify, state.Action)
		assert.Len(t, state.Changes, 2)
		assert.Equal(t, "instructions", state.Changes[0].Field)

		// Verify the run is back to running.
		gotRun, err := repository.GetTeamRunByID(db, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.TeamRunStatusRunning, gotRun.Status)

		// Verify assignments were cancelled.
		assignments, err := repository.ListAssignmentsByTeamRun(db, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.AssignmentStatusCancelled, assignments[0].Status)
	})

	t.Run("review rejects invalid action", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		team, _, executor, run := seedAgentTeamRun(t, db)

		_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)

		_, err = svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
			Action: "bogus",
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, errcode.ErrBadRequest)
	})

	t.Run("review rejects non-pending_review status", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		_, _, _, run := seedAgentTeamRun(t, db) // run status is "running"

		_, err := svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
			Action: model.ReviewActionApprove,
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, errcode.ErrBadRequest)
	})

	t.Run("review rejects non-owner user", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		team, _, executor, run := seedAgentTeamRun(t, db)

		_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)

		_, err = svc.ReviewDagPlan(context.Background(), "intruder-user", run.ID, model.HumanReviewDecision{
			Action: model.ReviewActionApprove,
		})
		require.Error(t, err)
		assert.Equal(t, errcode.AgentTaskNotFound, err)
	})
}
