package lifecycle

import (
	"io"
	"log/slog"
	"sync"

	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

func (e *ProcessExecutor) publishOutput(wg *sync.WaitGroup, run store.Run, outStore *runnerctx.RunOutputStore, limiter *runOutputLimiter, stream string, reader io.Reader) {
	defer wg.Done()

	buf := make([]byte, defaultReadBufferSize)
	offset := 0
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			offset = e.publishOutputChunk(run, outStore, limiter, stream, buf[:n], offset)
		}
		if err != nil {
			return
		}
	}
}

// publishOutputChunk applies the output limiter to one read chunk and performs
// the per-chunk side effects (stderr logging, output store write, Hub stream
// forwarding, truncation warning, run.output.batch publish). It returns the
// updated chunk offset for the caller's next iteration.
func (e *ProcessExecutor) publishOutputChunk(run store.Run, outStore *runnerctx.RunOutputStore, limiter *runOutputLimiter, stream string, data []byte, offset int) int {
	allowed, truncatedNow, written, maxBytes := limiter.allow(data)
	if len(allowed) == 0 && !truncatedNow {
		return offset
	}
	text := string(allowed)
	// Log stderr to structured logger so CC failure diagnostics
	// are visible in Edge server logs without subscribing to bus events.
	if stream == "stderr" && text != "" {
		for _, line := range stderrLogLines(text) {
			sanitizedLine, _ := recursiveSanitizeString(line)
			slog.Error("cc stderr", "runId", run.ID, "line", sanitizedLine)
		}
	}
	if outStore != nil && len(allowed) > 0 {
		if _, err := outStore.Write(text); err != nil {
			slog.Warn("process: failed to write output store", "runId", run.ID, "error", err)
		}
	}
	if stream == "stdout" && text != "" {
		e.recordHubOutput(run.ID, text)
		e.fireHubStream(run.ID, text)
	}
	if truncatedNow {
		slog.Warn("process: run output truncated", "runId", run.ID, "maxBytes", maxBytes)
	}
	e.bus.Publish("run.output.batch", runScope(run), runOutputBatchPayload(run.ID, stream, text, offset, truncatedNow, written, maxBytes))
	return offset + len(allowed)
}

func (e *ProcessExecutor) publishFailed(run store.Run, err error) {
	slog.Debug("executor.run.failed", "runId", run.ID, "error", err)
	failed, ok := e.store.SetRunStatusIf(run.ID, "failed", "queued", "started")
	if ok {
		classified := ClassifyError(err, ExitCodeFromErr(err))
		e.persistAgentFailureMessage(failed, classified.Message)
		e.bus.Publish("run.failed", runScope(failed), runFailedEventPayload(failed.ID, failed.Status, classified))
		e.fireHubFail(failed.ID, classified.Message)
	}
	e.checkPersistError(run.ID)
}

func (e *ProcessExecutor) persistAgentFailureMessage(run store.Run, content string) {
	content, contentOK := trimAgentFailureContent(content)
	repository, repoOK := asAgentFailureRepository(e.store)
	exists := false
	if contentOK && repoOK {
		exists = hasAgentMessageForRun(repository.ListThreadItems(run.ThreadID), run.ID)
	}
	if !contentOK || !repoOK || exists {
		return
	}
	item, err := repository.CreateItem(agentFailureItem(run, transcriptItemID(run.ID), content))
	if err != nil {
		slog.Warn("process: failed to persist run failure message", "runId", run.ID, "error", err)
		return
	}
	scope := itemEventScope(item)
	e.bus.Publish("message.created", scope, item)
	e.bus.Publish("item.created", scope, item)
}

func (e *ProcessExecutor) publishCancelled(run store.Run) {
	cancelled, ok := e.store.SetRunStatusIf(run.ID, "cancelled", "queued", "started", "cancelling")
	if ok {
		e.bus.Publish("run.cancelled", runScope(cancelled), RunResponse(cancelled))
		// Fire Hub callback if configured
		e.fireHubFail(cancelled.ID, ("run cancelled"))
	}
	e.checkPersistError(run.ID)
}

// checkPersistError logs and emits a persistence_error event when the FileStore
// has a pending persistence failure after a status transition.
func (e *ProcessExecutor) checkPersistError(runID string) {
	pc, sourceOK := asPersistErrorSource(e.store)
	var persistErr error
	if sourceOK {
		persistErr = pc.LastPersistError()
	}
	if !sourceOK || persistErr == nil {
		return
	}
	slog.Error("file store persist failed during run status transition", "runId", runID, "error", persistErr)
	scope, payload := persistenceErrorScopePayload(runID, persistErr)
	e.bus.Publish("run.persistence_error", scope, payload)
}

func (e *ProcessExecutor) runStatus(runID string) string {
	run, ok := e.store.GetRun(runID)
	if !ok {
		return ""
	}
	return run.Status
}
