package dispatch

import (
	"encoding/json"
	"math"
	"strings"
)

// parseModelParams parses the Hub payload's model_params JSON string. Invalid
// or non-object input is treated as absent, matching the Desktop bridge's
// parseRecord fallback and ensuring no runtime/default fields are invented.
func parseModelParams(raw string) map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil || parsed == nil {
		return nil
	}
	return parsed
}

// firstStringValue mirrors the Desktop getFirstString alias precedence: the
// first non-blank string wins and blank values fall through.
func firstStringValue(values ...any) string {
	for _, value := range values {
		if s, ok := value.(string); ok && strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

// firstBoolValue preserves explicit false values through a pointer, so false is
// not silently dropped by omitempty JSON encoding.
func firstBoolValue(values ...any) *bool {
	for _, value := range values {
		if b, ok := value.(bool); ok {
			return &b
		}
	}
	return nil
}

// firstIntValue preserves explicit zero values through a pointer. JSON numbers
// arrive as float64; use the same safe-integer range as the JavaScript mapper.
func firstIntValue(values ...any) *int {
	for _, value := range values {
		switch n := value.(type) {
		case float64:
			if n == math.Trunc(n) && math.Abs(n) <= 9007199254740991 {
				i := int(n)
				return &i
			}
		case int:
			if int64(n) >= -9007199254740991 && int64(n) <= 9007199254740991 {
				i := n
				return &i
			}
		}
	}
	return nil
}

// firstStringArrayValue returns the first non-empty, all-string filtered array.
// Invalid JSON, empty arrays and arrays containing no valid strings fall through
// to the next alias exactly like the Desktop parseStringArray accessor.
func firstStringArrayValue(values ...any) []string {
	for _, value := range values {
		if parsed := parseStringArrayValue(value); parsed != nil {
			return parsed
		}
	}
	return nil
}

func parseStringArrayValue(value any) []string {
	var source any = value
	if s, ok := value.(string); ok {
		var parsed []any
		if err := json.Unmarshal([]byte(s), &parsed); err != nil {
			return nil
		}
		source = parsed
	}
	items, ok := source.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
			result = append(result, s)
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

// firstStringRecordValue returns the first non-empty map containing string
// values. Non-string and invalid values do not broaden Edge permissions or
// inject runtime configuration.
func firstStringRecordValue(values ...any) map[string]string {
	for _, value := range values {
		if parsed := parseStringRecordValue(value); parsed != nil {
			return parsed
		}
	}
	return nil
}

func parseStringRecordValue(value any) map[string]string {
	var record map[string]any
	switch typed := value.(type) {
	case map[string]any:
		record = typed
	case string:
		if err := json.Unmarshal([]byte(typed), &record); err != nil || record == nil {
			return nil
		}
	default:
		return nil
	}
	if len(record) == 0 {
		return nil
	}
	result := make(map[string]string, len(record))
	for key, item := range record {
		if s, ok := item.(string); ok {
			result[key] = s
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

// firstSchemaString returns the first schema value after converting both JSON
// strings and raw JSON objects/arrays to a string. Empty/null values fall
// through so absent schema never invents a default.
func firstSchemaString(values ...any) string {
	for _, value := range values {
		if s := schemaStringValue(value); s != "" {
			return s
		}
	}
	return ""
}

func schemaStringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case json.RawMessage:
		var raw any
		if json.Unmarshal(typed, &raw) == nil && raw == nil {
			return ""
		}
		var encoded string
		if json.Unmarshal(typed, &encoded) == nil {
			return strings.TrimSpace(encoded)
		}
		if json.Valid(typed) {
			return strings.TrimSpace(string(typed))
		}
	default:
		encoded, err := json.Marshal(value)
		if err == nil && json.Valid(encoded) {
			return string(encoded)
		}
	}
	return ""
}

// RequiresDesktopTeamRouting keeps team orchestration on the existing Desktop
// bridge. Edge typed stream events are observational; they do not invoke the
// authoritative team route-decision endpoint.
func RequiresDesktopTeamRouting(payload Payload) bool {
	if payload.TeamID != "" || payload.TeamRunID != "" {
		return true
	}
	params := parseModelParams(payload.ModelParams)
	var team map[string]any
	switch value := params["agenthub_team_context"].(type) {
	case map[string]any:
		team = value
	case string:
		team = parseModelParams(value)
	}
	return firstStringValue(team["team_id"], team["teamId"], team["team_run_id"], team["teamRunId"]) != ""
}
