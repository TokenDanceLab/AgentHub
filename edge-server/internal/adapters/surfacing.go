// Package adapters — auto-surface detection for agent run outputs.
//
// When an agent run completes, the Surfacer scans the workdir for new or
// modified files and emits typed events (surfaced artifact, preview, diff,
// deploy) so the frontend can render them inline in the chat transcript.
//
// Residual pure helpers live in surfacing_*.go companions (peel #1112).
package adapters

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

// Surfaced event types — emitted after run completion for auto-detected outputs.
const (
	BusEventSurfacedArtifact = "run.agent.surfaced_artifact"
	BusEventSurfacedPreview  = "run.agent.surfaced_preview"
	BusEventSurfacedDiff     = "run.agent.surfaced_diff"
	BusEventSurfacedDeploy   = "run.agent.surfaced_deploy"
)

// Size limits for surfacing.
const (
	maxSurfacedFileBytes    = 256 * 1024 // 256 KB cap per surfaced file content
	maxSnapshotFileBytes    = 128 * 1024 // 128 KB max per file content stored in snapshot
	maxSnapshotTotalFiles   = 500
	maxSurfacedArtifactSize = 512 * 1024 // 512 KB max artifact content emitted
	maxWalkFiles            = 2000       // max files to scan per walk (prevents memory blowup on large repos)
	maxWalkDepth            = 24         // max directory depth to descend
)

// ── Workdir snapshot ────────────────────────────────────────────────────

// fileRecord captures pre-run file state for change detection.
type fileRecord struct {
	Size    int64
	ModTime time.Time
	Hash    string // SHA-256 hex digest
	Content string // pre-run content (text files, capped at maxSnapshotFileBytes)
}

// WorkdirSnapshot holds the pre-run file state for a workdir.
type WorkdirSnapshot struct {
	Dir   string
	Files map[string]fileRecord // relative path → record
}

// CheckpointFiles projects the pre-run snapshot into store checkpoint
// records (#1968), sorted by path for deterministic timelines. Returns the
// file list and the summed pre-run byte size.
func (s *WorkdirSnapshot) CheckpointFiles() ([]store.CheckpointFile, int64) {
	if s == nil {
		return nil, 0
	}
	files := make([]store.CheckpointFile, 0, len(s.Files))
	var totalBytes int64
	for path, rec := range s.Files {
		totalBytes += rec.Size
		files = append(files, store.CheckpointFile{
			Path:    path,
			Size:    rec.Size,
			Hash:    rec.Hash,
			Content: rec.Content,
		})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return files, totalBytes
}

// TakeWorkdirSnapshot walks the workdir and captures file state.
// Returns nil if workDir is empty or not accessible.
func TakeWorkdirSnapshot(workDir string) *WorkdirSnapshot {
	if workDir == "" {
		return nil
	}
	info, err := os.Stat(workDir)
	if err != nil || !info.IsDir() {
		return nil
	}

	s := &WorkdirSnapshot{
		Dir:   workDir,
		Files: make(map[string]fileRecord),
	}

	_ = filepath.WalkDir(workDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// Skip inaccessible entries; do not abort the walk.
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if skipDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if len(s.Files) >= maxSnapshotTotalFiles {
			return filepath.SkipAll
		}
		captureSnapshotEntry(s, workDir, path, d)
		return nil
	})

	return s
}

