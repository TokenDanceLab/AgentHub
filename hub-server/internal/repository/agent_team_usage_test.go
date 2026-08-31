package repository

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// routeDecisionPayload builds a JSON payload matching the shape produced by
// the service layer for team.route.decided events. Keys are intentionally
// spelled the same as in production so the SQL JSONB/json_extract paths hit.
func routeDecisionPayload(action, nextWorker, instructions string) string {
	b, _ := json.Marshal(map[string]string{
		"action":       action,
		"next_worker":  nextWorker,
		"instructions": instructions,
	})
	return string(b)
}

// seedRouteDecisionRun creates a team + run fixture for CountTeamRouteDecisions
// tests. Returns the run ID.
func seedRouteDecisionRun(t *testing.T, db *gorm.DB) string {
	t.Helper()
	team := &model.AgentTeam{OwnerID: "user-crd", Name: "CRD Team"}
	require.NoError(t, CreateTeam(db, team))
	run := &model.AgentTeamRun{
		TeamID:        team.ID,
		TriggerUserID: "user-crd",
		Status:        model.TeamRunStatusRunning,
	}
	require.NoError(t, CreateTeamRun(db, run))
	return run.ID
}

// appendRouteEvent inserts a team.route.decided event with the given payload
// fields using AppendTeamEvent so seq assignment and uniqueness follow the
// production path.
func appendRouteEvent(t *testing.T, db *gorm.DB, runID, action, worker, instructions string) {
	t.Helper()
	ev := &model.AgentTeamEvent{
		TeamRunID: runID,
		Type:      model.TeamEventRouteDecided,
		Payload:   routeDecisionPayload(action, worker, instructions),
	}
	require.NoError(t, AppendTeamEvent(db, ev))
}

// TestCountTeamRouteDecisions_EmptyRun verifies that counting against a run
// with no events returns 0 rather than an error or NULL-induced panic.
func TestCountTeamRouteDecisions_EmptyRun(t *testing.T) {
	db := setupSQLite(t)
	runID := seedRouteDecisionRun(t, db)

	count, err := CountTeamRouteDecisionsByActionWorkerInstructions(
		db, runID, "delegate", "worker-a", "do something",
	)
	require.NoError(t, err)
	assert.Equal(t, 0, count, "empty run must report zero matches")
}

// TestCountTeamRouteDecisions_NoMatch verifies that events of a different
// type, or matching type but non-matching payload fields, do not contribute.
func TestCountTeamRouteDecisions_NoMatch(t *testing.T) {
	db := setupSQLite(t)
	runID := seedRouteDecisionRun(t, db)

	// Wrong type: should never match regardless of payload.
	wrongType := &model.AgentTeamEvent{
		TeamRunID: runID,
		Type:      model.TeamEventRunStarted,
		Payload:   routeDecisionPayload("delegate", "worker-a", "do something"),
	}
	require.NoError(t, AppendTeamEvent(db, wrongType))

	// Right type but every field differs.
	appendRouteEvent(t, db, runID, "finish", "worker-b", "different task")

	count, err := CountTeamRouteDecisionsByActionWorkerInstructions(
		db, runID, "delegate", "worker-a", "do something",
	)
	require.NoError(t, err)
	assert.Equal(t, 0, count, "non-matching events must not be counted")
}

// TestCountTeamRouteDecisions_MatchesExactAndNormalized exercises the three
// normalization rules the SQL must mirror from routeDecisionMatches:
//   - action is case-insensitive and whitespace-trimmed
//   - next_worker is case-sensitive and whitespace-trimmed
//   - instructions is case-sensitive and whitespace-trimmed
//
// It also asserts that a missing JSON key (finish decisions omit next_worker)
// matches the empty-string probe via COALESCE.
func TestCountTeamRouteDecisions_MatchesExactAndNormalized(t *testing.T) {
	db := setupSQLite(t)
	runID := seedRouteDecisionRun(t, db)

	// Exact match.
	appendRouteEvent(t, db, runID, "delegate", "worker-a", "do something")
	// Case-insensitive action + surrounding whitespace on all three fields.
	appendRouteEvent(t, db, runID, "  Delegate  ", " worker-a ", " do something ")
	// Different action case still matches because action is folded.
	appendRouteEvent(t, db, runID, "DELEGATE", "worker-a", "do something")
	// Wrong worker (case-sensitive) — must NOT match.
	appendRouteEvent(t, db, runID, "delegate", "Worker-A", "do something")
	// Finish decision with no next_worker key → treated as "" by COALESCE.
	finishNoWorker := &model.AgentTeamEvent{
		TeamRunID: runID,
		Type:      model.TeamEventRouteDecided,
		Payload:   `{"action":"finish","instructions":"wrap up"}`,
	}
	require.NoError(t, AppendTeamEvent(db, finishNoWorker))

	count, err := CountTeamRouteDecisionsByActionWorkerInstructions(
		db, runID, "delegate", "worker-a", "do something",
	)
	require.NoError(t, err)
	assert.Equal(t, 3, count, "must count exact + normalized variants, exclude wrong-case worker")

	// Finish-with-empty-worker probe must match the keyless payload above.
	finishCount, err := CountTeamRouteDecisionsByActionWorkerInstructions(
		db, runID, "finish", "", "wrap up",
	)
	require.NoError(t, err)
	assert.Equal(t, 1, finishCount, "missing next_worker key must equal empty-string probe")
}

// TestCountTeamRouteDecisions_IsolatesByRun ensures events from run A never
// leak into run B's count — the team_run_id predicate is mandatory.
func TestCountTeamRouteDecisions_IsolatesByRun(t *testing.T) {
	db := setupSQLite(t)
	runA := seedRouteDecisionRun(t, db)
	// Second run under the same team.
	team := &model.AgentTeam{OwnerID: "user-crd", Name: "CRD Team B"}
	require.NoError(t, CreateTeam(db, team))
	runBModel := &model.AgentTeamRun{
		TeamID:        team.ID,
		TriggerUserID: "user-crd",
		Status:        model.TeamRunStatusRunning,
	}
	require.NoError(t, CreateTeamRun(db, runBModel))
	runB := runBModel.ID

	for i := 0; i < 5; i++ {
		appendRouteEvent(t, db, runA, "delegate", "w", fmt.Sprintf("a-%d", i))
	}
	for i := 0; i < 3; i++ {
		appendRouteEvent(t, db, runB, "delegate", "w", fmt.Sprintf("b-%d", i))
	}

	countA, err := CountTeamRouteDecisionsByActionWorkerInstructions(db, runA, "delegate", "w", "a-2")
	require.NoError(t, err)
	assert.Equal(t, 1, countA, "run A must see only its own events")

	countB, err := CountTeamRouteDecisionsByActionWorkerInstructions(db, runB, "delegate", "w", "a-2")
	require.NoError(t, err)
	assert.Equal(t, 0, countB, "run B must not see run A's events")
}
