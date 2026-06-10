// Package adapters — auto-surface detection for agent run outputs.
//
// When an agent run completes, the Surfacer scans the workdir for new or
// modified files and emits typed events (surfaced artifact, preview, diff,
// deploy) so the frontend can render them inline in the chat transcript.
package adapters

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
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
)

// Directories to skip when walking the workdir.
var skipDirs = map[string]bool{
	".git": true, "node_modules": true, "__pycache__": true,
	".venv": true, "venv": true, ".next": true, "dist": true,
	"build": true, "target": true, ".idea": true, ".vscode": true,
	".cache": true, ".tox": true, "vendor": true,
	".fingerprint": true, ".cargo": true,
}

// ── File type classification ─────────────────────────────────────────────

type surfacingKind string

const (
	surfacingKindPreview  surfacingKind = "preview"
	surfacingKindArtifact surfacingKind = "artifact"
	surfacingKindImage    surfacingKind = "image"
	surfacingKindDeploy   surfacingKind = "deploy"
)

func classifySurfacedFile(relPath string) surfacingKind {
	ext := strings.ToLower(filepath.Ext(relPath))
	switch ext {
	case ".html", ".htm":
		return surfacingKindPreview
	case ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico", ".avif":
		return surfacingKindImage
	case ".dockerfile":
		return surfacingKindDeploy
	}

	// Detect deployable patterns by filename.
	base := strings.ToLower(filepath.Base(relPath))
	switch base {
	case "dockerfile", "docker-compose.yml", "docker-compose.yaml",
		"vercel.json", "netlify.toml", "fly.toml", "railway.json",
		"render.yaml", "heroku.yml", "docker-compose.override.yml":
		return surfacingKindDeploy
	}

	// Everything else is an artifact.
	return surfacingKindArtifact
}

func isTextFilePath(relPath string) bool {
	ext := strings.ToLower(filepath.Ext(relPath))
	switch ext {
	case ".md", ".txt", ".py", ".go", ".ts", ".js", ".tsx", ".jsx",
		".json", ".yaml", ".yml", ".toml", ".css", ".scss", ".less",
		".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".rb", ".php",
		".swift", ".kt", ".vue", ".svelte", ".astro", ".sql",
		".xml", ".html", ".htm", ".svg", ".r", ".sh", ".bash",
		".zsh", ".fish", ".ps1", ".bat", ".ini", ".cfg", ".conf",
		".env", ".properties", ".gradle", ".mod", ".sum",
		".dockerfile", ".gitignore", ".editorconfig", ".lock",
		".proto", ".graphql", ".tf", ".hcl", ".dart", ".lua",
		".zig", ".nim", ".ex", ".exs", ".erl", ".hs", ".ml",
		".clj", ".lisp", ".el", ".vim", ".tmux", ".makefile":
		return true
	}
	base := strings.ToLower(filepath.Base(relPath))
	switch base {
	case "makefile", "dockerfile", "vagrantfile", "gemfile",
		"rakefile", "procfile", "jenkinsfile", "brewfile",
		".gitignore", ".env", ".editorconfig":
		return true
	}
	return false
}

// isBinaryArtifact returns true for file types that should NOT be surfaced
// as agent output artifacts. These are typically compiled binaries, object
// files, database files, and other non-human-readable artifacts that the
// agent did not intentionally produce as deliverables.
func isBinaryArtifact(relPath string) bool {
	ext := strings.ToLower(filepath.Ext(relPath))
	switch ext {
	// Compiled executables and object code
	case ".exe", ".dll", ".so", ".dylib", ".o", ".obj", ".a", ".lib",
		".bin", ".out",
		// Rust build artifacts
		".pdb", ".rlib", ".rmeta", ".d", ".pdb.gz",
		// Go build artifacts
		".test":
		return true
	// Database files
	case ".db", ".sqlite", ".sqlite3", ".mdb":
		return true
	// Archive and compressed files (usually build artifacts)
	case ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".zst":
		return true
	// Disk images and firmware
	case ".img", ".iso", ".dmg":
		return true
	}

	// Backup files (e.g. agenthub-edge.exe~, file.bak)
	base := filepath.Base(relPath)
	if strings.HasSuffix(base, "~") || strings.HasSuffix(base, ".bak") {
		return true
	}

	// WAL/SHM companion database files
	if strings.HasSuffix(base, "-wal") || strings.HasSuffix(base, "-shm") ||
		strings.HasSuffix(base, "-journal") {
		return true
	}

	return false
}

// ── Workdir snapshot ────────────────────────────────────────────────────

