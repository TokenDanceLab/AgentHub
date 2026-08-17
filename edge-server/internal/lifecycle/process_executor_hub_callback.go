package lifecycle

import (
	"context"
	"log/slog"
	"strconv"
	"strings"
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
// Delivery is ordered per run: chunks are queued to a per-run FIFO consumed by
// a single goroutine, so the Hub receives stream chunks in emission order
// (concurrent safeGo sends previously raced and could deliver a later chunk
// first). Backpressure is non-blocking: when the queue is full the chunk is
// dropped rather than stalling the run lifecycle (#987). FinalContent
// collection via recordHubOutput is independent of stream send success.
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
		// Derive a deterministic client_msg_id from (runID, chunkIdx) so a
		// replayed stream chunk (same runID+chunkIdx, e.g. from the delivery
		// journal reconciliation path) produces the same id and the Hub's #130
		// idempotent stream-to-message dedup can detect and skip the duplicate.
		// The index is per-run and strictly monotonic across all fireHubStream
		// calls for this run.
		chunkIdx := nextHubStreamChunkIdx(runID)
		clientMsgID := hubStreamClientMsgID(runID, chunkIdx)
		if !e.enqueueHubStreamJob(runID, hubCallbackJob{
			kind:        hubJobStream,
			taskID:      taskID,
			runID:       runID,
			clientMsgID: clientMsgID,
			content:     chunk,
		}) {
			slog.Debug("hub callback stream dropped under backpressure", "taskId", taskID, "runId", runID)
		}
	}
}

// fireHubDone sends a TaskDone callback to Hub. Called when the run finishes successfully.
// The done job is enqueued behind any in-flight stream chunks (per-run FIFO)
// so the terminal callback can never overtake trailing stream output. The
// caller never blocks: the enqueue itself runs on a goroutine that waits for
// queue space, which the consumer always makes progress toward (every send is
// bounded by hubCallbackTimeout).
func (e *ProcessExecutor) fireHubDone(runID string, _ map[string]any) {
	taskID := e.hubTaskID(runID)
	if !shouldFireHubCallback(e.hubCallback != nil, taskID) {
		// Even when no callback fires, drop the per-run chunk-seq counter so
		// the package-scoped map does not retain finished runs.
		hubStreamChunkSeq.Delete(runID)
		return
	}
	content := e.hubFinalContent(runID)
	safeGo("hubDoneEnqueue", func() {
		e.enqueueTerminalHubJob(runID, hubCallbackJob{
			kind:   hubJobDone,
			taskID: taskID,
			runID:  runID,
			result: hubTaskDoneResult(runID, content),
		})
	})
}

// fireHubFail sends a TaskFail callback to Hub. Same per-run ordering as
// fireHubDone: the fail job waits behind queued stream chunks and closes the
// queue so later (unlikely, but racing) stream enqueues drop instead of
// leaking past the terminal callback.
func (e *ProcessExecutor) fireHubFail(runID string, reason string) {
	taskID := e.hubTaskID(runID)
	if !shouldFireHubCallback(e.hubCallback != nil, taskID) {
		hubStreamChunkSeq.Delete(runID)
		return
	}
	safeGo("hubFailEnqueue", func() {
		e.enqueueTerminalHubJob(runID, hubCallbackJob{
			kind:    hubJobFail,
			taskID:  taskID,
			runID:   runID,
			content: reason,
		})
	})
}

// ── per-run ordered callback queue (#1409) ───────────────────────────────────

// hubCallbackQueueCapacity bounds the per-run delivery queue. Stream chunks
// beyond the capacity drop (same policy as the previous non-blocking semaphore
// acquire); the terminal job enqueue blocks until space exists so done/fail
// delivery is never lost to backpressure.
const hubCallbackQueueCapacity = 128

type hubCallbackJobKind int

const (
	hubJobStream hubCallbackJobKind = iota
	hubJobDone
	hubJobFail
)

// hubCallbackJob is one queued callback delivery for a run.
type hubCallbackJob struct {
	kind        hubCallbackJobKind
	taskID      string
	runID       string
	clientMsgID string // stream jobs only
	content     string // stream chunk content or fail reason
	result      hub.TaskResult
}

