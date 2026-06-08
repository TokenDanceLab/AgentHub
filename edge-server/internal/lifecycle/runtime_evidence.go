package lifecycle

import (
	"log/slog"
	"path"
	"path/filepath"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

const (
	eventArtifactCreated = "artifact.created"
	eventPreviewReady    = "preview.ready"
)

type runtimeEvidenceEmitter struct {
	writer store.Writer
	run    store.Run
	inner  adapters.EventEmitter
}

func newRuntimeEvidenceEmitter(repository store.RunLifecycleStore, run store.Run, inner adapters.EventEmitter) *runtimeEvidenceEmitter {
	writer, ok := repository.(store.Writer)
	if !ok || inner == nil {
		return nil
	}
	return &runtimeEvidenceEmitter{writer: writer, run: run, inner: inner}
}

func (e *runtimeEvidenceEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.inner.Emit(eventType, scope, payload)

	payloadMap, ok := payload.(map[string]any)
	if !ok {
		return
	}
	switch eventType {
	case adapters.BusEventFileChange:
		e.persistRunDiffFile(payloadMap)
	case eventArtifactCreated:
		e.persistArtifact(payloadMap)
	case eventPreviewReady:
		e.persistPreview(payloadMap)
	}
}

func (e *runtimeEvidenceEmitter) persistRunDiffFile(payload map[string]any) {
	filePath := evidencePathFromPayload(payload, "path")
	if filePath == "" {
		return
	}
	status := firstPayloadString(payload, "kind", "action", "status")
	diff := payloadString(payload, "diff")
	if _, err := e.writer.UpsertRunDiffFile(store.RunDiffFile{
		RunID:  e.run.ID,
		Path:   filePath,
		Diff:   diff,
		Status: status,
	}); err != nil {
		slog.Warn("process: failed to persist runtime diff evidence", "runId", e.run.ID, "path", filePath, "err", err)
	}
}

func (e *runtimeEvidenceEmitter) persistArtifact(payload map[string]any) {
	id := firstPayloadString(payload, "id", "artifactId")
	if id == "" {
		return
	}
	artifact := store.Artifact{
		ID:        id,
		RunID:     e.run.ID,
		ThreadID:  e.run.ThreadID,
		Kind:      payloadString(payload, "kind"),
		Path:      evidencePathFromPayload(payload, "path"),
		SizeBytes: payloadInt64(payload, "sizeBytes", "size_bytes"),
	}
	if _, err := e.writer.UpsertArtifact(artifact); err != nil {
		slog.Warn("process: failed to persist runtime artifact evidence", "runId", e.run.ID, "artifactId", id, "err", err)
	}
}

func (e *runtimeEvidenceEmitter) persistPreview(payload map[string]any) {
	id := firstPayloadString(payload, "id", "previewId")
	if id == "" {
		return
	}
	preview := store.Preview{
		ID:       id,
		RunID:    e.run.ID,
		ThreadID: e.run.ThreadID,
		URL:      payloadString(payload, "url"),
		Status:   payloadString(payload, "status"),
	}
	if _, err := e.writer.UpsertPreview(preview); err != nil {
		slog.Warn("process: failed to persist runtime preview evidence", "runId", e.run.ID, "previewId", id, "err", err)
	}
}

func firstPayloadString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := payloadString(payload, key); value != "" {
			return value
		}
	}
	return ""
}

func payloadString(payload map[string]any, key string) string {
	value, ok := payload[key]
	if !ok {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func payloadInt64(payload map[string]any, keys ...string) int64 {
	for _, key := range keys {
		switch value := payload[key].(type) {
		case int:
			return int64(value)
		case int32:
			return int64(value)
		case int64:
			return value
		case float64:
			return int64(value)
		}
	}
	return 0
}

func evidencePathFromPayload(payload map[string]any, key string) string {
	value := strings.ReplaceAll(payloadString(payload, key), "\\", "/")
	value = path.Clean(value)
	if value == "." || value == "" {
		return ""
	}
	if path.IsAbs(value) || filepath.IsAbs(value) || value == ".." || strings.HasPrefix(value, "../") {
		return path.Base(value)
	}
	return value
}
