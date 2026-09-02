package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/store"
)

// ---------------------------------------------------------------------------
// POST /v1/runs/{runId}/apply — apply a single hunk decision
// ---------------------------------------------------------------------------

// applyRequest is the request body for POST /v1/runs/{runId}/apply.
type applyRequest struct {
	FilePath  string `json:"file_path"`
	HunkIndex int    `json:"hunk_index"`
	Accepted  bool   `json:"accepted"`
	WorkDir   string `json:"workDir"`
}

// applyDecision represents a single hunk accept/reject decision for batch apply.
type applyDecision struct {
	FilePath  string `json:"file_path"`
	HunkIndex int    `json:"hunk_index"`
	Accepted  bool   `json:"accepted"`
}

// applyAllRequest is the request body for POST /v1/runs/{runId}/apply-all.
type applyAllRequest struct {
	Decisions []applyDecision `json:"decisions"`
	WorkDir   string          `json:"workDir"`
}

// PostApplyRunDiff applies a single accepted hunk to the filesystem.
// POST /v1/runs/{runId}/apply
func (h *Handler) PostApplyRunDiff(w http.ResponseWriter, r *http.Request, runID string) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		return
	}

	repository := ensureStore(h)
	// Ownership gate, identical in shape to GetRunDiff (handlers_projects.go):
	// a run that exists but belongs to another Hub user is reported as 404, so
	// this write endpoint is not a runId existence oracle. Without it any
	// Edge-authenticated caller could apply hunks of somebody else's run and
	// receive that run's full diff text back (applySingleHunk embeds it).
	userID := h.ownerUserID(r)
	run, ok := repository.GetRun(runID)
	if !ok || !isRunOwnedBy(repository, runID, userID) {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("run not found")))
		return
	}
	if run.Status != "finished" {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage("can only apply diffs to finished runs")))
		return
	}

	var req applyRequest
	if err := decodeApplyJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidJSON))
		return
	}
	if req.FilePath == "" {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage("file_path is required")))
		return
	}
	if err := h.validateWorkDirAllowed(req.WorkDir); err != nil {
		slog.Error("workdir not allowed", "workDir", req.WorkDir, "error", err)
		writeJSON(w, http.StatusForbidden, errcode.ErrorBody(errcode.ErrWorkspaceNotAllowed))
		return
	}

	result, err := h.applySingleHunk(repository, runID, req)
	if err != nil {
		slog.Error("diff apply failed", "runId", runID, "filePath", req.FilePath, "hunkIndex", req.HunkIndex, "error", err)
		writeJSON(w, http.StatusInternalServerError, errcode.ErrorBody(errcode.ErrInternal))
		return
	}

	writeSuccess(w, http.StatusOK, result)
}

// PostApplyAllRunDiffs applies multiple hunk decisions in one request.
// POST /v1/runs/{runId}/apply-all
func (h *Handler) PostApplyAllRunDiffs(w http.ResponseWriter, r *http.Request, runID string) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		return
	}

	repository := ensureStore(h)
	// Ownership gate, identical in shape to GetRunDiff (handlers_projects.go):
	// a run that exists but belongs to another Hub user is reported as 404, so
	// this write endpoint is not a runId existence oracle. Without it any
	// Edge-authenticated caller could apply hunks of somebody else's run and
	// receive that run's full diff text back (applySingleHunk embeds it).
	userID := h.ownerUserID(r)
	run, ok := repository.GetRun(runID)
	if !ok || !isRunOwnedBy(repository, runID, userID) {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("run not found")))
		return
	}
	if run.Status != "finished" {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage("can only apply diffs to finished runs")))
		return
	}

	var req applyAllRequest
	if err := decodeApplyJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidJSON))
		return
	}
	if len(req.Decisions) == 0 {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage("decisions must not be empty")))
		return
	}
	if err := h.validateWorkDirAllowed(req.WorkDir); err != nil {
		slog.Error("workdir not allowed", "workDir", req.WorkDir, "error", err)
		writeJSON(w, http.StatusForbidden, errcode.ErrorBody(errcode.ErrWorkspaceNotAllowed))
		return
	}

	results := make([]map[string]any, 0, len(req.Decisions))
	for _, decision := range req.Decisions {
		if decision.FilePath == "" {
			writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest.WithMessage("file_path is required for each decision")))
			return
		}
		result, err := h.applySingleHunk(repository, runID, applyRequest{
			FilePath:  decision.FilePath,
			HunkIndex: decision.HunkIndex,
			Accepted:  decision.Accepted,
			WorkDir:   req.WorkDir,
		})
		if err != nil {
			slog.Error("diff batch apply failed", "runId", runID, "filePath", decision.FilePath, "hunkIndex", decision.HunkIndex, "error", err)
			writeJSON(w, http.StatusInternalServerError, errcode.ErrorBody(errcode.ErrInternal))
			return
		}
		results = append(results, result)
	}

	writeSuccess(w, http.StatusOK, map[string]any{
		"runId":   runID,
		"applied": len(results),
		"results": results,
	})
}

