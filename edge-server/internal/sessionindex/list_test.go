package sessionindex

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestResolvePaths(t *testing.T) {
	claude := ResolveClaudeCodeSessionsDir("/home/u", "")
	if filepath.Base(filepath.Dir(claude)) != ".claude" && filepath.Base(claude) != "projects" {
		// projects under .claude
		if filepath.Base(claude) != "projects" {
			t.Fatalf("unexpected claude path %q", claude)
		}
	}
	if ResolveClaudeCodeSessionsDir("/home/u", "/custom") != filepath.Join("/custom", "projects") {
		t.Fatalf("env override failed")
	}
	if ResolveCodexSessionsDir("/home/u", "/cx") != filepath.Join("/cx", "sessions") {
		t.Fatalf("codex override failed")
	}
}

func TestListRecentFixture(t *testing.T) {
	home := t.TempDir()
	claudeRoot := ResolveClaudeCodeSessionsDir(home, "")
	codexRoot := ResolveCodexSessionsDir(home, "")
	if err := os.MkdirAll(filepath.Join(claudeRoot, "sess-a"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(codexRoot, "sess-b"), 0o755); err != nil {
		t.Fatal(err)
	}
	// bump mtime order
	_ = os.Chtimes(filepath.Join(codexRoot, "sess-b"), time.Now(), time.Now().Add(time.Hour))

	list, err := ListRecent(ListOptions{Home: home, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("want 2 got %d %#v", len(list), list)
	}
	for _, s := range list {
		if s.SourceMode != "import" {
			t.Fatalf("sourceMode %q", s.SourceMode)
		}
	}
}

func TestListRecentMissingRoots(t *testing.T) {
	list, err := ListRecent(ListOptions{Home: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("want empty got %d", len(list))
	}
}
