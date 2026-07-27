package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestSQLiteDurableHardeningRestoresApprovalArtifactReplayAndPins(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}

	project, err := s.CreateProject("proj_durable_hardening", "Durable Hardening", "")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := s.CreateThread("thread_durable_hardening", project.ID, "Durable Hardening Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := s.CreateRun("run_durable_hardening", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if _, ok := s.SetRunStatus(run.ID, "started"); !ok {
		t.Fatalf("SetRunStatus(%s, started) returned false", run.ID)
	}

	approvalRequested := createDurableReplayItem(t, s, Item{
		ID:        "item_approval_requested",
		ProjectID: project.ID,
		ThreadID:  thread.ID,
		RunID:     run.ID,
		Type:      "run.agent.permission_requested",
		Role:      "agent",
		Status:    "pending",
	}, map[string]any{
		"eventType": "run.agent.permission_requested",
		"requestId": "req_durable_1",
		"toolName":  "Write",
		"reason":    "fixture write requires approval evidence",
	})
	approvalDecided := createDurableReplayItem(t, s, Item{
		ID:        "item_approval_decided",
		ProjectID: project.ID,
		ThreadID:  thread.ID,
		RunID:     run.ID,
		Type:      "run.agent.permission_decided",
		Role:      "human",
		Status:    "decided",
	}, map[string]any{
		"eventType": "run.agent.permission_decided",
		"requestId": "req_durable_1",
		"decision":  "allow",
		"reason":    "fixture approved",
	})
	fileChange := createDurableReplayItem(t, s, Item{
		ID:        "item_file_change",
		ProjectID: project.ID,
		ThreadID:  thread.ID,
		RunID:     run.ID,
		Type:      "run.agent.file_change",
		Role:      "agent",
		Status:    "created",
	}, map[string]any{
		"eventType": "run.agent.file_change",
		"path":      "src/durable.ts",
		"kind":      "modified",
		"diff":      "@@ -1 +1 @@\n-old\n+new",
	})
	artifactCreated := createDurableReplayItem(t, s, Item{
		ID:        "item_artifact_created",
		ProjectID: project.ID,
		ThreadID:  thread.ID,
		RunID:     run.ID,
		Type:      "artifact.created",
		Role:      "agent",
		Status:    "created",
	}, map[string]any{
		"eventType":  "artifact.created",
		"artifactId": "artifact_durable_report",
		"path":       "reports/durable.md",
		"kind":       "markdown",
	})

	diffFile, err := s.UpsertRunDiffFile(RunDiffFile{
		RunID:  run.ID,
		Path:   "src/durable.ts",
		Diff:   "@@ -1 +1 @@\n-old\n+new",
		Status: "modified",
	})
	if err != nil {
		t.Fatalf("UpsertRunDiffFile returned error: %v", err)
	}
	artifact, err := s.UpsertArtifact(Artifact{
		ID:        "artifact_durable_report",
		RunID:     run.ID,
		ThreadID:  thread.ID,
		Kind:      "markdown",
		Path:      "reports/durable.md",
		SizeBytes: 512,
	})
	if err != nil {
		t.Fatalf("UpsertArtifact returned error: %v", err)
	}
	if _, err := s.PinThreadItem(thread.ID, approvalRequested.ID, "controller"); err != nil {
		t.Fatalf("PinThreadItem approval returned error: %v", err)
	}
	if _, err := s.PinThreadItem(thread.ID, artifactCreated.ID, "controller"); err != nil {
		t.Fatalf("PinThreadItem artifact returned error: %v", err)
	}
	s.Close()

	deleteDurableSQLiteSnapshot(t, path)

	restored, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite restored returned error: %v", err)
	}
	defer restored.Close()

	if got, ok := restored.GetRun(run.ID); !ok || got.ProjectID != project.ID || got.ThreadID != thread.ID || got.Status != "started" || got.StartedAt == "" {
		t.Fatalf("restored run = %#v, %v; want started run with replay projection ids", got, ok)
	}
	items := restored.ListThreadItems(thread.ID)
	if len(items) != 4 {
		t.Fatalf("restored thread items = %#v, want four replay items", items)
	}
	assertDurableReplayItem(t, items[0], approvalRequested.ID, "run.agent.permission_requested", "req_durable_1")
	assertDurableReplayItem(t, items[1], approvalDecided.ID, "run.agent.permission_decided", "allow")
	assertDurableReplayItem(t, items[2], fileChange.ID, "run.agent.file_change", "src/durable.ts")
	assertDurableReplayItem(t, items[3], artifactCreated.ID, "artifact.created", artifact.ID)

	pins := restored.ListThreadPins(thread.ID)
	if len(pins) != 2 {
		t.Fatalf("restored pins = %#v, want approval and artifact pins", pins)
	}
	pinned := map[string]bool{}
	for _, pin := range pins {
		pinned[pin.ItemID] = pin.PinnedBy == "controller"
	}
	if !pinned[approvalRequested.ID] || !pinned[artifactCreated.ID] {
		t.Fatalf("restored pins = %#v, want controller pins for approval and artifact replay items", pins)
	}
	if got := restored.ListRunDiffFiles(run.ID); len(got) != 1 || got[0].Path != diffFile.Path || got[0].Diff != diffFile.Diff {
		t.Fatalf("restored run diff files = %#v, want durable file_change evidence", got)
	}
	if got := restored.ListArtifacts(run.ID); len(got) != 1 || got[0].ID != artifact.ID || got[0].Path != artifact.Path || got[0].SizeBytes != artifact.SizeBytes {
		t.Fatalf("restored artifacts = %#v, want durable artifact evidence", got)
	}

	assertDurableSQLiteProjection(t, restored, run.ID, artifact.ID, diffFile.Path)
}

