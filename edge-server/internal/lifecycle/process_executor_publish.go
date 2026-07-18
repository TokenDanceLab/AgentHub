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
		readPlan := planOutputRead(n, err)
		if readPlan.Process {
			allowed, truncatedNow, written, maxBytes := limiter.allow(buf[:n])
			chunk := planOutputChunk(run.ID, stream, allowed, offset, truncatedNow, written, maxBytes, outStore != nil)
			if chunk.Publish {
				// Log stderr to structured logger so CC failure diagnostics
				// are visible in Edge server logs without subscribing to bus events.
				if chunk.LogStderr {
					for _, line := range stderrLogLines(chunk.Text) {
						sanitizedLine, _ := recursiveSanitizeString(line)
						slog.Error("cc stderr", "runId", run.ID, "line", sanitizedLine)
					}
				}
				if chunk.WriteStore {
					if _, err := outStore.Write(chunk.Text); planOutputStoreWriteLog(err).Log {
						slog.Warn("process: failed to write output store", "runId", run.ID, "error", err)
					}
				}
				if chunk.ForwardHub {
					e.recordHubOutput(run.ID, chunk.Text)
					e.fireHubStream(run.ID, chunk.Text)
				}
				if chunk.LogTruncate {
					slog.Warn("process: run output truncated", "runId", run.ID, "maxBytes", maxBytes)
				}
				e.bus.Publish("run.output.batch", runScope(run), chunk.Payload)
				offset = chunk.NextOffset
			}
		}
		if readPlan.Stop {
			return
		}
	}
}

func (e *ProcessExecutor) publishFailed(run store.Run, err error) {
	slog.Debug("executor.run.failed", "runId", run.ID, "error", err)
	failed, ok := e.store.SetRunStatusIf(run.ID, "failed", "queued", "started")
	failPlan := planPublishFailed(ok, err)
	if failPlan.Publish {
		if failPlan.Persist {
			e.persistAgentFailureMessage(failed, failPlan.Classified.Message)
		}
		e.bus.Publish("run.failed", runScope(failed), runFailedEventPayload(failed.ID, failed.Status, failPlan.Classified))
		e.fireHubFail(failed.ID, failPlan.Classified.Message)
	}
	e.checkPersistError(run.ID)
}

func (e *ProcessExecutor) persistAgentFailureMessage(run store.Run, content string) {
	content, contentOK := trimAgentFailureContent(content)
	repository, repoOK := asAgentFailureRepository(e.store)
	exists := false
	if planPersistAgentFailureGate(contentOK, repoOK).ScanExists {
		exists = hasAgentMessageForRun(repository.ListThreadItems(run.ThreadID), run.ID)
	}
	if !planPersistAgentFailure(contentOK, repoOK, exists).Proceed {
		return
	}
	item, err := repository.CreateItem(agentFailureItem(run, transcriptItemID(run.ID), content))
	if planAgentFailurePersistLog(err).Log {
		slog.Warn("process: failed to persist run failure message", "runId", run.ID, "error", err)
		return
	}
	scope := itemEventScope(item)
	e.bus.Publish("message.created", scope, item)
	e.bus.Publish("item.created", scope, item)
}

func (e *ProcessExecutor) publishCancelled(run store.Run) {
	cancelled, ok := e.store.SetRunStatusIf(run.ID, "cancelled", "queued", "started", "cancelling")
	if planPublishStatus(ok).Publish {
		e.bus.Publish("run.cancelled", runScope(cancelled), RunResponse(cancelled))
		// Fire Hub callback if configured
		e.fireHubFail(cancelled.ID, cancelledFailReason())
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
	if !planPersistError(sourceOK, persistErr).Emit {
		return
	}
	slog.Error("file store persist failed during run status transition", "runId", runID, "error", persistErr)
	scope, payload := persistenceErrorScopePayload(runID, persistErr)
	e.bus.Publish("run.persistence_error", scope, payload)
}

func (e *ProcessExecutor) runStatus(runID string) string {
	run, ok := e.store.GetRun(runID)
	return runStatusFromLookup(run, ok)
}
