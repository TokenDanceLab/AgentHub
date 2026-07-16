package agentevent

import (
	"encoding/json"
	"strings"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// NormalizeRunEventInput validates and normalizes an edge stream callback into
// event type, payload JSON, and projected message content.
func NormalizeRunEventInput(stream model.AgentRunEventInput) (eventType, payload, messageContent string, err error) {
	eventType = strings.TrimSpace(stream.EventType)
	content := strings.TrimSpace(stream.Content)

	if len(stream.Payload) > 0 {
		if !json.Valid(stream.Payload) {
			return "", "", "", errcode.ErrBadRequest
		}
		payload = string(stream.Payload)
	} else if content != "" {
		if json.Valid([]byte(content)) {
			payload = content
		} else {
			wrapped, marshalErr := json.Marshal(map[string]string{"content": stream.Content})
			if marshalErr != nil {
				return "", "", "", marshalErr
			}
			payload = string(wrapped)
		}
	} else {
		return "", "", "", errcode.ErrBadRequest
	}
	if err := ValidateAgentCallbackPayloadSize(payload); err != nil {
		return "", "", "", err
	}

	if eventType == "" {
		eventType = InferRunEventType(payload)
	}
	if eventType == "" {
		eventType = model.RunEventTypeOutputBatch
	}
	if err := ValidateRunEventType(eventType); err != nil {
		return "", "", "", err
	}

	messageContent = content
	if messageContent == "" {
		messageContent = payload
	}
	if !json.Valid([]byte(messageContent)) {
		wrapped, marshalErr := json.Marshal(map[string]string{"content": messageContent})
		if marshalErr != nil {
			return "", "", "", marshalErr
		}
		messageContent = string(wrapped)
	}
	if err := ValidateAgentCallbackPayloadSize(messageContent); err != nil {
		return "", "", "", err
	}

	return eventType, payload, messageContent, nil
}

// ValidateAgentCallbackPayloadSize enforces the max callback payload size.
func ValidateAgentCallbackPayloadSize(value string) error {
	if len(value) > model.RunEventPayloadMaxBytes {
		return errcode.ErrBadRequest.WithMessage("agent callback payload exceeds maximum size")
	}
	return nil
}

// ValidateAgentCallbackEdgeRunID enforces the max edge run id length.
func ValidateAgentCallbackEdgeRunID(edgeRunID string) error {
	if len(edgeRunID) > model.AgentCallbackEdgeRunIDMaxLength {
		return errcode.ErrBadRequest.WithMessage("agent callback run id exceeds maximum length")
	}
	return nil
}

// ValidateRunEventType enforces allowed characters and max length for event types.
func ValidateRunEventType(eventType string) error {
	if eventType == "" || len(eventType) > model.RunEventTypeMaxLength {
		return errcode.ErrBadRequest
	}
	for _, r := range eventType {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '.', r == '_', r == '-':
		default:
			return errcode.ErrBadRequest
		}
	}
	return nil
}

// InferRunEventType extracts event_type/type from a JSON payload when present.
func InferRunEventType(payload string) string {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(payload), &fields); err != nil {
		return ""
	}
	for _, key := range []string{"event_type", "type"} {
		if raw, ok := fields[key]; ok {
			var value string
			if err := json.Unmarshal(raw, &value); err == nil {
				return strings.TrimSpace(value)
			}
		}
	}
	return ""
}
