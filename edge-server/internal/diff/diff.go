// Package diff provides pure functions for extracting and validating file diffs
// from structured message data, ported from OpenCode's app/src/utils/diffs.ts.
//
// The core logic is a 50-line TypeScript module that handles three input shapes:
//   - A single Diff object
//   - An array of Diff objects (with filtering for validity)
//   - A keyed object whose values are Diff objects
package diff

// Diff represents a file change with its patch content.
type Diff struct {
	File      string `json:"file"`
	Patch     string `json:"patch"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Status    string `json:"status,omitempty"` // "added" | "deleted" | "modified"
}

// IsDiff returns true if the value is a valid Diff object.
// It validates that all required fields exist and that status (if present) is valid.
func IsDiff(value any) bool {
	m, ok := value.(map[string]any)
	if !ok {
		return false
	}
	file, ok := m["file"].(string)
	if !ok {
		return false
	}
	_ = file
	patch, ok := m["patch"].(string)
	if !ok {
		return false
	}
	_ = patch
	additions, ok := m["additions"].(float64)
	if !ok {
		return false
	}
	_ = additions
	deletions, ok := m["deletions"].(float64)
	if !ok {
		return false
	}
	_ = deletions
	status, hasStatus := m["status"]
	if !hasStatus || status == nil {
		return true
	}
	s, ok := status.(string)
	if !ok {
		return false
	}
	return s == "added" || s == "deleted" || s == "modified"
}

// castDiff converts a map to a Diff struct. Callers must validate with IsDiff first.
func castDiff(m map[string]any) Diff {
	additions, _ := m["additions"].(float64)
	deletions, _ := m["deletions"].(float64)
	status, _ := m["status"].(string)
	return Diff{
		File:      m["file"].(string),
		Patch:     m["patch"].(string),
		Additions: int(additions),
		Deletions: int(deletions),
		Status:    status,
	}
}

// ExtractDiffs extracts a []Diff from various input shapes, matching the
// OpenCode diffs() function behavior:
//   - nil/empty        -> nil
//   - []Diff           -> filtered to valid
//   - single Diff      -> wrapped in []Diff
//   - keyed object     -> values filtered to valid
func ExtractDiffs(value any) []Diff {
	if value == nil {
		return nil
	}

	switch v := value.(type) {
	case []any:
		if len(v) == 0 {
			return nil
		}
		// Check if every element is a valid diff
		all := true
		for _, item := range v {
			if !IsDiff(item) {
				all = false
				break
			}
		}
		if all {
			result := make([]Diff, 0, len(v))
			for _, item := range v {
				result = append(result, castDiff(item.(map[string]any)))
			}
			return result
		}
		// Filter to valid diffs only
		var result []Diff
		for _, item := range v {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if IsDiff(m) {
				result = append(result, castDiff(m))
			}
		}
		return result
	case map[string]any:
		if IsDiff(v) {
			return []Diff{castDiff(v)}
		}
		// Keyed object: extract values that are diffs
		var result []Diff
		for _, val := range v {
			m, ok := val.(map[string]any)
			if !ok {
				continue
			}
			if IsDiff(m) {
				result = append(result, castDiff(m))
			}
		}
		return result
	default:
		return nil
	}
}

// IsObj returns true if value is a non-nil, non-array object.
func IsObj(value any) bool {
	if value == nil {
		return false
	}
	_, ok := value.(map[string]any)
	return ok
}
