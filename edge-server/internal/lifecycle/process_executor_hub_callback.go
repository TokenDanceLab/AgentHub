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
// Errors are logged but never block the run lifecycle. Concurrency is bounded
// by callbackSem so finish storms cannot spawn unbounded HTTP.
func (e *ProcessExecutor) fireHubAck(runID string) {
	taskID := e.hubTaskID(runID)
	if !shouldFireHubCallback(e.hubCallback != nil, taskID) {
		return
	}
	go func() {
		if !e.acquireHubCallbackSlot() {
			// Should not happen with a buffered sem; defensive.
			return
		}
		defer e.releaseHubCallbackSlot()
		ctx, cancel := context.WithTimeout(context.Background(), hubCallbackTimeout)
		defer cancel()
		if err := e.hubCallback.TaskAck(ctx, taskID, runID); shouldLogHubCallbackFailure(err) {
			slog.Warn("hub callback ack failed", "taskId", taskID, "runId", runID, "error", err)
		}
	}()
}

func (e *ProcessExecutor) recordHubOutput(runID, text string) {
	text, ok := prepareHubStreamContent(text)
	if !ok {
		return
	}
	e.mu.Lock()
	collector := e.hubOutputs[runID]
	e.mu.Unlock()
	if !shouldHaveHubOutputCollector(collector != nil) {
		return
	}
	collector.Append(text)
}

func (e *ProcessExecutor) recordHubFinalFallback(runID, text string) {
	text, ok := prepareHubStreamContent(text)
	if !ok {
		return
	}
	e.mu.Lock()
	collector := e.hubOutputs[runID]
	e.mu.Unlock()
	if !shouldHaveHubOutputCollector(collector != nil) {
		return
	}
	collector.SetFallback(text)
}

func (e *ProcessExecutor) hubFinalContent(runID string) string {
	e.mu.Lock()
	collector := e.hubOutputs[runID]
	e.mu.Unlock()
	if !shouldHaveHubOutputCollector(collector != nil) {
		return ""
	}
	return collector.Final()
}

// fireHubStream sends a TaskStream callback to Hub for visible runtime output.
// Errors are logged but never block the run lifecycle.
// Content is API-key-sanitized at this chokepoint so both raw stdout and
// structured hub emitter paths share one sink without control-flow rewrites.
//
// Slot acquisition is non-blocking: under Hub pressure stream chunks are dropped
// rather than stalling the run lifecycle (stdout reader / WaitGroup). FinalContent
// collection via recordHubOutput is independent of stream send success (#987).
func (e *ProcessExecutor) fireHubStream(runID string, content string) {
	content, ok := prepareHubStreamContent(content)
	if !ok {
		return
	}
	taskID := e.hubTaskID(runID)
	if !shouldFireHubCallback(e.hubCallback != nil, taskID) {
		return
	}
	for _, chunk := range splitHubCallbackText(content, hubCallbackChunkMaxBytes) {
		chunk := chunk
		if !e.tryAcquireHubCallbackSlot() {
			slog.Debug("hub callback stream dropped under backpressure", "taskId", taskID, "runId", runID)
			continue
		}
		go func() {
			defer e.releaseHubCallbackSlot()
			ctx, cancel := context.WithTimeout(context.Background(), hubCallbackTimeout)
			defer cancel()
			if err := e.hubCallback.TaskStream(ctx, taskID, runID, chunk); shouldLogHubCallbackFailure(err) {
				slog.Warn("hub callback stream failed", "taskId", taskID, "runId", runID, "error", err)
			}
		}()
	}
}

// fireHubDone sends a TaskDone callback to Hub. Called when the run finishes successfully.
// Errors are logged but never block the run lifecycle. Concurrency is bounded
// by callbackSem so finish storms cannot spawn unbounded HTTP.
func (e *ProcessExecutor) fireHubDone(runID string, _ map[string]any) {
	taskID := e.hubTaskID(runID)
	if !shouldFireHubCallback(e.hubCallback != nil, taskID) {
		return
	}
	content := e.hubFinalContent(runID)
	go func() {
		if !e.acquireHubCallbackSlot() {
			return
		}
		defer e.releaseHubCallbackSlot()
		ctx, cancel := context.WithTimeout(context.Background(), hubCallbackTimeout)
		defer cancel()
		result := hubTaskDoneResult(runID, content)
		if err := e.hubCallback.TaskDone(ctx, taskID, result); shouldLogHubCallbackFailure(err) {
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
	if !shouldWrapHubCallbackEmitter(executor != nil, inner != nil) {
		return inner
	}
	return &hubCallbackEmitter{executor: executor, runID: runID, inner: inner}
}

func (e *hubCallbackEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.inner.Emit(eventType, scope, payload)
	text, effect := hubCallbackTextForEvent(eventType, payload)
	if !shouldApplyHubCallbackSideEffect(text, effect) {
		return
	}
	if isHubCallbackStreamEffect(effect) {
		e.executor.recordHubOutput(e.runID, text)
		e.executor.fireHubStream(e.runID, text)
		return
	}
	if isHubCallbackFallbackEffect(effect) {
		e.executor.recordHubFinalFallback(e.runID, text)
	}
}

func (e *ProcessExecutor) fireHubFail(runID string, reason string) {
	taskID := e.hubTaskID(runID)
	if !shouldFireHubCallback(e.hubCallback != nil, taskID) {
		return
	}
	go func() {
		if !e.acquireHubCallbackSlot() {
			return
		}
		defer e.releaseHubCallbackSlot()
		ctx, cancel := context.WithTimeout(context.Background(), hubCallbackTimeout)
		defer cancel()
		if err := e.hubCallback.TaskFail(ctx, taskID, runID, reason); shouldLogHubCallbackFailure(err) {
			slog.Warn("hub callback fail failed", "taskId", taskID, "runId", runID, "error", err)
		}
	}()
}

// tryAcquireHubCallbackSlot attempts a non-blocking acquire of callbackSem.
// Returns false when the semaphore is full so stream paths can drop under pressure.
func (e *ProcessExecutor) tryAcquireHubCallbackSlot() bool {
	if e == nil || e.callbackSem == nil {
		return false
	}
	select {
	case e.callbackSem <- struct{}{}:
		return true
	default:
		return false
	}
}

// acquireHubCallbackSlot blocks until a callbackSem slot is available.
// Used by terminal callbacks (ack/done/fail) so concurrency stays bounded
// without dropping terminal delivery under brief pressure.
func (e *ProcessExecutor) acquireHubCallbackSlot() bool {
	if e == nil || e.callbackSem == nil {
		return false
	}
	e.callbackSem <- struct{}{}
	return true
}

// releaseHubCallbackSlot returns a previously acquired callbackSem slot.
func (e *ProcessExecutor) releaseHubCallbackSlot() {
	if e == nil || e.callbackSem == nil {
		return
	}
	<-e.callbackSem
}
