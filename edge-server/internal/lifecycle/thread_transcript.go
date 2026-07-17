package lifecycle

import (
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

// threadTranscriptEmitter wraps an EventEmitter and accumulates assistant text
// from stream events, then persists a single agent_message item on Flush.
type threadTranscriptEmitter struct {
	writer    store.Writer
	run       store.Run
	inner     adapters.EventEmitter
	collector *hubOutputCollector
	mu        sync.Mutex
	persisted bool
}

func newThreadTranscriptEmitter(repository store.RunLifecycleStore, run store.Run, inner adapters.EventEmitter) *threadTranscriptEmitter {
	writer, ok := repository.(store.Writer)
	if !ok || inner == nil {
		return nil
	}
	return &threadTranscriptEmitter{
		writer:    writer,
		run:       run,
		inner:     inner,
		collector: newHubOutputCollector(persistedAssistantMessageMaxBytes),
	}
}

func (e *threadTranscriptEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.inner.Emit(eventType, scope, payload)
	switch eventType {
	case adapters.BusEventTextDelta, adapters.BusEventTextBlock:
		if text := extractHubCallbackText(payload); text != "" {
			e.collector.Append(text)
		}
	case adapters.BusEventResult:
		if text := extractHubCallbackText(payload); text != "" {
			e.collector.SetFallback(text)
		}
	}
}

func (e *threadTranscriptEmitter) Flush() {
	e.mu.Lock()
	if e.persisted {
		e.mu.Unlock()
		return
	}
	e.persisted = true
	e.mu.Unlock()

	content := e.collector.Final()
	if strings.TrimSpace(content) == "" {
		return
	}
	item, err := e.writer.CreateItem(store.Item{
		ID:        transcriptItemID(e.run.ID),
		ProjectID: e.run.ProjectID,
		ThreadID:  e.run.ThreadID,
		RunID:     e.run.ID,
		Type:      "agent_message",
		Role:      "agent",
		Status:    "created",
		Content:   content,
	})
	if err != nil {
		slog.Warn("process: failed to persist assistant transcript", "runId", e.run.ID, "error", err)
		return
	}
	_ = item
}

func transcriptItemID(runID string) string {
	return fmt.Sprintf("item_%s_agent_%d", strings.TrimPrefix(runID, "run_"), time.Now().UnixNano())
}
