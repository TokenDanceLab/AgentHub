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
	"time"

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
	db           *sql.DB
	store        *Store
	persistMu    sync.Mutex
	closeOnce    sync.Once
	lastErr      error
	lastSnapshot fileSnapshot
	stopCheckpoint chan struct{} // closed to stop periodic WAL checkpoint
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
	s.lastSnapshot = s.store.snapshot()

	// Periodically checkpoint the WAL to prevent unbounded growth and keep the
	// in-memory page cache small. On Windows the Go runtime is reluctant to
	// return freed memory to the OS, so keeping the WAL small is critical.
	s.stopCheckpoint = make(chan struct{})
	go s.checkpointLoop(5 * time.Minute)

	return s, nil
}

func (s *SQLiteStore) checkpointLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if _, err := s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
				// Non-fatal; the auto-checkpoint will still work.
			}
		case <-s.stopCheckpoint:
			return
		}
	}
}

func (s *SQLiteStore) Close() {
	s.closeOnce.Do(func() {
		close(s.stopCheckpoint)
		// Final checkpoint to shrink the WAL before close.
		_, _ = s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
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
	if err := deltaSQLiteRows(tx, s.lastSnapshot, snapshot); err != nil {
		_ = tx.Rollback()
		s.lastErr = fmt.Errorf("write sqlite store rows: %w", err)
		return s.lastErr
	}
	if err := deltaSQLiteRelationalProjection(tx, s.lastSnapshot, snapshot); err != nil {
		_ = tx.Rollback()
		s.lastErr = fmt.Errorf("write sqlite relational projection: %w", err)
		return s.lastErr
	}
	if err := tx.Commit(); err != nil {
		s.lastErr = fmt.Errorf("commit sqlite store persist: %w", err)
		return s.lastErr
	}
	s.lastSnapshot = cloneFileSnapshot(snapshot)
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
		case sqliteRowKindUserProfile:
			var value UserProfile
			if err := decodeSQLiteRowPayload(payload, &value); err != nil {
				return fmt.Errorf("decode sqlite user_profile row %s: %w", id, err)
			}
			if snapshot.UserProfiles == nil {
				snapshot.UserProfiles = map[string]UserProfile{}
			}
			snapshot.UserProfiles[id] = value
			snapshot.UserProfileOrder = append(snapshot.UserProfileOrder, id)
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

func deltaSQLiteRows(tx *sql.Tx, oldSnapshot, newSnapshot fileSnapshot) error {
	now := nowString()
	if err := deltaRowsOfKind(tx, sqliteRowKindProject, oldSnapshot.ProjectOrder, oldSnapshot.Projects, newSnapshot.ProjectOrder, newSnapshot.Projects, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindThread, oldSnapshot.ThreadOrder, oldSnapshot.Threads, newSnapshot.ThreadOrder, newSnapshot.Threads, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindRun, oldSnapshot.RunOrder, oldSnapshot.Runs, newSnapshot.RunOrder, newSnapshot.Runs, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindItem, oldSnapshot.ItemOrder, oldSnapshot.Items, newSnapshot.ItemOrder, newSnapshot.Items, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindPin, oldSnapshot.PinOrder, oldSnapshot.Pins, newSnapshot.PinOrder, newSnapshot.Pins, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindDiff, oldSnapshot.DiffOrder, oldSnapshot.Diffs, newSnapshot.DiffOrder, newSnapshot.Diffs, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindArtifact, oldSnapshot.ArtifactOrder, oldSnapshot.Artifacts, newSnapshot.ArtifactOrder, newSnapshot.Artifacts, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindPreview, oldSnapshot.PreviewOrder, oldSnapshot.Previews, newSnapshot.PreviewOrder, newSnapshot.Previews, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindAgentProfile, oldSnapshot.AgentProfileOrder, oldSnapshot.AgentProfiles, newSnapshot.AgentProfileOrder, newSnapshot.AgentProfiles, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindUserProfile, oldSnapshot.UserProfileOrder, oldSnapshot.UserProfiles, newSnapshot.UserProfileOrder, newSnapshot.UserProfiles, now); err != nil {
		return err
	}
	return nil
}

func deltaRowsOfKind[V any](tx *sql.Tx, kind string, oldOrder []string, oldMap map[string]V, newOrder []string, newMap map[string]V, updatedAt string) error {
	oldOrderNorm := normalizeOrder(oldOrder, oldMap)
	newOrderNorm := normalizeOrder(newOrder, newMap)

	oldPayloads := make(map[string]string, len(oldMap))
	oldIndexes := make(map[string]int, len(oldOrderNorm))
	for i, id := range oldOrderNorm {
		payload, err := json.Marshal(oldMap[id])
		if err != nil {
			return fmt.Errorf("encode old %s row %s: %w", kind, id, err)
		}
		oldPayloads[id] = string(payload)
		oldIndexes[id] = i
	}

	newPayloads := make(map[string]string, len(newMap))
	newIndexes := make(map[string]int, len(newOrderNorm))
	for i, id := range newOrderNorm {
		payload, err := json.Marshal(newMap[id])
		if err != nil {
			return fmt.Errorf("encode new %s row %s: %w", kind, id, err)
		}
		newPayloads[id] = string(payload)
		newIndexes[id] = i
	}

	for id, newPayload := range newPayloads {
		oldPayload, existed := oldPayloads[id]
		oldIdx, oldIdxExists := oldIndexes[id]
		newIdx := newIndexes[id]
		if existed && oldPayload == newPayload && oldIdxExists && oldIdx == newIdx {
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO agenthub_store_rows (row_kind, row_id, payload, order_index, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(row_kind, row_id) DO UPDATE SET payload = excluded.payload, order_index = excluded.order_index, updated_at = excluded.updated_at`,
			kind, id, newPayload, newIdx, updatedAt,
		); err != nil {
			return fmt.Errorf("write %s row %s: %w", kind, id, err)
		}
	}

	for id := range oldPayloads {
		if _, ok := newPayloads[id]; !ok {
			if _, err := tx.Exec(`DELETE FROM agenthub_store_rows WHERE row_kind = ? AND row_id = ?`, kind, id); err != nil {
				return fmt.Errorf("delete %s row %s: %w", kind, id, err)
			}
		}
	}

	return nil
}

func deltaSQLiteRelationalProjection(tx *sql.Tx, oldSnapshot, newSnapshot fileSnapshot) error {
	now := nowString()

	if _, err := tx.Exec(
		`INSERT INTO edge_owners (owner_id, source, display_name, created_at, updated_at)
VALUES (?, 'snapshot', 'AgentHub snapshot projection', ?, ?)
ON CONFLICT(owner_id) DO UPDATE SET updated_at = excluded.updated_at`,
		sqliteProjectionOwnerID, now, now,
	); err != nil {
		return fmt.Errorf("project owner: %w", err)
	}

	oldWorkspaceIDs := make(map[string]string, len(oldSnapshot.Projects))
	newWorkspaceIDs := make(map[string]string, len(newSnapshot.Projects))
	for id, proj := range oldSnapshot.Projects {
		payload, _ := json.Marshal(proj)
		oldWorkspaceIDs[id] = string(payload)
	}
	for id, proj := range newSnapshot.Projects {
		payload, _ := json.Marshal(proj)
		newWorkspaceIDs[id] = string(payload)
	}
	if err := deltaProjectionMap(tx, "edge_workspaces", "workspace_id",
		oldWorkspaceIDs, newWorkspaceIDs,
		func(id string, payload string) error {
			var proj Project
			if err := json.Unmarshal([]byte(payload), &proj); err != nil {
				return err
			}
			if proj.ID == "" {
				return nil
			}
			createdAt := firstNonEmpty(proj.CreatedAt, now)
			updatedAt := firstNonEmpty(proj.UpdatedAt, createdAt)
			name := firstNonEmpty(proj.Name, proj.ID)
			status := firstNonEmpty(proj.Status, "active")
			_, err := tx.Exec(
				`INSERT INTO edge_workspaces (workspace_id, owner_id, local_path, name, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(workspace_id) DO UPDATE SET owner_id = excluded.owner_id, local_path = excluded.local_path, name = excluded.name, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at`,
				proj.ID, sqliteProjectionOwnerID, proj.ID, name, status, createdAt, updatedAt,
			)
			return err
		},
		func(id string) error {
			_, err := tx.Exec(`DELETE FROM edge_workspaces WHERE workspace_id = ?`, id)
			return err
		},
	); err != nil {
		return fmt.Errorf("project workspace delta: %w", err)
	}

	oldRunPayloads := make(map[string]string, len(oldSnapshot.Runs))
	newRunPayloads := make(map[string]string, len(newSnapshot.Runs))
	for id, run := range oldSnapshot.Runs {
		payload, _ := json.Marshal(run)
		oldRunPayloads[id] = string(payload)
	}
	for id, run := range newSnapshot.Runs {
		payload, _ := json.Marshal(run)
		newRunPayloads[id] = string(payload)
	}
	if err := deltaProjectionMap(tx, "edge_runs", "run_id",
		oldRunPayloads, newRunPayloads,
		func(id string, payload string) error {
			var run Run
			if err := json.Unmarshal([]byte(payload), &run); err != nil {
				return err
			}
			if run.ID == "" || run.ProjectID == "" {
				return nil
			}
			if _, ok := newSnapshot.Projects[run.ProjectID]; !ok {
				return nil
			}
			createdAt := firstNonEmpty(run.CreatedAt, now)
			_, err := tx.Exec(
				`INSERT INTO edge_runs (run_id, owner_id, workspace_id, thread_id, status, created_at, started_at, finished_at, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')
ON CONFLICT(run_id) DO UPDATE SET owner_id = excluded.owner_id, workspace_id = excluded.workspace_id, thread_id = excluded.thread_id, status = excluded.status, created_at = excluded.created_at, started_at = excluded.started_at, finished_at = excluded.finished_at, metadata_json = excluded.metadata_json`,
				run.ID, sqliteProjectionOwnerID, run.ProjectID, nullString(run.ThreadID),
				firstNonEmpty(run.Status, "queued"), createdAt,
				nullString(run.StartedAt), nullString(run.FinishedAt),
			)
			return err
		},
		func(id string) error {
			_, err := tx.Exec(`DELETE FROM edge_runs WHERE run_id = ?`, id)
			return err
		},
	); err != nil {
		return fmt.Errorf("run delta: %w", err)
	}

	oldArtifactProj := buildArtifactProjectionMap(oldSnapshot)
	newArtifactProj := buildArtifactProjectionMap(newSnapshot)
	if err := deltaProjectionMap(tx, "edge_artifacts", "artifact_id",
		oldArtifactProj, newArtifactProj,
		func(id string, payload string) error {
			var proj artifactProjection
			if err := json.Unmarshal([]byte(payload), &proj); err != nil {
				return err
			}
			if proj.ArtifactID == "" || proj.RunID == "" || proj.WorkspaceID == "" {
				return nil
			}
			createdAt := firstNonEmpty(proj.CreatedAt, now)
			updatedAt := firstNonEmpty(proj.UpdatedAt, createdAt)
			_, err := tx.Exec(
				`INSERT INTO edge_artifacts (artifact_id, owner_id, workspace_id, run_id, kind, path, status, created_at, updated_at, metadata_json, content_source_kind, content_source_path, content_source_readable)
VALUES (?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?)
ON CONFLICT(artifact_id) DO UPDATE SET owner_id = excluded.owner_id, workspace_id = excluded.workspace_id, run_id = excluded.run_id, kind = excluded.kind, path = excluded.path, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at, metadata_json = excluded.metadata_json, content_source_kind = excluded.content_source_kind, content_source_path = excluded.content_source_path, content_source_readable = excluded.content_source_readable`,
				proj.ArtifactID, sqliteProjectionOwnerID, proj.WorkspaceID, proj.RunID,
				firstNonEmpty(proj.Kind, "file"), proj.Path, createdAt, updatedAt,
				proj.MetadataJSON, proj.ContentSourceKind, proj.ContentSourcePath, proj.ContentSourceReadable,
			)
			return err
		},
		func(id string) error {
			_, err := tx.Exec(`DELETE FROM edge_artifacts WHERE artifact_id = ?`, id)
			return err
		},
	); err != nil {
		return fmt.Errorf("artifact delta: %w", err)
	}

	oldDiffProj := buildDiffProjectionMap(oldSnapshot)
	newDiffProj := buildDiffProjectionMap(newSnapshot)
	if err := deltaProjectionMap(tx, "edge_diffs", "diff_id",
		oldDiffProj, newDiffProj,
		func(id string, payload string) error {
			var proj diffProjection
			if err := json.Unmarshal([]byte(payload), &proj); err != nil {
				return err
			}
			if proj.DiffID == "" || proj.RunID == "" || proj.WorkspaceID == "" {
				return nil
			}
			createdAt := firstNonEmpty(proj.CreatedAt, now)
			updatedAt := firstNonEmpty(proj.UpdatedAt, createdAt)
			_, err := tx.Exec(
				`INSERT INTO edge_diffs (diff_id, owner_id, workspace_id, run_id, summary_json, patch_path, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(diff_id) DO UPDATE SET owner_id = excluded.owner_id, workspace_id = excluded.workspace_id, run_id = excluded.run_id, summary_json = excluded.summary_json, patch_path = excluded.patch_path, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at`,
				proj.DiffID, sqliteProjectionOwnerID, proj.WorkspaceID, proj.RunID,
				proj.SummaryJSON, proj.PatchPath, firstNonEmpty(proj.Status, "modified"),
				createdAt, updatedAt,
			)
			return err
		},
		func(id string) error {
			_, err := tx.Exec(`DELETE FROM edge_diffs WHERE diff_id = ?`, id)
			return err
		},
	); err != nil {
		return fmt.Errorf("diff delta: %w", err)
	}

	oldPreviewProj := buildPreviewProjectionMap(oldSnapshot)
	newPreviewProj := buildPreviewProjectionMap(newSnapshot)
	if err := deltaProjectionMap(tx, "edge_previews", "preview_id",
		oldPreviewProj, newPreviewProj,
		func(id string, payload string) error {
			var proj previewProjection
			if err := json.Unmarshal([]byte(payload), &proj); err != nil {
				return err
			}
			if proj.PreviewID == "" || proj.RunID == "" || proj.WorkspaceID == "" {
				return nil
			}
			createdAt := firstNonEmpty(proj.CreatedAt, now)
			updatedAt := firstNonEmpty(proj.UpdatedAt, createdAt)
			_, err := tx.Exec(
				`INSERT INTO edge_previews (preview_id, owner_id, workspace_id, run_id, url, status, created_at, updated_at, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')
ON CONFLICT(preview_id) DO UPDATE SET owner_id = excluded.owner_id, workspace_id = excluded.workspace_id, run_id = excluded.run_id, url = excluded.url, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at, metadata_json = excluded.metadata_json`,
				proj.PreviewID, sqliteProjectionOwnerID, proj.WorkspaceID, proj.RunID,
				proj.URL, firstNonEmpty(proj.Status, "created"), createdAt, updatedAt,
			)
			return err
		},
		func(id string) error {
			_, err := tx.Exec(`DELETE FROM edge_previews WHERE preview_id = ?`, id)
			return err
		},
	); err != nil {
		return fmt.Errorf("preview delta: %w", err)
	}

	return nil
}

type artifactProjection struct {
	ArtifactID             string `json:"artifactId"`
	RunID                  string `json:"runId"`
	WorkspaceID            string `json:"workspaceId"`
	Kind                   string `json:"kind"`
	Path                   string `json:"path"`
	CreatedAt              string `json:"createdAt"`
	UpdatedAt              string `json:"updatedAt"`
	MetadataJSON           string `json:"metadataJson"`
	ContentSourceKind      string `json:"contentSourceKind"`
	ContentSourcePath      string `json:"contentSourcePath"`
	ContentSourceReadable  int    `json:"contentSourceReadable"`
}

func buildArtifactProjectionMap(snapshot fileSnapshot) map[string]string {
	result := make(map[string]string, len(snapshot.Artifacts))
	for id, artifact := range snapshot.Artifacts {
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
		csKind, csPath, csReadable := sqliteArtifactContentSourceColumns(artifact.ContentSource)
		metadataJSON, err := sqliteArtifactMetadataJSON(artifact)
		if err != nil {
			continue
		}
		proj := artifactProjection{
			ArtifactID:            id,
			RunID:                 artifact.RunID,
			WorkspaceID:           run.ProjectID,
			Kind:                  artifact.Kind,
			Path:                  artifact.Path,
			CreatedAt:             artifact.CreatedAt,
			UpdatedAt:             artifact.UpdatedAt,
			MetadataJSON:          metadataJSON,
			ContentSourceKind:     csKind,
			ContentSourcePath:     csPath,
			ContentSourceReadable: csReadable,
		}
		payload, _ := json.Marshal(proj)
		result[id] = string(payload)
	}
	return result
}

type diffProjection struct {
	DiffID      string `json:"diffId"`
	RunID       string `json:"runId"`
	WorkspaceID string `json:"workspaceId"`
	SummaryJSON string `json:"summaryJson"`
	PatchPath   string `json:"patchPath"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

func buildDiffProjectionMap(snapshot fileSnapshot) map[string]string {
	result := make(map[string]string, len(snapshot.Diffs))
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
		diffID := sqliteDiffProjectionID(diffFile)
		summaryJSON, err := sqliteDiffSummaryJSON(diffFile)
		if err != nil {
			continue
		}
		proj := diffProjection{
			DiffID:      diffID,
			RunID:       diffFile.RunID,
			WorkspaceID: run.ProjectID,
			SummaryJSON: summaryJSON,
			PatchPath:   diffFile.Path,
			Status:      diffFile.Status,
			CreatedAt:   diffFile.CreatedAt,
			UpdatedAt:   diffFile.UpdatedAt,
		}
		payload, _ := json.Marshal(proj)
		result[diffID] = string(payload)
	}
	return result
}

type previewProjection struct {
	PreviewID   string `json:"previewId"`
	RunID       string `json:"runId"`
	WorkspaceID string `json:"workspaceId"`
	URL         string `json:"url"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

func buildPreviewProjectionMap(snapshot fileSnapshot) map[string]string {
	result := make(map[string]string, len(snapshot.Previews))
	for id, preview := range snapshot.Previews {
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
		proj := previewProjection{
			PreviewID:   id,
			RunID:       preview.RunID,
			WorkspaceID: run.ProjectID,
			URL:         preview.URL,
			Status:      preview.Status,
			CreatedAt:   preview.CreatedAt,
			UpdatedAt:   preview.UpdatedAt,
		}
		payload, _ := json.Marshal(proj)
		result[id] = string(payload)
	}
	return result
}

func deltaProjectionMap(
	_ *sql.Tx,
	tableName, idColumn string,
	oldMap, newMap map[string]string,
	upsertFn func(id string, payload string) error,
	deleteFn func(id string) error,
) error {
	for id, newPayload := range newMap {
		oldPayload, existed := oldMap[id]
		if existed && oldPayload == newPayload {
			continue
		}
		if err := upsertFn(id, newPayload); err != nil {
			return fmt.Errorf("upsert %s %s in %s: %w", idColumn, id, tableName, err)
		}
	}
	for id := range oldMap {
		if _, ok := newMap[id]; !ok {
			if err := deleteFn(id); err != nil {
				return fmt.Errorf("delete %s %s from %s: %w", idColumn, id, tableName, err)
			}
		}
	}
	return nil
}

func cloneFileSnapshot(snapshot fileSnapshot) fileSnapshot {
	cloned := fileSnapshot{
		Projects:          copyMap(snapshot.Projects),
		Threads:           copyMap(snapshot.Threads),
		Runs:              copyMap(snapshot.Runs),
		Items:             copyMap(snapshot.Items),
		Pins:              copyMap(snapshot.Pins),
		Diffs:             copyMap(snapshot.Diffs),
		Artifacts:         cloneArtifactMap(snapshot.Artifacts),
		Previews:          copyMap(snapshot.Previews),
		UserProfiles:      copyMap(snapshot.UserProfiles),
		AgentProfiles:     copyMap(snapshot.AgentProfiles),
		ProjectOrder:      append([]string(nil), snapshot.ProjectOrder...),
		ThreadOrder:       append([]string(nil), snapshot.ThreadOrder...),
		RunOrder:          append([]string(nil), snapshot.RunOrder...),
		ItemOrder:         append([]string(nil), snapshot.ItemOrder...),
		PinOrder:          append([]string(nil), snapshot.PinOrder...),
		DiffOrder:         append([]string(nil), snapshot.DiffOrder...),
		ArtifactOrder:     append([]string(nil), snapshot.ArtifactOrder...),
		PreviewOrder:      append([]string(nil), snapshot.PreviewOrder...),
		UserProfileOrder:  append([]string(nil), snapshot.UserProfileOrder...),
		AgentProfileOrder: append([]string(nil), snapshot.AgentProfileOrder...),
		Settings:          copyMap(snapshot.Settings),
		SettingsMtime:     snapshot.SettingsMtime,
	}
	return cloned
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

func (s *SQLiteStore) CreateProject(id, name, ownerID string) (Project, error) {
	project, err := s.store.CreateProject(id, name, ownerID)
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

func (s *SQLiteStore) CreateThread(id, projectID, title, kind, avatarColor, avatarLabel string) (Thread, error) {
	thread, err := s.store.CreateThread(id, projectID, title, kind, avatarColor, avatarLabel)
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

func (s *SQLiteStore) SetRunEvidenceGate(id, result string) (Run, bool) {
	run, ok := s.store.SetRunEvidenceGate(id, result)
	if !ok {
		return Run{}, false
	}
	if err := s.syncPersist(); err != nil {
		return Run{}, false
	}
	return run, true
}

func (s *SQLiteStore) SetRunRetryCount(id string, count int) (Run, bool) {
	run, ok := s.store.SetRunRetryCount(id, count)
	if !ok {
		return Run{}, false
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
