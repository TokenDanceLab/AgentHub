package api

import (
	"net/http"
	"strings"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/store"
)

// Handler holds dependencies for HTTP and WebSocket handlers.
func (h *Handler) GetArtifacts(w http.ResponseWriter, r *http.Request) {
	runID := strings.TrimSpace(r.URL.Query().Get("runId"))
	repo := ensureStore(h)
	userID := h.ownerUserID(r)
	// When a specific run is requested under Hub JWT, fail closed if not owned.
	if runID != "" && !isRunOwnedBy(repo, runID, userID) {
		writeSuccess(w, http.StatusOK, listResponse([]store.Artifact{}))
		return
	}
	writeSuccess(w, http.StatusOK, listResponse(filterArtifactsByOwner(repo.ListArtifacts(runID), repo, userID)))
}

func (h *Handler) GetArtifact(w http.ResponseWriter, r *http.Request, artifactID string) {
	artifactID = strings.TrimSpace(artifactID)
	if artifactID == "" || strings.Contains(artifactID, "/") {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("artifact not found"))
		return
	}
	repo := ensureStore(h)
	userID := h.ownerUserID(r)
	if artifact, ok := repo.GetArtifact(artifactID); ok {
		if !isArtifactOwnedBy(repo, artifact.ID, userID) {
			errcode.Write(w, errcode.ErrNotFound.WithMessage("artifact not found"))
			return
		}
		writeSuccess(w, http.StatusOK, artifact)
		return
	}
	errcode.Write(w, errcode.ErrNotFound.WithMessage("artifact not found"))
}

func (h *Handler) GetPreviews(w http.ResponseWriter, r *http.Request) {
	runID := strings.TrimSpace(r.URL.Query().Get("runId"))
	repo := ensureStore(h)
	userID := h.ownerUserID(r)
	if runID != "" && !isRunOwnedBy(repo, runID, userID) {
		writeSuccess(w, http.StatusOK, listResponse([]store.Preview{}))
		return
	}
	writeSuccess(w, http.StatusOK, listResponse(filterPreviewsByOwner(repo.ListPreviews(runID), repo, userID)))
}

func (h *Handler) PostPreview(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PreviewID string `json:"previewId"`
		RunID     string `json:"runId"`
		ThreadID  string `json:"threadId"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		errcode.Write(w, errcode.ErrInvalidJSON)
		return
	}
	req.RunID = strings.TrimSpace(req.RunID)
	if req.RunID == "" {
		errcode.Write(w, errcode.ErrBadRequest.WithMessage("runId is required"))
		return
	}
	if strings.TrimSpace(req.PreviewID) == "" {
		req.PreviewID = genID("preview_")
	}

	repository := ensureStore(h)
	// Ownership gate (multi-user Hub JWT mode): starting a preview record for
	// a foreign run must fail closed; 404 keeps run existence unobservable.
	if !isRunOwnedBy(repository, req.RunID, h.ownerUserID(r)) {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("run not found"))
		return
	}
	preview, err := ensurePreviewRunner(h, repository).StartPreview(lifecycle.PreviewStartRequest{
		PreviewID: req.PreviewID,
		RunID:     req.RunID,
		ThreadID:  req.ThreadID,
	})
	if err != nil {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("run not found"))
		return
	}
	writeSuccess(w, http.StatusAccepted, preview)
}

func (h *Handler) GetPreview(w http.ResponseWriter, r *http.Request, previewID string) {
	previewID = strings.TrimSpace(previewID)
	if previewID == "" || strings.Contains(previewID, "/") {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("preview not found"))
		return
	}
	repo := ensureStore(h)
	userID := h.ownerUserID(r)
	if preview, ok := repo.GetPreview(previewID); ok {
		if !isPreviewOwnedBy(repo, preview.ID, userID) {
			errcode.Write(w, errcode.ErrNotFound.WithMessage("preview not found"))
			return
		}
		writeSuccess(w, http.StatusOK, preview)
		return
	}
	errcode.Write(w, errcode.ErrNotFound.WithMessage("preview not found"))
}

func (h *Handler) PostPreviewStop(w http.ResponseWriter, r *http.Request, previewID string) {
	previewID = strings.TrimSpace(previewID)
	if previewID == "" || strings.Contains(previewID, "/") {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("preview not found"))
		return
	}
	repository := ensureStore(h)
	preview, ok := repository.GetPreview(previewID)
	if !ok {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("preview not found"))
		return
	}
	// Ownership gate mirrors GetPreview: a foreign preview must not be
	// stoppable under multi-user mode.
	if !isPreviewOwnedBy(repository, preview.ID, h.ownerUserID(r)) {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("preview not found"))
		return
	}
	stopped, err := ensurePreviewRunner(h, repository).StopPreview(preview.ID)
	if err != nil {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("preview not found"))
		return
	}
	writeSuccess(w, http.StatusAccepted, stopped)
}

func runDiffFilesResponse(files []store.RunDiffFile) []map[string]any {
	out := make([]map[string]any, 0, len(files))
	for _, file := range files {
		out = append(out, map[string]any{
			"path":   file.Path,
			"diff":   file.Diff,
			"status": file.Status,
		})
	}
	return out
}

// ---------------------------------------------------------------------------
// GET /v1/agents
// ---------------------------------------------------------------------------
