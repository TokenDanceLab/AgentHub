package adapters

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Behavioral tests for surfacing — verify real I/O and transformations,
// not implementation mirrors.

func TestSurfacedArtifactID(t *testing.T) {
	id := surfacedArtifactID("run-123", "output/report.md")
	if len(id) == 0 {
		t.Errorf("expected non-empty artifact ID")
	}
}

func TestSplitLines(t *testing.T) {
	lines := splitLines("a\nb\nc")
	if len(lines) != 3 || lines[0] != "a" || lines[1] != "b" || lines[2] != "c" {
		t.Errorf("splitLines failed: %v", lines)
	}
	empty := splitLines("")
	if len(empty) != 0 {
		t.Errorf("splitLines empty should be empty slice, got: %v", empty)
	}
}

func TestCommonPrefixLen(t *testing.T) {
	a := []string{"a", "b", "c", "d"}
	b := []string{"a", "b", "x", "y"}
	if n := commonPrefixLen(a, b); n != 2 {
		t.Errorf("commonPrefixLen = %d, want 2", n)
	}
	if n := commonPrefixLen(a, []string{}); n != 0 {
		t.Errorf("commonPrefixLen with empty = %d, want 0", n)
	}
}

func TestCommonSuffixLen(t *testing.T) {
	a := []string{"x", "b", "c"}
	b := []string{"y", "b", "c"}
	if n := commonSuffixLen(a, b); n != 2 {
		t.Errorf("commonSuffixLen = %d, want 2", n)
	}
}

func TestCountDiffLines(t *testing.T) {
	diff := "+added line\n-removed line\n context line\n+another add"
	if n := countDiffLines(diff, '+'); n != 2 {
		t.Errorf("adds = %d, want 2", n)
	}
	if n := countDiffLines(diff, '-'); n != 1 {
		t.Errorf("rems = %d, want 1", n)
	}
}

func TestGenerateUnifiedDiff(t *testing.T) {
	old := "line1\nline2\nline3\n"
	new := "line1\nline2modified\nline3\n"
	diff := generateUnifiedDiff("test.txt", old, new)
	if !strings.Contains(diff, "---") || !strings.Contains(diff, "+++") {
		t.Errorf("diff missing headers: %s", diff)
	}
	if !strings.Contains(diff, "line2") && !strings.Contains(diff, "line2modified") {
		t.Errorf("unexpected diff output: %s", diff)
	}
}

func TestTakeWorkdirSnapshot(t *testing.T) {
	tmp := t.TempDir()
	os.WriteFile(filepath.Join(tmp, "hello.txt"), []byte("hello"), 0644)
	snap := TakeWorkdirSnapshot(tmp)
	if snap == nil {
		t.Fatal("snapshot is nil")
	}
	if _, ok := snap.Files["hello.txt"]; !ok {
		t.Error("expected hello.txt in snapshot")
	}
	if TakeWorkdirSnapshot("") != nil {
		t.Error("expected nil for empty dir")
	}
	if TakeWorkdirSnapshot("/nonexistent/path/12345") != nil {
		t.Error("expected nil for nonexistent dir")
	}
}

func TestDetectSurfacedFiles(t *testing.T) {
	tmp := t.TempDir()
	snap := TakeWorkdirSnapshot(tmp)
	os.WriteFile(filepath.Join(tmp, "new.html"), []byte("<html></html>"), 0644)
	files := DetectSurfacedFiles(snap)
	if len(files) == 0 {
		t.Error("expected surfacing detection to find the new HTML file")
	}
}