// hubCallbackQueueState is the per-run FIFO plus lifecycle flags. The mutex
// guards enqueue-vs-close so a stream racing the terminal enqueue either lands
// before the close (ordered) or observes closed and drops — never a send on a
// closed channel.
type hubCallbackQueueState struct {
	runID   string
	mu      sync.Mutex
	ch      chan hubCallbackJob
	started atomic.Bool
	closed  bool
}

// hubCallbackQueues holds live per-run queues; entries are removed by the
// consumer once a run's queue drains after the terminal job.
var hubCallbackQueues sync.Map // runID -> *hubCallbackQueueState

func newHubCallbackQueueState(runID string) *hubCallbackQueueState {
	return &hubCallbackQueueState{
		runID: runID,
		ch:    make(chan hubCallbackJob, hubCallbackQueueCapacity),
	}
}

// close idempotently closes the queue channel so the consumer goroutine (if
// running) drains remaining jobs and exits. It is safe to call from finish()
// when a panicked run skipped fireHubDone/fireHubFail and never enqueued a
// terminal job — otherwise the queue entry and consumer would leak.
func (s *hubCallbackQueueState) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	close(s.ch)
}

// enqueueHubStreamJob appends a stream chunk to the run's FIFO without
// blocking. Returns false when the queue is full (chunk dropped) or already
// closed (terminal callback decided the run's delivery).
func (e *ProcessExecutor) enqueueHubStreamJob(runID string, job hubCallbackJob) bool {
	stateAny, _ := hubCallbackQueues.LoadOrStore(runID, newHubCallbackQueueState(runID))
	state := stateAny.(*hubCallbackQueueState)

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.closed {
		return false
	}
	select {
	case state.ch <- job:
	default:
		return false
	}
	e.startHubCallbackQueue(state)
	return true
}

// enqueueTerminalHubJob appends a done/fail job, waiting for queue space, then
// closes the queue so the consumer drains remaining jobs (including this one)
// and exits. Late stream enqueues observe the closed flag and drop.
func (e *ProcessExecutor) enqueueTerminalHubJob(runID string, job hubCallbackJob) {
	stateAny, _ := hubCallbackQueues.LoadOrStore(runID, newHubCallbackQueueState(runID))
	state := stateAny.(*hubCallbackQueueState)

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.closed {
		return
	}
	state.ch <- job // blocking: the consumer always makes progress (timeout-bounded sends)
	state.closed = true
	close(state.ch)
	// A run may reach done/fail with no stream chunks at all — the terminal
	// job is then the queue's first (and only) job, so the consumer must be
	// started here too.
	e.startHubCallbackQueue(state)
}

// startHubCallbackQueue launches the single consumer goroutine for a run,
// guarded by an atomic so multiple concurrent enqueues start it exactly once.
func (e *ProcessExecutor) startHubCallbackQueue(state *hubCallbackQueueState) {
	if !state.started.CompareAndSwap(false, true) {
		return
	}
	safeGo("hubCallbackQueue", func() {
		defer func() {
			// Consumer owns per-run cleanup: the queue map entry and the
			// chunk-seq counter go away only after the queue drains.
			hubCallbackQueues.Delete(state.runID)
			hubStreamChunkSeq.Delete(state.runID)
		}()
		for job := range state.ch {
			e.deliverHubCallbackJob(job)
		}
	})
}

