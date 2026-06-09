package store

import (
	"path/filepath"
	"testing"
)

func TestSQLiteProjectionWritesRunAndArtifactReadModel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	defer s.Close()

	project, err := s.CreateProject("proj_projection", "Projection Project")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := s.CreateThread("thread_projection", project.ID, "Projection Thread")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := s.CreateRun("run_projection", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if _, ok := s.SetRunStatus(run.ID, "started"); !ok {
		t.Fatalf("SetRunStatus(%s) returned false", run.ID)
	}
	diffFile, err := s.UpsertRunDiffFile(RunDiffFile{
		RunID:  run.ID,
		Path:   "src/app.ts",
		Diff:   "@@ -1 +1 @@\n-old\n+new",
		Status: "modified",
	})
	if err != nil {
		t.Fatalf("UpsertRunDiffFile returned error: %v", err)
	}
	diffFile, err = s.UpsertRunDiffFile(RunDiffFile{
		RunID:  run.ID,
		Path:   "src/app.ts",
		Diff:   "@@ -1 +1 @@\n-old\n+newer",
		Status: "modified",
	})
	if err != nil {
		t.Fatalf("UpsertRunDiffFile update returned error: %v", err)
	}
	secondDiffFile, err := s.UpsertRunDiffFile(RunDiffFile{
		RunID:  run.ID,
		Path:   "README.md",
		Diff:   "@@ -0 +1 @@\n+hello",
		Status: "added",
	})
	if err != nil {
		t.Fatalf("UpsertRunDiffFile second returned error: %v", err)
	}

	workspaceRoot := filepath.Join(t.TempDir(), "workspace")
	source := filepath.Join(workspaceRoot, "dist", "report.md")
	artifact, err := s.UpsertArtifact(Artifact{
		ID:            "artifact_projection",
		RunID:         run.ID,
		ThreadID:      thread.ID,
		Kind:          "markdown",
		Path:          source,
		SizeBytes:     128,
		ContentSource: NewArtifactContentSource(workspaceRoot, source),
	})
	if err != nil {
		t.Fatalf("UpsertArtifact returned error: %v", err)
	}
	preview, err := s.UpsertPreview(Preview{
		ID:       "preview_projection",
		RunID:    run.ID,
		ThreadID: thread.ID,
		URL:      "http://127.0.0.1:4173",
		Status:   "ready",
	})
	if err != nil {
		t.Fatalf("UpsertPreview returned error: %v", err)
	}
	s.Close()

	reopened, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("reopen NewSQLite returned error: %v", err)
	}
	defer reopened.Close()

	var projectedRun struct {
		workspaceID string
		threadID    string
		status      string
		createdAt   string
		startedAt   string
	}
	if err := reopened.db.QueryRow(`SELECT workspace_id, thread_id, status, created_at, started_at FROM edge_runs WHERE run_id = ?`, run.ID).Scan(
		&projectedRun.workspaceID,
		&projectedRun.threadID,
		&projectedRun.status,
		&projectedRun.createdAt,
		&projectedRun.startedAt,
	); err != nil {
		t.Fatalf("query projected run returned error: %v", err)
	}
	if projectedRun.workspaceID != project.ID || projectedRun.threadID != thread.ID || projectedRun.status != "started" || projectedRun.createdAt == "" || projectedRun.startedAt == "" {
		t.Fatalf("projected run = %#v, want project/thread scoped started run", projectedRun)
	}

	var projectedArtifact struct {
		workspaceID           string
		runID                 string
		kind                  string
		path                  string
		status                string
		contentSourceKind     string
		contentSourcePath     string
		contentSourceReadable int
		metadataJSON          string
	}
	if err := reopened.db.QueryRow(`SELECT workspace_id, run_id, kind, path, status, content_source_kind, content_source_path, content_source_readable, metadata_json FROM edge_artifacts WHERE artifact_id = ?`, artifact.ID).Scan(
		&projectedArtifact.workspaceID,
		&projectedArtifact.runID,
		&projectedArtifact.kind,
		&projectedArtifact.path,
		&projectedArtifact.status,
		&projectedArtifact.contentSourceKind,
		&projectedArtifact.contentSourcePath,
		&projectedArtifact.contentSourceReadable,
		&projectedArtifact.metadataJSON,
	); err != nil {
		t.Fatalf("query projected artifact returned error: %v", err)
	}
	if projectedArtifact.workspaceID != project.ID || projectedArtifact.runID != run.ID || projectedArtifact.kind != "markdown" || projectedArtifact.path != "report.md" || projectedArtifact.status != "created" {
		t.Fatalf("projected artifact metadata = %#v, want scoped markdown report artifact", projectedArtifact)
	}
	if projectedArtifact.contentSourceKind != ArtifactContentSourceWorkspaceRelative || projectedArtifact.contentSourcePath != "dist/report.md" || projectedArtifact.contentSourceReadable != 1 {
		t.Fatalf("projected artifact content source = %#v, want readable workspace-relative source", projectedArtifact)
	}
	if projectedArtifact.metadataJSON != `{"sizeBytes":128}` {
		t.Fatalf("projected artifact metadata_json = %s, want sizeBytes metadata", projectedArtifact.metadataJSON)
	}

	var projectedDiff struct {
		workspaceID string
		runID       string
		patchPath   string
		status      string
		summaryJSON string
	}
	if err := reopened.db.QueryRow(`SELECT workspace_id, run_id, patch_path, status, summary_json FROM edge_diffs WHERE run_id = ? AND patch_path = ?`, run.ID, diffFile.Path).Scan(
		&projectedDiff.workspaceID,
		&projectedDiff.runID,
		&projectedDiff.patchPath,
		&projectedDiff.status,
		&projectedDiff.summaryJSON,
	); err != nil {
		t.Fatalf("query projected diff returned error: %v", err)
	}
	if projectedDiff.workspaceID != project.ID || projectedDiff.runID != run.ID || projectedDiff.patchPath != diffFile.Path || projectedDiff.status != "modified" {
		t.Fatalf("projected diff = %#v, want scoped modified diff for src/app.ts", projectedDiff)
	}
	if projectedDiff.summaryJSON != `{"path":"src/app.ts","diffBytes":23}` {
		t.Fatalf("projected diff summary_json = %s, want path and diff byte count", projectedDiff.summaryJSON)
	}
	var diffRows int
	if err := reopened.db.QueryRow(`SELECT COUNT(*) FROM edge_diffs WHERE run_id = ?`, run.ID).Scan(&diffRows); err != nil {
		t.Fatalf("query projected diff row count returned error: %v", err)
	}
	if diffRows != 2 {
		t.Fatalf("projected diff rows for run = %d, want 2 after same-path update and second diff", diffRows)
	}
	var projectedSecondDiffPath string
	if err := reopened.db.QueryRow(`SELECT patch_path FROM edge_diffs WHERE run_id = ? AND patch_path = ?`, run.ID, secondDiffFile.Path).Scan(&projectedSecondDiffPath); err != nil {
		t.Fatalf("query projected second diff returned error: %v", err)
	}
	if projectedSecondDiffPath != secondDiffFile.Path {
		t.Fatalf("projected second diff path = %q, want %q", projectedSecondDiffPath, secondDiffFile.Path)
	}

	var projectedPreview struct {
		workspaceID  string
		runID        string
		url          string
		status       string
		metadataJSON string
	}
	if err := reopened.db.QueryRow(`SELECT workspace_id, run_id, url, status, metadata_json FROM edge_previews WHERE preview_id = ?`, preview.ID).Scan(
		&projectedPreview.workspaceID,
		&projectedPreview.runID,
		&projectedPreview.url,
		&projectedPreview.status,
		&projectedPreview.metadataJSON,
	); err != nil {
		t.Fatalf("query projected preview returned error: %v", err)
	}
	if projectedPreview.workspaceID != project.ID || projectedPreview.runID != run.ID || projectedPreview.url != preview.URL || projectedPreview.status != "ready" {
		t.Fatalf("projected preview = %#v, want scoped ready preview", projectedPreview)
	}
	if projectedPreview.metadataJSON != `{}` {
		t.Fatalf("projected preview metadata_json = %s, want empty object", projectedPreview.metadataJSON)
	}
}