// applySingleHunk applies one hunk decision and returns the updated diff state.
func (h *Handler) applySingleHunk(repository store.Repository, runID string, req applyRequest) (map[string]any, error) {
	// Find the diff file for this run and path.
	diffFiles := repository.ListRunDiffFiles(runID)
	var targetDiff *store.RunDiffFile
	for i := range diffFiles {
		if diffFiles[i].Path == req.FilePath {
			targetDiff = &diffFiles[i]
			break
		}
	}
	if targetDiff == nil {
		return nil, fmt.Errorf("diff not found for file %q in run %s", req.FilePath, runID)
	}

	// Parse the unified diff into hunks.
	hunks := parseHunks(targetDiff.Diff)
	if req.HunkIndex < 0 || req.HunkIndex >= len(hunks) {
		return nil, fmt.Errorf("hunk_index %d out of range (0-%d)", req.HunkIndex, len(hunks)-1)
	}

	hunk := hunks[req.HunkIndex]

	if req.Accepted {
		// Apply the hunk patch to the file in the workdir.
		if req.WorkDir == "" {
			return nil, fmt.Errorf("workDir is required to apply diffs to the filesystem")
		}
		if err := h.applyHunkToFile(req.WorkDir, req.FilePath, hunk); err != nil {
			return nil, fmt.Errorf("failed to apply hunk to file: %w", err)
		}
	}

	// Build response with updated diff state.
	allDiffFiles := repository.ListRunDiffFiles(runID)
	return map[string]any{
		"runId":     runID,
		"filePath":  req.FilePath,
		"hunkIndex": req.HunkIndex,
		"accepted":  req.Accepted,
		"applied":   req.Accepted,
		"files":     runDiffFilesResponse(allDiffFiles),
	}, nil
}

// applyHunkToFile applies a single unified diff hunk to a file in the workdir.
func (h *Handler) applyHunkToFile(workDir, filePath string, hunk unifiedHunk) error {
	// Validate the file path does not escape the workdir.
	absWorkDir, err := normalizedRealPath(workDir)
	if err != nil {
		return fmt.Errorf("invalid workDir: %w", err)
	}
	targetPath := filepath.Join(absWorkDir, filepath.FromSlash(filePath))
	targetPath = filepath.Clean(targetPath)

	if !isPathWithin(absWorkDir, targetPath) {
		return fmt.Errorf("file path %q escapes workdir %q", filePath, workDir)
	}

	// Read the original file content.
	originalBytes, err := os.ReadFile(targetPath)
	if err != nil {
		if os.IsNotExist(err) {
			// File does not exist yet — create it with the hunk content.
			return h.createNewFileFromHunk(targetPath, hunk)
		}
		return fmt.Errorf("failed to read file %s: %w", targetPath, err)
	}
	original := string(originalBytes)

	// Create a backup before modifying.
	if err := createBackup(targetPath, originalBytes); err != nil {
		return fmt.Errorf("failed to create backup: %w", err)
	}

	// Apply the hunk to the original content.
	modified := applyHunkToContent(original, hunk)

	// Write the modified content back.
	if err := os.WriteFile(targetPath, []byte(modified), 0); err != nil {
		return fmt.Errorf("failed to write file %s: %w", targetPath, err)
	}

	slog.Info("diff applied", "file", filePath, "workDir", workDir)
	return nil
}

// createNewFileFromHunk creates a new file from added lines in a hunk.
func (h *Handler) createNewFileFromHunk(targetPath string, hunk unifiedHunk) error {
	// Ensure parent directory exists.
	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}

	var buf strings.Builder
	for _, line := range hunk.lines {
		if line.lineType != '+' {
			continue
		}
		buf.WriteString(line.content)
		if !strings.HasSuffix(line.content, "\n") {
			buf.WriteByte('\n')
		}
	}

	if buf.Len() == 0 {
		return fmt.Errorf("hunk has no added lines to create file from")
	}

	if err := os.WriteFile(targetPath, []byte(buf.String()), 0o600); err != nil {
		return fmt.Errorf("failed to create file %s: %w", targetPath, err)
	}

	slog.Info("diff applied (new file created)", "path", targetPath)
	return nil
}

// ---------------------------------------------------------------------------
// Unified diff parsing (lightweight, no external deps)
// ---------------------------------------------------------------------------

// unifiedHunk represents a single hunk from a unified diff.
type unifiedHunk struct {
	oldStart int
	oldLines int
	newStart int
	newLines int
	lines    []diffLine
}

type diffLine struct {
	lineType byte   // ' ', '+', '-'
	content  string // line content without the prefix
}

