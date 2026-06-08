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
}
