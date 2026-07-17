package im

import (
	"encoding/json"
	"fmt"
	"strings"
)

// NormalizeAttachmentMetadataJSON normalizes attachment metadata JSON to a
// compact object string. Empty input becomes "{}".
func NormalizeAttachmentMetadataJSON(metadata string) (string, error) {
	metadata = strings.TrimSpace(metadata)
	if metadata == "" {
		return "{}", nil
	}

	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(metadata), &payload); err != nil {
		return "", fmt.Errorf("metadata must be valid JSON: %w", err)
	}
	if payload == nil {
		return "", fmt.Errorf("metadata must be a JSON object")
	}

	normalized, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(normalized), nil
}

// IsValidAttachmentHash reports whether hash is a lowercase 64-char hex SHA-256.
func IsValidAttachmentHash(hash string) bool {
	if len(hash) != 64 {
		return false
	}
	if strings.ToLower(hash) != hash {
		return false
	}
	for _, r := range hash {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

// PathFromHash returns the object-store key for a valid attachment hash, or "".
// Layout: uploads/<aa>/<bb>/<full-hash>.
func PathFromHash(hash string) string {
	if !IsValidAttachmentHash(hash) {
		return ""
	}
	return fmt.Sprintf("uploads/%s/%s/%s", hash[:2], hash[2:4], hash)
}
