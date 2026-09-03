package repository

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// TestIsUniqueViolation_AgentRunEventIdempotentPath covers the duplicate-key
// classifier used by the CreateAgentRunEventWithNextSeqLimited idempotent-retry
// path. It must recognize Postgres ("duplicate key value violates unique
// constraint"), SQLite ("UNIQUE constraint failed: ..."), and be
// case-insensitive, while rejecting unrelated errors and nil.
//
// Renamed from TestIsDuplicateKeyError and repointed at isUniqueViolation when
// #2244 slice 1 deleted the package-private isDuplicateKeyError copy this test
// used to exercise; the table below is unchanged, every `want` value included,
// and all six cases still pass against the converged implementation.
func TestIsUniqueViolation_AgentRunEventIdempotentPath(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"postgres duplicate key", fmt.Errorf("ERROR: duplicate key value violates unique constraint"), true},
		{"sqlite UNIQUE uppercase", fmt.Errorf("UNIQUE constraint failed: agent_run_events(task_id, event_seq)"), true},
		{"sqlite unique lowercase", fmt.Errorf("unique constraint failed: agent_run_events.task_id, agent_run_events.event_seq"), true},
		{"unrelated error", fmt.Errorf("connection refused"), false},
		{"record not found", gorm.ErrRecordNotFound, false},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, isUniqueViolation(c.err))
		})
	}
}

// setupSQLiteWithUniqueEventSeq opens an in-memory SQLite with the
// agent_run_events table plus a UNIQUE constraint on (task_id, event_seq),
// so the 23505 idempotent path can be exercised. The shared setupSQLite
// helper does not include this unique index, so a local helper is used to
// avoid changing the shared test schema (which other tests depend on).
// eventSeqFixtureSeq numbers each setupSQLiteWithUniqueEventSeq call (#2260).
var eventSeqFixtureSeq atomic.Uint64

func setupSQLiteWithUniqueEventSeq(t *testing.T) *gorm.DB {
	t.Helper()
	// The DSN must be unique per invocation: `file::memory:?cache=shared` names
	// ONE process-global database, so with -count=2 the second round reused
	// round one's rows and the "exactly one row per caller" invariant counted
	// 50 instead of 25 — deterministically red, and invisible to CI because it
	// runs -count=1 (#2260). Closing the handle on cleanup destroys the
	// shared-cache database instead of leaving it resident for the next round.
	dsn := fmt.Sprintf("file:agent23505_%d?mode=memory&cache=shared", eventSeqFixtureSeq.Add(1))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	// Force a single shared connection so all goroutines see the same
	// in-memory database (otherwise :memory: creates a per-connection DB
	// and concurrent transactions hit "no such table").
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.Exec(`CREATE TABLE IF NOT EXISTS agent_run_events (
		id TEXT PRIMARY KEY,
		task_id TEXT NOT NULL,
		edge_run_id TEXT DEFAULT '',
		session_id TEXT NOT NULL DEFAULT '',
		agent_instance_id TEXT NOT NULL DEFAULT '',
		event_seq INTEGER NOT NULL,
		event_type TEXT NOT NULL DEFAULT '',
		payload TEXT NOT NULL DEFAULT '',
		created_at DATETIME
	)`).Error)
	// The unique index that makes a concurrent (task_id, event_seq) insert
	// return a duplicate-key error, which CreateAgentRunEventWithNextSeqLimited
	// must treat as idempotent success after requerying.
	require.NoError(t, db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_run_events_task_seq ON agent_run_events(task_id, event_seq)`).Error)
	return db
}

// TestCreateAgentRunEventWithNextSeqLimited_ConcurrentInsertsNoSpuriousError
// is a regression test for the 23505 idempotent path: when multiple
// goroutines race to append the "next" event for the same task, the losers
// (whose insert hits the unique constraint) must be treated as idempotent
// success (return nil) rather than surfacing a spurious duplicate-key error
// to the caller's retry. The final row count for the task must equal the
// number of callers (one event seq per caller, no duplicates, no losses).
//
// SQLite serializes writes, so not every run triggers a 23505 — but the
// invariant holds either way: every caller returns nil and exactly one row
// per caller survives.
func TestCreateAgentRunEventWithNextSeqLimited_ConcurrentInsertsNoSpuriousError(t *testing.T) {
	db := setupSQLiteWithUniqueEventSeq(t)
	const taskID = "task-concurrent"
	const numCallers = 25

	var wg sync.WaitGroup
	errs := make(chan error, numCallers)
	start := make(chan struct{})
	for i := 0; i < numCallers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			evt := &model.AgentRunEvent{
				TaskID:          taskID,
				SessionID:       "sess-1",
				AgentInstanceID: "ai-1",
				EventType:       "stream",
				Payload:         fmt.Sprintf("caller-%d", idx),
			}
			errs <- CreateAgentRunEventWithNextSeqLimited(db, evt, 0)
		}(i)
	}
	close(start)
	wg.Wait()
	close(errs)

	for err := range errs {
		require.NoError(t, err, "concurrent CreateAgentRunEventWithNextSeqLimited must not surface a spurious duplicate-key error")
	}

	var count int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Where("task_id = ?", taskID).Count(&count).Error)
	assert.Equal(t, int64(numCallers), count, "exactly one event per caller must survive (no duplicates, no losses)")
}
