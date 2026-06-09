package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
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
const sqliteProjectionOwnerID = "agenthub_store_snapshot"

const (
	sqliteRowKindProject      = "project"
	sqliteRowKindThread       = "thread"
	sqliteRowKindRun          = "run"
	sqliteRowKindItem         = "item"
	sqliteRowKindPin          = "pin"
	sqliteRowKindDiff         = "diff"
	sqliteRowKindArtifact     = "artifact"
	sqliteRowKindPreview      = "preview"
	sqliteRowKindUserProfile  = "user_profile"
	sqliteRowKindAgentProfile = "agent_profile"
)

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
	rowSnapshot, ok, err := loadSQLiteRows(s.db)
	if err != nil {
		return err
	}
	if ok {
		s.store.applySnapshot(rowSnapshot)
		return nil
	}

	var payload string
	err = s.db.QueryRow(
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

	snapshot := s.store.snapshot()
	payload, err := json.Marshal(snapshot)
	if err != nil {
		s.lastErr = fmt.Errorf("encode sqlite store snapshot: %w", err)
		return s.lastErr
	}

	tx, err := s.db.Begin()
	if err != nil {
		s.lastErr = fmt.Errorf("begin sqlite store persist: %w", err)
		return s.lastErr
	}
	_, err = tx.Exec(
		`INSERT INTO agenthub_store_snapshots (key, payload, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
		sqliteSnapshotKey,
		string(payload),
		nowString(),
	)
	if err != nil {
		_ = tx.Rollback()
		s.lastErr = fmt.Errorf("write sqlite store snapshot: %w", err)
		return s.lastErr
	}
	if err := replaceSQLiteRows(tx, snapshot); err != nil {
		_ = tx.Rollback()
		s.lastErr = fmt.Errorf("write sqlite store rows: %w", err)
		return s.lastErr
	}
	if err := replaceSQLiteRelationalProjection(tx, snapshot); err != nil {
		_ = tx.Rollback()
		s.lastErr = fmt.Errorf("write sqlite relational projection: %w", err)
		return s.lastErr
	}
	if err := tx.Commit(); err != nil {
		s.lastErr = fmt.Errorf("commit sqlite store persist: %w", err)
		return s.lastErr
	}
	s.lastErr = nil
	return nil
}

func loadSQLiteRows(db *sql.DB) (fileSnapshot, bool, error) {
	rows, err := db.Query(`SELECT row_kind, row_id, payload FROM agenthub_store_rows ORDER BY row_kind, order_index, row_id`)
	if err != nil {
		return fileSnapshot{}, false, fmt.Errorf("read sqlite store rows: %w", err)
	}
	defer rows.Close()

	var snapshot fileSnapshot
	loaded := false
	for rows.Next() {
		var kind, id, payload string
		if err := rows.Scan(&kind, &id, &payload); err != nil {
			return fileSnapshot{}, false, fmt.Errorf("scan sqlite store row: %w", err)
		}
		loaded = true
		if err := applySQLiteRow(&snapshot, kind, id, payload); err != nil {
			return fileSnapshot{}, false, err
		}
	}
	if err := rows.Err(); err != nil {
		return fileSnapshot{}, false, fmt.Errorf("iterate sqlite store rows: %w", err)
	}
	return snapshot, loaded, nil
}

func applySQLiteRow(snapshot *fileSnapshot, kind, id, payload string) error {
	switch kind {
	case sqliteRowKindProject:
		var value Project
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite project row %s: %w", id, err)
		}
		if snapshot.Projects == nil {
			snapshot.Projects = map[string]Project{}
		}
		snapshot.Projects[id] = value
		snapshot.ProjectOrder = append(snapshot.ProjectOrder, id)
	case sqliteRowKindThread:
		var value Thread
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite thread row %s: %w", id, err)
		}
		if snapshot.Threads == nil {
			snapshot.Threads = map[string]Thread{}
		}
		snapshot.Threads[id] = value
		snapshot.ThreadOrder = append(snapshot.ThreadOrder, id)
	case sqliteRowKindRun:
		var value Run
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite run row %s: %w", id, err)
		}
		if snapshot.Runs == nil {
			snapshot.Runs = map[string]Run{}
		}
		snapshot.Runs[id] = value
		snapshot.RunOrder = append(snapshot.RunOrder, id)
	case sqliteRowKindItem:
		var value Item
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite item row %s: %w", id, err)
		}
		if snapshot.Items == nil {
			snapshot.Items = map[string]Item{}
		}
		snapshot.Items[id] = value
		snapshot.ItemOrder = append(snapshot.ItemOrder, id)
	case sqliteRowKindPin:
		var value ThreadPin
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite pin row %s: %w", id, err)
		}
		if snapshot.Pins == nil {
			snapshot.Pins = map[string]ThreadPin{}
		}
		snapshot.Pins[id] = value
		snapshot.PinOrder = append(snapshot.PinOrder, id)
	case sqliteRowKindDiff:
		var value RunDiffFile
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite diff row %s: %w", id, err)
		}
		if snapshot.Diffs == nil {
			snapshot.Diffs = map[string]RunDiffFile{}
		}
		snapshot.Diffs[id] = value
		snapshot.DiffOrder = append(snapshot.DiffOrder, id)
	case sqliteRowKindArtifact:
		var value Artifact
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite artifact row %s: %w", id, err)
		}
		if snapshot.Artifacts == nil {
			snapshot.Artifacts = map[string]Artifact{}
		}
		snapshot.Artifacts[id] = value
		snapshot.ArtifactOrder = append(snapshot.ArtifactOrder, id)
	case sqliteRowKindPreview:
		var value Preview
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite preview row %s: %w", id, err)
		}
		if snapshot.Previews == nil {
			snapshot.Previews = map[string]Preview{}
		}
		snapshot.Previews[id] = value
		snapshot.PreviewOrder = append(snapshot.PreviewOrder, id)
		case sqliteRowKindAgentProfile:
			var value AgentProfile
			if err := decodeSQLiteRowPayload(payload, &value); err != nil {
				return fmt.Errorf("decode sqlite agent_profile row %s: %w", id, err)
			}
			if snapshot.AgentProfiles == nil {
				snapshot.AgentProfiles = map[string]AgentProfile{}
			}
			snapshot.AgentProfiles[id] = value
			snapshot.AgentProfileOrder = append(snapshot.AgentProfileOrder, id)
	default:
		return fmt.Errorf("unknown sqlite store row kind %s", kind)
	}
	return nil
}

func decodeSQLiteRowPayload(payload string, value any) error {
	decoder := json.NewDecoder(strings.NewReader(payload))
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("trailing data")
	}
	return nil
}

func replaceSQLiteRows(tx *sql.Tx, snapshot fileSnapshot) error {
	if _, err := tx.Exec(`DELETE FROM agenthub_store_rows`); err != nil {
		return fmt.Errorf("clear prior rows: %w", err)
	}
	now := nowString()
	if err := insertSQLiteRows(tx, sqliteRowKindProject, snapshot.ProjectOrder, snapshot.Projects, now); err != nil {
		return err
	}
	if err := insertSQLiteRows(tx, sqliteRowKindThread, snapshot.ThreadOrder, snapshot.Threads, now); err != nil {
		return err
	}
	if err := insertSQLiteRows(tx, sqliteRowKindRun, snapshot.RunOrder, snapshot.Runs, now); err != nil {
		return err
	}
	if err := insertSQLiteRows(tx, sqliteRowKindItem, snapshot.ItemOrder, snapshot.Items, now); err != nil {
		return err
	}
	if err := insertSQLiteRows(tx, sqliteRowKindPin, snapshot.PinOrder, snapshot.Pins, now); err != nil {
		return err
	}
	if err := insertSQLiteRows(tx, sqliteRowKindDiff, snapshot.DiffOrder, snapshot.Diffs, now); err != nil {
		return err
	}
	if err := insertSQLiteRows(tx, sqliteRowKindArtifact, snapshot.ArtifactOrder, snapshot.Artifacts, now); err != nil {
		return err
	}
	if err := insertSQLiteRows(tx, sqliteRowKindPreview, snapshot.PreviewOrder, snapshot.Previews, now); err != nil {
		return err
	}
	if err := insertSQLiteRows(tx, sqliteRowKindAgentProfile, snapshot.AgentProfileOrder, snapshot.AgentProfiles, now); err != nil {
		return err
	}
	return nil
}

func insertSQLiteRows[V any](tx *sql.Tx, kind string, order []string, values map[string]V, updatedAt string) error {
	for index, id := range normalizeOrder(order, values) {
		payload, err := json.Marshal(values[id])
		if err != nil {
			return fmt.Errorf("encode %s row %s: %w", kind, id, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO agenthub_store_rows (row_kind, row_id, payload, order_index, updated_at)
VALUES (?, ?, ?, ?, ?)`,
			kind,
			id,
			string(payload),
			index,
			updatedAt,
		); err != nil {
			return fmt.Errorf("write %s row %s: %w", kind, id, err)
		}
	}
	return nil
}

