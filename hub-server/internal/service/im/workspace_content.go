package im

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/agenthub/hub-server/internal/model"
)

// NormalizeWorkspaceThreadMessageContent normalizes thread message content for
// workspace project threads. Text may arrive as a raw string or a structured
// JSON object with a non-empty "text" field (optional "metadata" object).
// Non-text content types reuse NormalizeMessageContent.
func NormalizeWorkspaceThreadMessageContent(contentType, content string) (string, error) {
	if contentType != model.ContentTypeText {
		return NormalizeMessageContent(contentType, content)
	}
	if normalized, ok, err := normalizeStructuredTextContent(content); ok || err != nil {
		return normalized, err
	}
	normalized, err := json.Marshal(map[string]string{"text": content})
	if err != nil {
		return "", err
	}
	return string(normalized), nil
}

// normalizeStructuredTextContent attempts to treat content as a structured
// text JSON object. Returns (normalized, true, nil) when content is valid
// structured text; (..., true, err) when it looks structured but is invalid;
// ("", false, nil) when content is not structured JSON (caller should wrap raw text).
func normalizeStructuredTextContent(content string) (string, bool, error) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(content), &payload); err != nil {
		return "", false, nil
	}
	text, ok := payload["text"].(string)
	if !ok || strings.TrimSpace(text) == "" {
		return "", true, fmt.Errorf("structured text content requires non-empty text")
	}
	if metadata, exists := payload["metadata"]; exists {
		if _, ok := metadata.(map[string]any); !ok {
			return "", true, fmt.Errorf("structured text metadata must be an object")
		}
	}
	normalized, err := json.Marshal(payload)
	return string(normalized), true, err
}
