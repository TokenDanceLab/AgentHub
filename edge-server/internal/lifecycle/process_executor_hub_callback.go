package lifecycle

import (
	"context"
	"log/slog"
	"strconv"
	"sync"
	"sync/atomic"

	"github.com/google/uuid"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/hub"
)

// CallbackReporter is the Edge→Hub delivery port used by ProcessExecutor.
// *hub.CallbackClient implements this interface.
type CallbackReporter interface {
	TaskAck(ctx context.Context, taskID string, runID string) error
	TaskStream(ctx context.Context, taskID string, runID string, clientMsgID string, content string) error
	TaskDone(ctx context.Context, taskID string, result hub.TaskResult) error
	TaskFail(ctx context.Context, taskID string, runID string, reason string) error
}

// hubStreamChunkSeq provides a per-run monotonic chunk index for deterministic
// client_msg_id (UUIDv5) generation in fireHubStream. Lazily populated via
// sync.Map so concurrent stream events for the same run get strictly
// increasing indices without lock contention. Entries are deleted in
// fireHubDone/fireHubFail so a long-lived executor does not leak finished
// run IDs. Package-scoped because the ProcessExecutor struct fields are out of
// this lane's file scope; the map is keyed by runID and bounded by the live
// run count.
var hubStreamChunkSeq sync.Map // runID -> *atomic.Int64

// nextHubStreamChunkIdx returns the next monotonic chunk index for runID,
// lazily allocating the atomic counter on first use.
func nextHubStreamChunkIdx(runID string) int64 {
	actual, _ := hubStreamChunkSeq.LoadOrStore(runID, new(atomic.Int64))
	return actual.(*atomic.Int64).Add(1)
}

// hubStreamClientMsgID derives a deterministic UUIDv5 from (runID, chunkIdx)
// so a replayed stream chunk (same runID+chunkIdx) produces the same
// client_msg_id and the Hub's #130 idempotent stream-to-message dedup can
// detect and skip the duplicate.
func hubStreamClientMsgID(runID string, chunkIdx int64) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte(runID+":"+strconv.FormatInt(chunkIdx, 10))).String()
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
	safeGo("hubAck", func() {
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
	})
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
		// Derive a deterministic client_msg_id from (runID, chunkIdx) so a
		// replayed stream chunk (same runID+chunkIdx, e.g. from the delivery
		// journal reconciliation path) produces the same id and the Hub's #130
		// idempotent stream-to-message dedup can detect and skip the duplicate.
		// The index is per-run and strictly monotonic across all fireHubStream
		// calls for this run, so concurrent stream events never collide.
		chunkIdx := nextHubStreamChunkIdx(runID)
		clientMsgID := hubStreamClientMsgID(runID, chunkIdx)
		safeGo("hubStream", func() {
			defer e.releaseHubCallbackSlot()
			ctx, cancel := context.WithTimeout(context.Background(), hubCallbackTimeout)
			defer cancel()
			if err := e.hubCallback.TaskStream(ctx, taskID, runID, clientMsgID, chunk); shouldLogHubCallbackFailure(err) {
				slog.Warn("hub callback stream failed", "taskId", taskID, "runId", runID, "error", err)
			}
		})
	}
}

// fireHubDone sends a TaskDone callback to Hub. Called when the run finishes successfully.
// Errors are logged but never block the run lifecycle. Concurrency is bounded
// by callbackSem so finish storms cannot spawn unbounded HTTP.
func (e *ProcessExecutor) fireHubDone(runID string, _ map[string]any) {
	taskID := e.hubTaskID(runID)
	if !shouldFireHubCallback(e.hubCallback != nil, taskID) {
		// Even when no callback fires, drop the per-run chunk-seq counter so
		// the package-scoped map does not retain finished runs.
		hubStreamChunkSeq.Delete(runID)
		return
	}
	content := e.hubFinalContent(runID)
	safeGo("hubDone", func() {
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
		// Drop the per-run chunk-seq counter after the terminal callback so
		// the package-scoped map does not retain finished runs.
		hubStreamChunkSeq.Delete(runID)
	})
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
		hubStreamChunkSeq.Delete(runID)
		return
	}
	safeGo("hubFail", func() {
		if !e.acquireHubCallbackSlot() {
			return
		}
		defer e.releaseHubCallbackSlot()
		ctx, cancel := context.WithTimeout(context.Background(), hubCallbackTimeout)
		defer cancel()
		if err := e.hubCallback.TaskFail(ctx, taskID, runID, reason); shouldLogHubCallbackFailure(err) {
			slog.Warn("hub callback fail failed", "taskId", taskID, "runId", runID, "error", err)
		}
		hubStreamChunkSeq.Delete(runID)
	})
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