// deliverHubCallbackJob sends one queued job to the Hub. Stream jobs keep the
// non-blocking backpressure policy (#987): drop when the global slot semaphore
// is full. Terminal jobs acquire the semaphore blocking so done/fail delivery
// is never dropped under brief pressure.
func (e *ProcessExecutor) deliverHubCallbackJob(job hubCallbackJob) {
	if job.kind == hubJobStream {
		if !e.tryAcquireHubCallbackSlot() {
			slog.Debug("hub callback stream dropped under backpressure", "taskId", job.taskID, "runId", job.runID)
			return
		}
	} else {
		if !e.acquireHubCallbackSlot() {
			return
		}
	}
	defer e.releaseHubCallbackSlot()

	ctx, cancel := context.WithTimeout(context.Background(), hubCallbackTimeout)
	defer cancel()

	switch job.kind {
	case hubJobStream:
		if err := e.hubCallback.TaskStream(ctx, job.taskID, job.runID, job.clientMsgID, job.content); shouldLogHubCallbackFailure(err) {
			slog.Warn("hub callback stream failed", "taskId", job.taskID, "runId", job.runID, "error", err)
		}
	case hubJobDone:
		if err := e.hubCallback.TaskDone(ctx, job.taskID, job.result); shouldLogHubCallbackFailure(err) {
			slog.Warn("hub callback done failed", "taskId", job.taskID, "runId", job.runID, "error", err)
		}
	case hubJobFail:
		if err := e.hubCallback.TaskFail(ctx, job.taskID, job.runID, job.content); shouldLogHubCallbackFailure(err) {
			slog.Warn("hub callback fail failed", "taskId", job.taskID, "runId", job.runID, "error", err)
		}
	}
}

type hubCallbackEmitter struct {
	executor *ProcessExecutor
	runID    string
	inner    adapters.EventEmitter

	// pendingDelta coalesces token-level BusEventTextDelta text (ACP/SDK
	// adapters emit 3-30 char deltas) so the Hub stream path receives
	// readable chunks instead of one message per token (#1407). The final
	// output collector is fed per-event independently of this buffer, so
	// done-final content is unaffected by coalescing. Single parser
	// goroutine per run in practice; the mutex guards the rare concurrent
	// emitter (orchestrator fan-in) case.
	pendingMu    sync.Mutex
	pendingDelta strings.Builder
}

// hubStreamCoalesceMaxBytes is the soft cap for a coalesced Hub stream chunk.
// Deltas accumulate until this size or a line break before one fireHubStream.
const hubStreamCoalesceMaxBytes = 256

// hubStreamFlusher exposes the coalescer flush for the parse-stream driver.
type hubStreamFlusher interface {
	FlushHubStream()
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
		// Feed the final-content collector per event: the done callback must
		// carry the complete output regardless of stream coalescing.
		e.executor.recordHubOutput(e.runID, text)
		if shouldCoalesceHubStreamDelta(eventType) {
			e.appendPendingDelta(text)
			return
		}
		// Non-delta stream events (text blocks) are natural boundaries:
		// flush anything pending, then forward the block directly.
		e.flushPendingHubStream()
		e.executor.fireHubStream(e.runID, text)
		return
	}
	if isHubCallbackFallbackEffect(effect) {
		e.flushPendingHubStream()
		e.executor.recordHubFinalFallback(e.runID, text)
	}
}

// shouldCoalesceHubStreamDelta reports whether a stream event's text should
// buffer into the pending delta coalescer instead of forwarding immediately.
func shouldCoalesceHubStreamDelta(eventType string) bool {
	return eventType == adapters.BusEventTextDelta
}

// appendPendingDelta buffers a token-level delta and flushes when the pending
// text grows past the soft cap or contains a line break (natural chunking for
// chat rendering).
func (e *hubCallbackEmitter) appendPendingDelta(text string) {
	e.pendingMu.Lock()
	e.pendingDelta.WriteString(text)
	pending := e.pendingDelta.String()
	shouldFlush := len(pending) >= hubStreamCoalesceMaxBytes || strings.Contains(text, "\n")
	e.pendingMu.Unlock()
	if shouldFlush {
		e.flushPendingHubStream()
	}
}

// flushPendingHubStream drains the pending delta buffer into one Hub stream
// callback. Empty pending is a no-op.
func (e *hubCallbackEmitter) flushPendingHubStream() {
	e.pendingMu.Lock()
	pending := e.pendingDelta.String()
	if pending == "" {
		e.pendingMu.Unlock()
		return
	}
	e.pendingDelta.Reset()
	e.pendingMu.Unlock()
	e.executor.fireHubStream(e.runID, pending)
}

// FlushHubStream drains the pending delta buffer. Called by the structured
// output driver once ParseStream returns so a tail of sub-threshold deltas is
// not stranded in the buffer after the run finishes.
func (e *hubCallbackEmitter) FlushHubStream() {
	e.flushPendingHubStream()
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
