package im

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/agenthub/hub-server/internal/model"
)

var validContentTypes = map[string]bool{
	"text": true, "code": true, "diff": true, "image": true,
	"file": true, "link_card": true, "deploy_card": true,
}

// IsValidContentType reports whether contentType is an allowed IM content type.
func IsValidContentType(contentType string) bool {
	return validContentTypes[contentType]
}

// NormalizeMessageContent returns the JSONB string persisted for a message.
// #173: every content type is normalized before DB write so PostgreSQL jsonb
// never sees raw, unvalidated client strings.
func NormalizeMessageContent(contentType, content string) (string, error) {
	if contentType == model.ContentTypeText {
		contentBytes, err := json.Marshal(map[string]string{"text": content})
		if err != nil {
			return "", err
		}
		return string(contentBytes), nil
	}

	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(content), &payload); err != nil {
		return "", fmt.Errorf("invalid JSON for content type %s: %w", contentType, err)
	}
	if payload == nil {
		return "", fmt.Errorf("content type %s must be a JSON object", contentType)
	}

	if err := validateContentPayload(contentType, payload); err != nil {
		return "", err
	}

	normalized, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(normalized), nil
}

func validateContentPayload(contentType string, payload map[string]interface{}) error {
	switch contentType {
	case model.ContentTypeCode, model.ContentTypeDiff:
		return requireContentString(payload, "text", contentType)
	case model.ContentTypeFile:
		return requireContentString(payload, "attachment_id", contentType)
	case model.ContentTypeLinkCard:
		return requireContentString(payload, "url", contentType)
	case model.ContentTypeImage:
		if hasContentString(payload, "attachment_id") {
			return nil
		}
		return requireContentString(payload, "url", contentType)
	case model.ContentTypeDeployCard:
		return nil
	}
	return nil
}

func requireContentString(payload map[string]interface{}, field, contentType string) error {
	if hasContentString(payload, field) {
		return nil
	}
	return fmt.Errorf("required field %q must be a non-empty string for content type %s", field, contentType)
}

func hasContentString(payload map[string]interface{}, field string) bool {
	value, exists := payload[field]
	if !exists {
		return false
	}
	s, ok := value.(string)
	return ok && strings.TrimSpace(s) != ""
}

// AttachmentIDsFromContent extracts deduplicated attachment IDs from file/image
// content payloads. Non-file/image content types return (nil, true).
// Invalid UUID values return (nil, false).
func AttachmentIDsFromContent(contentType, content string) ([]string, bool) {
	if contentType != model.ContentTypeFile && contentType != model.ContentTypeImage {
		return nil, true
	}

	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(content), &payload); err != nil {
		return nil, true
	}

	seen := make(map[string]struct{})
	ids := make([]string, 0, 1)
	add := func(value interface{}) bool {
		id, ok := value.(string)
		if !ok {
			return true
		}
		id = strings.TrimSpace(id)
		if id == "" {
			return true
		}
		parsed, err := uuid.Parse(id)
		if err != nil {
			return false
		}
		id = parsed.String()
		if _, exists := seen[id]; exists {
			return true
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
		return true
	}

	if !add(payload["attachment_id"]) {
		return nil, false
	}

	if rawIDs, ok := payload["attachment_ids"].([]interface{}); ok {
		for _, rawID := range rawIDs {
			if !add(rawID) {
				return nil, false
			}
		}
	}

	if rawAttachments, ok := payload["attachments"].([]interface{}); ok {
		for _, rawAttachment := range rawAttachments {
			attachment, ok := rawAttachment.(map[string]interface{})
			if !ok {
				continue
			}
			if !add(attachment["attachment_id"]) {
				return nil, false
			}
			if !add(attachment["id"]) {
				return nil, false
			}
		}
	}

	return ids, true
}