// fileRecord captures pre-run file state for change detection.
type fileRecord struct {
	Size    int64
	ModTime time.Time
	Hash    string // MD5 hex digest
	Content string // pre-run content (text files, capped at maxSnapshotFileBytes)
}

// WorkdirSnapshot holds the pre-run file state for a workdir.
type WorkdirSnapshot struct {
	Dir   string
	Files map[string]fileRecord // relative path → record
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
			return nil // skip inaccessible entries
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

		fi, err := d.Info()
		if err != nil {
			return nil
		}

		relPath, err := filepath.Rel(workDir, path)
		if err != nil || relPath == "" || relPath == "." {
			return nil
		}
		relPath = filepath.ToSlash(relPath)

		// Skip binary artifacts (executables, DBs, archives, backups).
		if isBinaryArtifact(relPath) {
			return nil
		}

		rec := fileRecord{
			Size:    fi.Size(),
			ModTime: fi.ModTime(),
		}

		// Compute MD5 hash.
		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		h := md5.New()
		_, _ = io.Copy(h, io.LimitReader(f, maxSnapshotFileBytes))
		f.Close()
		rec.Hash = hex.EncodeToString(h.Sum(nil))

		// Store content for text files (enables diff generation).
		if isTextFilePath(relPath) && fi.Size() <= maxSnapshotFileBytes {
			data, err := os.ReadFile(path)
			if err == nil {
				rec.Content = string(data)
			}
		}

		s.Files[relPath] = rec
		return nil
	})

	return s
}

// ── Surface detection ───────────────────────────────────────────────────

// SurfacedFile describes a single auto-detected file output.
type SurfacedFile struct {
	RelPath  string
	AbsPath  string
	Action   string // "created" or "modified"
	Kind     surfacingKind
	Size     int64
	Content  string // current content (text files, capped)
	OldHash  string // empty for new files
	NewHash  string
	ModTime  time.Time
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
		if !existed {
			action = "created"
		} else if before.Hash != afterRec.Hash {
			action = "modified"
		} else {
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

func walkCurrentState(dir string) map[string]fileRecord {
	result := make(map[string]fileRecord)
	_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if skipDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}

		fi, err := d.Info()
		if err != nil {
			return nil
		}

		relPath, err := filepath.Rel(dir, path)
		if err != nil || relPath == "" || relPath == "." {
			return nil
		}
		relPath = filepath.ToSlash(relPath)

		// Skip binary artifacts (executables, DBs, archives, backups).
		if isBinaryArtifact(relPath) {
			return nil
		}

		rec := fileRecord{
			Size:    fi.Size(),
			ModTime: fi.ModTime(),
		}

		// Compute hash.
		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		h := md5.New()
		_, _ = io.Copy(h, io.LimitReader(f, maxSurfacedFileBytes))
		f.Close()
		rec.Hash = hex.EncodeToString(h.Sum(nil))

		// Read content for text files.
		if isTextFilePath(relPath) && fi.Size() <= maxSurfacedFileBytes {
			data, err := os.ReadFile(path)
			if err == nil {
				rec.Content = string(data)
			}
		}

		result[relPath] = rec
		return nil
	})
	return result
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
		default:
			emitSurfacedArtifact(bus, writer, scope, run, sf, snapshot)
		}
	}
}

func emitSurfacedPreview(bus *events.Bus, writer store.Writer, scope map[string]any, run store.Run, sf SurfacedFile, snapshot *WorkdirSnapshot) {
	artifactID := surfacedArtifactID(run.ID, sf.RelPath)

	// Build preview URL — localhost-relative for Edge-served previews.
	previewURL := fmt.Sprintf("/api/runs/%s/artifacts/%s/preview", run.ID, artifactID)

	// Emit surfaced preview event (flows Edge → Hub WS → transcript).
	bus.Publish(BusEventSurfacedPreview, scope, map[string]any{
		"runId":       run.ID,
		"artifactId":  artifactID,
		"path":        sf.RelPath,
		"previewUrl":  previewURL,
		"previewType": "html",
		"action":      sf.Action,
		"sizeBytes":   sf.Size,
	})

	// Persist preview in store.
	previewID := "preview_" + artifactID
	if _, err := writer.UpsertPreview(store.Preview{
		ID:       previewID,
		RunID:    run.ID,
		ThreadID: run.ThreadID,
		URL:      previewURL,
		Status:   "ready",
	}); err != nil {
		slog.Warn("surfacing: failed to persist preview", "runId", run.ID, "path", sf.RelPath, "err", err)
	}

	// Also persist as artifact.
	persistSurfacedArtifact(writer, run, sf, artifactID, "preview")
}

