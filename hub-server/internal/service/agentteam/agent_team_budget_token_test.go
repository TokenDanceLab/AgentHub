package agentteam

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/agentevent"
	"gorm.io/gorm"
)

// addTokenUsageColumnToTestDB adds the token_usage_total column to the
// agent_team_runs table for tests that exercise the budget guard fast path.
// The shared setupAgentTeamStateSQLite fixture predates migration 0066 and
// does not include the column; this ALTER is the minimal additive patch so
// the existing fixture stays untouched (it is out of this lane's file scope).
func addTokenUsageColumnToTestDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	err := db.Exec("ALTER TABLE agent_team_runs ADD COLUMN token_usage_total BIGINT").Error
	if err != nil && !isSQLiteDuplicateColumnErr(err) {
		require.NoError(t, err)
	}
}

// isSQLiteDuplicateColumnErr reports whether err is the SQLite "duplicate column
// name" error from ALTER TABLE ADD COLUMN when the column already exists, so
// re-runs on a DB that already has the column are tolerated.
func isSQLiteDuplicateColumnErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate column name")
}

// TestTeamRunBudgetExceededDB_FastPathShortCircuitsOnCounter pins the O(1)
// fast path: when token_usage_total is non-NULL and >= MaxTeamRunBudgetTokens,
// the guard returns true WITHOUT scanning any assignments/tasks/events. This
// is the core fix for the route-decision hot-path regression where every
// route decision scanned the full event set inside the per-run lock.
func TestTeamRunBudgetExceededDB_FastPathShortCircuitsOnCounter(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	addTokenUsageColumnToTestDB(t, db)
	_, _, _, run := seedAgentTeamRun(t, db)

	// Seed the counter to the budget cap via the same repository path the edge
	// callback uses, so the test exercises the real increment contract.
	svc := NewAgentTeamServiceWithGuardrails(db, nil, nil, AgentTeamGuardrails{
		MaxTeamRunBudgetTokens: 1000,
	})
	require.NoError(t, repository.IncrementTeamRunTokenUsage(db, run.ID, 1000))

	exceeded, err := svc.teamRunBudgetExceededDB(db, run.ID)
	require.NoError(t, err)
	assert.True(t, exceeded, "counter at cap must short-circuit to exceeded without event scan")

	// Verify no events were needed: the run has zero assignments/tasks/events,
	// so a non-fast-path guard would return false. The true result proves the
	// counter fast path was taken.
	events, err := repository.ListAgentRunEventsByTaskIDs(db, teamAgentTaskIDs(nil, nil))
	require.NoError(t, err)
	assert.Empty(t, events, "fast path must not require any events to exist")
}

// TestTeamRunBudgetExceededDB_NilCounterFallsBackToProjection pins backward
// compatibility: when token_usage_total is NULL (never incremented, e.g. a
// pre-backfill historical run), the guard falls back to the existing event
// projection and behaves identically to the pre-0066 path.
func TestTeamRunBudgetExceededDB_NilCounterFallsBackToProjection(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	addTokenUsageColumnToTestDB(t, db)
	_, _, executor, run := seedAgentTeamRun(t, db)

	// Seed an event whose projected total exceeds the tiny budget cap, with
	// the counter still NULL (no increment).
	agentTaskID := "budget-fallback-task"
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusDone,
		Objective:        "fallback projection",
		RunID:            &agentTaskID,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          agentTaskID,
		EdgeRunID:       "edge-fallback",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.result",
		Payload:         `{"usage":{"input_tokens":600,"output_tokens":500}}`,
	}))

	svc := NewAgentTeamServiceWithGuardrails(db, nil, nil, AgentTeamGuardrails{
		MaxTeamRunBudgetTokens: 1000,
	})
	exceeded, err := svc.teamRunBudgetExceededDB(db, run.ID)
	require.NoError(t, err)
	assert.True(t, exceeded, "NULL counter must fall back to projection which sees 1100 >= 1000")
}

// TestTeamRunBudgetExceededDB_TakesMaxOfCounterAndProjection pins the
// monotonicity guarantee: when both the counter and the projection are
// present, the guard uses max(counter, projection) so a stale or lagging
// counter never under-reports. Here the counter is below cap but the
// projection exceeds it, so the guard must still return exceeded.
func TestTeamRunBudgetExceededDB_TakesMaxOfCounterAndProjection(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	addTokenUsageColumnToTestDB(t, db)
	_, _, executor, run := seedAgentTeamRun(t, db)

	agentTaskID := "budget-max-task"
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusDone,
		Objective:        "max of counter and projection",
		RunID:            &agentTaskID,
	}))
	// Counter at 400 (below the 1000 cap).
	require.NoError(t, repository.IncrementTeamRunTokenUsage(db, run.ID, 400))
	// Projection at 1200 (above the 1000 cap) via a single event.
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          agentTaskID,
		EdgeRunID:       "edge-max",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.result",
		Payload:         `{"usage":{"input_tokens":700,"output_tokens":500}}`,
	}))

	svc := NewAgentTeamServiceWithGuardrails(db, nil, nil, AgentTeamGuardrails{
		MaxTeamRunBudgetTokens: 1000,
	})
	exceeded, err := svc.teamRunBudgetExceededDB(db, run.ID)
	require.NoError(t, err)
	assert.True(t, exceeded, "max(400, 1200)=1200 >= 1000 must exceed even though counter alone is under cap")
}

// TestTokenUsageTotalFromPayload pins the counter delta extraction used by the
// edge stream callback. Covers nested usage objects, direct fields, derived
// total, and zero/missing cases so the increment path never mis-counts.
func TestTokenUsageTotalFromPayload(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		want    int64
	}{
		{
			name:    "nested usage with total",
			payload: `{"usage":{"input_tokens":100,"output_tokens":200,"total_tokens":350}}`,
			want:    350,
		},
		{
			name:    "nested usage derived total (no total field)",
			payload: `{"usage":{"input_tokens":600,"output_tokens":400}}`,
			want:    1000,
		},
		{
			name:    "nested token_usage camelCase",
			payload: `{"tokenUsage":{"input":50,"output":50}}`,
			want:    100,
		},
		{
			name:    "direct total field",
			payload: `{"totalTokens":42}`,
			want:    42,
		},
		{
			name:    "no token usage",
			payload: `{"event":"run.agent.stdout","text":"hello"}`,
			want:    0,
		},
		{
			name:    "empty payload",
			payload: "",
			want:    0,
		},
		{
			name:    "invalid JSON",
			payload: `{not json`,
			want:    0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := agentevent.TokenUsageTotalFromPayload(tt.payload)
			assert.Equal(t, tt.want, got)
		})
	}
}
