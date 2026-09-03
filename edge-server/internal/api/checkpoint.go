package api

import (
	"net/http"

	"github.com/agenthub/edge-server/internal/errcode"
)

// ---------------------------------------------------------------------------
// GET /v1/runs/{runId}/checkpoint — pre-run checkpoint metadata (#1968)
// ---------------------------------------------------------------------------

// GetRunCheckpoint returns the run's pre-run checkpoint metadata and file
// inventory (without file contents). Read-only evidence surface; restore/
// write-back is intentionally not exposed (see docs/architecture/
// 02-edge-server.md restore semantics).
func (h *Handler) GetRunCheckpoint(w http.ResponseWriter, r *http.Request, runID string) {
	if r.Method != http.MethodGet {
		errcode.Write(w, errcode.ErrMethodNotAllowed)
		return
	}
	repository := ensureStore(h)
	userID := h.ownerUserID(r)
	if _, ok := repository.GetRun(runID); !ok || !isRunOwnedBy(repository, runID, userID) {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("run not found"))
		return
	}
	cp, ok := repository.GetRunCheckpoint(runID)
	if !ok {
		// Honest absence: runs without a resolved workdir have no checkpoint.
		errcode.Write(w, errcode.ErrNotFound.WithMessage("run has no checkpoint"))
		return
	}
	files := make([]map[string]any, 0, len(cp.Files))
	for _, f := range cp.Files {
		files = append(files, map[string]any{
			"path":      f.Path,
			"sizeBytes": f.Size,
			"hash":      f.Hash,
			"hasText":   f.Content != "",
		})
	}
	writeSuccess(w, http.StatusOK, map[string]any{
		"runId":        runID,
		"checkpointId": cp.ID,
		"workDir":      cp.WorkDir,
		"fileCount":    cp.FileCount,
		"totalBytes":   cp.TotalBytes,
		"createdAt":    cp.CreatedAt,
		"files":        files,
	})
}

// ---------------------------------------------------------------------------
// GET /v1/runs/{runId}/checkpoint/file?path=... — single file preview (#1968)
// ---------------------------------------------------------------------------

// GetRunCheckpointFile returns the pre-run content of one checkpoint file.
// The path must exactly match a file recorded in the checkpoint — no path
// resolution, traversal, or filesystem access happens here.
func (h *Handler) GetRunCheckpointFile(w http.ResponseWriter, r *http.Request, runID string) {
	if r.Method != http.MethodGet {
		errcode.Write(w, errcode.ErrMethodNotAllowed)
		return
	}
	repository := ensureStore(h)
	userID := h.ownerUserID(r)
	if _, ok := repository.GetRun(runID); !ok || !isRunOwnedBy(repository, runID, userID) {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("run not found"))
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		errcode.Write(w, errcode.ErrBadRequest.WithMessage("path is required"))
		return
	}
	cp, ok := repository.GetRunCheckpoint(runID)
	if !ok {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("run has no checkpoint"))
		return
	}
	for _, f := range cp.Files {
		if f.Path == path {
			writeSuccess(w, http.StatusOK, map[string]any{
				"runId":     runID,
				"path":      f.Path,
				"sizeBytes": f.Size,
				"hash":      f.Hash,
				"content":   f.Content,
			})
			return
		}
	}
	errcode.Write(w, errcode.ErrNotFound.WithMessage("path not in checkpoint"))
}
