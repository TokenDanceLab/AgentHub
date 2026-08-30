package store

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestSQLiteStoreReadinessRestoresAfterEachDurableWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-readiness.db")

	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}

	project, err := s.CreateProject("proj_readiness", "Readiness Project", "")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	s.Close()
	assertSQLiteReadinessRoundTrip(t, path, func(t *testing.T, restored *SQLiteStore) {
		if got := restored.ListProjects(); len(got) != 1 || got[0].ID != project.ID {
			t.Fatalf("restored projects = %#v, want %s", got, project.ID)
		}
	})

	s = reopenSQLiteReadinessStore(t, path)
	thread, err := s.CreateThread("thread_readiness", project.ID, "Readiness Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	s.Close()
	assertSQLiteReadinessRoundTrip(t, path, func(t *testing.T, restored *SQLiteStore) {
		if got, ok := restored.GetThread(thread.ID); !ok || got.ProjectID != project.ID || got.Title != thread.Title {
			t.Fatalf("restored thread = %#v ok=%v, want scoped thread", got, ok)
		}
	})

	s = reopenSQLiteReadinessStore(t, path)
	run, err := s.CreateRun("run_readiness", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if _, ok := s.SetRunStatus(run.ID, "started"); !ok {
		t.Fatalf("SetRunStatus(%s, started) returned false", run.ID)
	}
	s.Close()
	assertSQLiteReadinessRoundTrip(t, path, func(t *testing.T, restored *SQLiteStore) {
		if got, ok := restored.GetRun(run.ID); !ok || got.ThreadID != thread.ID || got.Status != "started" || got.StartedAt == "" {
			t.Fatalf("restored run = %#v ok=%v, want started run", got, ok)
		}
	})

	s = reopenSQLiteReadinessStore(t, path)
	item, err := s.CreateThreadMessage("item_readiness", thread.ID, "assistant", "readiness replay item")
	if err != nil {
		t.Fatalf("CreateThreadMessage returned error: %v", err)
	}
	if _, err := s.PinThreadItem(thread.ID, item.ID, "edge-readiness"); err != nil {
		t.Fatalf("PinThreadItem returned error: %v", err)
	}
	s.Close()
	assertSQLiteReadinessRoundTrip(t, path, func(t *testing.T, restored *SQLiteStore) {
		if got := restored.ListThreadItems(thread.ID); len(got) != 1 || got[0].ID != item.ID || got[0].Content != item.Content {
			t.Fatalf("restored thread items = %#v, want replay item", got)
		}
		if got := restored.ListThreadPins(thread.ID); len(got) != 1 || got[0].ItemID != item.ID || got[0].PinnedBy != "edge-readiness" {
			t.Fatalf("restored pins = %#v, want pinned replay item", got)
		}
	})

	s = reopenSQLiteReadinessStore(t, path)
	if _, err := s.UpsertRunDiffFile(RunDiffFile{
		RunID:  run.ID,
		Path:   "src/readiness.go",
		Diff:   "@@ -0 +1 @@\n+ready",
		Status: "added",
	}); err != nil {
		t.Fatalf("UpsertRunDiffFile returned error: %v", err)
	}
	artifact, err := s.UpsertArtifact(Artifact{
		ID:            "artifact_readiness",
		RunID:         run.ID,
		Kind:          "markdown",
		Path:          "dist/readiness.md",
		SizeBytes:     64,
		ContentSource: NewArtifactContentSource(filepath.Join(t.TempDir(), "workspace"), "dist/readiness.md"),
	})
	if err != nil {
		t.Fatalf("UpsertArtifact returned error: %v", err)
	}
	preview, err := s.UpsertPreview(Preview{
		ID:     "preview_readiness",
		RunID:  run.ID,
		URL:    "http://127.0.0.1:4173/readiness",
		Status: "ready",
	})
	if err != nil {
		t.Fatalf("UpsertPreview returned error: %v", err)
	}
	s.Close()

	report, err := SQLiteReadiness(path)
	if err != nil {
		t.Fatalf("SQLiteReadiness returned error: %v", err)
	}
	if report.IntegrityCheck != "ok" {
		t.Fatalf("IntegrityCheck = %q, want ok", report.IntegrityCheck)
	}
	if report.LatestMigrationVersion != 5 {
		t.Fatalf("LatestMigrationVersion = %d, want 5", report.LatestMigrationVersion)
	}
	if got := report.RowCounts["diff"]; got != 1 {
		t.Fatalf("diff row count = %d, want 1", got)
	}
	if got := report.RowCounts["artifact"]; got != 1 {
		t.Fatalf("artifact row count = %d, want 1", got)
	}
	if got := report.ProjectionCounts["edge_diffs"]; got != 1 {
		t.Fatalf("edge_diffs projection count = %d, want 1", got)
	}
	if got := report.ProjectionCounts["edge_artifacts"]; got != 1 {
		t.Fatalf("edge_artifacts projection count = %d, want 1", got)
	}
	manifest := report.Manifest()
	if manifest.Schema != SQLiteReadinessManifestSchema {
		t.Fatalf("manifest schema = %q, want %q", manifest.Schema, SQLiteReadinessManifestSchema)
	}
	if manifest.Status != "ready" || manifest.MigrationStatus != "current" {
		t.Fatalf("manifest status = %q migration = %q, want ready/current", manifest.Status, manifest.MigrationStatus)
	}
	if manifest.ExpectedMigrationVersion != LatestSQLiteMigrationVersion() || manifest.ExpectedMigrationVersion != 5 {
		t.Fatalf("manifest expected migration = %d, want latest 5", manifest.ExpectedMigrationVersion)
	}
	if len(manifest.MissingMigrationVersions) != 0 || len(manifest.UnknownMigrationVersions) != 0 {
		t.Fatalf("manifest missing=%v unknown=%v, want none", manifest.MissingMigrationVersions, manifest.UnknownMigrationVersions)
	}
	if got := manifest.RowCounts["artifact"]; got != 1 {
		t.Fatalf("manifest artifact row count = %d, want 1", got)
	}

	assertSQLiteReadinessRoundTrip(t, path, func(t *testing.T, restored *SQLiteStore) {
		if got := restored.ListRunDiffFiles(run.ID); len(got) != 1 || got[0].Path != "src/readiness.go" {
			t.Fatalf("restored file changes = %#v, want src/readiness.go", got)
		}
		if got, ok := restored.GetArtifact(artifact.ID); !ok || got.RunID != run.ID || got.ContentSource == nil || got.ContentSource.Path != "dist/readiness.md" {
			t.Fatalf("restored artifact = %#v ok=%v, want readable readiness artifact", got, ok)
		}
		if got, ok := restored.GetPreview(preview.ID); !ok || got.URL != preview.URL || got.Status != "ready" {
			t.Fatalf("restored preview = %#v ok=%v, want ready preview", got, ok)
		}
	})
}

func TestSQLiteReadinessManifestBlocksStaleMigrationState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-readiness-stale.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	s.Close()

	deleteSQLiteReadinessMigrationRecord(t, path, 4)

	report, err := SQLiteReadiness(path)
	if err != nil {
		t.Fatalf("SQLiteReadiness returned error: %v", err)
	}
	manifest := report.Manifest()
	if manifest.Status != "blocked" || manifest.MigrationStatus != "behind" {
		t.Fatalf("manifest status = %q migration = %q, want blocked/behind", manifest.Status, manifest.MigrationStatus)
	}
	if got, want := manifest.MissingMigrationVersions, []int{4}; len(got) != 1 || got[0] != want[0] {
		t.Fatalf("missing migrations = %v, want %v", got, want)
	}
}

