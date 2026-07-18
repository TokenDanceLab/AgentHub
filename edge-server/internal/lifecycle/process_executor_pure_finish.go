package lifecycle

import (
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

// Residual pure-helper peel #1121: domain pure helpers extracted from
// process_executor_pure.go. Same package lifecycle; zero behavior change.

// trimAgentFailureContent trims and validates content for agent_message persistence.
func trimAgentFailureContent(content string) (string, bool) {
	content = strings.TrimSpace(content)
	if content == "" {
		return "", false
	}
	return content, true
}

// hasAgentMessageForRun reports whether the thread already has an agent_message
// item for the given run (so failure persistence is skipped).
func hasAgentMessageForRun(items []store.Item, runID string) bool {
	for _, item := range items {
		if item.RunID == runID && item.Type == "agent_message" {
			return true
		}
	}
	return false
}

// shouldPersistClassifiedFailure reports whether a classified failure message
// should be persisted as an agent_message item.
func shouldPersistClassifiedFailure(classified *RunError) bool {
	return classified != nil
}

// asStoreWriter returns the store when it implements store.Writer.
func asStoreWriter(runStore store.RunLifecycleStore) (store.Writer, bool) {
	writer, ok := runStore.(store.Writer)
	return writer, ok
}

// agentFailureRepository is the dual Reader+Writer surface needed to persist a
// failed agent_message without inventing a new store API.
type agentFailureRepository interface {
	store.Reader
	store.Writer
}

// asAgentFailureRepository returns the store when it can both list thread items
// and create failure messages.
func asAgentFailureRepository(runStore store.RunLifecycleStore) (agentFailureRepository, bool) {
	repository, ok := runStore.(interface {
		store.Reader
		store.Writer
	})
	return repository, ok
}

// persistErrorSource exposes the last FileStore persistence failure.
type persistErrorSource interface {
	LastPersistError() error
}

// asPersistErrorSource returns the store when it tracks persistence errors.
func asPersistErrorSource(runStore store.RunLifecycleStore) (persistErrorSource, bool) {
	source, ok := runStore.(persistErrorSource)
	return source, ok
}

// shouldEmitPersistenceError reports whether a pending persist failure should
// be logged and published on the bus.
func shouldEmitPersistenceError(err error) bool {
	return err != nil
}

// shouldSurfaceWithSnapshot reports whether auto-surface has a pre-run workdir
// snapshot to compare against.
func shouldSurfaceWithSnapshot(snapshot *adapters.WorkdirSnapshot) bool {
	return snapshot != nil
}

// shouldLogAgentFailurePersistError reports whether CreateItem failure for a
// failure agent_message should be warned.
func shouldLogAgentFailurePersistError(err error) bool {
	return err != nil
}

// shouldPersistAgentFailureContent reports whether trimmed failure content may
// be persisted as an agent_message.
func shouldPersistAgentFailureContent(ok bool) bool {
	return ok
}

// shouldUseAgentFailureRepository reports whether the store exposes the dual
// Reader+Writer surface needed for failure message persistence.
func shouldUseAgentFailureRepository(ok bool) bool {
	return ok
}

// shouldSkipExistingAgentFailureMessage reports whether a failure agent_message
// already exists for the run and CreateItem should be skipped.
func shouldSkipExistingAgentFailureMessage(exists bool) bool {
	return exists
}

// shouldCheckPersistErrorSource reports whether the store exposes
// LastPersistError and checkPersistError should continue.
func shouldCheckPersistErrorSource(ok bool) bool {
	return ok
}

// shouldSurfaceWithWriter reports whether auto-surface may persist via a
// store.Writer implementation.
func shouldSurfaceWithWriter(ok bool) bool {
	return ok
}

// finishRunMapKeys lists executor map keys cleaned on terminal finish. Pure
// documentation of the finish() cleanup set (no map mutation).
func finishRunMapKeys() []string {
	return []string{
		"running",
		"stdins",
		"processes",
		"runToAgent",
		"hubTasks",
		"hubOutputs",
		"workDirs",
		"surfacers",
		"cancelDone",
		"runOutputs",
	}
}

// finishCleanupPlan is the pure terminal-finish side-effect plan (cascade +
// optional channel/store close). Map deletes stay in the executor.
type finishCleanupPlan struct {
	Cascade         bool
	CloseCancelDone bool
	CloseRunOutput  bool
}

// planFinishCleanup decides cascade shutdown and which optional tracked resources
// need close during terminal finish. Does not rework #867 handoff ownership.
func planFinishCleanup(hasRegistry, hasCancelDone, hasRunOutput bool) finishCleanupPlan {
	return finishCleanupPlan{
		Cascade:         shouldCascadeAgentShutdown(hasRegistry),
		CloseCancelDone: shouldCloseCancelDoneChannel(hasCancelDone),
		CloseRunOutput:  shouldCloseTrackedRunOutput(hasRunOutput),
	}
}

// surfaceArtifactsPlan is the pure auto-surface gate for surfaceRunArtifacts.
type surfaceArtifactsPlan struct {
	Proceed       bool
	SkipWriterLog bool
}

// planSurfaceArtifacts decides whether auto-surface should run and whether to
// log the "store does not implement Writer" skip path.
func planSurfaceArtifacts(snapshot *adapters.WorkdirSnapshot, runFound bool, status string, hasWriter bool) surfaceArtifactsPlan {
	if !shouldSurfaceWithSnapshot(snapshot) {
		return surfaceArtifactsPlan{}
	}
	if !shouldSurfaceRunArtifacts(runFound, status) {
		return surfaceArtifactsPlan{}
	}
	if !shouldSurfaceWithWriter(hasWriter) {
		return surfaceArtifactsPlan{SkipWriterLog: true}
	}
	return surfaceArtifactsPlan{Proceed: true}
}

// finishMetricsRecordPlan is the pure late-finish metrics gate inside the deferred closer.
type finishMetricsRecordPlan struct {
	Record bool
}

// planFinishMetricsRecord decides whether RecordRunFinish should fire after a successful Start.
func planFinishMetricsRecord(runStartTime time.Time, runFound bool) finishMetricsRecordPlan {
	if !shouldRecordRunFinishMetrics(runStartTime) {
		return finishMetricsRecordPlan{}
	}
	if !shouldRecordFinishMetricsForRun(runFound) {
		return finishMetricsRecordPlan{}
	}
	return finishMetricsRecordPlan{Record: true}
}

// publishFailedPlan is the pure publishFailed side-effect plan after a status transition.
type publishFailedPlan struct {
	Publish    bool
	Persist    bool
	Classified *RunError
}

// planPublishFailed maps a SetRunStatusIf result + raw error into publish/persist flags
// and the classified RunError payload. Classify only runs when publishing (same as before).
func planPublishFailed(transitionOK bool, err error) publishFailedPlan {
	if !shouldPublishStatusTransition(transitionOK) {
		return publishFailedPlan{}
	}
	classified := classifyPublishedFailure(err)
	return publishFailedPlan{
		Publish:    true,
		Persist:    shouldPersistClassifiedFailure(classified),
		Classified: classified,
	}
}

// persistAgentFailurePlan is the pure multi-gate plan for persistAgentFailureMessage.
type persistAgentFailurePlan struct {
	Proceed bool
}

// planPersistAgentFailure decides whether CreateItem should run after content trim,
// repository type-assert, and existing-message lookup.
func planPersistAgentFailure(contentOK, repoOK, alreadyExists bool) persistAgentFailurePlan {
	if !shouldPersistAgentFailureContent(contentOK) {
		return persistAgentFailurePlan{}
	}
	if !shouldUseAgentFailureRepository(repoOK) {
		return persistAgentFailurePlan{}
	}
	if shouldSkipExistingAgentFailureMessage(alreadyExists) {
		return persistAgentFailurePlan{}
	}
	return persistAgentFailurePlan{Proceed: true}
}

// persistErrorPlan is the pure checkPersistError emit plan.
type persistErrorPlan struct {
	Emit bool
}

// planPersistError decides whether a LastPersistError should emit run.persistence_error.
// sourceOK gates the store type-assert; persistErr is the looked-up error (nil when absent).
func planPersistError(sourceOK bool, persistErr error) persistErrorPlan {
	if !shouldCheckPersistErrorSource(sourceOK) {
		return persistErrorPlan{}
	}
	return persistErrorPlan{Emit: shouldEmitPersistenceError(persistErr)}
}

// agentFailurePersistLogPlan is the pure CreateItem failure log gate.
type agentFailurePersistLogPlan struct {
	Log bool
}

// planAgentFailurePersistLog maps a CreateItem error into the warn-log flag.
func planAgentFailurePersistLog(err error) agentFailurePersistLogPlan {
	return agentFailurePersistLogPlan{Log: shouldLogAgentFailurePersistError(err)}
}

// persistAgentFailureGatePlan is the pure early gate for content/repo presence
// before ListThreadItems (avoids store scan when content/repo unavailable).
type persistAgentFailureGatePlan struct {
	ScanExists bool
}

// planPersistAgentFailureGate reports whether hasAgentMessageForRun should run.
func planPersistAgentFailureGate(contentOK, repoOK bool) persistAgentFailureGatePlan {
	return persistAgentFailureGatePlan{ScanExists: contentOK && repoOK}
}
