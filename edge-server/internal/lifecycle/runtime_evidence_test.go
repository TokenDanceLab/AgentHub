package lifecycle

import (
	"testing"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

func TestRuntimeEvidenceEmitterPersistsArtifactDiffPreviewEvidence(t *testing.T) {
	s := store.New()
	run := newExecutorTestRun(t, s)
	inner := &recordingLifecycleEmitter{}
	emitter := newRuntimeEvidenceEmitter(s, run, inner)
	if emitter == nil {
		t.Fatal("newRuntimeEvidenceEmitter returned nil")
	}

	emitter.Emit(adapters.BusEventFileChange, nil, map[string]any{
		"path":   "src/app.ts",
		"kind":   "modified",
		"status": "completed",
		"diff":   "@@ -1 +1 @@\n-old\n+new",
	})
	emitter.Emit("artifact.created", nil, map[string]any{
		"id":        "artifact_1",
		"kind":      "file",
		"path":      "dist/report.md",
		"sizeBytes": int64(128),
	})
	emitter.Emit("preview.ready", nil, map[string]any{
		"id":     "preview_1",
		"url":    "http://127.0.0.1:4173",
		"status": "ready",
	})
	emitter.Emit("preview.stopped", nil, map[string]any{
		"id": "preview_1",
	})

	diffFiles := s.ListRunDiffFiles(run.ID)
	if len(diffFiles) != 1 || diffFiles[0].Path != "src/app.ts" || diffFiles[0].Diff == "" || diffFiles[0].Status != "modified" {
		t.Fatalf("ListRunDiffFiles = %#v, want persisted runtime diff evidence", diffFiles)
	}
	artifacts := s.ListArtifacts(run.ID)
	if len(artifacts) != 1 || artifacts[0].ID != "artifact_1" || artifacts[0].ThreadID != run.ThreadID || artifacts[0].SizeBytes != 128 {
		t.Fatalf("ListArtifacts = %#v, want persisted runtime artifact evidence", artifacts)
	}
	if artifacts[0].ContentSource == nil || artifacts[0].ContentSource.Kind != store.ArtifactContentSourceWorkspaceRelative || artifacts[0].ContentSource.Path != "dist/report.md" || !artifacts[0].ContentSource.Readable {
		t.Fatalf("artifact content source = %#v, want safe workspace-relative source", artifacts[0].ContentSource)
	}
	previews := s.ListPreviews(run.ID)
	if len(previews) != 1 || previews[0].ID != "preview_1" || previews[0].URL != "" || previews[0].Status != "stopped" {
		t.Fatalf("ListPreviews = %#v, want persisted runtime preview evidence", previews)
	}
	if len(inner.events) != 4 {
		t.Fatalf("inner events = %#v, want all runtime evidence events passed through", inner.events)
	}
}
