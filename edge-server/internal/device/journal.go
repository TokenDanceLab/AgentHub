package device

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite" // Register the SQLite driver for the durable device journal.
)

// Journal holds cancellation tombstones and pending acknowledgements. Keeping
// tombstones after acknowledgement prevents an old delivery starting on replay.
type Journal struct{ db *sql.DB }

func OpenJournal(path string) (*Journal, error) {
	if err := ValidatePlatform(); err != nil {
		return nil, err
	}
	if !filepath.IsAbs(path) {
		return nil, errors.New("device journal requires an absolute path")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	// #nosec G304 -- absolute path is chosen locally by the operator; exclusive creation never follows an existing symlink.
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err == nil {
		if err := f.Close(); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("device journal must be a private regular file")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
		CREATE TABLE IF NOT EXISTS device_controls (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, run_id TEXT NOT NULL, kind TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE IF NOT EXISTS device_deliveries (delivery_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, scope TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS device_admissions (task_id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, scope TEXT NOT NULL, run_id TEXT NOT NULL DEFAULT '')`); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Journal{db: db}, nil
}

// BeginAdmission records intent before execution, independently of local run
// retention. A crash between intent and receipt must never restart lost work.
func (j *Journal) BeginAdmission(taskID, deliveryID, scope string) (fresh bool, runID string, err error) {
	tx, err := j.db.Begin()
	if err != nil {
		return false, "", err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.Exec(`INSERT INTO device_deliveries(delivery_id,task_id,scope) VALUES(?,?,?) ON CONFLICT(delivery_id) DO NOTHING`, deliveryID, taskID, scope); err != nil {
		return false, "", err
	}
	var originalTask, originalScope string
	if err = tx.QueryRow(`SELECT task_id,scope FROM device_deliveries WHERE delivery_id=?`, deliveryID).Scan(&originalTask, &originalScope); err != nil {
		return false, "", err
	}
	if originalTask != taskID || originalScope != scope {
		return false, "", errors.New("device delivery replay changed identity")
	}
	result, err := tx.Exec(`INSERT INTO device_admissions(task_id,delivery_id,scope) VALUES(?,?,?) ON CONFLICT(task_id) DO NOTHING`, taskID, deliveryID, scope)
	if err != nil {
		return false, "", err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return false, "", err
	}
	var retainedScope string
	err = tx.QueryRow(`SELECT run_id,scope FROM device_admissions WHERE task_id=?`, taskID).Scan(&runID, &retainedScope)
	if err == nil && retainedScope != scope {
		err = errors.New("device admission replay changed scope")
	}
	if err == nil {
		err = tx.Commit()
	}
	return count == 1, runID, err
}

func (j *Journal) Admitted(taskID, runID string) error {
	if !validIdentifier(runID) {
		return errors.New("invalid admitted run identifier")
	}
	result, err := j.db.Exec(`UPDATE device_admissions SET run_id=? WHERE task_id=? AND (run_id='' OR run_id=?)`, runID, taskID, runID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count != 1 {
		return errors.New("device admission receipt missing or changed identity")
	}
	return err
}

// Rejected releases only an intent whose executor was never called. Ambiguous
// admission errors and receipts must remain durable across retries/restarts.
func (j *Journal) Rejected(taskID string) error {
	_, err := j.db.Exec(`DELETE FROM device_admissions WHERE task_id=? AND run_id=''`, taskID)
	return err
}

// Admission preserves evidence independently of local run retention.
func (j *Journal) Admission(taskID string) (runID string, found bool, err error) {
	err = j.db.QueryRow(`SELECT run_id FROM device_admissions WHERE task_id=?`, taskID).Scan(&runID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return runID, err == nil, err
}

func (j *Journal) Close() error { return j.db.Close() }

func (j *Journal) Record(c Control) error {
	if !validIdentifier(c.ID) || c.ID != c.TaskID || (c.RunID != "" && !validIdentifier(c.RunID)) || c.Kind != "cancel" {
		return errors.New("unsupported or invalid device control")
	}
	admitted, _, err := j.Admission(c.TaskID)
	if err != nil {
		return err
	}
	if c.RunID != "" && admitted != "" && c.RunID != admitted {
		return errors.New("device control differs from admitted run")
	}
	_, err = j.db.Exec(`INSERT INTO device_controls(id,task_id,run_id,kind) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING`, c.ID, c.TaskID, c.RunID, c.Kind)
	if err != nil {
		return err
	}
	var taskID, runID, kind string
	if err := j.db.QueryRow(`SELECT task_id,run_id,kind FROM device_controls WHERE id=?`, c.ID).Scan(&taskID, &runID, &kind); err != nil {
		return err
	}
	if taskID != c.TaskID || kind != c.Kind {
		return errors.New("device control replay changed identity")
	}
	if runID != c.RunID {
		if runID != "" || c.RunID != admitted {
			return errors.New("device control replay changed identity")
		}
		_, err = j.db.Exec(`UPDATE device_controls SET run_id=? WHERE id=? AND run_id=''`, c.RunID, c.ID)
	}
	return err
}

func (j *Journal) Cancelled(taskID string) (bool, error) {
	var count int
	err := j.db.QueryRow(`SELECT COUNT(*) FROM device_controls WHERE task_id=? AND kind='cancel'`, taskID).Scan(&count)
	return count > 0, err
}

func (j *Journal) Pending() ([]Control, error) {
	rows, err := j.db.Query(`SELECT id,task_id,run_id,kind FROM device_controls WHERE acknowledged=0 ORDER BY rowid LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var controls []Control
	for rows.Next() {
		var c Control
		if err := rows.Scan(&c.ID, &c.TaskID, &c.RunID, &c.Kind); err != nil {
			return nil, err
		}
		controls = append(controls, c)
	}
	return controls, rows.Err()
}

func (j *Journal) Acknowledged(id string) error {
	_, err := j.db.Exec(`UPDATE device_controls SET acknowledged=1 WHERE id=?`, id)
	return err
}
