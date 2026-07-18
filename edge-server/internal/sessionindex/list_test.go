package sessionindex

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestResolvePaths(t *testing.T) {
	claude := ResolveClaudeCodeSessionsDir("/home/u", "")
	if filepath.Base(claude) != "projects" {
		t.Fatalf("unexpected claude path %q", claude)
	}
	if filepath.Base(filepath.Dir(claude)) != ".claude" {
		t.Fatalf("expected .claude parent, got %q", claude)
	}
	if got := ResolveClaudeCodeSessionsDir("/home/u", "/custom"); got != filepath.Join("/custom", "projects") {
		t.Fatalf("env override failed: %q", got)
	}
	if got := ResolveCodexSessionsDir("/home/u", "/cx"); got != filepath.Join("/cx", "sessions") {
		t.Fatalf("codex override failed: %q", got)
	}
	if got := ResolveClaudeCodeHistoryPath("/home/u", ""); filepath.Base(got) != "history.jsonl" {
		t.Fatalf("history path %q", got)
	}
	if got := ResolveCodexSessionIndexPath("/home/u", ""); filepath.Base(got) != "session_index.jsonl" {
		t.Fatalf("index path %q", got)
	}
	if ResolveClaudeCodeSessionsDir("", "") != "" {
		t.Fatalf("empty home should yield empty path")
	}
}

func TestListRecentClaudeAndCodexFixtures(t *testing.T) {
	home := t.TempDir()
	claudeProjects := ResolveClaudeCodeSessionsDir(home, "")
	codexSessions := ResolveCodexSessionsDir(home, "")
	claudeHistory := ResolveClaudeCodeHistoryPath(home, "")
	codexIndex := ResolveCodexSessionIndexPath(home, "")

	// Claude: projects/<slug>/<session>.jsonl
	sessA := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	sessB := "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee"
	projDir := filepath.Join(claudeProjects, "D--Code-TokenDance")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// nested noise must be ignored
	if err := os.MkdirAll(filepath.Join(projDir, sessA, "subagents"), 0o755); err != nil {
		t.Fatal(err)
	}
	pathA := filepath.Join(projDir, sessA+".jsonl")
	pathB := filepath.Join(projDir, sessB+".jsonl")
	if err := os.WriteFile(pathA, []byte("{\"type\":\"user\"}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pathB, []byte("{\"type\":\"user\"}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// history for title on sessA
	if err := os.MkdirAll(filepath.Dir(claudeHistory), 0o755); err != nil {
		t.Fatal(err)
	}
	hist := `{"display":"Wire local session index","pastedContents":{},"timestamp":1,"project":"D:\\Code","sessionId":"` + sessA + `"}` + "\n"
	if err := os.WriteFile(claudeHistory, []byte(hist), 0o644); err != nil {
		t.Fatal(err)
	}

	// Codex: sessions/YYYY/MM/DD/rollout-...jsonl
	codexID := "019f6406-c61e-7421-bb97-74e9db7342dd"
	dayDir := filepath.Join(codexSessions, "2026", "07", "15")
	if err := os.MkdirAll(dayDir, 0o755); err != nil {
		t.Fatal(err)
	}
	codexFile := filepath.Join(dayDir, "rollout-2026-07-15T12-26-33-"+codexID+".jsonl")
	if err := os.WriteFile(codexFile, []byte("{\"type\":\"session_meta\"}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(codexIndex), 0o755); err != nil {
		t.Fatal(err)
	}
	idx := `{"id":"` + codexID + `","thread_name":"Import billing check","updated_at":"2026-07-16T10:00:00Z"}` + "\n"
	if err := os.WriteFile(codexIndex, []byte(idx), 0o644); err != nil {
		t.Fatal(err)
	}

	// Order: bump file mtimes; codex index updated_at should still rank high.
	old := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	_ = os.Chtimes(pathA, old, old)
	_ = os.Chtimes(pathB, old.Add(time.Hour), old.Add(time.Hour))
	_ = os.Chtimes(codexFile, old.Add(-time.Hour), old.Add(-time.Hour))

	list, err := ListRecent(ListOptions{Home: home, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 3 {
		t.Fatalf("want 3 got %d %#v", len(list), list)
	}

	byID := map[string]SessionSummary{}
	for _, s := range list {
		byID[s.ID] = s
		if s.SourceMode != SourceModeImport {
			t.Fatalf("sourceMode %q", s.SourceMode)
		}
	}
	if byID[sessA].Title != "Wire local session index" {
		t.Fatalf("claude title: %+v", byID[sessA])
	}
	if byID[sessA].Runtime != RuntimeClaudeCode {
		t.Fatalf("runtime %q", byID[sessA].Runtime)
	}
	if byID[sessA].ProjectKey != "D--Code-TokenDance" {
		t.Fatalf("projectKey %q", byID[sessA].ProjectKey)
	}
	if byID[codexID].Title != "Import billing check" {
		t.Fatalf("codex title: %+v", byID[codexID])
	}
	if byID[codexID].Runtime != RuntimeCodex {
		t.Fatalf("codex runtime %q", byID[codexID].Runtime)
	}
	// newest by UpdatedAt: codex index 2026-07-16 should be first
	if list[0].ID != codexID {
		t.Fatalf("want codex first by updated_at, got %#v", list[0])
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

func TestListRecentLimitAndFilter(t *testing.T) {
	home := t.TempDir()
	projects := ResolveClaudeCodeSessionsDir(home, "")
	proj := filepath.Join(projects, "P")
	if err := os.MkdirAll(proj, 0o755); err != nil {
		t.Fatal(err)
	}
	for i, id := range []string{"s1", "s2", "s3"} {
		p := filepath.Join(proj, id+".jsonl")
		if err := os.WriteFile(p, []byte("{}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		ts := time.Now().Add(time.Duration(i) * time.Hour)
		_ = os.Chtimes(p, ts, ts)
	}
	list, err := ListRecent(ListOptions{
		Home:            home,
		Limit:           2,
		IncludeRuntimes: []RuntimeID{RuntimeClaudeCode},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("want 2 got %d", len(list))
	}
	for _, s := range list {
		if s.Runtime != RuntimeClaudeCode {
			t.Fatalf("unexpected runtime %q", s.Runtime)
		}
	}
}

func TestCodexSessionIDFromFilename(t *testing.T) {
	id := "019f6406-c61e-7421-bb97-74e9db7342dd"
	name := "rollout-2026-07-15T12-26-33-" + id + ".jsonl"
	if got := codexSessionIDFromFilename(name); got != id {
		t.Fatalf("got %q want %q", got, id)
	}
}

func TestOpenCodeStubEmpty(t *testing.T) {
	list, err := ListRecent(ListOptions{
		Home:            t.TempDir(),
		IncludeRuntimes: []RuntimeID{RuntimeOpenCode},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("stub should be empty: %d", len(list))
	}
}

func TestTruncateTitle(t *testing.T) {
	if truncateTitle("  hi  ", 10) != "hi" {
		t.Fatal("trim")
	}
	long := "abcdefghijklmnop"
	got := truncateTitle(long, 8)
	if len([]rune(got)) != 8 {
		t.Fatalf("got %q len %d", got, len([]rune(got)))
	}
}
