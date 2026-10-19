package lifecycle

import (
	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/hub"
)

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