// parseHunks parses a unified diff string into hunks.
func parseHunks(patch string) []unifiedHunk {
	if patch == "" {
		return nil
	}

	var hunks []unifiedHunk
	var current *unifiedHunk

	lines := strings.Split(patch, "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "@@") {
			if current != nil {
				hunks = append(hunks, *current)
			}
			start, oldCount, newStart, newCount := parseHunkHeader(line)
			current = &unifiedHunk{
				oldStart: start,
				oldLines: oldCount,
				newStart: newStart,
				newLines: newCount,
			}
			continue
		}
		if current == nil {
			continue
		}
		if line == "" {
			continue
		}
		// Skip diff header lines.
		if strings.HasPrefix(line, "diff ") || strings.HasPrefix(line, "index ") ||
			strings.HasPrefix(line, "--- ") || strings.HasPrefix(line, "+++ ") ||
			strings.HasPrefix(line, "\\ ") {
			continue
		}

		prefix := line[0]
		switch prefix {
		case ' ', '+', '-':
			current.lines = append(current.lines, diffLine{
				lineType: prefix,
				content:  line[1:],
			})
		}
	}
	if current != nil {
		hunks = append(hunks, *current)
	}

	return hunks
}

// parseHunkHeader parses a hunk header like "@@ -1,5 +1,7 @@".
func parseHunkHeader(line string) (oldStart, oldLines, newStart, newLines int) {
	// Find the range specs between @@ markers.
	start := strings.Index(line, "@@")
	if start < 0 {
		return 0, 0, 0, 0
	}
	end := strings.LastIndex(line, "@@")
	if end <= start {
		return 0, 0, 0, 0
	}
	body := line[start+2 : end]
	body = strings.TrimSpace(body)

	parts := strings.SplitN(body, " ", 2)
	if len(parts) < 2 {
		return 0, 0, 0, 0
	}

	oldStart, oldLines = parseRangeSpec(parts[0])
	newStart, newLines = parseRangeSpec(parts[1])
	return
}

// parseRangeSpec parses a range spec like "-1,5" into (start=1, count=5).
// Unparseable specs leave the named return values at their zero defaults.
func parseRangeSpec(spec string) (start, count int) {
	spec = strings.TrimSpace(spec)
	if len(spec) == 0 {
		return 0, 0
	}
	spec = spec[1:] // strip leading - or +
	if idx := strings.Index(spec, ","); idx >= 0 {
		_, _ = fmt.Sscanf(spec[:idx], "%d", &start)
		_, _ = fmt.Sscanf(spec[idx+1:], "%d", &count)
	} else {
		_, _ = fmt.Sscanf(spec, "%d", &start)
		count = 1
	}
	return
}

// applyHunkToContent applies a single hunk to the original file content
// and returns the modified content.
func applyHunkToContent(original string, hunk unifiedHunk) string {
	origLines := strings.SplitAfter(original, "\n")
	// Fix: if the last element is empty due to trailing newline split, remove it.
	if len(origLines) > 0 && origLines[len(origLines)-1] == "" {
		origLines = origLines[:len(origLines)-1]
	}

	// Build a map of which original lines to keep and what to insert.
	var result []string
	origIdx := 0

	// First, collect lines before the hunk region (context from oldStart).
	// Lines are 1-indexed in diffs.
	startOffset := hunk.oldStart - 1

	// Copy lines before the hunk starts.
	for origIdx < startOffset && origIdx < len(origLines) {
		result = append(result, origLines[origIdx])
		origIdx++
	}

	// Process the hunk lines.
	for _, line := range hunk.lines {
		switch line.lineType {
		case ' ': // context line
			if origIdx < len(origLines) {
				result = append(result, origLines[origIdx])
				origIdx++
			}
		case '-': // deleted line — skip the original line
			if origIdx < len(origLines) {
				origIdx++
			}
		case '+': // added line — insert new content
			content := line.content
			if !strings.HasSuffix(content, "\n") {
				content += "\n"
			}
			result = append(result, content)
		}
	}

	// Copy remaining lines after the hunk.
	for origIdx < len(origLines) {
		result = append(result, origLines[origIdx])
		origIdx++
	}

	return strings.Join(result, "")
}

// createBackup creates a .bak copy of the file before modification.
func createBackup(targetPath string, content []byte) error {
	backupPath := targetPath + ".bak"
	// Don't overwrite an existing backup.
	if _, err := os.Stat(backupPath); err == nil {
		return nil // backup already exists
	}
	// Backups may contain source code or credentials. Keep them readable by the
	// Edge process for rollback without exposing them to other users. A zero
	// mode is ignored on Windows but creates an unreadable file on Unix.
	// #nosec G703 -- backupPath = targetPath+".bak"; targetPath already passed
	// isPathWithin(absWorkDir, ...) in applyHunkToFile, so it cannot escape workdir.
	return os.WriteFile(backupPath, content, 0o600)
}

// decodeApplyJSON decodes the JSON request body for apply endpoints.
// Unlike decodeOptionalJSON, it allows unknown fields for forward compatibility.
func decodeApplyJSON(r *http.Request, dst any) error {
	if r.Body == nil || r.Body == http.NoBody {
		return fmt.Errorf("request body is required")
	}
	defer r.Body.Close()
	r.Body = io.NopCloser(io.LimitReader(r.Body, 1<<20))
	decoder := json.NewDecoder(r.Body)
	// Allow unknown fields — the apply request may have extra fields from future extensions.
	return decoder.Decode(dst)
}