func replaceSQLiteRelationalProjection(tx *sql.Tx, snapshot fileSnapshot) error {
	if _, err := tx.Exec(`DELETE FROM edge_owners WHERE owner_id = ?`, sqliteProjectionOwnerID); err != nil {
		return fmt.Errorf("clear prior projection: %w", err)
	}
	now := nowString()
	if _, err := tx.Exec(
		`INSERT INTO edge_owners (owner_id, source, display_name, created_at, updated_at)
VALUES (?, 'snapshot', 'AgentHub snapshot projection', ?, ?)`,
		sqliteProjectionOwnerID,
		now,
		now,
	); err != nil {
		return fmt.Errorf("project owner: %w", err)
	}

	for _, project := range snapshot.Projects {
		if project.ID == "" {
			continue
		}
		createdAt := firstNonEmpty(project.CreatedAt, now)
		updatedAt := firstNonEmpty(project.UpdatedAt, createdAt)
		name := firstNonEmpty(project.Name, project.ID)
		status := firstNonEmpty(project.Status, "active")
		if _, err := tx.Exec(
			`INSERT INTO edge_workspaces (workspace_id, owner_id, local_path, name, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)`,
			project.ID,
			sqliteProjectionOwnerID,
			project.ID,
			name,
			status,
			createdAt,
			updatedAt,
		); err != nil {
			return fmt.Errorf("project workspace %s: %w", project.ID, err)
		}
	}

	for _, run := range snapshot.Runs {
		if run.ID == "" || run.ProjectID == "" {
			continue
		}
		if _, ok := snapshot.Projects[run.ProjectID]; !ok {
			continue
		}
		createdAt := firstNonEmpty(run.CreatedAt, now)
		if _, err := tx.Exec(
			`INSERT INTO edge_runs (run_id, owner_id, workspace_id, thread_id, status, created_at, started_at, finished_at, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
			run.ID,
			sqliteProjectionOwnerID,
			run.ProjectID,
			nullString(run.ThreadID),
			firstNonEmpty(run.Status, "queued"),
			createdAt,
			nullString(run.StartedAt),
			nullString(run.FinishedAt),
		); err != nil {
			return fmt.Errorf("run %s: %w", run.ID, err)
		}
	}

	for _, artifact := range snapshot.Artifacts {
		if artifact.ID == "" || artifact.RunID == "" {
			continue
		}
		run, ok := snapshot.Runs[artifact.RunID]
		if !ok || run.ProjectID == "" {
			continue
		}
		if _, ok := snapshot.Projects[run.ProjectID]; !ok {
			continue
		}
		contentSourceKind, contentSourcePath, contentSourceReadable := sqliteArtifactContentSourceColumns(artifact.ContentSource)
		metadataJSON, err := sqliteArtifactMetadataJSON(artifact)
		if err != nil {
			return fmt.Errorf("artifact metadata %s: %w", artifact.ID, err)
		}
		createdAt := firstNonEmpty(artifact.CreatedAt, now)
		updatedAt := firstNonEmpty(artifact.UpdatedAt, createdAt)
		if _, err := tx.Exec(
			`INSERT INTO edge_artifacts (artifact_id, owner_id, workspace_id, run_id, kind, path, status, created_at, updated_at, metadata_json, content_source_kind, content_source_path, content_source_readable)
VALUES (?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?)`,
			artifact.ID,
			sqliteProjectionOwnerID,
			run.ProjectID,
			artifact.RunID,
			firstNonEmpty(artifact.Kind, "file"),
			artifact.Path,
			createdAt,
			updatedAt,
			metadataJSON,
			contentSourceKind,
			contentSourcePath,
			contentSourceReadable,
		); err != nil {
			return fmt.Errorf("artifact %s: %w", artifact.ID, err)
		}
	}

	for _, diffFile := range snapshot.Diffs {
		if diffFile.RunID == "" || diffFile.Path == "" {
			continue
		}
		run, ok := snapshot.Runs[diffFile.RunID]
		if !ok || run.ProjectID == "" {
			continue
		}
		if _, ok := snapshot.Projects[run.ProjectID]; !ok {
			continue
		}
		summaryJSON, err := sqliteDiffSummaryJSON(diffFile)
		if err != nil {
			return fmt.Errorf("diff summary %s: %w", diffFile.Path, err)
		}
		createdAt := firstNonEmpty(diffFile.CreatedAt, now)
		updatedAt := firstNonEmpty(diffFile.UpdatedAt, createdAt)
		if _, err := tx.Exec(
			`INSERT INTO edge_diffs (diff_id, owner_id, workspace_id, run_id, summary_json, patch_path, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			sqliteDiffProjectionID(diffFile),
			sqliteProjectionOwnerID,
			run.ProjectID,
			diffFile.RunID,
			summaryJSON,
			diffFile.Path,
			firstNonEmpty(diffFile.Status, "modified"),
			createdAt,
			updatedAt,
		); err != nil {
			return fmt.Errorf("diff %s: %w", diffFile.Path, err)
		}
	}

	for _, preview := range snapshot.Previews {
		if preview.ID == "" || preview.RunID == "" {
			continue
		}
		run, ok := snapshot.Runs[preview.RunID]
		if !ok || run.ProjectID == "" {
			continue
		}
		if _, ok := snapshot.Projects[run.ProjectID]; !ok {
			continue
		}
		createdAt := firstNonEmpty(preview.CreatedAt, now)
		updatedAt := firstNonEmpty(preview.UpdatedAt, createdAt)
		if _, err := tx.Exec(
			`INSERT INTO edge_previews (preview_id, owner_id, workspace_id, run_id, url, status, created_at, updated_at, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
			preview.ID,
			sqliteProjectionOwnerID,
			run.ProjectID,
			preview.RunID,
			preview.URL,
			firstNonEmpty(preview.Status, "created"),
			createdAt,
			updatedAt,
		); err != nil {
			return fmt.Errorf("preview %s: %w", preview.ID, err)
		}
	}

	return nil
}

func sqliteArtifactContentSourceColumns(source *ArtifactContentSource) (string, string, int) {
	if source == nil {
		return "", "", 0
	}
	readable := 0
	if source.Readable {
		readable = 1
	}
	return source.Kind, source.Path, readable
}

func sqliteArtifactMetadataJSON(artifact Artifact) (string, error) {
	payload, err := json.Marshal(struct {
		SizeBytes int64 `json:"sizeBytes"`
	}{
		SizeBytes: artifact.SizeBytes,
	})
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func sqliteDiffProjectionID(file RunDiffFile) string {
	payload, _ := json.Marshal([2]string{file.RunID, file.Path})
	sum := sha256.Sum256(payload)
	return "run_diff:" + hex.EncodeToString(sum[:])
}

func sqliteDiffSummaryJSON(file RunDiffFile) (string, error) {
	payload, err := json.Marshal(struct {
		Path      string `json:"path"`
		DiffBytes int    `json:"diffBytes"`
	}{
		Path:      file.Path,
		DiffBytes: len([]byte(file.Diff)),
	})
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
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

func (s *SQLiteStore) CreateThread(id, projectID, title, kind string) (Thread, error) {
	thread, err := s.store.CreateThread(id, projectID, title, kind)
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

func (s *SQLiteStore) GetArtifact(id string) (Artifact, bool) {
	return s.store.GetArtifact(id)
}

func (s *SQLiteStore) UpsertPreview(preview Preview) (Preview, error) {
	created, err := s.store.UpsertPreview(preview)
	return persistAfterSQLiteWrite(s, created, err)
}

func (s *SQLiteStore) ListPreviews(runID string) []Preview {
	return s.store.ListPreviews(runID)
}

func (s *SQLiteStore) GetPreview(id string) (Preview, bool) {
	return s.store.GetPreview(id)
}

func (s *SQLiteStore) CreateUserProfile(profile UserProfile) (UserProfile, error) {
	created, err := s.store.CreateUserProfile(profile)
	return persistAfterSQLiteWrite(s, created, err)
}

func (s *SQLiteStore) GetUserProfile(id string) (UserProfile, bool) {
	return s.store.GetUserProfile(id)
}

func (s *SQLiteStore) ListUserProfiles() []UserProfile {
	return s.store.ListUserProfiles()
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

// ── AgentProfile delegating methods ──

func (s *SQLiteStore) CreateAgentProfile(profile AgentProfile) (AgentProfile, error) {
	created, err := s.store.CreateAgentProfile(profile)
	return persistAfterSQLiteWrite(s, created, err)
}

func (s *SQLiteStore) GetAgentProfile(id string) (AgentProfile, bool) {
	return s.store.GetAgentProfile(id)
}

func (s *SQLiteStore) ListAgentProfiles(adapterID string) []AgentProfile {
	return s.store.ListAgentProfiles(adapterID)
}

func (s *SQLiteStore) UpdateAgentProfile(id string, patch map[string]any) (AgentProfile, error) {
	profile, err := s.store.UpdateAgentProfile(id, patch)
	if err != nil {
		return AgentProfile{}, err
	}
	if err := s.syncPersist(); err != nil {
		return AgentProfile{}, err
	}
	return profile, nil
}

func (s *SQLiteStore) DeleteAgentProfile(id string) error {
	if err := s.store.DeleteAgentProfile(id); err != nil {
		return err
	}
	return s.syncPersist()
}

func (s *SQLiteStore) GetCurrentUser() (UserProfile, bool) {
	return s.store.GetCurrentUser()
}

// ── UserSettings delegating methods ──

func (s *SQLiteStore) GetSettings() UserSettings {
	return s.store.GetSettings()
}

func (s *SQLiteStore) UpsertSettings(patch map[string]string) UserSettings {
	result := s.store.UpsertSettings(patch)
	_ = s.syncPersist()
	return result
}
