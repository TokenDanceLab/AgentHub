package store

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	// modernc.org/sqlite registers its pure-Go sqlite driver via a side-effect import.
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
	sqliteRowKindSettings     = "settings"
	sqliteRowKindCheckpoint   = "checkpoint"
)

type SQLiteStore struct {
	db           *sql.DB
	store        *Store
	persistMu    sync.Mutex
	closeOnce    sync.Once
	backgroundWG sync.WaitGroup
	lastErr      error
	lastSnapshot fileSnapshot
	// rowsSeeded marks agenthub_store_rows as the durable source of truth:
	// once set, syncPersist skips the legacy full-store payload UPSERT
	// (write amplification — the payload is only the pre-rows fallback and
	// is kept fresh until the first commit that durably seeds the rows).
	rowsSeeded     bool
	stopCheckpoint chan struct{} // closed to stop both background loops
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
	s.backgroundWG.Go(func() { s.checkpointLoop(sqliteBackgroundLoopInterval) })
	// Periodically clean up old terminal runs to prevent unbounded Store map growth.
	// Without this, Store maps only shrink when a new run is created,
	// which may never happen on an idle server.
	s.backgroundWG.Go(func() { s.cleanupLoop(sqliteBackgroundLoopInterval) })

	return s, nil
}

func (s *SQLiteStore) checkpointLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if _, err := s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
				// Non-fatal; the auto-checkpoint will still work, but the failure
				// must be visible instead of silently swallowed.
				slog.Warn("sqlite store: periodic wal checkpoint failed", "error", err)
			}
		case <-s.stopCheckpoint:
			return
		}
	}
}

// cleanupLoop periodically removes old terminal runs and persists the deletes.
// Failed commits remain pending for the next tick, even if no new runs expire.
func (s *SQLiteStore) cleanupLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	pendingPersist := false
	for {
		select {
		case <-ticker.C:
			result := s.store.CleanupRuns(sqlitePeriodicCleanupOptions())
			// A failed commit already removed data from memory. Retry it even
			// when the next tick has no additional runs to remove.
			pendingPersist = pendingPersist || shouldSyncAfterCleanup(result)
			if !pendingPersist {
				continue
			}
			if err := s.syncPersist(); err != nil {
				slog.Warn("sqlite store: periodic cleanup persist failed", "error", err)
				continue
			}
			pendingPersist = false
		case <-s.stopCheckpoint:
			return
		}
	}
}

func (s *SQLiteStore) Close() {
	s.closeOnce.Do(func() {
		close(s.stopCheckpoint)
		s.backgroundWG.Wait()
		// Final checkpoint to shrink the WAL before close. Failures are logged
		// (not returned) to keep the shutdown signature; LastPersistError still
		// reflects the final persist outcome.
		if _, err := s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
			slog.Warn("sqlite store: final wal checkpoint failed on close", "error", err)
		}
		if err := s.syncPersist(); err != nil {
			slog.Warn("sqlite store: final persist failed on close", "error", err)
		}
		if err := s.db.Close(); err != nil {
			slog.Warn("sqlite store: db close failed", "error", err)
		}
	})
}

func (s *SQLiteStore) Flush() {
	if err := s.syncPersist(); err != nil {
		slog.Warn("sqlite store: flush persist failed", "error", err)
	}
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
	if planSQLiteLoadSource(ok).UseRows {
		if rowSnapshot.Settings == nil {
			// Legacy DB: the rows table predates the settings/checkpoint row
			// kinds. Adopt those fields from the legacy payload (last written
			// before this upgrade); the first persist rewrites them as rows
			// and completes the migration. The settings row doubles as the
			// migrated marker — once present, adoption never runs again.
			if legacy, found := s.readLegacySnapshotPayload(); found {
				rowSnapshot.Settings = legacy.Settings
				rowSnapshot.SettingsMtime = legacy.SettingsMtime
				rowSnapshot.Checkpoints = legacy.Checkpoints
			}
		}
		s.store.applySnapshot(rowSnapshot)
		s.rowsSeeded = true
		return nil
	}

	var payload string
	err = s.db.QueryRow(
		`SELECT payload FROM agenthub_store_snapshots WHERE key = ?`,
		sqliteSnapshotKey,
	).Scan(&payload)
	plan := planLegacySnapshotLoad(errors.Is(err, sql.ErrNoRows), err, payload)
	if plan.Skip {
		return nil
	}
	if plan.Fail {
		return fmt.Errorf("read sqlite store snapshot: %w", err)
	}

	snapshot, err := decodeSQLiteSnapshotPayload(payload)
	if err != nil {
		return fmt.Errorf("decode sqlite store snapshot: %w", err)
	}
	s.store.applySnapshot(snapshot)
	return nil
}