func TestSQLiteProjectionDiffIDDoesNotCollideOnColonDelimitedRunAndPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	defer s.Close()

	project, err := s.CreateProject("proj_collision", "Projection Collision")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := s.CreateThread("thread_collision", project.ID, "Projection Collision")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	firstRun, err := s.CreateRun("run:a", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun first returned error: %v", err)
	}
	secondRun, err := s.CreateRun("run", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun second returned error: %v", err)
	}
	if _, err := s.UpsertRunDiffFile(RunDiffFile{
		RunID:  firstRun.ID,
		Path:   "b",
		Diff:   "+first",
		Status: "added",
	}); err != nil {
		t.Fatalf("UpsertRunDiffFile first returned error: %v", err)
	}
	if _, err := s.UpsertRunDiffFile(RunDiffFile{
		RunID:  secondRun.ID,
		Path:   "a:b",
		Diff:   "+second",
		Status: "added",
	}); err != nil {
		t.Fatalf("UpsertRunDiffFile second returned error: %v", err)
	}
	s.Close()

	reopened, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("reopen NewSQLite returned error: %v", err)
	}
	defer reopened.Close()

	var diffRows int
	if err := reopened.db.QueryRow(`SELECT COUNT(*) FROM edge_diffs WHERE run_id IN (?, ?)`, firstRun.ID, secondRun.ID).Scan(&diffRows); err != nil {
		t.Fatalf("query projected diff rows returned error: %v", err)
	}
	if diffRows != 2 {
		t.Fatalf("projected diff rows = %d, want 2 non-colliding rows", diffRows)
	}
}
