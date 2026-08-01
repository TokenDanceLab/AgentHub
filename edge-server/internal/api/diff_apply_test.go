package api

import (
	"net/http"
	"os"
	"path/filepath"
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

// Empty-patch behavior is already covered by TestParseHunks_EmptyPatch in
// handler_behavior_test.go.

func TestParseHunks_HeaderOnly(t *testing.T) {
	hunks := parseHunks("@@ -1,1 +1,1 @@")
	if len(hunks) != 1 {
		t.Fatalf("got %d hunks, want 1", len(hunks))
	}
	h := hunks[0]
	if h.oldStart != 1 || h.oldLines != 1 || h.newStart != 1 || h.newLines != 1 {
		t.Errorf("header parse = (%d,%d,%d,%d), want (1,1,1,1)", h.oldStart, h.oldLines, h.newStart, h.newLines)
	}
	if len(h.lines) != 0 {
		t.Errorf("got %d lines, want 0", len(h.lines))
	}
}

func TestParseHunks_SkipsDiffHeaderLines(t *testing.T) {
	patch := "diff --git a/main.go b/main.go\n" +
		"index 1234..abcd 100644\n" +
		"--- a/main.go\n" +
		"+++ b/main.go\n" +
		"@@ -1,2 +1,3 @@\n" +
		" line1\n" +
		"\\ No newline at end of file\n" +
		"+added"
	hunks := parseHunks(patch)
	if len(hunks) != 1 {
		t.Fatalf("got %d hunks, want 1", len(hunks))
	}
	if len(hunks[0].lines) != 2 {
		t.Fatalf("got %d hunk lines, want 2 (diff/index/---/+++/\\\\ header lines skipped)", len(hunks[0].lines))
	}
	if hunks[0].lines[0].lineType != ' ' || hunks[0].lines[0].content != "line1" {
		t.Errorf("line 0 = (%q, %q), want (' ', line1)", hunks[0].lines[0].lineType, hunks[0].lines[0].content)
	}
	if hunks[0].lines[1].lineType != '+' || hunks[0].lines[1].content != "added" {
		t.Errorf("line 1 = (%q, %q), want ('+', added)", hunks[0].lines[1].lineType, hunks[0].lines[1].content)
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

func TestApplyHunkToContent_EmptyHunkReturnsOriginal(t *testing.T) {
	original := "line1\nline2\n"
	hunk := unifiedHunk{
		oldStart: 1, oldLines: 0,
		newStart: 1, newLines: 0,
	}
	result := applyHunkToContent(original, hunk)
	if result != original {
		t.Errorf("empty hunk changed content: got %q, want %q", result, original)
	}
}

func TestApplyHunkToContent_OldStartOutOfRange(t *testing.T) {
	original := "a\nb\nc\n"
	hunk := unifiedHunk{
		oldStart: 100, oldLines: 1, // beyond len(origLines)
		newStart: 1, newLines: 1,
		lines: []diffLine{{lineType: '+', content: "added"}},
	}
	// Must not panic. All original lines are kept, addition appended at end.
	result := applyHunkToContent(original, hunk)
	if !strings.HasPrefix(result, original) {
		t.Errorf("original lines not preserved: got %q", result)
	}
	if !strings.HasSuffix(result, "added\n") {
		t.Errorf("expected appended 'added' line, got %q", result)
	}
}

func TestApplyHunkToContent_NoTrailingNewline(t *testing.T) {
	// Original content does not end with a newline.
	original := "line1\nline2"
	hunk := unifiedHunk{
		oldStart: 2, oldLines: 1,
		newStart: 2, newLines: 1,
		lines: []diffLine{
			{lineType: '-', content: "line2"},
			{lineType: '+', content: "line2new"},
		},
	}
	result := applyHunkToContent(original, hunk)
	if want := "line1\nline2new\n"; result != want {
		t.Errorf("got %q, want %q", result, want)
	}
}

func TestApplyHunkToContent_NoTrailingNewlineContextOnly(t *testing.T) {
	original := "line1\nline2"
	hunk := unifiedHunk{
		oldStart: 1, oldLines: 2,
		newStart: 1, newLines: 2,
		lines: []diffLine{{lineType: ' ', content: "line1"}},
	}
	result := applyHunkToContent(original, hunk)
	if result != "line1\nline2" {
		t.Errorf("context-only hunk on no-trailing-newline file: got %q, want %q", result, "line1\nline2")
	}
}

// ---------------------------------------------------------------------------
// createNewFileFromHunk
// ---------------------------------------------------------------------------

func TestCreateNewFileFromHunk_CreatesFileWithAddedLines(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "new", "sub", "file.txt") // parent dirs do not exist
	h := &Handler{}
	hunk := unifiedHunk{
		oldStart: 0, oldLines: 0,
		newStart: 1, newLines: 2,
		lines: []diffLine{
			{lineType: '+', content: "line one"}, // no trailing newline -> appended
			{lineType: '+', content: "line two\n"},
		},
	}
	if err := h.createNewFileFromHunk(target, hunk); err != nil {
		t.Fatalf("createNewFileFromHunk: %v", err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read created file: %v", err)
	}
	if want := "line one\nline two\n"; string(got) != want {
		t.Errorf("created content = %q, want %q", got, want)
	}
}

func TestCreateNewFileFromHunk_NoAddedLinesErrors(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "out.txt")
	h := &Handler{}
	hunk := unifiedHunk{
		oldStart: 1, oldLines: 1,
		newStart: 1, newLines: 0,
		lines: []diffLine{{lineType: '-', content: "x"}},
	}
	err := h.createNewFileFromHunk(target, hunk)
	if err == nil {
		t.Fatal("expected error for hunk with no added lines")
	}
	if !strings.Contains(err.Error(), "hunk has no added lines") {
		t.Errorf("error = %q, want mention of no added lines", err.Error())
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Errorf("file should not have been created on error (stat err = %v)", statErr)
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