func createDurableReplayItem(t *testing.T, s *SQLiteStore, item Item, payload map[string]any) Item {
	t.Helper()
	content, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal replay payload returned error: %v", err)
	}
	item.Content = string(content)
	created, err := s.CreateItem(item)
	if err != nil {
		t.Fatalf("CreateItem(%s) returned error: %v", item.ID, err)
	}
	return created
}

func deleteDurableSQLiteSnapshot(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`DELETE FROM agenthub_store_snapshots`); err != nil {
		t.Fatalf("delete snapshot returned error: %v", err)
	}
}

func assertDurableReplayItem(t *testing.T, item Item, itemID, itemType, contentNeedle string) {
	t.Helper()
	if item.ID != itemID || item.Type != itemType {
		t.Fatalf("restored item = %#v, want id=%s type=%s", item, itemID, itemType)
	}
	if !json.Valid([]byte(item.Content)) {
		t.Fatalf("restored item %s content is not JSON: %s", item.ID, item.Content)
	}
	if contentNeedle != "" && !strings.Contains(item.Content, contentNeedle) {
		t.Fatalf("restored item %s content = %s, want content containing %q", item.ID, item.Content, contentNeedle)
	}
}

func assertDurableSQLiteProjection(t *testing.T, s *SQLiteStore, runID, artifactID, diffPath string) {
	t.Helper()
	var runStatus string
	if err := s.db.QueryRow(`SELECT status FROM edge_runs WHERE run_id = ?`, runID).Scan(&runStatus); err != nil {
		t.Fatalf("query projected run returned error: %v", err)
	}
	if runStatus != "started" {
		t.Fatalf("projected run status = %q, want started", runStatus)
	}
	var artifactPath string
	if err := s.db.QueryRow(`SELECT path FROM edge_artifacts WHERE artifact_id = ?`, artifactID).Scan(&artifactPath); err != nil {
		t.Fatalf("query projected artifact returned error: %v", err)
	}
	if artifactPath != "reports/durable.md" {
		t.Fatalf("projected artifact path = %q, want reports/durable.md", artifactPath)
	}
	var diffStatus string
	if err := s.db.QueryRow(`SELECT status FROM edge_diffs WHERE run_id = ? AND patch_path = ?`, runID, diffPath).Scan(&diffStatus); err != nil {
		t.Fatalf("query projected diff returned error: %v", err)
	}
	if diffStatus != "modified" {
		t.Fatalf("projected diff status = %q, want modified", diffStatus)
	}
}

// TestSQLiteUpsertSettingsSurfacesPersistError pins the persistAfterSQLiteWrite
// policy for settings: a failed persist must surface to the caller instead of
// being silently dropped (previously `_ = s.syncPersist()`).
func TestSQLiteUpsertSettingsSurfacesPersistError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-settings-persist-err.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}

	if _, err := s.UpsertSettings(map[string]string{"theme": "dark"}); err != nil {
		t.Fatalf("UpsertSettings healthy write returned error: %v", err)
	}

	// Break the persistence layer: close the underlying DB connection directly
	// (same technique as the crash-recovery tests).
	if err := s.db.Close(); err != nil {
		t.Fatalf("db.Close returned error: %v", err)
	}

	if _, err := s.UpsertSettings(map[string]string{"theme": "light"}); err == nil {
		t.Fatal("UpsertSettings after db close returned nil error, want persist error")
	}
	if s.LastPersistError() == nil {
		t.Fatal("LastPersistError = nil, want recorded persist error")
	}
}