func emitSurfacedImage(bus *events.Bus, writer store.Writer, scope map[string]any, run store.Run, sf SurfacedFile) {
	artifactID := surfacedArtifactID(run.ID, sf.RelPath)

	bus.Publish(BusEventSurfacedArtifact, scope, map[string]any{
		"runId":      run.ID,
		"artifactId": artifactID,
		"kind":       "image",
		"path":       sf.RelPath,
		"action":     sf.Action,
		"sizeBytes":  sf.Size,
		"mimeType":   mimeTypeFromExt(sf.RelPath),
	})

	persistSurfacedArtifact(writer, run, sf, artifactID, "image")
}

func emitSurfacedDeploy(bus *events.Bus, writer store.Writer, scope map[string]any, run store.Run, sf SurfacedFile, snapshot *WorkdirSnapshot) {
	artifactID := surfacedArtifactID(run.ID, sf.RelPath)

	deployType := classifyDeployType(sf.RelPath)
	previewURL := fmt.Sprintf("/api/runs/%s/artifacts/%s/deploy", run.ID, artifactID)

	bus.Publish(BusEventSurfacedDeploy, scope, map[string]any{
		"runId":      run.ID,
		"artifactId": artifactID,
		"path":       sf.RelPath,
		"previewUrl": previewURL,
		"deployType": deployType,
		"status":     "ready",
		"action":     sf.Action,
		"sizeBytes":  sf.Size,
	})

	persistSurfacedArtifact(writer, run, sf, artifactID, "deploy")

	// Also emit a diff for the deploy file if it was modified.
	if sf.Action == "modified" {
		emitSurfacedDiff(bus, writer, scope, run, sf, snapshot)
	}
}

func emitSurfacedArtifact(bus *events.Bus, writer store.Writer, scope map[string]any, run store.Run, sf SurfacedFile, snapshot *WorkdirSnapshot) {
	artifactID := surfacedArtifactID(run.ID, sf.RelPath)

	// Read content if not already available (for text files).
	content := sf.Content
	if content == "" && isTextFilePath(sf.RelPath) && sf.Size <= maxSurfacedArtifactSize {
		data, err := os.ReadFile(sf.AbsPath)
		if err == nil {
			content = string(data)
		}
	}

	// Truncate content if too large.
	if len(content) > maxSurfacedArtifactSize {
		content = content[:maxSurfacedArtifactSize] + "\n[content truncated]"
	}

	bus.Publish(BusEventSurfacedArtifact, scope, map[string]any{
		"runId":      run.ID,
		"artifactId": artifactID,
		"kind":       "file",
		"path":       sf.RelPath,
		"action":     sf.Action,
		"content":    content,
		"sizeBytes":  sf.Size,
		"language":   languageFromExt(sf.RelPath),
	})

	persistSurfacedArtifact(writer, run, sf, artifactID, "file")

	// For modified text files, emit a diff event.
	if sf.Action == "modified" && isTextFilePath(sf.RelPath) {
		emitSurfacedDiff(bus, writer, scope, run, sf, snapshot)
	}
}

func emitSurfacedDiff(bus *events.Bus, writer store.Writer, scope map[string]any, run store.Run, sf SurfacedFile, snapshot *WorkdirSnapshot) {
	before, existed := snapshot.Files[sf.RelPath]
	if !existed || before.Content == "" {
		return
	}

	// Generate unified diff.
	oldContent := before.Content
	newContent := sf.Content
	if newContent == "" {
		data, err := os.ReadFile(sf.AbsPath)
		if err != nil {
			return
		}
		newContent = string(data)
	}

	diff := generateUnifiedDiff(sf.RelPath, oldContent, newContent)
	if diff == "" {
		return // no actual content change
	}

	bus.Publish(BusEventSurfacedDiff, scope, map[string]any{
		"runId":     run.ID,
		"path":      sf.RelPath,
		"action":    "modified",
		"diff":      diff,
		"oldHash":   sf.OldHash,
		"newHash":   sf.NewHash,
		"addedLines": countDiffLines(diff, '+'),
		"removedLines": countDiffLines(diff, '-'),
	})

	// Persist diff in store.
	if _, err := writer.UpsertRunDiffFile(store.RunDiffFile{
		RunID:  run.ID,
		Path:   sf.RelPath,
		Diff:   diff,
		Status: "modified",
	}); err != nil {
		slog.Warn("surfacing: failed to persist surfaced diff", "runId", run.ID, "path", sf.RelPath, "err", err)
	}
}

