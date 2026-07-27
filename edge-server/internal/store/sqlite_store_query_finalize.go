package store

import (
	"errors"
	"time"
)

// sqlite_store_query_finalize.go holds pure finalize/plan/should helpers and
// background cleanup constants peeled from sqlite_store_query.go.
// No *sql.DB / *sql.Tx / IO ownership.

// ── residual pure helpers (#1032) ──
// Background intervals, load/persist finalize plans, and projection payload maps.
// No *sql.DB / *sql.Tx / IO ownership.

// sqliteBackgroundLoopInterval is the shared period for WAL checkpoint and
// terminal-run cleanup loops started by NewSQLite.
const sqliteBackgroundLoopInterval = 5 * time.Minute

// sqliteCleanupTerminalTTL is the default age cutoff for terminal runs cleaned
// by the periodic cleanup loop.
const sqliteCleanupTerminalTTL = 24 * time.Hour

// sqliteCleanupMaxTerminalRunsPerThread is the default per-thread cap for
// retained terminal runs in the periodic cleanup loop.
const sqliteCleanupMaxTerminalRunsPerThread = 50

// sqlitePeriodicCleanupOptions returns the fixed RunCleanupOptions used by the
// background cleanup loop. Pure — no Store access.
func sqlitePeriodicCleanupOptions() RunCleanupOptions {
	return RunCleanupOptions{
		TerminalTTL:              sqliteCleanupTerminalTTL,
		MaxTerminalRunsPerThread: sqliteCleanupMaxTerminalRunsPerThread,
	}
}

// sqliteLoadSourcePlan chooses between row-first and legacy snapshot load paths.
type sqliteLoadSourcePlan struct {
	UseRows     bool
	UseSnapshot bool
}

// planSQLiteLoadSource maps loadSQLiteRows "ok" into the load branch to take.
func planSQLiteLoadSource(rowsLoaded bool) sqliteLoadSourcePlan {
	if rowsLoaded {
		return sqliteLoadSourcePlan{UseRows: true}
	}
	return sqliteLoadSourcePlan{UseSnapshot: true}
}

// legacySnapshotLoadPlan decides how to treat a legacy snapshot QueryRow result.
// isNoRows is supplied by the caller (errors.Is(err, sql.ErrNoRows)) so this
// file stays free of database/sql.
type legacySnapshotLoadPlan struct {
	Skip   bool // empty DB or blank payload — treat as empty store
	Decode bool // decode + apply payload
	Fail   bool // surface a read error
}

// planLegacySnapshotLoad maps QueryRow outcomes into skip / decode / fail.
func planLegacySnapshotLoad(isNoRows bool, err error, payload string) legacySnapshotLoadPlan {
	if isNoRows {
		return legacySnapshotLoadPlan{Skip: true}
	}
	if err != nil {
		return legacySnapshotLoadPlan{Fail: true}
	}
	if isBlankSQLiteSnapshotPayload(payload) {
		return legacySnapshotLoadPlan{Skip: true}
	}
	return legacySnapshotLoadPlan{Decode: true}
}

// shouldSkipPersistOnProjectExists preserves CreateProject soft-exists semantics:
// ErrProjectExists is returned without attempting syncPersist.
func shouldSkipPersistOnProjectExists(err error) bool {
	return errors.Is(err, ErrProjectExists)
}

// shouldSyncAfterCleanup reports whether CleanupRuns removed anything and must
// call syncPersist.
func shouldSyncAfterCleanup(result RunCleanupResult) bool {
	return result.RemovedRuns != 0 || result.RemovedItems != 0
}

// finalizeSQLiteCleanupAfterPersist maps a cleanup result + persist outcome.
// Persist failures are recorded on the store via lastErr; the in-memory cleanup
// counts are still returned so callers do not treat a durable failure as a no-op
// while memory has already dropped the terminal runs. LastPersistError remains
// the durable status signal for honesty checks.
func finalizeSQLiteCleanupAfterPersist(result RunCleanupResult, persistErr error) RunCleanupResult {
	_ = persistErr
	return result
}

// finalizeSQLiteBoolWrite maps (value, ok, persistErr) for methods that return
// (T, bool). When !ok, zero/false is returned without consulting persistErr.
// When ok but persist fails, zero/false is returned.
func finalizeSQLiteBoolWrite[T any](value T, ok bool, persistErr error) (T, bool) {
	if !ok {
		var zero T
		return zero, false
	}
	if persistErr != nil {
		var zero T
		return zero, false
	}
	return value, true
}

// finalizeSQLiteBoolOK maps (ok, persistErr) for bool-only write methods
// (DeleteThread, DeleteThreadPin).
func finalizeSQLiteBoolOK(ok bool, persistErr error) bool {
	if !ok {
		return false
	}
	return persistErr == nil
}

// finalizeSQLiteErrWrite maps (value, err, persistErr) for methods that return
// (T, error). Pre-existing err wins; otherwise persistErr is surfaced.
func finalizeSQLiteErrWrite[T any](value T, err error, persistErr error) (T, error) {
	if err != nil {
		var zero T
		return zero, err
	}
	if persistErr != nil {
		var zero T
		return zero, persistErr
	}
	return value, nil
}

// finalizeSQLiteDeleteErr maps delete err + persist outcome. Pre-existing err
// wins; otherwise the persist error is returned (may be nil).
func finalizeSQLiteDeleteErr(err error, persistErr error) error {
	if err != nil {
		return err
	}
	return persistErr
}
