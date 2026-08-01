package hub

import (
	"database/sql"
	"fmt"
	"sync"
	"time"

	// modernc.org/sqlite registers its "sqlite" driver via init; the blank
	// import is required for database/sql to find it without importing the
	// driver's API surface.
	_ "modernc.org/sqlite"
)

// SQLiteDeliveryJournal is a durable Edge→Hub callback journal.
type SQLiteDeliveryJournal struct {
	db *sql.DB
	mu sync.Mutex
}

// OpenSQLiteDeliveryJournal opens/creates journal DB at path.
func OpenSQLiteDeliveryJournal(path string) (*SQLiteDeliveryJournal, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	j := &SQLiteDeliveryJournal{db: db}
	if err := j.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
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
	return uint64(id), nil
}

// Snapshot returns entries with seq > afterSeq.
func (j *SQLiteDeliveryJournal) Snapshot(afterSeq uint64) ([]DeliveryJournalEntry, error) {
	if j == nil || j.db == nil {
		return nil, fmt.Errorf("journal closed")
	}
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

// Close closes the DB.
func (j *SQLiteDeliveryJournal) Close() error {
	if j == nil || j.db == nil {
		return nil
	}
	return j.db.Close()
}