// readLegacySnapshotPayload decodes the agenthub_store_snapshots payload for
// best-effort adoption of fields that older rows layers did not persist
// (settings/checkpoints). Missing rows, blank payloads, and decode errors all
// degrade to "not found" — the rows table remains the source of truth.
func (s *SQLiteStore) readLegacySnapshotPayload() (fileSnapshot, bool) {
	var payload string
	err := s.db.QueryRow(
		`SELECT payload FROM agenthub_store_snapshots WHERE key = ?`,
		sqliteSnapshotKey,
	).Scan(&payload)
	if err != nil || isBlankSQLiteSnapshotPayload(payload) {
		return fileSnapshot{}, false
	}
	snapshot, err := decodeSQLiteSnapshotPayload(payload)
	if err != nil {
		slog.Warn("sqlite store: legacy snapshot payload unreadable during settings adoption", "error", err)
		return fileSnapshot{}, false
	}
	return snapshot, true
}

func (s *SQLiteStore) syncPersist() error {
	s.persistMu.Lock()
	defer s.persistMu.Unlock()

	snapshot := s.store.snapshot()
	tx, err := s.db.Begin()
	if err != nil {
		s.lastErr = fmt.Errorf("begin sqlite store persist: %w", err)
		return s.lastErr
	}
	// Legacy full-store payload UPSERT: pure write amplification once
	// agenthub_store_rows is the durable source of truth (load prefers rows,
	// and both durability suites recover from rows alone). Keep writing it
	// only until the rows table has been durably seeded.
	if !s.rowsSeeded {
		payload, encodeErr := encodeSQLiteSnapshotPayload(snapshot)
		if encodeErr != nil {
			_ = tx.Rollback()
			s.lastErr = fmt.Errorf("encode sqlite store snapshot: %w", encodeErr)
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
	// The commit above durably carries the rows delta in the same transaction
	// as the payload. Once the snapshot has content, the rows table holds the
	// full store (delta chains start from the zero lastSnapshot that load
	// left behind), so the legacy payload is no longer needed as a fallback.
	// Empty stores never flip: their persists stay cheap either way and no
	// stale fallback can be stranded.
	if sqliteSnapshotHasContent(snapshot) {
		s.rowsSeeded = true
	}
	s.lastErr = nil
	return nil
}

// sqliteSnapshotHasContent reports whether any durable collection carries at
// least one entry (settings-only state counts via the settings row written
// by deltaSQLiteSettingsRow and is intentionally not part of this check:
// settings cannot exist without a persist that also seeds entity rows).
func sqliteSnapshotHasContent(snap fileSnapshot) bool {
	return len(snap.Projects) > 0 || len(snap.Threads) > 0 || len(snap.Runs) > 0 ||
		len(snap.Items) > 0 || len(snap.Pins) > 0 || len(snap.Diffs) > 0 ||
		len(snap.Artifacts) > 0 || len(snap.Previews) > 0 ||
		len(snap.AgentProfiles) > 0 || len(snap.UserProfiles) > 0 ||
		len(snap.Checkpoints) > 0
}

// ── Row load, delta, relational-projection, and filesystem helpers ──
//
// loadSQLiteRows, deltaSQLiteRows, deltaRowsOfKind,
// deltaSQLiteRelationalProjection, and ensureSQLiteDirectory were peeled to
// sqlite_store_pure.go (#1069). They remain package-level functions in
// package store — no call-site changes.

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
	if shouldSkipPersistOnProjectExists(err) {
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
		return finalizeSQLiteBoolWrite(Thread{}, false, nil)
	}
	return finalizeSQLiteBoolWrite(thread, true, s.syncPersist())
}

func (s *SQLiteStore) DeleteThread(id string) bool {
	ok := s.store.DeleteThread(id)
	if !ok {
		return finalizeSQLiteBoolOK(false, nil)
	}
	return finalizeSQLiteBoolOK(true, s.syncPersist())
}

func (s *SQLiteStore) ListThreads(projectID string) []Thread {
	return s.store.ListThreads(projectID)
}

func (s *SQLiteStore) CreateRun(id, projectID, threadID string) (Run, error) {
	run, err := s.store.CreateRun(id, projectID, threadID)
	return persistAfterSQLiteWrite(s, run, err)
}

func (s *SQLiteStore) CreateRunAdmission(id, projectID, threadID, hubTaskID string) (Run, error) {
	run, err := s.store.CreateRunAdmission(id, projectID, threadID, hubTaskID)
	return persistAfterSQLiteWrite(s, run, err)
}

func (s *SQLiteStore) RecordRunAdmission(id, errorCode string) (Run, error) {
	run, err := s.store.RecordRunAdmission(id, errorCode)
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
	if !shouldSyncAfterCleanup(result) {
		return result
	}
	// Persist failures stay on LastPersistError. Still return the in-memory
	// cleanup counts so callers can see what memory already dropped.
	return finalizeSQLiteCleanupAfterPersist(result, s.syncPersist())
}

func (s *SQLiteStore) SetRunStatus(id, status string) (Run, bool) {
	run, ok := s.store.SetRunStatus(id, status)
	if !ok {
		return finalizeSQLiteBoolWrite(Run{}, false, nil)
	}
	return finalizeSQLiteBoolWrite(run, true, s.syncPersist())
}

func (s *SQLiteStore) SetRunStatusIf(id, status string, allowedCurrent ...string) (Run, bool) {
	run, ok := s.store.SetRunStatusIf(id, status, allowedCurrent...)
	if !ok {
		// Preserve pre-persist run value on !ok (differs from other bool writers).
		return run, false
	}
	return finalizeSQLiteBoolWrite(run, true, s.syncPersist())
}

func (s *SQLiteStore) SetRunEvidenceGate(id, result string) (Run, bool) {
	run, ok := s.store.SetRunEvidenceGate(id, result)
	if !ok {
		return finalizeSQLiteBoolWrite(Run{}, false, nil)
	}
	return finalizeSQLiteBoolWrite(run, true, s.syncPersist())
}

func (s *SQLiteStore) SetRunRetryCount(id string, count int) (Run, bool) {
	run, ok := s.store.SetRunRetryCount(id, count)
	if !ok {
		return finalizeSQLiteBoolWrite(Run{}, false, nil)
	}
	return finalizeSQLiteBoolWrite(run, true, s.syncPersist())
}

func (s *SQLiteStore) SetRunWorkDir(id, workDir string) (Run, bool) {
	run, ok := s.store.SetRunWorkDir(id, workDir)
	if !ok {
		return finalizeSQLiteBoolWrite(Run{}, false, nil)
	}
	return finalizeSQLiteBoolWrite(run, true, s.syncPersist())
}

func (s *SQLiteStore) GetRunByHubTaskID(hubTaskID string) (Run, bool) {
	return s.store.GetRunByHubTaskID(hubTaskID)
}

func (s *SQLiteStore) SetRunHubTaskID(id, hubTaskID string) (Run, bool) {
	run, ok := s.store.SetRunHubTaskID(id, hubTaskID)
	if !ok {
		return finalizeSQLiteBoolWrite(Run{}, false, nil)
	}
	return finalizeSQLiteBoolWrite(run, true, s.syncPersist())
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
		return finalizeSQLiteBoolOK(false, nil)
	}
	return finalizeSQLiteBoolOK(true, s.syncPersist())
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

func (s *SQLiteStore) UpsertRunCheckpoint(cp RunCheckpoint) (RunCheckpoint, error) {
	checkpoint, err := s.store.UpsertRunCheckpoint(cp)
	return persistAfterSQLiteWrite(s, checkpoint, err)
}

func (s *SQLiteStore) GetRunCheckpoint(runID string) (RunCheckpoint, bool) {
	return s.store.GetRunCheckpoint(runID)
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
		return finalizeSQLiteErrWrite(AgentProfile{}, err, nil)
	}
	return finalizeSQLiteErrWrite(profile, nil, s.syncPersist())
}

func (s *SQLiteStore) DeleteAgentProfile(id string) error {
	err := s.store.DeleteAgentProfile(id)
	if err != nil {
		return finalizeSQLiteDeleteErr(err, nil)
	}
	return finalizeSQLiteDeleteErr(nil, s.syncPersist())
}

func (s *SQLiteStore) GetCurrentUser() (UserProfile, bool) {
	return s.store.GetCurrentUser()
}

// ── UserSettings delegating methods ──

func (s *SQLiteStore) GetSettings() UserSettings {
	return s.store.GetSettings()
}

func (s *SQLiteStore) UpsertSettings(patch map[string]string) (UserSettings, error) {
	result, err := s.store.UpsertSettings(patch)
	return persistAfterSQLiteWrite(s, result, err)
}
