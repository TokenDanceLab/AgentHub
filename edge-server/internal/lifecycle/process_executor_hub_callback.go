package lifecycle

import (
	"context"
	"log/slog"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/hub"
)

// CallbackReporter is the Edge→Hub delivery port used by ProcessExecutor.
// *hub.CallbackClient implements this interface.
type CallbackReporter interface {
	TaskAck(ctx context.Context, taskID string, runID string) error
	TaskStream(ctx context.Context, taskID string, runID string, content string) error
	TaskDone(ctx context.Context, taskID string, result hub.TaskResult) error
	TaskFail(ctx context.Context, taskID string, runID string, reason string) error
}

func (e *ProcessExecutor) hubTaskID(runID string) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.hubTasks[runID]
}

// fireHubAck sends a TaskAck callback to Hub. Called when the run starts.
// Errors are logged but never block the run lifecycle.
func (e *ProcessExecutor) fireHubAck(runID string) {
	if e.hubCallback == nil {
		return
	}
	taskID := e.hubTaskID(runID)
	if taskID == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), hubCallbackTimeout)
		defer cancel()
		if err := e.hubCallback.TaskAck(ctx, taskID, runID); err != nil {
			slog.Warn("hub callback ack failed", "taskId", taskID, "runId", runID, "error", err)
		}
	}()
}

func (e *ProcessExecutor) recordHubOutput(runID, text string) {
	if text == "" {
		return
	}
	e.mu.Lock()
	collector := e.hubOutputs[runID]
	e.mu.Unlock()
	if collector == nil {
		return
	}
	collector.Append(text)
}

func (e *ProcessExecutor) recordHubFinalFallback(runID, text string) {
	if text == "" {
		return
	}
	e.mu.Lock()
	collector := e.hubOutputs[runID]
	e.mu.Unlock()
	if collector == nil {
		return
	}
	collector.SetFallback(text)
}

func (e *ProcessExecutor) hubFinalContent(runID string) string {
	e.mu.Lock()
	collector := e.hubOutputs[runID]
	e.mu.Unlock()
	if collector == nil {
		return ""
	}
	return collector.Final()
}

// fireHubStream sends a TaskStream callback to Hub for visible runtime output.
// Errors are logged but never block the run lifecycle.
func (e *ProcessExecutor) fireHubStream(runID string, content string) {
	if e.hubCallback == nil || content == "" {
		return
	}
	taskID := e.hubTaskID(runID)
	if taskID == "" {
		return
	}
	for _, chunk := range splitHubCallbackText(content, hubCallbackChunkMaxBytes) {
		chunk := chunk
		e.callbackSem <- struct{}{}
		go func() {
			defer func() { <-e.callbackSem }()
			ctx, cancel := context.WithTimeout(context.Background(), hubCallbackTimeout)
			defer cancel()
			if err := e.hubCallback.TaskStream(ctx, taskID, runID, chunk); err != nil {
				slog.Warn("hub callback stream failed", "taskId", taskID, "runId", runID, "error", err)
			}
		}()
	}
}

// fireHubDone sends a TaskDone callback to Hub. Called when the run finishes successfully.
// Errors are logged but never block the run lifecycle.
func (e *ProcessExecutor) fireHubDone(runID string, _ map[string]any) {
	if e.hubCallback == nil {
		return
	}
	taskID := e.hubTaskID(runID)
	if taskID == "" {
		return
	}
	content := e.hubFinalContent(runID)
	if content == "" {
		content = "Run finished"
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), hubCallbackTimeout)
		defer cancel()
		result := hub.TaskResult{
			RunID:        runID,
			FinalContent: content,
		}
		if err := e.hubCallback.TaskDone(ctx, taskID, result); err != nil {
			slog.Warn("hub callback done failed", "taskId", taskID, "runId", runID, "error", err)
		}
	}()
}

type hubCallbackEmitter struct {
	executor *ProcessExecutor
	runID    string
	inner    adapters.EventEmitter
}

func newHubCallbackEmitter(executor *ProcessExecutor, runID string, inner adapters.EventEmitter) adapters.EventEmitter {
	if executor == nil || inner == nil {
		return inner
	}
	return &hubCallbackEmitter{executor: executor, runID: runID, inner: inner}
}

func (e *hubCallbackEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.inner.Emit(eventType, scope, payload)
	switch eventType {
	case adapters.BusEventTextDelta, adapters.BusEventTextBlock:
		if text := extractHubCallbackText(payload); text != "" {
			e.executor.recordHubOutput(e.runID, text)
			e.executor.fireHubStream(e.runID, text)
		}
	case adapters.BusEventResult:
		if text := extractHubCallbackText(payload); text != "" {
			e.executor.recordHubFinalFallback(e.runID, text)
		}
	}
}

func (e *ProcessExecutor) fireHubFail(runID string, reason string) {
	if e.hubCallback == nil {
		return
	}
	taskID := e.hubTaskID(runID)
	if taskID == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), hubCallbackTimeout)
		defer cancel()
		if err := e.hubCallback.TaskFail(ctx, taskID, runID, reason); err != nil {
			slog.Warn("hub callback fail failed", "taskId", taskID, "runId", runID, "error", err)
		}
	}()
}