// captureSnapshotEntry records a single file's state (hash + content) into
// the snapshot. Errors are non-fatal: the entry is skipped and the walk
// continues, matching the "best-effort snapshot" contract of
// TakeWorkdirSnapshot.
func captureSnapshotEntry(s *WorkdirSnapshot, workDir, path string, d fs.DirEntry) {
	fi, err := d.Info()
	if err != nil {
		return
	}

	relPath, err := filepath.Rel(workDir, path)
	if err != nil || relPath == "" || relPath == "." {
		return
	}
	relPath = filepath.ToSlash(relPath)

	// Skip binary artifacts (executables, DBs, archives, backups).
	if isBinaryArtifact(relPath) {
		return
	}

	rec := fileRecord{
		Size:    fi.Size(),
		ModTime: fi.ModTime(),
	}

	// #nosec G304 -- path comes from walking the user's own run workdir
	f, err := os.Open(path)
	if err != nil {
		return
	}
	h := sha256.New()
	_, _ = io.Copy(h, io.LimitReader(f, maxSnapshotFileBytes))
	_ = f.Close()
	rec.Hash = hex.EncodeToString(h.Sum(nil))

	// Store content for text files (enables diff generation).
	if isTextFilePath(relPath) && fi.Size() <= maxSnapshotFileBytes {
		// #nosec G304 -- path comes from walking the user's own run workdir
		data, err := os.ReadFile(path)
		if err == nil {
			rec.Content = string(data)
		}
	}

	s.Files[relPath] = rec
}

// ── Surface detection ───────────────────────────────────────────────────

// SurfacedFile describes a single auto-detected file output.
type SurfacedFile struct {
	RelPath string
	AbsPath string
	Action  string // "created" or "modified"
	Kind    surfacingKind
	Size    int64
	Content string // current content (text files, capped)
	OldHash string // empty for new files
	NewHash string
	ModTime time.Time
}

// DetectSurfacedFiles scans the workdir and returns files that were created
// or modified since the snapshot was taken.
func DetectSurfacedFiles(snapshot *WorkdirSnapshot) []SurfacedFile {
	if snapshot == nil {
		return nil
	}

	after := walkCurrentState(snapshot.Dir)
	var results []SurfacedFile

	for relPath, afterRec := range after {
		before, existed := snapshot.Files[relPath]

		var action string
		switch {
		case !existed:
			action = "created"
		case before.Hash != afterRec.Hash:
			action = "modified"
		default:
			continue // unchanged
		}

		results = append(results, SurfacedFile{
			RelPath: relPath,
			AbsPath: filepath.Join(snapshot.Dir, filepath.FromSlash(relPath)),
			Action:  action,
			Kind:    classifySurfacedFile(relPath),
			Size:    afterRec.Size,
			Content: afterRec.Content,
			OldHash: before.Hash,
			NewHash: afterRec.Hash,
			ModTime: afterRec.ModTime,
		})
	}

	// Sort by path for deterministic output.
	sort.Slice(results, func(i, j int) bool {
		return results[i].RelPath < results[j].RelPath
	})

	return results
}

// ── Event emission ──────────────────────────────────────────────────────

// SurfaceAndEmit detects file changes and emits surfaced events through the
// bus and persists artifacts/previews to the store. It is called from the
// ProcessExecutor's finish() after a successful run.
func SurfaceAndEmit(bus *events.Bus, writer store.Writer, snapshot *WorkdirSnapshot, run store.Run) {
	if snapshot == nil || bus == nil {
		return
	}

	surfaced := DetectSurfacedFiles(snapshot)
	if len(surfaced) == 0 {
		return
	}

	slog.Debug("surfacing: auto-detected file outputs",
		"runId", run.ID,
		"count", len(surfaced),
		"workDir", snapshot.Dir,
	)

	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}

	for _, sf := range surfaced {
		switch sf.Kind {
		case surfacingKindPreview:
			emitSurfacedPreview(bus, writer, scope, run, sf, snapshot)
		case surfacingKindImage:
			emitSurfacedImage(bus, writer, scope, run, sf)
		case surfacingKindDeploy:
			emitSurfacedDeploy(bus, writer, scope, run, sf, snapshot)
		case surfacingKindArtifact:
			emitSurfacedArtifact(bus, writer, scope, run, sf, snapshot)
		}
		// Observability (slice A step 6): log + counter per surfaced artifact.
		slog.Info("surfacing: artifact surfaced",
			"run_id", run.ID, "artifact_kind", string(sf.Kind), "path", sf.RelPath)
		if artifactSurfacedRecorder != nil {
			artifactSurfacedRecorder.RecordArtifactSurfaced(string(sf.Kind))
		}
	}
}
