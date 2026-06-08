package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	_ "modernc.org/sqlite"
)

var _ Repository = (*SQLiteStore)(nil)
var _ RunLifecycleStore = (*SQLiteStore)(nil)
var _ RunCleaner = (*SQLiteStore)(nil)

const sqliteSnapshotKey = "default"

type SQLiteStore struct {
	db        *sql.DB
	store     *Store
	persistMu sync.Mutex
	closeOnce sync.Once
	lastErr   error
}

func NewSQLite(path string) (*SQLiteStore, error) {
	db, err := openSQLiteDatabase(path)
	if err != nil {
		return nil, err
	}

	s := &SQLiteStore{
		db:    db,
		store: New(),
	}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.load(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.syncPersist(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("verify sqlite store write: %w", err)
	}
	return s, nil
}

func (s *SQLiteStore) Close() {
	s.closeOnce.Do(func() {
		_ = s.syncPersist()
		_ = s.db.Close()
	})
}

func (s *SQLiteStore) Flush() {
	_ = s.syncPersist()
}

func (s *SQLiteStore) LastPersistError() error {
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	return s.lastErr
}

func (s *SQLiteStore) migrate() error {
	if err := runSQLiteMigrations(s.db); err != nil {
		return fmt.Errorf("migrate sqlite store: %w", err)
	}
	return nil
}

func (s *SQLiteStore) load() error {
	var payload string
	err := s.db.QueryRow(
		`SELECT payload FROM agenthub_store_snapshots WHERE key = ?`,
		sqliteSnapshotKey,
	).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read sqlite store snapshot: %w", err)
	}
	if strings.TrimSpace(payload) == "" {
		return nil
	}

	var snapshot fileSnapshot
	decoder := json.NewDecoder(strings.NewReader(payload))
	if err := decoder.Decode(&snapshot); err != nil {
		return fmt.Errorf("decode sqlite store snapshot: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("decode sqlite store snapshot: trailing data")
	}
	s.store.applySnapshot(snapshot)
	return nil
}

func (s *SQLiteStore) syncPersist() error {
	s.persistMu.Lock()
	defer s.persistMu.Unlock()

	payload, err := json.Marshal(s.store.snapshot())
	if err != nil {
		s.lastErr = fmt.Errorf("encode sqlite store snapshot: %w", err)
		return s.lastErr
	}
	_, err = s.db.Exec(
		`INSERT INTO agenthub_store_snapshots (key, payload, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
		sqliteSnapshotKey,
		string(payload),
		nowString(),
	)
	if err != nil {
		s.lastErr = fmt.Errorf("write sqlite store snapshot: %w", err)
		return s.lastErr
	}
	s.lastErr = nil
	return nil
}

func persistAfterSQLiteWrite[T any](s *SQLiteStore, value T, err error) (T, error) {
	if err != nil {
		return value, err
	}
	if persistErr := s.syncPersist(); persistErr != nil {
		return value, persistErr
	}
	return value, nil
}

func (s *SQLiteStore) CreateProject(id, name string) (Project, error) {
	project, err := s.store.CreateProject(id, name)
	if errors.Is(err, ErrProjectExists) {
		return project, err
	}
	return persistAfterSQLiteWrite(s, project, err)
}

func (s *SQLiteStore) GetProject(id string) (Project, bool) {
	return s.store.GetProject(id)
}

func (s *SQLiteStore) ListProjects() []Project {
	return s.store.ListProjects()
}

func (s *SQLiteStore) CreateThread(id, projectID, title string) (Thread, error) {
	thread, err := s.store.CreateThread(id, projectID, title)
	return persistAfterSQLiteWrite(s, thread, err)
}

func (s *SQLiteStore) GetThread(id string) (Thread, bool) {
	return s.store.GetThread(id)
}

func (s *SQLiteStore) UpdateThread(id string, title *string, status *string) (Thread, bool) {
	thread, ok := s.store.UpdateThread(id, title, status)
	if !ok {
		return Thread{}, false
	}
	if err := s.syncPersist(); err != nil {
		return Thread{}, false
	}
	return thread, true
}

func (s *SQLiteStore) DeleteThread(id string) bool {
	ok := s.store.DeleteThread(id)
	if !ok {
		return false
	}
	if err := s.syncPersist(); err != nil {
		return false
	}
	return true
}

func (s *SQLiteStore) ListThreads(projectID string) []Thread {
	return s.store.ListThreads(projectID)
}

func (s *SQLiteStore) CreateRun(id, projectID, threadID string) (Run, error) {
	run, err := s.store.CreateRun(id, projectID, threadID)
	return persistAfterSQLiteWrite(s, run, err)
}

func (s *SQLiteStore) GetRun(id string) (Run, bool) {
	return s.store.GetRun(id)
}

func (s *SQLiteStore) ListRuns(threadID string) []Run {
	return s.store.ListRuns(threadID)
}

func (s *SQLiteStore) CleanupRuns(opts RunCleanupOptions) RunCleanupResult {
	result := s.store.CleanupRuns(opts)
	if result.RemovedRuns == 0 && result.RemovedItems == 0 {
		return result
	}
	if err := s.syncPersist(); err != nil {
		return RunCleanupResult{}
	}
	return result
}

func (s *SQLiteStore) SetRunStatus(id, status string) (Run, bool) {
	run, ok := s.store.SetRunStatus(id, status)
	if !ok {
		return Run{}, false
	}
	if err := s.syncPersist(); err != nil {
		return Run{}, false
	}
	return run, true
}

func (s *SQLiteStore) SetRunStatusIf(id, status string, allowedCurrent ...string) (Run, bool) {
	run, ok := s.store.SetRunStatusIf(id, status, allowedCurrent...)
	if !ok {
		return run, false
	}
	if err := s.syncPersist(); err != nil {
		return Run{}, false
	}
	return run, true
}

func (s *SQLiteStore) CreateItem(item Item) (Item, error) {
	created, err := s.store.CreateItem(item)
	return persistAfterSQLiteWrite(s, created, err)
}

func (s *SQLiteStore) CreateThreadMessage(itemID, threadID, role, content string) (Item, error) {
	item, err := s.store.CreateThreadMessage(itemID, threadID, role, content)
	return persistAfterSQLiteWrite(s, item, err)
}

func (s *SQLiteStore) GetItem(id string) (Item, bool) {
	return s.store.GetItem(id)
}

func (s *SQLiteStore) ListThreadItems(threadID string) []Item {
	return s.store.ListThreadItems(threadID)
}

func (s *SQLiteStore) PinThreadItem(threadID, itemID, pinnedBy string) (ThreadPin, error) {
	pin, err := s.store.PinThreadItem(threadID, itemID, pinnedBy)
	return persistAfterSQLiteWrite(s, pin, err)
}

func (s *SQLiteStore) DeleteThreadPin(threadID, itemID string) bool {
	ok := s.store.DeleteThreadPin(threadID, itemID)
	if !ok {
		return false
	}
	if err := s.syncPersist(); err != nil {
		return false
	}
	return true
}

func (s *SQLiteStore) ListThreadPins(threadID string) []ThreadPin {
	return s.store.ListThreadPins(threadID)
}

func (s *SQLiteStore) UpsertRunDiffFile(file RunDiffFile) (RunDiffFile, error) {
	diffFile, err := s.store.UpsertRunDiffFile(file)
	return persistAfterSQLiteWrite(s, diffFile, err)
}

func (s *SQLiteStore) ListRunDiffFiles(runID string) []RunDiffFile {
	return s.store.ListRunDiffFiles(runID)
}

func (s *SQLiteStore) UpsertArtifact(artifact Artifact) (Artifact, error) {
	created, err := s.store.UpsertArtifact(artifact)
	return persistAfterSQLiteWrite(s, created, err)
}

func (s *SQLiteStore) ListArtifacts(runID string) []Artifact {
	return s.store.ListArtifacts(runID)
}

func (s *SQLiteStore) UpsertPreview(preview Preview) (Preview, error) {
	created, err := s.store.UpsertPreview(preview)
	return persistAfterSQLiteWrite(s, created, err)
}

func (s *SQLiteStore) ListPreviews(runID string) []Preview {
	return s.store.ListPreviews(runID)
}

func ensureSQLiteDirectory(path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create sqlite store directory: %w", err)
	}
	info, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("stat sqlite store directory: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("create sqlite store directory: %s is not a directory", dir)
	}
	return nil
}