// TestSQLiteSettingsSurviveReopen pins the durable settings path: settings live
// only in the snapshot payload, so applySnapshot must restore Settings/SettingsMtime
// or reopen silently drops them (false success on persistence).
func TestSQLiteSettingsSurviveReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-settings-reopen.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	if _, err := s.UpsertSettings(map[string]string{"theme": "dark", "locale": "zh-CN"}); err != nil {
		t.Fatalf("UpsertSettings returned error: %v", err)
	}
	before := s.GetSettings()
	if before.Values["theme"] != "dark" || before.Values["locale"] != "zh-CN" || before.UpdatedAt == "" {
		t.Fatalf("GetSettings before close = %#v, want dark/zh-CN with mtime", before)
	}
	s.Close()

	restored, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite reopen returned error: %v", err)
	}
	defer restored.Close()

	got := restored.GetSettings()
	if got.Values["theme"] != "dark" || got.Values["locale"] != "zh-CN" {
		t.Fatalf("GetSettings after reopen = %#v, want durable theme/locale", got)
	}
	if got.UpdatedAt == "" {
		t.Fatal("GetSettings after reopen missing UpdatedAt")
	}
}

// TestSQLiteBoolWriteSurfacesPersistFailure ensures SetRunStatus does not report
// ok=true when the durable write fails (no false success on bool writers).
func TestSQLiteBoolWriteSurfacesPersistFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-bool-persist-err.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	project, err := s.CreateProject("proj_bool_persist", "Bool Persist", "")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := s.CreateThread("thread_bool_persist", project.ID, "Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := s.CreateRun("run_bool_persist", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if err := s.db.Close(); err != nil {
		t.Fatalf("db.Close returned error: %v", err)
	}

	if _, ok := s.SetRunStatus(run.ID, "started"); ok {
		t.Fatal("SetRunStatus after db close returned ok=true, want false on persist failure")
	}
	if s.LastPersistError() == nil {
		t.Fatal("LastPersistError = nil after bool write persist failure")
	}
}

// TestSQLiteCleanupRunsSurfacesPersistFailure keeps cleanup counts honest when
// memory already dropped terminal runs but the durable write failed.
func TestSQLiteCleanupRunsSurfacesPersistFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-cleanup-persist-err.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	project, err := s.CreateProject("proj_cleanup_persist", "Cleanup Persist", "")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := s.CreateThread("thread_cleanup_persist", project.ID, "Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := s.CreateRun("run_cleanup_persist", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if _, ok := s.SetRunStatus(run.ID, "finished"); !ok {
		t.Fatal("SetRunStatus finished returned false")
	}
	if _, err := s.CreateItem(Item{
		ID:        "item_cleanup_persist_run",
		ProjectID: project.ID,
		ThreadID:  thread.ID,
		RunID:     run.ID,
		Type:      "event",
		Role:      "assistant",
		Status:    "created",
		Content:   "bound to finished run",
	}); err != nil {
		t.Fatalf("CreateItem returned error: %v", err)
	}

	if err := s.db.Close(); err != nil {
		t.Fatalf("db.Close returned error: %v", err)
	}

	result := s.CleanupRuns(RunCleanupOptions{
		Now:                      time.Now().UTC().Add(48 * time.Hour),
		TerminalTTL:              time.Hour,
		MaxTerminalRunsPerThread: 0,
	})
	if result.RemovedRuns != 1 {
		t.Fatalf("CleanupRuns after db close = %#v, want RemovedRuns=1 (memory already cleaned)", result)
	}
	if s.LastPersistError() == nil {
		t.Fatal("LastPersistError = nil after cleanup persist failure")
	}
}

// TestSQLiteConcurrentWritersSerializeThroughPersistMutex verifies concurrent
// writers do not corrupt durable state under the single-connection + persistMu boundary.
func TestSQLiteConcurrentWritersSerializeThroughPersistMutex(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-concurrent-persist.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	project, err := s.CreateProject("proj_concurrent_persist", "Concurrent Persist", "")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := s.CreateThread("thread_concurrent_persist", project.ID, "Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}

	const writers = 24
	var wg sync.WaitGroup
	errCh := make(chan error, writers)
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			runID := fmt.Sprintf("run_concurrent_persist_%d", idx)
			if _, err := s.CreateRun(runID, project.ID, thread.ID); err != nil {
				errCh <- err
				return
			}
			if _, ok := s.SetRunStatus(runID, "started"); !ok {
				errCh <- fmt.Errorf("SetRunStatus(%s) returned false", runID)
				return
			}
			if _, err := s.CreateThreadMessage(fmt.Sprintf("item_concurrent_persist_%d", idx), thread.ID, "assistant", "ok"); err != nil {
				errCh <- err
			}
		}(i)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatalf("concurrent writer error: %v", err)
	}
	if err := s.LastPersistError(); err != nil {
		t.Fatalf("LastPersistError after concurrent writes: %v", err)
	}
	s.Close()

	restored, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite reopen returned error: %v", err)
	}
	defer restored.Close()
	if got := restored.ListRuns(thread.ID); len(got) != writers {
		t.Fatalf("restored runs = %d, want %d", len(got), writers)
	}
	if got := restored.ListThreadItems(thread.ID); len(got) != writers {
		t.Fatalf("restored items = %d, want %d", len(got), writers)
	}
}