func persistSurfacedArtifact(writer store.Writer, run store.Run, sf SurfacedFile, artifactID, kind string) {
	_, err := writer.UpsertArtifact(store.Artifact{
		ID:            artifactID,
		RunID:         run.ID,
		ThreadID:      run.ThreadID,
		Kind:          kind,
		Path:          sf.RelPath,
		SizeBytes:     sf.Size,
		ContentSource: store.NewArtifactContentSource("", sf.AbsPath),
	})
	if err != nil {
		slog.Warn("surfacing: failed to persist surfaced artifact", "runId", run.ID, "path", sf.RelPath, "err", err)
	}
}

func surfacedArtifactID(runID, relPath string) string {
	h := md5.Sum([]byte(runID + ":" + relPath))
	return "surfaced_" + hex.EncodeToString(h[:8])
}

// ── Unified diff generation ─────────────────────────────────────────────

// generateUnifiedDiff produces a minimal unified diff between old and new content.
func generateUnifiedDiff(path, oldContent, newContent string) string {
	oldLines := splitLines(oldContent)
	newLines := splitLines(newContent)

	// Simple LCS-based diff: find common prefix and suffix, diff the middle.
	prefix := commonPrefixLen(oldLines, newLines)
	suffix := commonSuffixLen(oldLines[prefix:], newLines[prefix:])

	var buf strings.Builder
	buf.WriteString(fmt.Sprintf("--- a/%s\n", path))
	buf.WriteString(fmt.Sprintf("+++ b/%s\n", path))

	oldMiddle := oldLines[prefix : len(oldLines)-suffix]
	newMiddle := newLines[prefix : len(newLines)-suffix]

	if len(oldMiddle) == 0 && len(newMiddle) == 0 {
		return "" // no actual diff
	}

	// Determine context start line (1-indexed).
	startLine := prefix + 1
	buf.WriteString(fmt.Sprintf("@@ -%d,%d +%d,%d @@\n",
		startLine, len(oldMiddle),
		startLine, len(newMiddle)))

	for _, line := range oldMiddle {
		buf.WriteString("-")
		buf.WriteString(line)
		buf.WriteString("\n")
	}
	for _, line := range newMiddle {
		buf.WriteString("+")
		buf.WriteString(line)
		buf.WriteString("\n")
	}

	return buf.String()
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	lines := strings.SplitAfter(s, "\n")
	// Remove trailing empty from final newline.
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	// Strip the trailing newline from each line for clean output.
	for i, line := range lines {
		lines[i] = strings.TrimSuffix(line, "\n")
	}
	return lines
}

func commonPrefixLen(a, b []string) int {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		if a[i] != b[i] {
			return i
		}
	}
	return n
}

func commonSuffixLen(a, b []string) int {
	na, nb := len(a), len(b)
	n := na
	if nb < n {
		n = nb
	}
	for i := 0; i < n; i++ {
		if a[na-1-i] != b[nb-1-i] {
			return i
		}
	}
	return n
}

// ── Helpers ─────────────────────────────────────────────────────────────

func countDiffLines(diff string, prefix byte) int {
	count := 0
	for _, line := range strings.Split(diff, "\n") {
		if len(line) > 0 && line[0] == prefix {
			count++
		}
	}
	return count
}

func classifyDeployType(path string) string {
	base := strings.ToLower(filepath.Base(path))
	ext := strings.ToLower(filepath.Ext(path))
	switch {
	case base == "dockerfile" || ext == ".dockerfile":
		return "container"
	case strings.Contains(base, "docker-compose"):
		return "compose"
	case base == "vercel.json":
		return "vercel"
	case base == "netlify.toml":
		return "netlify"
	case base == "fly.toml":
		return "fly"
	default:
		return "static"
	}
}

func mimeTypeFromExt(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".ico":
		return "image/x-icon"
	case ".avif":
		return "image/avif"
	default:
		return "application/octet-stream"
	}
}

func languageFromExt(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".py":
		return "python"
	case ".go":
		return "go"
	case ".ts":
		return "typescript"
	case ".tsx":
		return "typescript"
	case ".js":
		return "javascript"
	case ".jsx":
		return "javascript"
	case ".rs":
		return "rust"
	case ".java":
		return "java"
	case ".c":
		return "c"
	case ".cpp":
		return "cpp"
	case ".rb":
		return "ruby"
	case ".php":
		return "php"
	case ".swift":
		return "swift"
	case ".kt":
		return "kotlin"
	case ".css":
		return "css"
	case ".scss":
		return "scss"
	case ".html", ".htm":
		return "html"
	case ".xml":
		return "xml"
	case ".json":
		return "json"
	case ".yaml", ".yml":
		return "yaml"
	case ".toml":
		return "toml"
	case ".md":
		return "markdown"
	case ".sql":
		return "sql"
	case ".sh", ".bash":
		return "bash"
	case ".dockerfile":
		return "dockerfile"
	default:
		return ""
	}
}
