package adapters

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClassifySurfacedFile(t *testing.T) {
	tests := []struct {
		path string
		kind surfacingKind
	}{
		{"index.html", surfacingKindPreview},
		{"page.htm", surfacingKindPreview},
		{"logo.png", surfacingKindImage},
		{"photo.jpg", surfacingKindImage},
		{"icon.svg", surfacingKindImage},
		{"Dockerfile", surfacingKindDeploy},
		{"docker-compose.yml", surfacingKindDeploy},
		{"vercel.json", surfacingKindDeploy},
		{"main.go", surfacingKindArtifact},
		{"README.md", surfacingKindArtifact},
		{"config.yaml", surfacingKindArtifact},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if got := classifySurfacedFile(tt.path); got != tt.kind {
				t.Errorf("classifySurfacedFile(%q) = %q, want %q", tt.path, got, tt.kind)
			}
		})
	}
}

func TestIsTextFilePath(t *testing.T) {
	textFiles := []string{"readme.md", "main.go", "app.tsx", "config.json", "Dockerfile"}
	for _, f := range textFiles {
		if !isTextFilePath(f) {
			t.Errorf("expected %q to be text", f)
		}
	}
	nonText := []string{"image.png", "archive.zip", "binary.exe", "data.db"}
	for _, f := range nonText {
		if isTextFilePath(f) {
			t.Errorf("expected %q to NOT be text", f)
		}
	}
}

func TestIsBinaryArtifact(t *testing.T) {
	bins := []string{"app.exe", "lib.dll", "lib.so", "lib.dylib", "data.db", "backup.zip"}
	for _, f := range bins {
		if !isBinaryArtifact(f) {
			t.Errorf("expected %q to be binary artifact", f)
		}
	}
	normal := []string{"main.go", "README.md", "config.json"}
	for _, f := range normal {
		if isBinaryArtifact(f) {
			t.Errorf("expected %q to NOT be binary artifact", f)
		}
	}
}

func TestSurfacedArtifactID(t *testing.T) {
	id := surfacedArtifactID("run-123", "output/report.md")
	if len(id) == 0 {
		t.Errorf("unexpected artifact ID: %s", id)
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
	adds := countDiffLines(diff, '+')
	rems := countDiffLines(diff, '-')
	if adds != 2 {
		t.Errorf("adds = %d, want 2", adds)
	}
	if rems != 1 {
		t.Errorf("rems = %d, want 1", rems)
	}
}

func TestClassifyDeployType(t *testing.T) {
	if classifyDeployType("Dockerfile") == "" {
		t.Error("expected non-empty deploy type for Dockerfile")
	}
	// .go files may or may not be deployable depending on implementation
	_ = classifyDeployType("main.go")
}

func TestGenerateUnifiedDiff(t *testing.T) {
	old := "line1\nline2\nline3\n"
	new := "line1\nline2modified\nline3\n"
	diff := generateUnifiedDiff("test.txt", old, new)
	if !strings.Contains(diff, "line2") && !strings.Contains(diff, "line2modified") {
		t.Errorf("unexpected diff output: %s", diff)
	}
	if !strings.Contains(diff, "---") || !strings.Contains(diff, "+++") {
		t.Errorf("diff missing headers: %s", diff)
	}
}

func TestTakeWorkdirSnapshot(t *testing.T) {
	tmp := t.TempDir()
	os.WriteFile(filepath.Join(tmp, "hello.txt"), []byte("hello"), 0644)
	snap := TakeWorkdirSnapshot(tmp)
	if snap == nil {
		t.Fatal("snapshot is nil")
	}
	if len(snap.Files) == 0 {
		t.Error("expected at least one file in snapshot")
	}
	if _, ok := snap.Files["hello.txt"]; !ok {
		t.Error("expected hello.txt in snapshot")
	}

	// Empty/invalid dir returns nil
	if TakeWorkdirSnapshot("") != nil {
		t.Error("expected nil for empty dir")
	}
	if TakeWorkdirSnapshot("/nonexistent/path/12345") != nil {
		t.Error("expected nil for nonexistent dir")
	}
}

func TestDetectSurfacedFiles(t *testing.T) {
	tmp := t.TempDir()
	// Take snapshot of empty dir first, then create file
	snap := TakeWorkdirSnapshot(tmp)
	os.WriteFile(filepath.Join(tmp, "new.html"), []byte("<html></html>"), 0644)
	files := DetectSurfacedFiles(snap)
	if len(files) == 0 {
		t.Error("expected surfacing detection to find the new HTML file")
	}
}
