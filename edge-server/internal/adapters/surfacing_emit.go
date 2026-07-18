package adapters

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

// Residual pure-helper peel #1112: emit/persist helpers for auto-surfaced outputs.

func emitSurfacedPreview(bus *events.Bus, writer store.Writer, scope map[string]any, run store.Run, sf SurfacedFile, _ *WorkdirSnapshot) {
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
		slog.Warn("surfacing: failed to persist preview", "runId", run.ID, "path", sf.RelPath, "error", err)
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
		"runId":        run.ID,
		"path":         sf.RelPath,
		"action":       "modified",
		"diff":         diff,
		"oldHash":      sf.OldHash,
		"newHash":      sf.NewHash,
		"addedLines":   countDiffLines(diff, '+'),
		"removedLines": countDiffLines(diff, '-'),
	})

	// Persist diff in store.
	if _, err := writer.UpsertRunDiffFile(store.RunDiffFile{
		RunID:  run.ID,
		Path:   sf.RelPath,
		Diff:   diff,
		Status: "modified",
	}); err != nil {
		slog.Warn("surfacing: failed to persist surfaced diff", "runId", run.ID, "path", sf.RelPath, "error", err)
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
		slog.Warn("surfacing: failed to persist surfaced artifact", "runId", run.ID, "path", sf.RelPath, "error", err)
	}
}

func surfacedArtifactID(runID, relPath string) string {
	h := md5.Sum([]byte(runID + ":" + relPath))
	return "surfaced_" + hex.EncodeToString(h[:8])
}
