package lifecycle

import (
	"errors"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

func TestFakePreviewRunnerStartReadyStopContract(t *testing.T) {
	repository := store.New()
	project, _ := repository.CreateProject("proj_preview", "Preview Project")
	thread, _ := repository.CreateThread("thread_preview", project.ID, "Preview Thread")
	run, err := repository.CreateRun("run_preview", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	runner := NewFakePreviewRunner(repository)

	preview, err := runner.StartPreview(PreviewStartRequest{
		PreviewID: "preview_fake",
		RunID:     run.ID,
	})
	if err != nil {
		t.Fatalf("StartPreview returned error: %v", err)
	}
	if preview.ID != "preview_fake" || preview.RunID != run.ID || preview.ThreadID != thread.ID || preview.Status != "starting" || preview.URL != "" {
		t.Fatalf("starting preview = %#v, want starting metadata without url", preview)
	}

	ready, err := runner.MarkReady("preview_fake", "http://127.0.0.1:4173")
	if err != nil {
		t.Fatalf("MarkReady returned error: %v", err)
	}
	if ready.Status != "ready" || ready.URL != "http://127.0.0.1:4173" || ready.CreatedAt != preview.CreatedAt || ready.UpdatedAt == "" {
		t.Fatalf("ready preview = %#v, want ready metadata with preserved createdAt", ready)
	}

	stopped, err := runner.StopPreview("preview_fake")
	if err != nil {
		t.Fatalf("StopPreview returned error: %v", err)
	}
	if stopped.Status != "stopped" || stopped.URL != "" || stopped.CreatedAt != preview.CreatedAt || stopped.UpdatedAt == "" {
		t.Fatalf("stopped preview = %#v, want stopped metadata with no url", stopped)
	}
}

func TestFakePreviewRunnerReturnsNotFoundForMissingRunOrPreview(t *testing.T) {
	repository := store.New()
	runner := NewFakePreviewRunner(repository)

	if _, err := runner.StartPreview(PreviewStartRequest{PreviewID: "preview_missing_run", RunID: "run_missing"}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("StartPreview missing run error = %v, want ErrNotFound", err)
	}
	if _, err := runner.MarkReady("preview_missing", "http://127.0.0.1:4173"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("MarkReady missing preview error = %v, want ErrNotFound", err)
	}
	if _, err := runner.StopPreview("preview_missing"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("StopPreview missing preview error = %v, want ErrNotFound", err)
	}
}
