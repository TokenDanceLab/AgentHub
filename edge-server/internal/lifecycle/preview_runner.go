package lifecycle

import (
	"strings"

	"github.com/agenthub/edge-server/internal/store"
)

type PreviewStartRequest struct {
	PreviewID string
	RunID     string
	ThreadID  string
}

type PreviewRunner interface {
	StartPreview(req PreviewStartRequest) (store.Preview, error)
	StopPreview(previewID string) (store.Preview, error)
}

type FakePreviewRunner struct {
	store store.Repository
}

func NewFakePreviewRunner(repository store.Repository) *FakePreviewRunner {
	return &FakePreviewRunner{store: repository}
}

func (r *FakePreviewRunner) StartPreview(req PreviewStartRequest) (store.Preview, error) {
	return r.store.UpsertPreview(store.Preview{
		ID:       strings.TrimSpace(req.PreviewID),
		RunID:    strings.TrimSpace(req.RunID),
		ThreadID: strings.TrimSpace(req.ThreadID),
		Status:   "starting",
	})
}

func (r *FakePreviewRunner) MarkReady(previewID, url string) (store.Preview, error) {
	preview, ok := r.store.GetPreview(strings.TrimSpace(previewID))
	if !ok {
		return store.Preview{}, store.ErrNotFound
	}
	preview.Status = "ready"
	preview.URL = strings.TrimSpace(url)
	return r.store.UpsertPreview(preview)
}

func (r *FakePreviewRunner) StopPreview(previewID string) (store.Preview, error) {
	preview, ok := r.store.GetPreview(strings.TrimSpace(previewID))
	if !ok {
		return store.Preview{}, store.ErrNotFound
	}
	preview.Status = "stopped"
	preview.URL = ""
	return r.store.UpsertPreview(preview)
}
