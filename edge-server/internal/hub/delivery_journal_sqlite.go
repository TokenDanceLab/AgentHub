package hub

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"sync"
	"time"

	// modernc.org/sqlite registers its "sqlite" driver via init; the blank
	// import is required for database/sql to find it without importing the
	// driver's API surface.
	_ "modernc.org/sqlite"
)

// SQLiteDeliveryJournal is a durable Edge→Hub callback journal.
type SQLiteDeliveryJournal struct {
	db     *sql.DB
	mu     sync.Mutex
	stopCh chan struct{}
	// stopWG tracks the retention goroutine so Close() can wait for it to
	// drain before closing the DB — otherwise the startup purge runs against
	// a closed handle ("database is closed" noise) and tests leak a live
	// goroutine holding the temp dir (TempDir RemoveAll: directory not empty).
	stopWG sync.WaitGroup
}

// OpenSQLiteDeliveryJournal opens/creates journal DB at path.
func OpenSQLiteDeliveryJournal(path string) (*SQLiteDeliveryJournal, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	j := &SQLiteDeliveryJournal{db: db, stopCh: make(chan struct{})}
	if err := j.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	// Auto-start the retention loop so the Edge gets bounded journal growth
	// without needing a separate wiring call (the edge startup wiring lives
	// in internal/httpserver/server.go which is outside the journal
	// package's lane; self-contained startup keeps retention always-on when
	// a durable journal is enabled). The loop stops on Close().
	j.startRetentionLoop()
	return j, nil
}

func (j *SQLiteDeliveryJournal) migrate() error {
	_, err := j.db.Exec(`CREATE TABLE IF NOT EXISTS delivery_journal (
		seq INTEGER PRIMARY KEY AUTOINCREMENT,
		task_id TEXT NOT NULL,
		run_id TEXT,
		action TEXT NOT NULL,
		ok INTEGER NOT NULL,
		error TEXT,
		attempts INTEGER NOT NULL,
		recorded_at TEXT NOT NULL
	)`)
	if err != nil {
		return err
	}
	// Cover HasSuccessful(task_id, action[, run_id]) and the
	// Snapshot(afterSeq) ORDER BY seq cursor scan. Without this index the
	// reconciliation query (HasSuccessful) full-scans the journal on every
	// callback ack, which is the hot path for terminal-ack dedup.
	_, err = j.db.Exec(`CREATE INDEX IF NOT EXISTS idx_journal_task_action ON delivery_journal(task_id, action)`)
	return err
}

