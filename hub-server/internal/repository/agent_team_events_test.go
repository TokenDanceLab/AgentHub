package repository

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// seedTeamEventRun creates the minimal team + run rows AppendTeamEvent needs.
func seedTeamEventRun(t *testing.T, db *gorm.DB) *model.AgentTeamRun {
	t.Helper()
	team := &model.AgentTeam{OwnerID: "user-1", Name: "Seq Team"}
	require.NoError(t, CreateTeam(db, team))
	run := &model.AgentTeamRun{
		TeamID:        team.ID,
		TriggerUserID: "user-1",
		Status:        model.TeamRunStatusRunning,
	}
	require.NoError(t, CreateTeamRun(db, run))
	return run
}

// registerSeqConflictInjector installs a create callback that steals the seq
// AppendTeamEvent just computed by inserting a competing row inside the same
// transaction, right before the event INSERT. This deterministically recreates
// what a concurrent appender committing first does to the unique index
// uq_agent_team_events_run_seq. maxInjections bounds how many attempts lose
// the race; the returned counter reports how many attempts ran.
func registerSeqConflictInjector(t *testing.T, db *gorm.DB, maxInjections int) *int {
	t.Helper()
	attempts := 0
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:inject_seq_conflict", func(tx *gorm.DB) {
		if tx.Statement == nil || tx.Statement.Table != "agent_team_events" {
			return
		}
		event, ok := tx.Statement.Dest.(*model.AgentTeamEvent)
		if !ok {
			return
		}
		attempts++
		if attempts > maxInjections {
			return
		}
		// Session(NewDB) keeps the transaction ConnPool but detaches from the
		// in-flight Create statement, so the raw INSERT joins the same tx.
		injected := tx.Session(&gorm.Session{NewDB: true}).Exec(
			`INSERT INTO agent_team_events (id, team_run_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, '{}', ?)`,
			fmt.Sprintf("injected-conflict-%d", attempts), event.TeamRunID, event.Seq, "test.conflict", time.Now(),
		)
		require.NoError(t, injected.Error)
	}))
	t.Cleanup(func() {
		require.NoError(t, db.Callback().Create().Remove("test:inject_seq_conflict"))
	})
	return &attempts
}

func TestAppendTeamEventRetriesOnSeqConflict(t *testing.T) {
	db := setupSQLite(t)
	run := seedTeamEventRun(t, db)
	attempts := registerSeqConflictInjector(t, db, 1)

	event := &model.AgentTeamEvent{
		TeamRunID: run.ID,
		Type:      model.TeamEventRunStarted,
		Payload:   `{"status":"running"}`,
	}
	require.NoError(t, AppendTeamEvent(db, event))

	assert.Equal(t, 2, *attempts, "first attempt must lose the unique race and be retried")
	assert.Equal(t, 1, event.Seq, "retry re-reads MAX(seq) after the conflicting tx rolled back")

	events, err := ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventRunStarted, events[0].Type)
	assert.Equal(t, 1, events[0].Seq)
}

func TestAppendTeamEventGivesUpAfterMaxAttempts(t *testing.T) {
	db := setupSQLite(t)
	run := seedTeamEventRun(t, db)
	attempts := registerSeqConflictInjector(t, db, appendTeamEventMaxAttempts+1)

	event := &model.AgentTeamEvent{
		TeamRunID: run.ID,
		Type:      model.TeamEventRunStarted,
		Payload:   `{"status":"running"}`,
	}
	err := AppendTeamEvent(db, event)
	require.Error(t, err)
	assert.True(t, isUniqueViolation(err), "exhausted retries must surface the unique violation, got: %v", err)
	assert.Equal(t, appendTeamEventMaxAttempts, *attempts, "append must stop after the bounded number of attempts")

	events, listErr := ListTeamEventsByRun(db, run.ID)
	require.NoError(t, listErr)
	assert.Empty(t, events, "every losing attempt must roll back, leaving no partial rows")
}

// TestAppendTeamEventUniqueIndexActiveInTestSchema guards the SQLite schema
// parity with migration 0056: a direct duplicate (team_run_id, seq) insert
// must fail with a unique violation, otherwise the retry tests above would
// pass vacuously.
func TestAppendTeamEventUniqueIndexActiveInTestSchema(t *testing.T) {
	db := setupSQLite(t)

	require.NoError(t, db.Exec(`INSERT INTO agent_team_events (id, team_run_id, seq, type, payload) VALUES ('pre', 'run-dup', 1, 'x', '{}')`).Error)
	err := db.Exec(`INSERT INTO agent_team_events (id, team_run_id, seq, type, payload) VALUES ('pre-2', 'run-dup', 1, 'x', '{}')`).Error
	require.Error(t, err)
	assert.True(t, isUniqueViolation(err))
}

