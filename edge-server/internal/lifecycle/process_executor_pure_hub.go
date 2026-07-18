package lifecycle

import (
	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/hub"
)

// Residual pure-helper peel #1121: domain pure helpers extracted from
// process_executor_pure.go. Same package lifecycle; zero behavior change.

// hubDoneFinalContent returns the TaskDone final content, substituting the
// default finished message when the collector produced nothing.
func hubDoneFinalContent(content string) string {
	if content == "" {
		return "Run finished"
	}
	return content
}

// hubTaskDoneResult builds the Hub TaskDone payload for a finished run.
func hubTaskDoneResult(runID, content string) hub.TaskResult {
	return hub.TaskResult{
		RunID:        runID,
		FinalContent: hubDoneFinalContent(content),
	}
}

// shouldRecordHubTask reports whether a Hub task ID should be tracked for callbacks.
func shouldRecordHubTask(hubTaskID string) bool {
	return hubTaskID != ""
}

// shouldFireHubCallback reports whether a Hub callback may be sent for the task.
func shouldFireHubCallback(hasCallback bool, taskID string) bool {
	return hasCallback && taskID != ""
}

// prepareHubStreamContent sanitizes outbound Hub stream text. The bool is false
// when the content is empty before or after sanitization.
func prepareHubStreamContent(content string) (string, bool) {
	if content == "" {
		return "", false
	}
	content = sanitizeHubStreamText(content)
	if content == "" {
		return "", false
	}
	return content, true
}

// shouldForwardStdoutToHub reports whether stdout text should feed Hub stream
// collectors/callbacks.
func shouldForwardStdoutToHub(stream, text string) bool {
	return stream == "stdout" && text != ""
}

// hubCallbackSideEffect classifies how a structured bus event should feed Hub
// callback collectors (stream vs final fallback).
type hubCallbackSideEffect int

const (
	hubCallbackNone hubCallbackSideEffect = iota
	hubCallbackStream
	hubCallbackFallback
)

// classifyHubCallbackEvent maps adapter bus event types to hub side effects.
func classifyHubCallbackEvent(eventType string) hubCallbackSideEffect {
	switch eventType {
	case adapters.BusEventTextDelta, adapters.BusEventTextBlock:
		return hubCallbackStream
	case adapters.BusEventResult:
		return hubCallbackFallback
	default:
		return hubCallbackNone
	}
}

// hubCallbackTextForEvent extracts text and the hub side-effect for an event.
func hubCallbackTextForEvent(eventType string, payload any) (string, hubCallbackSideEffect) {
	effect := classifyHubCallbackEvent(eventType)
	if effect == hubCallbackNone {
		return "", hubCallbackNone
	}
	return extractHubCallbackText(payload), effect
}

// shouldWrapHubCallbackEmitter reports whether a hub callback emitter wrapper
// can be constructed around the inner emitter.
func shouldWrapHubCallbackEmitter(hasExecutor, hasInner bool) bool {
	return hasExecutor && hasInner
}

// shouldHaveHubOutputCollector reports whether a hub output collector exists for
// the run (used by record/final helpers).
func shouldHaveHubOutputCollector(hasCollector bool) bool {
	return hasCollector
}

// shouldLogHubCallbackFailure reports whether a Hub callback transport error
// should be warned (callbacks never block lifecycle).
func shouldLogHubCallbackFailure(err error) bool {
	return err != nil
}

// shouldApplyHubCallbackSideEffect reports whether hubCallbackEmitter should
// forward extracted text into stream/fallback collectors.
func shouldApplyHubCallbackSideEffect(text string, effect hubCallbackSideEffect) bool {
	return text != "" && effect != hubCallbackNone
}

// isHubCallbackStreamEffect reports whether the side-effect is live stream text.
func isHubCallbackStreamEffect(effect hubCallbackSideEffect) bool {
	return effect == hubCallbackStream
}

// isHubCallbackFallbackEffect reports whether the side-effect is final fallback text.
func isHubCallbackFallbackEffect(effect hubCallbackSideEffect) bool {
	return effect == hubCallbackFallback
}

// hubTaskRecordPlan is the pure Hub task-ID recording gate for run().
type hubTaskRecordPlan struct {
	Record bool
}

// planHubTaskRecord reports whether a non-empty Hub task ID should be stored.
// Does not allocate hubOutputs collectors (#987 owns that residual).
func planHubTaskRecord(hubTaskID string) hubTaskRecordPlan {
	return hubTaskRecordPlan{Record: shouldRecordHubTask(hubTaskID)}
}