func TestSQLiteReadinessManifestForPathReturnsSerializableStatus(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-readiness-manifest.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	s.Close()

	manifest, err := SQLiteReadinessManifestForPath(path)
	if err != nil {
		t.Fatalf("SQLiteReadinessManifestForPath returned error: %v", err)
	}
	if manifest.Schema != "agenthub-edge-sqlite-readiness-v1" {
		t.Fatalf("manifest schema = %q", manifest.Schema)
	}
	if manifest.Status != "ready" || manifest.IntegrityCheck != "ok" {
		t.Fatalf("manifest status = %q integrity = %q, want ready/ok", manifest.Status, manifest.IntegrityCheck)
	}
	if len(manifest.RequiredRowKinds) != 8 || len(manifest.RequiredProjectionTables) != 6 {
		t.Fatalf("required row kinds=%v projection tables=%v", manifest.RequiredRowKinds, manifest.RequiredProjectionTables)
	}
}

func deleteSQLiteReadinessMigrationRecord(t *testing.T, path string, version int) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open sqlite returned error: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`DELETE FROM agenthub_sqlite_migrations WHERE version = ?`, version); err != nil {
		t.Fatalf("delete migration record returned error: %v", err)
	}
}

func reopenSQLiteReadinessStore(t *testing.T, path string) *SQLiteStore {
	t.Helper()
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite restore returned error: %v", err)
	}
	return s
}

func assertSQLiteReadinessRoundTrip(t *testing.T, path string, assert func(*testing.T, *SQLiteStore)) {
	t.Helper()
	restored := reopenSQLiteReadinessStore(t, path)
	defer restored.Close()
	assert(t, restored)
}