// TestAppendTeamEventSingleAttemptWithoutConflict pins the fast path: with no
// competing writer the append continues the existing sequence in exactly one
// attempt.
func TestAppendTeamEventSingleAttemptWithoutConflict(t *testing.T) {
	db := setupSQLite(t)
	run := seedTeamEventRun(t, db)
	attempts := registerSeqConflictInjector(t, db, 0)

	first := &model.AgentTeamEvent{TeamRunID: run.ID, Type: model.TeamEventRunStarted, Payload: "{}"}
	require.NoError(t, AppendTeamEvent(db, first))
	second := &model.AgentTeamEvent{TeamRunID: run.ID, Type: model.TeamEventAgentMessage, Payload: "{}"}
	require.NoError(t, AppendTeamEvent(db, second))

	assert.Equal(t, 1, first.Seq)
	assert.Equal(t, 2, second.Seq)
	assert.Equal(t, 2, *attempts, "one attempt per append, no retries without conflict")
}

func TestIsUniqueViolation(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"gorm duplicated key", gorm.ErrDuplicatedKey, true},
		{"postgres 23505 text", errors.New(`ERROR: duplicate key value violates unique constraint "uq_agent_team_events_run_seq" (SQLSTATE 23505)`), true},
		{"sqlite unique text", errors.New("constraint failed: UNIQUE constraint failed: agent_team_events.team_run_id, agent_team_events.seq (2067)"), true},
		{"unrelated", errors.New("connection refused"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, isUniqueViolation(tc.err))
		})
	}
}

func TestLockTeamRunForEventAppendUsesPostgresRowLock(t *testing.T) {
	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	require.NoError(t, err)
	t.Cleanup(func() {
		mock.ExpectClose()
		require.NoError(t, sqlDB.Close())
		require.NoError(t, mock.ExpectationsWereMet())
	})

	db, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)

	mock.ExpectQuery(`SELECT id FROM agent_team_runs WHERE id = \$1 FOR UPDATE`).
		WithArgs("run-locked").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("run-locked"))
	require.NoError(t, lockTeamRunForEventAppend(db, "run-locked"))
}

func TestLockTeamRunForEventAppendRejectsMissingPostgresRun(t *testing.T) {
	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	require.NoError(t, err)
	t.Cleanup(func() {
		mock.ExpectClose()
		require.NoError(t, sqlDB.Close())
		require.NoError(t, mock.ExpectationsWereMet())
	})

	db, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)

	mock.ExpectQuery(`SELECT id FROM agent_team_runs WHERE id = \$1 FOR UPDATE`).
		WithArgs("run-missing").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	err = lockTeamRunForEventAppend(db, "run-missing")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
}

// TestAppendTeamEventConcurrentAppendsKeepSeqUniqueAndContiguous drives real
// concurrent appenders against one run and asserts the ledger invariant the
// unique index + retry are meant to guarantee: seq values are exactly 1..N
// with no duplicates and no holes. SQLite serializes the writers (single
// connection), so the loss/retry path itself is covered deterministically by
// TestAppendTeamEventRetriesOnSeqConflict above; this test pins the invariant
// under goroutine interleaving and the race detector, and exercises the same
// code CI/Postgres runs.
func TestAppendTeamEventConcurrentAppendsKeepSeqUniqueAndContiguous(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping concurrency test in -short mode")
	}
	db := setupSQLite(t)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	// glebarez/sqlite gives every pooled connection its own private :memory:
	// database; a single connection keeps all goroutines on the shared one.
	sqlDB.SetMaxOpenConns(1)
	run := seedTeamEventRun(t, db)

	const appenders = 24
	var wg sync.WaitGroup
	errs := make([]error, appenders)
	for i := 0; i < appenders; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = AppendTeamEvent(db, &model.AgentTeamEvent{
				TeamRunID: run.ID,
				Type:      model.TeamEventAgentMessage,
				Payload:   fmt.Sprintf(`{"appender":%d}`, i),
			})
		}(i)
	}
	wg.Wait()
	for i, appendErr := range errs {
		require.NoError(t, appendErr, "appender %d", i)
	}

	events, err := ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, appenders)
	seen := make(map[int]bool, appenders)
	for _, event := range events {
		assert.False(t, seen[event.Seq], "duplicate seq %d", event.Seq)
		seen[event.Seq] = true
	}
	for seq := 1; seq <= appenders; seq++ {
		assert.True(t, seen[seq], "missing seq %d", seq)
	}
}
