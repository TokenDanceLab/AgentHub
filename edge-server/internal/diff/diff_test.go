package diff

import "testing"

func TestIsDiff(t *testing.T) {
	valid := map[string]any{
		"file":      "src/app.ts",
		"patch":     "@@ -1 +1 @@\n-old\n+new\n",
		"additions": float64(1),
		"deletions": float64(1),
		"status":    "modified",
	}
	if !IsDiff(valid) {
		t.Error("expected valid diff")
	}

	invalidMissingFile := map[string]any{
		"patch":     "@@ -1 +1 @@",
		"additions": float64(1),
		"deletions": float64(1),
	}
	if IsDiff(invalidMissingFile) {
		t.Error("expected invalid diff (missing file)")
	}

	invalidBadStatus := map[string]any{
		"file":      "src/app.ts",
		"patch":     "@@ -1 +1 @@",
		"additions": float64(1),
		"deletions": float64(1),
		"status":    "unknown",
	}
	if IsDiff(invalidBadStatus) {
		t.Error("expected invalid diff (bad status)")
	}

	diffWithoutStatus := map[string]any{
		"file":      "src/app.ts",
		"patch":     "@@ -1 +1 @@",
		"additions": float64(1),
		"deletions": float64(1),
	}
	if !IsDiff(diffWithoutStatus) {
		t.Error("expected valid diff (no status)")
	}
}

func TestExtractDiffs(t *testing.T) {
	item := map[string]any{
		"file":      "src/app.ts",
		"patch":     "@@ -1 +1 @@\n-old\n+new\n",
		"additions": float64(1),
		"deletions": float64(1),
		"status":    "modified",
	}

	// Array with all valid diffs
	result := ExtractDiffs([]any{item, item})
	if len(result) != 2 {
		t.Errorf("expected 2 diffs, got %d", len(result))
	}

	// Single diff
	result = ExtractDiffs(item)
	if len(result) != 1 {
		t.Errorf("expected 1 diff, got %d", len(result))
	}

	// Keyed object
	result = ExtractDiffs(map[string]any{"a": item, "b": item})
	if len(result) != 2 {
		t.Errorf("expected 2 diffs from keyed object, got %d", len(result))
	}

	// Array with mixed valid/invalid
	invalid := map[string]any{"file": "bad.ts", "extra": "nope"}
	result = ExtractDiffs([]any{item, invalid})
	if len(result) != 1 {
		t.Errorf("expected 1 diff after filtering, got %d", len(result))
	}

	// Nil
	result = ExtractDiffs(nil)
	if result != nil {
		t.Error("expected nil for nil input")
	}

	// Empty array
	result = ExtractDiffs([]any{})
	if result != nil {
		t.Error("expected nil for empty array")
	}
}

func TestIsObj(t *testing.T) {
	if !IsObj(map[string]any{"key": "value"}) {
		t.Error("expected true for map")
	}
	if IsObj(nil) {
		t.Error("expected false for nil")
	}
	if IsObj([]any{1, 2, 3}) {
		t.Error("expected false for slice")
	}
}
