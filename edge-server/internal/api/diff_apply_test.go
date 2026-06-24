package api

import (
	"net/http"
	"strings"
	"testing"
)

func TestParseRangeSpec(t *testing.T) {
	tests := []struct {
		name  string
		spec  string
		start int
		count int
	}{
		{"simple", "-5,10", 5, 10},
		{"single", "-3,1", 3, 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			start, count := parseRangeSpec(tt.spec)
			if start != tt.start || count != tt.count {
				t.Errorf("parseRangeSpec(%q) = (%d,%d), want (%d,%d)", tt.spec, start, count, tt.start, tt.count)
			}
		})
	}
}

func TestParseHunkHeader(t *testing.T) {
	oldStart, oldLines, newStart, newLines := parseHunkHeader("@@ -5,10 +3,8 @@")
	if oldStart != 5 || oldLines != 10 || newStart != 3 || newLines != 8 {
		t.Errorf("got (%d,%d,%d,%d)", oldStart, oldLines, newStart, newLines)
	}
}

func TestParseHunks(t *testing.T) {
	patch := "@@ -1,3 +1,4 @@\n line1\n-line2\n+line2new\n+line3new\n line4\n@@ -10,2 +11,1 @@\n-line10\n+line10new"
	hunks := parseHunks(patch)
	if len(hunks) != 2 {
		t.Fatalf("got %d hunks, want 2", len(hunks))
	}
}

func TestApplyHunkToContent_Remove(t *testing.T) {
	original := "line1\nline2\nline3\n"
	hunk := unifiedHunk{
		oldStart: 2, oldLines: 1,
		newStart: 2, newLines: 0,
		lines: []diffLine{{lineType: '-', content: "line2"}},
	}
	result := applyHunkToContent(original, hunk)
	if strings.Count(result, "\n") == 3 {
		t.Errorf("expected line removed, got %q", result)
	}
}

func TestApplyHunkToContent_Add(t *testing.T) {
	original := "line1\nline3\n"
	hunk := unifiedHunk{
		oldStart: 1, oldLines: 1,
		newStart: 1, newLines: 2,
		lines: []diffLine{
			{lineType: ' ', content: "line1"},
			{lineType: '+', content: "line2"},
		},
	}
	result := applyHunkToContent(original, hunk)
	if !strings.Contains(result, "line2") {
		t.Errorf("expected line2 added, got %q", result)
	}
}

func TestApplyHunkToContent_Replace(t *testing.T) {
	original := "line1\nline2\nline3\n"
	hunk := unifiedHunk{
		oldStart: 2, oldLines: 1,
		newStart: 2, newLines: 1,
		lines: []diffLine{
			{lineType: '-', content: "line2"},
			{lineType: '+', content: "line2new"},
		},
	}
	result := applyHunkToContent(original, hunk)
	if strings.Contains(result, "line2\n") && !strings.Contains(result, "line2new") {
		t.Errorf("expected line2->line2new, got %q", result)
	}
}

func TestDecodeApplyJSON(t *testing.T) {
	body := `{"file_path":"test.go","hunk_index":0,"accepted":true}`
	r, _ := http.NewRequest("POST", "/", strings.NewReader(body))
	var req applyRequest
	err := decodeApplyJSON(r, &req)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if req.FilePath != "test.go" {
		t.Errorf("FilePath = %q, want test.go", req.FilePath)
	}
}