// Record appends a durable entry and returns its sequence number.
func (j *SQLiteDeliveryJournal) Record(taskID, runID, action string, ok bool, errMsg string, attempts int) (uint64, error) {
	if j == nil || j.db == nil {
		return 0, fmt.Errorf("journal closed")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	okInt := 0
	if ok {
		okInt = 1
	}
	res, err := j.db.Exec(
		`INSERT INTO delivery_journal(task_id, run_id, action, ok, error, attempts, recorded_at) VALUES(?,?,?,?,?,?,?)`,
		taskID, runID, action, okInt, errMsg, attempts, time.Now().UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	if id < 0 {
		return 0, fmt.Errorf("journal sequence negative: %d", id)
	}
	return uint64(id), nil
}

// Snapshot returns entries with seq > afterSeq.
func (j *SQLiteDeliveryJournal) Snapshot(afterSeq uint64) ([]DeliveryJournalEntry, error) {
	if j == nil || j.db == nil {
		return nil, fmt.Errorf("journal closed")
	}
	// SQLite permits many readers but only one writer. The retention loop runs
	// a DELETE immediately after open, so an unguarded read here could race that
	// writer on slower/ARM hosts and surface SQLITE_BUSY. Serialize every journal
	// operation that touches this sql.DB with the same mutex used by Record and
	// CleanupOldJournal; the journal is tiny and correctness matters more than
	// parallel read throughput on the callback reconciliation path.
	j.mu.Lock()
	defer j.mu.Unlock()
	rows, err := j.db.Query(
		`SELECT seq, task_id, run_id, action, ok, COALESCE(error,''), attempts, recorded_at
		 FROM delivery_journal WHERE seq > ? ORDER BY seq ASC`, afterSeq,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DeliveryJournalEntry
	for rows.Next() {
		var e DeliveryJournalEntry
		var okInt int
		var recorded string
		if err := rows.Scan(&e.Seq, &e.TaskID, &e.RunID, &e.Action, &okInt, &e.Error, &e.Attempts, &recorded); err != nil {
			return nil, err
		}
		e.OK = okInt == 1
		if ts, err := time.Parse(time.RFC3339Nano, recorded); err == nil {
			e.RecordedAt = ts
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// HasSuccessful reports whether a successful delivery already exists for task+action(+run).
// Used by reconciliation to skip re-delivery of terminal acks that already landed.
func (j *SQLiteDeliveryJournal) HasSuccessful(taskID, runID, action string) (bool, error) {
	if j == nil || j.db == nil {
		return false, fmt.Errorf("journal closed")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	row := j.db.QueryRow(
		`SELECT 1 FROM delivery_journal WHERE task_id = ? AND action = ? AND ok = 1 AND (? = '' OR run_id = ?) LIMIT 1`,
		taskID, action, runID, runID,
	)
	var one int
	err := row.Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// Close closes the DB and stops the background retention loop, waiting for
// an in-flight purge to drain before the DB handle is released.
func (j *SQLiteDeliveryJournal) Close() error {
	if j == nil {
		return nil
	}
	// Signal the retention goroutine to stop before closing the DB so it does
	// not fire a DELETE on a closed handle.
	if j.stopCh != nil {
		select {
		case <-j.stopCh:
			// already closed
		default:
			close(j.stopCh)
		}
	}
	j.stopWG.Wait()
	if j.db == nil {
		return nil
	}
	return j.db.Close()
}

// startRetentionLoop launches the internal retention goroutine bound to the
// journal's stopCh (closed by Close). Used by OpenSQLiteDeliveryJournal so
// retention is always-on without a separate wiring call.
func (j *SQLiteDeliveryJournal) startRetentionLoop() {
	if j == nil || j.db == nil || j.stopCh == nil {
		return
	}
	stop := j.stopCh
	j.stopWG.Add(1)
	go func() {
		defer j.stopWG.Done()
		ticker := time.NewTicker(JournalRetentionInterval)
		defer ticker.Stop()
		// Run once at startup so a long-downed Edge does not sit on a full
		// journal for a full interval before the first purge.
		j.runRetentionOnce()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				j.runRetentionOnce()
			}
		}
	}()
}

// CleanupOldJournal purges journal rows whose recorded_at is older than the
// given cutoff. The journal is append-only and grows unboundedly under steady
// callback traffic; without retention it eventually exhausts disk on the
// Edge host. The default retention window is DefaultJournalRetention (7d).
//
// Returns the number of rows deleted. Safe to call concurrently with Record:
// the write path holds the same mutex, and SQLite row-delete does not block
// inserts on unrelated rows.
func (j *SQLiteDeliveryJournal) CleanupOldJournal(cutoff time.Time) (int64, error) {
	if j == nil || j.db == nil {
		return 0, fmt.Errorf("journal closed")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	res, err := j.db.Exec(
		`DELETE FROM delivery_journal WHERE recorded_at < ?`,
		cutoff.UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// StartJournalRetentionLoop launches a background goroutine that periodically
// purges journal rows older than DefaultJournalRetention. Cancel by closing
// the supplied context (typically the Edge server lifecycle). The loop is
// best-effort: a purge failure is logged and retried on the next tick — it
// never aborts recording, which goes through a separate mutex-guarded path.
func (j *SQLiteDeliveryJournal) StartJournalRetentionLoop(ctx context.Context) {
	if j == nil || j.db == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(JournalRetentionInterval)
		defer ticker.Stop()
		// Run once at startup so a long-downed Edge does not sit on a full
		// journal for a full interval before the first purge.
		j.runRetentionOnce()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				j.runRetentionOnce()
			}
		}
	}()
}

func (j *SQLiteDeliveryJournal) runRetentionOnce() {
	cutoff := time.Now().Add(-DefaultJournalRetention)
	removed, err := j.CleanupOldJournal(cutoff)
	if err != nil {
		// Previously this used `_ = fmt.Errorf(...)` which silently discarded
		// the error — a retention purge failure was invisible to operators
		// and the journal could grow unbounded with no signal. Surface it
		// via slog so /metrics and log alerts can catch a stuck purge.
		slog.Error("edge delivery journal retention purge failed", "error", err)
		return
	}
	if removed > 0 {
		slog.Debug("edge delivery journal retention purge",
			"removed", removed, "cutoff", cutoff.Format(time.RFC3339))
	}
}

// DefaultJournalRetention is how long a journal row is kept before retention
// purges it. Aligned with runcontrol.DefaultRunCleanupTerminalTTL (24h): the
// journal is derived data of a run, so it must not outlive the run it
// references — otherwise reconciliation can replay orphan journal rows into
// invalid retries (#2135 F2). 24h still covers the DurableSnapshot replay
// window (restarts happen within minutes-hours, not days).
const DefaultJournalRetention = 24 * time.Hour

// JournalRetentionInterval is how often the retention loop fires. 24h keeps
// the purge off the hot path; the retention window (not the cadence) governs
// how old a row must be to qualify.
const JournalRetentionInterval = 24 * time.Hour
