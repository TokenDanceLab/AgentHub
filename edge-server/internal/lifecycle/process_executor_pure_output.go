package lifecycle

import "github.com/agenthub/edge-server/internal/adapters"

// Residual pure-helper peel #1121: domain pure helpers extracted from
// process_executor_pure.go. Same package lifecycle; zero behavior change.

// shouldPublishOutputChunk reports whether a read produced bytes and/or a
// truncation marker that must be published on the bus.
func shouldPublishOutputChunk(allowedLen int, truncatedNow bool) bool {
	return allowedLen > 0 || truncatedNow
}

// shouldLogStderrLines reports whether stderr text should be mirrored to slog.
func shouldLogStderrLines(stream, text string) bool {
	return stream == "stderr" && text != ""
}

// shouldWriteRunOutputStore reports whether accepted output should be persisted
// to the run output temp store.
func shouldWriteRunOutputStore(hasStore bool, allowedLen int) bool {
	return hasStore && allowedLen > 0
}

// shouldProcessOutputRead reports whether a pipe read produced bytes to process.
func shouldProcessOutputRead(n int) bool {
	return n > 0
}

// shouldLogRunOutputTruncation reports whether a truncation marker should be
// mirrored to the structured logger.
func shouldLogRunOutputTruncation(truncatedNow bool) bool {
	return truncatedNow
}

// shouldStopOutputRead reports whether publishOutput should exit the read loop.
func shouldStopOutputRead(err error) bool {
	return err != nil
}

// shouldCloseTrackedRunOutput reports whether finish should close a tracked
// run output store.
func shouldCloseTrackedRunOutput(found bool) bool {
	return found
}

// shouldLogRunOutputStoreCreateFailure reports whether NewRunOutputStore failure
// should be warned (run continues without persistence/replay).
func shouldLogRunOutputStoreCreateFailure(err error) bool {
	return err != nil
}

// shouldTrackRunOutputStore reports whether a successfully created output store
// should be retained on the executor.
func shouldTrackRunOutputStore(err error) bool {
	return err == nil
}

// shouldLogRunOutputStoreWriteFailure reports whether a run-output store write
// error should be warned (non-fatal).
func shouldLogRunOutputStoreWriteFailure(err error) bool {
	return err != nil
}

// shouldLogRunOutputStoreCloseFailure reports whether closing a tracked run
// output store failed and should be warned.
func shouldLogRunOutputStoreCloseFailure(err error) bool {
	return err != nil
}

// outputChunkPlan is the pure publish plan for one publishOutput read chunk.
type outputChunkPlan struct {
	Publish     bool
	Text        string
	LogStderr   bool
	WriteStore  bool
	ForwardHub  bool
	LogTruncate bool
	Payload     map[string]any
	NextOffset  int
}

// planOutputChunk maps a limiter.allow result into publish/log/store/hub flags
// and the bus payload. Side-effects stay in the executor.
func planOutputChunk(runID, stream string, allowed []byte, offset int, truncatedNow bool, written, maxBytes int64, hasOutStore bool) outputChunkPlan {
	if !shouldPublishOutputChunk(len(allowed), truncatedNow) {
		return outputChunkPlan{NextOffset: offset}
	}
	text := string(allowed)
	return outputChunkPlan{
		Publish:     true,
		Text:        text,
		LogStderr:   shouldLogStderrLines(stream, text),
		WriteStore:  shouldWriteRunOutputStore(hasOutStore, len(allowed)),
		ForwardHub:  shouldForwardStdoutToHub(stream, text),
		LogTruncate: shouldLogRunOutputTruncation(truncatedNow),
		Payload:     runOutputBatchPayload(runID, stream, text, offset, truncatedNow, written, maxBytes),
		NextOffset:  offset + len(allowed),
	}
}

// runOutputStoreTrackPlan is the pure create-result plan for NewRunOutputStore.
type runOutputStoreTrackPlan struct {
	LogFailure bool
	Track      bool
}

// planRunOutputStoreTrack maps NewRunOutputStore's error into log/track flags.
func planRunOutputStoreTrack(err error) runOutputStoreTrackPlan {
	return runOutputStoreTrackPlan{
		LogFailure: shouldLogRunOutputStoreCreateFailure(err),
		Track:      shouldTrackRunOutputStore(err),
	}
}

// outputReadPlan is the pure publishOutput read-loop gate for one Read result.
type outputReadPlan struct {
	Process bool
	Stop    bool
}

// planOutputRead maps Read (n, err) into process-chunk / stop-loop flags.
// Store write / hub forward stay on the chunk plan.
func planOutputRead(n int, err error) outputReadPlan {
	return outputReadPlan{
		Process: shouldProcessOutputRead(n),
		Stop:    shouldStopOutputRead(err),
	}
}

// outputStoreWriteLogPlan is the pure run-output store write failure log gate.
type outputStoreWriteLogPlan struct {
	Log bool
}

// planOutputStoreWriteLog maps an outStore.Write error into the warn-log flag.
func planOutputStoreWriteLog(err error) outputStoreWriteLogPlan {
	return outputStoreWriteLogPlan{Log: shouldLogRunOutputStoreWriteFailure(err)}
}

// runOutputCloseLogPlan is the pure finish-path outStore.Close failure log gate.
type runOutputCloseLogPlan struct {
	Log bool
}

// planRunOutputCloseLog maps an outStore.Close error into the warn-log flag.
func planRunOutputCloseLog(err error) runOutputCloseLogPlan {
	return runOutputCloseLogPlan{Log: shouldLogRunOutputStoreCloseFailure(err)}
}

// shouldApplyTrackedClose reports whether a planned close should run when the
// tracked map entry is present (finish / session-retry cleanup).
func shouldApplyTrackedClose(planned, found bool) bool {
	return planned && found
}

// structuredEmitterWrapPlan is the pure emitter-wrapper plan for publishStructuredOutput.
type structuredEmitterWrapPlan struct {
	ApplyBudget bool
}

// planStructuredEmitterWraps maps budget presence into wrap flags.
// Actual Wrap construction stays in the executor.
func planStructuredEmitterWraps(hasBudget bool) structuredEmitterWrapPlan {
	return structuredEmitterWrapPlan{
		ApplyBudget: shouldApplyBudgetAwareEmitter(hasBudget),
	}
}

// coalesceEmitter prefers next when non-nil; otherwise keeps current.
func coalesceEmitter(current, next adapters.EventEmitter) adapters.EventEmitter {
	if next != nil {
		return next
	}
	return current
}

// shouldFlushTranscriptEmitter reports whether a transcript emitter should flush
// after ParseStream returns.
func shouldFlushTranscriptEmitter(hasTranscript bool) bool {
	return hasTranscript
}
