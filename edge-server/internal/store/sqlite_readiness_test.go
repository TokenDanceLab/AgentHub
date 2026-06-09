package store

import (
	"path/filepath"
	"testing"
)

func TestSQLiteStoreReadinessRestoresAfterEachDurableWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-readiness.db")

	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}

	project, err := s.CreateProject("proj_readiness", "Readiness Project")
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
	thread, err := s.CreateThread("thread_readiness", project.ID, "Readiness Thread")
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
	if report.LatestMigrationVersion != 4 {
		t.Fatalf("LatestMigrationVersion = %d, want 4", report.LatestMigrationVersion)
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
